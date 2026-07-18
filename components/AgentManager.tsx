import React, { useState, useEffect, useRef } from 'react';
import type { Agent, ModelConfig } from '../types';
import * as typesModule from '../types';

const CANONICAL_AGENT_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f97316', '#ef4444', '#ec4899', '#06b6d4', '#f59e0b'];
const { AGENT_COLORS } = typesModule as any;
const safeAgentColors = Array.isArray(AGENT_COLORS) && AGENT_COLORS.length > 0 ? AGENT_COLORS : CANONICAL_AGENT_COLORS;
import { ToolsSelector } from './ToolsSelector';
import * as localApiService from '../services/localApiService';
const { fetchAgents, fetchAgentPromptDocument, fetchAgentPromptVersions, fetchAgentPromptBlocks, fetchPromptRefs, updatePromptRefs, updatePromptRefsBatch, fetchCompositionPreview, publishPromptComposition, rollbackAgentPrompt, createPromptBlock, createPromptBlockVersion, deletePromptBlock } = localApiService as any;

const normalizeTags = (value: string) => value.split(',').map(tag => tag.trim()).filter(Boolean);

const formatVersionDateTime = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';

  const date = (() => {
    if (value instanceof Date) return value;

    if (typeof value === 'number') {
      const timestamp = value > 0 && value < 1e12 ? value * 1000 : value;
      return new Date(timestamp);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
        const numericValue = Number(trimmed);
        if (!Number.isFinite(numericValue)) return new Date(trimmed);
        const timestamp = numericValue > 0 && numericValue < 1e12 ? numericValue * 1000 : numericValue;
        return new Date(timestamp);
      }
      return new Date(trimmed);
    }

    return new Date(value as any);
  })();

  if (!date || Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
};

interface AgentManagerProps {
  agent?: Agent;
  models: ModelConfig[];
  username: string;
  onSave: (agent: Agent) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: (id: string) => void | Promise<void>;
  canDelete?: boolean;
  isLoading?: boolean;
  error?: string;
}

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

type Tab = 'general' | 'tools' | 'limits';

