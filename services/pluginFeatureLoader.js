import { getDb } from '../db.js';
import {
  appendPluginAccessEvent,
  createPluginAccessRequest,
  getPluginAccessGrant,
  normalizeFeatureSelections,
} from './pluginAccessStore.js';

const OWN = Object.prototype.hasOwnProperty;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LOADABLE_STATUSES = new Set(['active', 'staged']);

function fail(message) { throw new Error(`Invalid plugin feature loader input: ${message}`); }
function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${field} must be a plain object`);
  return value;
}
function identifier(value, field) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${field} must be a safe identifier string`);
  return value;
}
function optionalIdentifier(value, field) {
  if (value === undefined || value === null) return null;
  return identifier(value, field);
}
function parseManifest(value, versionId) {
  try {
    const manifest = JSON.parse(value);
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('not object');
    return manifest;
  } catch { throw new Error(`Corrupt plugin package manifest for ${versionId}`); }
}
function exactScope(input) {
  const hasVersion = OWN.call(input, 'versionId') && input.versionId !== undefined && input.versionId !== null;
  const hasCommit = OWN.call(input, 'sourceCommit') && input.sourceCommit !== undefined && input.sourceCommit !== null;
  if (hasVersion === hasCommit) fail('requires exactly one of versionId or sourceCommit');
  return hasVersion
    ? { versionId: identifier(input.versionId, 'versionId') }
    : { sourceCommit: identifier(input.sourceCommit, 'sourceCommit') };
}
function normalizeInput(input) {
  plainObject(input, 'input');
  const allowed = new Set(['username', 'agentId', 'packageKey', 'versionId', 'sourceCommit', 'selections', 'sessionId', 'executionId']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`${key} is not supported`);
  return {
    username: identifier(input.username, 'username'),
    agentId: identifier(input.agentId, 'agentId'),
    packageKey: identifier(input.packageKey, 'packageKey'),
    scope: exactScope(input),
    selections: normalizeFeatureSelections(input.selections, 'selections'),
    sessionId: optionalIdentifier(input.sessionId, 'sessionId'),
    executionId: optionalIdentifier(input.executionId, 'executionId'),
  };
}
function hasSelections(selections) { return selections.skills.length + selections.bundles.length + selections.tools.length > 0; }
function emptyLoaded() { return { skills: [], bundles: [], tools: [] }; }
function result(outcome, loaded = emptyLoaded(), extras = {}) { return { outcome, loaded, ...extras }; }
function findVersion(input) {
  const sql = input.scope.versionId
    ? `SELECT p.package_key, p.status AS package_status, v.id, v.source_commit, v.manifest, v.status AS version_status
       FROM prompt_packages p JOIN prompt_package_versions v ON v.package_id = p.id
       WHERE p.package_key = ? AND v.id = ?`
    : `SELECT p.package_key, p.status AS package_status, v.id, v.source_commit, v.manifest, v.status AS version_status
       FROM prompt_packages p JOIN prompt_package_versions v ON v.package_id = p.id
       WHERE p.package_key = ? AND v.source_commit = ?`;
  return getDb().prepare(sql).get(input.packageKey, input.scope.versionId || input.scope.sourceCommit) || null;
}
function auditDetails(input, featureKey, action) {
  const details = { agentId: input.agentId, featureKey, action };
  if (input.sessionId) details.sessionId = input.sessionId;
  if (input.executionId) details.executionId = input.executionId;
  return details;
}
function auditSelections(input, version, event, selections, requestId) {
  for (const type of ['skills', 'bundles', 'tools']) {
    for (const featureKey of selections[type]) {
      appendPluginAccessEvent({
        username: input.username, scope: { packageKey: input.packageKey, versionId: version.id }, event, actor: input.username,
        ...(requestId ? { requestId } : {}), details: auditDetails(input, featureKey, type),
      });
    }
  }
}
function skillDeclarations(manifest) {
  if (!Array.isArray(manifest.skills)) return [];
  return manifest.skills.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const key = typeof entry.key === 'string' && ID.test(entry.key) ? entry.key : null;
    // Paths are only compared internally and are never returned or audited.
    const path = typeof entry.path === 'string' && entry.path.length > 0 && entry.path.length <= 1024 ? entry.path : null;
    return key && path ? [{ key, path }] : [];
  });
}
function matchingSkillArtifact(versionId, manifest, featureKey) {
  const artifacts = getDb().prepare(`SELECT artifact_key, source_path, content_hash, prompt_block_id, prompt_block_version_id
    FROM prompt_package_artifacts WHERE package_version_id = ? AND type = 'skill'`).all(versionId);
  const declared = skillDeclarations(manifest).filter((entry) => entry.key === featureKey);
  const declarationMatches = declared.flatMap((entry) => artifacts.filter((artifact) => artifact.source_path === entry.path));
  if (declarationMatches.length === 1) return declarationMatches[0];
  if (declarationMatches.length > 1 || declared.length > 0) return null;
  const legacy = artifacts.filter((artifact) => artifact.artifact_key === featureKey);
  return legacy.length === 1 ? legacy[0] : null;
}
function inertManifestKeys(manifest, type) {
  if (type === 'bundles') return new Set((Array.isArray(manifest.mcpBundles) ? manifest.mcpBundles : [])
    .map((entry) => entry?.bundleKey).filter((key) => typeof key === 'string' && ID.test(key)));
  return new Set((Array.isArray(manifest.mcpBundles) ? manifest.mcpBundles : [])
    .flatMap((entry) => Array.isArray(entry?.toolKeys) ? entry.toolKeys : [])
    .filter((key) => typeof key === 'string' && ID.test(key)));
}
function skillReferenceIndex(versionId, skillPath) {
  const root = skillPath === 'SKILL.md' ? '' : skillPath.slice(0, -'/SKILL.md'.length);
  const prefix = root ? `${root}/references/` : 'references/';
  return getDb().prepare(`SELECT source_path, content_hash FROM prompt_package_artifacts WHERE package_version_id = ? AND type = 'reference' AND source_path LIKE ? ORDER BY source_path`).all(versionId, `${prefix}%`).map((row) => ({ path: row.source_path.slice(root ? root.length + 1 : 0), contentHash: row.content_hash }));
}
function safeSkillContent(input, version, featureKey, artifact) {
  if (!artifact.prompt_block_id || !artifact.prompt_block_version_id || !artifact.content_hash) return null;
  const block = getDb().prepare('SELECT id, block_id, content FROM prompt_block_versions WHERE id = ? AND block_id = ?').get(artifact.prompt_block_version_id, artifact.prompt_block_id);
  if (!block) return null;
  const references = skillReferenceIndex(version.id, artifact.source_path);
  const label = `UNTRUSTED_PLUGIN_SKILL package=${input.packageKey} versionId=${version.id} sourceCommit=${version.source_commit} feature=${featureKey} blockId=${artifact.prompt_block_id} blockVersionId=${artifact.prompt_block_version_id} contentHash=${artifact.content_hash}`;
  const referenceHint = references.length ? `\n\nPlugin references available from this pinned snapshot (read them only when needed with read_plugin_skill_reference):\n${references.map((reference) => `- ${reference.path} (sha256 ${reference.contentHash})`).join('\n')}` : '';
  return `<<<${label}>>>\n${block.content}${referenceHint}\n<<<END_UNTRUSTED_PLUGIN_SKILL>>>`;
}

