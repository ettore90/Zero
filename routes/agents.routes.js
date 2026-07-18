import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { sessionStore } from '../services/runtime.js';
import { deleteVisibleAgent, getVisibleAgent, listCanonicalVisibleAgents, listAgents, replaceAgents, upsertAgent } from '../services/agentStore.js';
import { createPromptBlock, createPromptBlockVersion, createPromptVersion, deletePromptBlock, getCurrentPromptVersion, getOrBootstrapGlobalPromptDocument, getOrBootstrapPromptDocumentByAgent, getPromptBlockTypeAssignment, listPromptBlockTypeAssignments, listPromptBlocks, listPromptBlockVersions, listPromptDocumentBlockRefs, listPromptVersions, publishPromptCompositionSnapshot, resolveEffectivePromptBlocksForAgentDocument, resolveEffectivePromptForAgentDocument, resolveEffectivePromptRefsForAgentDocument, resolvePromptBlockInventoryForAgentDocument, resolvePromptFinalByCompositionForDocument, rollbackPromptVersion, syncPromptDocumentBlockRefs, upsertPromptBlockTypeAssignment, upsertPromptDocumentBlockRef, upsertPromptDocumentBlockRefWithoutSync } from '../services/promptStore.js';

const router = Router();

function resolveScopedUsername(req) {
  return String(req.username || req.user?.username || '').trim();
}

function normalizeAgentType(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ['master', 'worker', 'infra'].includes(normalized) ? normalized : null;
}

function resolveRequestedAgentType(req) {
  return normalizeAgentType(req?.query?.agentType ?? req?.body?.agentType ?? req?.body?.agent_type ?? req?.query?.agent_type);
}

function withRequestedAgentType(req, payload = {}) {
  const agentType = resolveRequestedAgentType(req);
  return agentType ? { ...payload, agentType } : payload;
}

function filterAssignmentsByRequestedAgentType(assignments, requestedAgentType) {
  if (!requestedAgentType) return assignments;
  return (Array.isArray(assignments) ? assignments : []).filter((assignment) => {
    const agentTypes = Array.isArray(assignment?.agentTypes) ? assignment.agentTypes.map((value) => normalizeAgentType(value)).filter(Boolean) : [];
    return agentTypes.includes(requestedAgentType);
  });
}

function resolveCanonicalAgentType(agent) {
  return normalizeAgentType(agent?.type) || normalizeAgentType(agent?.role) || null;
}

function serializePromptDocumentResponse(document) {
  if (!document) return null;
  return {
    id: document.id,
    key: document.key,
    title: document.title,
    currentVersionId: document.currentVersionId || null,
    metadata: document.metadata || {},
    createdAt: document.createdAt || null,
    updatedAt: document.updatedAt || null,
  };
}

function serializePromptVersionResponse(version) {
  if (!version) return null;
  return {
    id: version.id,
    documentId: version.documentId,
    version: version.version,
    content: version.content,
    createdAt: version.createdAt,
    createdBy: version.createdBy || null,
    metadata: version.metadata || {},
  };
}

function serializePromptBlockResponse(block) {
  if (!block) return null;
  return {
    id: block.id,
    documentId: block.documentId,
    blockKey: block.blockKey,
    blockType: block.blockType,
    title: block.title,
    content: block.content,
    agentTypes: Array.isArray(block.agentTypes) ? block.agentTypes : undefined,
    role: block.role ?? null,
    forcedPosition: block.forcedPosition ?? null,
    autoInclude: typeof block.autoInclude === 'boolean' ? block.autoInclude : undefined,
    forceInclude: typeof block.forceInclude === 'boolean' ? block.forceInclude : undefined,
    metadata: block.metadata || {},
    createdAt: block.createdAt || null,
    updatedAt: block.updatedAt || null,
  };
}

function serializePromptBlockVersionResponse(version) {
  if (!version) return null;
  return {
    id: version.id,
    blockId: version.blockId,
    version: version.version,
    content: version.content,
    createdAt: version.createdAt || null,
    createdBy: version.createdBy || null,
    metadata: version.metadata || {},
  };
}

function serializePromptAssignmentResponse(assignment) {
  if (!assignment) return null;
  const agentTypes = Array.isArray(assignment.agentTypes) ? assignment.agentTypes : undefined;
  const role = agentTypes && agentTypes.length === 1 ? agentTypes[0] : null;
  return {
    id: assignment.id,
    documentId: assignment.documentId,
    blockId: assignment.blockId,
    blockType: assignment.blockType,
    canonicalType: assignment.canonicalType,
    role,
    agentTypes,
    autoInclude: !!assignment.autoInclude,
    forceInclude: !!assignment.forceInclude,
    forcedPosition: assignment.forcedPosition ?? null,
    eligibility: assignment.eligibility ?? null,
    transversal: assignment.transversal ?? null,
    metadata: assignment.metadata || {},
    createdAt: assignment.createdAt || null,
    updatedAt: assignment.updatedAt || null,
  };
}

function serializePromptRefResponse(ref) {
  if (!ref) return null;
  return {
    id: ref.id,
    documentId: ref.documentId,
    blockId: ref.blockId,
    blockVersionId: ref.blockVersionId || null,
    pinnedBlockVersionId: ref.pinnedBlockVersionId || null,
    followCurrent: !!ref.followCurrent,
    blockType: ref.blockType || null,
    position: ref.position ?? null,
    included: !!ref.included,
    canonicalRefIdentity: ref.canonicalRefIdentity || null,
    metadata: ref.metadata || {},
    createdAt: ref.createdAt || null,
    updatedAt: ref.updatedAt || null,
  };
}

function sanitizeBlockMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const next = { ...metadata };
  delete next.agentTypes;
  delete next.agent_types;
  delete next.role;
  delete next.agentRole;
  return next;
}

