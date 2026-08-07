// =============================================================================
// useAgentCycle.ts — ciclo principal do agente extraído do App.tsx
// =============================================================================

import { MutableRefObject } from 'react';
import { Agent, Attachment, Message, ToolCall, ModelConfig, ExternalTool } from '../types';
import * as LLMProvider from '../services/llmProvider';
import * as ServerChat from '../services/serverChatService';
import { truncateHistoryToTokenLimit } from '../utils/tokenUtils';
import { SYSTEM_TOOLS, buildToolWeightInstructions } from '../utils/toolDefinitions';
import { generateId } from '../utils/helpers';
import { SYSTEM_AGENT_ID } from '../constants';

const LOCAL_BASE = window.location.pathname.split('/').slice(0, 2).join('/') || '';

interface UseAgentCycleOptions {
  agents: Agent[];
  agentsRef: MutableRefObject<Agent[]>;
  modelsRef: MutableRefObject<ModelConfig[]>;
  externalToolsRef: MutableRefObject<ExternalTool[]>;
  usageHistoryRef: MutableRefObject<any[]>;
  scheduledMessagesRef: MutableRefObject<any[]>;
  workflowsRef: MutableRefObject<any[]>;
  apiKeysRef: MutableRefObject<any[]>;
  externalToolsRefForPersist: MutableRefObject<ExternalTool[]>;
  username: string;
  ollamaHost: string;
  guidelines: string;
  serverChatAvailable: boolean;
  activeProjectId: string | null;
  projects: any[];
  setAgents: (agents: Agent[] | ((prev: Agent[]) => Agent[])) => void;
  setPersistedAgents: (agents: Agent[] | ((prev: Agent[]) => Agent[])) => void;
  setActiveAgentId: (id: string) => void;
  setUsageHistory: (v: any[]) => void;
  setAgentGenerating: (agentId: string, isGenerating: boolean, abortController?: AbortController | null, sessionId?: string | null) => void;
  isAgentGenerating: (agentId: string) => boolean;
  isGeneratingRef: MutableRefObject<boolean>;
  addLog: (entry: any) => void;
  addNotification: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  getProjectContext: () => string;
  getRecentContext: (agent: Agent) => string;
  onCycleComplete: (agent: Agent) => void;
  processToolCalls: (agentId: string, toolCalls: ToolCall[], signal?: AbortSignal, externalHistory?: Message[]) => Promise<void>;
  persistState: (...args: any[]) => Promise<void>;
  persistAndSync: () => Promise<void>;
  setPendingPlan: (v: any) => void;
  setPendingApproval: (v: any) => void;
  setPendingStrategyPlan: (v: any) => void;
}

function requiresApproval(toolName: string, args: any): boolean {
  if (toolName === 'run_terminal_command') {
    const cmd = args?.command || '';
    return /\bsudo\b/i.test(cmd);
  }
  return false;
}

