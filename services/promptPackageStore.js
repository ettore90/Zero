import { getDb, generateId } from '../db.js';

function parseJson(value, column, table, recordId) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in ${table}.${column} for record ${recordId}: ${error.message}`);
  }
}

function toPromptPackage(row) {
  if (!row) return null;
  return {
    id: row.id,
    packageKey: row.package_key,
    source: row.source,
    repository: row.repository,
    status: row.status,
    metadata: parseJson(row.metadata, 'metadata', 'prompt_packages', row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPromptPackageVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    packageId: row.package_id,
    version: row.version,
    sourceCommit: row.source_commit,
    sourceRef: row.source_ref,
    manifest: parseJson(row.manifest, 'manifest', 'prompt_package_versions', row.id),
    validation: parseJson(row.validation, 'validation', 'prompt_package_versions', row.id),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPromptPackageArtifact(row) {
  if (!row) return null;
  return {
    id: row.id,
    packageVersionId: row.package_version_id,
    type: row.type,
    artifactKey: row.artifact_key,
    sourcePath: row.source_path,
    contentHash: row.content_hash,
    promptBlockId: row.prompt_block_id,
    promptBlockVersionId: row.prompt_block_version_id,
    metadata: parseJson(row.metadata, 'metadata', 'prompt_package_artifacts', row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPromptPackageEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    packageId: row.package_id,
    packageVersionId: row.package_version_id,
    event: row.event,
    actor: row.actor,
    details: parseJson(row.details, 'details', 'prompt_package_events', row.id),
    createdAt: row.created_at,
  };
}

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string or null`);
  return value;
}

