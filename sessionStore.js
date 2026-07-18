// =============================================================================
// sessionStore.js — SQLite-backed session persistence
// =============================================================================
// Replaces the previous JSON-file implementation that caused 20MB reads on
// every operation. All session data is now stored in SQLite (WAL mode).
// =============================================================================

import { getDb } from './db.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Timestamps in the DB are a mix: older rows used Unix seconds (10 digits),
// newer rows used milliseconds (13 digits). Normalise everything to ms on read
// and always write ms going forward.
function _toMs(ts) {
  if (!ts) return Date.now();
  // 10-digit number → seconds; multiply to get ms
  return ts < 1e12 ? ts * 1000 : ts;
}

function _normalizeSessionNotes(session) {
  if (!session) return session;

  const normalized = { ...session };
  normalized.notes = Array.isArray(normalized.notes) ? normalized.notes.filter(Boolean) : [];
  normalized.activeNoteId = normalized.activeNoteId || normalized.notes.find((note) => note && note.noteId)?.noteId || null;

  return normalized;
}

function _rowToSession(row) {
  if (!row) return null;
  const data = JSON.parse(row.data || '{}');
  return _normalizeSessionNotes({
    id: row.id,
    agentId: row.agent_id,
    title: row.title,
    createdAt: _toMs(row.created_at),
    updatedAt: _toMs(row.updated_at),
    ...data,
  });
}

function _sessionToRow(session) {
  // Extract known top-level fields; everything else goes into data blob
  const normalized = _normalizeSessionNotes(session);
  const { id, agentId, title, createdAt, updatedAt, ...rest } = normalized;
  return {
    id,
    agent_id: agentId || null,
    title: title || null,
    created_at: createdAt || Date.now(),  // always store as ms going forward
    updated_at: Date.now(),
    data: JSON.stringify(rest),
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * createSessionStore(filePath)
 *
 * The filePath parameter is kept for API compatibility but is no longer used
 * for storage — SQLite is used instead.
 */
export function createSessionStore(_filePath) {
  const db = getDb();

  // Prepared statements (created once, reused)
  const stmts = {
    getAll:         db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC'),
    getById:        db.prepare('SELECT * FROM sessions WHERE id = ?'),
    byAgent:        db.prepare('SELECT * FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC'),
    byUsername:     db.prepare("SELECT * FROM sessions WHERE json_extract(data, '$.username') = ? ORDER BY updated_at DESC"),
    byUsernameAgent:db.prepare("SELECT * FROM sessions WHERE json_extract(data, '$.username') = ? AND agent_id = ? ORDER BY updated_at DESC"),
    upsert:         db.prepare(`
      INSERT INTO sessions (id, agent_id, title, created_at, updated_at, data)
      VALUES (@id, @agent_id, @title, @created_at, @updated_at, @data)
      ON CONFLICT(id) DO UPDATE SET
        agent_id   = excluded.agent_id,
        title      = excluded.title,
        updated_at = excluded.updated_at,
        data       = excluded.data
    `),
    delete:         db.prepare('DELETE FROM sessions WHERE id = ?'),
    count:          db.prepare('SELECT COUNT(*) as n FROM sessions'),
  };

  const store = {
    // ── Core read ────────────────────────────────────────────────────────────

    /** Returns all sessions as an array, newest first. */
    getAll() {
      return stmts.getAll.all().map(_rowToSession);
    },

    /** Returns a single session by ID, or null. */
    get(id) {
      return _rowToSession(stmts.getById.get(id));
    },

    /** Alias used by routes and llmService. */
    getSession(id) {
      return this.get(id);
    },

    /**
     * getSessions(username?, agentId?)
     * - No args  → all sessions (array)
     * - username only → sessions for that user
     * - username + agentId → sessions for that user+agent
     */
    getSessions(username, agentId) {
      if (!username) return stmts.getAll.all().map(_rowToSession);
      if (agentId)   return stmts.byUsernameAgent.all(username, agentId).map(_rowToSession);
      return stmts.byUsername.all(username).map(_rowToSession);
    },

    // ── Core write ───────────────────────────────────────────────────────────

    /** Upsert a session. Returns the saved session. */
    save(session) {
      const row = _sessionToRow(session);
      stmts.upsert.run(row);
      return this.get(session.id);
    },

    /** Alias used by routes. */
    saveSession(session) {
      return this.save(session);
    },

    /** Delete a session by ID. Returns true if a row was deleted. */
    delete(id) {
      const info = stmts.delete.run(id);
      return info.changes > 0;
    },

    /** Alias used by routes and llmService. */
    deleteSession(id) {
      return this.delete(id);
    },

    // ── Session lifecycle ────────────────────────────────────────────────────

    /**
     * ensureSession({ id, agentId, username, title? })
     * Returns existing session or creates a new one.
     */
    ensureSession({ id, agentId, username, title }) {
      let session = this.get(id);
      if (!session) {
        session = {
          id,
          agentId,
          username,
          title: title || 'New Session',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        this.save(session);
      }
      return session;
    },

    // ── Message helpers ──────────────────────────────────────────────────────

    /**
     * setMessages(sessionId, messages)
     * Replaces the messages array for a session.
     */
    setMessages(sessionId, messages) {
      const session = this.get(sessionId);
      if (!session) return;
      session.messages = messages;
      session.updatedAt = Date.now();
      this.save(session);
    },

    /**
     * appendMessages(sessionId, newMessages)
     * Appends messages to an existing session.
     */
    appendMessages(sessionId, newMessages) {
      const session = this.get(sessionId);
      if (!session) return;
      session.messages = [...(session.messages || []), ...newMessages];
      session.updatedAt = Date.now();
      this.save(session);
    },

    // ── Bulk / legacy ────────────────────────────────────────────────────────

    /**
     * setSessions({ [id]: session, ... })
     * Legacy bulk-replace used during migration. Wraps in a transaction.
     */
    setSessions(sessionsMap) {
      const upsertMany = db.transaction((entries) => {
        for (const session of entries) {
          stmts.upsert.run(_sessionToRow(session));
        }
      });
      upsertMany(Object.values(sessionsMap));
    },

    /** Returns the count of stored sessions. */
    count() {
      return stmts.count.get().n;
    },

    // ── No-op stubs for API compatibility ────────────────────────────────────

    /** No-op: SQLite writes are synchronous. Kept for API compatibility. */
    async flush() {},

    /** No-op: no in-memory cache to invalidate. */
    reload() {},
  };

  return store;
}
