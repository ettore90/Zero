import { randomUUID } from 'crypto';
import { getDb } from '../db.js';
import { deleteAgentState, readState, getAgents, saveConfig, getRawState } from './userStateService.js';
import { getCurrentPromptVersion, getPromptDocumentByKeyNoBootstrap } from './promptStore.js';

const USERNAME_AGENT_ALLOWLIST = Object.freeze({});

function now() {
  return Date.now();
}


function normalizeAgents(agents) {
  return Array.isArray(agents) ? agents : [];
}

function stripNonCanonicalSessionFields(agent) {
  if (!agent || typeof agent !== 'object') return agent;
  const { sessions, history, ...rest } = agent;
  return rest;
}

function safeJsonParse(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToAgent(row) {
  if (!row) return null;
  const data = safeJsonParse(row.data, {});
  const role = data.role || (Boolean(row.is_master) ? 'master' : (String(data.name || '').toLowerCase().includes('summary') || String(data.name || '').toLowerCase().includes('memorymaintenance') ? 'infra' : 'worker'));
  const tags = Array.isArray(data.tags) ? Array.from(new Set([role, ...data.tags.map(String)])) : [role];
  const agent = {
    ...data,
    id: row.id,
    username: row.username,
    isMaster: role === 'master',
    role,
    executionMode: data.executionMode || (role === 'infra' ? 'flex' : role === 'master' ? 'flex' : 'strict'),
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  const promptDocument = getPromptDocumentByKeyNoBootstrap(`agent:${String(agent.username ?? '')}:${String(agent.id ?? '')}`);
  const currentPromptVersion = promptDocument?.id ? getCurrentPromptVersion(promptDocument.id) : null;
  const systemPrompt = typeof currentPromptVersion?.content === 'string' ? currentPromptVersion.content : agent.systemPrompt;
  return {
    ...agent,
    promptDocumentId: promptDocument?.id || agent.promptDocumentId || null,
    systemPrompt: systemPrompt ?? agent.systemPrompt,
  };
}

function getStmt(db) {
  return {
    list: db.prepare('SELECT * FROM agents WHERE username = ? ORDER BY is_master DESC, updated_at DESC, created_at ASC'),
    get: db.prepare('SELECT * FROM agents WHERE username = ? AND id = ?'),
    insert: db.prepare(`
      INSERT INTO agents (id, username, name, is_master, data, created_at, updated_at)
      VALUES (@id, @username, @name, @is_master, @data, @created_at, @updated_at)
    `),
    update: db.prepare(`
      UPDATE agents
      SET name = @name,
          is_master = @is_master,
          data = @data,
          updated_at = @updated_at
      WHERE username = @username AND id = @id
    `),
    delete: db.prepare('DELETE FROM agents WHERE username = ? AND id = ?'),
    deleteByUsername: db.prepare('DELETE FROM agents WHERE username = ?'),
  };
}

export function listAgents(username) {
  const db = getDb();
  const { list } = getStmt(db);
  return list.all(String(username)).map(rowToAgent).filter(Boolean);
}

function getDeletedAgentIds(username) {
  const state = getRawState(username) || {};
  const deletedIds = state?.__meta?.agents?.deletedIds;
  return Array.isArray(deletedIds) ? deletedIds.map(String) : [];
}

function getVisibleAgents(username) {
  return listAgents(username);
}

function getRawAgentRow(username, id) {
  const db = getDb();
  return getStmt(db).get.get(String(username), String(id));
}

function getResolvableAgent(username, id) {
  return getVisibleAgents(username).find((agent) => String(agent?.id) === String(id)) || null;
}

function getCanonicalPromptDocumentId(username, id) {
  const promptDocument = getPromptDocumentByKeyNoBootstrap(`agent:${String(username ?? '')}:${String(id ?? '')}`);
  return promptDocument?.id || null;
}

export function deleteVisibleAgent(username, id) {
  const targetId = String(id);
  const existing = getResolvableAgent(username, targetId);
  if (!existing) return false;

  if (String(existing.username ?? username) !== String(username)) {
    return deleteAgent(String(existing.username ?? username), targetId);
  }

  return deleteAgent(String(username), targetId);
}

export function importLegacyAgents(username, agents, { replace = false } = {}) {
  const normalized = normalizeAgents(agents);
  if (replace) return replaceAgents(username, normalized);

  const deletedIds = new Set(getDeletedAgentIds(username));
  const existing = listCanonicalVisibleAgents(username);
  const existingById = new Map(existing.map((agent) => [String(agent.id), agent]));
  let changed = false;

  for (const agent of normalized) {
    const id = String(agent?.id || '');
    if (!id || existingById.has(id) || deletedIds.has(id)) continue;
    upsertAgent(username, agent);
    changed = true;
  }

  return changed ? listCanonicalVisibleAgents(username) : existing;
}

export function migrateLegacyJsonAgents(username, options = {}) {
  const state = readState(username) || {};
  const hadLegacyAgents = Array.isArray(state?.agents) && state.agents.length > 0;
  const legacyAgents = getAgents(username);

  if (!legacyAgents.length) {
    if (hadLegacyAgents) {
      const { agents: _removedAgents, ...rest } = state;
      saveConfig(username, rest);
    }
    return { migrated: false, cleaned: hadLegacyAgents, agents: listCanonicalVisibleAgents(username) };
  }

  const before = listCanonicalVisibleAgents(username);
  const next = importLegacyAgents(username, legacyAgents, options);
  const migrated = next.length !== before.length || next.some((agent, index) => JSON.stringify(agent) !== JSON.stringify(before[index]));

  const { agents: _removedAgents, ...rest } = state;
  saveConfig(username, rest);

  return { migrated, cleaned: true, agents: next };
}

export function getAgent(username, id) {
  const db = getDb();
  const { get } = getStmt(db);
  return rowToAgent(get.get(String(username), String(id)));
}

export function getVisibleAgent(username, id) {
  return getResolvableAgent(username, id);
}

export function listCanonicalVisibleAgents(username) {
  return getVisibleAgents(username);
}

export function upsertAgent(username, agent) {
  const db = getDb();
  const stmts = getStmt(db);
  const id = String(agent?.id || randomUUID());
  const deletedIds = new Set(getDeletedAgentIds(username));
  const allowlist = USERNAME_AGENT_ALLOWLIST[String(username)] || null;
  if (allowlist && !allowlist.has(id)) {
    const error = new Error(`Agent ${id} is not allowed for username ${username}.`);
    error.code = 'AGENT_NOT_ALLOWED';
    throw error;
  }
  const existingRow = getRawAgentRow(username, id);
  const existing = rowToAgent(existingRow);

  if (deletedIds.has(id) && !existing) {
    const error = new Error(`Agent ${id} is tombstoned and cannot be recreated.`);
    error.code = 'TOMBSTONED_AGENT';
    throw error;
  }

  if (deletedIds.has(id)) return existing;

  const nextUpdatedAt = now();
  const base = existing || {};
  const nextAgent = {
    ...stripNonCanonicalSessionFields(base),
    ...stripNonCanonicalSessionFields(agent),
    id,
    username: String(username),
    updatedAt: nextUpdatedAt,
    createdAt: existing?.createdAt || existing?.created_at || nextUpdatedAt,
  };
  const row = {
    id,
    username: String(username),
    name: nextAgent.name || null,
    is_master: nextAgent.isMaster ? 1 : 0,
    data: JSON.stringify(nextAgent),
    created_at: existing ? (existing.createdAt || existing.created_at || nextUpdatedAt) : nextUpdatedAt,
    updated_at: nextUpdatedAt,
  };
  if (existing) stmts.update.run(row);
  else stmts.insert.run(row);
  return rowToAgent({ ...row, data: row.data });
}

export function replaceAgents(username, agents, options = {}) {
  const items = normalizeAgents(agents);
  const preserveExisting = options.preserveExisting !== false;
  const deletedIds = new Set(getDeletedAgentIds(username));

  if (preserveExisting) {
    const existing = listCanonicalVisibleAgents(username);
    const existingById = new Map(existing.map((agent) => [String(agent.id), agent]));
    const merged = items.filter((agent) => {
      const id = String(agent?.id || '');
      return !id || !deletedIds.has(id);
    }).map((agent) => {
      const id = String(agent?.id || '');
      const current = id ? existingById.get(id) : null;
      return current
        ? { ...stripNonCanonicalSessionFields(current), ...stripNonCanonicalSessionFields(agent), id: current.id, username: String(username) }
        : stripNonCanonicalSessionFields(agent);
    });

    const db = getDb();
    const stmts = getStmt(db);
    const tx = db.transaction((rows) => {
      stmts.deleteByUsername.run(String(username));
      for (const agent of rows) {
        const id = String(agent?.id || randomUUID());
        const current = existingById.get(id);
        const createdAt = Number(agent?.createdAt || agent?.created_at || current?.createdAt || current?.created_at || now());
        const updatedAt = Number(agent?.updatedAt || agent?.updated_at || now());
        stmts.insert.run({
          id,
          username: String(username),
          name: agent?.name || null,
          is_master: agent?.isMaster ? 1 : 0,
          data: JSON.stringify({ ...stripNonCanonicalSessionFields(agent), id, username: String(username), createdAt, updatedAt }),
          created_at: createdAt,
          updated_at: updatedAt,
        });
      }
    });
    tx(merged);
    return listAgents(username);
  }

  const db = getDb();
  const stmts = getStmt(db);
  const tx = db.transaction((rows) => {
    stmts.deleteByUsername.run(String(username));
    for (const agent of rows.filter((item) => {
      const id = String(item?.id || '');
      return !id || !deletedIds.has(id);
    })) {
      const id = String(agent?.id || randomUUID());
      const createdAt = Number(agent?.createdAt || agent?.created_at || now());
      const updatedAt = Number(agent?.updatedAt || agent?.updated_at || now());
      stmts.insert.run({
        id,
        username: String(username),
        name: agent?.name || null,
        is_master: agent?.isMaster ? 1 : 0,
        data: JSON.stringify({ ...stripNonCanonicalSessionFields(agent), id, username: String(username), createdAt, updatedAt }),
        created_at: createdAt,
        updated_at: updatedAt,
      });
    }
  });
  tx(items);
  return listAgents(username);
}

export function deleteAgent(username, id) {
  const db = getDb();
  const { delete: del } = getStmt(db);
  const result = del.run(String(username), String(id));
  if (result.changes > 0) deleteAgentState(username, id);
  return result.changes > 0;
}

export function clearAgents(username) {
  const db = getDb();
  const { deleteByUsername } = getStmt(db);
  deleteByUsername.run(String(username));
}
