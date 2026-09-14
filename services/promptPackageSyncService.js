import { buildPromptPackageImport } from './promptPackageImporter.js';
import { stageImportedPromptPackage } from './promptPackagePersistenceAdapter.js';
import { fetchPinnedGithubPromptFiles, normalizePinnedGithubPromptDescriptor } from './pinnedGithubPromptClient.js';
import { normalizePromptPackageManifest } from './promptPackageManifest.js';
import { getPromptPackageSyncSource, recordPromptPackageSyncCheckpoint } from './promptPackageSyncConfigStore.js';

const ALLOWED_INPUT_KEYS = new Set([
  'sourcePin',
  'package',
  'version',
  'files',
  'references',
  'documentKey',
  'artifactMappings',
  'details',
  'actor',
]);
const MATERIALIZATION_INPUT_KEYS = new Set(['descriptor', 'package', 'version', 'fetchImpl', 'timeoutMs', 'references']);
const MANUAL_SYNC_INPUT_KEYS = new Set(['descriptor', 'package', 'version', 'fetchImpl', 'documentKey', 'artifactMappings', 'timeoutMs', 'references', 'details', 'actor']);
const REFERENCE_KEYS = new Set(['sourcePath', 'artifactKey']);
const ARTIFACT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOwnDataObject(value, allowedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => {
    if (typeof key !== 'string' || (allowedKeys && !allowedKeys.has(key))) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value');
  });
}

function isOwnDataArray(value) {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'symbol' && descriptor && Object.hasOwn(descriptor, 'value') && (key === 'length' || (/^(?:0|[1-9]\d*)$/.test(key) && Number(key) < value.length));
  }) && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
}

function cloneOwnData(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('invalid data');
    return value;
  }
  if (Array.isArray(value)) {
    if (!isOwnDataArray(value)) throw new TypeError('invalid data');
    return value.map(cloneOwnData);
  }
  if (!isOwnDataObject(value)) throw new TypeError('invalid data');
  return Object.fromEntries(Object.keys(value).map((key) => [key, cloneOwnData(value[key])]));
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freezeDeep(value[key]);
    Object.freeze(value);
  }
  return value;
}

function samePathSet(left, right) {
  return left.size === right.size && [...left].every((path) => right.has(path));
}

function isSkillPath(path) {
  return path.split('/').at(-1) === 'SKILL.md';
}

function normalizeMaterializationReferences(value, nonSkillPaths) {
  if (!isOwnDataArray(value)) throw new TypeError('invalid references');
  const references = value.map((reference) => {
    if (!isOwnDataObject(reference, REFERENCE_KEYS) || !Object.hasOwn(reference, 'sourcePath') || typeof reference.sourcePath !== 'string' || reference.sourcePath.length === 0) throw new TypeError('invalid references');
    if (Object.hasOwn(reference, 'artifactKey') && (typeof reference.artifactKey !== 'string' || !ARTIFACT_KEY.test(reference.artifactKey))) throw new TypeError('invalid references');
    return Object.hasOwn(reference, 'artifactKey')
      ? { sourcePath: reference.sourcePath, artifactKey: reference.artifactKey }
      : { sourcePath: reference.sourcePath };
  });
  if (new Set(references.map((reference) => reference.sourcePath)).size !== references.length || !samePathSet(new Set(references.map((reference) => reference.sourcePath)), nonSkillPaths)) throw new TypeError('invalid references');
  return references;
}

export class PromptPackageSyncMaterializationError extends Error {
  constructor(code = 'INVALID_MATERIALIZATION') {
    super('Pinned GitHub prompt package materialization failed');
    this.name = 'PromptPackageSyncMaterializationError';
    this.code = code;
  }
}

export class PromptPackageManualSyncError extends Error {
  constructor(code) {
    super('Pinned GitHub prompt package manual sync failed');
    this.name = 'PromptPackageManualSyncError';
    this.code = code;
  }
}

function materializationFail(code) {
  throw new PromptPackageSyncMaterializationError(code);
}

function manualSyncFail(code) {
  throw new PromptPackageManualSyncError(code);
}

/**
 * Fetches exactly a pinned descriptor's files and returns an inert stage-ready payload.
 * It does not persist, stage, activate, log, or otherwise invoke application runtime state.
 */
