import crypto from 'crypto';
import { getDb } from '../db.js';
import { sanitizeUsername } from './userStateService.js';

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function normalizeUsername(username) {
  return sanitizeUsername(username).trim();
}

function userRowToApi(row) {
  if (!row) return null;
  let metadata = {};
  try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch {}
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    email: row.email || null,
    role: row.role || 'admin',
    isActive: Boolean(row.is_active),
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionRowToApi(row) {
  if (!row) return null;
  let metadata = {};
  try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch {}
  return {
    id: row.id,
    userId: row.user_id,
    token: row.session_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    metadata,
  };
}

function stableUserId(username) {
  return `user-${crypto.createHash('sha1').update(normalizeUsername(username)).digest('hex').slice(0, 12)}`;
}

function getStmt() {
  const db = getDb();
  return {
    listUsers: db.prepare('SELECT * FROM users ORDER BY updated_at DESC, created_at ASC'),
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    insertUser: db.prepare(`
      INSERT INTO users (id, username, display_name, email, role, is_active, created_at, updated_at, metadata)
      VALUES (@id, @username, @display_name, @email, @role, @is_active, @created_at, @updated_at, @metadata)
    `),
    updateUser: db.prepare(`
      UPDATE users
      SET username = @username,
          display_name = @display_name,
          email = @email,
          role = @role,
          is_active = @is_active,
          metadata = @metadata,
          updated_at = @updated_at
      WHERE id = @id
    `),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    ensurePrefs: db.prepare(`
      INSERT OR IGNORE INTO user_preferences (user_id, preferences, created_at, updated_at)
      VALUES (?, '{}', ?, ?)
    `),
    listSessionsByUserId: db.prepare('SELECT * FROM user_sessions WHERE user_id = ? ORDER BY updated_at DESC'),
    getSessionByToken: db.prepare('SELECT * FROM user_sessions WHERE session_token = ?'),
    getSessionById: db.prepare('SELECT * FROM user_sessions WHERE id = ?'),
    insertSession: db.prepare(`
      INSERT INTO user_sessions (id, user_id, session_token, created_at, updated_at, expires_at, last_seen_at, metadata)
      VALUES (@id, @user_id, @session_token, @created_at, @updated_at, @expires_at, @last_seen_at, @metadata)
    `),
    touchSession: db.prepare(`
      UPDATE user_sessions
      SET updated_at = @updated_at,
          last_seen_at = @last_seen_at,
          metadata = @metadata
      WHERE id = @id
    `),
    deleteSessionByToken: db.prepare('DELETE FROM user_sessions WHERE session_token = ?'),
    deleteSessionsByUserId: db.prepare('DELETE FROM user_sessions WHERE user_id = ?'),
  };
}

export function listUsers() {
  return getStmt().listUsers.all().map(userRowToApi);
}

export function getUserByUsername(username) {
  return userRowToApi(getStmt().getUserByUsername.get(normalizeUsername(username)));
}

export function getUserById(userId) {
  return userRowToApi(getStmt().getUserById.get(userId));
}

export function ensureUser(username, overrides = {}) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;

  const existing = getStmt().getUserByUsername.get(normalized);
  if (existing) {
    return userRowToApi(existing);
  }

  const ts = nowSec();
  const id = stableUserId(normalized);
  getStmt().insertUser.run({
    id,
    username: normalized,
    display_name: overrides.displayName || normalized,
    email: overrides.email || null,
    role: 'admin',
    is_active: 1,
    created_at: ts,
    updated_at: ts,
    metadata: JSON.stringify(overrides.metadata || { source: 'ensure-user' }),
  });
  getStmt().ensurePrefs.run(id, ts, ts);
  return getUserById(id);
}

export function createUser(payload = {}) {
  const username = normalizeUsername(payload.username);
  if (!username) throw new Error('username required');
  if (getStmt().getUserByUsername.get(username)) throw new Error('username already exists');
  return ensureUser(username, {
    displayName: payload.displayName || username,
    email: payload.email || null,
    metadata: payload.metadata || { source: 'users-api' },
  });
}

export function updateUser(userId, payload = {}) {
  const row = getStmt().getUserById.get(userId);
  if (!row) return null;
  const ts = nowSec();
  let metadata = {};
  try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch {}
  if (payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)) {
    metadata = { ...metadata, ...payload.metadata };
  }
  const username = sanitizeUsername(payload.username || row.username).trim();
  getStmt().updateUser.run({
    id: row.id,
    username,
    display_name: payload.displayName ?? row.display_name,
    email: payload.email ?? row.email,
    role: 'admin',
    is_active: payload.isActive === undefined ? row.is_active : (payload.isActive ? 1 : 0),
    metadata: JSON.stringify(metadata),
    updated_at: ts,
  });
  return getUserById(row.id);
}

export function deleteUser(userId) {
  const row = getStmt().getUserById.get(userId);
  if (!row) return false;
  getStmt().deleteSessionsByUserId.run(userId);
  const info = getStmt().deleteUser.run(userId);
  return info.changes > 0;
}

export function createLoginSession(username, metadata = {}) {
  const user = ensureUser(username, { metadata: { source: 'login' } });
  const ts = nowSec();
  const token = `local-${crypto.randomUUID()}`;
  const sessionId = `sess-${crypto.randomUUID()}`;
  getStmt().insertSession.run({
    id: sessionId,
    user_id: user.id,
    session_token: token,
    created_at: ts,
    updated_at: ts,
    expires_at: null,
    last_seen_at: ts,
    metadata: JSON.stringify(metadata || {}),
  });
  return { user, session: sessionRowToApi(getStmt().getSessionById.get(sessionId)) };
}

export function resolveSessionFromRequest(req) {
  const authHeader = String(req.headers.authorization || '');
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const token = String(req.headers['x-session-token'] || req.query?.token || req.query?.sessionToken || bearer || '').trim();
  if (!token) return null;
  const row = getStmt().getSessionByToken.get(token);
  if (!row) return null;
  const ts = nowSec();
  let metadata = {};
  try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch {}
  metadata.lastResolvedVia = 'request';
  getStmt().touchSession.run({ id: row.id, updated_at: ts, last_seen_at: ts, metadata: JSON.stringify(metadata) });
  return {
    session: sessionRowToApi(getStmt().getSessionById.get(row.id)),
    user: getUserById(row.user_id),
  };
}

export function logoutByToken(token) {
  if (!token) return false;
  const info = getStmt().deleteSessionByToken.run(String(token));
  return info.changes > 0;
}
