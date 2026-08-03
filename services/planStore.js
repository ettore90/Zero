import { getDb } from '../db.js';
import { normalizePlanStatus } from './planState.js';

const db = () => getDb();
const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
const now = () => Date.now();

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const requestId = typeof record.requestId === 'string' ? record.requestId.trim() : '';
  const planKey = typeof record.planKey === 'string' ? record.planKey.trim() : requestId;
  const username = typeof record.username === 'string' ? record.username.trim() : '';
  if (!requestId || !planKey || !username) return null;
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload : {};
  return {
    ...clone(record),
    requestId,
    planKey,
    username,
    agentId: typeof record.agentId === 'string' ? record.agentId.trim() : null,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId.trim() : null,
    tool_call_id: typeof record.tool_call_id === 'string' ? record.tool_call_id.trim() : null,
    status: normalizePlanStatus(record.status) || 'open',
    payload,
    decision: record.decision && typeof record.decision === 'object' ? record.decision : null,
    createdAt: Number.isFinite(Number(record.createdAt)) ? Number(record.createdAt) : now(),
    updatedAt: Number.isFinite(Number(record.updatedAt)) ? Number(record.updatedAt) : now(),
  };
}

function normalizeLookupKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const stmts = () => {
  const database = db();
  return {
    upsert: database.prepare(`
      INSERT INTO strategy_plans (plan_key, request_id, username, agent_id, session_id, tool_call_id, status, payload, decision, created_at, updated_at)
      VALUES (@plan_key, @request_id, @username, @agent_id, @session_id, @tool_call_id, @status, @payload, @decision, @created_at, @updated_at)
      ON CONFLICT(plan_key) DO UPDATE SET
        request_id = excluded.request_id,
        username = excluded.username,
        agent_id = excluded.agent_id,
        session_id = excluded.session_id,
        tool_call_id = excluded.tool_call_id,
        status = excluded.status,
        payload = excluded.payload,
        decision = excluded.decision,
        updated_at = excluded.updated_at
    `),
    getByPlanKey: database.prepare('SELECT * FROM strategy_plans WHERE plan_key = ?'),
    getByRequestId: database.prepare('SELECT * FROM strategy_plans WHERE request_id = ?'),
    all: database.prepare('SELECT * FROM strategy_plans ORDER BY updated_at DESC'),
    delete: database.prepare('DELETE FROM strategy_plans WHERE plan_key = ? OR request_id = ?'),
  };
};

function rowToRecord(row) {
  if (!row) return null;
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch (error) {
    throw new Error(`Failed to parse strategy_plans payload for request_id ${row.request_id}`);
  }

  let decision;
  if (row.decision == null) {
    decision = null;
  } else {
    try {
      decision = JSON.parse(row.decision);
    } catch (error) {
      throw new Error(`Failed to parse strategy_plans decision for request_id ${row.request_id}`);
    }
  }

  return {
    planKey: row.plan_key,
    requestId: row.request_id,
    username: row.username,
    agentId: row.agent_id,
    sessionId: row.session_id,
    tool_call_id: row.tool_call_id,
    status: normalizePlanStatus(row.status) || 'open',
    payload,
    decision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function upsertPlan(record) {
  const normalized = normalizeRecord(record);
  if (!normalized) return null;
  const stmt = stmts().upsert;
  stmt.run({
    plan_key: normalized.planKey,
    request_id: normalized.requestId,
    username: normalized.username,
    agent_id: normalized.agentId,
    session_id: normalized.sessionId,
    tool_call_id: normalized.tool_call_id,
    status: normalized.status,
    payload: JSON.stringify(normalized.payload),
    decision: normalized.decision ? JSON.stringify(normalized.decision) : null,
    created_at: normalized.createdAt,
    updated_at: normalized.updatedAt,
  });
  return clone(normalized);
}

export function getPlan(identifier) {
  const key = normalizeLookupKey(identifier);
  if (!key) return null;
  const byPlanKey = rowToRecord(stmts().getByPlanKey.get(key));
  if (byPlanKey) return byPlanKey;
  return rowToRecord(stmts().getByRequestId.get(key));
}

export function deletePlan(identifier) {
  const key = normalizeLookupKey(identifier);
  if (!key) return false;
  return stmts().delete.run(key, key).changes > 0;
}

export function listPlans() {
  return stmts().all.all().map(rowToRecord).filter(Boolean);
}

export function hydratePlanStore() {
  return listPlans();
}