const AgentManager: React.FC<AgentManagerProps> = ({
  agent, models, username, onSave, onCancel, onDelete, canDelete = true, isLoading = false, error = ''
}) => {
  const safeModels = Array.isArray(models) ? models : [];
  const [tab, setTab]                       = useState<Tab>('general');
  const [name, setName]                     = useState(agent?.name || '');
  const [model, setModel]                   = useState(agent?.model || '');
  const [systemPrompt, setSystemPrompt]     = useState(agent?.systemPrompt || 'You are a helpful assistant.');
  const isExistingAgent = Boolean(agent?.id);
  const canEditSystemPrompt = !isExistingAgent;
  const [color, setColor]                   = useState(agent?.color || safeAgentColors[0]);
  const [role, setRole]                     = useState<Agent['role']>(agent?.role || 'worker');
  const [executionMode, setExecutionMode]   = useState<Agent['executionMode']>(agent?.executionMode || 'strict');
  const [tagsInput, setTagsInput]           = useState((agent?.tags || []).join(', '));
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(agent?.timeoutSeconds ?? 60);
  const [maxRetries, setMaxRetries]         = useState<number>(agent?.maxRetries ?? 2);
  const [allowedTools, setAllowedTools]     = useState<string[]>(agent?.allowedTools ?? []);
  const [reasoning, setReasoning]           = useState<boolean>(agent?.reasoning ?? false);
  const [canonicalPromptLoading, setCanonicalPromptLoading] = useState(false);
  const [canonicalPromptError, setCanonicalPromptError] = useState('');
  const [canonicalPromptFeedback, setCanonicalPromptFeedback] = useState('');
  const [canonicalPromptPublishing, setCanonicalPromptPublishing] = useState(false);
  const [canonicalPromptRollingBack, setCanonicalPromptRollingBack] = useState(false);
  const [canonicalPromptPreview, setCanonicalPromptPreview] = useState('');
  const [promptDocument, setPromptDocument] = useState<any>(null);
  const [promptCurrentVersion, setPromptCurrentVersion] = useState<any>(null);
  const [promptVersions, setPromptVersions] = useState<any[]>([]);
  const [promptBlocks, setPromptBlocks] = useState<any[]>([]);
  const [promptRefs, setPromptRefs] = useState<any[]>([]);
  const [compositionPreview, setCompositionPreview] = useState<any>(null);
  const [newBlockTitle, setNewBlockTitle] = useState('');
  const [newBlockKey, setNewBlockKey] = useState('');
  const [newBlockContent, setNewBlockContent] = useState('');
  const [newBlockSaving, setNewBlockSaving] = useState(false);
  const [newBlockError, setNewBlockError] = useState('');
  const [editingLocalBlockId, setEditingLocalBlockId] = useState('');
  const [editingLocalBlockContent, setEditingLocalBlockContent] = useState('');
  const [editingLocalBlockSaving, setEditingLocalBlockSaving] = useState(false);
  const [selectedPromptVersionId, setSelectedPromptVersionId] = useState('');
  const canonicalPromptRequestRef = useRef(0);

  // Fetch-on-open: busca o agente fresco do servidor ao montar o modal
  useEffect(() => {
    if (!agent?.id) return;
    let cancelled = false;
    const load = async () => {
      canonicalPromptRequestRef.current += 1;
      setCanonicalPromptLoading(true);
      setCanonicalPromptError('');
      setCanonicalPromptFeedback('');
      setPromptDocument(null);
      setPromptCurrentVersion(null);
      setPromptVersions([]);
      setPromptBlocks([]);
      setCompositionPreview(null);
      setCanonicalPromptPreview('');
      try {
        const agents = await fetchAgents(username);
        const fresh = agents?.find((a: Agent) => a.id === agent.id);
        if (fresh && !cancelled) {
          setName(fresh.name || '');
          setModel(fresh.model || '');
          setSystemPrompt(fresh.systemPrompt || 'You are a helpful assistant.');
          setColor(fresh.color || safeAgentColors[0]);
          setRole(fresh.role || (fresh.isMaster ? 'master' : 'worker'));
          setExecutionMode(fresh.executionMode || 'strict');
          setTagsInput((fresh.tags || []).join(', '));
          setTimeoutSeconds(fresh.timeoutSeconds ?? 60);
          setMaxRetries(fresh.maxRetries ?? 2);
          setAllowedTools(fresh.allowedTools ?? []);
          setReasoning(fresh.reasoning ?? false);
        }

        await reloadCanonicalPrompt(agent.id);
      } catch (e: any) {
        if (!cancelled) setCanonicalPromptError(e?.message || 'Failed to load canonical prompt');
      } finally {
        if (!cancelled) setCanonicalPromptLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [agent?.id, username]);

  useEffect(() => {
    if (!model && safeModels.length > 0) setModel(safeModels[0].modelId);
  }, [safeModels, model]);

  const reloadCanonicalPrompt = async (agentId: string) => {
    const requestId = ++canonicalPromptRequestRef.current;
    const [docResult, versionsResult, blocksResult, refsResult, previewResult] = await Promise.allSettled([
      fetchAgentPromptDocument(username, agentId),
      fetchAgentPromptVersions(username, agentId),
      fetchAgentPromptBlocks(username, agentId),
      fetchPromptRefs(username, agentId),
      fetchCompositionPreview(username, agentId),
    ]);

    if (requestId !== canonicalPromptRequestRef.current || agentId !== agent?.id) return;

    const resolvedPromptRefs = refsResult.status === 'fulfilled'
      ? (Array.isArray(refsResult.value)
          ? refsResult.value
          : (Array.isArray((refsResult.value as any)?.refs) ? (refsResult.value as any).refs : []))
      : [];

    console.log('[prompt-reorder] reloadCanonicalPrompt snapshots', {
      promptRefs: resolvedPromptRefs.map((ref: any) => ({
        blockId: getPromptRefIdentity(ref),
        position: ref?.position,
        included: ref?.included,
      })),
      promptBlocks: blocksResult.status === 'fulfilled' && Array.isArray(blocksResult.value)
        ? blocksResult.value.map((block: any) => ({
            blockId: getPromptBlockIdentity(block),
            position: block?.position,
            included: block?.included,
          }))
        : [],
    });

    let hadError = false;

    if (blocksResult.status === 'fulfilled') {
      setPromptBlocks(Array.isArray(blocksResult.value) ? blocksResult.value : []);
    } else {
      hadError = true;
      setPromptBlocks([]);
    }

    if (refsResult.status === 'fulfilled') {
      setPromptRefs(resolvedPromptRefs);
    } else {
      hadError = true;
      setPromptRefs([]);
    }

    if (docResult.status === 'fulfilled') {
      const docRes = docResult.value;
      setPromptDocument(docRes?.document ?? null);
      setPromptCurrentVersion(docRes?.currentVersion ?? null);
    } else {
      hadError = true;
      setPromptDocument(null);
      setPromptCurrentVersion(null);
    }

    if (versionsResult.status === 'fulfilled') {
      const versionsRes = versionsResult.value;
      const nextVersions = Array.isArray(versionsRes?.versions) ? versionsRes.versions : [];
      setPromptVersions(nextVersions);
      setSelectedPromptVersionId((currentSelected) => {
        if (currentSelected && nextVersions.some((version: any) => String(version?.id) === String(currentSelected))) return currentSelected;
        return String(nextVersions[0]?.id || '');
      });
    } else {
      hadError = true;
      setPromptVersions([]);
      setSelectedPromptVersionId('');
    }

    if (previewResult.status === 'fulfilled') {
      const previewRes = previewResult.value;
      setCompositionPreview(previewRes ?? null);
      setCanonicalPromptPreview(previewRes?.preview ?? previewRes?.content ?? '');
    } else {
      hadError = true;
      setCompositionPreview(null);
      setCanonicalPromptPreview('');
    }

    if (hadError) {
      setCanonicalPromptError('Canonical prompt data partially failed to load.');
    } else {
      setCanonicalPromptError('');
    }
  };

  const handlePublishCanonicalPrompt = async () => {
    if (!agent?.id || canonicalPromptPublishing || canonicalPromptRollingBack) return;
    setCanonicalPromptPublishing(true);
    setCanonicalPromptError('');
    setCanonicalPromptFeedback('');
    try {
      const publishRes = await publishPromptComposition(username, agent.id);
      const publishedContent = publishRes?.currentVersion?.content ?? publishRes?.content ?? '';
      if (publishRes?.document) setPromptDocument(publishRes.document);
      if (publishRes?.currentVersion) setPromptCurrentVersion(publishRes.currentVersion);
      setCanonicalPromptPreview(publishedContent);
      if (publishedContent) setSystemPrompt(publishedContent);
      await reloadCanonicalPrompt(agent.id);
      setCanonicalPromptFeedback('Canonical prompt published successfully.');
    } catch (e: any) {
      setCanonicalPromptError(e?.message || 'Failed to publish canonical prompt');
    } finally {
      setCanonicalPromptPublishing(false);
    }
  };

  const selectedPromptVersion = (promptVersions || []).find((version: any) => String(version?.id) === String(selectedPromptVersionId)) || null;

  const handleSelectPromptVersion = (versionId: string) => {
    setSelectedPromptVersionId(String(versionId || ''));
    setCanonicalPromptError('');
    setCanonicalPromptFeedback('');
  };

  const handleRollbackCanonicalPrompt = async (versionId: string) => {
    if (!agent?.id || canonicalPromptPublishing || canonicalPromptRollingBack) return;
    setCanonicalPromptRollingBack(true);
    setCanonicalPromptError('');
    setCanonicalPromptFeedback('');
    try {
      const rollbackRes = await rollbackAgentPrompt(username, agent.id, versionId);
      const rolledBackContent = rollbackRes?.currentVersion?.content ?? systemPrompt;
      setPromptDocument(rollbackRes?.document ?? null);
      setPromptCurrentVersion(rollbackRes?.currentVersion ?? null);
      setCanonicalPromptPreview(rolledBackContent);
      setSystemPrompt(rolledBackContent);
      await reloadCanonicalPrompt(agent.id);
      setCanonicalPromptFeedback('Canonical prompt rolled back successfully.');
    } catch (e: any) {
      setCanonicalPromptError(e?.message || 'Failed to rollback canonical prompt');
    } finally {
      setCanonicalPromptRollingBack(false);
    }
  };

  const getPromptBlockIdentity = (block: any) => {
    const canonicalIdentity =
      block?.effectivePromptRefId ??
      block?.effectivePromptRefIdentity ??
      block?.canonicalPromptRefId ??
      block?.canonicalPromptRefIdentity ??
      block?.canonicalIdentity ??
      block?.canonicalRefIdentity ??
      block?.metadata?.effectivePromptRefId ??
      block?.metadata?.effectivePromptRefIdentity ??
      block?.metadata?.canonicalPromptRefId ??
      block?.metadata?.canonicalPromptRefIdentity ??
      block?.metadata?.canonicalIdentity ??
      block?.metadata?.canonicalRefIdentity;
    return canonicalIdentity ?? block?.blockId ?? block?.id ?? block?.blockKey ?? block?.refId ?? '';
  };

  const getPromptRefIdentity = (item: any) =>
    item?.effectivePromptRefId ??
    item?.effectivePromptRefIdentity ??
    item?.canonicalPromptRefId ??
    item?.canonicalPromptRefIdentity ??
    item?.blockId ??
    item?.refId ??
    item?.id ??
    item?.blockKey ?? '';

  const getPromptBlockPreview = (block: any) => {
    const rawPreview = (block?.content ?? block?.text ?? '').toString().trim();
    if (!rawPreview) return 'No preview available.';
    return rawPreview.length > 120 ? `${rawPreview.slice(0, 117)}...` : rawPreview;
  };

  const getPromptBlockOrigin = (block: any) => {
    const ref = getPromptBlockRef(block);
    const blockMetaOrigin = block?.metadata?.origin;
    if (ref?.origin === 'global' || ref?.inherited || block?.metadata?.inherited || block?.metadata?.inheritedFromGlobal || blockMetaOrigin === 'global') return 'global';
    return 'local';
  };

  const isInheritedPromptBlock = (block: any) => getPromptBlockOrigin(block) === 'global';

  const includedPromptRefs = (promptRefs || [])
    .filter((ref: any) => ref?.included !== false)
    .slice()
    .sort((a: any, b: any) => (a?.position ?? 0) - (b?.position ?? 0));

  const promptRefsByIdentity = new Map((promptRefs || []).map((ref: any) => [getPromptRefIdentity(ref), ref]));
  const promptBlocksByIdentity = new Map((promptBlocks || []).map((block: any) => [getPromptBlockIdentity(block), block]));
  const resolvedIncludedPromptRefs = includedPromptRefs.filter((ref: any) => promptBlocksByIdentity.has(getPromptRefIdentity(ref)));
  const resolvedIncludedPromptRefIdentities = new Set(resolvedIncludedPromptRefs.map((ref: any) => getPromptRefIdentity(ref)));
  const orderedPromptBlocks = [
    ...resolvedIncludedPromptRefs
      .map((ref: any) => promptBlocksByIdentity.get(getPromptRefIdentity(ref)))
      .filter(Boolean),
    ...promptBlocks.filter((block: any) => {
      const blockIdentity = getPromptBlockIdentity(block);
      return !resolvedIncludedPromptRefIdentities.has(blockIdentity) && !resolvedIncludedPromptRefs.some((ref: any) => getPromptRefIdentity(ref) === blockIdentity);
    }),
  ];

  const logPromptReorderSnapshot = (label: string) => {
    console.log(label, {
      orderedBlocks: orderedPromptBlocks.map((block: any) => getPromptBlockIdentity(block)),
      refOrder: resolvedIncludedPromptRefs.map((ref: any) => ({
        blockId: getPromptRefIdentity(ref),
        position: ref?.position,
        included: ref?.included,
      })),
    });
  };

  const getPromptBlockRef = (block: any) => {
    const blockIdentity = getPromptBlockIdentity(block);
    return promptRefsByIdentity.get(blockIdentity) ?? promptRefsByIdentity.get(block?.blockId) ?? promptRefsByIdentity.get(block?.id) ?? promptRefsByIdentity.get(block?.blockKey);
  };


  const getPromptBlockOrder = (block: any) => {
    const identity = getPromptBlockIdentity(block);
    const includedIndex = resolvedIncludedPromptRefs.findIndex((ref: any) => getPromptRefIdentity(ref) === identity);
    return includedIndex >= 0 ? includedIndex + 1 : null;
  };

  const handleTogglePromptRef = async (block: any, included: boolean) => {
    if (!agent?.id) return;
    const blockRef = getPromptBlockRef(block);
    const refIdentity = getPromptRefIdentity(blockRef ?? block);
    const nextPosition = included ? resolvedIncludedPromptRefs.length : (blockRef?.position ?? 0);
    try {
      await updatePromptRefs(username, agent.id, refIdentity, {
        included,
        position: nextPosition,
      });
      await reloadCanonicalPrompt(agent.id);
    } catch (e: any) {
      setCanonicalPromptError(e?.message || 'Failed to update prompt ref');
    }
  };

  const handleMovePromptRef = async (block: any, direction: -1 | 1) => {
    logPromptReorderSnapshot('[prompt-reorder] render order snapshot');
    console.log('[prompt-reorder] move handler invoked', {
      direction,
      blockIdentity: getPromptBlockIdentity(block),
      blockTitle: block?.title ?? block?.blockKey ?? block?.id ?? '',
      blockRefIdentity: getPromptRefIdentity(getPromptBlockRef(block) ?? block),
      includedRefIdentities: resolvedIncludedPromptRefs.map((ref: any) => getPromptRefIdentity(ref)),
      includedRefPositions: resolvedIncludedPromptRefs.map((ref: any) => ({ identity: getPromptRefIdentity(ref), position: ref?.position })),
    });
    if (!agent?.id) {
      console.log('[prompt-reorder] guard triggered', { reason: 'missing agent.id' });
      return;
    }
    const blockRef = getPromptBlockRef(block);
    console.log('[prompt-reorder] resolved blockRef', {
      blockIdentity: getPromptBlockIdentity(block),
      blockRefIdentity: getPromptRefIdentity(blockRef ?? block),
      blockRefIncluded: blockRef?.included,
      blockRefPosition: blockRef?.position,
      blockRefOrigin: blockRef?.origin,
    });
    const currentRefIdentity = getPromptRefIdentity(blockRef ?? block);
    const currentIndex = resolvedIncludedPromptRefs.findIndex((ref: any) => getPromptRefIdentity(ref) === currentRefIdentity);
    const targetIndex = currentIndex + direction;
    console.log('[prompt-reorder] index resolution', {
      currentRefIdentity,
      currentIndex,
      targetIndex,
      includedCount: resolvedIncludedPromptRefs.length,
    });
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= resolvedIncludedPromptRefs.length) {
      console.log('[prompt-reorder] guard triggered', {
        reason: 'index out of bounds or ref not currently included',
        currentIndex,
        targetIndex,
        includedCount: resolvedIncludedPromptRefs.length,
      });
      return;
    }

    const reorderedIncludedPromptRefs = resolvedIncludedPromptRefs.slice();
    const [movedRef] = reorderedIncludedPromptRefs.splice(currentIndex, 1);
    reorderedIncludedPromptRefs.splice(targetIndex, 0, movedRef);

    const batchPayload = reorderedIncludedPromptRefs.map((ref: any, index: number) => ({
      blockId: getPromptRefIdentity(ref),
      included: true,
      position: index + 1,
    }));
    console.log('[prompt-reorder] batch payload before updatePromptRefsBatch', {
      batchPayload,
      reorderedIncludedRefIdentities: reorderedIncludedPromptRefs.map((ref: any) => getPromptRefIdentity(ref)),
    });

    try {
      const updateResponse = await updatePromptRefsBatch(
        username,
        agent.id,
        batchPayload
      );
      console.log('[prompt-reorder] updatePromptRefsBatch success', {
        agentId: agent.id,
        refs: Array.isArray(updateResponse?.refs)
          ? updateResponse.refs.map((ref: any) => ({
              blockId: getPromptRefIdentity(ref),
              position: ref?.position,
              included: ref?.included,
            }))
          : [],
      });
    } catch (e: any) {
      console.log('[prompt-reorder] updatePromptRefsBatch error', { agentId: agent.id, direction, currentIndex, targetIndex, message: e?.message });
      setCanonicalPromptError(e?.message || 'Failed to reorder prompt refs');
      return;
    }

    try {
      await reloadCanonicalPrompt(agent.id);
      console.log('[prompt-reorder] reloadCanonicalPrompt success', { agentId: agent.id });
    } catch (e: any) {
      console.log('[prompt-reorder] reloadCanonicalPrompt error', { agentId: agent.id, message: e?.message });
      setCanonicalPromptError(e?.message || 'Failed to reorder prompt refs');
    }
  };

  const handleStartEditLocalBlock = (block: any) => {
    setEditingLocalBlockId(String(block?.id || ''));
    setEditingLocalBlockContent(block?.content ?? '');
    setNewBlockError('');
  };

  const handleSaveLocalBlockEdit = async () => {
    if (!agent?.id || !editingLocalBlockId || editingLocalBlockSaving || !editingLocalBlockContent.trim()) return;
    setEditingLocalBlockSaving(true);
    setNewBlockError('');
    try {
      await createPromptBlockVersion(username, agent.id, editingLocalBlockId, {
        content: editingLocalBlockContent,
        createdBy: agent.id,
      });
      await reloadCanonicalPrompt(agent.id);
      setEditingLocalBlockId('');
      setEditingLocalBlockContent('');
    } catch (e: any) {
      setNewBlockError(e?.message || 'Failed to save local prompt block edit');
    } finally {
      setEditingLocalBlockSaving(false);
    }
  };

  const handleCreateLocalPromptBlock = async () => {
    if (!agent?.id || newBlockSaving) return;
    setNewBlockSaving(true);
    setNewBlockError('');
    try {
      await createPromptBlock(username, agent.id, {
        title: newBlockTitle.trim(),
        blockKey: newBlockKey.trim(),
        content: newBlockContent,
      });
      setNewBlockTitle('');
      setNewBlockKey('');
      setNewBlockContent('');
      await reloadCanonicalPrompt(agent.id);
    } catch (e: any) {
      setNewBlockError(e?.message || 'Failed to create prompt block');
    } finally {
      setNewBlockSaving(false);
    }
  };

  const handleDeleteLocalPromptBlock = async (block: any) => {
    if (!agent?.id) return;
    const blockId = String(block?.id || '').trim();
    if (!blockId) return;
    const confirmed = window.confirm('Delete this local block? This cannot be undone.');
    if (!confirmed) return;
    setNewBlockError('');
    try {
      await deletePromptBlock(username, agent.id, blockId);
      if (editingLocalBlockId === blockId) {
        setEditingLocalBlockId('');
        setEditingLocalBlockContent('');
      }
      await reloadCanonicalPrompt(agent.id);
    } catch (e: any) {
      setNewBlockError(e?.message || 'Failed to delete local prompt block');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = agent?.id || generateId();
    const persistedSystemPrompt = agent?.id ? (agent?.systemPrompt ?? systemPrompt) : systemPrompt;
    const payload: Agent = {
      id, name, model, systemPrompt: persistedSystemPrompt, color,
      summary: agent?.summary || '',
      history: agent?.history || [],
      sessions: agent?.sessions || [],
      activeSessionId: agent?.activeSessionId || '',
      role,
      executionMode,
      tags: normalizeTags(tagsInput),
      isMaster: role === 'master',
      allowedTools,
      reasoning,
      timeoutSeconds: Math.max(10, timeoutSeconds),
      maxRetries: Math.max(0, maxRetries),
    };
    await onSave(payload);
  };

  const inputCls = "w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-nebula-500 bg-white dark:bg-dark-800 border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 transition-colors";
  const labelCls = "block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5";

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'tools',   label: `Tools${allowedTools.length > 0 ? ` (${allowedTools.length})` : ' (all)'}` },
    { id: 'limits',  label: 'Limits' },
  ];

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="bg-white dark:bg-dark-900 rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 dark:border-slate-800 flex flex-col items-center gap-3 p-8">
          <svg className="animate-spin h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">Loading agent data...</span>
          {error ? <p className="text-xs text-red-500 text-center">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-dark-900 rounded-2xl shadow-2xl w-[70vw] max-w-[1400px] min-w-[960px] border border-gray-100 dark:border-slate-800 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm`} style={{ background: color }}>
              {name ? name.trim()[0]?.toUpperCase() ?? '?' : '?'}
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white leading-tight">
                {agent ? 'Edit Agent' : 'New Agent'}
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                {agent ? 'Edit agent settings; for existing agents, the canonical prompt is sourced from the composition blocks and refs.' : 'Configure your new agent'}
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 flex gap-1 border-b border-gray-100 dark:border-slate-800 shrink-0">
          {tabs.map(t => (
            <button
              key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors ${
                tab === t.id
                  ? 'text-nebula-600 dark:text-nebula-400 border-b-2 border-nebula-500 -mb-px bg-white dark:bg-dark-900'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6">

            {/* Tab: General */}
            {tab === 'general' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      type="text" required value={name}
                      onChange={e => setName(e.target.value)}
                      className={inputCls} placeholder="e.g. Senior Developer"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Model</label>
                    <select value={model} onChange={e => setModel(e.target.value)} className={inputCls}>
                      {safeModels.length === 0 && <option value="">No models configured</option>}
                      {safeModels.map(m => (
                        <option key={m.id} value={m.modelId}>{m.name} [{m.provider.toUpperCase()}]</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Role</label>
                    <select value={role} onChange={e => setRole(e.target.value as Agent['role'])} className={inputCls}>
                      <option value="master">master</option>
                      <option value="worker">worker</option>
                      <option value="infra">infra</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Execution Mode</label>
                    <select value={executionMode} onChange={e => setExecutionMode(e.target.value as Agent['executionMode'])} className={inputCls}>
                      <option value="strict">strict</option>
                      <option value="flex">flex</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Tags</label>
                  <input
                    type="text"
                    value={tagsInput}
                    onChange={e => setTagsInput(e.target.value)}
                    className={inputCls}
                    placeholder="tag1, tag2, tag3"
                  />
                </div>

                <div>
                  <label className={labelCls}>Master Status</label>
                  <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${role === 'master' ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    <span className="font-medium">{role === 'master' ? 'Master agent' : 'Not master'}</span>
                  </div>
                </div>

                <div>
                  <label className={labelCls}>System Prompt</label>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">
                    {canEditSystemPrompt
                      ? 'This edits the agent form field. For existing agents, Save Changes updates agent metadata only; canonical prompt publishing uses the composition blocks and refs.'
                      : 'This agent uses the persisted canonical prompt sourced from the composition blocks and refs.'}
                  </p>
                  <textarea
                    required value={systemPrompt}
                    onChange={e => { if (canEditSystemPrompt) setSystemPrompt(e.target.value); }}
                    readOnly={!canEditSystemPrompt}
                    rows={8}
                    className={`${inputCls} resize-none font-mono text-xs leading-relaxed ${!canEditSystemPrompt ? 'bg-gray-50 dark:bg-slate-800/70 cursor-not-allowed' : ''}`}
                    placeholder="Define the agent's persona, role, and behavior..."
                  />
                </div>

                {agent?.id && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 space-y-4">
                    <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
                      <div className="rounded-xl bg-white dark:bg-dark-900 border border-slate-200 dark:border-slate-700 p-3">
                        <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Prompt blocks</div>
                        <div className="space-y-1">
                          <div>Total: {promptBlocks.length}</div>
                          <div>Active source: {compositionPreview?.source ?? 'composition'}</div>
                        </div>
                      </div>
                      <div className="rounded-xl bg-white dark:bg-dark-900 border border-slate-200 dark:border-slate-700 p-3 space-y-3">
                        <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Create local block</div>
                        <div className="grid grid-cols-1 gap-3">
                          <div>
                            <label className={labelCls}>Title</label>
                            <input type="text" value={newBlockTitle} onChange={e => setNewBlockTitle(e.target.value)} className={inputCls} placeholder="Block title" />
                          </div>
                          <div>
                            <label className={labelCls}>Block Key</label>
                            <input type="text" value={newBlockKey} onChange={e => setNewBlockKey(e.target.value)} className={inputCls} placeholder="block-key" />
                          </div>
                          <div>
                            <label className={labelCls}>Content</label>
                            <textarea value={newBlockContent} onChange={e => setNewBlockContent(e.target.value)} rows={5} className={`${inputCls} resize-y font-mono text-xs`} placeholder="Block content" />
                          </div>
                        </div>
                        {newBlockError ? <p className="text-xs text-red-500">{newBlockError}</p> : null}
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={handleCreateLocalPromptBlock} disabled={newBlockSaving || !newBlockTitle.trim() || !newBlockKey.trim()} className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${newBlockSaving || !newBlockTitle.trim() || !newBlockKey.trim() ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400 cursor-not-allowed' : 'bg-nebula-600 text-white hover:bg-nebula-700'}`}>
                            {newBlockSaving ? 'Creating…' : 'Create block'}
                          </button>
                        </div>
                      </div>
                      <div className="rounded-xl bg-white dark:bg-dark-900 border border-slate-200 dark:border-slate-700 p-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Block list</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            Included: {resolvedIncludedPromptRefs.length}/{promptBlocks.length}
                          </div>
                        </div>
                        {promptBlocks.length > 0 ? (
                          <ul className="space-y-2">
                            {orderedPromptBlocks.map((block: any, index: number) => {
                              const blockRef = getPromptBlockRef(block);
                              const hasResolvedRef = Boolean(blockRef);
                              const currentOrder = getPromptBlockOrder(block);
                              const included = hasResolvedRef ? blockRef?.included !== false : false;
                              const inherited = isInheritedPromptBlock(block);
                              const originLabel = inherited ? 'Global' : 'Local';
                              return (
                                <li key={getPromptBlockIdentity(block) || `${index}`} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <div className="font-medium text-slate-900 dark:text-white">
                                        {block?.title ?? block?.blockKey ?? block?.id ?? `Block ${index + 1}`}
                                      </div>
                                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                                        <span>ID: {block?.id ?? '—'}</span>
                                        <span>Key: {block?.blockKey ?? '—'}</span>
                                        <span>Type: {block?.blockType ?? block?.type ?? '—'}</span>
                                        <span>Origin: {originLabel}</span>
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                                        {included ? `${inherited ? 'Inherited global active' : 'Included in draft'} · Order ${currentOrder ?? '—'} of ${resolvedIncludedPromptRefs.length}` : inherited ? 'Inherited global disabled locally' : 'Not included in draft'}
                                      </div>
                                    </div>
                                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${included ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                                      {included ? (inherited ? 'Inherited' : 'In draft') : (inherited ? 'Disabled locally' : 'Excluded')}
                                    </span>
                                  </div>
                                  <div className="mt-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/40 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap break-words">
                                    {getPromptBlockPreview(block)}
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleTogglePromptRef(block, !included)}
                                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${included ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300' : 'bg-nebula-50 text-nebula-700 hover:bg-nebula-100 dark:bg-nebula-900/20 dark:text-nebula-300'}`}
                                    >
                                      {included ? (inherited ? 'Disable for this agent' : 'Remove from draft') : (inherited ? 'Re-enable for this agent' : 'Include in draft')}
                                    </button>
                                    {!inherited ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleStartEditLocalBlock(block)}
                                          className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/20 dark:text-indigo-300"
                                        >
                                          Edit local block
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteLocalPromptBlock(block)}
                                          className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300"
                                        >
                                          Delete local block
                                        </button>
                                      </>
                                    ) : null}
                                    {included ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            console.log('[prompt-reorder] move button clicked', {
                                              direction: -1,
                                              blockIdentity: getPromptBlockIdentity(block),
                                              currentOrder,
                                              included,
                                              disabledBasis: 'currentOrder === 1',
                                            });
                                            handleMovePromptRef(block, -1);
                                          }}
                                          disabled={currentOrder === 1}
                                          className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                                        >
                                          Move up
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            console.log('[prompt-reorder] move button clicked', {
                                              direction: 1,
                                              blockIdentity: getPromptBlockIdentity(block),
                                              currentOrder,
                                              included,
                                              disabledBasis: 'currentOrder === resolvedIncludedPromptRefs.length',
                                            });
                                            handleMovePromptRef(block, 1);
                                          }}
                                          disabled={currentOrder === resolvedIncludedPromptRefs.length}
                                          className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                                        >
                                          Move down
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                  {!inherited && editingLocalBlockId === String(block?.id || '') ? (
                                    <div className="mt-3 rounded-md border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-900/10 p-3 space-y-2">
                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">Edit local block content</div>
                                      <textarea
                                        value={editingLocalBlockContent}
                                        onChange={e => setEditingLocalBlockContent(e.target.value)}
                                        rows={6}
                                        className={`${inputCls} resize-y font-mono text-xs`}
                                      />
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={handleSaveLocalBlockEdit}
                                          disabled={editingLocalBlockSaving || !editingLocalBlockContent.trim()}
                                          className={`rounded-lg px-3 py-2 text-[11px] font-semibold ${editingLocalBlockSaving || !editingLocalBlockContent.trim() ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                                        >
                                          {editingLocalBlockSaving ? 'Saving…' : 'Save local edit'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => { setEditingLocalBlockId(''); setEditingLocalBlockContent(''); }}
                                          className="rounded-lg px-3 py-2 text-[11px] font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-700"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <div className="text-slate-500 dark:text-slate-400">No prompt blocks found.</div>
                        )}
                      </div>
                      <div className="rounded-xl bg-white dark:bg-dark-900 border border-slate-200 dark:border-slate-700 p-3">
                        <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Composition preview</div>
                        <div className="space-y-1">
                          <div>Status: {compositionPreview?.status ?? 'loaded'}</div>
                          <div>Length: {String((compositionPreview?.preview ?? compositionPreview?.content ?? '').length)}</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Canonical Prompt</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Read-only canonical version. It reflects the published composition from blocks and refs.</p>
                      </div>
                      {canonicalPromptLoading && (
                        <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Loading
                        </span>
                      )}
                    </div>
                    {canonicalPromptError ? (
                      <p className="text-xs text-red-500">{canonicalPromptError}</p>
                    ) : null}
                    {canonicalPromptFeedback ? (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">{canonicalPromptFeedback}</p>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePublishCanonicalPrompt}
                        disabled={canonicalPromptLoading || canonicalPromptPublishing || canonicalPromptRollingBack}
                        className={`px-3 py-2 text-xs font-semibold rounded-lg transition-colors ${
                          canonicalPromptLoading || canonicalPromptPublishing
                            ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400 cursor-not-allowed'
                            : 'bg-nebula-600 text-white hover:bg-nebula-700'
                        }`}
                      >
                        {canonicalPromptPublishing ? 'Publishing…' : 'Publish canonical composition'}
                      </button>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-dark-900 p-3 space-y-3 text-xs text-slate-600 dark:text-slate-300">
                      <div className="space-y-1">
                        <div><span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Document ID:</span> {promptDocument?.id ?? '—'}</div>
                        <div><span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Updated:</span> {formatVersionDateTime(promptDocument?.updatedAt)}</div>
                        <div><span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Current version ID:</span> {promptCurrentVersion?.id ?? '—'}</div>
                        <div><span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Version:</span> {promptCurrentVersion?.version ?? '—'}</div>
                        <div><span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Created:</span> {formatVersionDateTime(promptCurrentVersion?.createdAt)}</div>
                      </div>
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Preview</div>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-dark-900 p-3">
                      <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-200 max-h-56 overflow-auto">{canonicalPromptPreview || promptCurrentVersion?.content || 'No preview available.'}</pre>
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/20 overflow-hidden">
                      <div className="flex flex-col">
                        <div className="border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-dark-900 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Latest versions</div>
                          <ul className="space-y-2 max-h-[28rem] overflow-auto pr-1">
                            {(promptVersions || []).slice(0, 5).map((version: any) => {
                              const isCurrent = promptCurrentVersion?.id === version.id;
                              const isSelected = String(selectedPromptVersionId) === String(version.id);
                              return (
                                <li key={version.id || `${version.version}-${version.createdAt}`}>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectPromptVersion(version.id)}
                                    className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors ${isSelected ? 'border-nebula-500 bg-nebula-50 dark:bg-nebula-900/20 dark:border-nebula-400' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-dark-900 hover:bg-slate-50 dark:hover:bg-slate-800'} text-slate-600 dark:text-slate-300`}
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="font-medium text-slate-800 dark:text-slate-100">
                                        Version {version.version ?? '—'}
                                        {isCurrent ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Current</span> : null}
                                      </div>
                                      {isSelected ? <span className="text-[10px] font-semibold uppercase tracking-wide text-nebula-700 dark:text-nebula-300">Selected</span> : null}
                                    </div>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                                      <span>ID: {version.id ?? '—'}</span>
                                      <span>Created: {formatVersionDateTime(version.createdAt)}</span>
                                    </div>
                                  </button>
                                </li>
                              );
                            })}
                            {!canonicalPromptLoading && !(promptVersions || []).length && (
                              <li className="text-xs text-slate-500 dark:text-slate-400">No versions found.</li>
                            )}
                          </ul>
                        </div>
                        <div className="bg-white dark:bg-dark-900 p-4">
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div>
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Version details</div>
                            </div>
                            {selectedPromptVersion && promptCurrentVersion?.id !== selectedPromptVersion.id ? (
                              <button
                                type="button"
                                onClick={() => handleRollbackCanonicalPrompt(selectedPromptVersion.id)}
                                disabled={canonicalPromptLoading || canonicalPromptPublishing || canonicalPromptRollingBack}
                                className={`rounded-md px-3 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors ${canonicalPromptLoading || canonicalPromptPublishing || canonicalPromptRollingBack ? 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400 cursor-not-allowed' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
                              >
                                {canonicalPromptRollingBack ? 'Rolling back…' : 'Rollback to this version'}
                              </button>
                            ) : null}
                          </div>
                          {selectedPromptVersion ? (
                            <div className="space-y-4">
                              <div className="grid grid-cols-1 text-xs text-slate-600 dark:text-slate-300">
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3">
                                  <div className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">Selected version</div>
                                  <div className="space-y-1">
                                    <div>ID: {selectedPromptVersion.id ?? '—'}</div>
                                    <div>Version: {selectedPromptVersion.version ?? '—'}</div>
                                    <div>Created: {formatVersionDateTime(selectedPromptVersion.createdAt)}</div>
                                    <div>Status: {promptCurrentVersion?.id === selectedPromptVersion.id ? 'Current published version' : 'Historical version'}</div>
                                  </div>
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">Prompt content</div>
                                <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-200 max-h-[26rem] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-3">{selectedPromptVersion.content || 'No content available for this version.'}</pre>
                              </div>
                            </div>
                          ) : (
                            <div className="h-full min-h-[18rem] rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 flex items-center justify-center text-center text-xs text-slate-500 dark:text-slate-400 px-6">Select a version from the list above to inspect its details.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className={labelCls}>Avatar Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {safeAgentColors.map((c: string) => (
                      <button
                        key={c} type="button" onClick={() => setColor(c)}
                        className={`w-7 h-7 rounded-full transition-all ${
                          color === c ? 'ring-2 ring-offset-2 ring-nebula-500 dark:ring-offset-dark-900 scale-110' : 'hover:scale-105'
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Tools */}
            {tab === 'tools' && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Select which tools this agent can use. Leave all enabled to grant full access.
                </p>
                <ToolsSelector allowedTools={allowedTools} onChange={setAllowedTools} />
              </div>
            )}

            {/* Tab: Limits */}
            {tab === 'limits' && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Task Timeout (seconds)</label>
                    <div className="relative">
                      <input
                        type="number" min={10} max={600} value={timeoutSeconds}
                        onChange={e => setTimeoutSeconds(Number(e.target.value))}
                        className={inputCls}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">sec</span>
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Max time per delegated task. Min 10s, max 600s.</p>
                  </div>
                  <div>
                    <label className={labelCls}>Max Retries</label>
                    <input
                      type="number" min={0} max={5} value={maxRetries}
                      onChange={e => setMaxRetries(Number(e.target.value))}
                      className={inputCls}
                    />
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Retry attempts on task failure before escalating.</p>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Token limits</span> are managed per model in Settings —
                  context window minus reserved overhead for tools (default 7,000 tokens).
                </div>

                <div>
                  <label className={labelCls}>Reasoning <span className="normal-case font-normal text-gray-400">(OpenRouter only)</span></label>
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      type="button"
                      onClick={() => setReasoning(!reasoning)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                        reasoning ? 'bg-nebula-600' : 'bg-gray-300 dark:bg-slate-600'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        reasoning ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {reasoning ? 'Enabled — model will reason before responding' : 'Disabled — faster, better for structured output'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1.5">
                    When disabled, sends <code className="font-mono">reasoning: &#123;effort: "none"&#125;</code> to OpenRouter. Keep OFF for agents that return JSON.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 flex items-center gap-2 shrink-0 bg-gray-50 dark:bg-dark-950 rounded-b-2xl">
            {agent && onDelete && (
              <button
                type="button"
                onClick={() => { if (canDelete && confirm('Delete this agent?')) onDelete(agent.id); }}
                disabled={!canDelete}
                className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                  canDelete
                    ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                    : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                }`}
              >
                Delete
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit"
              className="px-5 py-2 text-sm font-medium text-white bg-nebula-600 hover:bg-nebula-700 rounded-lg shadow-sm transition-colors">
              {agent ? 'Save Changes' : 'Create Agent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AgentManager;