function buildAssignmentPayloadFromRequest(body = {}, existingBlock = null, existingAssignment = null) {
  const metadata = body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? { ...body.metadata } : {};
  const rawAgentTypes = body?.agentTypes ?? body?.agent_types ?? metadata.agentTypes ?? metadata.agent_types ?? existingBlock?.agentTypes ?? existingAssignment?.agentTypes;
  const normalizedAgentTypes = Array.isArray(rawAgentTypes)
    ? Array.from(new Set(rawAgentTypes.map((value) => String(value || '').trim().toLowerCase()).filter((value) => ['master', 'worker', 'infra'].includes(value))))
    : undefined;
  const rawRole = body?.role ?? metadata.role ?? metadata.agentRole ?? existingBlock?.role ?? (Array.isArray(existingAssignment?.agentTypes) && existingAssignment.agentTypes.length === 1 ? existingAssignment.agentTypes[0] : null);
  const normalizedRole = normalizeAgentType(rawRole);
  const agentTypes = normalizedAgentTypes !== undefined
    ? normalizedAgentTypes
    : normalizedRole
      ? [normalizedRole]
      : undefined;
  const forcedPosition = Object.prototype.hasOwnProperty.call(body || {}, 'forcedPosition')
    ? body.forcedPosition
    : Object.prototype.hasOwnProperty.call(body || {}, 'position')
      ? body.position
      : existingAssignment?.forcedPosition ?? existingBlock?.forcedPosition;
  const autoInclude = Object.prototype.hasOwnProperty.call(body || {}, 'autoInclude')
    ? body.autoInclude
    : existingAssignment?.autoInclude ?? existingBlock?.autoInclude;
  const forceInclude = Object.prototype.hasOwnProperty.call(body || {}, 'forceInclude')
    ? body.forceInclude
    : existingAssignment?.forceInclude ?? existingBlock?.forceInclude;
  const assignmentMetadata = { ...sanitizeBlockMetadata(existingAssignment?.metadata || {}), ...sanitizeBlockMetadata(metadata) };
  if (agentTypes !== undefined) assignmentMetadata.agentTypes = agentTypes;
  return {
    blockType: typeof body?.blockType === 'string' && body.blockType.trim() ? body.blockType.trim() : (existingAssignment?.blockType || existingBlock?.blockType || undefined),
    autoInclude,
    forceInclude,
    forcedPosition,
    agentTypes,
    metadata: assignmentMetadata,
  };
}

function ensureCanonicalAssignmentForBlock(documentId, blockId, payload = {}, existingBlock = null, existingAssignment = null) {
  if (!documentId || !blockId) return null;
  const nextPayload = buildAssignmentPayloadFromRequest(payload, existingBlock, existingAssignment);
  return upsertPromptBlockTypeAssignment(documentId, blockId, nextPayload);
}

function attachAssignmentToBlock(block, assignment) {
  if (!block) return null;
  if (!assignment) return { ...block, role: null, agentTypes: undefined, forcedPosition: null, autoInclude: undefined, forceInclude: undefined };
  const agentTypes = Array.isArray(assignment.agentTypes) ? assignment.agentTypes : undefined;
  const role = agentTypes && agentTypes.length === 1 ? agentTypes[0] : null;
  return {
    ...block,
    role,
    agentTypes,
    forcedPosition: assignment.forcedPosition ?? null,
    autoInclude: !!assignment.autoInclude,
    forceInclude: !!assignment.forceInclude,
  };
}

function findDocumentBlockOrNull(documentId, blockId) {
  return listPromptBlocks(documentId).find((block) => String(block.id) === String(blockId)) || null;
}

function resolveGlobalPromptDocument() {
  return getOrBootstrapGlobalPromptDocument();
}

function requireGlobalPromptDocument(res) {
  const document = resolveGlobalPromptDocument();
  if (!document?.id) {
    res.status(500).json({ error: 'Failed to ensure global prompt document' });
    return null;
  }
  return document;
}

function resolveEffectivePromptRefTarget(effectiveRefs, selector) {
  const rawBlockId = String(selector?.blockId || '').trim();
  const canonicalRefIdentity = String(selector?.canonicalRefIdentity || '').trim();
  if (!Array.isArray(effectiveRefs) || (!rawBlockId && !canonicalRefIdentity)) return null;

  const canonicalMatches = canonicalRefIdentity
    ? effectiveRefs.filter((ref) => String(ref?.canonicalRefIdentity || '').trim() === canonicalRefIdentity)
    : [];
  if (canonicalMatches.length > 1) {
    return {
      error: 'ambiguous-canonical-ref-identity',
      selectorBlockId: rawBlockId || null,
      selectorCanonicalRefIdentity: canonicalRefIdentity || null,
    };
  }

  const canonicalMatch = canonicalMatches[0] || null;
  const normalizeCandidate = (value) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value).trim();
    return '';
  };
  const collectStringAliases = (ref) => {
    const aliases = [
      ref?.blockId,
      ref?.globalBlockId,
      ref?.inheritedBlockId,
      ref?.canonicalRefIdentity,
      ref?.identity,
      ref?.refIdentity,
      ref?.blockIdentity,
      ref?.globalRefIdentity,
      ref?.inheritedRefIdentity,
    ]
      .map(normalizeCandidate)
      .filter(Boolean);
    const effectiveRefIdentity = ref?.effectiveRefIdentity;
    if (effectiveRefIdentity && typeof effectiveRefIdentity === 'object' && !Array.isArray(effectiveRefIdentity)) {
      aliases.push(
        normalizeCandidate(effectiveRefIdentity.blockId),
        normalizeCandidate(effectiveRefIdentity.globalBlockId),
        normalizeCandidate(effectiveRefIdentity.localBlockId),
      );
    }
    return Array.from(new Set(aliases));
  };

  const matchesBySelector = rawBlockId
    ? effectiveRefs.reduce((matches, ref) => {
        const aliases = collectStringAliases(ref);
        if (aliases.includes(rawBlockId)) matches.push(ref);
        return matches;
      }, [])
    : [];

  if (matchesBySelector.length > 1) {
    return {
      error: 'ambiguous-prompt-ref-selector',
      selectorBlockId: rawBlockId || null,
      selectorCanonicalRefIdentity: canonicalRefIdentity || null,
      matchedBlockIds: matchesBySelector.map((ref) => String(ref?.blockId ?? '')).filter(Boolean),
    };
  }

  const blockIdMatch = matchesBySelector[0] || null;

  if (canonicalMatch && blockIdMatch && String(canonicalMatch.blockId) !== String(blockIdMatch.blockId)) {
    return {
      error: 'conflicting-prompt-ref-selectors',
      selectorBlockId: rawBlockId || null,
      selectorCanonicalRefIdentity: canonicalRefIdentity || null,
    };
  }

  const match = canonicalMatch || blockIdMatch;
  if (!match) return null;
  return {
    effectiveRef: match,
    resolvedBlockId: String(match.blockId),
    selectorBlockId: rawBlockId || null,
    selectorCanonicalRefIdentity: canonicalRefIdentity || null,
  };
}


