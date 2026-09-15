import { getDb, generateId } from '../db.js';
import { normalizeGithubRepository } from './promptPackageSourcePolicy.js';

const OWN = Object.prototype.hasOwnProperty;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PURPOSE = 'read_only';
const DECISIONS = new Set(['approved', 'rejected']);
const SECRETISH = /token|header|credential|secret|authorization|password|api[_-]?key|private[_-]?key|bearer|cookie/i;
const MAX_UNIX_SECONDS = 4102444800;

function fail(message) { throw new Error(`Invalid GitHub private access authorization: ${message}`); }
function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail(`${field} must be a plain object`);
  return value;
}
function onlyKeys(value, keys, field) {
  plainObject(value, field);
  for (const key of Object.keys(value)) {
    if (SECRETISH.test(key)) fail(`${field}.${key} must not contain secret material`);
    if (!keys.has(key)) fail(`${field}.${key} is not supported`);
  }
}
function identifier(value, field) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${field} must be a safe identifier string`);
  return value;
}
function actor(value, field) { return value === undefined || value === null ? null : identifier(value, field); }
function timestamp(value, field, defaultValue) {
  if (value === undefined || value === null) return defaultValue;
  if (!Number.isInteger(value) || value < 0 || value > MAX_UNIX_SECONDS) fail(`${field} must be a Unix-seconds integer from 0 through ${MAX_UNIX_SECONDS}`);
  return value;
}
function purpose(value) {
  if (value !== PURPOSE) fail(`purpose must be ${PURPOSE}`);
  return PURPOSE;
}
function source(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.provider !== 'github') fail('source must contain provider, repository, and ref');
  const repository = normalizeGithubRepository(value.repository, 'source.repository');
  if (typeof value.ref !== 'string' || !value.ref || /\s/.test(value.ref) || value.ref.split('/').includes('..')) fail('source.ref must be a non-empty ref without whitespace or parent segments');
  return { provider: 'github', repository, ref: value.ref };
}
function toRequest(row) {
  if (!row) return null;
  return {
    id: row.id, ownerUsername: row.owner_username,
    source: { provider: 'github', repository: row.source_repository, ref: row.source_ref },
    purpose: row.purpose, status: row.status, requestedBy: row.requested_by, decidedBy: row.decided_by,
    requestedAt: row.requested_at, decidedAt: row.decided_at, expiresAt: row.expires_at,
    revokedBy: row.revoked_by, revokedAt: row.revoked_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function toEvent(row) {
  return { id: row.id, requestId: row.request_id, ownerUsername: row.owner_username,
    source: { provider: 'github', repository: row.source_repository, ref: row.source_ref },
    purpose: row.purpose, event: row.event, actor: row.actor, occurredAt: row.occurred_at };
}
function appendEvent(db, request, event, eventActor, occurredAt) {
  db.prepare(`INSERT INTO github_private_access_events
    (id, request_id, owner_username, source_repository, source_ref, purpose, event, actor, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(generateId('github_private_access_event'), request.id, request.owner_username, request.source_repository,
      request.source_ref, PURPOSE, event, eventActor, occurredAt);
}

