import { discoverClaudePluginManifests } from './claudePluginManifestDiscovery.js';
import { fetchPinnedGithubPromptFiles, fetchPinnedGithubTreePaths, resolveGithubRefToCommit } from './pinnedGithubPromptClient.js';
import { getPromptPackageSyncSource } from './promptPackageSyncConfigStore.js';
import { stagePinnedGithubPromptPackage } from './promptPackageSyncService.js';
import { upsertPromptPackageSyncJob } from './promptPackageSyncJobStore.js';
import { getVisibleAgent } from './agentStore.js';
import { getOrBootstrapPromptDocumentByAgent } from './promptStore.js';
import { upsertPluginAccessGrant } from './pluginAccessStore.js';

const MAX_PLUGIN_FILES = 64;
const SOURCE_KEY = /^github:([a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)@([^\s]+)$/;

export class ClaudePluginImportError extends Error {
  constructor(code) { super('Claude plugin import failed'); this.name = 'ClaudePluginImportError'; this.code = code; }
}
const fail = (code) => { throw new ClaudePluginImportError(code); };
const remoteFail = (error) => fail(typeof error?.code === 'string' ? error.code : 'REMOTE_FETCH_FAILED');
function configuredSource(sourceKey) {
  if (typeof sourceKey !== 'string' || !SOURCE_KEY.test(sourceKey)) fail('INVALID_SOURCE_KEY');
  const source = getPromptPackageSyncSource(sourceKey);
  if (!source) fail('SOURCE_NOT_CONFIGURED');
  if (!source.enabled) fail('SOURCE_DISABLED');
  return source;
}
function sourceIdentity(source) { return { provider: 'github', repository: source.repository, ref: source.sourceRef }; }
function root(value) {
  if (typeof value !== 'string' || value.length > 384 || value.includes('\\') || value.startsWith('/') || value.split('/').some((part) => !part || part === '.' || part === '..')) fail('INVALID_PLUGIN_ROOT');
  return value;
}
function safeId(value) {
  const id = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!id) fail('INVALID_PLUGIN_CONTENT');
  return id;
}
async function discover(sourceKey, fetchImpl) {
  const source = configuredSource(sourceKey);
  let sourcePin;
  try { sourcePin = await resolveGithubRefToCommit({ source: sourceIdentity(source), fetchImpl }); } catch (error) { remoteFail(error); }
  let paths;
  try { paths = await fetchPinnedGithubTreePaths({ sourcePin, fetchImpl }); } catch (error) { remoteFail(error); }
  const descriptors = paths.filter((path) => path === '.claude-plugin/plugin.json' || path.endsWith('/.claude-plugin/plugin.json'));
  if (!descriptors.length) fail('DESCRIPTOR_NOT_FOUND');
  const roots = descriptors.map((path) => path === '.claude-plugin/plugin.json' ? '' : path.slice(0, -'/.claude-plugin/plugin.json'.length));
  const ownsSkill = (candidateRoot, candidatePath) => {
    const prefix = candidateRoot ? `${candidateRoot}/` : '';
    if (!(candidatePath === `${prefix}SKILL.md` || (candidatePath.startsWith(prefix) && candidatePath.endsWith('/SKILL.md')))) return false;
    return !roots.some((nested) => nested !== candidateRoot && nested !== '' && nested.startsWith(prefix) && candidatePath.startsWith(`${nested}/`));
  };
  const needed = new Set(descriptors);
  for (const candidateRoot of roots) {
    const prefix = candidateRoot ? `${candidateRoot}/` : '';
    for (const path of paths) if (path === `${prefix}.mcp.json` || ownsSkill(candidateRoot, path)) needed.add(path);
  }
  if (needed.size > MAX_PLUGIN_FILES) fail('TOO_MANY_PLUGIN_FILES');
  let fetched;
  try { fetched = await fetchPinnedGithubPromptFiles({ sourcePin, paths: [...needed], fetchImpl }); } catch (error) { remoteFail(error); }
  let discovered;
  try { discovered = discoverClaudePluginManifests({ sourcePin, files: fetched.files.map(({ path, content, contentHash }) => ({ path, content, contentHash })) }); } catch (error) { fail(typeof error?.code === 'string' ? error.code : 'INVALID_PLUGIN_CONTENT'); }
  return { source, sourcePin, fetched, manifests: discovered.manifests };
}

