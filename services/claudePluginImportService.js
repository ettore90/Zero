import { discoverClaudePluginManifests } from './claudePluginManifestDiscovery.js';
import { fetchPinnedGithubPromptFiles, fetchPinnedGithubTreePaths } from './pinnedGithubPromptClient.js';
import { getPromptPackageSyncSource } from './promptPackageSyncConfigStore.js';
import { stagePinnedGithubPromptPackage } from './promptPackageSyncService.js';
import { normalizePromptPackageSourcePin } from './promptPackageSourcePolicy.js';

const PREVIEW_KEYS = new Set(['sourcePin', 'pluginRoot', 'fetchImpl']);
const IMPORT_KEYS = new Set(['sourcePin', 'pluginRoot', 'package', 'version', 'documentKey', 'artifactMappings', 'details', 'actor', 'fetchImpl']);
const MAX_PLUGIN_FILES = 64;

export class ClaudePluginImportError extends Error {
  constructor(code) { super('Claude plugin import failed'); this.name = 'ClaudePluginImportError'; this.code = code; }
}
const fail = (code) => { throw new ClaudePluginImportError(code); };
const own = (value, key) => Object.hasOwn(value, key);
function plain(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.has(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
}
function root(value) {
  if (value === undefined) return undefined;
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > 384 || value.includes('\\') || value.startsWith('/') || value.split('/').some((x) => !x || x === '.' || x === '..')) fail('INVALID_PLUGIN_ROOT');
  return value;
}
function pinAndSource(sourcePin) {
  let pin;
  try { pin = normalizePromptPackageSourcePin(sourcePin); } catch { fail('INVALID_SOURCE_PIN'); }
  const configured = getPromptPackageSyncSource(`github:${pin.repository}@${pin.ref}`);
  if (!configured) fail('SOURCE_NOT_CONFIGURED');
  if (!configured.enabled) fail('SOURCE_DISABLED');
  if (configured.provider !== 'github' || configured.repository !== pin.repository || configured.sourceRef !== pin.ref || configured.pinnedCommit !== pin.commit) fail('SOURCE_MISMATCH');
  return pin;
}
async function discover(input) {
  const pluginRoot = root(input.pluginRoot);
  const paths = await fetchPinnedGithubTreePaths({ sourcePin: input.sourcePin, fetchImpl: input.fetchImpl });
  const descriptorPaths = paths.filter((path) => path === '.claude-plugin/plugin.json' || path.endsWith('/.claude-plugin/plugin.json'));
  const selectedDescriptors = descriptorPaths.filter((path) => {
    const candidate = path === '.claude-plugin/plugin.json' ? '' : path.slice(0, -'/.claude-plugin/plugin.json'.length);
    return pluginRoot === undefined || candidate === pluginRoot;
  });
  if (!selectedDescriptors.length) fail('DESCRIPTOR_NOT_FOUND');
  const allRoots = descriptorPaths.map((path) => path === '.claude-plugin/plugin.json' ? '' : path.slice(0, -'/.claude-plugin/plugin.json'.length));
  const selectedRoots = selectedDescriptors.map((path) => path === '.claude-plugin/plugin.json' ? '' : path.slice(0, -'/.claude-plugin/plugin.json'.length));
  const ownsPath = (candidateRoot, candidatePath) => {
    const prefix = candidateRoot ? `${candidateRoot}/` : '';
    if (!(candidatePath === `${prefix}SKILL.md` || (candidatePath.startsWith(prefix) && candidatePath.endsWith('/SKILL.md')))) return false;
    return !allRoots.some((nestedRoot) => nestedRoot !== candidateRoot && nestedRoot !== '' && nestedRoot.startsWith(prefix) && candidatePath.startsWith(`${nestedRoot}/`));
  };
  // Descendant descriptors are fetched solely as ownership boundaries; their content
  // cannot become an import artifact for the selected parent candidate.
  const needed = new Set(selectedDescriptors);
  for (const candidateRoot of selectedRoots) {
    const prefix = candidateRoot ? `${candidateRoot}/` : '';
    for (const descriptorPath of descriptorPaths) {
      const descriptorRoot = descriptorPath === '.claude-plugin/plugin.json' ? '' : descriptorPath.slice(0, -'/.claude-plugin/plugin.json'.length);
      if (descriptorRoot !== candidateRoot && descriptorRoot !== '' && descriptorRoot.startsWith(prefix)) needed.add(descriptorPath);
    }
    for (const candidatePath of paths) if (candidatePath === `${prefix}.mcp.json` || ownsPath(candidateRoot, candidatePath)) needed.add(candidatePath);
  }
  if (needed.size > MAX_PLUGIN_FILES) fail('TOO_MANY_PLUGIN_FILES');
  let fetched;
  try { fetched = await fetchPinnedGithubPromptFiles({ sourcePin: input.sourcePin, paths: [...needed], fetchImpl: input.fetchImpl }); } catch { fail('REMOTE_FETCH_FAILED'); }
  let result;
  try { result = discoverClaudePluginManifests({ sourcePin: input.sourcePin, files: fetched.files.map(({ path, content, contentHash }) => ({ path, content, contentHash })) }); } catch { fail('INVALID_PLUGIN_CONTENT'); }
  const manifests = result.manifests.filter((manifest) => selectedRoots.includes(manifest.metadata.claudePlugin?.root));
  if (manifests.length !== selectedRoots.length) fail('INVALID_PLUGIN_CONTENT');
  return { fetched, manifests, roots: selectedRoots };
}

