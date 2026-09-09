import crypto from 'crypto';
import { getDb } from '../db.js';

const VALID_CATEGORIES = new Set(['fact', 'state', 'event', 'behavior', 'issue', 'knowledge', 'design', 'summary']);
const USER_SCOPED_CATEGORIES = new Set(['behavior', 'state', 'issue']);
const REINFORCE_THRESHOLD = 0.85;
const SIMILAR_THRESHOLD = 0.6;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof tags === 'string' && tags.trim()) return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function safeJsonParse(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function cosineSimilarity(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
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

function normalizeCategory(category, fallback = 'fact') {
  return VALID_CATEGORIES.has(category) ? category : fallback;
}

function normalizeScope(category, scope, fallback = 'global') {
  const effectiveFallback = USER_SCOPED_CATEGORIES.has(category)
    ? (fallback === 'global' ? 'user' : fallback)
    : fallback;
  if (scope !== undefined) {
    return (scope === 'user' || (USER_SCOPED_CATEGORIES.has(category) && scope !== 'global')) ? 'user' : 'global';
  }
  return USER_SCOPED_CATEGORIES.has(category)
    ? (effectiveFallback === 'global' ? 'user' : effectiveFallback)
    : (effectiveFallback || 'global');
}

function fingerprintForContent(content) {
  return crypto.createHash('sha1').update(String(content || '').trim().toLowerCase()).digest('hex').slice(0, 12);
}

function rowToMemory(row) {
  if (!row) return null;
  const extra = safeJsonParse(row.metadata, {});
  const category = row.category;
  const scope = USER_SCOPED_CATEGORIES.has(category)
    ? normalizeScope(category, extra.scope, 'user')
    : normalizeScope(category, extra.scope, 'global');
  return {
    id: row.id,
    content: row.content,
    summary: row.summary || '',
    category,
    tags: normalizeTags(safeJsonParse(row.tags, [])),
    embedding: row.embedding ? safeJsonParse(row.embedding, null) : null,
    confidence: row.confidence,
    importance: row.importance,
    agentId: row.agent_id,
    timestamp: row.created_at * 1000,
    createdAt: row.created_at * 1000,
    updatedAt: row.updated_at * 1000,
    scope,
    ownerId: scope === 'user' ? (extra.ownerId ?? null) : null,
    accessCount: extra.accessCount ?? 0,
    fingerprint: extra.fingerprint,
    lastInjectedAt: extra.lastInjectedAt ?? null,
    lastConfirmedAt: extra.lastConfirmedAt ?? null,
    promotionCandidate: extra.promotionCandidate ?? false,
    promotionReason: extra.promotionReason ?? null,
    consolidatedFrom: extra.consolidatedFrom,
    lastReinforced: extra.lastReinforced ?? null,
    ...extra,
  };
}

// The model's context is ~2048 tokens and how many characters fit depends on
// the content, so a long memory used to fail outright and save with no vector
// at all -- silently, since every error is swallowed here. Step the length down
// until it is accepted. The 3s budget was also too tight for long input.
const EMBEDDING_LENGTH_CAPS = [Infinity, 6000, 3000, 1500, 800];

async function generateEmbedding(content, fetchWithRetry, ollamaServer) {
  if (!fetchWithRetry || !ollamaServer || !content) return null;
  for (const cap of EMBEDDING_LENGTH_CAPS) {
    const prompt = cap === Infinity ? content : String(content).slice(0, cap);
    if (!prompt) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetchWithRetry(`${ollamaServer}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'nomic-embed-text', prompt }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (response && response.ok === false) continue;
      const data = await response.json();
      if (Array.isArray(data?.embedding) && data.embedding.length > 0) return data.embedding;
    } catch {
      // Too long, unreachable, or unparseable -- try a smaller cap.
    }
  }
  return null;
}

export async function rememberMemory({
  content,
  tags = [],
  agentId = null,
  fetchWithRetry,
  ollamaServer,
  importance = 1,
  consolidatedFrom = [],
  category = 'fact',
  summary = '',
  confidence = 1,
  scope = 'global',
  ownerId = null,
  promotionCandidate = false,
  promotionReason = null,
  lastInjectedAt = null,
  lastConfirmedAt = null,
}) {
  const db = getDb();
  if (!content || typeof content !== 'string') throw new Error('content required');

  const normalizedCategory = normalizeCategory(category, 'fact');
  const normalizedTags = normalizeTags(tags);
  const normalizedScope = normalizeScope(normalizedCategory, scope, normalizedCategory === 'design' ? 'global' : 'global');
  const normalizedOwnerId = normalizedScope === 'user' ? (ownerId || null) : null;
  const fingerprint = fingerprintForContent(content);

  const existingExact = db.prepare("SELECT id, embedding FROM memories WHERE json_extract(metadata, '$.fingerprint') = ?").get(fingerprint);
  if (existingExact) {
    return { id: existingExact.id, duplicate: true, hasEmbedding: !!existingExact.embedding };
  }

  const embedding = await generateEmbedding(content, fetchWithRetry, ollamaServer);

  if (Array.isArray(embedding) && embedding.length > 0) {
    const rows = db.prepare('SELECT * FROM memories WHERE embedding IS NOT NULL').all();
    let bestRow = null;
    let bestSimilarity = 0;
    for (const row of rows) {
      const existingEmbedding = safeJsonParse(row.embedding, null);
      const similarity = cosineSimilarity(embedding, existingEmbedding);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestRow = row;
      }
    }

    if (bestRow && bestSimilarity >= REINFORCE_THRESHOLD) {
      const existingMeta = safeJsonParse(bestRow.metadata, {});
      const now = Math.floor(Date.now() / 1000);
      const oldImportance = typeof bestRow.importance === 'number' ? bestRow.importance : 1;
      const oldConfidence = typeof bestRow.confidence === 'number' ? bestRow.confidence : 1;
      const updatedMeta = {
        ...existingMeta,
        lastReinforced: now * 1000,
      };
      db.prepare(`
        UPDATE memories
        SET importance = ?, confidence = ?, updated_at = ?, metadata = ?
        WHERE id = ?
      `).run(
        Math.min(2, oldImportance + 0.1),
        Math.min(1, oldConfidence + 0.05),
        now,
        JSON.stringify(updatedMeta),
        bestRow.id,
      );
      return { id: bestRow.id, reinforced: true, similarity: bestSimilarity };
    }

    if (bestRow && bestSimilarity >= SIMILAR_THRESHOLD && !normalizedTags.includes('similar_exists')) {
      normalizedTags.push('similar_exists');
    }
  }

  const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Math.floor(Date.now() / 1000);
  const metadata = {
    fingerprint,
    scope: normalizedScope,
    ownerId: normalizedOwnerId,
    promotionCandidate: Boolean(promotionCandidate),
    promotionReason: promotionReason || null,
    accessCount: 0,
    lastInjectedAt: typeof lastInjectedAt === 'number' ? lastInjectedAt : null,
    lastConfirmedAt: typeof lastConfirmedAt === 'number' ? lastConfirmedAt : null,
    ...(Array.isArray(consolidatedFrom) && consolidatedFrom.length > 0 ? { consolidatedFrom } : {}),
  };

  db.prepare(`
    INSERT INTO memories (id, category, content, summary, tags, embedding, confidence, importance, agent_id, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalizedCategory,
    content,
    typeof summary === 'string' ? summary : '',
    JSON.stringify(normalizedTags),
    Array.isArray(embedding) && embedding.length > 0 ? JSON.stringify(embedding) : null,
    typeof confidence === 'number' ? confidence : 1,
    typeof importance === 'number' ? importance : 1,
    agentId || 'default',
    now,
    now,
    JSON.stringify(metadata),
  );

  return { id, hasEmbedding: Array.isArray(embedding) && embedding.length > 0 };
}

export async function recallMemories({ query = '', limit = 10, threshold = 0.3, category, tags, fetchWithRetry, ollamaServer }) {
  const db = getDb();
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const numericThreshold = Number(threshold || 0);
  const normalizedTags = normalizeTags(tags);
  const normalizedCategory = category ? normalizeCategory(category, category) : null;

  let results;
  if (normalizedCategory || normalizedTags.length > 0) {
    let sql = 'SELECT * FROM memories';
    const params = [];
    if (normalizedCategory) {
      sql += ' WHERE category = ?';
      params.push(normalizedCategory);
      if (USER_SCOPED_CATEGORIES.has(normalizedCategory)) {
        sql += ' AND (json_extract(metadata, \'$.scope\') IS NULL OR json_extract(metadata, \'$.scope\') = \'user\')';
      }
    } else {
      sql += " WHERE (json_extract(metadata, '$.scope') IS NULL OR json_extract(metadata, '$.scope') != 'hidden')";
    }

    let memories = db.prepare(sql).all(...params).map(rowToMemory);
    if (normalizedTags.length > 0) {
      memories = memories.filter((item) => normalizedTags.every((tag) => item.tags.includes(tag)));
    }

    const queryAsCategory = String(query || '').toLowerCase().trim();
    const meaningfulQuery = query && !VALID_CATEGORIES.has(queryAsCategory) && query !== '*';
    if (meaningfulQuery) {
      const words = queryAsCategory.split(/\s+/).filter((w) => w.length > 2);
      memories = memories
        .map((item) => ({ ...item, relevance: words.length ? words.filter((w) => item.content.toLowerCase().includes(w)).length / words.length : 0 }))
        .sort((a, b) => (b.relevance || 0) - (a.relevance || 0) || b.timestamp - a.timestamp);
    } else {
      memories = memories.sort((a, b) => b.timestamp - a.timestamp);
    }
    results = memories.slice(0, normalizedLimit);
  } else {
    const rows = db.prepare("SELECT * FROM memories WHERE (json_extract(metadata, '$.scope') IS NULL OR json_extract(metadata, '$.scope') != 'hidden')").all();
    const semanticEmbedding = query ? await generateEmbedding(query, fetchWithRetry, ollamaServer) : null;
    const scored = rows.map((row) => {
      const item = rowToMemory(row);
      const embedding = item.embedding;
      const vectorScore = Array.isArray(semanticEmbedding) && Array.isArray(embedding)
        ? cosineSimilarity(semanticEmbedding, embedding)
        : 0;
      const textScore = query ? keywordScore(query, `${item.content} ${(item.tags || []).join(' ')}`) : 0;
      const relevance = Math.max(vectorScore, textScore);
      return { ...item, relevance };
    });
    results = scored
      .filter((item) => item.relevance >= numericThreshold)
      .sort((a, b) => b.relevance - a.relevance || b.timestamp - a.timestamp)
      .slice(0, normalizedLimit);
  }

  if (results.length > 0) {
    const now = Math.floor(Date.now() / 1000);
    const updateAccess = db.prepare(`
      UPDATE memories
      SET metadata = json_set(COALESCE(metadata, '{}'), '$.accessCount', COALESCE(json_extract(metadata, '$.accessCount'), 0) + 1),
          updated_at = ?
      WHERE id = ?
    `);
    const tx = db.transaction((items) => {
      for (const item of items) updateAccess.run(now, item.id);
    });
    tx(results);
    results = results.map((item) => ({
      ...item,
      accessCount: (item.accessCount || 0) + 1,
      updatedAt: now * 1000,
    }));
  }

  return results.map((item) => ({
    id: item.id,
    relevance: item.relevance,
    content: item.content,
    summary: item.summary,
    category: item.category,
    tags: item.tags,
    confidence: item.confidence,
    scope: item.scope,
    ownerId: item.ownerId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    lastInjectedAt: item.lastInjectedAt,
    lastConfirmedAt: item.lastConfirmedAt,
    timestamp: item.timestamp,
  }));
}

export function updateMemoryRecord({ id, content, summary, tags, category, confidence, importance, scope, ownerId, promotionCandidate, promotionReason, lastInjectedAt, lastConfirmedAt }) {
  const db = getDb();
  if (!id) return { error: 'id is required' };
  const existing = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  if (!existing) return { error: `Memory '${id}' not found` };

  const currentMeta = safeJsonParse(existing.metadata, {});
  const nextCategory = category ? normalizeCategory(category, existing.category) : existing.category;
  const nextContent = typeof content === 'string' ? content : existing.content;
  const nextTags = tags !== undefined ? normalizeTags(tags) : normalizeTags(safeJsonParse(existing.tags, []));
  const nextScope = normalizeScope(nextCategory, scope, currentMeta.scope || (USER_SCOPED_CATEGORIES.has(nextCategory) ? 'user' : 'global'));
  const nextOwnerId = nextScope === 'user'
    ? (ownerId !== undefined ? (ownerId || null) : (currentMeta.ownerId ?? null))
    : null;
  const now = Math.floor(Date.now() / 1000);

  const newMeta = {
    ...currentMeta,
    fingerprint: fingerprintForContent(nextContent),
    scope: nextScope,
    ownerId: nextOwnerId,
    ...(promotionCandidate !== undefined ? { promotionCandidate: Boolean(promotionCandidate) } : {}),
    ...(promotionReason !== undefined ? { promotionReason: promotionReason || null } : {}),
    ...(typeof lastInjectedAt === 'number' ? { lastInjectedAt } : {}),
    ...(typeof lastConfirmedAt === 'number' ? { lastConfirmedAt } : { lastConfirmedAt: now * 1000 }),
  };

  db.prepare(`
    UPDATE memories SET
      content = ?,
      summary = ?,
      tags = ?,
      category = ?,
      importance = ?,
      confidence = ?,
      updated_at = ?,
      metadata = ?
    WHERE id = ?
  `).run(
    nextContent,
    typeof summary === 'string' ? summary : existing.summary,
    JSON.stringify(nextTags),
    nextCategory,
    typeof importance === 'number' ? importance : existing.importance,
    typeof confidence === 'number' ? clamp(confidence, 0, 1) : existing.confidence,
    now,
    JSON.stringify(newMeta),
    id,
  );

  const updated = db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
  return { success: true, id, memory: rowToMemory(updated), message: 'Memory updated.' };
}

export function deleteMemories({ id, ids, category, tags }) {
  const db = getDb();
  const normalizedIds = normalizeTags(ids);
  const normalizedTags = normalizeTags(tags);

  let deleted = 0;
  if (id) {
    const info = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    deleted = info.changes;
  } else if (normalizedIds.length > 0) {
    const placeholders = normalizedIds.map(() => '?').join(',');
    const info = db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...normalizedIds);
    deleted = info.changes;
  } else if (category) {
    const info = db.prepare('DELETE FROM memories WHERE category = ?').run(category);
    deleted = info.changes;
  } else if (normalizedTags.length > 0) {
    const rows = db.prepare('SELECT id, tags FROM memories').all();
    const matchingIds = rows
      .filter((row) => {
        const rowTags = normalizeTags(safeJsonParse(row.tags, []));
        return normalizedTags.every((tag) => rowTags.includes(tag));
      })
      .map((row) => row.id);
    if (matchingIds.length > 0) {
      const placeholders = matchingIds.map(() => '?').join(',');
      const info = db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...matchingIds);
      deleted = info.changes;
    }
  } else {
    return { error: 'Provide id, ids[], category, or tags[]' };
  }

  const remainingRow = db.prepare('SELECT COUNT(*) as count FROM memories').get();
  return { success: true, deleted, remaining: remainingRow?.count || 0 };
}