router.get('/agents', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  try {
    const agents = listCanonicalVisibleAgents(username);

    const withHistory = agents.map((a) => {
      try {
        if (!a.isMaster) {
          const { sessions: _sessions, history: _history, activeSessionId: _activeSessionId, ...agentWithoutSessions } = a;
          return {
            ...agentWithoutSessions,
            activeSessionId: null,
            history: [],
            sessions: [],
          };
        }

        const allSessions = sessionStore.getSessions(String(username), a.id);
        const activeSessionId = a.activeSessionId;
        const activeSession = activeSessionId
          ? allSessions.find((session) => String(session.id) === String(activeSessionId)) || null
          : null;
        const effectiveActiveSessionId = activeSession ? activeSession.id : (allSessions[0]?.id || null);
        const sessionHistory = activeSession?.messages || (effectiveActiveSessionId === allSessions[0]?.id ? (allSessions[0]?.messages || []) : []);

        const { sessions: _sessions, history: _history, ...agentWithoutSessions } = a;
        const sessionsList = allSessions.map((s) => ({
          id: s.id,
          title: s.title || 'Session',
          summary: s.summary || '',
          lastModified: s.updatedAt || s.createdAt,
          history: [],
        }));

        return {
          ...agentWithoutSessions,
          activeSessionId: effectiveActiveSessionId,
          history: sessionHistory,
          sessions: sessionsList,
        };
      } catch (agentErr) {
        console.error(`[GET /agents] Error processing agent ${a.id}:`, agentErr.message);
        return { ...a, history: [], sessions: [] };
      }
    });

    return res.json({ agents: withHistory });
  } catch (err) {
    console.error('[GET /agents] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/agents', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { agent, agents: agentsBatch } = req.body;
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  if (Array.isArray(agentsBatch)) {
    const replaceAll = req.body?.replaceAll === true;
    const existingAgents = listAgents(username);
    const merged = replaceAll
      ? agentsBatch
      : [
          ...agentsBatch,
          ...existingAgents.filter((existing) => !agentsBatch.some((incoming) => String(incoming?.id) === String(existing?.id))),
        ];

    const persisted = replaceAgents(username, merged, { preserveExisting: false });
    return res.json({ success: true, agents: persisted, merged: !replaceAll });
  }

  if (!agent) {
    return res.status(400).json({ error: 'agent or agents required' });
  }

  const createdAgent = upsertAgent(username, agent);
  return res.json({ success: true, agent: createdAgent, agents: listAgents(username) });
});

router.put('/agents/:id', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { agent } = req.body;
  if (!username || !agent) {
    return res.status(!username ? 401 : 400).json({ error: !username ? 'authenticated username required' : 'agent required' });
  }

  const existing = getVisibleAgent(username, req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const nextAgent = { ...existing, ...agent, id: existing.id };
  if (existing.promptDocumentId) {
    const canonicalPrompt = getCurrentPromptVersion(existing.promptDocumentId)?.content;
    nextAgent.systemPrompt = typeof canonicalPrompt === 'string'
      ? canonicalPrompt
      : existing.systemPrompt;
    nextAgent.promptDocumentId = existing.promptDocumentId;
  }

  upsertAgent(username, nextAgent);

  return res.json({ success: true, agents: listCanonicalVisibleAgents(username) });
});

router.delete('/agents/:id', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const existing = getVisibleAgent(username, req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Agent not found' });
  }

  const deleted = deleteVisibleAgent(username, existing.id);
  if (!deleted) {
    return res.status(500).json({ error: 'Failed to delete agent' });
  }

  return res.json({ success: true, deletedId: String(existing.id) });
});

router.get('/agents/:id/prompt-document', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  const currentVersion = document?.id ? getCurrentPromptVersion(document.id) : null;

  return res.json({
    document: serializePromptDocumentResponse(document),
    currentVersion: serializePromptVersionResponse(currentVersion),
  });
});

router.get('/agents/:id/prompt-versions', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(404).json({ error: 'Prompt document not found' });

  return res.json({
    document: serializePromptDocumentResponse(document),
    versions: listPromptVersions(document.id).map(serializePromptVersionResponse),
  });
});

router.post('/agents/:id/prompt-publish', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const createdBy = req.body?.createdBy ?? agent.id;
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  const useComposition = req.body?.useComposition !== false;

  let currentVersion = null;
  let resolved = null;

  if (useComposition) {
    const published = publishPromptCompositionSnapshot(document.id, { createdBy, metadata, agentType: resolveCanonicalAgentType(agent) });
    currentVersion = published?.version || getCurrentPromptVersion(document.id);
    resolved = published?.resolved || null;
  } else {
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!content) return res.status(400).json({ error: 'content required when useComposition is false' });
    const version = createPromptVersion(document.id, { content, createdBy, metadata });
    currentVersion = version || getCurrentPromptVersion(document.id);
    resolved = { content: currentVersion?.content || content, blocks: [] };
  }

  upsertAgent(username, {
    ...agent,
    promptDocumentId: document.id,
    systemPrompt: currentVersion?.content || resolved?.content || '',
  });

  return res.json({
    document: serializePromptDocumentResponse(document),
    currentVersion: serializePromptVersionResponse(currentVersion),
    resolved: resolved ? {
      content: resolved.content || '',
      blocks: Array.isArray(resolved.blocks) ? resolved.blocks.map((item) => ({
        block: serializePromptBlockResponse(item.block),
        ref: serializePromptRefResponse(item.ref),
        version: serializePromptBlockVersionResponse(item.version),
        assignment: serializePromptAssignmentResponse(item.assignment),
      })) : [],
    } : null,
  });
});