function jsonObject(value, field, defaultValue) {
  const object = value === undefined ? defaultValue : value;
  if (object === null || Array.isArray(object) || typeof object !== 'object') {
    throw new Error(`${field} must be a JSON-serializable object`);
  }
  try {
    const serialized = JSON.stringify(object);
    const parsed = serialized === undefined ? null : JSON.parse(serialized);
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('not an object');
    }
  } catch (error) {
    throw new Error(`${field} must be a JSON-serializable object: ${error.message}`);
  }
  return object;
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function compareArtifactOrder(a, b) {
  for (const field of ['type', 'artifactKey', 'id']) {
    const left = a[field];
    const right = b[field];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

function normalizeStageInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be an object');
  const packageInput = jsonObject(input.package, 'package');
  const versionInput = jsonObject(input.version, 'version');
  const validation = jsonObject(versionInput.validation, 'version.validation');
  if (validation.valid !== true) throw new Error('version.validation.valid must be true');
  if (input.artifacts !== undefined && !Array.isArray(input.artifacts)) throw new Error('artifacts must be an array');
  const artifacts = (input.artifacts || []).map((artifact, index) => {
    const item = jsonObject(artifact, `artifacts[${index}]`);
    return {
      type: nonEmptyString(item.type, `artifacts[${index}].type`),
      artifactKey: nonEmptyString(item.artifactKey, `artifacts[${index}].artifactKey`),
      sourcePath: optionalString(item.sourcePath, `artifacts[${index}].sourcePath`),
      contentHash: optionalString(item.contentHash, `artifacts[${index}].contentHash`),
      promptBlockId: optionalString(item.promptBlockId, `artifacts[${index}].promptBlockId`),
      promptBlockVersionId: optionalString(item.promptBlockVersionId, `artifacts[${index}].promptBlockVersionId`),
      metadata: jsonObject(item.metadata, `artifacts[${index}].metadata`, {}),
    };
  });
  const keys = new Set();
  for (const artifact of artifacts) {
    const key = `${artifact.type}\u0000${artifact.artifactKey}`;
    if (keys.has(key)) throw new Error(`Duplicate artifact: (${artifact.type}, ${artifact.artifactKey})`);
    keys.add(key);
  }
  const eventInput = input.event === undefined ? {} : jsonObject(input.event, 'event');
  return {
    package: {
      packageKey: nonEmptyString(packageInput.packageKey, 'package.packageKey'),
      source: nonEmptyString(packageInput.source, 'package.source'),
      repository: nonEmptyString(packageInput.repository, 'package.repository'),
      metadata: jsonObject(packageInput.metadata, 'package.metadata', {}),
    },
    version: {
      version: nonEmptyString(versionInput.version, 'version.version'),
      sourceCommit: nonEmptyString(versionInput.sourceCommit, 'version.sourceCommit'),
      sourceRef: optionalString(versionInput.sourceRef, 'version.sourceRef'),
      manifest: jsonObject(versionInput.manifest, 'version.manifest', {}),
      validation,
    },
    artifacts,
    event: {
      event: eventInput.event === undefined ? 'package_version_staged' : nonEmptyString(eventInput.event, 'event.event'),
      actor: optionalString(eventInput.actor, 'event.actor'),
      details: jsonObject(eventInput.details, 'event.details', {}),
    },
  };
}

/** Stages one already-validated package version locally, atomically and idempotently. */
export function stagePromptPackageVersion(input) {
  const staged = normalizeStageInput(input);
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  return db.transaction(() => {
    let packageRow = db.prepare('SELECT * FROM prompt_packages WHERE package_key = ? LIMIT 1').get(staged.package.packageKey);
    if (packageRow && (packageRow.source !== staged.package.source || packageRow.repository !== staged.package.repository)) {
      throw new Error(`Package ${staged.package.packageKey} conflicts with its existing source or repository`);
    }
    if (!packageRow) {
      const id = generateId('prompt_package');
      db.prepare('INSERT INTO prompt_packages (id, package_key, source, repository, status, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, staged.package.packageKey, staged.package.source, staged.package.repository, 'staged', JSON.stringify(staged.package.metadata), now, now);
      packageRow = db.prepare('SELECT * FROM prompt_packages WHERE id = ?').get(id);
    }

    let versionRow = db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND source_commit = ? LIMIT 1')
      .get(packageRow.id, staged.version.sourceCommit);
    if (versionRow) {
      const sameVersion = versionRow.version === staged.version.version
        && versionRow.source_ref === staged.version.sourceRef
        && canonicalJson(parseJson(versionRow.manifest, 'manifest', 'prompt_package_versions', versionRow.id)) === canonicalJson(staged.version.manifest)
        && canonicalJson(parseJson(versionRow.validation, 'validation', 'prompt_package_versions', versionRow.id)) === canonicalJson(staged.version.validation);
      const existingArtifacts = db.prepare('SELECT * FROM prompt_package_artifacts WHERE package_version_id = ? ORDER BY type, artifact_key, id').all(versionRow.id).map(toPromptPackageArtifact);
      const sameArtifacts = existingArtifacts.length === staged.artifacts.length && canonicalJson(existingArtifacts.map(({ type, artifactKey, sourcePath, contentHash, promptBlockId, promptBlockVersionId, metadata }) => ({ type, artifactKey, sourcePath, contentHash, promptBlockId, promptBlockVersionId, metadata })))
        === canonicalJson([...staged.artifacts].sort(compareArtifactOrder));
      if (!sameVersion || !sameArtifacts) throw new Error(`Staged version conflict for ${staged.package.packageKey}@${staged.version.sourceCommit}`);
      const eventRow = db.prepare('SELECT * FROM prompt_package_events WHERE package_id = ? AND package_version_id = ? AND event = ? ORDER BY created_at ASC, id ASC LIMIT 1')
        .get(packageRow.id, versionRow.id, staged.event.event);
      if (!eventRow) throw new Error(`Staging event is missing for version ${versionRow.id}`);
      return { package: toPromptPackage(packageRow), version: toPromptPackageVersion(versionRow), artifacts: existingArtifacts, event: toPromptPackageEvent(eventRow), created: false };
    }

    for (const artifact of staged.artifacts) {
      if (artifact.promptBlockId && !db.prepare('SELECT 1 FROM prompt_blocks WHERE id = ?').get(artifact.promptBlockId)) throw new Error(`Prompt block not found: ${artifact.promptBlockId}`);
      if (artifact.promptBlockVersionId && !db.prepare('SELECT 1 FROM prompt_block_versions WHERE id = ?').get(artifact.promptBlockVersionId)) throw new Error(`Prompt block version not found: ${artifact.promptBlockVersionId}`);
    }
    const versionId = generateId('prompt_package_version');
    db.prepare('INSERT INTO prompt_package_versions (id, package_id, version, source_commit, source_ref, manifest, validation, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(versionId, packageRow.id, staged.version.version, staged.version.sourceCommit, staged.version.sourceRef, JSON.stringify(staged.version.manifest), JSON.stringify(staged.version.validation), 'staged', now, now);
    for (const artifact of staged.artifacts) {
      db.prepare('INSERT INTO prompt_package_artifacts (id, package_version_id, type, artifact_key, source_path, content_hash, prompt_block_id, prompt_block_version_id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(generateId('prompt_package_artifact'), versionId, artifact.type, artifact.artifactKey, artifact.sourcePath, artifact.contentHash, artifact.promptBlockId, artifact.promptBlockVersionId, JSON.stringify(artifact.metadata), now, now);
    }
    const eventId = generateId('prompt_package_event');
    const details = { ...staged.event.details };
    if (!Object.hasOwn(details, 'packageKey')) details.packageKey = staged.package.packageKey;
    if (!Object.hasOwn(details, 'sourceCommit')) details.sourceCommit = staged.version.sourceCommit;
    if (!Object.hasOwn(details, 'version')) details.version = staged.version.version;
    db.prepare('INSERT INTO prompt_package_events (id, package_id, package_version_id, event, actor, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(eventId, packageRow.id, versionId, staged.event.event, staged.event.actor, JSON.stringify(details), now);
    versionRow = db.prepare('SELECT * FROM prompt_package_versions WHERE id = ?').get(versionId);
    const artifactRows = db.prepare('SELECT * FROM prompt_package_artifacts WHERE package_version_id = ? ORDER BY type ASC, artifact_key ASC, id ASC').all(versionId).map(toPromptPackageArtifact);
    const eventRow = db.prepare('SELECT * FROM prompt_package_events WHERE id = ?').get(eventId);
    return { package: toPromptPackage(packageRow), version: toPromptPackageVersion(versionRow), artifacts: artifactRows, event: toPromptPackageEvent(eventRow), created: true };
  })();
}

/** Activates one staged package version locally, atomically and idempotently. */
export function activatePromptPackageVersion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be an object');

  const packageKey = nonEmptyString(input.packageKey, 'packageKey');
  const hasSourceCommit = input.sourceCommit !== undefined;
  const hasVersionId = input.versionId !== undefined;
  if (hasSourceCommit === hasVersionId) throw new Error('Exactly one of sourceCommit or versionId must be provided');
  const sourceCommit = hasSourceCommit ? nonEmptyString(input.sourceCommit, 'sourceCommit') : null;
  const versionId = hasVersionId ? nonEmptyString(input.versionId, 'versionId') : null;
  let actor = null;
  if (input.actor !== undefined && input.actor !== null) actor = nonEmptyString(input.actor, 'actor');
  const details = jsonObject(input.details, 'details', {});
  let serializedDetails;
  try {
    serializedDetails = JSON.stringify(details);
  } catch (error) {
    throw new Error(`details must be a JSON-serializable object: ${error.message}`);
  }
  try {
    const parsedDetails = serializedDetails === undefined ? null : JSON.parse(serializedDetails);
    if (parsedDetails === null || Array.isArray(parsedDetails) || typeof parsedDetails !== 'object') {
      throw new Error('not an object');
    }
  } catch (error) {
    throw new Error(`details must be a JSON-serializable object: ${error.message}`);
  }
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  return db.transaction(() => {
    const packageRow = db.prepare('SELECT * FROM prompt_packages WHERE package_key = ? LIMIT 1').get(packageKey);
    if (!packageRow) throw new Error(`Prompt package not found: ${packageKey}`);

    const targetRow = sourceCommit
      ? db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND source_commit = ? LIMIT 1').get(packageRow.id, sourceCommit)
      : db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND id = ? LIMIT 1').get(packageRow.id, versionId);
    if (!targetRow) {
      throw new Error(`Prompt package version not found for package ${packageKey}${sourceCommit ? ` and sourceCommit ${sourceCommit}` : ` and versionId ${versionId}`}`);
    }

    const activeRows = db.prepare("SELECT * FROM prompt_package_versions WHERE package_id = ? AND status = 'active' ORDER BY id ASC").all(packageRow.id);
    if (activeRows.length > 1) throw new Error(`Package ${packageKey} has multiple active versions`);

    if (targetRow.status === 'active') {
      if (packageRow.status !== 'active') {
        throw new Error(`Package ${packageKey} must be active for an active-version no-op; current status is ${packageRow.status}`);
      }
      if (activeRows.length !== 1 || activeRows[0].id !== targetRow.id) {
        throw new Error(`Active version consistency error for package ${packageKey}`);
      }
      const activationEvents = db.prepare("SELECT * FROM prompt_package_events WHERE package_id = ? AND package_version_id = ? AND event = 'package_version_activated' ORDER BY id ASC")
        .all(packageRow.id, targetRow.id);
      if (activationEvents.length === 0) throw new Error(`Activation event is missing for version ${targetRow.id}`);
      if (activationEvents.length > 1) throw new Error(`Multiple activation events found for version ${targetRow.id}`);
      return {
        package: toPromptPackage(packageRow),
        version: toPromptPackageVersion(targetRow),
        event: toPromptPackageEvent(activationEvents[0]),
        changed: false,
        previousVersionId: null,
      };
    }

    if (targetRow.status !== 'staged') throw new Error(`Version ${targetRow.id} must be staged to activate; current status is ${targetRow.status}`);
    if (packageRow.status === 'staged') {
      if (activeRows.length !== 0) throw new Error(`Staged package ${packageKey} has an active version`);
    } else if (packageRow.status === 'active') {
      if (activeRows.length !== 1) throw new Error(`Active package ${packageKey} must have exactly one active version`);
    } else {
      throw new Error(`Package ${packageKey} cannot activate a staged version; current status is ${packageRow.status}`);
    }

    const priorActivationEvents = db.prepare("SELECT COUNT(*) AS count FROM prompt_package_events WHERE package_id = ? AND package_version_id = ? AND event = 'package_version_activated'")
      .get(packageRow.id, targetRow.id);
    if (priorActivationEvents.count !== 0) {
      throw new Error(`Activation event inconsistency for staged version ${targetRow.id}`);
    }

    const previousRow = activeRows.length === 1 ? activeRows[0] : null;
    if (previousRow) {
      db.prepare("UPDATE prompt_package_versions SET status = 'superseded', updated_at = ? WHERE id = ?").run(now, previousRow.id);
    }
    db.prepare("UPDATE prompt_package_versions SET status = 'active', updated_at = ? WHERE id = ?").run(now, targetRow.id);
    db.prepare("UPDATE prompt_packages SET status = 'active', updated_at = ? WHERE id = ?").run(now, packageRow.id);

    const eventDetails = JSON.parse(serializedDetails);
    if (!Object.hasOwn(eventDetails, 'packageKey')) eventDetails.packageKey = packageKey;
    if (!Object.hasOwn(eventDetails, 'sourceCommit')) eventDetails.sourceCommit = targetRow.source_commit;
    if (!Object.hasOwn(eventDetails, 'version')) eventDetails.version = targetRow.version;
    if (!Object.hasOwn(eventDetails, 'versionId')) eventDetails.versionId = targetRow.id;
    if (previousRow && !Object.hasOwn(eventDetails, 'previousVersionId')) eventDetails.previousVersionId = previousRow.id;
    const eventId = generateId('prompt_package_event');
    db.prepare("INSERT INTO prompt_package_events (id, package_id, package_version_id, event, actor, details, created_at) VALUES (?, ?, ?, 'package_version_activated', ?, ?, ?)")
      .run(eventId, packageRow.id, targetRow.id, actor, JSON.stringify(eventDetails), now);

    const finalPackageRow = db.prepare('SELECT * FROM prompt_packages WHERE id = ?').get(packageRow.id);
    const finalVersionRow = db.prepare('SELECT * FROM prompt_package_versions WHERE id = ?').get(targetRow.id);
    const eventRow = db.prepare('SELECT * FROM prompt_package_events WHERE id = ?').get(eventId);
    return {
      package: toPromptPackage(finalPackageRow),
      version: toPromptPackageVersion(finalVersionRow),
      event: toPromptPackageEvent(eventRow),
      changed: true,
      previousVersionId: previousRow ? previousRow.id : null,
    };
  })();
}

/** Deactivates the single active package version locally, atomically and idempotently. */
export function deactivatePromptPackageVersion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be an object');

  const packageKey = nonEmptyString(input.packageKey, 'packageKey');
  const hasSourceCommit = input.sourceCommit !== undefined;
  const hasVersionId = input.versionId !== undefined;
  if (hasSourceCommit === hasVersionId) throw new Error('Exactly one of sourceCommit or versionId must be provided');
  const sourceCommit = hasSourceCommit ? nonEmptyString(input.sourceCommit, 'sourceCommit') : null;
  const versionId = hasVersionId ? nonEmptyString(input.versionId, 'versionId') : null;
  let actor = null;
  if (input.actor !== undefined && input.actor !== null) actor = nonEmptyString(input.actor, 'actor');
  const details = jsonObject(input.details, 'details', {});
  const serializedDetails = JSON.stringify(details);
  const parsedDetails = JSON.parse(serializedDetails);

  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  return db.transaction(() => {
    const packageRow = db.prepare('SELECT * FROM prompt_packages WHERE package_key = ? LIMIT 1').get(packageKey);
    if (!packageRow) throw new Error(`Prompt package not found: ${packageKey}`);

    const targetRow = sourceCommit
      ? db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND source_commit = ? LIMIT 1').get(packageRow.id, sourceCommit)
      : db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND id = ? LIMIT 1').get(packageRow.id, versionId);
    if (!targetRow) {
      throw new Error(`Prompt package version not found for package ${packageKey}${sourceCommit ? ` and sourceCommit ${sourceCommit}` : ` and versionId ${versionId}`}`);
    }

    const activeRows = db.prepare("SELECT * FROM prompt_package_versions WHERE package_id = ? AND status = 'active' ORDER BY id ASC").all(packageRow.id);
    const disabledEvents = db.prepare("SELECT * FROM prompt_package_events WHERE package_id = ? AND event = 'package_disabled' ORDER BY id ASC")
      .all(packageRow.id);

    if (packageRow.status === 'disabled') {
      if (activeRows.length !== 0) throw new Error(`Disabled package ${packageKey} has active versions`);
      if (targetRow.status !== 'disabled') {
        throw new Error(`Disabled package ${packageKey} requires the selected version to be disabled; current status is ${targetRow.status}`);
      }
      if (disabledEvents.length !== 1) {
        throw new Error(`Disable event inconsistency for disabled package ${packageKey}: expected exactly one package_disabled event, found ${disabledEvents.length}`);
      }
      if (disabledEvents[0].package_version_id !== targetRow.id) {
        throw new Error(`Disable event inconsistency for disabled package ${packageKey}: event must reference selected version ${targetRow.id}`);
      }
      return {
        package: toPromptPackage(packageRow),
        version: toPromptPackageVersion(targetRow),
        event: toPromptPackageEvent(disabledEvents[0]),
        changed: false,
        previousVersionId: null,
      };
    }

    if (packageRow.status !== 'active') {
      throw new Error(`Package ${packageKey} must be active to deactivate; current status is ${packageRow.status}`);
    }
    if (activeRows.length > 1) throw new Error(`Package ${packageKey} has multiple active versions`);
    if (activeRows.length !== 1) throw new Error(`Active package ${packageKey} must have exactly one active version`);
    if (targetRow.status !== 'active' || activeRows[0].id !== targetRow.id) {
      throw new Error(`Selected version ${targetRow.id} is not the active version for package ${packageKey}`);
    }
    if (disabledEvents.length !== 0) throw new Error(`Disable event inconsistency for active package ${packageKey}: expected zero package_disabled events, found ${disabledEvents.length}`);

    db.prepare("UPDATE prompt_package_versions SET status = 'disabled', updated_at = ? WHERE id = ?").run(now, targetRow.id);
    db.prepare("UPDATE prompt_packages SET status = 'disabled', updated_at = ? WHERE id = ?").run(now, packageRow.id);

    const eventDetails = { ...parsedDetails };
    if (!Object.hasOwn(eventDetails, 'packageKey')) eventDetails.packageKey = packageKey;
    if (!Object.hasOwn(eventDetails, 'sourceCommit')) eventDetails.sourceCommit = targetRow.source_commit;
    if (!Object.hasOwn(eventDetails, 'version')) eventDetails.version = targetRow.version;
    if (!Object.hasOwn(eventDetails, 'versionId')) eventDetails.versionId = targetRow.id;
    const eventId = generateId('prompt_package_event');
    db.prepare("INSERT INTO prompt_package_events (id, package_id, package_version_id, event, actor, details, created_at) VALUES (?, ?, ?, 'package_disabled', ?, ?, ?)")
      .run(eventId, packageRow.id, targetRow.id, actor, JSON.stringify(eventDetails), now);

    const finalPackageRow = db.prepare('SELECT * FROM prompt_packages WHERE id = ?').get(packageRow.id);
    const finalVersionRow = db.prepare('SELECT * FROM prompt_package_versions WHERE id = ?').get(targetRow.id);
    const eventRow = db.prepare('SELECT * FROM prompt_package_events WHERE id = ?').get(eventId);
    return {
      package: toPromptPackage(finalPackageRow),
      version: toPromptPackageVersion(finalVersionRow),
      event: toPromptPackageEvent(eventRow),
      changed: true,
      previousVersionId: targetRow.id,
    };
  })();
}

/** Rolls an active package back to one previously activated, superseded version atomically. */
export function rollbackPromptPackageVersion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be an object');

  const packageKey = nonEmptyString(input.packageKey, 'packageKey');
  const hasTargetVersionId = input.targetVersionId !== undefined;
  const hasTargetSourceCommit = input.targetSourceCommit !== undefined;
  if (hasTargetVersionId === hasTargetSourceCommit) {
    throw new Error('Exactly one of targetVersionId or targetSourceCommit must be provided');
  }
  const targetVersionId = hasTargetVersionId ? nonEmptyString(input.targetVersionId, 'targetVersionId') : null;
  const targetSourceCommit = hasTargetSourceCommit ? nonEmptyString(input.targetSourceCommit, 'targetSourceCommit') : null;
  const actor = input.actor === undefined || input.actor === null ? null : nonEmptyString(input.actor, 'actor');
  const detailsInput = jsonObject(input.details, 'details', {});
  let serializedDetails;
  let details;
  try {
    serializedDetails = JSON.stringify(detailsInput);
    details = serializedDetails === undefined ? null : JSON.parse(serializedDetails);
    if (details === null || Array.isArray(details) || typeof details !== 'object') throw new Error('not an object');
  } catch (error) {
    throw new Error(`details must be a JSON-serializable object: ${error.message}`);
  }
  if (Object.hasOwn(details, 'operation') && details.operation !== 'rollback') {
    throw new Error('details.operation must be "rollback" when provided');
  }

  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  return db.transaction(() => {
    const packageRow = db.prepare('SELECT * FROM prompt_packages WHERE package_key = ? LIMIT 1').get(packageKey);
    if (!packageRow) throw new Error(`Prompt package not found: ${packageKey}`);
    const targetRow = targetVersionId
      ? db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND id = ? LIMIT 1').get(packageRow.id, targetVersionId)
      : db.prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND source_commit = ? LIMIT 1').get(packageRow.id, targetSourceCommit);
    if (!targetRow) {
      throw new Error(`Prompt package version not found for package ${packageKey}${targetVersionId ? ` and targetVersionId ${targetVersionId}` : ` and targetSourceCommit ${targetSourceCommit}`}`);
    }

    if (packageRow.status !== 'active') throw new Error(`Package ${packageKey} must be active to roll back; current status is ${packageRow.status}`);
    const activeRows = db.prepare("SELECT * FROM prompt_package_versions WHERE package_id = ? AND status = 'active' ORDER BY id ASC").all(packageRow.id);
    if (activeRows.length !== 1) throw new Error(`Active package ${packageKey} must have exactly one active version; found ${activeRows.length}`);
    const disabledCount = db.prepare("SELECT COUNT(*) AS count FROM prompt_package_events WHERE package_id = ? AND event = 'package_disabled'").get(packageRow.id).count;
    if (disabledCount !== 0) throw new Error(`Rollback inconsistency for package ${packageKey}: expected zero package_disabled events, found ${disabledCount}`);

    const activationRows = db.prepare("SELECT * FROM prompt_package_events WHERE package_id = ? AND package_version_id = ? AND event = 'package_version_activated' ORDER BY id ASC")
      .all(packageRow.id, targetRow.id);
    const activationEvents = activationRows.map(toPromptPackageEvent);
    const readActivationDetails = (event) => {
      if (event.details === null || Array.isArray(event.details) || typeof event.details !== 'object') {
        throw new Error(`Activation event inconsistency for version ${targetRow.id}: event ${event.id} details must be an object`);
      }
      return event.details;
    };

    if (targetRow.status === 'active') {
      if (activeRows[0].id !== targetRow.id) throw new Error(`Active version consistency error for package ${packageKey}`);
      if (activationEvents.length !== 2) {
        throw new Error(`Rollback idempotency inconsistency for version ${targetRow.id}: expected exactly two activation events, found ${activationEvents.length}`);
      }
      const classified = activationEvents.map((event) => ({ event, details: readActivationDetails(event) }));
      const origin = classified.filter(({ details: eventDetails }) => eventDetails.operation !== 'rollback');
      const rollback = classified.filter(({ details: eventDetails }) => eventDetails.operation === 'rollback');
      if (origin.length !== 1 || rollback.length !== 1 || typeof rollback[0].details.previousVersionId !== 'string' || !rollback[0].details.previousVersionId.trim()) {
        throw new Error(`Rollback idempotency inconsistency for version ${targetRow.id}: activation history does not prove one origin and one rollback`);
      }
      return {
        package: toPromptPackage(packageRow),
        version: toPromptPackageVersion(targetRow),
        event: rollback[0].event,
        changed: false,
        previousVersionId: null,
      };
    }

    if (targetRow.status !== 'superseded') {
      throw new Error(`Version ${targetRow.id} must be superseded to roll back; current status is ${targetRow.status}`);
    }
    if (activationEvents.length !== 1) {
      throw new Error(`Rollback inconsistency for version ${targetRow.id}: expected exactly one origin activation event, found ${activationEvents.length}`);
    }
    const originDetails = readActivationDetails(activationEvents[0]);
    if (originDetails.operation === 'rollback') {
      throw new Error(`Rollback inconsistency for version ${targetRow.id}: origin activation event is already a rollback`);
    }

    const previousRow = activeRows[0];
    db.prepare("UPDATE prompt_package_versions SET status = 'superseded', updated_at = ? WHERE id = ?").run(now, previousRow.id);
    db.prepare("UPDATE prompt_package_versions SET status = 'active', updated_at = ? WHERE id = ?").run(now, targetRow.id);
    const eventDetails = { ...details };
    if (!Object.hasOwn(eventDetails, 'packageKey')) eventDetails.packageKey = packageKey;
    if (!Object.hasOwn(eventDetails, 'sourceCommit')) eventDetails.sourceCommit = targetRow.source_commit;
    if (!Object.hasOwn(eventDetails, 'version')) eventDetails.version = targetRow.version;
    if (!Object.hasOwn(eventDetails, 'versionId')) eventDetails.versionId = targetRow.id;
    if (!Object.hasOwn(eventDetails, 'previousVersionId')) eventDetails.previousVersionId = previousRow.id;
    if (!Object.hasOwn(eventDetails, 'operation')) eventDetails.operation = 'rollback';
    const eventId = generateId('prompt_package_event');
    db.prepare("INSERT INTO prompt_package_events (id, package_id, package_version_id, event, actor, details, created_at) VALUES (?, ?, ?, 'package_version_activated', ?, ?, ?)")
      .run(eventId, packageRow.id, targetRow.id, actor, JSON.stringify(eventDetails), now);

    return {
      package: toPromptPackage(packageRow),
      version: toPromptPackageVersion(db.prepare('SELECT * FROM prompt_package_versions WHERE id = ?').get(targetRow.id)),
      event: toPromptPackageEvent(db.prepare('SELECT * FROM prompt_package_events WHERE id = ?').get(eventId)),
      changed: true,
      previousVersionId: previousRow.id,
    };
  })();
}

export function listPromptPackages({ status, source, repository } = {}) {
  const clauses = [];
  const params = [];
  if (status !== undefined) { clauses.push('status = ?'); params.push(status); }
  if (source !== undefined) { clauses.push('source = ?'); params.push(source); }
  if (repository !== undefined) { clauses.push('repository = ?'); params.push(repository); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM prompt_packages${where} ORDER BY updated_at DESC, id ASC`).all(...params).map(toPromptPackage);
}

export function getPromptPackageByKey(packageKey) {
  return toPromptPackage(getDb().prepare('SELECT * FROM prompt_packages WHERE package_key = ? LIMIT 1').get(packageKey));
}

export function listPromptPackageVersions(packageId, { status } = {}) {
  const hasStatus = status !== undefined;
  const sql = `SELECT * FROM prompt_package_versions WHERE package_id = ?${hasStatus ? ' AND status = ?' : ''} ORDER BY created_at DESC, id ASC`;
  return getDb().prepare(sql).all(...(hasStatus ? [packageId, status] : [packageId])).map(toPromptPackageVersion);
}

export function getPromptPackageVersion(packageId, versionId) {
  return toPromptPackageVersion(getDb().prepare('SELECT * FROM prompt_package_versions WHERE package_id = ? AND id = ? LIMIT 1').get(packageId, versionId));
}

export function listPromptPackageArtifacts(packageVersionId) {
  return getDb().prepare('SELECT * FROM prompt_package_artifacts WHERE package_version_id = ? ORDER BY type ASC, artifact_key ASC, id ASC').all(packageVersionId).map(toPromptPackageArtifact);
}

export function listPromptPackageEvents(packageId, { packageVersionId } = {}) {
  const hasVersionId = packageVersionId !== undefined;
  const sql = `SELECT * FROM prompt_package_events WHERE package_id = ?${hasVersionId ? ' AND package_version_id = ?' : ''} ORDER BY created_at DESC, id ASC`;
  return getDb().prepare(sql).all(...(hasVersionId ? [packageId, packageVersionId] : [packageId])).map(toPromptPackageEvent);
}
