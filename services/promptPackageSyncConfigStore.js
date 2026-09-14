import { getDb, generateId } from '../db.js';
import { normalizeGithubRepository } from './promptPackageSourcePolicy.js';

const OWN = Object.prototype.hasOwnProperty;
const COMMIT = /^[a-f0-9]{40}$/;
const SECRET_KEY = /token|secret|password|authorization|api[_-]?key|private[_-]?key|credential(?:s)?|bearer|cookie/i;
const MAX_METADATA_BYTES = 8192;
const MAX_METADATA_KEYS = 64;
const MAX_METADATA_DEPTH = 6;
const MAX_ERROR_LENGTH = 2048;

function fail(message) {
  throw new Error(`Invalid prompt package sync source: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(value, allowed, field) {
  if (!isPlainObject(value)) fail(`${field} must be a plain object`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${field}.${key} is not supported`);
}

function normalizeSource(value, field = 'source') {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !['provider', 'repository', 'ref'].includes(key)) || value.provider !== 'github') fail(`${field} must contain provider, repository, and ref`);
  const repository = normalizeGithubRepository(value.repository, `${field}.repository`);
  if (typeof value.ref !== 'string' || value.ref.length === 0 || value.ref.length > 255 || /\s/.test(value.ref) || value.ref.split('/').includes('..')) fail(`${field}.ref must be a non-empty ref without whitespace or parent segments`);
  return { provider: 'github', repository, ref: value.ref };
}

function sourceKeyFor(source) {
  return `github:${source.repository}@${source.ref}`;
}

function normalizeMetadata(value) {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) fail('metadata must be a plain object');
  let keys = 0;
  function walk(item, depth) {
    if (depth > MAX_METADATA_DEPTH) fail('metadata exceeds maximum nesting depth');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('metadata must be JSON-serializable');
      return item;
    }
    if (Array.isArray(item)) return item.map((entry) => walk(entry, depth + 1));
    if (!isPlainObject(item)) fail('metadata must contain only JSON values');
    const result = {};
    for (const [key, entry] of Object.entries(item)) {
      if (SECRET_KEY.test(key)) fail(`metadata must not contain secretish key ${key}`);
      keys += 1;
      if (keys > MAX_METADATA_KEYS) fail('metadata has too many keys');
      result[key] = walk(entry, depth + 1);
    }
    return result;
  }
  const normalized = walk(value, 0);
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_METADATA_BYTES) fail('metadata is too large');
  return { value: normalized, serialized };
}

function normalizeCommit(value, field) {
  if (value !== null && (typeof value !== 'string' || !COMMIT.test(value))) {
    fail(`${field} must be a lowercase 40-character hexadecimal SHA or null`);
  }
  return value;
}

// Checkpoints use Unix epoch seconds; values after 2100 are rejected to prevent ambiguous millisecond input.
function normalizeTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 4102444800) {
    fail('lastSyncAt must be a Unix-seconds integer from 0 through 4102444800, or null');
  }
  return value;
}

function normalizeError(value) {
  if (value !== null && (typeof value !== 'string' || value.length > MAX_ERROR_LENGTH)) fail(`lastError must be a string of at most ${MAX_ERROR_LENGTH} characters or null`);
  return value;
}