router.get('/agents/:id/prompt-blocks', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const normalizedAgentType = resolveCanonicalAgentType(agent);
  const inventory = resolvePromptBlockInventoryForAgentDocument(document, { agentType: normalizedAgentType });
  const blocks = Array.isArray(inventory?.blocks) ? inventory.blocks : [];
  const effectiveRefs = Array.isArray(inventory?.refs) ? inventory.refs : [];
  const effectiveRefByBlockId = new Map(effectiveRefs.map((ref) => [String(ref.blockId), ref]));
  const localRefs = Array.isArray(inventory?.localRefs) ? inventory.localRefs : listPromptDocumentBlockRefs(document.id);
  const localRefByBlockId = new Map(localRefs.map((ref) => [String(ref.blockId), ref]));
  const disabledInheritedBlockIds = new Set(Array.isArray(inventory?.disabledInheritedBlockIds) ? inventory.disabledInheritedBlockIds.map((value) => String(value)) : []);

  return res.json({
    document: serializePromptDocumentResponse(document),
    blocks: blocks.map((block) => {
      const effectiveRef = effectiveRefByBlockId.get(String(block.id)) || null;
      const localRef = localRefByBlockId.get(String(block.id)) || null;
      const blockMetadata = block?.metadata || {};
      const isGlobalInventoryBlock = String(blockMetadata.origin || '') === 'global' || !!blockMetadata.inheritedFromGlobal;
      const inherited = isGlobalInventoryBlock ? !localRef : (!!effectiveRef?.inherited && !localRef);
      const origin = isGlobalInventoryBlock ? 'global' : 'local';
      const effectiveIncluded = localRef
        ? localRef.included !== false
        : (effectiveRef ? !!effectiveRef.included : !!blockMetadata.effectiveIncluded);
      return serializePromptBlockResponse({
        ...block,
        metadata: {
          ...(blockMetadata || {}),
          inherited,
          inheritedFromGlobal: isGlobalInventoryBlock,
          origin,
          effectiveIncluded,
          included: effectiveIncluded,
          inventoryKind: blockMetadata.inventoryKind || (isGlobalInventoryBlock ? (disabledInheritedBlockIds.has(String(block.id)) ? 'global-disabled' : (effectiveRef ? 'global-inherited' : 'global-available')) : 'local'),
          disabledLocally: disabledInheritedBlockIds.has(String(block.id)),
          inheritedBlockId: effectiveRef?.metadata?.inheritedBlockId || effectiveRef?.metadata?.globalBlockId || blockMetadata.inheritedBlockId || null,
          globalBlockId: blockMetadata.globalBlockId || (isGlobalInventoryBlock ? String(block.id) : null),
        },
      });
    }),
  });
});

router.post('/agents/:id/prompt-blocks', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const blockKey = typeof req.body?.blockKey === 'string' ? req.body.blockKey.trim() : '';
  if (!blockKey) return res.status(400).json({ error: 'blockKey required' });

  const blockType = typeof req.body?.blockType === 'string' && req.body.blockType.trim() ? req.body.blockType.trim() : 'text';
  const title = typeof req.body?.title === 'string' ? req.body.title : '';
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

  const created = createPromptBlock(document.id, { blockKey, blockType, title, content, metadata });
  const refs = resolveEffectivePromptRefsForAgentDocument(document, { agentType: resolveCanonicalAgentType(agent) });
  const nextPosition = refs.reduce((max, ref) => Math.max(max, Number(ref?.position) || 0), 0) + 1;
  upsertPromptDocumentBlockRef(document.id, created.block.id, {
    included: true,
    position: nextPosition,
    blockType,
    metadata: {
      ...(created.block?.metadata || {}),
      included: true,
      origin: 'local',
    },
  });
  return res.status(201).json({
    document: serializePromptDocumentResponse(document),
    block: serializePromptBlockResponse(created.block),
    version: serializePromptBlockVersionResponse(created.version),
  });
});

router.get('/agents/:id/prompt-blocks/:blockId/versions', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const block = findDocumentBlockOrNull(document.id, req.params.blockId);
  if (!block) return res.status(404).json({ error: 'Prompt block not found for agent document' });

  return res.json({
    document: serializePromptDocumentResponse(document),
    block: serializePromptBlockResponse(block),
    versions: listPromptBlockVersions(String(req.params.blockId)).map(serializePromptBlockVersionResponse),
  });
});

router.post('/agents/:id/prompt-blocks/:blockId/versions', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const block = findDocumentBlockOrNull(document.id, req.params.blockId);
  if (!block) return res.status(404).json({ error: 'Prompt block not found for agent document' });

  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (!content.trim()) return res.status(400).json({ error: 'content required' });
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  const createdBy = req.body?.createdBy ?? agent.id;

  const version = createPromptBlockVersion(String(req.params.blockId), { content, metadata, createdBy });
  return res.status(201).json({
    block: serializePromptBlockResponse(block),
    version: serializePromptBlockVersionResponse(version),
  });
});

router.get('/agents/:id/prompt-assignments', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  return res.json({
    document: serializePromptDocumentResponse(document),
    assignments: filterAssignmentsByRequestedAgentType(listPromptBlockTypeAssignments(document.id).map(serializePromptAssignmentResponse), resolveRequestedAgentType(req)),
  });
});

router.put('/agents/:id/prompt-assignments/:blockId', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const block = findDocumentBlockOrNull(document.id, req.params.blockId);
  if (!block) return res.status(404).json({ error: 'Prompt block not found for agent document' });

  const existingAssignment = getPromptBlockTypeAssignment(document.id, String(req.params.blockId));
  const assignment = upsertPromptBlockTypeAssignment(document.id, String(req.params.blockId), buildAssignmentPayloadFromRequest(withRequestedAgentType(req, req.body), block, existingAssignment));

  return res.json({
    document: serializePromptDocumentResponse(document),
    assignment: serializePromptAssignmentResponse(assignment),
    assignments: listPromptBlockTypeAssignments(document.id).map(serializePromptAssignmentResponse),
    refs: listPromptDocumentBlockRefs(document.id).map(serializePromptRefResponse),
  });
});

router.get('/agents/:id/prompt-refs', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  return res.json({
    document: serializePromptDocumentResponse(document),
    refs: resolveEffectivePromptRefsForAgentDocument(document, { agentType: resolveCanonicalAgentType(agent) }).map(serializePromptRefResponse),
  });
});