export async function previewClaudePluginImport(input) {
  if (!plain(input, PREVIEW_KEYS) || !own(input, 'sourcePin') || typeof input.fetchImpl !== 'function') fail('INVALID_INPUT');
  const sourcePin = pinAndSource(input.sourcePin);
  const result = await discover({ sourcePin, pluginRoot: input.pluginRoot, fetchImpl: input.fetchImpl });
  const candidates = result.roots.map((pluginRoot) => ({ pluginRoot, manifest: result.manifests.find((manifest) => manifest.metadata.claudePlugin?.root === pluginRoot) })).filter((candidate) => candidate.manifest);
  if (!candidates.length) fail('INVALID_PLUGIN_CONTENT');
  return Object.freeze({ sourcePin: Object.freeze({ ...sourcePin }), candidates: Object.freeze(candidates) });
}

export async function importClaudePluginFromPreview(input) {
  if (!plain(input, IMPORT_KEYS) || !['sourcePin', 'pluginRoot', 'package', 'version', 'documentKey', 'artifactMappings', 'fetchImpl'].every((key) => own(input, key)) || typeof input.fetchImpl !== 'function') fail('INVALID_INPUT');
  const sourcePin = pinAndSource(input.sourcePin);
  const pluginRoot = root(input.pluginRoot);
  const result = await discover({ sourcePin, pluginRoot, fetchImpl: input.fetchImpl });
  if (result.roots.length !== 1 || result.manifests.length !== 1) fail('INVALID_SELECTION');
  const manifest = result.manifests[0];
  const declaredPaths = new Set(manifest.skills.map((skill) => skill.path));
  const files = result.fetched.files.filter((file) => declaredPaths.has(file.path)).map(({ path, content }) => ({ path, content }));
  try {
    return stagePinnedGithubPromptPackage({
      sourcePin,
      package: { ...input.package, source: 'github', repository: sourcePin.repository },
      version: { ...input.version, sourceCommit: sourcePin.commit, sourceRef: sourcePin.ref, manifest },
      files,
      documentKey: input.documentKey,
      artifactMappings: input.artifactMappings,
      ...(own(input, 'details') ? { details: { ...input.details, origin: 'claude_plugin_discovery' } } : { details: { origin: 'claude_plugin_discovery' } }),
      ...(own(input, 'actor') ? { actor: input.actor } : {}),
    });
  } catch { fail('STAGING_FAILED'); }
}