/** Resolves only one pinned package version; it never registers or executes tools. */
export function loadPluginFeaturesForAgent(rawInput) {
  const input = normalizeInput(rawInput);
  if (!hasSelections(input.selections)) return result('noop');
  const version = findVersion(input);
  // An absent exact scope has no valid foreign-key target for an access event.
  if (!version) return result('unavailable');
  if (!LOADABLE_STATUSES.has(version.package_status) || !LOADABLE_STATUSES.has(version.version_status)) {
    auditSelections(input, version, 'plugin_feature_unavailable', input.selections);
    return result('unavailable');
  }
  const grant = getPluginAccessGrant({ username: input.username, agentId: input.agentId, scope: { packageKey: input.packageKey, versionId: version.id } });
  if (!grant || grant.mode === 'unavailable') {
    auditSelections(input, version, 'plugin_feature_unavailable', input.selections);
    return result('unavailable');
  }
  if (grant.mode === 'request') {
    const request = createPluginAccessRequest({
      username: input.username, agentId: input.agentId, scope: { packageKey: input.packageKey, versionId: version.id },
      selections: input.selections, requesterActor: input.username,
    });
    auditSelections(input, version, 'plugin_feature_request_created', input.selections, request.id);
    return result('request_created', emptyLoaded(), { requestId: request.id });
  }

  const manifest = parseManifest(version.manifest, version.id);
  const loaded = emptyLoaded();
  const requestable = emptyLoaded();
  const excluded = grant.exclusions;
  const approved = grant.approvedFeatures; // Empty is fail-closed for legacy direct grants.
  const one = (type, key) => ({ skills: type === 'skills' ? [key] : [], bundles: type === 'bundles' ? [key] : [], tools: type === 'tools' ? [key] : [] });
  for (const featureKey of input.selections.skills) {
    if (excluded.skills.includes(featureKey)) { auditSelections(input, version, 'plugin_feature_excluded', one('skills', featureKey)); continue; }
    const artifact = matchingSkillArtifact(version.id, manifest, featureKey);
    const content = artifact && safeSkillContent(input, version, featureKey, artifact);
    if (!content) { auditSelections(input, version, 'plugin_feature_unmapped', one('skills', featureKey)); continue; }
    if (!approved.skills.includes(featureKey)) { requestable.skills.push(featureKey); continue; }
    loaded.skills.push(content);
    auditSelections(input, version, 'plugin_feature_loaded', one('skills', featureKey));
  }
  for (const type of ['bundles', 'tools']) {
    const keys = inertManifestKeys(manifest, type);
    for (const featureKey of input.selections[type]) {
      if (excluded[type].includes(featureKey)) { auditSelections(input, version, 'plugin_feature_excluded', one(type, featureKey)); continue; }
      if (!keys.has(featureKey)) { auditSelections(input, version, 'plugin_feature_unmapped', one(type, featureKey)); continue; }
      if (!approved[type].includes(featureKey)) { requestable[type].push(featureKey); continue; }
      loaded[type].push({ key: featureKey, executionAvailable: false });
      auditSelections(input, version, 'plugin_feature_inert', one(type, featureKey));
    }
  }
  if (hasSelections(requestable)) {
    const request = createPluginAccessRequest({ username: input.username, agentId: input.agentId, scope: { packageKey: input.packageKey, versionId: version.id }, selections: requestable, requesterActor: input.username });
    auditSelections(input, version, 'plugin_feature_request_created', requestable, request.id);
    return result(hasSelections(loaded) ? 'direct_and_request_created' : 'request_created', loaded, { requestId: request.id });
  }
  return result('direct', loaded);
}