export const useAgentCycle = (opts: UseAgentCycleOptions) => {
  const recordUsage = (modelId: string, tokens: number, agentId?: string, audioSeconds = 0, promptTokens = 0, completionTokens = 0, sessionId?: string, requests = 1) => {
    const now = Date.now();
    const newRecord = { id: generateId(), timestamp: now, modelId, tokens, promptTokens, completionTokens, audioSeconds, agentId };
    const updatedHistory = [...opts.usageHistoryRef.current.filter((r: any) => r.timestamp > now - 86400000), newRecord];
    opts.setUsageHistory(updatedHistory);
    opts.usageHistoryRef.current = updatedHistory;
    opts.persistState(
      opts.agentsRef.current,
      opts.scheduledMessagesRef.current,
      opts.workflowsRef.current,
      opts.ollamaHost,
      opts.modelsRef.current,
      opts.guidelines,
      'light',
      'amber',
      updatedHistory,
      undefined,
      opts.externalToolsRefForPersist.current,
      opts.apiKeysRef.current
    );
    // Persist to SQLite via backend API (fire-and-forget)
    fetch(`${LOCAL_BASE}/api/usage/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: agentId || 'unknown',
        model: modelId,
        promptTokens,
        completionTokens,
        totalTokens: tokens,
        cost: 0,
        timestamp: now,
        sessionId,
        requests,
      }),
    }).catch(() => { /* silent — usage persistence is best-effort */ });
  };

  const runAgentCycle = async (
    agentId: string,
    userMessage: string | null,
    images?: string[],
    attachments?: Attachment[],
    signal?: AbortSignal,
    silent = false,
    _ephemeralHistory?: Message[]
  ): Promise<string | undefined> => {
    if (!silent && opts.isAgentGenerating(agentId)) return undefined;
    let currentAgents = [...opts.agentsRef.current];
    let activeAgentIndex = currentAgents.findIndex(a => a.id === agentId);
    if (!silent) {
      const initialSessionId = currentAgents[activeAgentIndex]?.activeSessionId ?? null;
      opts.setAgentGenerating(agentId, true, null, initialSessionId);
      opts.isGeneratingRef.current = true;
    }
    if (activeAgentIndex === -1) {
      if (!silent) opts.setAgentGenerating(agentId, false, null);
      return undefined;
    }

    const resolvedUsername = String(opts.username || '').trim();
    if (!resolvedUsername) {
      opts.addLog({
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: 'error',
        method: 'AGENT_CYCLE',
        content: 'Blocked chat request because username is not resolved yet.',
      });
      if (!silent) {
        opts.addNotification('Auth not ready', 'User identity is still loading. Try again in a moment.', 'warning');
        opts.setAgentGenerating(agentId, false, null);
        opts.isGeneratingRef.current = false;
      }
      return undefined;
    }

    let targetAgentId = agentId;

    const isEphemeral = silent;
    const ephemeralHistory: Message[] = _ephemeralHistory ?? [];
    const serializeAttachmentsForPrompt = (items?: Attachment[]): string => {
      if (!items?.length) return '';
      const rendered = items.map((item, index) => {
        const name = item?.name || `attachment-${index + 1}`;
        const body = typeof item?.content === 'string' ? item.content.trim() : '';
        if (body) {
          return `Attachment ${index + 1}: ${name}\n${body}`;
        }
        return `Attachment ${index + 1}: ${name}`;
      }).join('\n\n');
      return rendered ? `\n\n[ATTACHMENTS]\n${rendered}\n[/ATTACHMENTS]` : '';
    };
    const userMessageContent = `${userMessage || ''}${serializeAttachmentsForPrompt(attachments)}`;
    const hasUserPayload = !!(userMessageContent || images?.length || attachments?.length);

    if (hasUserPayload) {
      if (isEphemeral) {
        ephemeralHistory.push({ role: 'user', content: userMessageContent, timestamp: Date.now(), images, attachments } as any);
      } else {
        currentAgents[activeAgentIndex].history.push({ role: 'user', content: userMessageContent, timestamp: Date.now(), images, attachments } as any);
      }
      if (!silent) opts.setActiveAgentId(targetAgentId);
    }

    if (!isEphemeral) {
      opts.setPersistedAgents([...currentAgents]);
      opts.agentsRef.current = currentAgents;
    }

    const agent = currentAgents[activeAgentIndex];
    const modelConfig = opts.modelsRef.current.find(m => m.modelId === agent.model || m.id === agent.model);
    if (!modelConfig) {
      const errMsg = agent.isMaster
        ? `[SYSTEM ERROR]: No model configured. Add a model in Settings.`
        : `[SYSTEM ERROR]: Agent \"${agent.name}\" has no model configured. Edit the agent in Agent Manager to assign a model.`;
      opts.addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'error', method: 'AGENT_CYCLE', content: errMsg });
      if (!silent) {
        opts.addNotification('No Model', `Agent \"${agent.name}\" needs a model configured.`, 'error');
        opts.setAgentGenerating(agentId, false, null);
        opts.isGeneratingRef.current = false;
      }
      currentAgents[activeAgentIndex].history.push({ role: 'assistant' as const, content: errMsg, timestamp: Date.now() });
      opts.setPersistedAgents([...currentAgents]);
      return undefined;
    }

    const allTools = [...SYSTEM_TOOLS, ...opts.externalToolsRef.current.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))];
    const tools = agent.allowedTools && agent.allowedTools.length > 0
      ? allTools.filter(t => agent.allowedTools!.includes((t as any).function.name))
      : allTools;

    if (isEphemeral) {
      ephemeralHistory.push({ role: 'assistant', content: '', timestamp: Date.now() } as any);
    } else {
      currentAgents[activeAgentIndex].history.push({ role: 'assistant', content: '', timestamp: Date.now() } as any);
      opts.setPersistedAgents([...currentAgents]);
    }

    try {
      const normalizedSystemAgentId = SYSTEM_AGENT_ID.toLowerCase();
      const isMasterAgent = agent.isMaster || agent.id === SYSTEM_AGENT_ID || agent.name.toLowerCase() === normalizedSystemAgentId;
      const guidelinesBlock = (opts.guidelines && (isMasterAgent || !isEphemeral))
        ? `\n\n[OPERATIONAL GUIDELINES]:\n${opts.guidelines}\n[END GUIDELINES]`
        : '';
      const weightInstructions = buildToolWeightInstructions(agent.allowedTools ?? []);
      const fullSystemPrompt = agent.systemPrompt + guidelinesBlock + (agent.summary ? `\n\n[LONG TERM CONTEXT]: ${agent.summary}` : '') + opts.getProjectContext() + opts.getRecentContext(agent) + weightInstructions;
      const historyMessages = isEphemeral ? ephemeralHistory : agent.history.slice(0, -1);
      let effectiveHistory = historyMessages;

      const DEFAULT_RESERVED = 7000;
      const modelContextWindow = modelConfig.contextWindow ?? 16000;
      const modelReserved = modelConfig.reservedOverhead ?? DEFAULT_RESERVED;
      const tokenLimit = agent.maxTokensPerPayload && agent.maxTokensPerPayload > 0
        ? agent.maxTokensPerPayload
        : modelConfig.maxTokensPerSession && modelConfig.maxTokensPerSession > 0
          ? modelConfig.maxTokensPerSession
          : modelContextWindow - modelReserved;

      if (tokenLimit > 0) {
        const { truncated, removedCount, totalTokens } = truncateHistoryToTokenLimit(historyMessages, tokenLimit, fullSystemPrompt);
        if (removedCount > 0) {
          opts.addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'warning', method: 'TOKEN_TRUNCATION', content: `Truncated ${removedCount} messages. ~${totalTokens} tokens. Limit: ${tokenLimit}.` });
          opts.addNotification('Token Limit', `Removed ${removedCount} old messages to fit context window.`, 'warning');
        }
        effectiveHistory = truncated;
      }

      const isSystemAgent = agent.id === SYSTEM_AGENT_ID || agent.name.toLowerCase() === normalizedSystemAgentId;
      const sessionSeed: Message[] = [];
      if (!silent && isSystemAgent && effectiveHistory.length === 0) {
        const allToolNames = SYSTEM_TOOLS.map((t: any) => t.function.name);
        const agentRoster = opts.agentsRef.current.map((a: any) => {
          const t = a.allowedTools && a.allowedTools.length > 0 ? a.allowedTools : allToolNames;
          return `  - ${a.name} (id: ${a.id}, model: ${a.model || 'default'}): ${[
            t.includes('run_terminal_command') && 'execute_commands',
            (t.includes('write_file') || t.includes('replace_in_file')) && 'edit_files',
            t.includes('git_commit') && 'git_operations',
            t.includes('delegate_task') && 'delegate_tasks',
            t.includes('remember_fact') && 'memory',
          ].filter(Boolean).join(', ') || 'no specific capabilities'}`;
        }).filter((line: string) => !line.includes(agent.id)).join('\n');
        if (agentRoster) {
          sessionSeed.push({ role: 'assistant' as const, content: `Session initialized.\n\n[AVAILABLE AGENTS]\n${agentRoster}\n[END AGENTS]\n\nReady.`, timestamp: Date.now() - 1 });
        }
      }

      const messages: Message[] = opts.serverChatAvailable
        ? [
            { role: 'system' as const, content: fullSystemPrompt, timestamp: Date.now() },
            ...sessionSeed,
            { role: 'user' as const, content: userMessageContent, timestamp: Date.now(), images, attachments },
          ].filter((m): m is Message => m.role !== 'user' || !!(m.content || (m as any).images?.length || (m as any).attachments?.length))
        : [
            { role: 'system' as const, content: fullSystemPrompt, timestamp: Date.now() },
            ...sessionSeed,
            ...effectiveHistory,
          ];

      let pendingChunk = '';
      let chunkTimer: ReturnType<typeof setTimeout> | null = null;
      const flushChunk = () => {
        if (!pendingChunk) return;
        const toFlush = pendingChunk;
        pendingChunk = '';
        if (isEphemeral) {
          const last = ephemeralHistory[ephemeralHistory.length - 1];
          if (last && last.role === 'assistant') last.content += toFlush;
        } else {
          opts.setAgents(prev => {
            const idx = prev.findIndex(a => a.id === targetAgentId);
            if (idx === -1) return prev;
            const next = [...prev];
            const agentCopy = { ...next[idx] };
            const history = [...agentCopy.history];
            const last = { ...history[history.length - 1] };
            last.content += toFlush;
            history[history.length - 1] = last;
            agentCopy.history = history;
            next[idx] = agentCopy;
            opts.agentsRef.current = next;
            return next;
          });
        }
      };

      const activeSessionId = agent.activeSessionId || `session-${targetAgentId}-default`;
      const newMessage: Message = {
        role: 'user',
        content: userMessageContent,
        timestamp: Date.now(),
        ...(images?.length ? { images } : {}),
        ...(attachments?.length ? { attachments } : {}),
      } as any;

      console.log(`[useAgentCycle] SUBMIT | agentId=${targetAgentId} | sessionId=${activeSessionId} | serverChat=${opts.serverChatAvailable ? '1' : '0'} | contentLength=${userMessageContent.length} | images=${Array.isArray((newMessage as any).images) ? (newMessage as any).images.length : 0} | attachments=${Array.isArray((newMessage as any).attachments) ? (newMessage as any).attachments.length : 0}`);

      const result = opts.serverChatAvailable
        ? await ServerChat.executeChatRequest({
            username: resolvedUsername,
            agentId: targetAgentId,
            sessionId: activeSessionId,
            newMessage,
            model: agent.model,
            signal,
            onLog: opts.addLog,
            projectPath: opts.projects.find((p: any) => p.id === opts.activeProjectId)?.path,
            onEvent: (event, data) => {
              if (isEphemeral) return;
              // assistant_message is handled by onChunk -> flushChunk. Do NOT duplicate the assistant entry here.
              if (event === 'tool_call') {
                opts.setAgents(prev => {
                  const idx = prev.findIndex(a => a.id === targetAgentId);
                  if (idx === -1) return prev;
                  const next = [...prev];
                  const agentCopy = { ...next[idx] };
                  const hist = [...agentCopy.history];
                  const last = hist[hist.length - 1];
                  const toolCallMsg = { role: 'assistant' as const, content: '', tool_calls: [{ id: data.tool_call_id, type: 'function' as const, function: { name: data.toolName, arguments: JSON.stringify(data.args || {}) } }], timestamp: Date.now() };
                  if (last?.role === 'assistant' && !last.content && !(last as any).tool_calls?.length) hist[hist.length - 1] = toolCallMsg as any;
                  else hist.push(toolCallMsg as any);
                  agentCopy.history = hist;
                  next[idx] = agentCopy;
                  opts.agentsRef.current = next;
                  return next;
                });
              } else if (event === 'session_updated') {
                if (data?.agentId !== targetAgentId) return;
                const eventSessionId = typeof data?.sessionId === 'string' ? data.sessionId : activeSessionId;
                if (!eventSessionId || eventSessionId !== activeSessionId) return;
                fetch(`${LOCAL_BASE}/api/sessions/${encodeURIComponent(eventSessionId)}?username=${encodeURIComponent(resolvedUsername)}`)
                  .then(res => res.ok ? res.json() : null)
                  .then(payload => {
                    const freshSession = payload?.session;
                    if (!freshSession?.messages) return;
                    opts.setAgents(prev => {
                      const idx = prev.findIndex(a => a.id === targetAgentId);
                      if (idx === -1) return prev;
                      const next = [...prev];
                      const agentCopy = { ...next[idx] };
                      if (agentCopy.activeSessionId !== eventSessionId) return prev;
                      agentCopy.history = freshSession.messages;
                      next[idx] = agentCopy;
                      opts.agentsRef.current = next;
                      return next;
                    });
                  })
                  .catch(() => {});
              } else if (event === 'memory_metrics') {
                opts.addLog({
                  id: `${Date.now()}-memory-metrics`,
                  timestamp: Date.now(),
                  type: 'info',
                  method: 'MEMORY_METRICS',
                  model: targetAgentId,
                  content: data,
                });
              } else if (event === 'memory_injection') {
                opts.addLog({
                  id: `${Date.now()}-memory-injection`,
                  timestamp: Date.now(),
                  type: 'info',
                  method: 'MEMORY_INJECTION',
                  model: targetAgentId,
                  content: data,
                });
              } else if (event === 'tool_result') {
                opts.setAgents(prev => {
                  const idx = prev.findIndex(a => a.id === targetAgentId);
                  if (idx === -1) return prev;
                  const next = [...prev];
                  const agentCopy = { ...next[idx] };
                  const hist = [...agentCopy.history];
                  hist.push({ role: 'tool' as const, tool_call_id: data.tool_call_id, content: JSON.stringify(data.output), timestamp: Date.now() } as any);
                  hist.push({ role: 'assistant' as const, content: '', timestamp: Date.now() } as any);
                  agentCopy.history = hist;
                  next[idx] = agentCopy;
                  opts.agentsRef.current = next;
                  return next;
                });
              }
            },
            onChunk: (chunk) => {
              pendingChunk += chunk;
              if (!chunkTimer) chunkTimer = setTimeout(() => { chunkTimer = null; flushChunk(); }, 50);
            },
          })
        : await LLMProvider.executeChatRequest(
            messages,
            modelConfig,
            opts.modelsRef.current,
            (chunk) => {
              pendingChunk += chunk;
              if (!chunkTimer) chunkTimer = setTimeout(() => { chunkTimer = null; flushChunk(); }, 50);
            },
            opts.addLog,
            tools,
            signal
          );

      if (chunkTimer) { clearTimeout(chunkTimer); chunkTimer = null; }
      flushChunk();

      if ((result as any).usage) {
        recordUsage(modelConfig.modelId, (result as any).usage.total_tokens, targetAgentId, 0, (result as any).usage.prompt_tokens, (result as any).usage.completion_tokens, activeSessionId, (result as any).iterations ?? 1);
      }

      if (isEphemeral) {
        const lastEph = ephemeralHistory[ephemeralHistory.length - 1];
        if (lastEph && lastEph.role === 'assistant') {
          lastEph.content = (result as any).content;
          (lastEph as any).tool_calls = (result as any).tool_calls;
          if ((result as any).reasoningTokens !== undefined) (lastEph as any).reasoningTokens = (result as any).reasoningTokens;
        }
        if ((result as any).tool_calls && (result as any).tool_calls.length > 0) {
          await opts.processToolCalls(targetAgentId, (result as any).tool_calls, signal, ephemeralHistory);
          if (!signal?.aborted) {
            return await runAgentCycle(targetAgentId, null, undefined, undefined, signal, silent, ephemeralHistory);
          }
        }
        return (result as any).content;
      }

      const finalAgents = [...opts.agentsRef.current];
      const finalIdx = finalAgents.findIndex(a => a.id === targetAgentId);
      if (finalIdx !== -1) {
        if (opts.serverChatAvailable) {
          try {
            const finalSessionId = finalAgents[finalIdx].activeSessionId;
            if (finalSessionId) {
              const sessRes = await fetch(`${LOCAL_BASE}/api/sessions/${encodeURIComponent(finalSessionId)}?username=${encodeURIComponent(resolvedUsername)}`);
              if (sessRes.ok) {
                const { session: freshSession } = await sessRes.json();
                if (freshSession?.messages && finalAgents[finalIdx].activeSessionId === finalSessionId) {
                  finalAgents[finalIdx].history = freshSession.messages;
                  if ((result as any).reasoningTokens !== undefined) {
                    const lastMsg = finalAgents[finalIdx].history[finalAgents[finalIdx].history.length - 1];
                    if (lastMsg?.role === 'assistant' && (lastMsg as any).reasoningTokens === undefined) {
                      (lastMsg as any).reasoningTokens = (result as any).reasoningTokens;
                    }
                  }
                }
              }
            }
          } catch {}
        } else {
          const finalHistory = finalAgents[finalIdx].history ?? [];
          const lastMsg = finalHistory[finalHistory.length - 1];
          if (lastMsg) {
            lastMsg.content = (result as any).content;
            (lastMsg as any).tool_calls = (result as any).tool_calls;
            if ((result as any).reasoningTokens !== undefined) (lastMsg as any).reasoningTokens = (result as any).reasoningTokens;
          }
        }
        opts.setPersistedAgents(finalAgents);
        opts.agentsRef.current = finalAgents;

        if ((result as any).tool_calls && (result as any).tool_calls.length > 0) {
          const sensitiveCalls = (result as any).tool_calls.filter((tc: ToolCall) => requiresApproval(tc.function.name, JSON.parse(tc.function.arguments || '{}')));
          if (sensitiveCalls.length > 0 && !silent) {
            opts.setPendingApproval({ agentId: targetAgentId, toolCalls: (result as any).tool_calls, sensitiveCalls } as any);
            opts.setAgentGenerating(agentId, false, null);
            return (result as any).content;
          }
          if (!silent && (result as any).tool_calls.length >= 2) {
            opts.setPendingPlan({ agentId: targetAgentId, toolCalls: (result as any).tool_calls, signal } as any);
            opts.setAgentGenerating(agentId, false, null);
            opts.isGeneratingRef.current = false;
            return (result as any).content;
          }
          await opts.processToolCalls(targetAgentId, (result as any).tool_calls, signal);
          if (!signal?.aborted) {
            if (!silent) await opts.persistAndSync();
            const freshAgents = [...opts.agentsRef.current];
            const freshIdx = freshAgents.findIndex(a => a.id === targetAgentId);
            const freshHistory = freshIdx >= 0 ? (freshAgents[freshIdx].history ?? []) : [];
            if (freshHistory[freshHistory.length - 1]?.role === 'tool') {
              return await runAgentCycle(targetAgentId, null, undefined, undefined, signal, silent);
            }
          }
        } else {
          if (!silent) {
            opts.setAgentGenerating(agentId, false, null);
            opts.isGeneratingRef.current = false;
            await opts.persistAndSync();
            const finishedAgent = opts.agentsRef.current.find(a => a.id === targetAgentId);
            if (finishedAgent) opts.onCycleComplete(finishedAgent);
          }
        }
        return (result as any).content;
      }
      return (result as any).content;
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Agent Cycle Error', e);
        opts.addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'error', method: 'AGENT_CYCLE', content: e.message });
        const errAgents = [...opts.agentsRef.current];
        const errIdx = errAgents.findIndex(a => a.id === targetAgentId);
        if (errIdx !== -1) {
          errAgents[errIdx].history.push({ role: 'assistant' as const, content: `[SYSTEM ERROR]: ${e.message}`, timestamp: Date.now() });
          opts.setPersistedAgents(errAgents);
        }
      }
      if (!silent) opts.setAgentGenerating(agentId, false, null);
      return undefined;
    }
  };

  return { runAgentCycle };
};