/** Read-only discovery: configured source is the sole input identity. */
export async function discoverClaudePluginsFromSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['sourceKey', 'fetchImpl'].includes(key)) || typeof input.fetchImpl !== 'function') fail('INVALID_INPUT');
  const result = await discover(input.sourceKey, input.fetchImpl);
  return Object.freeze({ sourceKey: input.sourceKey, resolvedCommit: result.sourcePin.commit, candidates: result.manifests.map((manifest) => ({ pluginRoot: manifest.metadata.claudePlugin.root, manifest })) });
}

/** Imports one discovered candidate and creates its future ref-following sync job. */
export async function importClaudePluginFromSource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['sourceKey', 'pluginRoot', 'agentId', 'actor', 'fetchImpl'].includes(key)) || typeof input.fetchImpl !== 'function' || typeof input.agentId !== 'string' || !input.agentId.trim() || typeof input.actor !== 'string' || !input.actor.trim()) fail('INVALID_INPUT');
  const agent = getVisibleAgent(input.actor, input.agentId.trim());
  const document = agent && getOrBootstrapPromptDocumentByAgent({ username: input.actor, agentId: agent.id });
  if (!document?.key) fail('AGENT_NOT_FOUND');
  const documentKey = document.key;
  const result = await discover(input.sourceKey, input.fetchImpl);
  const pluginRoot = root(input.pluginRoot);
  const manifest = result.manifests.find((item) => item.metadata.claudePlugin.root === pluginRoot);
  if (!manifest) fail('INVALID_SELECTION');
  const packageKey = safeId(manifest.metadata.claudePlugin.name);
  const skills = manifest.skills;
  if (!skills.length) fail('INVALID_PLUGIN_CONTENT');
  const files = result.fetched.files.filter((file) => skills.some((skill) => skill.path === file.path)).map(({ path, content }) => ({ path, content }));
  const artifactMappings = skills.map((skill, position) => ({ artifactKey: `${safeId(skill.path.slice(0, -'/SKILL.md'.length))}-skill`, blockKey: `${packageKey}-${safeId(skill.key)}`, blockType: 'text', included: true, position, metadata: {} }));
  let staged;
  try {
    staged = stagePinnedGithubPromptPackage({ sourcePin: result.sourcePin, package: { packageKey, source: 'github', repository: result.sourcePin.repository, metadata: {} }, version: { version: manifest.metadata.claudePlugin.version || 'discovered', sourceCommit: result.sourcePin.commit, sourceRef: result.sourcePin.ref, manifest }, files, documentKey, artifactMappings, details: { origin: 'claude_plugin_source_import' }, ...(input.actor ? { actor: input.actor } : {}) });
  } catch { fail('STAGING_FAILED'); }
  try {
    upsertPromptPackageSyncJob({ sourceKey: input.sourceKey, enabled: true, intervalSeconds: 3600, descriptor: { schemaVersion: 1, sourcePin: result.sourcePin, manifestPath: pluginRoot ? `${pluginRoot}/.claude-plugin/plugin.json` : '.claude-plugin/plugin.json', artifactPaths: skills.map((skill) => skill.path) }, package: { packageKey, metadata: {} }, version: { version: manifest.metadata.claudePlugin.version || 'discovered' }, documentKey, artifactMappings, details: { origin: 'claude_plugin_source_import' }, ...(input.actor ? { createdBy: input.actor } : {}) });
  } catch { fail('JOB_FAILED'); }
  try { upsertPluginAccessGrant({ username: input.actor, agentId: agent.id, scope: { packageKey, sourceCommit: result.sourcePin.commit }, mode: 'direct', approvedFeatures: { skills: skills.map((skill) => skill.key), bundles: [], tools: [] }, actor: input.actor }); } catch { fail('GRANT_FAILED'); }
  return { ...staged, sourceKey: input.sourceKey, resolvedCommit: result.sourcePin.commit, agentId: agent.id, documentKey };
}
