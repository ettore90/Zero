import { getDb, generateId } from '../db.js';
import { normalizePinnedGithubPromptDescriptor } from './pinnedGithubPromptClient.js';

const OWN = Object.prototype.hasOwnProperty;
const ALLOWED = new Set(['sourceKey', 'enabled', 'intervalSeconds', 'descriptor', 'package', 'version', 'documentKey', 'artifactMappings', 'references', 'details', 'createdBy']);
const REQUIRED = ['sourceKey', 'descriptor', 'package', 'version', 'documentKey', 'artifactMappings'];
const SECRET_KEY = /token|secret|password|authorization|api[_-]?key|private[_-]?key|credential(?:s)?|bearer|cookie/i;
const MAX_STRING = 512;
const MAX_DOCUMENT_KEY = 512;
const MAX_JSON_BYTES = 65536;
const MAX_DEPTH = 12;

function fail(message) { throw new Error(`Invalid prompt package sync job: ${message}`); }
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function ownData(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && OWN.call(descriptor, 'value') ? descriptor.value : undefined;
}
function assertOwnDataObject(value, field) {
  if (!isPlainObject(value)) fail(`${field} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key)) fail(`${field} must contain only enumerable string data keys`);
    if (!OWN.call(Object.getOwnPropertyDescriptor(value, key), 'value')) fail(`${field} must not contain accessors`);
  }
}
function normalizeJson(value, field, objectOnly = false) {
  const seen = new Set();
  function walk(item, depth) {
    if (depth > MAX_DEPTH) fail(`${field} exceeds maximum nesting depth`);
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') { if (!Number.isFinite(item)) fail(`${field} must contain finite JSON values`); return item; }
    if (typeof item !== 'object') fail(`${field} must contain only JSON values`);
    if (seen.has(item)) fail(`${field} must not contain cycles`);
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype) fail(`${field} must contain native arrays`);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(item, 'length');
      if (!lengthDescriptor || !OWN.call(lengthDescriptor, 'value')) fail(`${field} must contain native array data properties`);
      const length = lengthDescriptor.value;
      const keys = Reflect.ownKeys(item);
      if (keys.length !== length + 1) fail(`${field} must not contain sparse or non-index array properties`);
      for (const key of keys) {
        if (typeof key !== 'string' || (key !== 'length' && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length))) fail(`${field} must not contain sparse or non-index array properties`);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !OWN.call(descriptor, 'value')) fail(`${field} must contain native array data properties`);
      }
      result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !OWN.call(descriptor, 'value')) fail(`${field} must not contain sparse or accessor array indices`);
        result.push(walk(descriptor.value, depth + 1));
      }
    } else {
      assertOwnDataObject(item, field);
      result = {};
      for (const key of Object.keys(item)) {
        if (SECRET_KEY.test(key)) fail(`${field} must not contain secretish key ${key}`);
        result[key] = walk(ownData(item, key), depth + 1);
      }
    }
    seen.delete(item);
    return result;
  }
  if (objectOnly && !isPlainObject(value)) fail(`${field} must be a plain object`);
  const normalized = walk(value, 0);
  let serialized;
  try { serialized = JSON.stringify(normalized); } catch { fail(`${field} must be JSON-serializable`); }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_BYTES) fail(`${field} is too large`);
  return { value: normalized, serialized };
}
function sourceKeyFor(pin) { return `github:${pin.repository}@${pin.ref}`; }
function normalizeInput(input) {
  assertOwnDataObject(input, 'input');
  for (const key of Object.keys(input)) if (!ALLOWED.has(key)) fail(`input.${key} is not supported`);
  for (const key of REQUIRED) if (!OWN.call(input, key)) fail(`input.${key} is required`);
  const sourceKey = ownData(input, 'sourceKey');
  if (typeof sourceKey !== 'string' || !sourceKey || sourceKey.length > MAX_STRING) fail('sourceKey must be a bounded non-empty string');
  if (OWN.call(input, 'enabled') && typeof ownData(input, 'enabled') !== 'boolean') fail('enabled must be a boolean');
  const intervalSeconds = OWN.call(input, 'intervalSeconds') ? ownData(input, 'intervalSeconds') : 3600;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 86400) fail('intervalSeconds must be an integer from 60 through 86400');
  let descriptor;
  try { descriptor = normalizePinnedGithubPromptDescriptor(ownData(input, 'descriptor')); } catch { fail('descriptor is invalid'); }
  if (sourceKeyFor(descriptor.sourcePin) !== sourceKey) fail('descriptor source pin must resolve exactly to sourceKey');
  const documentKey = ownData(input, 'documentKey');
  if (typeof documentKey !== 'string' || !documentKey.trim() || documentKey.length > MAX_DOCUMENT_KEY) fail('documentKey must be a bounded non-empty string');
  const artifactMappings = ownData(input, 'artifactMappings');
  if (!Array.isArray(artifactMappings) || Object.getPrototypeOf(artifactMappings) !== Array.prototype || artifactMappings.length < 1) fail('artifactMappings must be a non-empty native array');
  const normalizedMappings = normalizeJson(artifactMappings, 'artifactMappings');
  if (!normalizedMappings.value.every(isPlainObject)) fail('artifactMappings entries must be JSON objects');
  const references = OWN.call(input, 'references') ? ownData(input, 'references') : [];
  if (!Array.isArray(references) || Object.getPrototypeOf(references) !== Array.prototype) fail('references must be a native array');
  const createdBy = OWN.call(input, 'createdBy') ? ownData(input, 'createdBy') : null;
  if (createdBy !== null && (typeof createdBy !== 'string' || createdBy.length > MAX_STRING)) fail('createdBy must be null or a bounded string');
  return { sourceKey, enabled: OWN.call(input, 'enabled') ? ownData(input, 'enabled') : false, intervalSeconds, descriptor: normalizeJson(descriptor, 'descriptor'), package: normalizeJson(ownData(input, 'package'), 'package', true), version: normalizeJson(ownData(input, 'version'), 'version', true), documentKey, artifactMappings: normalizedMappings, references: normalizeJson(references, 'references'), details: normalizeJson(OWN.call(input, 'details') ? ownData(input, 'details') : {}, 'details', true), createdBy };
}
function parse(value, field, id) { try { return JSON.parse(value); } catch { throw new Error(`Corrupt prompt package sync job ${field} for ${id}`); } }
function toJob(row) {
  if (!row) return null;
  return { id: row.id, sourceKey: row.source_key, enabled: row.enabled === 1, intervalSeconds: row.interval_seconds, descriptor: parse(row.descriptor, 'descriptor', row.id), package: parse(row.package, 'package', row.id), version: parse(row.version, 'version', row.id), documentKey: row.document_key, artifactMappings: parse(row.artifact_mappings, 'artifactMappings', row.id), references: parse(row.references, 'references', row.id), details: parse(row.details, 'details', row.id), createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}
function getRow(sourceKey) { return getDb().prepare('SELECT * FROM prompt_package_sync_jobs WHERE source_key = ?').get(sourceKey); }
function readFailure() {
  const error = new Error('Unable to read prompt package sync jobs');
  error.code = 'PROMPT_PACKAGE_SYNC_JOB_READ_FAILED';
  return error;
}
function isCorruptJobError(error) { return error instanceof Error && error.message.startsWith('Corrupt prompt package sync job '); }
function safelyRead(read) {
  try { return read(); } catch (error) { if (isCorruptJobError(error)) throw error; throw readFailure(); }
}
export function getPromptPackageSyncJob(sourceKey) {
  if (typeof sourceKey !== 'string' || !sourceKey) fail('sourceKey must be a non-empty string');
  return safelyRead(() => toJob(getRow(sourceKey)));
}
export function listPromptPackageSyncJobs() {
  return safelyRead(() => getDb().prepare('SELECT * FROM prompt_package_sync_jobs ORDER BY source_key ASC').all().map(toJob));
}
export function upsertPromptPackageSyncJob(input) {
  const job = normalizeInput(input); const db = getDb(); const now = Math.floor(Date.now() / 1000);
  try { return db.transaction(() => {
    const source = db.prepare('SELECT * FROM prompt_package_sync_sources WHERE source_key = ?').get(job.sourceKey);
    if (!source) fail('sourceKey does not exist');
    const pin = job.descriptor.value.sourcePin;
    if (source.provider !== pin.provider || source.repository !== pin.repository || source.source_ref !== pin.ref || source.pinned_commit !== pin.commit) fail('source configuration does not match descriptor pin');
    const existing = getRow(job.sourceKey);
    if (!existing) {
      const id = generateId('prompt_package_sync_job');
      db.prepare('INSERT INTO prompt_package_sync_jobs (id, source_key, enabled, interval_seconds, descriptor, package, version, document_key, artifact_mappings, "references", details, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, job.sourceKey, job.enabled ? 1 : 0, job.intervalSeconds, job.descriptor.serialized, job.package.serialized, job.version.serialized, job.documentKey, job.artifactMappings.serialized, job.references.serialized, job.details.serialized, job.createdBy, now, now);
      return toJob(db.prepare('SELECT * FROM prompt_package_sync_jobs WHERE id = ?').get(id));
    }
    db.prepare('UPDATE prompt_package_sync_jobs SET enabled = ?, interval_seconds = ?, descriptor = ?, package = ?, version = ?, document_key = ?, artifact_mappings = ?, "references" = ?, details = ?, updated_at = ? WHERE id = ?')
      .run(job.enabled ? 1 : 0, job.intervalSeconds, job.descriptor.serialized, job.package.serialized, job.version.serialized, job.documentKey, job.artifactMappings.serialized, job.references.serialized, job.details.serialized, now, existing.id);
    return toJob(db.prepare('SELECT * FROM prompt_package_sync_jobs WHERE id = ?').get(existing.id));
  })(); } catch (error) { if (error.message.startsWith('Invalid prompt package sync job:')) throw error; throw new Error('Unable to persist prompt package sync job'); }
}
export function deletePromptPackageSyncJob(sourceKey) { if (typeof sourceKey !== 'string' || !sourceKey) fail('sourceKey must be a non-empty string'); try { return getDb().prepare('DELETE FROM prompt_package_sync_jobs WHERE source_key = ?').run(sourceKey).changes > 0; } catch { throw new Error('Unable to delete prompt package sync job'); } }