router.put('/agents/:id/prompt-refs/:blockId', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const selectorBlockId = String(req.params.blockId);
  const effective = resolveEffectivePromptForAgentDocument(document, { agentType: resolveCanonicalAgentType(agent) });
  const target = resolveEffectivePromptRefTarget(effective?.refs || [], {
    blockId: selectorBlockId,
    canonicalRefIdentity: req.body?.canonicalRefIdentity,
  });
  if (target?.error === 'ambiguous-canonical-ref-identity') {
    return res.status(409).json({ error: 'canonicalRefIdentity matched multiple prompt refs' });
  }
  if (target?.error === 'conflicting-prompt-ref-selectors') {
    return res.status(409).json({ error: 'canonicalRefIdentity conflicts with blockId selector' });
  }
  const blockId = target?.resolvedBlockId || selectorBlockId;
  const inventory = resolvePromptBlockInventoryForAgentDocument(document, { agentType: resolveCanonicalAgentType(agent) });
  const inventoryBlocks = Array.isArray(inventory?.blocks) ? inventory.blocks : [];
  const inventoryBlock = inventoryBlocks.find((item) => String(item?.id) === blockId || String(item?.id) === selectorBlockId) || null;
  const block = findDocumentBlockOrNull(document.id, blockId) || inventoryBlock;
  const effectiveRef = target?.effectiveRef || null;
  const inheritedGlobalBlockId = effectiveRef?.inherited ? String(effectiveRef.globalBlockId || effectiveRef.inheritedBlockId || blockId).trim() : '';
  const inheritedBlockId = effectiveRef?.inherited ? String(effectiveRef.inheritedBlockId || effectiveRef.globalBlockId || blockId).trim() : '';

  const included = Object.prototype.hasOwnProperty.call(req.body || {}, 'included') ? req.body.included : undefined;
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : undefined;

  if (!block && !effectiveRef?.inherited) {
    return res.status(404).json({ error: 'Prompt block not found for agent document' });
  }

  if (effectiveRef?.inherited) {
    const nextIncluded = included === undefined ? true : !!included;
    const inheritedMetadata = {
      ...(metadata || {}),
      inheritedBlockId,
      globalBlockId: inheritedGlobalBlockId,
      disableInherited: !nextIncluded,
      inheritedDisabled: !nextIncluded,
      inheritedFromGlobal: true,
      origin: 'local-override',
    };
    upsertPromptDocumentBlockRef(document.id, blockId, {
      blockVersionId: typeof req.body?.blockVersionId === 'string' ? req.body.blockVersionId : undefined,
      pinnedBlockVersionId: typeof req.body?.pinnedBlockVersionId === 'string' ? req.body.pinnedBlockVersionId : undefined,
      followCurrent: typeof req.body?.followCurrent === 'boolean' ? req.body.followCurrent : undefined,
      blockType: typeof req.body?.blockType === 'string' ? req.body.blockType : (effectiveRef.blockType || undefined),
      position: req.body?.position ?? effectiveRef.position,
      included: nextIncluded,
      metadata: inheritedMetadata,
    });
  } else {
    upsertPromptDocumentBlockRef(document.id, blockId, {
      blockVersionId: typeof req.body?.blockVersionId === 'string' ? req.body.blockVersionId : undefined,
      pinnedBlockVersionId: typeof req.body?.pinnedBlockVersionId === 'string' ? req.body.pinnedBlockVersionId : undefined,
      followCurrent: typeof req.body?.followCurrent === 'boolean' ? req.body.followCurrent : undefined,
      blockType: typeof req.body?.blockType === 'string' ? req.body.blockType : undefined,
      position: req.body?.position,
      included,
      metadata,
    });
  }

  const refs = resolveEffectivePromptRefsForAgentDocument(document, { agentType: resolveCanonicalAgentType(agent) });
  const ref = refs.find((item) => String(item.blockId) === blockId) || null;

  return res.json({
    document: serializePromptDocumentResponse(document),
    ref: serializePromptRefResponse(ref),
    refs: refs.map(serializePromptRefResponse),
  });
});

router.post('/agents/:id/prompt-refs/batch', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const refsInput = Array.isArray(req.body?.refs) ? req.body.refs : Array.isArray(req.body) ? req.body : [];
  if (!Array.isArray(refsInput)) return res.status(400).json({ error: 'refs array required' });

  const effectiveBeforeMutation = resolveEffectivePromptRefsForAgentDocument(document, { agentType: resolveCanonicalAgentType(agent) });

  for (const item of refsInput) {
    const target = resolveEffectivePromptRefTarget(effectiveBeforeMutation, {
      blockId: item?.blockId,
      canonicalRefIdentity: item?.canonicalRefIdentity,
    });
    if (target?.error) {
      return res.status(409).json({
        error: target.error === 'ambiguous-canonical-ref-identity'
          ? 'canonicalRefIdentity matched multiple prompt refs in batch item'
          : 'canonicalRefIdentity conflicts with blockId selector in batch item',
      });
    }
    const blockId = String(target?.resolvedBlockId || item?.blockId || '').trim();
    if (!blockId) continue;

    const block = findDocumentBlockOrNull(document.id, blockId);
    const effectiveRef = target?.effectiveRef || null;
    const included = Object.prototype.hasOwnProperty.call(item || {}, 'included') ? item.included : undefined;
    const metadata = item?.metadata && typeof item.metadata === 'object' ? item.metadata : undefined;
    const position = Object.prototype.hasOwnProperty.call(item || {}, 'position') ? item.position : undefined;

    if (!block && !effectiveRef?.inherited) continue;

    if (effectiveRef?.inherited && !block) {
      const nextIncluded = included === undefined ? !!effectiveRef.included : !!included;
      upsertPromptDocumentBlockRefWithoutSync(document.id, blockId, {
        blockVersionId: typeof item?.blockVersionId === 'string' ? item.blockVersionId : undefined,
        pinnedBlockVersionId: typeof item?.pinnedBlockVersionId === 'string' ? item.pinnedBlockVersionId : undefined,
        followCurrent: typeof item?.followCurrent === 'boolean' ? item.followCurrent : undefined,
        blockType: typeof item?.blockType === 'string' ? item.blockType : (effectiveRef.blockType || undefined),
        position: position ?? effectiveRef.position,
        included: nextIncluded,
        metadata: {
          ...(metadata || {}),
          inheritedBlockId: blockId,
          globalBlockId: blockId,
          disableInherited: !nextIncluded,
          inheritedDisabled: !nextIncluded,
          inheritedFromGlobal: true,
          origin: 'local-override',
        },
      });
    } else {
      upsertPromptDocumentBlockRefWithoutSync(document.id, blockId, {
        blockVersionId: typeof item?.blockVersionId === 'string' ? item.blockVersionId : undefined,
        pinnedBlockVersionId: typeof item?.pinnedBlockVersionId === 'string' ? item.pinnedBlockVersionId : undefined,
        followCurrent: typeof item?.followCurrent === 'boolean' ? item.followCurrent : undefined,
        blockType: typeof item?.blockType === 'string' ? item.blockType : undefined,
        position,
        included,
        metadata,
      });
    }
  }

  syncPromptDocumentBlockRefs(document.id, { agentType: resolveCanonicalAgentType(agent), preserveExistingBlockVersionIds: true });

  const refs = resolveEffectivePromptRefsForAgentDocument(document, { agentType: resolveCanonicalAgentType(agent) }).map(serializePromptRefResponse);
  return res.json({ document: serializePromptDocumentResponse(document), refs });
});