function parseMetadata(value, id) {
  try {
    const parsed = JSON.parse(value);
    if (!isPlainObject(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new Error(`Corrupt prompt package sync source metadata for ${id}`);
  }
}

function toSource(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceKey: row.source_key,
    provider: row.provider,
    repository: row.repository,
    sourceRef: row.source_ref,
    enabled: row.enabled === 1,
    lastSeenCommit: row.last_seen_commit,
    lastStagedCommit: row.last_staged_commit,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    metadata: parseMetadata(row.metadata, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRow(sourceKey) {
  if (typeof sourceKey !== 'string' || !sourceKey) fail('sourceKey must be a non-empty canonical string');
  return getDb().prepare('SELECT * FROM prompt_package_sync_sources WHERE source_key = ?').get(sourceKey);
}

export function listPromptPackageSyncSources() {
  return getDb().prepare('SELECT * FROM prompt_package_sync_sources ORDER BY source_key ASC').all().map(toSource);
}

export function getPromptPackageSyncSource(sourceKey) {
  return toSource(getRow(sourceKey));
}

export function upsertPromptPackageSyncSource(input) {
  assertOnlyKeys(input, new Set(['source', 'sourceKey', 'enabled', 'metadata']), 'input');
  if (!OWN.call(input, 'source')) fail('input.source is required');
  const source = normalizeSource(input.source, 'input.source');
  const sourceKey = sourceKeyFor(source);
  if (OWN.call(input, 'sourceKey') && input.sourceKey !== sourceKey) fail('input.sourceKey must match the canonical source identity');
  if (OWN.call(input, 'enabled') && typeof input.enabled !== 'boolean') fail('input.enabled must be a boolean');
  const metadata = normalizeMetadata(input.metadata);
  const now = Math.floor(Date.now() / 1000);
  const db = getDb();
  return db.transaction(() => {
    const existing = getRow(sourceKey);
    if (!existing) {
      const id = generateId('prompt_package_sync_source');
      db.prepare(`INSERT INTO prompt_package_sync_sources
        (id, source_key, provider, repository, source_ref, enabled, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, sourceKey, source.provider, source.repository, source.ref, input.enabled === true ? 1 : 0, metadata?.serialized || '{}', now, now);
      return toSource(db.prepare('SELECT * FROM prompt_package_sync_sources WHERE id = ?').get(id));
    }
    db.prepare(`UPDATE prompt_package_sync_sources SET enabled = ?, metadata = ?, updated_at = ? WHERE id = ?`)
      .run(OWN.call(input, 'enabled') ? (input.enabled ? 1 : 0) : existing.enabled, metadata?.serialized || existing.metadata, now, existing.id);
    return toSource(db.prepare('SELECT * FROM prompt_package_sync_sources WHERE id = ?').get(existing.id));
  })();
}

export function recordPromptPackageSyncCheckpoint(input) {
  assertOnlyKeys(input, new Set(['sourceKey', 'lastSeenCommit', 'lastStagedCommit', 'lastSyncAt', 'lastError']), 'input');
  if (!OWN.call(input, 'sourceKey')) fail('input.sourceKey is required');
  const fields = ['lastSeenCommit', 'lastStagedCommit', 'lastSyncAt', 'lastError'];
  if (!fields.some((field) => OWN.call(input, field))) fail('a checkpoint field is required');
  if (OWN.call(input, 'lastSeenCommit')) normalizeCommit(input.lastSeenCommit, 'lastSeenCommit');
  if (OWN.call(input, 'lastStagedCommit')) normalizeCommit(input.lastStagedCommit, 'lastStagedCommit');
  const lastSyncAt = OWN.call(input, 'lastSyncAt') ? normalizeTimestamp(input.lastSyncAt) : undefined;
  if (OWN.call(input, 'lastError')) normalizeError(input.lastError);
  const existing = getRow(input.sourceKey);
  if (!existing) fail('sourceKey does not exist');
  const now = Math.floor(Date.now() / 1000);
  const values = fields.map((field, index) => {
    if (!OWN.call(input, field)) return [existing.last_seen_commit, existing.last_staged_commit, existing.last_sync_at, existing.last_error][index];
    return field === 'lastSyncAt' ? lastSyncAt : input[field];
  });
  getDb().prepare(`UPDATE prompt_package_sync_sources
    SET last_seen_commit = ?, last_staged_commit = ?, last_sync_at = ?, last_error = ?, updated_at = ? WHERE id = ?`)
    .run(...values, now, existing.id);
  return toSource(getDb().prepare('SELECT * FROM prompt_package_sync_sources WHERE id = ?').get(existing.id));
}
