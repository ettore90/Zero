import React from 'react';
import PayloadEditorModal from './PayloadEditorModal';
import type { ModelConfig, ApiKey, MemoryConfig, SummaryConfig, ColorTheme, Agent } from '../types';
import { useSettingsForm } from '../hooks/useSettingsForm';
import * as localApiService from '../services/localApiService';

const {
  fetchGlobalPromptBlocks,
  createGlobalPromptBlock,
  fetchGlobalPromptBlockVersions,
  publishGlobalPromptComposition,
  createGlobalPromptBlockVersion,
  deleteGlobalPromptBlock,
} = localApiService as any;

interface SettingsModalProps {
  username: string;
  users?: Array<{ id: string; username: string; displayName?: string; role?: string; isActive?: boolean }>;
  onCreateUser?: (payload: { username: string; displayName?: string }) => Promise<void>;
  onSwitchUser?: (username: string) => Promise<void> | void;
  onDeleteUser?: (userId: string) => Promise<void>;
  currentHost: string;
  models: ModelConfig[];
  guidelines: string;

  usageHistory: any[];
  colorTheme: string;
  apiKeys: ApiKey[];
  memoryConfig: MemoryConfig;
  summaryConfig: SummaryConfig;
  agents: Agent[];
  timezone?: string;
  displayName?: string;
  isLoading?: boolean;
  error?: string;
  onOpen?: () => void;
  onSaveHost: (host: string) => void;
  onSaveModels: (models: ModelConfig[]) => void;
  onSaveGuidelines: (guidelines: string) => void;

  onSaveColorTheme: (theme: ColorTheme) => void;
  onSaveApiKeys: (keys: ApiKey[]) => void;
  onSaveMemoryConfig: (config: MemoryConfig) => void;
  onSaveSummaryConfig: (config: SummaryConfig) => void;
  onSaveTimezone: (tz: string) => void;
  onSaveDisplayName: (name: string) => void;
  onClose: () => void;
}

const IC = 'w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs dark:text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors';
const LC = 'text-[10px] uppercase font-bold text-slate-400 mb-1 block';
const PLACEHOLDER = 'Not implemented yet';

