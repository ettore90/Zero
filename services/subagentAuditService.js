import { getDb } from '../db.js';

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_CHARS = 12000;
const DEFAULT_MAX_LOG_ITEMS = 200;

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function truncateMiddle(text, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
  const value = String(text || '');
  if (value.length <= maxChars) return value;
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.floor(maxChars * 0.3);
  return `${value.slice(0, head)}\n\n...[truncated ${value.length - head - tail} chars]...\n\n${value.slice(value.length - tail)}`;
}

function serializeJson(value, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return truncateMiddle(raw, maxChars);
}

function normalizeAuditMetadata(metadata, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata ?? null;
  const normalized = { ...metadata };
  if (normalized.finalContentRawPreview !== undefined) {
    normalized.finalContentRawPreview = truncateMiddle(normalized.finalContentRawPreview || '', maxChars);
  }
  if (normalized.errorMessage !== undefined) {
    normalized.errorMessage = truncateMiddle(normalized.errorMessage || '', 2000);
  }
  return normalized;
}

function normalizeLogItem(item = {}) {
  return {
    ts: Number(item.ts) || Date.now(),
    type: String(item.type || 'event'),
    iteration: Number(item.iteration) || 0,
    toolName: item.toolName || null,
    data: item.data ?? null,
  };
}

export function createSubagentAudit({ username, agentId, agentName, orchestratorAgentId = null, task, parentAuditId = null, rootAuditId = null, metadata = {}, ttlMs = DEFAULT_TTL_MS }) {
  const db = getDb();
  const now = Date.now();
  const id = `subaudit-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const resolvedRootId = rootAuditId || parentAuditId || id;

  db.prepare(`
    INSERT INTO subagent_audit (
      id, parent_audit_id, root_audit_id, username, agent_id, agent_name,
      orchestrator_agent_id, task, status, iteration_count, repeated_call_killed,
      final_answer, tool_summary, execution_log, started_at, completed_at, expires_at, metadata
    ) VALUES (
      @id, @parent_audit_id, @root_audit_id, @username, @agent_id, @agent_name,
      @orchestrator_agent_id, @task, 'running', 0, 0,
      NULL, '[]', '[]', @started_at, NULL, @expires_at, @metadata
    )
  `).run({
    id,
    parent_audit_id: parentAuditId,
    root_audit_id: resolvedRootId,
    username,
    agent_id: agentId,
    agent_name: agentName || null,
    orchestrator_agent_id: orchestratorAgentId,
    task: String(task || ''),
    started_at: now,
    expires_at: now + ttlMs,
    metadata: JSON.stringify(metadata || {}),
  });

  return { id, rootAuditId: resolvedRootId, expiresAt: now + ttlMs };
}

export function appendSubagentAuditLog(auditId, logItem, maxItems = DEFAULT_MAX_LOG_ITEMS) {
  if (!auditId) return;
  const db = getDb();
  const row = db.prepare('SELECT execution_log FROM subagent_audit WHERE id = ?').get(auditId);
  if (!row) return;
  const current = Array.isArray(safeJsonParse(row.execution_log, [])) ? safeJsonParse(row.execution_log, []) : [];
  current.push(normalizeLogItem(logItem));
  const trimmed = current.slice(-maxItems);
  db.prepare('UPDATE subagent_audit SET execution_log = ? WHERE id = ?').run(JSON.stringify(trimmed), auditId);
}

export function updateSubagentAudit(auditId, patch = {}) {
  if (!auditId) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM subagent_audit WHERE id = ?').get(auditId);
  if (!row) return;

  const next = {
    status: patch.status || row.status,
    iteration_count: patch.iterationCount ?? row.iteration_count,
    repeated_call_killed: patch.repeatedCallKilled ? 1 : row.repeated_call_killed,
    final_answer: patch.finalAnswer ?? row.final_answer,
    tool_summary: patch.toolSummary ? JSON.stringify(patch.toolSummary) : row.tool_summary,
    execution_log: patch.executionLog ? JSON.stringify(patch.executionLog.map(normalizeLogItem)) : row.execution_log,
    completed_at: patch.completedAt ?? row.completed_at,
    metadata: patch.metadata ? JSON.stringify(normalizeAuditMetadata(patch.metadata)) : row.metadata,
  };

  db.prepare(`
    UPDATE subagent_audit
       SET status = @status,
           iteration_count = @iteration_count,
           repeated_call_killed = @repeated_call_killed,
           final_answer = @final_answer,
           tool_summary = @tool_summary,
           execution_log = @execution_log,
           completed_at = @completed_at,
           metadata = @metadata
     WHERE id = @id
  `).run({ id: auditId, ...next });
}

export function finalizeSubagentAudit(auditId, { status = 'completed', iterationCount = 0, repeatedCallKilled = false, finalAnswer = '', toolSummary = [], metadata = null } = {}) {
  updateSubagentAudit(auditId, {
    status,
    iterationCount,
    repeatedCallKilled,
    finalAnswer: truncateMiddle(finalAnswer || '', DEFAULT_MAX_OUTPUT_CHARS),
    toolSummary: Array.isArray(toolSummary)
      ? toolSummary.map((item) => ({
          ...item,
          outputSummary: truncateMiddle(item?.outputSummary || '', 1200),
          argsSummary: truncateMiddle(item?.argsSummary || '', 600),
        }))
      : [],
    completedAt: Date.now(),
    metadata,
  });
}

export function purgeExpiredSubagentAudits(now = Date.now()) {
  const db = getDb();
  const result = db.prepare('DELETE FROM subagent_audit WHERE expires_at <= ?').run(now);
  return { deleted: result.changes || 0, now };
}

export function listRecentSubagentAudits(limit = 20) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM subagent_audit ORDER BY started_at DESC LIMIT ?').all(limit);
  return rows.map((row) => ({
    ...row,
    tool_summary: safeJsonParse(row.tool_summary, []),
    execution_log: safeJsonParse(row.execution_log, []),
    metadata: safeJsonParse(row.metadata, {}),
  }));
}

export { truncateMiddle, serializeJson };