export async function materializePinnedGithubPromptPackage(input) {
  try {
    if (!isOwnDataObject(input, MATERIALIZATION_INPUT_KEYS)) materializationFail('INVALID_INPUT');
    for (const key of ['descriptor', 'package', 'version', 'fetchImpl']) {
      if (!Object.hasOwn(input, key)) materializationFail('INVALID_INPUT');
    }
    if (typeof input.fetchImpl !== 'function' || (Object.hasOwn(input, 'timeoutMs') && (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 30000))) materializationFail('INVALID_INPUT');
    if (!isOwnDataObject(input.package) || !isOwnDataObject(input.version)) materializationFail('INVALID_INPUT');
    const packageData = cloneOwnData(input.package);
    const versionData = cloneOwnData(input.version);
    const descriptor = normalizePinnedGithubPromptDescriptor(input.descriptor);
    const fetched = await fetchPinnedGithubPromptFiles({
      sourcePin: descriptor.sourcePin,
      paths: descriptor.paths,
      fetchImpl: input.fetchImpl,
      ...(Object.hasOwn(input, 'timeoutMs') ? { timeoutMs: input.timeoutMs } : {}),
    });
    const fetchedPaths = new Set(fetched.files.map((file) => file.path));
    if (fetched.files.length !== descriptor.paths.length || !samePathSet(fetchedPaths, new Set(descriptor.paths))) materializationFail('FETCHED_PATH_MISMATCH');
    const manifestFile = fetched.files.find((file) => file.path === descriptor.manifestPath);
    if (!manifestFile || typeof manifestFile.content !== 'string' || typeof manifestFile.contentHash !== 'string') materializationFail('INVALID_MANIFEST');
    let parsedManifest;
    try { parsedManifest = JSON.parse(manifestFile.content); } catch { materializationFail('INVALID_MANIFEST'); }
    let manifest;
    try {
      manifest = normalizePromptPackageManifest(parsedManifest, { source: {
        repository: descriptor.sourcePin.repository,
        ref: descriptor.sourcePin.ref,
        commit: descriptor.sourcePin.commit,
      } });
    } catch { materializationFail('INVALID_MANIFEST'); }
    if (manifest.source.repository !== descriptor.sourcePin.repository || manifest.source.ref !== descriptor.sourcePin.ref || manifest.source.commit !== descriptor.sourcePin.commit) materializationFail('SOURCE_MISMATCH');
    const declaredPaths = new Set([...manifest.skills.map((skill) => skill.path), ...manifest.blocks.map((block) => block.path)]);
    if (!samePathSet(declaredPaths, new Set(descriptor.artifactPaths))) materializationFail('ARTIFACT_PATH_MISMATCH');
    const files = fetched.files.filter((file) => file.path !== descriptor.manifestPath).map((file) => ({ path: file.path, content: file.content })).sort((a, b) => a.path.localeCompare(b.path));
    const nonSkillPaths = new Set(files.filter((file) => !isSkillPath(file.path)).map((file) => file.path));
    const references = Object.hasOwn(input, 'references')
      ? normalizeMaterializationReferences(input.references, nonSkillPaths)
      : files.filter((file) => !isSkillPath(file.path)).map((file) => ({ sourcePath: file.path }));
    return freezeDeep({
      sourcePin: { ...descriptor.sourcePin },
      package: packageData,
      version: { ...versionData, sourceCommit: descriptor.sourcePin.commit, sourceRef: descriptor.sourcePin.ref, manifest },
      files,
      references,
    });
  } catch (error) {
    if (error instanceof PromptPackageSyncMaterializationError) throw error;
    throw new PromptPackageSyncMaterializationError('INVALID_MATERIALIZATION');
  }
}

/**
 * Materializes supplied, pinned GitHub package content locally as a staged package.
 * This orchestrator performs no fetching, activation, logging, or content generation.
 */
