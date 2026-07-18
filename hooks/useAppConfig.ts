import { useState, useEffect, useCallback, useRef } from 'react';
import { Agent, ScheduledMessage, ModelConfig, Workflow, ColorTheme, UsageRecord, LogEntry, ExternalTool, ApiKey, MemoryConfig, SummaryConfig } from '../types';
import { DEFAULT_AGENT, OLLAMA_DEFAULT_HOST, DEFAULT_GUIDELINES } from '../constants';
import { localGet, localPost, localPatch } from '../services/localApiService';
import { normalizeAgents, loadSessionHistories } from '../utils/agentNormalizer';
import { createOllamaModelConfig } from '../utils/modelLoader';

export const useAppConfig = (token: string | null, username: string, isOfflineMode: boolean) => {
    const [agents, setAgents] = useState<Agent[]>([DEFAULT_AGENT]);
    const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
    const [workflows, setWorkflows] = useState<Workflow[]>([]);
    const [modelConfigs, setModelConfigs] = useState<ModelConfig[]>([]);
    const [externalTools, setExternalTools] = useState<ExternalTool[]>([]);
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
    const [memoryConfig, setMemoryConfig] = useState<MemoryConfig>({ enabled: false, maxMemories: 100, maintenanceAgentId: 'memory-maintenance-agent' });
    const [summaryConfig, setSummaryConfig] = useState<SummaryConfig>({ summaryAgentId: 'summary-agent', tokenLimit: 8000, windowSize: 20, summaryMaxChars: 1600 });
    const [guidelines, setGuidelines] = useState<string>(DEFAULT_GUIDELINES);
    const [ollamaHost, setOllamaHost] = useState<string>(OLLAMA_DEFAULT_HOST);
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        if (typeof window === 'undefined' || !username) return 'light';
        try {
            const local = localStorage.getItem(`orchestrator_state_${username}`);
            if (!local) return 'light';
            const parsed = JSON.parse(local);
            return parsed?.theme === 'dark' ? 'dark' : 'light';
        } catch {
            return 'light';
        }
    });

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.classList.toggle('dark', theme === 'dark');
    }, [theme]);
    const [colorTheme, setColorTheme] = useState<ColorTheme>('amber');
    const [timezone, setTimezone] = useState<string>(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const [displayName, setDisplayName] = useState<string>('');
    const [usageHistory, setUsageHistory] = useState<UsageRecord[]>([]);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [refreshNonce, setRefreshNonce] = useState<number>(0);
    const initialLoadCompletedRef = useRef<boolean>(false);
    const refreshGenerationRef = useRef<number>(0);
    const latestRequestedGenerationRef = useRef<number>(0);
    const completedRefreshGenerationRef = useRef<number>(-1);
    const refreshResolversRef = useRef<Array<{ generation: number; resolve: () => void; reject: (error: Error) => void }>>([]);
    const rejectRefreshGeneration = useCallback((failedGeneration: number, error?: unknown) => {
        const pendingResolvers = refreshResolversRef.current;
        const failedResolvers = pendingResolvers.filter(({ generation }) => generation === failedGeneration);
        refreshResolversRef.current = pendingResolvers.filter(({ generation }) => generation !== failedGeneration);
        const refreshError = error instanceof Error ? error : new Error('Failed to refresh app config');
        failedResolvers.forEach(({ reject }) => reject(refreshError));
    }, []);

    const resolveCompletedRefreshes = useCallback((completedGeneration: number) => {
        completedRefreshGenerationRef.current = Math.max(completedRefreshGenerationRef.current, completedGeneration);
        const pendingResolvers = refreshResolversRef.current;
        const readyResolvers = pendingResolvers.filter(({ generation }) => generation <= completedRefreshGenerationRef.current);
        refreshResolversRef.current = pendingResolvers.filter(({ generation }) => generation > completedRefreshGenerationRef.current);
        readyResolvers.forEach(({ resolve }) => resolve());
    }, []);

    const resolveSupersededRefreshes = useCallback((latestGeneration: number) => {
        const pendingResolvers = refreshResolversRef.current;
        const supersededResolvers = pendingResolvers.filter(({ generation }) => generation < latestGeneration);
        refreshResolversRef.current = pendingResolvers.filter(({ generation }) => generation >= latestGeneration);
        supersededResolvers.forEach(({ resolve }) => resolve());
    }, []);

    // Refs para acesso síncrono em callbacks sem stale closure
    const agentsRef = useRef<Agent[]>(agents);
    const scheduledMessagesRef = useRef<ScheduledMessage[]>(scheduledMessages);
    const workflowsRef = useRef<Workflow[]>(workflows);
    const modelsRef = useRef<ModelConfig[]>(modelConfigs);
    const externalToolsRef = useRef<ExternalTool[]>(externalTools);
    const apiKeysRef = useRef<ApiKey[]>(apiKeys);
    const usageHistoryRef = useRef<UsageRecord[]>(usageHistory);
    const logsRef = useRef<LogEntry[]>(logs);
    const memoryConfigRef = useRef<MemoryConfig>(memoryConfig);
    const summaryConfigRef = useRef<SummaryConfig>(summaryConfig);

    useEffect(() => { agentsRef.current = agents; }, [agents]);
    useEffect(() => { scheduledMessagesRef.current = scheduledMessages; }, [scheduledMessages]);
    useEffect(() => { workflowsRef.current = workflows; }, [workflows]);
    useEffect(() => { modelsRef.current = modelConfigs; }, [modelConfigs]);
    useEffect(() => { externalToolsRef.current = externalTools; }, [externalTools]);
    useEffect(() => { apiKeysRef.current = apiKeys; }, [apiKeys]);
    useEffect(() => { usageHistoryRef.current = usageHistory; }, [usageHistory]);
    useEffect(() => { logsRef.current = logs; }, [logs]);
    useEffect(() => { memoryConfigRef.current = memoryConfig; }, [memoryConfig]);
    useEffect(() => { summaryConfigRef.current = summaryConfig; }, [summaryConfig]);

    // ==========================================================================
    // Load — busca config e agents do servidor ao autenticar
    // ==========================================================================
    useEffect(() => {
        if (!token || !username) return;

        const requestedGeneration = refreshNonce;
        const shouldShowBootLoading = !initialLoadCompletedRef.current;
        const bootLoadingOwnerGeneration = shouldShowBootLoading ? requestedGeneration : null;
        if (bootLoadingOwnerGeneration !== null) {
            setIsLoading(true);
        }

        const load = async () => {
            try {
                let loadedAgents: Agent[] = [DEFAULT_AGENT];
                let config: any = {};

                if (isOfflineMode) {
                    const local = localStorage.getItem(`orchestrator_state_${username}`);
                    if (local) {
                        try {
                            const parsed = JSON.parse(local);
                            loadedAgents = parsed.agents || [DEFAULT_AGENT];
                            config = parsed;
                        } catch {}
                    }
                } else {
                    try {
                        await localPost('/api/migrate', { username }).catch(() => {});
                        const [agentsRes, configRes] = await Promise.all([
                            localGet('/api/agents', username),
                            localGet('/api/config', username),
                        ]);
                        if (agentsRes?.agents) loadedAgents = agentsRes.agents;
                        if (configRes) config = configRes;
                    } catch (e) {
                        console.warn('Failed to load from server in online mode; preserving current in-memory state', e);
                        throw e;
                    }
                }

                const effectiveHost = config?.ollamaHost || OLLAMA_DEFAULT_HOST;

                // Normalizar agentes (timestamps, sessions, deduplicação, master)
                loadedAgents = normalizeAgents(loadedAgents);

                // Online mode: backend /api/config já entrega o catálogo efetivo merged.
                // Offline mode: pode complementar com localStorage do próprio usuário.
                const persistedModels = Array.isArray(config?.modelConfigs) ? config.modelConfigs : [];
                const localStateModels = isOfflineMode ? (() => {
                    try {
                        const local = localStorage.getItem(`orchestrator_state_${username}`);
                        if (!local) return [];
                        const parsed = JSON.parse(local);
                        return Array.isArray(parsed?.modelConfigs) ? parsed.modelConfigs : [];
                    } catch {
                        return [];
                    }
                })() : [];
                const mergedPersistedAndLocalModels = [...persistedModels];
                const persistedModelIdentity = new Set(
                    mergedPersistedAndLocalModels.map((m: ModelConfig) => `${m.provider}:${m.modelId}`)
                );
                localStateModels.forEach((model: ModelConfig) => {
                    const key = `${model.provider}:${model.modelId}`;
                    if (!persistedModelIdentity.has(key)) {
                        mergedPersistedAndLocalModels.push(model);
                        persistedModelIdentity.add(key);
                    }
                });
                const loadedModels = mergedPersistedAndLocalModels;

                // Carregar histórico real das sessões ativas
                if (!isOfflineMode) {
                    loadedAgents = await loadSessionHistories(loadedAgents, username);
                }

                const latestRequestedGeneration = latestRequestedGenerationRef.current;
                const hasNewerGeneration = latestRequestedGeneration > requestedGeneration;
                const isStaleRefresh = hasNewerGeneration;
                if (isStaleRefresh) {
                    resolveCompletedRefreshes(requestedGeneration);
                } else {
                    setAgents(loadedAgents);
                    if (config?.scheduledMessages) setScheduledMessages(config.scheduledMessages);
                    if (config?.workflows) setWorkflows(config.workflows);
                    if (config?.externalTools) setExternalTools(config.externalTools);
                    if (config?.apiKeys) setApiKeys(config.apiKeys);
                    if (config?.ollamaHost) setOllamaHost(config.ollamaHost);
                    if (config?.theme) setTheme(config.theme);
                    if (config?.colorTheme) setColorTheme(config.colorTheme as ColorTheme);
                    if (config?.timezone) setTimezone(config.timezone);
                    if (config?.profile?.displayName) setDisplayName(config.profile.displayName);
                    setModelConfigs(prevModels => {
                        if (persistedModels.length > 0) return loadedModels;
                        if (prevModels.length > 0) return prevModels;
                        return loadedModels.length > 0 ? loadedModels : [createOllamaModelConfig('llama3', effectiveHost)];
                    });
                    if (config?.guidelines) setGuidelines(config.guidelines);
                    if (config?.memoryConfig) setMemoryConfig(config.memoryConfig);
                    if (config?.summaryConfig) setSummaryConfig(config.summaryConfig);
                    if (config?.usageHistory) setUsageHistory(config.usageHistory);
                    if (config?.trafficLogs) setLogs(config.trafficLogs);

                    initialLoadCompletedRef.current = true;
                    resolveCompletedRefreshes(requestedGeneration);
                }
            } catch (error) {
                const isCurrentGeneration = requestedGeneration === latestRequestedGenerationRef.current;
                if (isCurrentGeneration) {
                    rejectRefreshGeneration(requestedGeneration, error);
                    throw error;
                }

                resolveCompletedRefreshes(requestedGeneration);
            } finally {
                if (
                    bootLoadingOwnerGeneration !== null &&
                    requestedGeneration === bootLoadingOwnerGeneration &&
                    requestedGeneration === latestRequestedGenerationRef.current
                ) {
                    setIsLoading(false);
                }
            }
        };

        load().catch((error) => {
            console.warn('Failed to refresh app config', error);
        });
    }, [token, username, isOfflineMode, refreshNonce, rejectRefreshGeneration, resolveCompletedRefreshes]);

    // ==========================================================================
    // saveField — PATCH cirúrgico de um campo específico
    // ==========================================================================
    const saveField = useCallback(async (field: string, value: any) => {
        if (!token || !username) return;
        if (isOfflineMode) {
            const local = localStorage.getItem(`orchestrator_state_${username}`);
            const state = local ? JSON.parse(local) : {};
            state[field] = value;
            localStorage.setItem(`orchestrator_state_${username}`, JSON.stringify(state));
            return;
        }
        await localPatch('/api/config', { username, fields: { [field]: value } });
    }, [token, username, isOfflineMode]);

    // ==========================================================================
    // saveAgents — persiste agents via endpoint dedicado
    // ==========================================================================
    const saveAgents = useCallback(async (agentList: Agent[]) => {
        if (!token || !username) return;
        const agentsWithoutSessions = agentList.map(a => a.isMaster
            ? { ...a, sessions: undefined, history: undefined }
            : a
        );
        await localPost('/api/agents', { username, agent: null, agents: agentsWithoutSessions });
    }, [token, username]);

    // ==========================================================================
    // persistState — compatibilidade com código legado
    // Salva apenas campos escalares/leves via PATCH — nunca workflows/modelConfigs
    // ==========================================================================
    const persistState = useCallback(async (
        _currentAgents: Agent[],
        currentSchedules: ScheduledMessage[],
        _currentWorkflows: Workflow[],
        currentHost: string,
        _currentModels: ModelConfig[],
        currentGuidelines: string,
        currentTheme: 'light' | 'dark',
        currentColorTheme: ColorTheme,
        currentUsageHistory?: UsageRecord[],
        currentLogs?: LogEntry[],
        currentExternalTools?: ExternalTool[],
        currentApiKeys?: ApiKey[],
        currentMemoryConfig?: MemoryConfig,
    ) => {
        if (!token || !username) return;

        const fields: Record<string, any> = {
            scheduledMessages: currentSchedules,
            ollamaHost: currentHost,
            guidelines: currentGuidelines,
            theme: currentTheme,
            colorTheme: currentColorTheme,
        };
        if (currentUsageHistory) fields.usageHistory = currentUsageHistory;
        if (currentLogs) fields.trafficLogs = currentLogs;
        if (currentExternalTools?.length) fields.externalTools = currentExternalTools;
        if (currentApiKeys?.length) fields.apiKeys = currentApiKeys;
        if (currentMemoryConfig) fields.memoryConfig = currentMemoryConfig;
        // workflows e modelConfigs: NUNCA via persistState — só via saveField explícito
        // agents: via saveAgents

        if (isOfflineMode) {
            const local = localStorage.getItem(`orchestrator_state_${username}`);
            const state = local ? JSON.parse(local) : {};
            localStorage.setItem(`orchestrator_state_${username}`, JSON.stringify({ ...state, ...fields }));
            return;
        }

        try {
            await localPatch('/api/config', { username, fields });
            // Cache local lean apenas para config; agents nunca são fonte em online mode
            const local = localStorage.getItem(`orchestrator_state_${username}`);
            const existing = local ? JSON.parse(local) : {};
            const { agents: _ignoredAgents, ...restExisting } = existing || {};
            localStorage.setItem(`orchestrator_state_${username}`, JSON.stringify({
                ...restExisting, ...fields
            }));
        } catch (e) {
            console.error('Persistence Error', e);
        }
    }, [token, username, isOfflineMode]);

    // ==========================================================================
    // setPersistedAgents — atualiza state; persistência de agentes é feita via APIs dedicadas
    // ==========================================================================

    const refreshConfig = useCallback(async () => {
        if (!token || !username) return;

        const requestedGeneration = refreshGenerationRef.current + 1;
        refreshGenerationRef.current = requestedGeneration;
        latestRequestedGenerationRef.current = requestedGeneration;
        if (!initialLoadCompletedRef.current && completedRefreshGenerationRef.current < 0) {
            completedRefreshGenerationRef.current = 0;
        }
        resolveSupersededRefreshes(requestedGeneration);

        return new Promise<void>((resolve, reject) => {
            if (completedRefreshGenerationRef.current >= requestedGeneration) {
                resolve();
                return;
            }
            refreshResolversRef.current.push({ generation: requestedGeneration, resolve, reject });
            setRefreshNonce(requestedGeneration);
        });
    }, [token, username, resolveSupersededRefreshes]);

    const setPersistedAgents = useCallback((newAgents: Agent[] | ((prev: Agent[]) => Agent[])) => {
        setAgents(prev => {
            const resolved = typeof newAgents === 'function' ? (newAgents as Function)(prev) : newAgents;
            return resolved.map((agent: Agent) => ({
                ...agent,
                lastModified: typeof agent.lastModified === 'number' ? agent.lastModified : Date.now()
            }));
        });
    }, []);

    const reloadConfig = refreshConfig;

    return {
        agents, setAgents,
        scheduledMessages, setScheduledMessages,
        workflows, setWorkflows,
        modelConfigs, setModelConfigs,
        externalTools, setExternalTools,
        apiKeys, setApiKeys,
        memoryConfig, setMemoryConfig,
        summaryConfig, setSummaryConfig,
        guidelines, setGuidelines,
        ollamaHost, setOllamaHost,
        theme, setTheme,
        colorTheme, setColorTheme,
        timezone, setTimezone,
        displayName, setDisplayName,
        usageHistory, setUsageHistory,
        logs, setLogs,
        isLoading,
        refreshConfig,
        reloadConfig,
        persistState,
        saveField,
        saveAgents,
        setPersistedAgents,
        debouncedPersist: () => {},
        immediatePersist: () => {},
        agentsRef,
        modelsRef,
        workflowsRef,
        externalToolsRef,
        apiKeysRef,
        scheduledMessagesRef,
        usageHistoryRef,
        logsRef,
        memoryConfigRef,
        summaryConfigRef,
    };
};
