import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { buildPromptPackageImport } from '../services/promptPackageImporter.js';
import { ClaudePluginImportError, discoverClaudePluginsFromSource, importClaudePluginFromSource } from '../services/claudePluginImportService.js';
import { stageImportedPromptPackage } from '../services/promptPackagePersistenceAdapter.js';
import {
  getPromptPackageSyncSource,
  listPromptPackageSyncSources,
  upsertPromptPackageSyncSource,
} from '../services/promptPackageSyncConfigStore.js';
import {
  deletePromptPackageSyncJob,
  getPromptPackageSyncJob,
  listPromptPackageSyncJobs,
  upsertPromptPackageSyncJob,
} from '../services/promptPackageSyncJobStore.js';
import {
  PromptPackageManualSyncError,
  syncPinnedGithubPromptPackageManually,
} from '../services/promptPackageSyncService.js';
import { createGithubPrivateReadFetch } from '../services/githubPrivateAccessProvider.js';
import {
  createGithubPrivateAccessRequest,
  decideGithubPrivateAccessRequest,
  listGithubPrivateAccessEvents,
  listGithubPrivateAccessRequests,
  revokeGithubPrivateAccessApproval,
} from '../services/githubPrivateAccessStore.js';
import {
  activatePromptPackageVersion,
  deactivatePromptPackageVersion,
  getPromptPackageByKey,
  listPromptPackageArtifacts,
  listPromptPackageEvents,
  listPromptPackageVersions,
  listPromptPackages,
  rollbackPromptPackageVersion,
  stagePromptPackageVersion,
} from '../services/promptPackageStore.js';

const router = Router();