export function stagePinnedGithubPromptPackage(input) {
  if (!isPlainObject(input)) {
    throw new Error('Pinned GitHub prompt package input must be a plain object');
  }
  for (const key of Object.keys(input)) {
    if (!ALLOWED_INPUT_KEYS.has(key)) {
      throw new Error(`Pinned GitHub prompt package input does not support ${key}`);
    }
  }
  for (const key of ['sourcePin', 'package', 'version', 'files', 'documentKey', 'artifactMappings']) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error(`Pinned GitHub prompt package input requires ${key}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'details') && !isPlainObject(input.details)) {
    throw new Error('details must be a plain object when provided');
  }

  const importPayload = buildPromptPackageImport({
    sourcePin: input.sourcePin,
    package: input.package,
    version: input.version,
    files: input.files,
    ...(Object.prototype.hasOwnProperty.call(input, 'references') ? { references: input.references } : {}),
  });

  return stageImportedPromptPackage({
    importPayload,
    documentKey: input.documentKey,
    artifactMappings: input.artifactMappings,
    ...(Object.prototype.hasOwnProperty.call(input, 'details') ? { details: input.details } : {}),
    ...(Object.prototype.hasOwnProperty.call(input, 'actor') ? { actor: input.actor } : {}),
  });
}

/**
 * Performs one explicitly requested fetch, materialization, staging, and checkpoint.
 * It deliberately has no scheduler, webhook, activation, or implicit fetch behavior.
 */
export async function syncPinnedGithubPromptPackageManually(input) {
  let descriptor;
  let sourceKey;
  try {
    if (!isOwnDataObject(input, MANUAL_SYNC_INPUT_KEYS)) manualSyncFail('MATERIALIZATION_FAILED');
    for (const key of ['descriptor', 'package', 'version', 'fetchImpl', 'documentKey', 'artifactMappings']) {
      if (!Object.hasOwn(input, key)) manualSyncFail('MATERIALIZATION_FAILED');
    }
    if (typeof input.fetchImpl !== 'function') manualSyncFail('MATERIALIZATION_FAILED');
    descriptor = normalizePinnedGithubPromptDescriptor(input.descriptor);
    sourceKey = `github:${descriptor.sourcePin.repository}@${descriptor.sourcePin.ref}`;
  } catch (error) {
    if (error instanceof PromptPackageManualSyncError) throw error;
    manualSyncFail('MATERIALIZATION_FAILED');
  }

  let configuredSource;
  try {
    configuredSource = getPromptPackageSyncSource(sourceKey);
  } catch {
    manualSyncFail('SOURCE_NOT_CONFIGURED');
  }
  if (!configuredSource) manualSyncFail('SOURCE_NOT_CONFIGURED');
  if (!configuredSource.enabled) manualSyncFail('SOURCE_DISABLED');
  if (configuredSource.provider !== 'github' || configuredSource.repository !== descriptor.sourcePin.repository || configuredSource.sourceRef !== descriptor.sourcePin.ref) {
    manualSyncFail('SOURCE_MISMATCH');
  }

  let materialized;
  try {
    const materializationInput = {
      descriptor: input.descriptor,
      package: cloneOwnData(input.package),
      version: cloneOwnData(input.version),
      fetchImpl: input.fetchImpl,
      ...(Object.hasOwn(input, 'timeoutMs') ? { timeoutMs: input.timeoutMs } : {}),
      ...(Object.hasOwn(input, 'references') ? { references: cloneOwnData(input.references) } : {}),
    };
    materialized = await materializePinnedGithubPromptPackage(materializationInput);
  } catch {
    manualSyncFail('MATERIALIZATION_FAILED');
  }

  let staged;
  try {
    staged = stagePinnedGithubPromptPackage({
      ...materialized,
      documentKey: cloneOwnData(input.documentKey),
      artifactMappings: cloneOwnData(input.artifactMappings),
      ...(Object.hasOwn(input, 'details') ? { details: cloneOwnData(input.details) } : {}),
      ...(Object.hasOwn(input, 'actor') ? { actor: cloneOwnData(input.actor) } : {}),
    });
  } catch {
    manualSyncFail('STAGING_FAILED');
  }

  let checkpoint;
  try {
    const recorded = recordPromptPackageSyncCheckpoint({
      sourceKey,
      lastSeenCommit: descriptor.sourcePin.commit,
      lastStagedCommit: descriptor.sourcePin.commit,
      lastSyncAt: Math.floor(Date.now() / 1000),
      lastError: null,
    });
    checkpoint = {
      sourceKey: recorded.sourceKey,
      lastSeenCommit: recorded.lastSeenCommit,
      lastStagedCommit: recorded.lastStagedCommit,
      lastSyncAt: recorded.lastSyncAt,
    };
  } catch {
    manualSyncFail('CHECKPOINT_FAILED');
  }

  return freezeDeep({ materialized, staged, checkpoint });
}
