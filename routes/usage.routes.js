import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { getDb } from '../db.js';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToRecord(row) {
  if (!row) return null;
  const meta = JSON.parse(row.metadata || '{}');
  return {
    id: row.id,
    agentId: row.agent_id,
    model: row.model || null,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    cost: row.cost,
    timestamp: row.timestamp * 1000,
    ...meta,
  };
}

// ---------------------------------------------------------------------------
// GET /usage — aggregate stats + recent records
// ---------------------------------------------------------------------------
router.get('/usage', checkLocalAccess, (req, res) => {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      SUM(requests)             AS totalRequests,
      SUM(prompt_tokens)        AS totalPromptTokens,
      SUM(completion_tokens)    AS totalCompletionTokens,
      SUM(total_tokens)         AS totalTokens,
      SUM(cost)                 AS totalCost
    FROM usage_records
  `).get();

  const byAgent = db.prepare(`
    SELECT
      agent_id,
      COUNT(*)               AS requests,
      SUM(total_tokens)      AS tokens,
      SUM(cost)              AS cost
    FROM usage_records
    GROUP BY agent_id
    ORDER BY tokens DESC
  `).all();

  const byModel = db.prepare(`
    SELECT
      model,
      COUNT(*)               AS requests,
      SUM(total_tokens)      AS tokens,
      SUM(cost)              AS cost
    FROM usage_records
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY tokens DESC
  `).all();

  // Last 30 days daily breakdown
  const daily = db.prepare(`
    SELECT
      date(timestamp, 'unixepoch') AS day,
      COUNT(*)                     AS requests,
      SUM(total_tokens)            AS tokens,
      SUM(cost)                    AS cost
    FROM usage_records
    WHERE timestamp >= unixepoch('now', '-30 days')
    GROUP BY day
    ORDER BY day ASC
  `).all();

  // Recent 100 records
  const recent = db.prepare(`
    SELECT * FROM usage_records ORDER BY timestamp DESC LIMIT 100
  `).all().map(rowToRecord);

  return res.json({
    totals: {
      requests: totals.totalRequests || 0,
      promptTokens: totals.totalPromptTokens || 0,
      completionTokens: totals.totalCompletionTokens || 0,
      tokens: totals.totalTokens || 0,
      cost: totals.totalCost || 0,
    },
    byAgent,
    byModel,
    daily,
    recent,
  });
});

// ---------------------------------------------------------------------------
// GET /usage/agent/:agentId — per-agent stats
// ---------------------------------------------------------------------------
router.get('/usage/agent/:agentId', checkLocalAccess, (req, res) => {
  const db = getDb();
  const { agentId } = req.params;

  const totals = db.prepare(`
    SELECT
      COUNT(*)               AS requests,
      SUM(prompt_tokens)     AS promptTokens,
      SUM(completion_tokens) AS completionTokens,
      SUM(total_tokens)      AS tokens,
      SUM(cost)              AS cost
    FROM usage_records
    WHERE agent_id = ?
  `).get(agentId);

  const records = db.prepare(`
    SELECT * FROM usage_records WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 200
  `).all(agentId).map(rowToRecord);

  return res.json({ agentId, totals, records });
});

// ---------------------------------------------------------------------------
// POST /usage/record — save a new usage record
// ---------------------------------------------------------------------------
router.post('/usage/record', checkLocalAccess, (req, res) => {
  const db = getDb();
  const {
    agentId,
    model,
    promptTokens = 0,
    completionTokens = 0,
    totalTokens,
    cost = 0,
    timestamp,
    sessionId,
    requests = 1,
    ...rest
  } = req.body || {};

  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  const id = `usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ts = timestamp ? Math.floor(timestamp / 1000) : Math.floor(Date.now() / 1000);
  const total = typeof totalTokens === 'number' ? totalTokens : promptTokens + completionTokens;

  db.prepare(`
    INSERT INTO usage_records (id, agent_id, model, prompt_tokens, completion_tokens, total_tokens, cost, timestamp, metadata, session_id, requests)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, agentId, model || null,
    promptTokens, completionTokens, total,
    cost, ts,
    JSON.stringify(rest),
    sessionId || null,
    requests
  );

  return res.json({ success: true, id });
});

// ---------------------------------------------------------------------------
// DELETE /usage/clear — clear all records (admin)
// ---------------------------------------------------------------------------
router.delete('/usage/clear', checkLocalAccess, (req, res) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM usage_records').run();
  return res.json({ success: true, deleted: info.changes });
});

// ---------------------------------------------------------------------------
// GET /usage/daily — daily breakdown by model for a given year/month
// ---------------------------------------------------------------------------
router.get('/usage/daily', checkLocalAccess, (req, res) => {
  const db = getDb();
  const year      = parseInt(req.query.year)  || new Date().getFullYear();
  const month     = parseInt(req.query.month) || (new Date().getMonth() + 1);
  const sessionId = req.query.sessionId || null;
  const mm = String(month).padStart(2, '0');

  const sessionClause = sessionId ? 'AND session_id = ?' : '';
  const params = sessionId
    ? [String(year), mm, sessionId]
    : [String(year), mm];

  // Use COALESCE to fall back to metadata->modelId when model column is NULL
  const rows = db.prepare(`
    SELECT
      date(timestamp, 'unixepoch')                                   AS date,
      COALESCE(model, json_extract(metadata, '$.modelId'), 'unknown') AS modelId,
      SUM(requests)                                                   AS requests,
      SUM(total_tokens)                                               AS tokens,
      SUM(prompt_tokens)                                              AS promptTokens,
      SUM(completion_tokens)                                          AS completionTokens
    FROM usage_records
    WHERE strftime('%Y', datetime(timestamp, 'unixepoch')) = ?
      AND strftime('%m', datetime(timestamp, 'unixepoch')) = ?
      ${sessionClause}
    GROUP BY date, modelId
    ORDER BY date ASC
  `).all(...params);

  return res.json({ records: rows });
});

// ---------------------------------------------------------------------------
// GET /usage/sessions — list distinct sessions with totals
// ---------------------------------------------------------------------------
router.get('/usage/sessions', checkLocalAccess, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      u.session_id,
      COALESCE(s.title, 'New Session') AS title,
      MIN(u.agent_id)          AS agent_id,
      SUM(u.requests)          AS requests,
      SUM(u.total_tokens)      AS tokens,
      SUM(u.cost)              AS cost,
      MIN(u.timestamp) * 1000  AS firstSeen,
      MAX(u.timestamp) * 1000  AS lastSeen
    FROM usage_records u
    LEFT JOIN sessions s ON s.id = u.session_id
    WHERE u.session_id IS NOT NULL
    GROUP BY u.session_id
    ORDER BY lastSeen DESC
    LIMIT 200
  `).all();
  return res.json({ sessions: rows });
});

// ---------------------------------------------------------------------------
// GET /usage/summary — all-time totals grouped by model
// ---------------------------------------------------------------------------
router.get('/usage/summary', checkLocalAccess, (req, res) => {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      COALESCE(model, json_extract(metadata, '$.modelId'), 'unknown') AS modelId,
      COUNT(*)               AS requests,
      SUM(total_tokens)      AS tokens,
      SUM(prompt_tokens)     AS promptTokens,
      SUM(completion_tokens) AS completionTokens,
      MAX(timestamp) * 1000  AS lastUsed
    FROM usage_records
    GROUP BY modelId
    ORDER BY tokens DESC
  `).all();

  return res.json({ models: rows });
});

export default router;
