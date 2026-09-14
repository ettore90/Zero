import { getDb } from '../db.js';
import { appendPluginAccessEvent, getPluginAccessGrant, normalizeFeatureSelections } from './pluginAccessStore.js';
import { getAgent } from './agentStore.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REPOSITORY_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const FEATURE_TYPES = new Set(['skills', 'blocks', 'bundles', 'tools']);
const INSPECTION_CALLER_ALLOWLIST = new Set(['cortex.prompt', 'default', 'zero']);
const CORTEX_DOMAIN_MASTER = /^cortex\.[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function fail(message) { throw new Error(`Invalid plugin catalog input: ${message}`); }
function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${field} must be a plain object`);
  return value;
}
function identifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(`${field} must be a safe identifier string`);
  return value;
}
function parseJson(value, field, id) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch { throw new Error(`Corrupt plugin catalog ${field} for ${id}`); }
}
function safeName(value) { return typeof value === 'string' && IDENTIFIER.test(value) ? value : null; }
function safeRepository(value) { return typeof value === 'string' && REPOSITORY_IDENTIFIER.test(value) && !value.includes('://') ? value : null; }
function selection(input) {
  const hasVersion = input.versionId !== undefined && input.versionId !== null;
  const hasCommit = input.sourceCommit !== undefined && input.sourceCommit !== null;
  if (hasVersion && hasCommit) fail('versionId and sourceCommit are mutually exclusive');
  return { versionId: hasVersion ? identifier(input.versionId, 'versionId') : null, sourceCommit: hasCommit ? identifier(input.sourceCommit, 'sourceCommit') : null };
}
function packageRow(packageKey, includeInactive) {
  const row = getDb().prepare(`SELECT * FROM prompt_packages WHERE package_key = ?${includeInactive ? '' : " AND status != 'disabled'"}`).get(packageKey);
  if (!row) throw new Error(`Plugin package not found: ${packageKey}`);
  return row;
}
function selectedVersion(pkg, requested) {
  const db = getDb();
  let row;
  if (requested.versionId) row = db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND id = ?').get(pkg.id, requested.versionId);
  else if (requested.sourceCommit) row = db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND source_commit = ?').get(pkg.id, requested.sourceCommit);
  else row = db.prepare(`SELECT * FROM prompt_package_versions WHERE package_id = ? ORDER BY
    CASE status WHEN 'active' THEN 0 WHEN 'staged' THEN 1 ELSE 2 END,
    created_at DESC, id ASC LIMIT 1`).get(pkg.id);
  if (!row) throw new Error(`Plugin package version not found for ${pkg.package_key}`);
  return row;
}
function declaredKeys(manifest, property) {
  if (!Array.isArray(manifest[property])) return [];
  return manifest[property].map((item) => safeName(item?.key)).filter(Boolean);
}
function artifactKeys(rows, type) {
  return rows.filter((row) => row.type === type).map((row) => safeName(row.artifact_key)).filter(Boolean);
}
function sortedUnique(values) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function featureTree(version) {
  const manifest = parseJson(version.manifest, 'manifest', version.id);
  const artifacts = getDb().prepare('SELECT type, artifact_key FROM prompt_package_artifacts WHERE package_version_id = ? ORDER BY type ASC, artifact_key ASC, id ASC').all(version.id);
  const skills = sortedUnique([...declaredKeys(manifest, 'skills'), ...artifactKeys(artifacts, 'skill')]);
  const blocks = sortedUnique([...declaredKeys(manifest, 'blocks'), ...artifactKeys(artifacts, 'block')]);
  const bundles = [];
  const tools = [];
  if (Array.isArray(manifest.mcpBundles)) {
    for (const bundle of manifest.mcpBundles) {
      const key = safeName(bundle?.bundleKey);
      if (!key) continue;
      const bundleTools = sortedUnique(Array.isArray(bundle.toolKeys) ? bundle.toolKeys.map(safeName).filter(Boolean) : []);
      bundles.push({ key, tools: bundleTools, executionAvailable: false });
      tools.push(...bundleTools);
    }
  }
  return { skills, blocks, bundles: bundles.sort((a, b) => a.key.localeCompare(b.key)), tools: sortedUnique(tools) };
}
function applyExclusions(tree, exclusions) {
  const excluded = exclusions || { skills: [], bundles: [], tools: [] };
  const skills = tree.skills.filter((key) => !excluded.skills.includes(key));
  const bundles = tree.bundles.filter((bundle) => !excluded.bundles.includes(bundle.key)).map((bundle) => ({
    ...bundle,
    tools: bundle.tools.filter((key) => !excluded.tools.includes(key)),
  }));
  return { skills, blocks: tree.blocks, bundles, tools: sortedUnique(bundles.flatMap((bundle) => bundle.tools)) };
}
function applyApprovedFeatures(tree, approvedFeatures) {
  const approved = approvedFeatures || { skills: [], bundles: [], tools: [] };
  const bundles = tree.bundles.filter((bundle) => approved.bundles.includes(bundle.key)).map((bundle) => ({
    ...bundle,
    tools: bundle.tools.filter((key) => approved.tools.includes(key)),
  }));
  return {
    skills: tree.skills.filter((key) => approved.skills.includes(key)),
    blocks: tree.blocks,
    bundles,
    tools: sortedUnique(bundles.flatMap((bundle) => bundle.tools)),
  };
}
function requestableFeatures(tree, exclusions, approvedFeatures, features) {
  const eligible = applyExclusions(tree, exclusions);
  const approved = approvedFeatures || { skills: [], bundles: [], tools: [] };
  const selected = features === undefined ? null : normalizeFeatureSelections(features, 'features');
  const keep = (type, key) => !selected || selected[type].length === 0 || selected[type].includes(key);
  return {
    skills: eligible.skills.filter((key) => !approved.skills.includes(key) && keep('skills', key)),
    bundles: eligible.bundles.map((bundle) => bundle.key).filter((key) => !approved.bundles.includes(key) && keep('bundles', key)),
    tools: eligible.tools.filter((key) => !approved.tools.includes(key) && keep('tools', key)),
  };
}
function requestedFeatures(tree, features) {
  if (features === undefined) return tree;
  const selected = normalizeFeatureSelections(features, 'features');
  // Blocks are descriptive package artifacts, not loadable feature selections. Empty
  // selection groups intentionally mean no filter for their supported group.
  const keep = (type, key) => selected[type].length === 0 || selected[type].includes(key);
  const bundles = tree.bundles.filter((bundle) => keep('bundles', bundle.key)).map((bundle) => ({ ...bundle, tools: bundle.tools.filter((key) => keep('tools', key)) }));
  return {
    skills: tree.skills.filter((key) => keep('skills', key)),
    blocks: tree.blocks,
    bundles,
    tools: sortedUnique(bundles.flatMap((bundle) => bundle.tools)),
  };
}
function entry(username, agentId, pkg, version, features) {
  const grant = getPluginAccessGrant({ username, agentId, scope: { packageKey: pkg.package_key, versionId: version.id } });
  const access = grant?.mode || 'unavailable';
  const result = {
    package: { packageKey: pkg.package_key, source: safeName(pkg.source), repository: safeRepository(pkg.repository), status: pkg.status },
    version: { id: version.id, version: version.version, sourceCommit: version.source_commit, status: version.status },
    access,
  };
  const tree = featureTree(version);
  if (access === 'direct') {
    const eligible = applyExclusions(tree, grant.exclusions);
    result.features = requestedFeatures(applyApprovedFeatures(eligible, grant.approvedFeatures), features);
    result.requestableFeatures = requestableFeatures(eligible, grant.exclusions, grant.approvedFeatures, features);
  } else {
    // Identifier-only inventory lets an operator configure request/direct access
    // without exposing artifact content or operational MCP configuration.
    result.requestableFeatures = requestableFeatures(tree, { skills: [], bundles: [], tools: [] }, { skills: [], bundles: [], tools: [] }, features);
  }
  return result;
}

/**
 * Authorized, audited catalog listing for an agent discovering which plugin packages
 * and skills it may load. Identifier-only: no artifact content, path, hash or credential.
 */
export function listPluginCatalogForAuthorizedCaller(input) {
  plainObject(input, 'input');
  const callerAgentId = identifier(input.callerAgentId, 'callerAgentId');
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!isPluginCatalogInspectionCallerAuthorized({ username, callerAgentId })) throw new Error('Plugin catalog inspection is not authorized');
  if (input.includeInactive !== undefined && typeof input.includeInactive !== 'boolean') fail('includeInactive must be a boolean');
  const entries = listPluginCatalogForAgent({ username, agentId: callerAgentId, ...(input.includeInactive === undefined ? {} : { includeInactive: input.includeInactive }) });
  const packages = entries.map((catalogEntry) => ({
    packageKey: catalogEntry.package.packageKey,
    status: catalogEntry.package.status,
    version: { id: catalogEntry.version.id, version: catalogEntry.version.version, sourceCommit: catalogEntry.version.sourceCommit, status: catalogEntry.version.status },
    access: catalogEntry.access,
    ...(catalogEntry.features ? { features: catalogEntry.features } : {}),
    ...(catalogEntry.requestableFeatures ? { requestableFeatures: catalogEntry.requestableFeatures } : {}),
  }));
  for (const item of packages) {
    appendPluginAccessEvent({
      username,
      scope: { packageKey: item.packageKey, versionId: item.version.id },
      event: 'plugin_inspected',
      actor: username,
      details: { callerAgentId, targetAgentId: callerAgentId, access: item.access },
    });
  }
  return { authorized: true, packageCount: packages.length, packages };
}

/** Lists inert catalog summaries for an explicit username. Only direct grants receive a feature tree. */
export function listPluginCatalogForAgent(input) {
  plainObject(input, 'input');
  const username = identifier(input.username, 'username');
  const agentId = identifier(input.agentId, 'agentId');
  if (input.includeInactive !== undefined && typeof input.includeInactive !== 'boolean') fail('includeInactive must be a boolean');
  const db = getDb();
  const packages = db.prepare(`SELECT * FROM prompt_packages${input.includeInactive ? '' : " WHERE status != 'disabled'"} ORDER BY package_key ASC, id ASC`).all();
  const selected = packages.map((pkg) => ({ pkg, version: selectedVersion(pkg, {}) }));
  // Exact-version grants remain revocable after a newer version becomes preferred.
  // Join only the caller's grants; no other agents' access state is exposed.
  const granted = db.prepare(`SELECT p.*, v.id AS version_id, v.version AS version_name, v.source_commit, v.source_ref, v.manifest, v.validation, v.status AS version_status, v.created_at AS version_created_at, v.updated_at AS version_updated_at
    FROM plugin_access_grants g JOIN prompt_package_versions v ON v.id = g.package_version_id JOIN prompt_packages p ON p.id = v.package_id
    WHERE g.owner_username = ? AND g.agent_id = ? ORDER BY p.package_key ASC, v.created_at DESC, v.id ASC`).all(username, agentId);
  const seen = new Set(selected.map(({ version }) => version.id));
  for (const row of granted) {
    if (seen.has(row.version_id)) continue;
    const pkg = { id: row.id, package_key: row.package_key, source: row.source, repository: row.repository, status: row.status, metadata: row.metadata };
    const version = { id: row.version_id, package_id: row.id, version: row.version_name, source_commit: row.source_commit, source_ref: row.source_ref, manifest: row.manifest, validation: row.validation, status: row.version_status, created_at: row.version_created_at, updated_at: row.version_updated_at };
    selected.push({ pkg, version }); seen.add(version.id);
  }
  return selected.sort((left, right) => left.pkg.package_key.localeCompare(right.pkg.package_key) || String(right.version.created_at).localeCompare(String(left.version.created_at)) || left.version.id.localeCompare(right.version.id)).map(({ pkg, version }) => entry(username, agentId, pkg, version));
}

/** Gets one inert catalog entry for an explicit username; version selectors are package-scoped. */
export function getPluginCatalogEntryForAgent(input) {
  plainObject(input, 'input');
  const username = identifier(input.username, 'username');
  const agentId = identifier(input.agentId, 'agentId');
  const pkg = packageRow(identifier(input.packageKey, 'packageKey'), input.includeInactive === true);
  return entry(username, agentId, pkg, selectedVersion(pkg, selection(input)));
}

export function isPluginCatalogInspectionCallerAuthorized({ username, callerAgentId }) {
  if (typeof username !== 'string' || !username.trim() || typeof callerAgentId !== 'string' || !IDENTIFIER.test(callerAgentId)) return false;
  const agent = getAgent(username, callerAgentId);
  if (!agent || agent.isMaster !== true || agent.role !== 'master') return false;
  // Agent ids are opaque (e.g. "mpj37wqjfxhcxtw86ua"); the cortex.* domain lives in the
  // agent name, so both identifiers are checked. Master role is still required.
  const identifiers = [agent.id, agent.name]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
  return identifiers.some((value) => INSPECTION_CALLER_ALLOWLIST.has(value) || CORTEX_DOMAIN_MASTER.test(value));
}

/**
 * Read-only inspection helper. It never returns artifact content, URLs, hashes,
 * paths, credentials, executable configuration, or a derived diff.
 */
export function inspectPluginForAuthorizedCaller(input) {
  plainObject(input, 'input');
  const callerAgentId = identifier(input.callerAgentId, 'callerAgentId');
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!isPluginCatalogInspectionCallerAuthorized({ username, callerAgentId })) throw new Error('Plugin catalog inspection is not authorized');
  const targetAgentId = input.targetAgentId === undefined || input.targetAgentId === null ? callerAgentId : identifier(input.targetAgentId, 'targetAgentId');
  const catalogInput = { username, agentId: targetAgentId, packageKey: identifier(input.packageKey, 'packageKey') };
  if (input.versionId !== undefined) catalogInput.versionId = input.versionId;
  if (input.sourceCommit !== undefined) catalogInput.sourceCommit = input.sourceCommit;
  const catalogEntry = getPluginCatalogEntryForAgent(catalogInput);
  // Inspection deliberately has a narrower serialization contract than the internal
  // catalog: package source/repository remain operational provenance, not agent-visible
  // inspection data. Source commit is retained only as the approved version selector.
  const safeEntry = {
    package: { packageKey: catalogEntry.package.packageKey, status: catalogEntry.package.status },
    version: { id: catalogEntry.version.id, version: catalogEntry.version.version, sourceCommit: catalogEntry.version.sourceCommit, status: catalogEntry.version.status },
    access: catalogEntry.access,
  };
  if (catalogEntry.access === 'direct') safeEntry.features = requestedFeatures(catalogEntry.features, input.features);
  appendPluginAccessEvent({
    username,
    scope: { packageKey: safeEntry.package.packageKey, versionId: safeEntry.version.id },
    event: 'plugin_inspected',
    actor: username,
    details: { callerAgentId, targetAgentId, access: safeEntry.access },
  });
  return { authorized: true, entry: safeEntry };
}
