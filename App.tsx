import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Layout from './components/Layout';
import Auth from './components/Auth';
import AgentManager from './components/AgentManager';
import SettingsModal from './components/SettingsModal';
import SchedulerModal from './components/SchedulerModal';
import BootScreen from './components/BootScreen';
import AppRouter from './components/views/AppRouter';
import type { LogEntry, Workflow, Attachment, Project } from './types';
import { ACTIVE_AGENT_STORAGE_KEY, APP_BASE_PATH, APP_LOG_PREFIX, AUTH_TOKEN_STORAGE_KEY, AUTH_USERNAME_STORAGE_KEY, DEFAULT_AGENT, LEGACY_AUTH_TOKEN_STORAGE_KEYS, LEGACY_AUTH_USERNAME_STORAGE_KEYS, MAX_LOG_ENTRIES, legacyUserActiveProjectStorageKey, legacyUserProjectStorageKey, userStorageKey } from './constants';
import * as ServerChat from './services/serverChatService';
import * as localApiService from './services/localApiService';
const {
    createUserOnServer,
    fetchSession,
    fetchUsers,
    loginWithUser,
    logoutSession,
    createAgentOnServer,
    updateAgentOnServer,
    deleteAgentOnServer,
    fetchAgents,
    deleteUserOnServer,
} = localApiService as any;
import type { SessionUser } from './services/localApiService';
import { useAgentStream } from './hooks/useAgentStream';
import { useAppConfig } from './hooks/useAppConfig';
import { useToolEngine } from './hooks/useToolEngine';
import { useOrchestrationEngine } from './hooks/useOrchestrationEngine';
import { generateId } from './utils/helpers';
import { useProjectState } from './hooks/useProjectState';
import ExecutionPlanModal from './components/ExecutionPlanModal';
import { DryRunModal } from './components/DryRunModal';
import { useAutoMemory } from './hooks/useAutoMemory';
import { orchestrationBus } from './hooks/useOrchestrationEngine';
import { useNotifications } from './hooks/useNotifications';
import { useSyncStatus } from './hooks/useSyncStatus';
import { useWorkflowScheduler } from './hooks/useWorkflowScheduler';
import { useSessionManager } from './hooks/useSessionManager';
import { useGenerationControl } from './hooks/useGenerationControl';
import { useUIState } from './hooks/useUIState';
import { useToolApproval } from './hooks/useToolApproval';
import { useExecutionPlanApproval } from './hooks/useExecutionPlanApproval';
import { useAgentCycle } from './hooks/useAgentCycle';
import { useServerChatAvailability } from './hooks/useServerChatAvailability';
import { useActiveAgentPersistence } from './hooks/useActiveAgentPersistence';

const safeWindow = typeof window !== 'undefined' ? window : undefined;
const startupLog = (event: string, details?: unknown) => {
    try { console.log(APP_LOG_PREFIX, { event, details }); } catch {}
};
const LOCAL_BASE = (APP_BASE_PATH || '').replace(/\/$/, '');
const readLocalStorage = (key: string) => {
    try { return safeWindow?.localStorage.getItem(key) ?? null; } catch { return null; }
};
const readFirstLocalStorage = (keys: string[]) => {
    for (const key of keys) {
        const value = readLocalStorage(key);
        if (value !== null) return value;
    }
    return null;
};
const writeLocalStorage = (key: string, value: string) => {
    try { safeWindow?.localStorage.setItem(key, value); } catch {}
};
const removeLocalStorage = (key: string) => {
    try { safeWindow?.localStorage.removeItem(key); } catch {}
};