router.get('/agents/:id/prompt-composition-preview', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const resolved = resolveEffectivePromptForAgentDocument(document, { agentType: resolveCanonicalAgentType(agent) });
  return res.json({
    document: serializePromptDocumentResponse(document),
    preview: resolved?.content || '',
    content: resolved?.content || '',
    blocks: Array.isArray(resolved?.refs) ? resolved.refs.map((ref) => {
      const block = (resolved?.blocks || []).find((item) => String(item.id) === String(ref.blockId)) || null;
      return {
        block: serializePromptBlockResponse(block ? {
          ...block,
          metadata: { ...(block?.metadata || {}), inherited: !!ref?.inherited, origin: ref?.origin || 'local' },
        } : null),
        ref: serializePromptRefResponse(ref),
        version: null,
        assignment: null,
      };
    }) : [],
  });
});




router.delete('/agents/:id/prompt-blocks/:blockId', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const block = findDocumentBlockOrNull(document.id, req.params.blockId);
  if (!block) return res.status(404).json({ error: 'Prompt block not found for agent document' });

  const deleted = deletePromptBlock(document.id, block.id);
  if (!deleted) return res.status(404).json({ error: 'Prompt block not found for agent document' });

  return res.json({ success: true, deletedBlockId: block.id, documentId: document.id });
});

router.get('/settings/prompt-document', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  return res.json({
    document: serializePromptDocumentResponse(document),
    currentVersion: serializePromptVersionResponse(getCurrentPromptVersion(document.id)),
  });
});

router.get('/settings/prompt-blocks', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  const assignmentsByBlockId = new Map(listPromptBlockTypeAssignments(document.id).map((assignment) => [String(assignment.blockId), assignment]));
  return res.json({
    document: serializePromptDocumentResponse(document),
    blocks: listPromptBlocks(document.id).map((block) => serializePromptBlockResponse(attachAssignmentToBlock(block, assignmentsByBlockId.get(String(block.id)) || null))),
  });
});

router.get('/settings/prompt-blocks/:blockId/versions', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  const block = listPromptBlocks(document.id).find((item) => String(item.id) === String(req.params.blockId)) || null;
  if (!block) return res.status(404).json({ error: 'Prompt block not found for global document' });
  return res.json({
    document: serializePromptDocumentResponse(document),
    block: serializePromptBlockResponse(block),
    versions: listPromptBlockVersions(String(req.params.blockId)).map(serializePromptBlockVersionResponse),
  });
});

router.get('/settings/prompt-assignments', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  const requestedAgentType = resolveRequestedAgentType(req);
  const assignments = filterAssignmentsByRequestedAgentType(listPromptBlockTypeAssignments(document.id), requestedAgentType);
  return res.json({
    document: serializePromptDocumentResponse(document),
    assignments: assignments.map(serializePromptAssignmentResponse),
  });
});

router.put('/settings/prompt-assignments/:blockId', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  const block = listPromptBlocks(document.id).find((item) => String(item.id) === String(req.params.blockId)) || null;
  if (!block) return res.status(404).json({ error: 'Prompt block not found for global document' });
  const existingAssignment = getPromptBlockTypeAssignment(document.id, String(req.params.blockId));
  const assignment = upsertPromptBlockTypeAssignment(document.id, String(req.params.blockId), buildAssignmentPayloadFromRequest(req.body, block, existingAssignment));
  return res.json({ document: serializePromptDocumentResponse(document), assignment: serializePromptAssignmentResponse(assignment) });
});

router.get('/settings/prompt-refs', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  return res.json({
    document: serializePromptDocumentResponse(document),
    refs: listPromptDocumentBlockRefs(document.id).map(serializePromptRefResponse),
  });
});

router.put('/settings/prompt-refs/:blockId', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  const block = listPromptBlocks(document.id).find((item) => String(item.id) === String(req.params.blockId)) || null;
  if (!block) return res.status(404).json({ error: 'Prompt block not found for global document' });
  const blockId = String(req.params.blockId);
  const existingAssignment = getPromptBlockTypeAssignment(document.id, blockId);
  const assignmentPayload = withRequestedAgentType(req, req.body);
  const rawMetadata = assignmentPayload?.metadata && typeof assignmentPayload.metadata === 'object' && !Array.isArray(assignmentPayload.metadata) ? assignmentPayload.metadata : {};
  const hasExplicitAssignmentScope = Boolean(
    Object.prototype.hasOwnProperty.call(assignmentPayload || {}, 'agentType')
    || Object.prototype.hasOwnProperty.call(assignmentPayload || {}, 'role')
    || Object.prototype.hasOwnProperty.call(assignmentPayload || {}, 'agentTypes')
    || Object.prototype.hasOwnProperty.call(assignmentPayload || {}, 'agent_types')
    || Object.prototype.hasOwnProperty.call(rawMetadata, 'agentType')
    || Object.prototype.hasOwnProperty.call(rawMetadata, 'role')
    || Object.prototype.hasOwnProperty.call(rawMetadata, 'agentTypes')
    || Object.prototype.hasOwnProperty.call(rawMetadata, 'agent_types')
  );
  if (existingAssignment || hasExplicitAssignmentScope) {
    ensureCanonicalAssignmentForBlock(document.id, blockId, assignmentPayload, block, existingAssignment);
  }
  const included = Object.prototype.hasOwnProperty.call(req.body || {}, 'included') ? req.body.included : undefined;
  upsertPromptDocumentBlockRef(document.id, blockId, {
    blockVersionId: typeof req.body?.blockVersionId === 'string' ? req.body.blockVersionId : undefined,
    pinnedBlockVersionId: typeof req.body?.pinnedBlockVersionId === 'string' ? req.body.pinnedBlockVersionId : undefined,
    followCurrent: typeof req.body?.followCurrent === 'boolean' ? req.body.followCurrent : undefined,
    blockType: typeof req.body?.blockType === 'string' ? req.body.blockType : undefined,
    position: req.body?.position,
    included,
    metadata: rawMetadata,
  });
  const refs = listPromptDocumentBlockRefs(document.id);
  const ref = refs.find((item) => String(item.blockId) === String(req.params.blockId)) || null;
  return res.json({ document: serializePromptDocumentResponse(document), ref: serializePromptRefResponse(ref), refs: refs.map(serializePromptRefResponse) });
});