function readOptionalFilter(query, name) {
  const value = query[name];
  if (value === undefined) return undefined;

  if (Array.isArray(value) || typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${name} must be a single non-empty string`);
    error.statusCode = 400;
    throw error;
  }

  return value;
}

function classifyActivationError(error) {
  const message = error.message;
  if ([
    /^input must be an object$/,
    /^packageKey must be a non-empty string$/,
    /^Exactly one of sourceCommit or versionId must be provided$/,
    /^(?:sourceCommit|versionId|actor) must be a non-empty string$/,
    /^details must be a JSON-serializable object(?:$|: )/,
  ].some((pattern) => pattern.test(message))) return 400;
  if (/^Prompt package not found: /.test(message) || /^Prompt package version not found/.test(message)) return 404;
  if ([
    /^Package .+ has multiple active versions$/,
    /^Package .+ must be active for an active-version no-op; current status is /,
    /^Active version consistency error for package /,
    /^Activation event is missing for version /,
    /^Multiple activation events found for version /,
    /^Version .+ must be staged to activate; current status is /,
    /^Staged package .+ has an active version$/,
    /^Active package .+ must have exactly one active version$/,
    /^Package .+ cannot activate a staged version; current status is /,
    /^Activation event inconsistency for staged version /,
  ].some((pattern) => pattern.test(message))) return 409;
  return 500;
}

function classifyRollbackError(error) {
  const message = error.message;
  if ([
    /^input must be an object$/,
    /^packageKey must be a non-empty string$/,
    /^Exactly one of targetVersionId or targetSourceCommit must be provided$/,
    /^(?:targetVersionId|targetSourceCommit|actor) must be a non-empty string$/,
    /^details must be a JSON-serializable object(?:$|: )/,
    /^details\.operation must be "rollback" when provided$/,
  ].some((pattern) => pattern.test(message))) return 400;
  if (/^Prompt package not found: /.test(message) || /^Prompt package version not found/.test(message)) return 404;
  if ([
    /^Package .+ must be active to roll back; current status is /,
    /^Active package .+ must have exactly one active version; found /,
    /^Rollback inconsistency for package .+: expected zero package_disabled events, found /,
    /^Active version consistency error for package /,
    /^Rollback idempotency inconsistency for version /,
    /^Version .+ must be superseded to roll back; current status is /,
    /^Rollback inconsistency for version .+: expected exactly one origin activation event, found /,
    /^Rollback inconsistency for version .+: origin activation event is already a rollback$/,
    /^Activation event inconsistency for version .+: event .+ details must be an object$/,
  ].some((pattern) => pattern.test(message))) return 409;
  return 500;
}

function classifyDeactivationError(error) {
  const message = error.message;
  if ([
    /^input must be an object$/,
    /^packageKey must be a non-empty string$/,
    /^Exactly one of sourceCommit or versionId must be provided$/,
    /^(?:sourceCommit|versionId|actor) must be a non-empty string$/,
    /^details must be a JSON-serializable object(?:$|: )/,
  ].some((pattern) => pattern.test(message))) return 400;
  if (/^Prompt package not found: /.test(message) || /^Prompt package version not found/.test(message)) return 404;
  if ([
    /^Disabled package .+ has active versions$/,
    /^Disabled package .+ requires the selected version to be disabled; current status is /,
    /^Disable event inconsistency for disabled package /,
    /^Package .+ must be active to deactivate; current status is /,
    /^Package .+ has multiple active versions$/,
    /^Active package .+ must have exactly one active version$/,
    /^Selected version .+ is not the active version for package /,
    /^Disable event inconsistency for active package /,
  ].some((pattern) => pattern.test(message))) return 409;
  return 500;
}

const IMPORT_BODY_KEYS = new Set([
  'package',
  'version',
  'files',
  'references',
  'documentKey',
  'artifactMappings',
  'details',
]);

function validateImportBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    const error = new Error('request body must be an object');
    error.statusCode = 400;
    throw error;
  }

  for (const key of Object.keys(body)) {
    if (!IMPORT_BODY_KEYS.has(key)) {
      const error = new Error(`unsupported request body field: ${key}`);
      error.statusCode = 400;
      throw error;
    }
  }
}

function classifyImportError(error) {
  if (error.statusCode === 400
    || error.name === 'PromptPackageManifestError'
    || /^Invalid prompt package import: /.test(error.message)
    || /^Invalid imported prompt package: /.test(error.message)) return 400;
  if (/^Imported prompt package conflict: /.test(error.message)) return 409;
  return 500;
}

const SYNC_SOURCE_BODY_KEYS = new Set(['source', 'enabled', 'metadata']);
const MANUAL_SYNC_BODY_KEYS = new Set([
  'descriptor',
  'package',
  'version',
  'documentKey',
  'artifactMappings',
  'timeoutMs',
  'references',
  'details',
]);
const MANUAL_SYNC_REQUIRED_BODY_KEYS = [
  'descriptor',
  'package',
  'version',
  'documentKey',
  'artifactMappings',
];
const MAX_SYNC_SOURCE_ERROR_LENGTH = 512;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function manualSyncRequestError() {
  const error = new Error('invalid manual prompt package sync request');
  error.statusCode = 400;
  return error;
}

function validateManualSyncBody(body) {
  if (!isPlainObject(body)) throw manualSyncRequestError();
  const keys = Reflect.ownKeys(body);
  if (keys.some((key) => typeof key !== 'string' || !MANUAL_SYNC_BODY_KEYS.has(key))) {
    throw manualSyncRequestError();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(body, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw manualSyncRequestError();
  }
  if (!MANUAL_SYNC_REQUIRED_BODY_KEYS.every((key) => Object.hasOwn(body, key))) {
    throw manualSyncRequestError();
  }
}

function projectManualSyncResult(result) {
  return {
    materialized: {
      sourcePin: result.materialized.sourcePin,
      package: result.materialized.package,
      version: result.materialized.version,
      files: result.materialized.files,
      references: result.materialized.references,
    },
    staged: {
      package: result.staged.package,
      version: result.staged.version,
      artifacts: result.staged.artifacts,
      blocks: result.staged.blocks,
      refs: result.staged.refs,
      event: result.staged.event,
      changed: result.staged.changed,
    },
    checkpoint: result.checkpoint,
  };
}

function classifyManualSyncError(error) {
  if (error?.statusCode === 400) return 400;
  if (!(error instanceof PromptPackageManualSyncError)) return 500;
  if (error.code === 'SOURCE_NOT_CONFIGURED') return 404;
  if (error.code === 'SOURCE_DISABLED' || error.code === 'SOURCE_MISMATCH' || error.code === 'STAGING_FAILED') return 409;
  if (error.code === 'MATERIALIZATION_FAILED') return 422;
  return 500;
}

const SYNC_JOB_BODY_KEYS = new Set([
  'enabled',
  'intervalSeconds',
  'descriptor',
  'package',
  'version',
  'documentKey',
  'artifactMappings',
  'references',
  'details',
]);
const SYNC_JOB_REQUIRED_BODY_KEYS = [
  'descriptor',
  'package',
  'version',
  'documentKey',
  'artifactMappings',
];

function syncJobRequestError() {
  const error = new Error('invalid prompt package sync job request');
  error.statusCode = 400;
  return error;
}

function validateSyncJobBody(body) {
  if (!isPlainObject(body)) throw syncJobRequestError();
  const keys = Reflect.ownKeys(body);
  if (keys.some((key) => typeof key !== 'string' || !SYNC_JOB_BODY_KEYS.has(key))) {
    throw syncJobRequestError();
  }
  const values = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(body, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw syncJobRequestError();
    }
    values[key] = descriptor.value;
  }
  if (!SYNC_JOB_REQUIRED_BODY_KEYS.every((key) => Object.hasOwn(values, key))) {
    throw syncJobRequestError();
  }
  return values;
}

function projectSyncJob(job) {
  return {
    sourceKey: job.sourceKey,
    enabled: job.enabled,
    intervalSeconds: job.intervalSeconds,
    descriptor: job.descriptor,
    package: job.package,
    version: job.version,
    documentKey: job.documentKey,
    artifactMappings: job.artifactMappings,
    references: job.references,
    details: job.details,
    createdBy: job.createdBy,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function isExpectedSyncJobError(error) {
  return /^Invalid prompt package sync job: /.test(error?.message || '');
}

function syncJobErrorStatus(error) {
  if (error?.statusCode === 400) return 400;
  if (!isExpectedSyncJobError(error)) return 500;
  return /sourceKey does not exist/.test(error.message) ? 404 : 400;
}

function validateSyncSourceBody(body) {
  if (!isPlainObject(body)) {
    const error = new Error('request body must be a plain object');
    error.statusCode = 400;
    throw error;
  }
  for (const key of Object.keys(body)) {
    if (!SYNC_SOURCE_BODY_KEYS.has(key)) {
      const error = new Error(`unsupported request body field: ${key}`);
      error.statusCode = 400;
      throw error;
    }
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'source')) {
    const error = new Error('source is required');
    error.statusCode = 400;
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'enabled') && typeof body.enabled !== 'boolean') {
    const error = new Error('enabled must be a boolean');
    error.statusCode = 400;
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'metadata') && !isPlainObject(body.metadata)) {
    const error = new Error('metadata must be a plain object');
    error.statusCode = 400;
    throw error;
  }
}

function projectSyncSource(source) {
  return {
    sourceKey: source.sourceKey,
    provider: source.provider,
    repository: source.repository,
    sourceRef: source.sourceRef,
    enabled: source.enabled,
    lastSeenCommit: source.lastSeenCommit,
    lastStagedCommit: source.lastStagedCommit,
    lastSyncAt: source.lastSyncAt,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
}

function isExpectedSyncSourceError(error) {
  return error.statusCode === 400
    || error.name === 'PromptPackageSourcePolicyError'
    || /^Invalid prompt package sync source: /.test(error.message);
}

function boundedErrorMessage(error) {
  return String(error.message || 'invalid prompt package sync source').slice(0, MAX_SYNC_SOURCE_ERROR_LENGTH);
}

function isExpectedStageError(error) {
  return [
    /^package must be a JSON-serializable object(?:$|: )/,
    /^version must be a JSON-serializable object(?:$|: )/,
    /^version\.validation must be a JSON-serializable object(?:$|: )/,
    /^version\.validation\.valid must be true$/,
    /^artifacts must be an array$/,
    /^artifacts\[\d+\](?:\.(?:type|artifactKey|sourcePath|contentHash|promptBlockId|promptBlockVersionId|metadata))? must be /,
    /^Duplicate artifact: /,
    /^event must be a JSON-serializable object(?:$|: )/,
    /^event\.(?:event|actor|details) must be /,
    /^package\.(?:packageKey|source|repository|metadata) must be /,
    /^version\.(?:version|sourceCommit|sourceRef|manifest) must be /,
    /^Package .+ conflicts with its existing source or repository$/,
    /^Staged version conflict for /,
    /^Staging event is missing for version /,
    /^Prompt block(?: version)? not found: /,
  ].some((pattern) => pattern.test(error.message));
}

function githubPrivateAccessOwner(req) {
  // Private-source authorization must never use the request-fallback identity.
  // attachUserContext sets req.session only after a verified session token.
  const username = req.session && req.user?.isActive !== false ? req.user?.username : null;
  if (typeof username !== 'string' || !username) {
    const error = new Error('authentication required');
    error.statusCode = 401;
    throw error;
  }
  return username;
}

function githubPrivateAccessOperator(req) {
  const username = githubPrivateAccessOwner(req);
  // This authorization controls a runtime corporate credential. Its decision is
  // intentionally reserved to the trusted operator, not to request fallback or
  // a merely authenticated arbitrary account.
  if (username !== 'ettore' || req.user?.role !== 'admin') {
    const error = new Error('operator authorization required');
    error.statusCode = 403;
    throw error;
  }
  return username;
}

function githubPrivateAccessRequestBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !['source', 'purpose'].includes(key))
    || !Object.hasOwn(body, 'source') || !Object.hasOwn(body, 'purpose')) {
    const error = new Error('invalid GitHub private access request');
    error.statusCode = 400;
    throw error;
  }
  return body;
}

function githubPrivateAccessDecisionBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !['status', 'expiresAt'].includes(key))
    || !Object.hasOwn(body, 'status')) {
    const error = new Error('invalid GitHub private access decision');
    error.statusCode = 400;
    throw error;
  }
  return body;
}

function githubPrivateAccessRevokeBody(body) {
  if (!isPlainObject(body) || Object.keys(body).length !== 0) {
    const error = new Error('invalid GitHub private access revocation');
    error.statusCode = 400;
    throw error;
  }
}

function githubPrivateAccessError(res, error) {
  const status = [401, 403].includes(error?.statusCode) ? error.statusCode : 400;
  return res.status(status).json({ error: status === 401 ? 'authentication required' : status === 403 ? 'operator authorization required' : 'GitHub private access request rejected' });
}

router.post('/settings/github-private-access-requests', checkLocalAccess, (req, res) => {
  try {
    const ownerUsername = githubPrivateAccessOwner(req);
    const body = githubPrivateAccessRequestBody(req.body);
    return res.status(201).json({ request: createGithubPrivateAccessRequest({ ownerUsername, source: body.source, purpose: body.purpose, requestedBy: ownerUsername }) });
  } catch (error) { return githubPrivateAccessError(res, error); }
});
router.get('/settings/github-private-access-requests', checkLocalAccess, (req, res) => {
  try { return res.json({ requests: listGithubPrivateAccessRequests({ ownerUsername: githubPrivateAccessOwner(req) }) }); } catch (error) { return githubPrivateAccessError(res, error); }
});
router.post('/settings/github-private-access-requests/:requestId/decision', checkLocalAccess, (req, res) => {
  try {
    const ownerUsername = githubPrivateAccessOperator(req); const body = githubPrivateAccessDecisionBody(req.body);
    return res.json({ request: decideGithubPrivateAccessRequest({ ownerUsername, requestId: req.params.requestId, status: body.status, ...(Object.hasOwn(body, 'expiresAt') ? { expiresAt: body.expiresAt } : {}), decidedBy: ownerUsername }) });
  } catch (error) { return githubPrivateAccessError(res, error); }
});
router.post('/settings/github-private-access-requests/:requestId/revoke', checkLocalAccess, (req, res) => {
  try { githubPrivateAccessRevokeBody(req.body); const ownerUsername = githubPrivateAccessOperator(req); return res.json({ request: revokeGithubPrivateAccessApproval({ ownerUsername, requestId: req.params.requestId, revokedBy: ownerUsername }) }); } catch (error) { return githubPrivateAccessError(res, error); }
});
router.get('/settings/github-private-access-requests/events', checkLocalAccess, (req, res) => {
  try {
    const ownerUsername = githubPrivateAccessOwner(req);
    if (Object.keys(req.query).some((key) => key !== 'requestId')) throw Object.assign(new Error('invalid events filter'), { statusCode: 400 });
    const requestId = typeof req.query.requestId === 'string' ? req.query.requestId : undefined;
    if (Array.isArray(req.query.requestId)) throw Object.assign(new Error('invalid events filter'), { statusCode: 400 });
    return res.json({ events: listGithubPrivateAccessEvents({ ownerUsername, ...(requestId ? { requestId } : {}) }) });
  } catch (error) { return githubPrivateAccessError(res, error); }
});
router.get('/settings/github-private-access-requests/:requestId/events', checkLocalAccess, (req, res) => {
  try { return res.json({ events: listGithubPrivateAccessEvents({ ownerUsername: githubPrivateAccessOwner(req), requestId: req.params.requestId }) }); } catch (error) { return githubPrivateAccessError(res, error); }
});

function claudePluginStatus(error) {
  if (!(error instanceof ClaudePluginImportError)) return 500;
  if (['SOURCE_NOT_CONFIGURED', 'DESCRIPTOR_NOT_FOUND'].includes(error.code)) return 404;
  if (['SOURCE_DISABLED', 'SOURCE_MISMATCH'].includes(error.code)) return 409;
  if (['REMOTE_FETCH_FAILED'].includes(error.code)) return 422;
  return 400;
}

function sourceForKey(sourceKey) {
  const source = getPromptPackageSyncSource(sourceKey);
  if (!source) throw new ClaudePluginImportError('SOURCE_NOT_CONFIGURED');
  return { provider: 'github', repository: source.repository, ref: source.sourceRef };
}

router.post('/settings/prompt-package-sync-sources/:sourceKey/claude-plugins/discover', checkLocalAccess, async (req, res) => {
  try {
    if (typeof globalThis.fetch !== 'function') return res.status(503).json({ error: 'Claude plugin discovery is unavailable' });
    const ownerUsername = githubPrivateAccessOwner(req);
    const source = sourceForKey(req.params.sourceKey);
    const result = await discoverClaudePluginsFromSource({ sourceKey: req.params.sourceKey, fetchImpl: createGithubPrivateReadFetch({ ownerUsername, source, fetchImpl: globalThis.fetch }) });
    return res.status(200).json(result);
  } catch (error) {
    const status = error?.statusCode === 401 ? 401 : claudePluginStatus(error);
    return res.status(status).json({ error: status === 401 ? 'authentication required' : status === 500 ? 'unable to discover Claude plugins' : 'Claude plugin discovery rejected' });
  }
});

router.post('/settings/prompt-package-sync-sources/:sourceKey/claude-plugins/import', checkLocalAccess, async (req, res) => {
  try {
    if (!isPlainObject(req.body) || Object.keys(req.body).some((key) => !['pluginRoot', 'documentKey'].includes(key))) return res.status(400).json({ error: 'invalid Claude plugin import request' });
    if (typeof globalThis.fetch !== 'function') return res.status(503).json({ error: 'Claude plugin import is unavailable' });
    const ownerUsername = githubPrivateAccessOwner(req);
    const source = sourceForKey(req.params.sourceKey);
    const result = await importClaudePluginFromSource({ sourceKey: req.params.sourceKey, pluginRoot: req.body.pluginRoot, documentKey: req.body.documentKey, actor: ownerUsername, fetchImpl: createGithubPrivateReadFetch({ ownerUsername, source, fetchImpl: globalThis.fetch }) });
    return res.status(result.changed ? 201 : 200).json({ package: result.package, version: result.version, artifacts: result.artifacts, event: result.event, changed: result.changed, sourceKey: result.sourceKey, resolvedCommit: result.resolvedCommit });
  } catch (error) {
    const status = error?.statusCode === 401 ? 401 : claudePluginStatus(error);
    return res.status(status).json({ error: status === 401 ? 'authentication required' : status === 500 ? 'unable to import Claude plugin' : 'Claude plugin import rejected' });
  }
});

router.post('/settings/prompt-packages/import', checkLocalAccess, (req, res) => {
  try {
    validateImportBody(req.body);
    const importPayload = buildPromptPackageImport({
      package: req.body.package,
      version: req.body.version,
      files: req.body.files,
      references: req.body.references,
    });
    const result = stageImportedPromptPackage({
      importPayload,
      documentKey: req.body.documentKey,
      artifactMappings: req.body.artifactMappings,
      details: req.body.details ?? {},
      actor: req.user?.username || req.username || null,
    });

    return res.status(result.changed ? 201 : 200).json({
      package: result.package,
      version: result.version,
      artifacts: result.artifacts,
      blocks: result.blocks,
      refs: result.refs,
      event: result.event,
      changed: result.changed,
    });
  } catch (err) {
    const status = classifyImportError(err);
    return res.status(status).json({
      error: status === 500 ? 'unable to import prompt package' : err.message,
    });
  }
});

router.post('/settings/prompt-packages/stage', checkLocalAccess, (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'request body must be an object' });
  }

  const actor = req.username || req.user?.username || null;
  const event = req.body.event;
  const payload = {
    ...req.body,
    event: event === undefined ? { actor } : (event && typeof event === 'object' && !Array.isArray(event) ? { ...event, actor } : event),
  };

  try {
    const result = stagePromptPackageVersion(payload);
    return res.status(result.created ? 201 : 200).json({
      package: result.package,
      version: result.version,
      artifacts: result.artifacts,
      event: result.event,
      created: result.created,
    });
  } catch (err) {
    const status = isExpectedStageError(err) ? 400 : 500;
    return res.status(status).json({ error: err.message });
  }
});

router.post('/settings/prompt-packages/:packageKey/activate', checkLocalAccess, (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'request body must be an object' });
  }

  try {
    const result = activatePromptPackageVersion({
      packageKey: req.params.packageKey,
      sourceCommit: req.body.sourceCommit,
      versionId: req.body.versionId,
      details: req.body.details,
      actor: req.user?.username || req.username || null,
    });
    return res.status(200).json({
      package: result.package,
      version: result.version,
      event: result.event,
      changed: result.changed,
      previousVersionId: result.previousVersionId,
    });
  } catch (err) {
    const status = classifyActivationError(err);
    return res.status(status).json({ error: err.message });
  }
});

router.post('/settings/prompt-packages/:packageKey/rollback', checkLocalAccess, (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'request body must be an object' });
  }

  try {
    const result = rollbackPromptPackageVersion({
      packageKey: req.params.packageKey,
      targetVersionId: req.body.targetVersionId,
      targetSourceCommit: req.body.targetSourceCommit,
      details: req.body.details,
      actor: req.user?.username || req.username || null,
    });
    return res.status(200).json({
      package: result.package,
      version: result.version,
      event: result.event,
      changed: result.changed,
      previousVersionId: result.previousVersionId,
    });
  } catch (err) {
    const status = classifyRollbackError(err);
    return res.status(status).json({ error: err.message });
  }
});

router.post('/settings/prompt-packages/:packageKey/deactivate', checkLocalAccess, (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'request body must be an object' });
  }

  try {
    const result = deactivatePromptPackageVersion({
      packageKey: req.params.packageKey,
      sourceCommit: req.body.sourceCommit,
      versionId: req.body.versionId,
      details: req.body.details,
      actor: req.user?.username || req.username || null,
    });
    return res.status(200).json({
      package: result.package,
      version: result.version,
      event: result.event,
      changed: result.changed,
      previousVersionId: result.previousVersionId,
    });
  } catch (err) {
    const status = classifyDeactivationError(err);
    return res.status(status).json({ error: err.message });
  }
});

router.post('/settings/prompt-package-sync/manual', checkLocalAccess, async (req, res) => {
  try {
    validateManualSyncBody(req.body);
    if (typeof globalThis.fetch !== 'function') {
      return res.status(503).json({ error: 'manual prompt package sync is unavailable' });
    }
    const result = await syncPinnedGithubPromptPackageManually({
      descriptor: req.body.descriptor,
      package: req.body.package,
      version: req.body.version,
      documentKey: req.body.documentKey,
      artifactMappings: req.body.artifactMappings,
      fetchImpl: createGithubPrivateReadFetch({
        ownerUsername: githubPrivateAccessOwner(req),
        source: { provider: 'github', repository: req.body.descriptor?.sourcePin?.repository, ref: req.body.descriptor?.sourcePin?.ref },
        fetchImpl: globalThis.fetch,
      }),
      ...(Object.hasOwn(req.body, 'timeoutMs') ? { timeoutMs: req.body.timeoutMs } : {}),
      ...(Object.hasOwn(req.body, 'references') ? { references: req.body.references } : {}),
      ...(Object.hasOwn(req.body, 'details') ? { details: req.body.details } : {}),
      actor: githubPrivateAccessOwner(req),
    });
    return res.status(result.staged.changed ? 201 : 200).json(projectManualSyncResult(result));
  } catch (err) {
    const status = err?.statusCode === 401 ? 401 : classifyManualSyncError(err);
    return res.status(status).json({
      error: status === 400
        ? 'invalid manual prompt package sync request'
        : status === 404
          ? 'manual prompt package sync source not configured'
          : status === 409
            ? 'manual prompt package sync conflict'
            : status === 422
              ? 'manual prompt package sync materialization failed'
              : 'unable to synchronize prompt package',
    });
  }
});

router.get('/settings/prompt-package-sync-jobs', checkLocalAccess, (req, res) => {
  try {
    return res.status(200).json({ jobs: listPromptPackageSyncJobs().map(projectSyncJob) });
  } catch {
    return res.status(500).json({ error: 'unable to read prompt package sync jobs' });
  }
});

router.get('/settings/prompt-package-sync-jobs/:sourceKey', checkLocalAccess, (req, res) => {
  try {
    const job = getPromptPackageSyncJob(req.params.sourceKey);
    if (!job) return res.status(404).json({ error: 'prompt package sync job not found' });
    return res.status(200).json({ job: projectSyncJob(job) });
  } catch (err) {
    const status = syncJobErrorStatus(err);
    return res.status(status).json({ error: status === 400 ? 'invalid prompt package sync job request' : 'unable to read prompt package sync jobs' });
  }
});

router.put('/settings/prompt-package-sync-jobs/:sourceKey', checkLocalAccess, (req, res) => {
  try {
    const body = validateSyncJobBody(req.body);
    const sourceKey = req.params.sourceKey;
    const existing = getPromptPackageSyncJob(sourceKey);
    const job = upsertPromptPackageSyncJob({
      ...body,
      sourceKey,
      createdBy: req.user?.username || req.username || null,
    });
    return res.status(existing ? 200 : 201).json({ job: projectSyncJob(job) });
  } catch (err) {
    const status = syncJobErrorStatus(err);
    return res.status(status).json({
      error: status === 404
        ? 'prompt package sync job source not found'
        : status === 400
          ? 'invalid prompt package sync job request'
          : 'unable to save prompt package sync job',
    });
  }
});

router.delete('/settings/prompt-package-sync-jobs/:sourceKey', checkLocalAccess, (req, res) => {
  try {
    if (!deletePromptPackageSyncJob(req.params.sourceKey)) {
      return res.status(404).json({ error: 'prompt package sync job not found' });
    }
    return res.status(204).end();
  } catch (err) {
    const status = syncJobErrorStatus(err);
    return res.status(status).json({ error: status === 400 ? 'invalid prompt package sync job request' : 'unable to delete prompt package sync job' });
  }
});

router.put('/settings/prompt-package-sync-sources', checkLocalAccess, (req, res) => {
  try {
    validateSyncSourceBody(req.body);
    const source = upsertPromptPackageSyncSource({
      source: req.body.source,
      ...(Object.prototype.hasOwnProperty.call(req.body, 'enabled') ? { enabled: req.body.enabled } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body, 'metadata') ? { metadata: req.body.metadata } : {}),
    });
    return res.status(200).json({ source: projectSyncSource(source) });
  } catch (err) {
    if (isExpectedSyncSourceError(err)) {
      return res.status(400).json({ error: boundedErrorMessage(err) });
    }
    return res.status(500).json({ error: 'unable to save prompt package sync source' });
  }
});

router.get('/settings/prompt-package-sync-sources', checkLocalAccess, (req, res) => {
  try {
    const sources = listPromptPackageSyncSources().map((source) => ({
      sourceKey: source.sourceKey,
      provider: source.provider,
      repository: source.repository,
      sourceRef: source.sourceRef,
        enabled: source.enabled,
      lastSeenCommit: source.lastSeenCommit,
      lastStagedCommit: source.lastStagedCommit,
      lastSyncAt: source.lastSyncAt,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    }));
    return res.status(200).json({ sources });
  } catch {
    return res.status(500).json({ error: 'unable to list prompt package sync sources' });
  }
});

router.get('/settings/prompt-packages', checkLocalAccess, (req, res) => {
  try {
    const filters = {
      status: readOptionalFilter(req.query, 'status'),
      source: readOptionalFilter(req.query, 'source'),
      repository: readOptionalFilter(req.query, 'repository'),
    };
    const packages = listPromptPackages(filters);

    return res.status(200).json({ packages, filters });
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: err.message });
  }
});

router.get('/settings/prompt-packages/:packageKey', checkLocalAccess, (req, res) => {
  try {
    const promptPackage = getPromptPackageByKey(req.params.packageKey);
    if (!promptPackage) {
      return res.status(404).json({ error: 'prompt package not found' });
    }

    const versions = listPromptPackageVersions(promptPackage.id);
    const artifacts = versions.flatMap((version) => listPromptPackageArtifacts(version.id));
    const events = listPromptPackageEvents(promptPackage.id);

    return res.status(200).json({ package: promptPackage, versions, artifacts, events });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
