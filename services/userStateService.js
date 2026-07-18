import { getDb } from '../db.js';
import { ollamaGetTags } from './ollamaService.server.js';

const GLOBAL_OLLAMA_USERNAME = 'admin';

export function sanitizeUsername(username) {
  return String(username || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '_');
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function safeJsonParse(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getConfigStatements() {
  const db = getDb();
  return {
    userByUsername: db.prepare('SELECT id FROM users WHERE username = ?'),
    configByUserId: db.prepare('SELECT * FROM user_config WHERE user_id = ?'),
    insertConfig: db.prepare(`
      INSERT INTO user_config (user_id, config_json, created_at, updated_at)
      VALUES (@user_id, @config_json, @created_at, @updated_at)
    `),
    updateConfig: db.prepare(`
      UPDATE user_config
      SET config_json = @config_json,
          updated_at = @updated_at
      WHERE user_id = @user_id
    `),
  };
}

function getAgentMetaStatements() {
  const db = getDb();
  return {
    listByUsername: db.prepare('SELECT * FROM agent_state_meta WHERE username = ?'),
    getByKey: db.prepare('SELECT * FROM agent_state_meta WHERE username = ? AND agent_id = ?'),
    upsert: db.prepare(`
      INSERT INTO agent_state_meta (username, agent_id, revision, deleted, created_at, updated_at, metadata)
      VALUES (@username, @agent_id, @revision, @deleted, @created_at, @updated_at, @metadata)
      ON CONFLICT(username, agent_id) DO UPDATE SET
        revision = excluded.revision,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at,
        metadata = excluded.metadata
    `),
    deleteByKey: db.prepare('DELETE FROM agent_state_meta WHERE username = ? AND agent_id = ?'),
  };
}

function getUserIdByUsername(username) {
  const normalized = sanitizeUsername(username);
  const row = getConfigStatements().userByUsername.get(normalized);
  return row?.id || null;
}

function legacyConfigOnly(_username) {
  return {};
}

function readPersistedConfig(username) {
  const userId = getUserIdByUsername(username);
  if (!userId) return null;
  const row = getConfigStatements().configByUserId.get(userId);
  return row ? safeJsonParse(row.config_json, {}) : null;
}

function writePersistedConfig(username, config) {
  const userId = getUserIdByUsername(username);
  if (!userId) throw new Error(`User not found for config persistence: ${username}`);
  const stmts = getConfigStatements();
  const existing = stmts.configByUserId.get(userId);
  const ts = nowSec();
  const payload = {
    user_id: userId,
    config_json: JSON.stringify(config || {}),
    created_at: existing?.created_at || ts,
    updated_at: ts,
  };
  if (existing) stmts.updateConfig.run(payload);
  else stmts.insertConfig.run(payload);
}

function ensurePersistedConfig(username) {
  const existing = readPersistedConfig(username);
  if (existing) return existing;
  const fallback = legacyConfigOnly(username);
  writePersistedConfig(username, fallback);
  return fallback;
}

function getAgentMetaMap(username) {
  const rows = getAgentMetaStatements().listByUsername.all(sanitizeUsername(username));
  const deletedIds = [];
  const revisions = {};
  for (const row of rows) {
    const agentId = String(row?.agent_id || '');
    if (!agentId) continue;
    revisions[agentId] = Number(row?.revision || 0);
    if (Number(row?.deleted || 0) === 1) deletedIds.push(agentId);
  }
  return { deletedIds, revisions };
}

function setAgentMeta(username, agentId, updates = {}) {
  const normalizedUsername = sanitizeUsername(username);
  const normalizedAgentId = String(agentId || '').trim();
  if (!normalizedAgentId) return;
  const stmts = getAgentMetaStatements();
  const existing = stmts.getByKey.get(normalizedUsername, normalizedAgentId);
  const ts = nowSec();
  stmts.upsert.run({
    username: normalizedUsername,
    agent_id: normalizedAgentId,
    revision: Number(updates.revision ?? existing?.revision ?? 0) || 0,
    deleted: updates.deleted === undefined ? Number(existing?.deleted || 0) : (updates.deleted ? 1 : 0),
    created_at: existing?.created_at || ts,
    updated_at: ts,
    metadata: JSON.stringify({
      ...(safeJsonParse(existing?.metadata, {})),
      ...(updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : {}),
    }),
  });
}

function clearAgentMetaDeleted(username, agentId, revision = 0) {
  setAgentMeta(username, agentId, { deleted: 0, revision, metadata: { source: 'runtime-agent-save' } });
}

function getAgentId(agent) {
  return String(agent?.id ?? '');
}

function getIncomingAgentRevision(agent) {
  const raw = agent?.revision ?? agent?.updatedAt ?? agent?.lastModified ?? agent?.modifiedAt ?? 0;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

function isGlobalOllamaModel(model) {
  if (!model || typeof model !== 'object') return false;
  return String(model.provider || '') === 'ollama';
}

function modelKey(model) {
  return `${String(model?.provider || '').trim()}:${String(model?.modelId || model?.id || '').trim()}`;
}

function normalizeModelList(models) {
  const list = Array.isArray(models) ? models : [];
  const seen = new Set();
  const normalized = [];
  for (const model of list) {
    const key = modelKey(model);
    if (!key || key === ':') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(model);
  }
  return normalized;
}

function getPersistedUserModelConfigs(username) {
  const config = ensurePersistedConfig(username);
  const raw = Array.isArray(config?.modelConfigs) ? config.modelConfigs : [];
  return normalizeModelList(raw.filter((model) => !isGlobalOllamaModel(model)));
}

function getGlobalOllamaModelConfigs() {
  const config = ensurePersistedConfig(GLOBAL_OLLAMA_USERNAME);
  const raw = Array.isArray(config?.modelConfigs) ? config.modelConfigs : [];
  return normalizeModelList(raw.filter(isGlobalOllamaModel));
}

function createOllamaCatalogModel(modelId) {
  return {
    id: `ollama:${modelId}`,
    name: String(modelId),
    provider: 'ollama',
    modelId: String(modelId),
    intent: 'Auto-detected',
  };
}

async function getLiveGlobalOllamaModelConfigs() {
  try {
    const { status, data } = await ollamaGetTags();
    if (status < 200 || status >= 300) return [];
    const liveModels = Array.isArray(data?.models) ? data.models : [];
    const persisted = getGlobalOllamaModelConfigs();
    const persistedById = new Map(persisted.map((model) => [String(model.modelId), model]));
    return normalizeModelList(liveModels.map((entry) => {
      const modelId = String(entry?.name || '').trim();
      if (!modelId) return null;
      return persistedById.get(modelId) || createOllamaCatalogModel(modelId);
    }).filter(Boolean));
  } catch {
    return [];
  }
}

function getAllPersistedConfigs() {
  const db = getDb();
  return db.prepare(`
    SELECT u.username, uc.config_json
    FROM user_config uc
    JOIN users u ON u.id = uc.user_id
  `).all();
}

function ensureGlobalOllamaCatalogBackfilled() {
  const adminConfig = ensurePersistedConfig(GLOBAL_OLLAMA_USERNAME);
  const adminModels = Array.isArray(adminConfig?.modelConfigs) ? adminConfig.modelConfigs : [];
  const existingGlobal = normalizeModelList(adminModels.filter(isGlobalOllamaModel));
  if (existingGlobal.length > 0) return existingGlobal;

  const discovered = [];
  const seen = new Set();
  for (const row of getAllPersistedConfigs()) {
    const cfg = safeJsonParse(row?.config_json, {});
    const models = Array.isArray(cfg?.modelConfigs) ? cfg.modelConfigs : [];
    for (const model of models) {
      if (!isGlobalOllamaModel(model)) continue;
      const key = modelKey(model);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      discovered.push(model);
    }
  }

  if (discovered.length === 0) return [];

  writePersistedConfig(GLOBAL_OLLAMA_USERNAME, {
    ...adminConfig,
    modelConfigs: normalizeModelList([
      ...(Array.isArray(adminConfig?.modelConfigs) ? adminConfig.modelConfigs.filter((model) => !isGlobalOllamaModel(model)) : []),
      ...discovered,
    ]),
  });

  return discovered;
}

async function buildEffectiveConfig(username) {
  const config = ensurePersistedConfig(username);
  const userModels = getPersistedUserModelConfigs(username);
  const persistedGlobalOllamaModels = getGlobalOllamaModelConfigs();
  const liveGlobalOllamaModels = await getLiveGlobalOllamaModelConfigs();
  const fallbackGlobalOllamaModels = persistedGlobalOllamaModels.length > 0 ? persistedGlobalOllamaModels : ensureGlobalOllamaCatalogBackfilled();
  const effectiveGlobalOllamaModels = liveGlobalOllamaModels.length > 0 ? liveGlobalOllamaModels : fallbackGlobalOllamaModels;
  return {
    ...config,
    modelConfigs: normalizeModelList([...userModels, ...effectiveGlobalOllamaModels]),
  };
}

function sanitizeIncomingConfigFields(fields) {
  const next = { ...(fields || {}) };
  if (Array.isArray(next.modelConfigs)) {
    next.modelConfigs = getPersistedUserModelConfigsFromIncoming(next.modelConfigs);
  }
  return next;
}

function getPersistedUserModelConfigsFromIncoming(models) {
  return normalizeModelList((Array.isArray(models) ? models : []).filter((model) => !isGlobalOllamaModel(model)));
}

export function getRawState(username) {
  const config = readPersistedConfig(username) || ensurePersistedConfig(username) || {};
  const { deletedIds, revisions } = getAgentMetaMap(username);
  return {
    ...config,
    agents: [],
    __meta: {
      agents: {
        deletedIds,
        revisions,
      },
    },
  };
}

export function readState(username) {
  return getRawState(username);
}

export function writeState(username, state) {
  const next = state && typeof state === 'object' ? { ...state } : {};
  const { agents = [], __meta = {}, ...config } = next;
  writePersistedConfig(username, config);

  const metaAgents = __meta?.agents && typeof __meta.agents === 'object' ? __meta.agents : {};
  const deletedIds = Array.isArray(metaAgents.deletedIds) ? metaAgents.deletedIds.map(String) : [];
  const revisions = metaAgents.revisions && typeof metaAgents.revisions === 'object' ? metaAgents.revisions : {};
  for (const agent of Array.isArray(agents) ? agents : []) {
    const id = getAgentId(agent);
    if (!id) continue;
    clearAgentMetaDeleted(username, id, Math.max(getIncomingAgentRevision(agent), Number(revisions[id] || 0)));
  }
  for (const id of deletedIds) {
    setAgentMeta(username, id, { deleted: 1, revision: Number(revisions[id] || 0), metadata: { source: 'write-state' } });
  }
}

export function getAgents(username) {
  return [];
}

export function deleteAgentState(username, agentId) {
  const current = getAgentMetaStatements().getByKey.get(sanitizeUsername(username), String(agentId));
  const nextRevision = Number(current?.revision || 0) + 1;
  setAgentMeta(username, agentId, { deleted: 1, revision: nextRevision, metadata: { source: 'delete-agent-state' } });
}

export function saveAgents(username, agents, options = {}) {
  const incoming = Array.isArray(agents) ? agents : [];
  const replaceAll = options.replaceAll === true;
  const { deletedIds, revisions } = getAgentMetaMap(username);
  const deletedSet = new Set(deletedIds);
  const incomingIds = new Set();

  for (const agent of incoming) {
    const id = getAgentId(agent);
    if (!id) continue;
    incomingIds.add(id);
    const revision = Math.max(getIncomingAgentRevision(agent), Number(revisions[id] || 0));
    clearAgentMetaDeleted(username, id, revision);
  }

  if (replaceAll) {
    for (const id of Object.keys(revisions)) {
      if (incomingIds.has(id)) continue;
      if (deletedSet.has(id)) continue;
      setAgentMeta(username, id, {
        deleted: 1,
        revision: Number(revisions[id] || 0) + 1,
        metadata: { source: 'save-agents-replace-all' },
      });
    }
  }
}

export async function getConfig(username) {
  return buildEffectiveConfig(username);
}

export function patchConfig(username, fields) {
  const current = ensurePersistedConfig(username);
  const { agents: _ignoredAgents, __meta: _ignoredMeta, ...safeFieldsRaw } = fields || {};
  const safeFields = sanitizeIncomingConfigFields(safeFieldsRaw);
  const merged = { ...current, ...safeFields };
  delete merged.agents;
  delete merged.__meta;
  writePersistedConfig(username, merged);
}

export function saveConfig(username, config) {
  const current = ensurePersistedConfig(username);
  const { agents: _ignoredAgents, __meta: _ignoredMeta, ...restRaw } = config || {};
  const rest = sanitizeIncomingConfigFields(restRaw);
  const merged = { ...current, ...rest };
  delete merged.agents;
  delete merged.__meta;

  const protectedArrays = ['apiKeys', 'workflows', 'modelConfigs', 'externalTools'];
  for (const key of protectedArrays) {
    const incoming = rest[key];
    const existing = current[key];
    if (Array.isArray(existing) && existing.length > 0) {
      if (!Array.isArray(incoming) || incoming.length === 0) {
        merged[key] = existing;
      } else if (incoming.length < existing.length) {
        merged[key] = existing;
        console.warn(`[saveConfig] Blocked shrink of '${key}': ${existing.length} → ${incoming.length} (kept existing)`);
      }
    }
  }

  writePersistedConfig(username, merged);
}