router.get('/settings/prompt-composition-preview', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  const resolved = resolvePromptFinalByCompositionForDocument(document.id, withRequestedAgentType(req));
  return res.json({
    document: serializePromptDocumentResponse(document),
    preview: resolved?.content || '',
    content: resolved?.content || '',
    blocks: Array.isArray(resolved?.blocks) ? resolved.blocks.map((item) => ({
      block: serializePromptBlockResponse(item.block),
      ref: serializePromptRefResponse(item.ref),
      version: serializePromptBlockVersionResponse(item.version),
      assignment: serializePromptAssignmentResponse(item.assignment),
    })) : [],
  });
});


router.delete('/settings/prompt-blocks/:blockId', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;

  const block = findDocumentBlockOrNull(document.id, req.params.blockId);
  if (!block) {
    return res.status(404).json({ error: 'Prompt block not found' });
  }

  const deleted = deletePromptBlock(document.id, block.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Prompt block not found' });
  }

  return res.json({ success: true, deletedBlockId: block.id, documentId: document.id });
});
router.post('/settings/prompt-blocks', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;

  const blockKey = typeof req.body?.blockKey === 'string' ? req.body.blockKey.trim() : '';
  if (!blockKey) return res.status(400).json({ error: 'blockKey required' });

  const blockType = typeof req.body?.blockType === 'string' && req.body.blockType.trim() ? req.body.blockType.trim() : 'text';
  const title = typeof req.body?.title === 'string' ? req.body.title : '';
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const metadata = sanitizeBlockMetadata(req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {});

  const created = createPromptBlock(document.id, { blockKey, blockType, title, content, metadata });
  const assignmentPayload = buildAssignmentPayloadFromRequest(req.body, created.block, null);
  const assignment = upsertPromptBlockTypeAssignment(document.id, created.block.id, assignmentPayload);
  return res.status(201).json({
    document: serializePromptDocumentResponse(document),
    block: serializePromptBlockResponse(attachAssignmentToBlock(created.block, assignment)),
    version: serializePromptBlockVersionResponse(created.version),
    assignment: serializePromptAssignmentResponse(assignment),
  });
});

router.post('/settings/prompt-blocks/:blockId/versions', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  const block = listPromptBlocks(document.id).find((item) => String(item.id) === String(req.params.blockId)) || null;
  if (!block) return res.status(404).json({ error: 'Prompt block not found for global document' });

  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (!content.trim()) return res.status(400).json({ error: 'content required' });
  const metadata = sanitizeBlockMetadata(req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {});
  const createdBy = req.body?.createdBy ?? null;

  const version = createPromptBlockVersion(String(req.params.blockId), { content, metadata, createdBy });
  const existingAssignment = getPromptBlockTypeAssignment(document.id, String(req.params.blockId));
  const assignment = upsertPromptBlockTypeAssignment(document.id, String(req.params.blockId), buildAssignmentPayloadFromRequest(req.body, block, existingAssignment));
  return res.status(201).json({
    block: serializePromptBlockResponse(attachAssignmentToBlock(block, assignment)),
    version: serializePromptBlockVersionResponse(version),
    assignment: serializePromptAssignmentResponse(assignment),
  });
});

