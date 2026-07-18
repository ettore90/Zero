
import { Router } from 'express';
import crypto from 'crypto';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { getDb } from '../db.js';

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function keywordScore(query = '', text = '') {
  const words = String(query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return 0;
  const lowered = String(text).toLowerCase();
  const matches = words.filter((w) => lowered.includes(w)).length;
  return matches / words.length;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string' && tags.length > 0) return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function rowToMemory(row) {
  if (!row) return null;
  const extra = JSON.parse(row.metadata || '{}');
  const category = row.category;
  const userScopedCategories = new Set(['behavior', 'state', 'issue']);
  const derivedScope = userScopedCategories.has(category)
    ? (extra.scope || 'user')
    : (extra.scope || 'global');
  return {
    id: row.id,
    content: row.content,
    summary: row.summary || '',
    category,
    tags: normalizeTags(JSON.parse(row.tags || '[]')),
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
    confidence: row.confidence,
    importance: row.importance,
    agentId: row.agent_id,
    timestamp: row.created_at * 1000,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
    scope: derivedScope,
    ownerId: extra.ownerId ?? null,
    accessCount: extra.accessCount ?? 0,
    fingerprint: extra.fingerprint,
    lastInjectedAt: extra.lastInjectedAt ?? null,
    lastConfirmedAt: extra.lastConfirmedAt ?? null,
    promotionCandidate: extra.promotionCandidate ?? false,
    promotionReason: extra.promotionReason ?? null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// GET /memory — full dump (legacy, kept for compatibility)
// ---------------------------------------------------------------------------
router.get('/memory', checkLocalAccess, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all();
  const memories = rows.map(rowToMemory);
  return res.json({ memories, version: 2 });
});

// ---------------------------------------------------------------------------
// GET /memory/list — list without embeddings (UI)
// ---------------------------------------------------------------------------
router.get('/memory/list', checkLocalAccess, (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, category, content, summary, tags, confidence, importance, agent_id, created_at, updated_at, metadata FROM memories ORDER BY updated_at DESC'
  ).all();
  const memories = rows.map(row => {
    const m = rowToMemory(row);
    delete m.embedding;
    return m;
  });
  return res.json({ memories });
});

// ---------------------------------------------------------------------------
// POST /memory/add
// ---------------------------------------------------------------------------
router.post('/memory/add', checkLocalAccess, (req, res) => {
  const db = getDb();
  const {
    content,
    tags = [],
    embedding = null,
    agentId = null,
    category = 'fact',
    importance = 1,
    summary = '',
    confidence = 1,
    scope = 'global',
    ownerId = null,
    promotionCandidate = false,
    promotionReason = null,
    lastInjectedAt = null,
    lastConfirmedAt = null,
  } = req.body || {};

  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content required' });
  }

  const fingerprint = crypto.createHash('sha1').update(content.trim().toLowerCase()).digest('hex').slice(0, 12);

  // Duplicate check by fingerprint stored in metadata
  const existing = db.prepare(
    "SELECT id, embedding FROM memories WHERE json_extract(metadata, '$.fingerprint') = ?"
  ).get(fingerprint);

  if (existing) {
    return res.json({
      success: true,
      id: existing.id,
      duplicate: true,
      hasEmbedding: !!existing.embedding,
    });
  }

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Math.floor(Date.now() / 1000);
  const normalizedTags = Array.isArray(tags) ? tags : [tags].filter(Boolean);
  const embeddingStr = Array.isArray(embedding) && embedding.length > 0 ? JSON.stringify(embedding) : null;

  const normalizedScope = scope === 'user' || category === 'behavior' || category === 'state' || category === 'issue' ? 'user' : 'global';

  const metadata = JSON.stringify({
    fingerprint,
    scope: normalizedScope,
    ownerId: ownerId || null,
    promotionCandidate: Boolean(promotionCandidate),
    promotionReason: promotionReason || null,
    accessCount: 0,
    lastInjectedAt: typeof lastInjectedAt === 'number' ? lastInjectedAt : null,
    lastConfirmedAt: typeof lastConfirmedAt === 'number' ? lastConfirmedAt : null,
  });

  db.prepare(`
    INSERT INTO memories (id, category, content, summary, tags, embedding, confidence, importance, agent_id, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, category, content,
    typeof summary === 'string' ? summary : '',
    JSON.stringify(normalizedTags),
    embeddingStr,
    typeof confidence === 'number' ? confidence : 1,
    typeof importance === 'number' ? importance : 1,
    agentId || 'default',
    now, now,
    metadata
  );

  return res.json({ success: true, id, hasEmbedding: !!embeddingStr });
});

// ---------------------------------------------------------------------------
// POST /memory/search
// ---------------------------------------------------------------------------
router.post('/memory/search', checkLocalAccess, (req, res) => {
  const db = getDb();
  const { query = '', embedding = null, limit = 5, threshold = 0.1, category, tags } = req.body || {};

  const tagList = tags ? (Array.isArray(tags) ? tags : [tags]).filter(Boolean) : [];

  // Build query — filter by category in SQL, tags in JS (stored as JSON array)
  let sql = 'SELECT * FROM memories';
  const params = [];
  if (category) {
    sql += ' WHERE category = ?';
    params.push(category);
  }

  const rows = db.prepare(sql).all(...params);
  let results = rows.map(rowToMemory);

  // Tag filter
  if (tagList.length > 0) {
    results = results.filter(item =>
      tagList.every(tag => item.tags.includes(tag))
    );
  }

  // Score
  results = results
    .map(item => {
      const vectorScore = Array.isArray(embedding) && Array.isArray(item.embedding)
        ? cosineSimilarity(embedding, item.embedding)
        : 0;
      const textScore = query
        ? keywordScore(query, `${item.content} ${item.tags.join(' ')}`)
        : 0;
      const score = Math.max(vectorScore, textScore);
      return { ...item, score };
    })
    .filter(item => item.score >= Number(threshold || 0))
    .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp)
    .slice(0, Math.max(1, Math.min(Number(limit) || 5, 50)));

  // Increment accessCount for matched memories
  if (results.length > 0) {
    const updateAccess = db.prepare(`
      UPDATE memories
      SET metadata = json_set(metadata, '$.accessCount', COALESCE(json_extract(metadata, '$.accessCount'), 0) + 1),
          updated_at = ?
      WHERE id = ?
    `);
    const now = Math.floor(Date.now() / 1000);
    const updateMany = db.transaction((items) => {
      for (const item of items) updateAccess.run(now, item.id);
    });
    updateMany(results);
  }

  return res.json({ results });
});

// ---------------------------------------------------------------------------
// POST /memory/update
// ---------------------------------------------------------------------------
router.post('/memory/update', checkLocalAccess, (req, res) => {
  const db = getDb();
  const {
    id,
    content,
    summary,
    tags,
    category,
    importance,
    confidence,
    scope,
    ownerId,
    promotionCandidate,
    promotionReason,
    lastInjectedAt,
    lastConfirmedAt,
  } = req.body || {};

  if (!id) return res.status(400).json({ error: 'id required' });

  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Memory not found' });

  const now = Math.floor(Date.now() / 1000);
  const currentMeta = JSON.parse(existing.metadata || '{}');

  const nextContent = typeof content === 'string' ? content : existing.content;
  const nextFingerprint = crypto.createHash('sha1').update(String(nextContent || '').trim().toLowerCase()).digest('hex').slice(0, 12);

  const normalizedScope = scope === 'user' || category === 'behavior' || category === 'state' || category === 'issue' ? 'user' : 'global';
  const newMeta = {
    ...currentMeta,
    fingerprint: nextFingerprint,
    ...(scope !== undefined || category !== undefined ? { scope: normalizedScope } : {}),
    ...(ownerId !== undefined ? { ownerId: ownerId || null } : {}),
    ...(promotionCandidate !== undefined ? { promotionCandidate: Boolean(promotionCandidate) } : {}),
    ...(promotionReason !== undefined ? { promotionReason: promotionReason || null } : {}),
    ...(typeof lastInjectedAt === 'number' ? { lastInjectedAt } : {}),
    ...(typeof lastConfirmedAt === 'number' ? { lastConfirmedAt } : {}),
  };

  const currentTags = normalizeTags(JSON.parse(existing.tags || '[]'));
  const nextTags = tags !== undefined
    ? (Array.isArray(tags) ? tags : [tags].filter(Boolean))
    : currentTags;

  db.prepare(`
    UPDATE memories SET
      content    = ?,
      summary    = ?,
      tags       = ?,
      category   = ?,
      importance = ?,
      confidence = ?,
      updated_at = ?,
      metadata   = ?
    WHERE id = ?
  `).run(
    nextContent,
    typeof summary === 'string' ? summary : existing.summary,
    JSON.stringify(nextTags),
    category || existing.category,
    typeof importance === 'number' ? importance : existing.importance,
    typeof confidence === 'number' ? confidence : existing.confidence,
    now,
    JSON.stringify(newMeta),
    id
  );

  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  return res.json({ success: true, memory: rowToMemory(updated) });
});

// ---------------------------------------------------------------------------
// POST /memory/delete
// ---------------------------------------------------------------------------
router.post('/memory/delete', checkLocalAccess, (req, res) => {
  const db = getDb();
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  const info = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Memory not found' });

  return res.json({ success: true });
});

export default router;
