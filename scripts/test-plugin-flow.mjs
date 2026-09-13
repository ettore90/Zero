import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { initDb, getDb, closeDb, generateId } from '../db.js';
import { computePromptPackageManifestContentHash } from '../services/promptPackageManifest.js';
import { upsertPromptPackageSyncSource } from '../services/promptPackageSyncConfigStore.js';
import { materializePinnedGithubPromptPackage, syncPinnedGithubPromptPackageManually } from '../services/promptPackageSyncService.js';
import { activatePromptPackageVersion, stagePromptPackageVersion } from '../services/promptPackageStore.js';
import { listPluginCatalogForAgent, getPluginCatalogEntryForAgent } from '../services/pluginCatalog.js';
import { loadPluginFeaturesForAgent } from '../services/pluginFeatureLoader.js';
import { upsertPluginAccessGrant, decidePluginAccessRequest, listPluginAccessEvents, listPluginAccessRequests } from '../services/pluginAccessStore.js';
import { createGithubPrivateAccessRequest, listGithubPrivateAccessRequests, decideGithubPrivateAccessRequest, revokeGithubPrivateAccessApproval, getEffectiveGithubPrivateAccessAuthorization, listGithubPrivateAccessEvents } from '../services/githubPrivateAccessStore.js';
import { createGithubPrivateReadFetch } from '../services/githubPrivateAccessProvider.js';

const commit = 'a'.repeat(40);
const sourcePin = { provider: 'github', repository: 'acme/plugins', ref: 'main', commit };
const sourceKey = `github:${sourcePin.repository}@${sourcePin.ref}`;
const descriptor = { schemaVersion: 1, sourcePin, manifestPath: 'plugin.json', artifactPaths: ['README.md', 'skills/core/SKILL.md'] };
const skill = '---\nname: Core\ndescription: Core skill\n---\n\nUse this inert skill.\n';
const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const pass = (label) => console.log(`PASS ${label}`);
const selections = (skills = [], bundles = [], tools = []) => ({ skills, bundles, tools });