router.post('/settings/prompt-publish', checkLocalAccess, (req, res) => {
  const document = requireGlobalPromptDocument(res);
  if (!document) return;
  const username = resolveScopedUsername(req);
  const createdBy = req.body?.createdBy ?? null;
  const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
  const agentList = listAgents(username).filter((agent) => !!resolveCanonicalAgentType(agent));

  const buildCanonicalEffectiveSnapshot = (effective) => {
    const content = typeof effective?.content === 'string' ? effective.content : '';
    const version = effective?.currentVersion || effective?.version || null;
    const blocks = Array.isArray(effective?.blocks) ? effective.blocks : [];
    const refs = Array.isArray(effective?.refs) ? effective.refs : [];
    if (content || version) {
      return {
        kind: 'effective-content',
        content,
        versionId: version?.id || null,
        version: version?.version ?? null,
        blocks: blocks.map((item, index) => ({
          index,
          blockId: String(item?.id || item?.blockId || ''),
          versionId: item?.currentVersionId || item?.versionId || item?.blockVersionId || null,
          content: typeof item?.content === 'string' ? item.content : '',
        })),
        refs: refs.map((ref, index) => ({
          index,
          blockId: String(ref?.blockId || ''),
          blockVersionId: String(ref?.blockVersionId || ''),
          pinnedBlockVersionId: String(ref?.pinnedBlockVersionId || ''),
          included: !!ref?.included,
          position: ref?.position ?? null,
        })),
      };
    }
    return {
      kind: 'block-ref-composition',
      blocks: blocks.map((item, index) => ({
        index,
        blockId: String(item?.id || item?.blockId || ''),
        versionId: item?.currentVersionId || item?.versionId || item?.blockVersionId || null,
        content: typeof item?.content === 'string' ? item.content : '',
      })),
      refs: refs.map((ref, index) => ({
        index,
        blockId: String(ref?.blockId || ''),
        blockVersionId: String(ref?.blockVersionId || ''),
        pinnedBlockVersionId: String(ref?.pinnedBlockVersionId || ''),
        included: !!ref?.included,
        position: ref?.position ?? null,
      })),
    };
  };

  const agentSnapshotsBefore = new Map();
  for (const agent of agentList) {
    const agentType = resolveCanonicalAgentType(agent);
    const agentDocument = getOrBootstrapPromptDocumentByAgent({ username, agentId: agent.id });
    if (!agentDocument?.id || !agentType) continue;
    agentSnapshotsBefore.set(String(agent.id), buildCanonicalEffectiveSnapshot(resolveEffectivePromptForAgentDocument(agentDocument, { agentType })));
  }

  const published = publishPromptCompositionSnapshot(document.id, withRequestedAgentType(req, { createdBy, metadata }));
  const propagated = [];
  for (const agent of agentList) {
    const agentType = resolveCanonicalAgentType(agent);
    const agentDocument = getOrBootstrapPromptDocumentByAgent({ username, agentId: agent.id });
    if (!agentDocument?.id || !agentType) continue;
    const beforeSnapshot = agentSnapshotsBefore.get(String(agent.id)) || null;
    const effectiveAfterGlobalPublish = resolveEffectivePromptForAgentDocument(agentDocument, { agentType });
    const afterSnapshot = buildCanonicalEffectiveSnapshot(effectiveAfterGlobalPublish);
    const agentCurrentVersion = createPromptVersion(agentDocument.id, {
      content: typeof effectiveAfterGlobalPublish?.content === 'string' ? effectiveAfterGlobalPublish.content : '',
      createdBy: createdBy ?? agent.id,
      metadata: { ...metadata, propagatedFromGlobal: true, forcePromoteComposition: true, compositionResolvedFromEffectivePrompt: true },
    });
    if (agentCurrentVersion?.content !== undefined) {
      agentDocument.systemPrompt = typeof agentCurrentVersion.content === 'string' ? agentCurrentVersion.content : '';
      upsertAgent(username, { ...agent, systemPrompt: agentDocument.systemPrompt });
    }
    propagated.push({
      agentId: String(agent.id),
      agentType,
      currentVersionId: agentCurrentVersion?.id || null,
      snapshotKind: afterSnapshot.kind,
      forced: true,
      beforeSnapshotKind: beforeSnapshot?.kind || null,
      afterSnapshotKind: afterSnapshot.kind,
    });
  }
  return res.json({
    document: serializePromptDocumentResponse(document),
    currentVersion: serializePromptVersionResponse(published?.version || null),
    resolved: published?.resolved ? {
      content: published.resolved.content || '',
      blocks: Array.isArray(published.resolved.blocks) ? published.resolved.blocks.map((item) => ({
        block: serializePromptBlockResponse(item.block),
        ref: serializePromptRefResponse(item.ref),
        version: serializePromptBlockVersionResponse(item.version),
        assignment: serializePromptAssignmentResponse(item.assignment),
      })) : [],
    } : null,
    propagated,
    snapshotComparison: 'effective prompt snapshot normalized from resolveEffectivePromptForAgentDocument(agentDocument, { agentType }); uses effective content when present, otherwise ordered block/ref composition',
  });
});

router.post('/agents/:id/prompt-rollback', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const versionId = typeof req.body?.versionId === 'string' ? req.body.versionId : '';
  if (!versionId) return res.status(400).json({ error: 'versionId required' });

  const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(agent.id) });
  if (!document?.id) return res.status(500).json({ error: 'Failed to ensure prompt document' });

  const rolledBack = rollbackPromptVersion(document.id, versionId);
  if (!rolledBack) return res.status(404).json({ error: 'Version not found for document' });

  upsertAgent(username, {
    ...agent,
    promptDocumentId: document.id,
    systemPrompt: rolledBack.currentVersion?.content || '',
  });

  return res.json({
    document: serializePromptDocumentResponse(rolledBack.document),
    currentVersion: serializePromptVersionResponse(rolledBack.currentVersion),
  });
});

router.get('/agents/:id/sessions', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);

  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  if (!agent.isMaster) {
    return res.status(400).json({ error: 'Sessions only available for master agent' });
  }

  const sessions = sessionStore.getSessions(String(username), String(agent.id)).map((s) => ({
    id: s.id,
    title: s.title || 'Session',
    summary: s.summary || '',
    lastModified: s.updatedAt || s.createdAt,
    history: [],
  }));
  const activeSessionId = sessions.some((s) => String(s.id) === String(agent.activeSessionId || ''))
    ? agent.activeSessionId
    : (sessions[0]?.id || null);

  return res.json({
    sessions,
    activeSessionId,
  });
});

router.put('/agents/:id/sessions', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { activeSessionId } = req.body;
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  if (!agent.isMaster) {
    return res.status(400).json({ error: 'Sessions only available for master agent' });
  }

  if (activeSessionId !== undefined && activeSessionId !== null && activeSessionId !== '') {
    const session = sessionStore.getSession(String(activeSessionId));
    if (!session) {
      return res.status(400).json({ error: 'Active session not found' });
    }
    if (String(session.username) !== String(username) || String(session.agentId) !== String(agent.id)) {
      return res.status(400).json({ error: 'Active session does not belong to this user/agent' });
    }
  }

  const nextAgent = {
    ...agent,
    activeSessionId: activeSessionId === '' ? null : activeSessionId,
    lastModified: Date.now(),
  };

  upsertAgent(username, nextAgent);
  return res.json({ success: true, activeSessionId: nextAgent.activeSessionId || null });
});

router.delete('/agents/:id/history', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { sessionId } = req.body;
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const agent = getVisibleAgent(username, req.params.id);

  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  if (!agent.isMaster) {
    return res.status(400).json({ error: 'History only available for master agent' });
  }

  const activeSessionId = sessionId || agent.activeSessionId;

  if (activeSessionId) {
    try {
      const session = sessionStore.getSession(String(activeSessionId));
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (String(session.username) !== String(username) || String(session.agentId) !== String(agent.id)) {
        return res.status(400).json({ error: 'Session does not belong to this user/agent' });
      }
      sessionStore.setMessages(String(activeSessionId), []);
    } catch (e) {
      console.warn('[History] Failed to clear sessionStore:', e.message);
      return res.status(500).json({ error: 'Failed to clear session history' });
    }
  }

  upsertAgent(username, { ...agent, lastModified: Date.now() });

  return res.json({ success: true, sessionId: activeSessionId || null });
});

export default router;