import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
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
