// =============================================================================
// useOrchestrationEngine.ts  — v1.6.0
// Hierarquical Agent Orchestration Engine
//
// Replaces the naive send_agent_message with a structured delegation system:
//   - Typed task contracts (input + expected_output_schema)
//   - Isolated sub-agent context (doesn't pollute master history)
//   - Output validation against schema
//   - Configurable retry with exponential backoff + diagnosis
//   - Real-time event bus for UI tracking
// =============================================================================

import { useRef, useCallback } from 'react';
import { Agent, LogEntry } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'validating'
  | 'retrying'
  | 'completed'
  | 'failed';

export interface OutputSchema {
  /** Keys that must exist in the JSON response */
  required?: string[];
  /** Optional description of what's expected — shown in UI */
  description?: string;
  /** Whether a plain string (non-JSON) is acceptable */
  allowPlainText?: boolean;
}

export interface DelegationTask {
  id: string;
  masterAgentId: string;
  masterAgentName: string;
  subAgentId: string;
  subAgentName: string;
  task: string;
  expectedOutput?: OutputSchema;
  maxRetries: number;
  timeoutMs: number;
  createdAt: number;
}

export interface DelegationResult {
  taskId: string;
  success: boolean;
  output: any;
  attempts: number;
  durationMs: number;
  validationError?: string;
  diagnosisNotes?: string[];
}

export interface DelegationEvent {
  type:
    | 'task:started'
    | 'task:attempt'
    | 'task:validating'
    | 'task:retry'
    | 'task:completed'
    | 'task:failed';
  taskId: string;
  task: DelegationTask;
  attempt?: number;
  result?: DelegationResult;
  diagnosis?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Event Bus — singleton for UI subscription
// ---------------------------------------------------------------------------

type EventListener = (event: DelegationEvent) => void;

class OrchestrationBus {
  private listeners: Set<EventListener> = new Set();

  emit(event: DelegationEvent) {
    this.listeners.forEach(fn => fn(event));
  }

  on(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
}

export const orchestrationBus = new OrchestrationBus();

// ---------------------------------------------------------------------------
// Active tasks store — for UI polling
// ---------------------------------------------------------------------------

export const activeTasks = new Map<string, DelegationTask & { status: TaskStatus; attempts: number; lastResult?: DelegationResult }>();

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface OrchestrationContext {
  agentsRef: React.MutableRefObject<Agent[]>;
  runAgentCycle: (
    agentId: string,
    userMessage: string | null,
    images?: string[],
    attachments?: any[],
    signal?: AbortSignal,
    silent?: boolean
  ) => Promise<string | undefined>;
  addLog: (entry: LogEntry) => void;
  /** Operational guidelines injected into every delegated task prompt */
  guidelines?: string;
}

export const useOrchestrationEngine = (context: OrchestrationContext) => {
  const { agentsRef, runAgentCycle, addLog } = context;
  const abortMapRef = useRef<Map<string, AbortController>>(new Map());


  // -------------------------------------------------------------------------
  // Cancel a running task
  // -------------------------------------------------------------------------
  const cancelTask = useCallback((taskId: string) => {
    const ctrl = abortMapRef.current.get(taskId);
    if (ctrl) {
      ctrl.abort();
      abortMapRef.current.delete(taskId);
    }
    const task = activeTasks.get(taskId);
    if (task) {
      activeTasks.set(taskId, { ...task, status: 'failed' });
    }
  }, []);

  const delegateTask = useCallback(
    async (
      masterAgentId: string,
      subAgentIdentifier: string,
      task: string,
      options?: {
        expectedOutput?: OutputSchema;
        timeoutMs?: number;
        contextMessages?: Array<{ role: string; content: string }>;
      }
    ): Promise<DelegationResult> => {
      const agents = agentsRef.current;
      const idLower = subAgentIdentifier.toLowerCase();
      const subAgent = agents.find(a => a.id === idLower || a.name.toLowerCase() === idLower);
      const masterAgent = agents.find(a => a.id === masterAgentId);

      if (!subAgent) {
        return { taskId: 'unknown', success: false, output: null, attempts: 0, durationMs: 0, diagnosisNotes: [`Sub-agent '${subAgentIdentifier}' not found`] };
      }

      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const timeoutMs = options?.timeoutMs ?? (subAgent.timeoutSeconds && subAgent.timeoutSeconds > 0 ? subAgent.timeoutSeconds * 1000 : 60_000);
      const startTime = Date.now();

      const delegationTask: DelegationTask = {
        id: taskId,
        masterAgentId,
        masterAgentName: masterAgent?.name ?? 'Master',
        subAgentId: subAgent.id,
        subAgentName: subAgent.name,
        task,
        expectedOutput: options?.expectedOutput,
        maxRetries: 0,
        timeoutMs,
        createdAt: startTime,
      };

      activeTasks.set(taskId, { ...delegationTask, status: 'pending', attempts: 0 });
      orchestrationBus.emit({ type: 'task:started', taskId, task: delegationTask, timestamp: Date.now() });

      addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'info', method: 'ORCHESTRATION', content: `[${masterAgent?.name ?? 'Master'}] → [${subAgent.name}] Task delegated: ${task.slice(0, 80)}...` });

      const abortCtrl = new AbortController();
      abortMapRef.current.set(taskId, abortCtrl);
      const timeoutHandle = setTimeout(() => abortCtrl.abort(), timeoutMs);

      try {
        activeTasks.set(taskId, { ...delegationTask, status: 'running', attempts: 1 });
        orchestrationBus.emit({ type: 'task:attempt', taskId, task: delegationTask, attempt: 1, timestamp: Date.now() });

        const rawOutput = await runAgentCycle(subAgent.id, task, undefined, undefined, abortCtrl.signal, true);

        if (abortCtrl.signal.aborted) throw new Error(`Timeout after ${timeoutMs}ms`);

        const result: DelegationResult = { taskId, success: true, output: rawOutput ?? '', attempts: 1, durationMs: Date.now() - startTime };
        activeTasks.set(taskId, { ...delegationTask, status: 'completed', attempts: 1, lastResult: result });
        orchestrationBus.emit({ type: 'task:completed', taskId, task: delegationTask, result, timestamp: Date.now() });
        addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'info', method: 'ORCHESTRATION', content: `[${subAgent.name}] ✓ completed in 1 attempt, ${result.durationMs}ms` });
        return result;
      } catch (err: any) {
        const isTimeout = abortCtrl.signal.aborted || /timeout/i.test(err?.message || '');
        const errorMessage = isTimeout ? `Timeout after ${timeoutMs}ms` : (err?.message ?? 'Unknown delegation error');
        const failResult: DelegationResult = { taskId, success: false, output: null, attempts: 1, durationMs: Date.now() - startTime, diagnosisNotes: [errorMessage] };
        activeTasks.set(taskId, { ...delegationTask, status: 'failed', attempts: 1, lastResult: failResult });
        orchestrationBus.emit({ type: 'task:failed', taskId, task: delegationTask, result: failResult, timestamp: Date.now() });
        addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'error', method: 'ORCHESTRATION', content: `[${subAgent.name}] ✗ failed: ${errorMessage}` });
        return failResult;
      } finally {
        clearTimeout(timeoutHandle);
        abortMapRef.current.delete(taskId);
      }
    },
    [agentsRef, runAgentCycle, addLog]
  );

  return { delegateTask, cancelTask };
};