const SettingsModal: React.FC<SettingsModalProps> = ({
  username, users: _users = [], onCreateUser: _onCreateUser, onSwitchUser: _onSwitchUser, onDeleteUser: _onDeleteUser, currentHost, models, guidelines, usageHistory: _usageHistory,
  colorTheme: _colorTheme, apiKeys, memoryConfig, summaryConfig, agents: _agents, timezone, displayName, isLoading: externalIsLoading = false, error = '', onOpen,
  onSaveHost, onSaveModels, onSaveGuidelines,
  onSaveColorTheme: _onSaveColorTheme, onSaveApiKeys, onSaveMemoryConfig, onSaveSummaryConfig, onSaveTimezone, onSaveDisplayName, onClose
}) => {
  const [globalBlocks, setGlobalBlocks] = React.useState<any[]>([]);
  const [globalLoading, setGlobalLoading] = React.useState(false);
  const [globalError, setGlobalError] = React.useState('');
  const [newGlobalBlockName, setNewGlobalBlockName] = React.useState('');
  const [newGlobalBlockContent, setNewGlobalBlockContent] = React.useState('');
  const [newGlobalBlockPosition, setNewGlobalBlockPosition] = React.useState('');
  const [newGlobalBlockRoles, setNewGlobalBlockRoles] = React.useState<string[]>(['worker']);
  const [blockVersionsById, setBlockVersionsById] = React.useState<Record<string, any[]>>({});
  const [blockRefsById, setBlockRefsById] = React.useState<Record<string, any>>({});
  const [expandedBlockIds, setExpandedBlockIds] = React.useState<Record<string, boolean>>({});
  const [blockDrafts, setBlockDrafts] = React.useState<Record<string, { content: string; position: string; role: string; agentTypes: string[] }>>({});
  const [savingBlockIds, setSavingBlockIds] = React.useState<Record<string, boolean>>({});
  const [usersDraft, setUsersDraft] = React.useState({ username: '', displayName: '' });
  const [usersBusyId, setUsersBusyId] = React.useState('');
  const [usersError, setUsersError] = React.useState('');
  const [creatingUser, setCreatingUser] = React.useState(false);
  const [editingUserId, setEditingUserId] = React.useState('');
  const [editingUserDraft, setEditingUserDraft] = React.useState<{ username: string; displayName: string; email: string; isActive: boolean; metadata: string }>({ username: '', displayName: '', email: '', isActive: true, metadata: '' });

  const agentTypeOptions = React.useMemo(() => ([
    { value: 'master', label: 'master' },
    { value: 'worker', label: 'worker' },
    { value: 'infra', label: 'infra' },
  ]), []);

  const summaryAgentOptions = React.useMemo(() => {
    const seen = new Set<string>();
    const options = (_agents || [])
      .map((agent: any) => {
        const value = String(agent?.id ?? agent?.agentId ?? agent?.value ?? '').trim();
        const label = String(agent?.name ?? agent?.displayName ?? agent?.label ?? value).trim();
        return value ? { value, label: label || value } : null;
      })
      .filter((opt): opt is { value: string; label: string } => {
        if (!opt || seen.has(opt.value)) return false;
        seen.add(opt.value);
        return true;
      });
    return options;
  }, [_agents]);

  const normalizeAgentTypes = React.useCallback((value: any) => {
    const arr = Array.isArray(value) ? value : [];
    return arr.map(v => String(v ?? '').trim().toLowerCase()).filter(v => ['master', 'worker', 'infra'].includes(v));
  }, []);

  const parseBlockRole = React.useCallback((block: any) => {
    const raw = block?.role ?? block?.metadata?.role ?? block?.metadata?.agentRole ?? block?.agentRole ?? '';
    return normalizeAgentTypes([raw])[0] || '';
  }, [normalizeAgentTypes]);

  const getBlockPosition = React.useCallback((block: any) => String(block?.position ?? block?.metadata?.position ?? block?.forcedPosition ?? ''), []);

  const parseBlockAgentTypes = React.useCallback((block: any) => {
    const parsed = normalizeAgentTypes(block?.agentTypes ?? block?.metadata?.agentTypes);
    if (parsed.length > 0) return Array.from(new Set(parsed));
    const role = parseBlockRole(block);
    return role ? [role] : [];
  }, [normalizeAgentTypes, parseBlockRole]);

  const sanitizeBlockPayload = React.useCallback((payload: any, fallbackBlock?: any) => {
    const fallbackRole = parseBlockRole(fallbackBlock);
    const fallbackAgentTypes = parseBlockAgentTypes(fallbackBlock);
    const agentTypes = normalizeAgentTypes(payload?.agentTypes);
    const payloadRole = normalizeAgentTypes([payload?.role])[0] || '';
    const resolvedAgentTypes = agentTypes.length > 0
      ? Array.from(new Set(agentTypes))
      : (fallbackAgentTypes.length > 0 ? fallbackAgentTypes : []);
    const role = payloadRole || (resolvedAgentTypes.length === 1 ? resolvedAgentTypes[0] : fallbackRole || 'worker');
    const position = String(payload?.position ?? payload?.forcedPosition ?? fallbackBlock?.forcedPosition ?? getBlockPosition(fallbackBlock) ?? '');
    const { metadata, ...rest } = payload || {};
    return {
      ...rest,
      role,
      agentTypes: resolvedAgentTypes,
      position,
      forcedPosition: payload?.forcedPosition ?? fallbackBlock?.forcedPosition ?? position,
    };
  }, [getBlockPosition, normalizeAgentTypes, parseBlockAgentTypes, parseBlockRole]);

  const refreshGlobals = React.useCallback(async () => {
    const [blocks, refs] = await Promise.all([
      fetchGlobalPromptBlocks(username),
      localApiService.fetchGlobalPromptRefs(username),
    ]);
    const safeBlocks = Array.isArray(blocks) ? blocks : [];
    const safeRefs = Array.isArray(refs) ? refs : [];
    setGlobalBlocks(safeBlocks);
    setBlockRefsById(safeRefs.reduce((acc: Record<string, any>, ref: any) => {
      const refId = String(ref?.blockId ?? ref?.id ?? ref?.block?.id ?? '');
      if (refId) acc[refId] = ref;
      return acc;
    }, {}));
    setBlockDrafts(prev => {
      const next = { ...prev };
      safeBlocks.forEach((block: any) => {
        const blockId = String(block?.id || '');
        if (!blockId || next[blockId]) return;
        next[blockId] = {
          content: String(block?.content ?? block?.text ?? ''),
          position: getBlockPosition(block),
          role: parseBlockRole(block),
          agentTypes: parseBlockAgentTypes(block),
        };
      });
      return next;
    });
    await Promise.all(safeBlocks.map(async (block: any) => {
      const blockId = String(block?.id || '');
      if (!blockId || blockVersionsById[blockId]) return;
      const versions = await fetchGlobalPromptBlockVersions(username, blockId);
      setBlockVersionsById(prev => ({ ...prev, [blockId]: Array.isArray(versions) ? versions : [] }));
    }));
  }, [blockVersionsById, getBlockPosition, parseBlockAgentTypes, parseBlockRole, username]);

  React.useEffect(() => {
    if (!onOpen) return;
    const cleanup = onOpen();
    return cleanup;
  }, [onOpen]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      setGlobalLoading(true);
      setGlobalError('');
      try {
        if (!alive) return;
        await refreshGlobals();
      } catch (e: any) {
        if (alive) setGlobalError(e?.message || 'Failed to load global blocks.');
      } finally {
        if (alive) setGlobalLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [refreshGlobals]);

  const {
    activeTab, setActiveTab,
    host, setHost: _setHost,
    localGuidelines, setLocalGuidelines: _setLocalGuidelines,
    localModels, setLocalModels: _setLocalModels,
    localApiKeys, setLocalApiKeys: _setLocalApiKeys,
    localMemoryConfig, setLocalMemoryConfig: _setLocalMemoryConfig,
    localSummaryConfig, setLocalSummaryConfig: _setLocalSummaryConfig,
    localTimezone, setLocalTimezone: _setLocalTimezone,
    localDisplayName, setLocalDisplayName: _setLocalDisplayName,
    editingPayloadModelId, setEditingPayloadModelId,
    isLoading,
    revealedKeys: _revealedKeys,
    handleRateLimitChange: _handleRateLimitChange,
    updateModelField,
    addApiKey: _addApiKey,
    removeApiKey: _removeApiKey,
    toggleReveal: _toggleReveal,
  } = useSettingsForm({ username, currentHost, models, guidelines, apiKeys, memoryConfig, summaryConfig, timezone, displayName });

  const handleSaveAll = () => {
    onSaveHost(host);
    onSaveModels(localModels);
    onSaveGuidelines(localGuidelines);
    onSaveApiKeys(localApiKeys);
    onSaveMemoryConfig(localMemoryConfig);
    onSaveSummaryConfig(localSummaryConfig);
    onSaveTimezone(localTimezone);
    onSaveDisplayName(localDisplayName);
    onClose();
  };

  const setDraft = (blockId: string, patch: Partial<{ content: string; position: string; role: string; agentTypes: string[] }>) => {
    setBlockDrafts(prev => ({ ...prev, [blockId]: { ...(prev[blockId] || { content: '', position: '', role: '', agentTypes: [] }), ...patch } }));
  };

  const reloadBlockVersions = async (blockId: string) => {
    const versions = await fetchGlobalPromptBlockVersions(username, blockId);
    setBlockVersionsById(prev => ({ ...prev, [blockId]: Array.isArray(versions) ? versions : [] }));
  };

  const saveBlock = async (block: any) => {
    const blockId = String(block?.id || '');
    if (!blockId) return;
    setSavingBlockIds(prev => ({ ...prev, [blockId]: true }));
    setGlobalError('');
    try {
      const draft = blockDrafts[blockId] || { content: String(block?.content ?? block?.text ?? ''), position: getBlockPosition(block), role: parseBlockRole(block), agentTypes: parseBlockAgentTypes(block) };
      if (typeof createGlobalPromptBlockVersion === 'function') {
        const selectedRoles = Array.from(new Set((draft.agentTypes && draft.agentTypes.length > 0 ? draft.agentTypes : (draft.role ? [draft.role] : [])).filter(Boolean)));
        await createGlobalPromptBlockVersion(username, blockId, sanitizeBlockPayload({
          ...draft,
          role: selectedRoles[0] ?? draft.role ?? '',
          agentTypes: selectedRoles,
          createdBy: username,
          position: draft.position,
        }, block));
      }
      await refreshGlobals();
      await reloadBlockVersions(blockId);
    } catch (e: any) {
      setGlobalError(e?.message || `${PLACEHOLDER}: save block`);
    } finally {
      setSavingBlockIds(prev => ({ ...prev, [blockId]: false }));
    }
  };

  const publishComposition = async (blockId?: string) => {
    const targetBlockId = String(blockId || '');
    if (!targetBlockId) return;
    setSavingBlockIds(prev => ({ ...prev, [targetBlockId]: true }));
    setGlobalError('');
    try {
      await publishGlobalPromptComposition(username);
      await refreshGlobals();
    } catch (e: any) {
      setGlobalError(e?.message || `${PLACEHOLDER}: publish`);
    } finally {
      setSavingBlockIds(prev => ({ ...prev, [targetBlockId]: false }));
    }
  };

  const resolveBlockIncluded = React.useCallback((block: any) => {
    const blockId = String(block?.id || '');
    const ref = blockId ? blockRefsById[blockId] : null;
    if (ref && Object.prototype.hasOwnProperty.call(ref, 'included')) return ref.included !== false;
    if (block && Object.prototype.hasOwnProperty.call(block, 'included')) return block.included !== false;
    if (block?.metadata && Object.prototype.hasOwnProperty.call(block.metadata, 'included')) return block.metadata.included !== false;
    return true;
  }, [blockRefsById]);

  const toggleGlobalBlockIncluded = async (block: any) => {
    const blockId = String(block?.id || '');
    if (!blockId) return;
    setSavingBlockIds(prev => ({ ...prev, [blockId]: true }));
    setGlobalError('');
    try {
      const currentIncluded = resolveBlockIncluded(block);
      await localApiService.updateGlobalPromptRefs(username, blockId, { included: !currentIncluded });
      await refreshGlobals();
    } catch (e: any) {
      setGlobalError(e?.message || `${PLACEHOLDER}: toggle active`);
    } finally {
      setSavingBlockIds(prev => ({ ...prev, [blockId]: false }));
    }
  };

  const startEditUser = (user: any) => {
    setUsersError('');
    setEditingUserId(String(user?.id || ''));
    setEditingUserDraft({
      username: String(user?.username ?? ''),
      displayName: String(user?.displayName ?? ''),
      email: String(user?.email ?? ''),
      isActive: user?.isActive !== false,
      metadata: typeof user?.metadata === 'string' ? user.metadata : JSON.stringify(user?.metadata ?? {}, null, 2),
    });
  };

  const cancelEditUser = () => {
    setEditingUserId('');
    setEditingUserDraft({ username: '', displayName: '', email: '', isActive: true, metadata: '' });
  };

  const saveEditUser = async (user: any) => {
    const userId = String(user?.id || editingUserId || '');
    if (!userId) return;
    setUsersError('');
    setUsersBusyId(userId);
    try {
      const metadata = editingUserDraft.metadata.trim()
        ? (() => { try { return JSON.parse(editingUserDraft.metadata); } catch { return editingUserDraft.metadata; } })()
        : undefined;
      await (localApiService as any).updateUserOnServer(userId, {
        username: editingUserDraft.username.trim(),
        displayName: editingUserDraft.displayName.trim() || undefined,
        email: editingUserDraft.email.trim() || undefined,
        isActive: editingUserDraft.isActive,
        metadata,
      });
      cancelEditUser();
    } catch (e: any) {
      setUsersError(e?.message || 'Failed to save user.');
    } finally {
      setUsersBusyId('');
    }
  };

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'models', label: 'Models' },
    { id: 'users', label: 'Users' },
    { id: 'memory', label: 'Memory' },
    { id: 'env', label: 'Secrets' },
    { id: 'dispatcher', label: 'Dispatcher' },
    { id: 'globals', label: 'Globals' },
  ];

  if (externalIsLoading || isLoading) return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 flex flex-col items-center gap-3 border border-slate-200 dark:border-slate-800">
        <svg className="animate-spin h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
        </svg>
        <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">Loading settings...</span>
        {error ? <p className="text-xs text-red-500 text-center">{error}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950 shrink-0">
          <h2 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-widest flex items-center gap-2">
            <svg className="h-4 w-4 text-indigo-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.532 1.532 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.532 1.532 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            Settings
          </h2>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors">Cancel</button>
            <button onClick={handleSaveAll} className="px-4 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-bold transition-colors shadow-sm">Save Changes</button>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-44 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 p-2 space-y-0.5 overflow-y-auto shrink-0">
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === tab.id ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}>{tab.label}</button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-slate-900">
            {activeTab !== 'globals' && (
              <div className="space-y-6 max-w-4xl">
                {activeTab === 'general' && (
                  <div className="space-y-6 max-w-2xl">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Host URL</label>
                      <input type="text" value={host} onChange={(e) => _setHost(e.target.value)} className="w-full border dark:border-slate-700 rounded-lg px-4 py-2 bg-slate-50 dark:bg-black/20 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                      <p className="text-xs text-slate-500 mt-1">Default entry point for API communications.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Color Theme</label>
                      <div className="flex flex-wrap gap-3">
                        {(['amber', 'indigo', 'blue', 'green', 'purple', 'orange'] as const).map((c) => (
                          <button key={c} onClick={() => _onSaveColorTheme(c as ColorTheme)} className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${_colorTheme === c ? 'border-slate-600 dark:border-white ring-2 ring-indigo-200' : 'border-transparent'}`} style={{ backgroundColor: c === 'amber' ? '#f59e0b' : c === 'indigo' ? '#6366f1' : c === 'blue' ? '#3b82f6' : c === 'green' ? '#22c55e' : c === 'purple' ? '#a855f7' : '#f97316' }} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Master Guidelines</label>
                      <textarea value={localGuidelines} onChange={(e) => _setLocalGuidelines(e.target.value)} rows={8} className="w-full border dark:border-slate-700 rounded-lg px-4 py-2 bg-slate-50 dark:bg-black/20 dark:text-white font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Timezone</label>
                      <input value={localTimezone} onChange={e => _setLocalTimezone(e.target.value)} className={IC} />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Display name</label>
                      <input value={localDisplayName} onChange={e => _setLocalDisplayName(e.target.value)} className={IC} />
                    </div>
                    <div className="space-y-3 rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-black/20">
                      <div>
                        <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest">Summary</h3>
                        <p className="text-xs text-slate-400 mt-1">Local summary controls used by the app.</p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="md:col-span-2">
                          <label className={LC}>Summary agent ID</label>
                          <select
                            value={localSummaryConfig.summaryAgentId || ''}
                            onChange={e => _setLocalSummaryConfig((prev: SummaryConfig) => ({ ...prev, summaryAgentId: e.target.value }))}
                            className={IC}
                          >
                            <option value="">Select an agent...</option>
                            {(() => {
                              const currentId = String(localSummaryConfig.summaryAgentId ?? '').trim();
                              const hasCurrentOption = currentId && summaryAgentOptions.some((agent) => agent.value === currentId);
                              const renderedOptions = hasCurrentOption
                                ? summaryAgentOptions
                                : currentId
                                  ? [...summaryAgentOptions, { value: currentId, label: `${currentId} (saved)` }]
                                  : summaryAgentOptions;

                              return renderedOptions.map((agent) => (
                                <option key={agent.value} value={agent.value}>{agent.label}</option>
                              ));
                            })()}
                          </select>
                        </div>
                        <div>
                          <label className={LC}>Token limit</label>
                          <input type="number" value={localSummaryConfig.tokenLimit ?? ''} onChange={e => _setLocalSummaryConfig((prev: SummaryConfig) => ({ ...prev, tokenLimit: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 }))} className={IC} />
                        </div>
                        <div>
                          <label className={LC}>Window size</label>
                          <input type="number" value={localSummaryConfig.windowSize ?? ''} onChange={e => _setLocalSummaryConfig((prev: SummaryConfig) => ({ ...prev, windowSize: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 }))} className={IC} />
                        </div>
                        <div>
                          <label className={LC}>Summary max chars</label>
                          <input type="number" value={localSummaryConfig.summaryMaxChars ?? ''} onChange={e => _setLocalSummaryConfig((prev: SummaryConfig) => ({ ...prev, summaryMaxChars: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 }))} className={IC} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === 'models' && (
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-bold uppercase text-slate-500">Model Registry</h3>
                      <button type="button" onClick={() => _setLocalModels([ ...localModels, { id: Date.now().toString(), name: 'New Model', provider: 'openai', modelId: '', intent: 'General' } ])} className="text-xs bg-indigo-100 text-indigo-600 px-3 py-1 rounded-lg font-bold hover:bg-indigo-200">+ Add Model</button>
                    </div>
                    {localModels.map((model: ModelConfig) => (
                      <div key={model.id} className="border dark:border-slate-800 rounded-xl p-4 bg-slate-50 dark:bg-black/20 space-y-4 relative group">
                        <button type="button" onClick={() => _setLocalModels(localModels.filter((m: ModelConfig) => m.id !== model.id))} className="absolute top-2 right-2 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">×</button>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Name</label>
                            <input value={model.name} onChange={(e) => updateModelField(model.id, 'name', e.target.value)} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs" />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Provider</label>
                            <select value={model.provider} onChange={(e) => updateModelField(model.id, 'provider', e.target.value)} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs">
                              <option value="ollama">Ollama</option>
                              <option value="openai">OpenAI</option>
                              <option value="groq">Groq</option>
                              <option value="gemini">Gemini</option>
                              <option value="openrouter">OpenRouter</option>
                              <option value="anthropic">Anthropic</option>
                              <option value="stepfun">StepFun</option>
                              <option value="sai">SAI (OpenAI)</option>
                              <option value="sai-vertex">SAI (Vertex AI)</option>
                              <option value="sai-nested">SAI (GPT-5 / Nested)</option>
                              <option value="azure-openai">Azure OpenAI</option>
                              <option value="azure-foundry">Azure Foundry</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Model ID</label>
                            <input value={model.modelId} onChange={(e) => updateModelField(model.id, 'modelId', e.target.value)} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs font-mono" />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">API Key</label>
                            <input type="password" value={model.apiKey || ''} onChange={(e) => updateModelField(model.id, 'apiKey', e.target.value)} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="md:col-span-2">
                            <label className="text-[10px] uppercase font-bold text-slate-400">Base URL</label>
                            <input value={model.baseUrl || ''} onChange={(e) => updateModelField(model.id, 'baseUrl', e.target.value)} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs font-mono" />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">API Version</label>
                            <input value={model.apiVersion || ''} onChange={(e) => updateModelField(model.id, 'apiVersion', e.target.value)} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs font-mono" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Temperature</label>
                            <input type="number" step="0.1" value={model.temperature ?? ''} onChange={(e) => updateModelField(model.id, 'temperature', e.target.value === '' ? undefined : parseFloat(e.target.value))} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs" />
                          </div>
                          <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400">Max Output Tokens</label>
                            <input type="number" value={model.maxTokens ?? ''} onChange={(e) => updateModelField(model.id, 'maxTokens', e.target.value === '' ? undefined : parseInt(e.target.value))} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs" />
                          </div>
                        </div>
                        <div className="border-t dark:border-slate-700/50 pt-3">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-[10px] uppercase font-bold text-slate-400">Context Window (tokens)</label>
                              <input type="number" value={model.contextWindow || ''} onChange={(e) => updateModelField(model.id, 'contextWindow', e.target.value ? parseInt(e.target.value) : undefined)} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs" />
                            </div>
                            <div>
                              <label className="text-[10px] uppercase font-bold text-slate-400">Reserved Overhead (tokens)</label>
                              <input type="number" value={model.reservedOverhead || ''} onChange={(e) => updateModelField(model.id, 'reservedOverhead', e.target.value ? parseInt(e.target.value) : undefined)} className="w-full bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-2 py-1 text-xs" />
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-4 items-center pt-2 border-t dark:border-slate-700/50 flex-wrap">
                          <div className="flex gap-2 items-center"><span className="text-[10px] font-bold text-slate-400">RPM:</span><input type="number" value={model.rateLimits?.rpm || 0} onChange={(e) => _handleRateLimitChange(model.id, 'rpm', e.target.value)} className="w-16 bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-1 py-0.5 text-xs" /></div>
                          <div className="flex gap-2 items-center"><span className="text-[10px] font-bold text-slate-400">TPM:</span><input type="number" value={model.rateLimits?.tpm || 0} onChange={(e) => _handleRateLimitChange(model.id, 'tpm', e.target.value)} className="w-16 bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-1 py-0.5 text-xs" /></div>
                          <div className="flex gap-2 items-center"><span className="text-[10px] font-bold text-slate-400">RPD:</span><input type="number" value={model.rateLimits?.rpd || 0} onChange={(e) => _handleRateLimitChange(model.id, 'rpd', e.target.value)} className="w-16 bg-white dark:bg-slate-900 border dark:border-slate-700 rounded px-1 py-0.5 text-xs" /></div>
                          <button type="button" onClick={() => setEditingPayloadModelId(model.id)} className={`text-xs px-3 py-1 rounded font-bold border transition-all ${ model.requestBuilder ? 'bg-purple-100 text-purple-600 border-purple-200' : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:border-indigo-400' }`}>{model.requestBuilder ? '✓ Custom Payload' : '{} Configure Payload'}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {activeTab === 'users' && (
                  <div className="space-y-4 max-w-4xl">
                    <div className="space-y-2">
                      <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest">Users</h3>
                      <p className="text-xs text-slate-400">Compact workspace user management.</p>
                    </div>
                    {usersError ? <div className="text-xs text-red-500">{usersError}</div> : null}
                    <div className="space-y-2">
                      {_users.length === 0 ? (
                        <div className="text-xs text-slate-400">No users available.</div>
                      ) : _users.map((user) => {
                        const isActiveUser = !!user?.isActive || user?.username === username;
                        const canSwitch = !!_onSwitchUser && !isActiveUser;
                        const canDelete = !!_onDeleteUser && !isActiveUser;
                        const isEditing = editingUserId === user.id;
                        return (
                          <div key={user.id} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 px-3 py-2 text-xs space-y-2">
                            {!isEditing ? (
                              <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                    <div className="font-mono text-slate-700 dark:text-slate-200 break-all truncate">{user.username}</div>
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${isActiveUser ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                                      {isActiveUser ? 'Active' : 'Inactive'}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.displayName || 'No display name'}{user.role ? ` · ${user.role}` : ''}</div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                                  <button type="button" disabled={usersBusyId === user.id} onClick={() => startEditUser(user)} className="text-[10px] px-2 py-1 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold disabled:opacity-60">Edit</button>
                                  {canSwitch ? <button type="button" disabled={usersBusyId === user.id} onClick={async () => { setUsersError(''); setUsersBusyId(user.id); try { await _onSwitchUser?.(user.username); } catch (e: any) { setUsersError(e?.message || 'Failed to switch user.'); } finally { setUsersBusyId(''); } }} className="text-[10px] px-2 py-1 rounded-md bg-indigo-600 text-white font-bold disabled:opacity-60">Switch</button> : null}
                                  {canDelete ? <button type="button" disabled={usersBusyId === user.id} onClick={async () => { setUsersError(''); setUsersBusyId(user.id); try { await _onDeleteUser?.(user.id); } catch (e: any) { setUsersError(e?.message || 'Failed to delete user.'); } finally { setUsersBusyId(''); } }} className="text-[10px] px-2 py-1 rounded-md bg-red-600 text-white font-bold disabled:opacity-60">Remove</button> : null}
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  <div>
                                    <label className={LC}>Username</label>
                                    <input value={editingUserDraft.username} onChange={e => setEditingUserDraft(prev => ({ ...prev, username: e.target.value }))} className={IC} />
                                  </div>
                                  <div>
                                    <label className={LC}>Display name</label>
                                    <input value={editingUserDraft.displayName} onChange={e => setEditingUserDraft(prev => ({ ...prev, displayName: e.target.value }))} className={IC} />
                                  </div>
                                  <div>
                                    <label className={LC}>Email</label>
                                    <input value={editingUserDraft.email} onChange={e => setEditingUserDraft(prev => ({ ...prev, email: e.target.value }))} className={IC} />
                                  </div>
                                  <div className="flex items-end">
                                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 w-full">
                                      <input type="checkbox" checked={editingUserDraft.isActive} onChange={e => setEditingUserDraft(prev => ({ ...prev, isActive: e.target.checked }))} />
                                      <span className="text-[10px] uppercase font-bold text-slate-400">Active</span>
                                    </label>
                                  </div>
                                </div>
                                <div>
                                  <label className={LC}>Metadata</label>
                                  <textarea value={editingUserDraft.metadata} onChange={e => setEditingUserDraft(prev => ({ ...prev, metadata: e.target.value }))} rows={3} className={`${IC} font-mono`} />
                                </div>
                                <div className="flex items-center gap-2 justify-end flex-wrap">
                                  <button type="button" onClick={cancelEditUser} className="text-[10px] px-2 py-1 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold">Cancel</button>
                                  <button type="button" disabled={usersBusyId === user.id} onClick={async () => { await saveEditUser(user); }} className="text-[10px] px-2 py-1 rounded-md bg-indigo-600 text-white font-bold disabled:opacity-60">Save</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {_onCreateUser ? (
                      <div className="space-y-2">
                        <h4 className="text-xs font-black uppercase text-slate-500 tracking-widest">Create user</h4>
                        <div className="flex flex-col md:flex-row gap-2 items-stretch">
                          <input value={usersDraft.username} onChange={e => setUsersDraft(prev => ({ ...prev, username: e.target.value }))} className={`${IC} md:max-w-[220px]`} placeholder="username" />
                          <input value={usersDraft.displayName} onChange={e => setUsersDraft(prev => ({ ...prev, displayName: e.target.value }))} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 text-xs dark:text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors" placeholder="display name" />
                          <div className="flex items-center gap-2 shrink-0">
                            <button type="button" onClick={() => setUsersDraft({ username: '', displayName: '' })} className="text-xs px-3 py-1.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold">Clear</button>
                            <button type="button" disabled={creatingUser} onClick={async () => { const nextUsername = usersDraft.username.trim(); if (!nextUsername) return; setUsersError(''); setCreatingUser(true); try { await _onCreateUser?.({ username: nextUsername, displayName: usersDraft.displayName.trim() || undefined }); setUsersDraft({ username: '', displayName: '' }); } catch (e: any) { setUsersError(e?.message || 'Failed to create user.'); } finally { setCreatingUser(false); } }} className="text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white font-bold disabled:opacity-60">Create</button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
                {activeTab === 'memory' && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-black/20">
                      <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest">Memory</h3>
                      <p className="text-xs text-slate-400 mt-1">Enable memory and configure the memory base URL.</p>
                    </div>
                    <div className="space-y-4 max-w-2xl">
                      <label className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={!!localMemoryConfig?.enabled}
                          onChange={e => _setLocalMemoryConfig((prev: MemoryConfig) => ({ ...prev, enabled: e.target.checked }))}
                        />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">Enabled</span>
                      </label>
                      <div>
                        <label className={LC}>Base URL</label>
                        <input
                          value={String(localMemoryConfig?.baseUrl ?? '')}
                          onChange={e => _setLocalMemoryConfig((prev: MemoryConfig) => ({ ...prev, baseUrl: e.target.value }))}
                          className={IC}
                          placeholder="https://..."
                        />
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === 'env' && (
                  <div className="space-y-4 max-w-3xl">
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-black/20">
                      <h3 className="text-xs font-black uppercase text-slate-500 tracking-widest">Secrets</h3>
                      <p className="text-xs text-slate-400 mt-1">Local API keys managed by the settings form.</p>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-black uppercase text-slate-500 tracking-widest">API keys</h4>
                        <p className="text-xs text-slate-400 mt-1">Add, remove, reveal, and save with the existing handlers.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => _addApiKey()}
                        className="text-xs bg-indigo-100 text-indigo-600 px-3 py-1 rounded-lg font-bold hover:bg-indigo-200"
                      >
                        + Add key
                      </button>
                    </div>

                    <div className="space-y-3">
                      {localApiKeys.length === 0 ? (
                        <div className="text-xs text-slate-400">No API keys configured.</div>
                      ) : localApiKeys.map((key: any, index: number) => {
                        const keyId = String(key?.id ?? index);
                        const revealed = _revealedKeys instanceof Set ? _revealedKeys.has(keyId) : false;
                        return (
                          <div key={keyId} className="border dark:border-slate-800 rounded-xl p-4 bg-white dark:bg-black/20 space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className={LC}>Name</label>
                                <input
                                  value={String(key?.name ?? '')}
                                  onChange={(e) => {
                                    const next = [...localApiKeys];
                                    next[index] = { ...(next[index] as any), name: e.target.value };
                                    _setLocalApiKeys(next as any);
                                  }}
                                  className={IC}
                                  placeholder="provider name"
                                />
                              </div>
                              <div>
                                <label className={LC}>Value</label>
                                <input
                                  type={revealed ? 'text' : 'password'}
                                  value={String(key?.value ?? key?.apiKey ?? '')}
                                  onChange={(e) => {
                                    const next = [...localApiKeys];
                                    next[index] = { ...(next[index] as any), value: e.target.value };
                                    _setLocalApiKeys(next as any);
                                  }}
                                  className={IC}
                                  placeholder="secret value"
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => _toggleReveal(keyId)}
                                className="text-[10px] px-2 py-1 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold"
                              >
                                {revealed ? 'Hide' : 'Reveal'}
                              </button>
                              <button
                                type="button"
                                onClick={() => _removeApiKey(keyId)}
                                className="text-[10px] px-2 py-1 rounded-md bg-red-600 text-white font-bold"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {activeTab === 'dispatcher' && (
                  <div className="space-y-6 max-w-2xl">
                    <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-4">
                      <h3 className="text-xs font-black uppercase text-amber-700 dark:text-amber-300 tracking-widest">Dispatcher</h3>
                      <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1">Intentionally disabled / not wired by choice.</p>
                    </div>
                    <div className="flex items-center gap-2 opacity-80">
                      <input type="checkbox" checked={false} disabled className="w-4 h-4 text-indigo-600 rounded" />
                      <span className="font-bold text-sm text-slate-700 dark:text-white">Enable System Dispatcher</span>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Dispatcher Model</label>
                      <select value="" disabled className="w-full border dark:border-slate-700 rounded-lg px-3 py-2 bg-slate-50 dark:bg-black/20 dark:text-white">
                        <option value="">Select routing model...</option>
                        {localModels.map((m: ModelConfig) => <option key={m.id} value={m.modelId}>{m.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">Routing Logic</label>
                      <textarea value="Dispatcher is intentionally disabled and not wired by choice." readOnly disabled rows={10} className="w-full border dark:border-slate-700 rounded-lg px-4 py-2 bg-slate-50 dark:bg-black/20 dark:text-white font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                  </div>
                )}
              </div>
            )}
            {activeTab === 'globals' && (
              <div className="space-y-5 max-w-4xl">
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-950/20 p-4">
                  <h3 className="text-xs font-black uppercase text-indigo-700 dark:text-indigo-300 tracking-widest">Global / Transversal Prompt Blocks</h3>
                  <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80 mt-1">Global block list with expandable per-block editing.</p>
                </div>
                {globalLoading ? <div className="text-xs text-slate-500">Loading global blocks...</div> : null}
                {globalError ? <div className="text-xs text-red-500">{globalError}</div> : null}

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-black/20 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-black uppercase text-slate-500 tracking-widest">Create</h4>
                      <p className="text-xs text-slate-400 mt-1">Create new global blocks.</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={LC}>Title</label>
                      <input value={newGlobalBlockName} onChange={e => setNewGlobalBlockName(e.target.value)} className={IC} />
                    </div>
                    <div>
                      <label className={LC}>Position</label>
                      <input value={newGlobalBlockPosition} onChange={e => setNewGlobalBlockPosition(e.target.value)} className={IC} />
                    </div>
                  </div>
                  <div>
                    <label className={LC}>Prompt</label>
                    <textarea value={newGlobalBlockContent} onChange={e => setNewGlobalBlockContent(e.target.value)} rows={8} className={`${IC} font-mono`} />
                  </div>
                  <div>
                    <label className={LC}>Agent types</label>
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 flex flex-wrap gap-3">
                      {agentTypeOptions.map(opt => {
                        const checked = newGlobalBlockRoles.includes(opt.value);
                        return (
                          <label key={opt.value} className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setNewGlobalBlockRoles(prev => checked ? prev.filter(role => role !== opt.value) : [...prev, opt.value])}
                            />
                            <span>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <button onClick={async () => {
                      if (!newGlobalBlockName.trim()) return;
                      setGlobalError('');
                      try {
                        const selectedRoles = Array.from(new Set(newGlobalBlockRoles.length > 0 ? newGlobalBlockRoles : ['worker']));
                        await createGlobalPromptBlock(username, sanitizeBlockPayload({
                          title: newGlobalBlockName.trim(),
                          blockKey: newGlobalBlockName.trim().toLowerCase().replace(/\s+/g, '-'),
                          content: newGlobalBlockContent,
                          position: newGlobalBlockPosition,
                          role: selectedRoles[0] ?? 'worker',
                          agentTypes: selectedRoles,
                          forcedPosition: newGlobalBlockPosition,
                          metadata: { source: 'settings-modal' },
                        }));
                        setNewGlobalBlockName('');
                        setNewGlobalBlockContent('');
                        setNewGlobalBlockPosition('');
                        setNewGlobalBlockRoles(['worker']);
                        await refreshGlobals();
                      } catch (e: any) {
                        setGlobalError(e?.message || 'Failed to create global block.');
                      }
                    }} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-700 transition-colors">+ Create Global Block</button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-black uppercase text-slate-500 tracking-widest">Global blocks</h4>
                    <p className="text-xs text-slate-400 mt-1">Expand a block to edit content, position, role, and versions.</p>
                  </div>
                  <div className="space-y-2">
                    {globalBlocks.length === 0 ? <div className="text-xs text-slate-400">No global blocks loaded.</div> : globalBlocks.map((block: any) => {
                      const blockId = String(block?.id || '');
                      const isExpanded = !!expandedBlockIds[blockId];
                      const draft = blockDrafts[blockId] || { content: String(block?.content ?? block?.text ?? ''), position: getBlockPosition(block), role: parseBlockRole(block), agentTypes: parseBlockAgentTypes(block) };
                      const versions = blockVersionsById[blockId] || [];
                      const isIncluded = resolveBlockIncluded(block);
                      return (
                        <div key={blockId} className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50 dark:bg-black/20 overflow-hidden">
                          <button type="button" onClick={async () => { setExpandedBlockIds(prev => ({ ...prev, [blockId]: !prev[blockId] })); if (!blockVersionsById[blockId]) await reloadBlockVersions(blockId); }} className="w-full text-left p-3 flex items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{block?.title || block?.blockKey || blockId || 'Global block'}</div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono">{String(block?.content ?? block?.text ?? '').slice(0, 120) || 'No content'}</div>
                            </div>
                            <span className="text-[10px] uppercase text-slate-400">{isExpanded ? 'Collapse' : 'Expand'}</span>
                          </button>
                          {isExpanded && (
                            <div className="border-t border-slate-200 dark:border-slate-800 p-4 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className={LC}>Title</label>
                                  <input value={block?.title || block?.blockKey || ''} readOnly className={IC} />
                                </div>
                                <div>
                                  <label className={LC}>Visible position</label>
                                  <input value={draft.position} onChange={e => setDraft(blockId, { position: e.target.value })} className={IC} />
                                </div>
                              </div>
                              <div>
                                <label className={LC}>Agent types</label>
                                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 flex flex-wrap gap-3">
                                  {agentTypeOptions.map(opt => {
                                    const checked = (draft.agentTypes || []).includes(opt.value);
                                    return (
                                      <label key={opt.value} className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            const next = checked ? (draft.agentTypes || []).filter(role => role !== opt.value) : [...(draft.agentTypes || []), opt.value];
                                            const deduped = Array.from(new Set(next));
                                            setDraft(blockId, { agentTypes: deduped, role: deduped[0] ?? 'worker' });
                                          }}
                                        />
                                        <span>{opt.label}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                              <div>
                                <label className={LC}>Text / content</label>
                                <textarea value={draft.content} onChange={e => setDraft(blockId, { content: e.target.value })} rows={7} className={`${IC} font-mono`} />
                              </div>
                              <div>
                                <div className="text-[10px] uppercase font-black text-slate-400 mb-2">Versions</div>
                                <div className="space-y-2 max-h-40 overflow-auto">
                                  {versions.length === 0 ? <div className="text-xs text-slate-400">No versions available.</div> : versions.map((v: any, index: number) => (
                                    <div key={v?.id || `${blockId}-${index}`} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 bg-white dark:bg-slate-900 text-[11px] text-slate-600 dark:text-slate-300">
                                      <div className="font-bold text-slate-700 dark:text-slate-200">{v?.id || `Version ${index + 1}`}</div>
                                      <div className="font-mono mt-1 whitespace-pre-wrap">{String(v?.content ?? v?.text ?? '').slice(0, 200) || '—'}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button onClick={() => saveBlock(block)} disabled={!!savingBlockIds[blockId]} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-60">Save</button>
                                <button type="button" onClick={() => publishComposition(blockId)} disabled={!!savingBlockIds[blockId]} title="Publish the global composition for this block" className="text-xs px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors disabled:opacity-60">{savingBlockIds[blockId] ? 'Publishing…' : 'Publish composition'}</button>
                                <button type="button" onClick={() => toggleGlobalBlockIncluded(block)} disabled={!!savingBlockIds[blockId]} title={isIncluded ? 'Disable this global block' : 'Enable this global block'} className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-colors ${isIncluded ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-emerald-600 text-white hover:bg-emerald-700'} disabled:opacity-60`}>
                                  {isIncluded ? 'Disable' : 'Enable'}
                                </button>
                                <button type="button" onClick={async () => {
                                  if (!blockId || !window.confirm('Delete this global block?')) return;
                                  setSavingBlockIds(prev => ({ ...prev, [blockId]: true }));
                                  setGlobalError('');
                                  try {
                                    await deleteGlobalPromptBlock(username, blockId);
                                    await refreshGlobals();
                                  } catch (e: any) {
                                    setGlobalError(e?.message || `${PLACEHOLDER}: delete`);
                                  } finally {
                                    setSavingBlockIds(prev => ({ ...prev, [blockId]: false }));
                                  }
                                }} disabled={!!savingBlockIds[blockId]} title="Delete this global block" className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 transition-colors disabled:opacity-60">{savingBlockIds[blockId] ? 'Deleting…' : 'Delete'}</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {editingPayloadModelId && (
        <PayloadEditorModal
          initialCode={localModels.find((m: ModelConfig) => m.id === editingPayloadModelId)?.requestBuilder || ''}
          modelName={localModels.find((m: ModelConfig) => m.id === editingPayloadModelId)?.name || 'Model'}
          onSave={(code: string) => { updateModelField(editingPayloadModelId, 'requestBuilder', code); setEditingPayloadModelId(null); }}
          onClose={() => setEditingPayloadModelId(null)}
        />
      )}
    </div>
  );
};

export default SettingsModal;