const App: React.FC = () => {
    const [token, setToken] = useState<string | null>(readFirstLocalStorage([AUTH_TOKEN_STORAGE_KEY, ...LEGACY_AUTH_TOKEN_STORAGE_KEYS]));
    const [username, setUsername] = useState<string>(readFirstLocalStorage([AUTH_USERNAME_STORAGE_KEY, ...LEGACY_AUTH_USERNAME_STORAGE_KEYS]) || '');
    const [authError, setAuthError] = useState<string>('');
    const [settingsRefreshError, setSettingsRefreshError] = useState<string>('');
    const [isRefreshingSettings, setIsRefreshingSettings] = useState<boolean>(false);
    const [pendingSettingsOpen, setPendingSettingsOpen] = useState<boolean>(false);
    const [isOfflineMode, setIsOfflineMode] = useState<boolean>(false);
    const [sessionDisplayName, setSessionDisplayName] = useState<string>('');
    const [existingUsers, setExistingUsers] = useState<SessionUser[]>([]);
    const [isAuthLoading, setIsAuthLoading] = useState<boolean>(true);
    const [sessionNoteRemoteRefreshKey, setSessionNoteRemoteRefreshKey] = useState<number>(0);
    const activeAgentIdRef = useRef<string>(DEFAULT_AGENT.id);

    const appConfig = useAppConfig(token, username, isOfflineMode);
    const {
        agents, setAgents, setPersistedAgents,
        scheduledMessages, setScheduledMessages,
        workflows, setWorkflows,
        modelConfigs, setModelConfigs,
        externalTools,
        apiKeys, setApiKeys,
        memoryConfig, setMemoryConfig,
        summaryConfig, setSummaryConfig,
        guidelines, setGuidelines,
        ollamaHost, setOllamaHost,
        theme, setTheme,
        colorTheme, setColorTheme,
        timezone, setTimezone,
        displayName: persistedDisplayName, setDisplayName,
        usageHistory, setUsageHistory,
        logs, setLogs,
        isLoading, reloadConfig, persistState, saveField,
        agentsRef, modelsRef, workflowsRef,
        externalToolsRef, apiKeysRef, scheduledMessagesRef,
        usageHistoryRef
    } = appConfig;

    const initialProjectState = useMemo(() => {
        const projects = (() => {
            try {
                return JSON.parse(
                    readLocalStorage(userStorageKey('projects', username))
                    ?? readLocalStorage(legacyUserProjectStorageKey(username))
                    ?? '[]'
                ) as Project[];
            } catch {
                return [];
            }
        })();
        const activeProjectId = readLocalStorage(userStorageKey('active_project', username))
            ?? readLocalStorage(legacyUserActiveProjectStorageKey(username))
            ?? null;
        return { projects, activeProjectId };
    }, [username]);

    const {
        projects, activeProjectId,
        addProject, editProject, deleteProject, selectProject,
        getProjectContext,
        scanProject, approveContext,
        scanLoading, scanDraft, dismissDraft,
    } = useProjectState(
        initialProjectState.projects,
        initialProjectState.activeProjectId,
        (updatedProjects, updatedActiveId) => {
            const projectsKey = userStorageKey('projects', username);
            writeLocalStorage(projectsKey, JSON.stringify(updatedProjects));
            const activeProjectKey = userStorageKey('active_project', username);
            if (updatedActiveId) {
                writeLocalStorage(activeProjectKey, updatedActiveId);
            } else {
                removeLocalStorage(activeProjectKey);
            }
        }
    );

    const {
        isProjectPanelOpen, setIsProjectPanelOpen,
        isOrchestrationPanelOpen, setIsOrchestrationPanelOpen,
        isSidebarOpen, setIsSidebarOpen,
        isSessionPanelOpen, setIsSessionPanelOpen,
        isChatVisible, setIsChatVisible,
        viewMode, setViewMode,
        editingWorkflowId, setEditingWorkflowId,
        showAgentManager, setShowAgentManager,
        showSettings, setShowSettings,
        showScheduler, setShowScheduler,
        editingAgent, setEditingAgent,
        showConsole, setShowConsole,
        showTerminal, setShowTerminal,
        pendingPlan, setPendingPlan,
        pendingStrategyPlan, setPendingStrategyPlan,
        strategyPlanItems, setStrategyPlanItems,
        pendingDryRun, setPendingDryRun,
        pendingApproval, setPendingApproval,
    } = useUIState();
    const [activeAgentId, setActiveAgentId] = useState<string>(DEFAULT_AGENT.id);
    const [runningAgents, setRunningAgents] = useState<Set<string>>(new Set());
    const runAgentCycleRef = useRef<any>(null);
    const { syncStatus, withSync } = useSyncStatus();
    // Helper: salva estado e atualiza indicador de sync
    const persistAndSync = useCallback(async () => {
        await withSync(() => persistState(
            agentsRef.current, scheduledMessagesRef.current, workflowsRef.current,
            ollamaHost, modelsRef.current, guidelines, theme, colorTheme,
            usageHistoryRef.current, logs, externalToolsRef.current, apiKeysRef.current,
            memoryConfig
        ));
    }, [withSync, persistState, ollamaHost, guidelines, theme, colorTheme, logs, memoryConfig]);
    const addLog = (entry: LogEntry) => {
        setLogs(prev => {
            const next = [...prev, entry];
            return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
        });
    };
    const clearLogs = () => setLogs([]);

    const {
        notifications,
        addNotification,
        markNotificationAsRead,
        markAllNotificationsRead,
        clearNotifications,
        dismissNotification,
    } = useNotifications();

    const {
        runStateByAgent,
        isGeneratingRef,
        setAgentGenerating,
        isAgentGenerating,
        handleStop,
    } = useGenerationControl({ username, addNotification, setPendingApproval });

    useEffect(() => {
        if (theme === 'dark') document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
    }, [theme]);

    const { serverChatAvailable } = useServerChatAvailability();
    useActiveAgentPersistence(agents, viewMode, activeAgentId, setActiveAgentId);

    useEffect(() => {
        activeAgentIdRef.current = activeAgentId;
    }, [activeAgentId]);

    // SSE broker — callbacks como refs estáveis, sem dependências que mudam
    const respondToApprovalRef = useRef<((id: string, approved: boolean, payload?: any) => void) | null>(null);

    const syncAgentGeneratingState = useCallback((agentId: string | null | undefined, value: boolean) => {
        if (!agentId) return;
        setAgentGenerating(agentId, value, null, agentsRef.current.find(a => a.id === agentId)?.activeSessionId ?? null);
        isGeneratingRef.current = value;
    }, [setAgentGenerating]);

    const sseHandlersRef = useRef({
        addNotification,
        setPendingPlan,
        setPendingDryRun,
        setRunningAgents,
        addLog,
        setAgents: (agents: any[]) => { setAgents(agents); agentsRef.current = agents; },
    });
    // Atualizar refs sem recriar o hook
    useEffect(() => {
        sseHandlersRef.current.addNotification = addNotification;
        sseHandlersRef.current.setPendingPlan = setPendingPlan;
        sseHandlersRef.current.setPendingDryRun = setPendingDryRun;
        sseHandlersRef.current.setRunningAgents = setRunningAgents;
        sseHandlersRef.current.addLog = addLog;
    });

    const { respondToApproval: _respondToApproval } = useAgentStream({
        username,
        enabled: !!username && serverChatAvailable,
        onEvent: useCallback((event: any) => {
            const ts = Date.now();
            if (event.type === 'agent_start') {
                sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'info', method: 'AGENT_START', model: event.agentName, content: { agentId: event.agentId, model: event.model } });
                sseHandlersRef.current.setRunningAgents?.((prev: Set<string>) => new Set([...prev, event.agentId]));
                syncAgentGeneratingState(event.agentId, true);
            } else if (event.type === 'chunk') {
                const targetAgentId = event.agentId;
                if (targetAgentId) {
                    syncAgentGeneratingState(targetAgentId, true);
                    setAgents(prev => {
                        const idx = prev.findIndex((a: any) => a.id === targetAgentId);
                        if (idx === -1) return prev;
                        const next = [...prev];
                        const agentCopy = { ...next[idx] } as any;
                        const history = Array.isArray(agentCopy.history) ? [...agentCopy.history] : [];
                        const last = history[history.length - 1];
                        if (last?.role === 'assistant' && last?.meta?.streaming) {
                            history[history.length - 1] = {
                                ...last,
                                content: `${String(last.content ?? '')}${String(event.content ?? '')}`,
                                timestamp: ts,
                            };
                        } else {
                            history.push({
                                role: 'assistant',
                                content: String(event.content ?? ''),
                                timestamp: ts,
                                meta: { streaming: true },
                            });
                        }
                        agentCopy.history = history;
                        next[idx] = agentCopy;
                        agentsRef.current = next;
                        return next;
                    });
                }
            } else if (event.type === 'agent_done') {
                sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'response', method: 'AGENT_DONE', model: event.agentName, content: { iterations: event.iterations, toolSummary: event.toolSummary }, durationMs: event.durationMs });
                sseHandlersRef.current.setRunningAgents?.((prev: Set<string>) => { const s = new Set(prev); s.delete(event.agentId); return s; });
                syncAgentGeneratingState(event.agentId, false);
                // Reload canonical history from sessionStore only after agent fully completes
                // (not on session_updated which fires mid-stream and would truncate bubbles)
                const doneAgent = agentsRef.current.find((a: any) => a.id === event.agentId);
                const doneSessionId = doneAgent?.activeSessionId;
                // Only load if sessionId looks valid (not 'default' or short legacy IDs)
                if (doneSessionId && doneSessionId !== 'default' && doneSessionId.length > 8 && username) {
                    ServerChat.loadSession(doneSessionId, username).then(session => {
                        if (!session) return;
                        setAgents(prev => {
                            const idx = prev.findIndex((a: any) => a.id === event.agentId);
                            if (idx === -1) return prev;
                            const next = [...prev];
                            const agentCopy = { ...next[idx] };
                            const serverMessages = Array.isArray(session.messages) ? session.messages : [];
                            const localMessages = Array.isArray(agentCopy.history) ? agentCopy.history : [];
                            const normalizedLocalMessages = localMessages.map((m: any) => (m?.meta?.streaming ? { ...m, meta: { ...(m.meta || {}), streaming: false } } : m));
                            if (localMessages.length === 0 && serverMessages.length > 0) {
                                return prev;
                            }
                            const localLast = normalizedLocalMessages[normalizedLocalMessages.length - 1];
                            const serverLast = serverMessages[serverMessages.length - 1];
                            const sameLast = localLast && serverLast
                                && localLast.role === serverLast.role
                                && String(localLast.content ?? '') === String(serverLast.content ?? '');
                            if (sameLast && normalizedLocalMessages.length === serverMessages.length) {
                                return prev;
                            }
                            agentCopy.history = serverMessages;
                            next[idx] = agentCopy;
                            agentsRef.current = next;
                            return next;
                        });
                    });
                }
            } else if (event.type === 'tool_call') {
//                 sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'info', method: `TOOL_CALL`, model: event.toolName, content: { agentId: event.agentId, args: event.args } });
                // Feed orchestration panel for delegate_task calls
                if (event.toolName === 'delegate_task' || event.toolName === 'send_agent_message') {
                    const args = event.args || {};
                    const subId = args.subAgentIdentifier || args.agentId || args.recipientIdentifier || '?';
                    const masterAgent = agentsRef.current.find((a: any) => a.id === event.agentId);
                    const subAgent = agentsRef.current.find((a: any) => a.id === subId || a.name?.toLowerCase() === subId?.toLowerCase());
                    orchestrationBus.emit({
                        type: 'task:attempt',
                        taskId: event.tool_call_id || `${event.agentId}-${ts}`,
                        task: {
                            id: event.tool_call_id || `${event.agentId}-${ts}`,
                            masterAgentId: event.agentId,
                            masterAgentName: masterAgent?.name || event.agentId,
                            subAgentId: subAgent?.id || subId,
                            subAgentName: subAgent?.name || subId,
                            task: args.task || args.message || '',
                            expectedOutput: args.expectedOutputFields ? { required: args.expectedOutputFields } : undefined,
                            maxRetries: args.maxRetries ?? 2,
                            timeoutMs: (args.timeoutSeconds ?? 60) * 1000,
                            createdAt: ts,
                        },
                        attempt: 1,
                        timestamp: ts,
                    });
                } else if (event.toolName === 'delegate_parallel') {
                    // Emit one task:attempt per task in the parallel batch
                    const args = event.args || {};
                    const masterAgent = agentsRef.current.find((a: any) => a.id === event.agentId);
                    const tasks: any[] = args.tasks || [];
                    tasks.forEach((taskDef: any, i: number) => {
                        const subId = (taskDef.subAgentIdentifier || '').toLowerCase();
                        const subAgent = agentsRef.current.find((a: any) => a.id === subId || a.name?.toLowerCase() === subId);
                        const taskId = `${event.tool_call_id || event.agentId}-p${i}`;
                        orchestrationBus.emit({
                            type: 'task:attempt',
                            taskId,
                            task: {
                                id: taskId,
                                masterAgentId: event.agentId,
                                masterAgentName: masterAgent?.name || event.agentId,
                                subAgentId: subAgent?.id || subId,
                                subAgentName: taskDef.label || subAgent?.name || subId,
                                task: taskDef.task || '',
                                expectedOutput: taskDef.expectedOutputFields ? { required: taskDef.expectedOutputFields } : undefined,
                                maxRetries: 0,
                                timeoutMs: (taskDef.timeoutSeconds ?? 60) * 1000,
                                createdAt: ts,
                            },
                            attempt: 1,
                            timestamp: ts,
                        });
                    });
                }
            } else if (event.type === 'tool_result') {
                sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'response', method: `TOOL_RESULT`, model: event.toolName, content: { agentId: event.agentId, output: event.output } });
                if (event.toolName === 'create_agent' && event.output?.success && event.output?.agentId) {
                    fetch(`${LOCAL_BASE}/api/agents?username=${encodeURIComponent(username)}`)
                        .then(res => res.ok ? res.json() : null)
                        .then(data => {
                            if (data?.agents) {
                                setAgents(data.agents);
                                agentsRef.current = data.agents;
                            }
                        })
                        .catch(() => {});
                } else if (event.toolName === 'update_agent_profile' && event.output?.success) {
                    fetch(`${LOCAL_BASE}/api/agents?username=${encodeURIComponent(username)}`)
                        .then(res => res.ok ? res.json() : null)
                        .then(data => {
                            if (data?.agents) {
                                setAgents(data.agents);
                                agentsRef.current = data.agents;
                            }
                        })
                        .catch(() => {});
                }
                // Feed orchestration panel for delegate_task results
                if (event.toolName === 'delegate_task' || event.toolName === 'send_agent_message') {
                    const output = event.output || {};
                    const taskId = event.tool_call_id || `${event.agentId}-${ts}`;
                    orchestrationBus.emit({
                        type: output.success === false ? 'task:failed' : 'task:completed',
                        taskId,
                        task: { id: taskId, masterAgentId: event.agentId, masterAgentName: '', subAgentId: '', subAgentName: output._subAgent || '', task: '', maxRetries: 0, timeoutMs: 0, createdAt: ts },
                        result: {
                            taskId,
                            success: output.success !== false,
                            output: output,
                            attempts: output._attempts || 1,
                            durationMs: 0,
                            validationError: output.validationError,
                        },
                        timestamp: ts,
                    });
                } else if (event.toolName === 'delegate_parallel') {
                    // Emit completed/failed per individual result in the batch
                    const output = event.output || {};
                    const results: any[] = output.results || [];
                    results.forEach((r: any, i: number) => {
                        const taskId = `${event.tool_call_id || event.agentId}-p${i}`;
                        orchestrationBus.emit({
                            type: r.success === false ? 'task:failed' : 'task:completed',
                            taskId,
                            task: { id: taskId, masterAgentId: event.agentId, masterAgentName: '', subAgentId: '', subAgentName: r._label || `task-${i}`, task: '', maxRetries: 0, timeoutMs: 0, createdAt: ts },
                            result: {
                                taskId,
                                success: r.success !== false,
                                output: r,
                                attempts: 1,
                                durationMs: 0,
                            },
                            timestamp: ts,
                        });
                    });
                }
            } else if (event.type === 'delegate_status') {
                sseHandlersRef.current.addLog({
                    id: `${ts}`,
                    timestamp: ts,
                    type: event.status === 'error' ? 'error' : 'info',
                    method: 'DELEGATE_STATUS',
                    model: event.subAgentName || event.subAgentId,
                    content: {
                        masterAgentId: event.masterAgentId,
                        subAgentId: event.subAgentId,
                        subAgentName: event.subAgentName,
                        status: event.status,
                        detail: event.detail,
                        taskPreview: event.taskPreview,
                    }
                });
            } else if (event.type === 'error') {
                sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'error', method: 'AGENT_ERROR', model: event.agentId, content: { message: event.message } });
            } else if (event.type === 'llm_request') {
                sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'request', method: 'LLM_REQUEST', model: event.model, content: event.payload });
            } else if (event.type === 'llm_response') {
                sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'response', method: 'LLM_RESPONSE', model: event.model, content: event.raw });
            } else if (event.type === 'memory_metrics') {
                const summary = event.phase === 'selection'
                    ? `selection ${event.selectionMs ?? '?'}ms • ${event.injectedCount ?? 0} injected • ${event.candidateCount ?? 0} candidates${event.fallbackUsed ? ' • fallback' : ''}${event.failed ? ` • failed (${event.errorStage || 'unknown'})` : ''}`
                    : event.phase === 'maintenance_triggered'
                        ? `maintenance triggered • agent ${event.maintenanceAgentId || 'unknown'}`
                        : event.phase === 'maintenance_completed'
                            ? `maintenance ${event.status || 'done'} • ${event.durationMs ?? '?'}ms • ${event.actionsCount ?? 0} actions${event.decisionSummary?.reason ? ` • ${event.decisionSummary.reason}` : ''}`
                            : `memory metrics • ${event.phase || 'unknown phase'}`;
                sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'info', method: 'MEMORY_METRICS', model: event.agentId, content: event, summary });
            } else if (event.type === 'memory_injection') {
                const count = Array.isArray(event.memories) ? event.memories.length : 0;
                const summary = `injected ${count} memories`;
                sseHandlersRef.current.addLog({ id: `${ts}`, timestamp: ts, type: 'info', method: 'MEMORY_INJECTION', model: event.agentId, content: event, summary });
            } else if (event.type === 'session_updated') {
                const currentAgent = agentsRef.current.find((a: any) => a.id === activeAgentIdRef.current);
                const refreshesActiveSession = Boolean(currentAgent?.activeSessionId && event.sessionId === currentAgent.activeSessionId);
                if (refreshesActiveSession) {
                    setSessionNoteRemoteRefreshKey(prev => prev + 1);
                    if (username && event.sessionId && event.sessionId !== 'default' && String(event.sessionId).length > 8) {
                        ServerChat.loadSession(event.sessionId, username).then(session => {
                            if (!session) return;
                            setAgents(prev => {
                                const idx = prev.findIndex((a: any) => a.id === (event.agentId || activeAgentIdRef.current));
                                if (idx === -1) return prev;
                                const next = [...prev];
                                const agentCopy = { ...next[idx] } as any;
                                const localMessages = Array.isArray(agentCopy.history) ? agentCopy.history : [];
                                const hasStreamingAssistant = localMessages.some((m: any) => m?.role === 'assistant' && m?.meta?.streaming);
                                if (hasStreamingAssistant) return prev;
                                const serverMessages = Array.isArray(session.messages) ? session.messages : [];
                                agentCopy.history = serverMessages;
                                next[idx] = agentCopy;
                                agentsRef.current = next;
                                return next;
                            });
                        }).catch(() => {});
                    }
                }
            } else if (event.type === 'approval:decision') {
                const agentId = event.agentId || null;
                if (agentId) {
                    syncAgentGeneratingState(agentId, false);
                }
            } else if (event.type === 'write_file_dry_run') {
                sseHandlersRef.current.setPendingDryRun({
                    payload: {
                        path: event.path,
                        originalContent: event.originalContent,
                        proposedContent: event.proposedContent,
                        agentId: event.agentId,
                        toolCallId: event.tool_call_id,
                    },
                    resolve: (approved: boolean) => {
                        fetch(`${LOCAL_BASE}/api/approval/respond`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ requestId: event.requestId, approved }),
                        }).catch(() => {});
                    },
                });
            }
        }, []),
        onReconnect: useCallback(async () => {
            if (!username || isGeneratingRef.current) return;
            try {
                const res = await fetch(`${LOCAL_BASE}/api/agents?username=${encodeURIComponent(username)}`);
                if (!res.ok) return;
                const { agents: freshAgents } = await res.json();
                if (!freshAgents?.length) return;
                // Merge: server is source of truth for history — only preserve local during active generation
                setAgents(prev => {
                    const merged = freshAgents.map((fresh: any) => {
                        const local = prev.find((a: any) => a.id === fresh.id);
                        if (!local) return fresh;
                        // If agent is currently generating, keep local history to avoid interrupting bubbles
                        // Otherwise always use server history (sessionStore is source of truth)
                        const isGenerating = isGeneratingRef.current;
                        return {
                            ...fresh,
                            history: isGenerating ? (local.history || fresh.history || []) : (fresh.history || []),
                        };
                    });
                    agentsRef.current = merged;
                    return merged;
                });
            } catch {}
        }, [username]),
        onAlert: useCallback((alerts: any[]) => {
            alerts.filter((a: any) => !a.read).forEach((a: any) => {
                sseHandlersRef.current.addNotification(a.title, a.message, a.type);
            });
        }, []),
        onApprovalRequired: useCallback((data: any) => {
            const strategyPlan = {
                title: data.title ?? '',
                objective: data.objective ?? '',
                approach: data.approach ?? '',
                risks: data.risks ?? '',
                checklist: Array.isArray(data.checklist) ? data.checklist : [],
            };
            const requestId = String(data.requestId || '').trim();
            const itemId = String(requestId || `strategy-plan:${String(data.agentId || '').trim() || 'unknown'}:${Date.now()}`);
            const now = new Date().toISOString();
            const approvePlan = (revisedPlan?: any) => {
                const approvedPlan = revisedPlan && typeof revisedPlan === 'object' ? revisedPlan : strategyPlan;
                const updatedAt = new Date().toISOString();
                setStrategyPlanItems((prev: any[]) => (Array.isArray(prev) ? prev.map((item: any) => (
                    String(item?.id || '').trim() === itemId
                        ? { ...item, plan: approvedPlan, status: 'in_progress', updatedAt }
                        : item
                )) : prev));
                syncAgentGeneratingState(data.agentId, true);
                respondToApprovalRef.current?.(data.requestId, true, approvedPlan);
                setPendingStrategyPlan((prev: any) => String(prev?.requestId || '').trim() === requestId ? null : prev);
            };
            const rejectPlan = () => {
                setStrategyPlanItems((prev: any[]) => (Array.isArray(prev)
                    ? prev.filter((item: any) => String(item?.id || '').trim() !== itemId)
                    : prev));
                syncAgentGeneratingState(data.agentId, false);
                respondToApprovalRef.current?.(data.requestId, false);
                setPendingStrategyPlan((prev: any) => String(prev?.requestId || '').trim() === requestId ? null : prev);
            };
            setStrategyPlanItems((prev: any[]) => {
                const next = Array.isArray(prev) ? [...prev] : [];
                const index = next.findIndex((item: any) => String(item?.id || '').trim() === itemId);
                const baseItem = {
                    id: itemId,
                    agentId: String(data.agentId || '').trim(),
                    requestId: requestId || undefined,
                    source: 'strategyPlanTracking',
                    status: 'open',
                    plan: strategyPlan,
                    updatedAt: now,
                    onApprove: approvePlan,
                    onReject: rejectPlan,
                };
                if (index >= 0) {
                    next[index] = { ...next[index], ...baseItem, createdAt: next[index]?.createdAt || now };
                    return next;
                }
                next.unshift({ ...baseItem, createdAt: now });
                return next;
            });
            setPendingStrategyPlan({
                agentId: data.agentId,
                requestId: data.requestId,
                plan: strategyPlan,
                onApprove: approvePlan,
                onReject: rejectPlan,
            } as any);
        }, [setPendingStrategyPlan, setStrategyPlanItems, syncAgentGeneratingState]),
    });
    // Injetar respondToApproval no ref após o hook ser criado
    useEffect(() => { respondToApprovalRef.current = _respondToApproval; }, [_respondToApproval]);


    // Cleanup de refs no unmount — evita memory leak
    useEffect(() => {
        return () => {
            // syncTimeoutRef movido para useSyncStatus hook
        };
    }, []);




    const { handleRunWorkflow } = useWorkflowScheduler({
        workflowsRef, agents, modelConfigs, timezone, setWorkflows, saveField, addLog, addNotification,
    });

    // --- Orchestration Engine ---
  const { delegateTask } = useOrchestrationEngine({
    agentsRef,
    runAgentCycle: (...args: any[]) => runAgentCycleRef.current?.(...args),
    addLog,
    guidelines, // injected into every delegated task prompt automatically
  });

  const { onCycleComplete, onGitCommit, pruneOldSessions, getRecentContext } = useAutoMemory({
        ollamaHost,
        memoryEnabled: appConfig.memoryConfig?.enabled ?? false,
        modelsRef,
        addLog,
    });

  const { processToolCalls } = useToolEngine({
        ...appConfig, addLog, addNotification, handleRunWorkflow,
        runAgentCycle: (...args: any[]) => runAgentCycleRef.current?.(...args),
        delegateTask,
        onGitCommit,
        onWriteFileDryRun: async (path: string, original: string, proposed: string, agentId: string, toolCallId: string): Promise<boolean> => {
            return new Promise<boolean>((resolve) => {
                setPendingDryRun({
                    payload: { path, originalContent: original, proposedContent: proposed, agentId, toolCallId },
                    resolve,
                });
            });
        },
    });

    // Workflow scheduler movido para useWorkflowScheduler hook

    // Prune old sessions on startup — run once after config loads
    useEffect(() => {
        if (agents.length === 0) return;
        const { agents: pruned, pruned: count } = pruneOldSessions(agents);
        if (count > 0) setPersistedAgents(pruned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        startupLog('App:mount');
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadAuthState = async () => {
            startupLog('App:auth-load:start');
            setIsAuthLoading(true);
            try {
                const session = await fetchSession();
                if (cancelled) return;

                const activeSessionInfo = session?.session;
                const authenticatedSession = session?.ok && session.username && activeSessionInfo?.token ? session : null;
                const authenticated = Boolean(authenticatedSession && activeSessionInfo);
                const activeUsername = authenticatedSession?.username || '';

                if (authenticatedSession && activeSessionInfo) {
                    const activeToken = activeSessionInfo.token;
                    writeLocalStorage(AUTH_TOKEN_STORAGE_KEY, activeToken);
                    writeLocalStorage(AUTH_USERNAME_STORAGE_KEY, activeUsername);
                    setToken(activeToken);
                    setUsername(activeUsername);
                    setSessionDisplayName(authenticatedSession.user?.displayName || activeUsername);
                    setIsOfflineMode(false);
                } else {
                    removeLocalStorage(AUTH_TOKEN_STORAGE_KEY);
                    removeLocalStorage(AUTH_USERNAME_STORAGE_KEY);
                    setToken(null);
                    setUsername('');
                    setSessionDisplayName('');
                }

                try {
                    const users = await fetchUsers();
                    if (cancelled) return;
                    setExistingUsers(users);
                    startupLog('App:auth-load:users', { users: users.length });
                    startupLog('App:auth-load:end', { authenticated, username: activeUsername, users: users.length });
                } catch (usersError: any) {
                    if (cancelled) return;
                    setExistingUsers([]);
                    startupLog('App:auth-load:users-error', {
                        message: usersError?.message || 'fetchUsers failed',
                        authenticated,
                        username: activeUsername,
                    });
                    startupLog('App:auth-load:end', { authenticated, username: activeUsername, users: 0, usersError: true });
                }
            } catch (error: any) {
                if (cancelled) return;
                setExistingUsers([]);
                removeLocalStorage(AUTH_TOKEN_STORAGE_KEY);
                removeLocalStorage(AUTH_USERNAME_STORAGE_KEY);
                setToken(null);
                setUsername('');
                setSessionDisplayName('');
                startupLog('App:auth-load:end', { authenticated: false, users: 0, error: true, message: error?.message || 'auth load failed' });
            } finally {
                if (!cancelled) setIsAuthLoading(false);
            }
        };

        loadAuthState();
        return () => { cancelled = true; };
    }, []);

    const handleLogin = async (u: string) => {
        setAuthError('');
        setIsAuthLoading(true);
        try {
            const res = await loginWithUser(u);
            const nextUsername = res.username || res.user?.username || u;
            const nextDisplayName = res.user?.displayName || nextUsername;
            const nextToken = res.token;
            writeLocalStorage(AUTH_TOKEN_STORAGE_KEY, nextToken);
            writeLocalStorage(AUTH_USERNAME_STORAGE_KEY, nextUsername);
            setToken(nextToken);
            setUsername(nextUsername);
            setSessionDisplayName(nextDisplayName);
            setIsOfflineMode(false);
            try {
                const users = await fetchUsers();
                setExistingUsers(users);
                startupLog('App:login:users', { users: users.length, username: nextUsername });
            } catch (usersError: any) {
                setExistingUsers([]);
                startupLog('App:login:users-error', {
                    message: usersError?.message || 'fetchUsers failed',
                    username: nextUsername,
                });
            }
        } catch (e: any) {
            setAuthError(e.message || 'Login failed');
        } finally {
            setIsAuthLoading(false);
        }
    };

    const handleLogout = async () => {
        await logoutSession();
        setToken(null); setUsername(''); setSessionDisplayName('');
        removeLocalStorage(AUTH_TOKEN_STORAGE_KEY); removeLocalStorage(AUTH_USERNAME_STORAGE_KEY);
        removeLocalStorage(ACTIVE_AGENT_STORAGE_KEY);
        setActiveAgentId(DEFAULT_AGENT.id);
        setPersistedAgents([DEFAULT_AGENT]);
    };

    const handleSaveWorkflow = useCallback((wf: Workflow) => {
        const updated = workflows.some(w => w.id === wf.id)
            ? workflows.map(w => w.id === wf.id ? wf : w)
            : [...workflows, wf];
        setWorkflows(updated);
        saveField('workflows', updated);
    }, [workflows, setWorkflows, saveField]);

    const { handleNewSession, handleSelectSession, handleRenameSession, handleDeleteSession } = useSessionManager({
        username, agents, setPersistedAgents, setActiveAgentId, setViewMode, setIsChatVisible,
    });

    const { runAgentCycle } = useAgentCycle({
        agents,
        agentsRef,
        modelsRef,
        externalToolsRef,
        usageHistoryRef,
        scheduledMessagesRef,
        workflowsRef,
        apiKeysRef,
        externalToolsRefForPersist: externalToolsRef,
        username,
        ollamaHost,
        guidelines,
        serverChatAvailable,
        activeProjectId,
        projects,
        setAgents,
        setPersistedAgents,
        setActiveAgentId,
        setUsageHistory,
        setAgentGenerating,
        isAgentGenerating,
        isGeneratingRef,
        addLog,
        addNotification,
        getProjectContext,
        getRecentContext,
        onCycleComplete,
        processToolCalls,
        persistState,
        persistAndSync,
        setPendingPlan,
        setPendingApproval,
        setPendingStrategyPlan,
    });
    runAgentCycleRef.current = runAgentCycle;

    const handleSendMessage = (text: string, images?: string[], attachments?: Attachment[]) => {
        if (isAgentGenerating(activeAgentId)) return;
        const ctrl = new AbortController();
        runAgentCycle(activeAgentId, text, images, attachments, ctrl.signal);
    };

    const { handleApproveTool } = useToolApproval({
        pendingApproval,
        setPendingApproval,
        setIsGenerating: (value) => {
            if (!pendingApproval?.agentId) return;
            setAgentGenerating(pendingApproval.agentId, value, null, agents.find(a => a.id === pendingApproval.agentId)?.activeSessionId ?? null);
        },
        isGeneratingRef,
        processToolCalls,
        persistAndSync,
    });

    const handleDenyTool = () => {
        if (!pendingApproval) return;
        const { agentId } = pendingApproval; setPendingApproval(null);
        setPersistedAgents(agentsRef.current.map(a => a.id === agentId
            ? { ...a, history: [...a.history, { role: 'assistant' as const, content: 'User denied sensitive command execution.', timestamp: Date.now() }] }
            : a));
    };

    const { handleApprovePlan } = useExecutionPlanApproval({
        pendingPlan,
        setPendingPlan,
        setIsGenerating: (value) => {
            if (!pendingPlan?.agentId) return;
            setAgentGenerating(pendingPlan.agentId, value, null, agents.find(a => a.id === pendingPlan.agentId)?.activeSessionId ?? null);
        },
        isGeneratingRef,
        processToolCalls,
        persistAndSync,
    });

    const handleCancelPlan = () => {
        if (!pendingPlan) return;
        const { agentId } = pendingPlan;
        setPendingPlan(null);
        setPersistedAgents(agentsRef.current.map(a => a.id === agentId
            ? { ...a, history: [...a.history, { role: 'assistant' as const, content: 'Execution plan cancelled by user.', timestamp: Date.now() }] }
            : a));
    };

    // execCommand para o scanProject — usa SSH via SystemService
    const execCommandForScan = async (cmd: string): Promise<string> => {
        try {
            const result = await fetch(`${LOCAL_BASE}/api/system/exec`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd }),
            });
            if (!result.ok) return '';
            const data = await result.json();
            return (data.output ?? '').trim();
        } catch { return ''; }
    };

    // callLLM para o scanProject — usa o modelo do Master
    const callLLMForScan = async (prompt: string): Promise<string> => {
        const master = agentsRef.current.find(a => a.isMaster) ?? agentsRef.current[0];
        const modelConfig = modelsRef.current.find(m => m.modelId === master?.model || m.id === master?.model) ?? modelsRef.current[0];
        if (!modelConfig) throw new Error('No model configured');
        const result = await (await import('./services/llmProvider')).executeChatRequest(
            [{ role: 'user', content: prompt, timestamp: Date.now() }],
            modelConfig,
            modelsRef.current,
            () => {},
            addLog
        );
        return result.content;
    };

    const handleCreateUser = async ({ username: newUsername, displayName }: { username: string; displayName?: string }) => {
        setAuthError('');
        setIsAuthLoading(true);
        try {
            await createUserOnServer({ username: newUsername, displayName });
            await handleLogin(newUsername);
        } catch (e: any) {
            setAuthError(e.message || 'Create user failed');
            setIsAuthLoading(false);
        }
    };

    const handleSwitchUser = async (nextUsername: string) => {
        if (!nextUsername || nextUsername === username) return;
        await handleLogin(nextUsername);
    };

    const handleDeleteUser = async (userId: string) => {
        await deleteUserOnServer(userId);
        const users = await fetchUsers();
        setExistingUsers(users);
    };

    const handleOpenSettings = useCallback(() => {
        setAuthError('');
        setSettingsRefreshError('');
        setPendingSettingsOpen(true);
        setIsRefreshingSettings(true);
    }, []);

    useEffect(() => {
        if (!pendingSettingsOpen) return;

        let isCancelled = false;
        const timeoutId = window.setTimeout(() => {
            if (isCancelled) return;
            setIsRefreshingSettings(false);
            setPendingSettingsOpen(false);
            setSettingsRefreshError('Unable to open settings: Settings refresh timed out after 8 seconds.');
        }, 8000);

        reloadConfig()
            .then(() => {
                if (isCancelled) return;
                window.clearTimeout(timeoutId);
                setIsRefreshingSettings(false);
                setPendingSettingsOpen(false);
                setSettingsRefreshError('');
                setShowSettings(true);
            })
            .catch((error) => {
                if (isCancelled) return;
                window.clearTimeout(timeoutId);
                setIsRefreshingSettings(false);
                setPendingSettingsOpen(false);
                const message = error instanceof Error && error.message
                    ? `Unable to open settings: ${error.message}`
                    : 'Unable to open settings.';
                setSettingsRefreshError(message);
            });

        return () => {
            isCancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [pendingSettingsOpen, reloadConfig, setShowSettings]);

    if (isAuthLoading || (isLoading && !token)) {
        startupLog('App:branch', { branch: 'boot', stage: 'auth-loading' });
        return <BootScreen />;
    }
    if (!token) {
        startupLog('App:branch', { branch: 'auth', users: existingUsers.length, hasError: !!authError });
        return <Auth onLogin={(u) => { void handleLogin(u); }} onCreateUser={handleCreateUser} users={existingUsers} error={authError} loading={isAuthLoading} />;
    }
    if (isLoading && !isRefreshingSettings) {
        startupLog('App:branch', { branch: 'boot', stage: 'config-loading' });
        return <BootScreen />;
    }

    const activeAgent = agents.find(a => a.id === activeAgentId) || agents[0] || null;
    const hasActiveAgent = !!activeAgent;

    startupLog('App:active-agent', {
        requestedId: activeAgentId,
        resolvedId: activeAgent?.id || '',
        resolvedName: activeAgent?.name || '',
        totalAgents: agents.length,
        hasActiveAgent,
    });
    startupLog('App:branch', { branch: 'app', viewMode, hasActiveAgent });
    startupLog('AppRouter:render:attempt', {
        viewMode,
        activeAgentId: activeAgent?.id || '',
        hasActiveAgent,
    });

    return (
      <Layout
        users={existingUsers}
        onSwitchUser={(nextUsername) => { void handleSwitchUser(nextUsername); }}
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={setActiveAgentId}
        onAddAgent={() => { setEditingAgent(undefined); setShowAgentManager(true); }}
        onEditAgent={(agent) => { setEditingAgent(agent); setShowAgentManager(true); }}
        onLogout={handleLogout}
        onOpenSettings={handleOpenSettings}
        onOpenScheduler={() => setShowScheduler(true)}
        onOpenAutomation={() => setViewMode('automation')}
        onOpenCommands={() => setViewMode('commands')}
        onOpenDashboard={() => setViewMode('dashboard')}
        runningAgents={runningAgents}
        isSidebarOpen={isSidebarOpen}
        toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        username={username}
        theme={theme}
        colorTheme={colorTheme}
        onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        showConsole={showConsole}
        toggleConsole={() => setShowConsole(!showConsole)}
        logs={logs}
        clearLogs={clearLogs}
        showTerminal={showTerminal}
        toggleTerminal={() => setShowTerminal(!showTerminal)}
        notifications={notifications}
        onDismissNotification={dismissNotification}
        onMarkAsRead={markNotificationAsRead}
        onMarkAllRead={markAllNotificationsRead}
        onClearNotifications={clearNotifications}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        isSessionPanelOpen={isSessionPanelOpen}
        toggleSessionPanel={() => setIsSessionPanelOpen(p => !p)}
        currentView={viewMode}
        onSetView={(view) => setViewMode(view as any)}
        onOpenMemory={() => setViewMode('memory')}
        isProjectPanelOpen={isProjectPanelOpen}
        toggleProjectPanel={() => setIsProjectPanelOpen(p => !p)}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={selectProject}
        onAddProject={addProject}
              onEditProject={editProject}
              onDeleteProject={deleteProject}
              onScanProject={(id: string) => scanProject(id, callLLMForScan, execCommandForScan)}
              scanLoading={scanLoading}
              scanDraft={scanDraft}
              onApproveContext={(ctx: import('./types').ProjectContext) => activeProjectId && approveContext(activeProjectId, ctx)}
              onDismissDraft={dismissDraft}
        isOrchestrationPanelOpen={isOrchestrationPanelOpen}
        toggleOrchestrationPanel={() => setIsOrchestrationPanelOpen(p => !p)}
        isChatVisible={isChatVisible}
        onToggleChat={() => setIsChatVisible(v => !v)}
        syncStatus={syncStatus}
        onNavigateToChat={() => { setViewMode('chat'); setIsChatVisible(true); }}
      >
        {settingsRefreshError && (
          <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {settingsRefreshError}
          </div>
        )}
        {/* Chat panel — always mounted, slides in/out like other panels */}
        {hasActiveAgent ? (
        <AppRouter
          viewMode={viewMode}
          isChatVisible={isChatVisible}
          activeAgent={activeAgent}
          activeAgentId={activeAgentId}
          agents={agents}
          editingWorkflowId={editingWorkflowId}
          workflows={workflows}
          modelConfigs={modelConfigs}
          externalTools={externalTools}
          usageHistory={usageHistory}
            ollamaHost={ollamaHost}
          username={username}
          timezone={timezone}
          saveField={saveField}
          setWorkflows={setWorkflows}
          setEditingWorkflowId={setEditingWorkflowId}
          setIsChatVisible={setIsChatVisible}
          setPersistedAgents={setPersistedAgents}
          setShowAgentManager={setShowAgentManager}
          setEditingAgent={setEditingAgent}
          handleSendMessage={handleSendMessage}
          handleRunWorkflow={handleRunWorkflow}
          handleSaveWorkflow={handleSaveWorkflow}
          onApproveTool={handleApproveTool}
          onDenyTool={handleDenyTool}
          onStop={() => { const activeAgent = agents.find(a => a.id === activeAgentId); const sessionId = activeAgent?.activeSessionId; if (sessionId) handleStop(activeAgentId, sessionId); }}
          syncStatus={syncStatus}
          isGenerating={!!runStateByAgent[activeAgentId]?.isGenerating}
          pendingApproval={pendingApproval}
          strategyPlanItems={strategyPlanItems}
          pendingStrategyPlan={pendingStrategyPlan}
          onMarkStrategyPlanCompleted={(planId: string) => {
            const targetId = String(planId || '').trim();
            if (!targetId) return;
            const updatedAt = new Date().toISOString();
            setStrategyPlanItems((prev: any[]) => (Array.isArray(prev)
              ? prev.map((item: any) => String(item?.id || '').trim() === targetId
                ? { ...item, status: 'completed', updatedAt }
                : item)
              : prev));
          }}
          sessionNoteRemoteRefreshKey={sessionNoteRemoteRefreshKey}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={selectProject}
          onAddProject={addProject}
          onEditProject={editProject}
          onDeleteProject={deleteProject}
          onScanProject={(id: string) => scanProject(id, callLLMForScan, execCommandForScan)}
          scanLoading={scanLoading}
          scanDraft={scanDraft}
          onApproveContext={(ctx: import('./types').ProjectContext) => activeProjectId && approveContext(activeProjectId, ctx)}
          onDismissDraft={dismissDraft}
        />
        ) : (
          <div className="flex h-full items-center justify-center bg-white text-sm text-slate-500 dark:bg-dark-950 dark:text-slate-400">
            No agents available.
          </div>
        )}

        {pendingDryRun && (
            <DryRunModal
                payload={pendingDryRun.payload}
                agentName={agents.find(a => a.id === pendingDryRun.payload.agentId)?.name ?? 'Agent'}
                onConfirm={() => { pendingDryRun.resolve(true); setPendingDryRun(null); }}
                onCancel={() => { pendingDryRun.resolve(false); setPendingDryRun(null); }}
            />
        )}

        {pendingPlan && (
            <ExecutionPlanModal
                toolCalls={pendingPlan.toolCalls}
                agentName={agents.find(a => a.id === pendingPlan.agentId)?.name ?? 'Agent'}
                onApprove={handleApprovePlan}
                onCancel={handleCancelPlan}
            />
        )}
        {showAgentManager && <AgentManager agent={editingAgent} models={modelConfigs} username={username} onSave={async (agent) => { if (editingAgent) await updateAgentOnServer(username, agent.id, agent); else await createAgentOnServer(username, agent); const freshAgents = (await fetchAgents(username)) || []; setPersistedAgents(freshAgents); await appConfig.saveAgents(freshAgents); setShowAgentManager(false); }} onCancel={() => setShowAgentManager(false)} onDelete={async (id) => { await deleteAgentOnServer(username, id); const freshAgents = (await fetchAgents(username)) || []; setPersistedAgents(freshAgents); await appConfig.saveAgents(freshAgents); setActiveAgentId((current: string) => freshAgents.some((a: any) => a.id === current) ? current : (freshAgents[0]?.id || '')); setShowAgentManager(false); }} canDelete={agents.length > 1} />}
        {showSettings && <SettingsModal username={username} users={existingUsers} onCreateUser={handleCreateUser} onSwitchUser={(nextUsername) => { void handleSwitchUser(nextUsername); }} onDeleteUser={(userId) => handleDeleteUser(userId)} currentHost={ollamaHost} models={modelConfigs} guidelines={guidelines} usageHistory={usageHistory} colorTheme={colorTheme} apiKeys={apiKeys} memoryConfig={memoryConfig} summaryConfig={summaryConfig} agents={agents} timezone={timezone} displayName={persistedDisplayName || sessionDisplayName}
          onSaveHost={(v) => { setOllamaHost(v); saveField('ollamaHost', v); }}
          onSaveModels={(v) => { setModelConfigs(v); saveField('modelConfigs', v); }}
          onSaveGuidelines={(v) => { setGuidelines(v); saveField('guidelines', v); }}
          onSaveColorTheme={(v) => { setColorTheme(v); saveField('colorTheme', v); }}
          onSaveApiKeys={(v) => { setApiKeys(v); saveField('apiKeys', v); }}
          onSaveMemoryConfig={(v) => { setMemoryConfig(v); saveField('memoryConfig', v); }}
          onSaveSummaryConfig={(v) => { setSummaryConfig(v); saveField('summaryConfig', v); }}
          onSaveTimezone={(v: string) => { setTimezone(v); saveField('timezone', v); }}
          onSaveDisplayName={(v: string) => { setDisplayName(v); saveField('profile', { displayName: v }); }}
          onClose={() => setShowSettings(false)} />}
        {showScheduler && <SchedulerModal agents={agents} scheduledMessages={scheduledMessages} onSchedule={(agentId: string, content: string, date: Date) => setScheduledMessages([...scheduledMessages, { id: generateId(), agentId, content, scheduledAt: date.getTime(), createdAt: Date.now(), createdBy: 'user', status: 'pending' }])} onDelete={(id: string) => setScheduledMessages(scheduledMessages.filter(m => m.id !== id))} onClose={() => setShowScheduler(false)} />}
      </Layout>
    );
};


export default App;