/** Creates an auditable pending request; this store never accepts or persists credential material. */
export function createGithubPrivateAccessRequest(input) {
  onlyKeys(input, new Set(['ownerUsername', 'source', 'purpose', 'requestedBy', 'requestedAt']), 'input');
  const ownerUsername = identifier(input.ownerUsername, 'ownerUsername');
  const requestedSource = source(input.source); purpose(input.purpose);
  const requestedBy = actor(input.requestedBy, 'requestedBy');
  const now = timestamp(input.requestedAt, 'requestedAt', Math.floor(Date.now() / 1000));
  const db = getDb();
  return db.transaction(() => {
    const id = generateId('github_private_access_request');
    db.prepare(`INSERT INTO github_private_access_requests
      (id, owner_username, source_repository, source_ref, purpose, status, requested_by, requested_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
      .run(id, ownerUsername, requestedSource.repository, requestedSource.ref, PURPOSE, requestedBy, now, now, now);
    const row = db.prepare('SELECT * FROM github_private_access_requests WHERE id = ?').get(id);
    appendEvent(db, row, 'requested', requestedBy, now);
    return toRequest(row);
  })();
}

export function listGithubPrivateAccessRequests(input) {
  onlyKeys(input, new Set(['ownerUsername']), 'input');
  const ownerUsername = identifier(input.ownerUsername, 'ownerUsername');
  return getDb().prepare('SELECT * FROM github_private_access_requests WHERE owner_username = ? ORDER BY requested_at DESC, id DESC').all(ownerUsername).map(toRequest);
}

export function decideGithubPrivateAccessRequest(input) {
  onlyKeys(input, new Set(['ownerUsername', 'requestId', 'status', 'decidedBy', 'decidedAt', 'expiresAt']), 'input');
  const ownerUsername = identifier(input.ownerUsername, 'ownerUsername');
  const requestId = identifier(input.requestId, 'requestId');
  if (!DECISIONS.has(input.status)) fail('status must be approved or rejected');
  const decidedBy = actor(input.decidedBy, 'decidedBy');
  const decidedAt = timestamp(input.decidedAt, 'decidedAt', Math.floor(Date.now() / 1000));
  // Read authorization is persistent until explicitly revoked. A legacy expiry may
  // be accepted only to keep old API clients compatible, but it is not persisted.
  if (input.status === 'approved' && OWN.call(input, 'expiresAt')) timestamp(input.expiresAt, 'expiresAt', decidedAt + 1);
  if (input.status === 'rejected' && OWN.call(input, 'expiresAt')) fail('expiresAt is only supported for approved status');
  const expiresAt = null;
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM github_private_access_requests WHERE id = ? AND owner_username = ?').get(requestId, ownerUsername);
    if (!row) fail(`unknown request ${requestId}`);
    if (row.status !== 'pending') fail('only pending requests can be decided');
    db.prepare(`UPDATE github_private_access_requests SET status = ?, decided_by = ?, decided_at = ?, expires_at = ?, updated_at = ?
      WHERE id = ? AND owner_username = ?`).run(input.status, decidedBy, decidedAt, expiresAt, decidedAt, requestId, ownerUsername);
    const updated = db.prepare('SELECT * FROM github_private_access_requests WHERE id = ?').get(requestId);
    appendEvent(db, updated, input.status, decidedBy, decidedAt);
    return toRequest(updated);
  })();
}

export function revokeGithubPrivateAccessApproval(input) {
  onlyKeys(input, new Set(['ownerUsername', 'requestId', 'revokedBy', 'revokedAt']), 'input');
  const ownerUsername = identifier(input.ownerUsername, 'ownerUsername');
  const requestId = identifier(input.requestId, 'requestId');
  const revokedBy = actor(input.revokedBy, 'revokedBy');
  const revokedAt = timestamp(input.revokedAt, 'revokedAt', Math.floor(Date.now() / 1000));
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM github_private_access_requests WHERE id = ? AND owner_username = ?').get(requestId, ownerUsername);
    if (!row) fail(`unknown request ${requestId}`);
    if (row.status !== 'approved') fail('only approved requests can be revoked');
    db.prepare(`UPDATE github_private_access_requests SET status = 'revoked', revoked_by = ?, revoked_at = ?, updated_at = ?
      WHERE id = ? AND owner_username = ?`).run(revokedBy, revokedAt, revokedAt, requestId, ownerUsername);
    const updated = db.prepare('SELECT * FROM github_private_access_requests WHERE id = ?').get(requestId);
    appendEvent(db, updated, 'revoked', revokedBy, revokedAt);
    return toRequest(updated);
  })();
}

/** Returns the matching approved record only while its exact source pin remains unexpired; otherwise null. */
export function getEffectiveGithubPrivateAccessAuthorization(input) {
  onlyKeys(input, new Set(['ownerUsername', 'source', 'purpose', 'at']), 'input');
  const ownerUsername = identifier(input.ownerUsername, 'ownerUsername');
  const requestedSource = source(input.source); purpose(input.purpose);
  const at = timestamp(input.at, 'at', Math.floor(Date.now() / 1000));
  const row = getDb().prepare(`SELECT * FROM github_private_access_requests
    WHERE owner_username = ? AND source_repository = ? AND source_ref = ?
      AND purpose = 'read_only' AND status = 'approved'
      AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY decided_at DESC, id DESC LIMIT 1`).get(ownerUsername, requestedSource.repository, requestedSource.ref, at);
  return toRequest(row);
}

export function listGithubPrivateAccessEvents(input) {
  onlyKeys(input, new Set(['ownerUsername', 'requestId']), 'input');
  const ownerUsername = identifier(input.ownerUsername, 'ownerUsername');
  if (input.requestId !== undefined) {
    return getDb().prepare('SELECT * FROM github_private_access_events WHERE owner_username = ? AND request_id = ? ORDER BY occurred_at ASC, id ASC')
      .all(ownerUsername, identifier(input.requestId, 'requestId')).map(toEvent);
  }
  return getDb().prepare('SELECT * FROM github_private_access_events WHERE owner_username = ? ORDER BY occurred_at ASC, id ASC').all(ownerUsername).map(toEvent);
}