let root;
try {
  root = await mkdtemp(path.join(os.tmpdir(), 'zero-plugin-flow-'));
  const originalLog = console.log;
  console.log = () => {};
  initDb(path.join(root, 'plugin-flow.sqlite'));
  console.log = originalLog;
  getDb().prepare('INSERT INTO prompt_documents (id, key, title, metadata) VALUES (?, ?, ?, ?)').run('doc_plugin_flow', 'plugin-flow-doc', 'Plugin flow', '{}');

  const bareManifest = {
    schemaVersion: 1,
    source: { repository: sourcePin.repository, ref: sourcePin.ref, commit },
    capabilities: [],
    skills: [{ key: 'core-skill', path: 'skills/core/SKILL.md' }],
    blocks: [{ key: 'readme', path: 'README.md' }],
    mcpBundles: [{ bundleKey: 'safe-bundle', transport: 'remote', toolKeys: ['safe-tool', 'new-tool'], capabilities: ['read'] }],
  };
  const manifest = { ...bareManifest, source: { ...bareManifest.source, contentHash: computePromptPackageManifestContentHash(bareManifest) } };
  const files = { 'plugin.json': JSON.stringify(manifest), 'README.md': 'Inert package readme\n', 'skills/core/SKILL.md': skill };
  let fetchCalls = 0;
  const fetchImpl = async (url) => {
    fetchCalls += 1;
    const filePath = decodeURIComponent(new URL(url).pathname.split('/contents/')[1]);
    assert.ok(Object.hasOwn(files, filePath));
    return { status: 200, json: async () => ({ type: 'file', path: filePath, encoding: 'base64', content: Buffer.from(files[filePath]).toString('base64'), sha: 'b'.repeat(40) }) };
  };
  const packageData = { packageKey: 'plugin-flow', source: 'github', repository: sourcePin.repository, metadata: {} };
  const versionData = { version: '1.0.0' };
  const mappings = [
    { artifactKey: 'readme-md-reference', blockKey: 'plugin-readme', blockType: 'text', included: true, position: 0, metadata: {} },
    { artifactKey: 'skills-core-skill', blockKey: 'plugin-core', blockType: 'text', included: true, position: 1, metadata: {} },
  ];

  upsertPromptPackageSyncSource({ sourcePin, enabled: true });
  const first = await syncPinnedGithubPromptPackageManually({ descriptor, package: packageData, version: versionData, fetchImpl, documentKey: 'plugin-flow-doc', artifactMappings: mappings, actor: 'alice' });
  const second = await syncPinnedGithubPromptPackageManually({ descriptor, package: packageData, version: versionData, fetchImpl, documentKey: 'plugin-flow-doc', artifactMappings: mappings, actor: 'alice' });
  assert.equal(first.staged.changed, true); assert.equal(second.staged.changed, false); assert.equal(fetchCalls, 6);
  pass('pinned-sync-idempotent');
  const v1 = first.staged.version;
  activatePromptPackageVersion({ packageKey: 'plugin-flow', versionId: v1.id, actor: 'alice' });

  let entry = getPluginCatalogEntryForAgent({ username: 'alice', agentId: 'agent-one', packageKey: 'plugin-flow', versionId: v1.id });
  assert.equal(entry.access, 'unavailable'); assert.equal(entry.version.id, v1.id);
  pass('catalog-default-deny-exact-version');

  upsertPluginAccessGrant({ username: 'alice', agentId: 'agent-one', scope: { packageKey: 'plugin-flow', versionId: v1.id }, mode: 'direct', approvedFeatures: selections(['core-skill'], ['safe-bundle'], ['safe-tool']), exclusions: selections(), actor: 'alice' });
  entry = getPluginCatalogEntryForAgent({ username: 'alice', agentId: 'agent-one', packageKey: 'plugin-flow', versionId: v1.id });
  assert.equal(entry.access, 'direct'); assert.deepEqual(entry.features.skills, ['core-skill']);
  pass('direct-grant-baseline');
  assert.throws(() => upsertPluginAccessGrant({ username: 'alice', agentId: 'agent-one', scope: { packageKey: 'plugin-flow', versionId: v1.id }, mode: 'direct', approvedFeatures: selections(['core-skill'], ['safe-bundle'], ['safe-tool', 'new-tool']), exclusions: selections(), actor: 'alice' }), /approved feature request/);
  pass('direct-expansion-requires-approved-request');

  let loaded = loadPluginFeaturesForAgent({ username: 'alice', agentId: 'agent-one', packageKey: 'plugin-flow', versionId: v1.id, selections: selections(['core-skill'], ['safe-bundle'], ['safe-tool']) });
  assert.equal(loaded.outcome, 'direct'); assert.match(loaded.loaded.skills[0], /UNTRUSTED_PLUGIN_SKILL/); assert.deepEqual(loaded.loaded.bundles, [{ key: 'safe-bundle', executionAvailable: false }]); assert.deepEqual(loaded.loaded.tools, [{ key: 'safe-tool', executionAvailable: false }]);
  pass('skill-import-load-mcp-inert');

  upsertPluginAccessGrant({ username: 'alice', agentId: 'request-agent', scope: { packageKey: 'plugin-flow', versionId: v1.id }, mode: 'request', exclusions: selections(), actor: 'alice' });
  const requested = loadPluginFeaturesForAgent({ username: 'alice', agentId: 'request-agent', packageKey: 'plugin-flow', versionId: v1.id, selections: selections(['core-skill']) });
  assert.equal(requested.outcome, 'request_created');
  pass('request-mode-creates-request');

  loaded = loadPluginFeaturesForAgent({ username: 'alice', agentId: 'agent-one', packageKey: 'plugin-flow', versionId: v1.id, selections: selections(['core-skill'], [], ['new-tool']) });
  assert.equal(loaded.outcome, 'direct_and_request_created'); assert.equal(loaded.loaded.skills.length, 1);
  const request = listPluginAccessRequests({ username: 'alice', agentId: 'agent-one', scope: { packageKey: 'plugin-flow', versionId: v1.id }, status: 'pending' })[0];
  decidePluginAccessRequest({ username: 'alice', requestId: request.id, status: 'approved', decisionActor: 'alice' });
  upsertPluginAccessGrant({ username: 'alice', agentId: 'agent-one', scope: { packageKey: 'plugin-flow', versionId: v1.id }, mode: 'direct', approvedFeatures: selections(['core-skill'], ['safe-bundle'], ['safe-tool', 'new-tool']), exclusions: selections(), actor: 'alice' });
  assert.equal(loadPluginFeaturesForAgent({ username: 'alice', agentId: 'agent-one', packageKey: 'plugin-flow', versionId: v1.id, selections: selections([], [], ['new-tool']) }).outcome, 'direct');
  pass('direct-load-request-decision-expansion');

  upsertPluginAccessGrant({ username: 'alice', agentId: 'agent-one', scope: { packageKey: 'plugin-flow', versionId: v1.id }, mode: 'direct', approvedFeatures: selections(['core-skill'], ['safe-bundle'], ['safe-tool', 'new-tool']), exclusions: selections([], [], ['safe-tool']), actor: 'alice' });
  assert.deepEqual(loadPluginFeaturesForAgent({ username: 'alice', agentId: 'agent-one', packageKey: 'plugin-flow', versionId: v1.id, selections: selections([], [], ['safe-tool']) }).loaded, selections());
  assert.equal(loadPluginFeaturesForAgent({ username: 'alice', agentId: 'agent-one', packageKey: 'plugin-flow', versionId: v1.id, selections: selections() }).outcome, 'noop');
  assert.equal(loadPluginFeaturesForAgent({ username: 'alice', agentId: 'none', packageKey: 'plugin-flow', versionId: v1.id, selections: selections(['core-skill']) }).outcome, 'unavailable');
  assert.equal(getPluginCatalogEntryForAgent({ username: 'bob', agentId: 'agent-one', packageKey: 'plugin-flow', versionId: v1.id }).access, 'unavailable');
  pass('exclusions-noop-unavailable-owner-isolation');

  const v2 = stagePromptPackageVersion({ package: packageData, version: { version: '2.0.0', sourceCommit: 'c'.repeat(40), sourceRef: 'main', manifest, validation: { valid: true } }, artifacts: [] }).version;
  activatePromptPackageVersion({ packageKey: 'plugin-flow', versionId: v2.id, actor: 'alice' });
  const catalog = listPluginCatalogForAgent({ username: 'alice', agentId: 'agent-one' });
  assert.ok(catalog.some((item) => item.version.id === v1.id && item.access === 'direct'));
  pass('old-exact-grant-cataloged');

  const events = listPluginAccessEvents({ username: 'alice', scope: { packageKey: 'plugin-flow', versionId: v1.id } }).map((event) => event.event);
  for (const event of ['grant_created', 'request_created', 'request_approved', 'plugin_feature_loaded', 'plugin_feature_inert', 'plugin_feature_excluded']) assert.ok(events.includes(event), event);
  pass('audit-events');

  let blockedCalls = 0;
  await assert.rejects(() => materializePinnedGithubPromptPackage({ descriptor: { ...descriptor, sourcePin: { ...sourcePin, commit: 'UPPERCASE' } }, package: packageData, version: versionData, fetchImpl: async () => { blockedCalls += 1; } }));
  await assert.rejects(() => syncPinnedGithubPromptPackageManually({ descriptor: { ...descriptor, sourcePin: { ...sourcePin, commit: 'd'.repeat(40) } }, package: packageData, version: versionData, fetchImpl: async () => { blockedCalls += 1; }, documentKey: 'plugin-flow-doc', artifactMappings: mappings }));
  assert.equal(blockedCalls, 0);
  pass('invalid-source-mismatch-fail-closed');

  const accessPin = { provider: 'github', repository: 'acme/private-plugin', ref: 'main', commit: 'e'.repeat(40) };
  const accessRequest = createGithubPrivateAccessRequest({ ownerUsername: 'alice', sourcePin: accessPin, purpose: 'read_only', requestedBy: 'alice', requestedAt: 100 });
  assert.equal(accessRequest.status, 'pending');
  assert.equal(listGithubPrivateAccessRequests({ ownerUsername: 'alice' }).length, 1);
  assert.equal(listGithubPrivateAccessRequests({ ownerUsername: 'bob' }).length, 0);
  assert.equal(getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: 'alice', sourcePin: accessPin, purpose: 'read_only', at: 101 }), null);
  const pendingTokenName = 'ZERO_GREEN_GITHUB_READ_TOKEN';
  const hadPendingToken = Object.hasOwn(process.env, pendingTokenName);
  const originalPendingToken = process.env[pendingTokenName];
  const restorePendingToken = () => {
    if (hadPendingToken) process.env[pendingTokenName] = originalPendingToken;
    else delete process.env[pendingTokenName];
  };
  try {
    delete process.env[pendingTokenName];
    assert.throws(() => createGithubPrivateReadFetch({ ownerUsername: 'alice', sourcePin: accessPin, at: 101 }), (error) => error.code === 'ACCESS_DENIED');

    const sentinel = 'github-token-sentinel-never-leak';
    process.env[pendingTokenName] = sentinel;
    assert.throws(() => createGithubPrivateReadFetch({ ownerUsername: 'alice', sourcePin: accessPin, at: 101 }), (error) => error.code === 'ACCESS_DENIED' && !String(error.message).includes(sentinel));
  } finally {
    restorePendingToken();
  }
  pass('github-private-access-provider-token-missing-pending-denied');

  const approvedAccess = decideGithubPrivateAccessRequest({ ownerUsername: 'alice', requestId: accessRequest.id, status: 'approved', decidedBy: 'alice', decidedAt: 110, expiresAt: 4102444800 });
  assert.equal(approvedAccess.status, 'approved');
  assert.equal(getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: 'alice', sourcePin: accessPin, purpose: 'read_only', at: 199 }).id, accessRequest.id);
  const tokenName = 'ZERO_GREEN_GITHUB_READ_TOKEN';
  const hadToken = Object.hasOwn(process.env, tokenName);
  const originalToken = process.env[tokenName];
  const restoreToken = () => {
    if (hadToken) process.env[tokenName] = originalToken;
    else delete process.env[tokenName];
  };
  try {
    const sentinel = 'github-token-sentinel-never-leak';
    process.env[tokenName] = sentinel;
    const calls = [];
    const privateFetch = createGithubPrivateReadFetch({ ownerUsername: 'alice', sourcePin: accessPin, at: 199, fetchImpl: async (request) => { calls.push(request); return { ok: true }; } });
    await assert.rejects(() => privateFetch('https://example.test/repos/acme/private-plugin/contents/x'), (error) => error.code === 'URL_NOT_ALLOWED');
    await assert.rejects(() => privateFetch(`https://api.github.com/repos/acme/private-plugin/contents/x`, { method: 'POST' }), (error) => error.code === 'METHOD_NOT_ALLOWED');
    const original = new Request(`https://api.github.com/repos/acme/private-plugin/contents/x`, { headers: { Authorization: 'Bearer attacker', 'X-Test': 'kept' }, redirect: 'manual', signal: AbortSignal.timeout(1_000) });
    await privateFetch(original);
    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof Request);
    assert.equal(calls[0].method, 'GET'); assert.equal(calls[0].redirect, 'manual'); assert.equal(calls[0].headers.get('X-Test'), 'kept'); assert.equal(calls[0].headers.get('Authorization'), `Bearer ${sentinel}`);
    await privateFetch(`https://api.github.com/repos/acme/private-plugin/contents/y`);
    assert.equal(calls[1].redirect, 'manual');
    const authorization = getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: 'alice', sourcePin: accessPin, purpose: 'read_only', at: 199 });
    const audit = listGithubPrivateAccessEvents({ ownerUsername: 'alice', requestId: accessRequest.id });
    assert.equal(JSON.stringify({ authorization, audit }).includes(sentinel), false);
    revokeGithubPrivateAccessApproval({ ownerUsername: 'alice', requestId: accessRequest.id, revokedBy: 'alice', revokedAt: 121 });
    await assert.rejects(() => privateFetch(`https://api.github.com/repos/acme/private-plugin/contents/x`), (error) => error.code === 'ACCESS_DENIED');
  } finally {
    restoreToken();
  }
  pass('github-private-access-provider-approved-read-only-redacted');
  assert.equal(getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: 'bob', sourcePin: accessPin, purpose: 'read_only', at: 199 }), null);
  assert.equal(getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: 'alice', sourcePin: { ...accessPin, commit: 'f'.repeat(40) }, purpose: 'read_only', at: 199 }), null);
  assert.equal(getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: 'alice', sourcePin: accessPin, purpose: 'read_only', at: 4102444800 }), null);
  assert.throws(() => createGithubPrivateAccessRequest({ ownerUsername: 'alice', sourcePin: accessPin, purpose: 'read_only', token: 'forbidden' }), /secret material/);
  assert.deepEqual(listGithubPrivateAccessEvents({ ownerUsername: 'alice', requestId: accessRequest.id }).map((event) => event.event), ['requested', 'approved', 'revoked']);
  pass('github-private-access-decision-pin-expiry-no-secret');
  assert.equal(getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: 'alice', sourcePin: accessPin, purpose: 'read_only', at: 121 }), null);
  pass('github-private-access-revocation');
} finally {
  closeDb();
  if (root) await rm(root, { recursive: true, force: true });
}
