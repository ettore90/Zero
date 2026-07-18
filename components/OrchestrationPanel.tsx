// =============================================================================
// OrchestrationPanel.tsx — v1.6.0
// Real-time visualization of agent delegation hierarchy
//
// Shows:
//   - Active delegations (Master → Sub-agent with status)
//   - Attempt counter + retry indicator
//   - Completed/failed history (last 20)
//   - Task duration
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { APP_BASE_PATH } from '../constants';
const LOCAL_BASE = window.location.pathname.split('/').slice(0, 2).join('/') || APP_BASE_PATH;
import { orchestrationBus, DelegationEvent, DelegationTask, TaskStatus } from '../hooks/useOrchestrationEngine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskEntry {
  taskId: string;
  task: DelegationTask;
  status: TaskStatus;
  attempts: number;
  startTime: number;
  endTime?: number;
  success?: boolean;
  diagnosisNotes?: string[];
  lastDiagnosis?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending:    'text-slate-400',
  running:    'text-blue-400',
  validating: 'text-yellow-400',
  retrying:   'text-orange-400',
  completed:  'text-emerald-400',
  failed:     'text-red-400',
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending:    'Pending',
  running:    'Running',
  validating: 'Validating',
  retrying:   'Retrying',
  completed:  'Done',
  failed:     'Failed',
};

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  pending: (
    <svg className="h-3 w-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <circle cx="12" cy="12" r="10" strokeWidth={2} />
    </svg>
  ),
  running: (
    <svg className="h-3 w-3 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  validating: (
    <svg className="h-3 w-3 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  retrying: (
    <svg className="h-3 w-3 text-orange-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  completed: (
    <svg className="h-3 w-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  ),
  failed: (
    <svg className="h-3 w-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
};

function elapsed(from: number, to?: number): string {
  const ms = (to ?? Date.now()) - from;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

// ---------------------------------------------------------------------------
// Task Card
// ---------------------------------------------------------------------------

const TaskCard: React.FC<{ entry: TaskEntry; onStop?: (agentId: string) => void }> = ({ entry, onStop }) => {
  const [expanded, setExpanded] = useState(false);
  const isActive = entry.status === 'running' || entry.status === 'validating' || entry.status === 'retrying';

  return (
    <div
      className={`rounded-lg border transition-all ${
        isActive
          ? 'border-blue-500/30 bg-blue-900/10'
          : entry.status === 'completed'
          ? 'border-emerald-500/20 bg-emerald-900/5'
          : entry.status === 'failed'
          ? 'border-red-500/20 bg-red-900/5'
          : 'border-slate-700/50 bg-slate-800/30'
      }`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Status icon */}
        <div className="shrink-0">{STATUS_ICON[entry.status]}</div>

        {/* Agent flow */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            <span className="text-nebula-400 font-semibold truncate max-w-[80px]">{entry.task.masterAgentName}</span>
            <svg className="h-2.5 w-2.5 text-slate-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-slate-300 font-semibold truncate max-w-[80px]">{entry.task.subAgentName}</span>
          </div>
          <div className="text-[10px] text-slate-500 truncate mt-0.5">{entry.task.task.slice(0, 60)}{entry.task.task.length > 60 ? '…' : ''}</div>
        </div>

        {/* Right side: status + time + attempts */}
        <div className="shrink-0 flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1">
            {isActive && onStop && (
              <button
                onClick={e => { e.stopPropagation(); onStop(entry.task.subAgentId); }}
                title="Stop this agent"
                className="p-0.5 rounded text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <span className={`text-[9px] font-mono font-semibold uppercase ${STATUS_COLORS[entry.status]}`}>
              {STATUS_LABEL[entry.status]}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-slate-600">
            {entry.attempts > 1 && (
              <span className="text-orange-500/80">{entry.attempts}x</span>
            )}
            <span>{elapsed(entry.startTime, entry.endTime)}</span>
          </div>
        </div>

        {/* Chevron */}
        <svg
          className={`h-3 w-3 text-slate-600 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-700/40 pt-2 space-y-2">
          {/* Full task */}
          <div>
            <div className="text-[9px] font-mono text-slate-500 uppercase mb-1">Task</div>
            <div className="text-[10px] text-slate-300 font-mono bg-slate-800/60 rounded p-2 whitespace-pre-wrap break-words">
              {entry.task.task}
            </div>
          </div>

          {/* Expected schema */}
          {entry.task.expectedOutput && (
            <div>
              <div className="text-[9px] font-mono text-slate-500 uppercase mb-1">Expected Output</div>
              <div className="text-[10px] text-slate-400 font-mono">
                {entry.task.expectedOutput.description && (
                  <div className="mb-1">{entry.task.expectedOutput.description}</div>
                )}
                {entry.task.expectedOutput.required && (
                  <div className="flex flex-wrap gap-1">
                    {entry.task.expectedOutput.required.map(f => (
                      <span key={f} className="bg-slate-700/60 rounded px-1.5 py-0.5 text-nebula-400">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Diagnosis notes */}
          {entry.diagnosisNotes && entry.diagnosisNotes.length > 0 && (
            <div>
              <div className="text-[9px] font-mono text-slate-500 uppercase mb-1">Retry Diagnosis</div>
              <div className="space-y-1">
                {entry.diagnosisNotes.map((note, i) => (
                  <div key={i} className="text-[10px] text-orange-400/80 font-mono bg-orange-900/10 rounded px-2 py-1">
                    {note}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Config info */}
          <div className="flex gap-3 text-[9px] font-mono text-slate-600">
            <span>Max retries: {entry.task.maxRetries}</span>
            <span>Timeout: {(entry.task.timeoutMs / 1000).toFixed(0)}s</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Panel
// ---------------------------------------------------------------------------

interface OrchestrationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  username?: string;
}

const OrchestrationPanel: React.FC<OrchestrationPanelProps> = ({ isOpen, onClose, username }) => {
  const stopAgent = useCallback(async (agentId?: string) => {
    try {
      await fetch(`${LOCAL_BASE}/api/agent/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, agentId }),
      });
    } catch {}
  }, [username]);
  const [tasks, setTasks] = useState<TaskEntry[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');

  // Subscribe to orchestration events
  useEffect(() => {
    const unsub = orchestrationBus.on((event: DelegationEvent) => {
      setTasks(prev => {
        const existing = prev.find(t => t.taskId === event.taskId);

        const base: TaskEntry = existing ?? {
          taskId: event.taskId,
          task: event.task,
          status: 'pending',
          attempts: 0,
          startTime: event.task.createdAt,
        };

        let updated: TaskEntry;

        switch (event.type) {
          case 'task:started':
            updated = { ...base, status: 'pending' };
            break;
          case 'task:attempt':
            updated = { ...base, status: 'running', attempts: event.attempt ?? 1 };
            break;
          case 'task:validating':
            updated = { ...base, status: 'validating', attempts: event.attempt ?? base.attempts };
            break;
          case 'task:retry':
            updated = {
              ...base,
              status: 'retrying',
              attempts: event.attempt ?? base.attempts,
              lastDiagnosis: event.diagnosis,
              diagnosisNotes: event.diagnosis
                ? [...(base.diagnosisNotes ?? []), event.diagnosis]
                : base.diagnosisNotes,
            };
            break;
          case 'task:completed':
            updated = {
              ...base,
              status: 'completed',
              attempts: event.result?.attempts ?? base.attempts,
              endTime: event.timestamp,
              success: true,
              diagnosisNotes: event.result?.diagnosisNotes,
            };
            break;
          case 'task:failed':
            updated = {
              ...base,
              status: 'failed',
              attempts: event.result?.attempts ?? base.attempts,
              endTime: event.timestamp,
              success: false,
              diagnosisNotes: event.result?.diagnosisNotes,
            };
            break;
          default:
            updated = base;
        }

        if (existing) {
          return prev.map(t => t.taskId === event.taskId ? updated : t);
        }
        // Keep max 30 tasks, newest first
        return [updated, ...prev].slice(0, 30);
      });
    });

    return () => { unsub(); };
  }, []);

  const filteredTasks = tasks.filter(t => {
    if (filter === 'active') return t.status === 'running' || t.status === 'validating' || t.status === 'retrying' || t.status === 'pending';
    if (filter === 'done') return t.status === 'completed' || t.status === 'failed';
    return true;
  });

  const activeCnt = tasks.filter(t => ['running', 'validating', 'retrying', 'pending'].includes(t.status)).length;
  const doneCnt = tasks.filter(t => ['completed', 'failed'].includes(t.status)).length;

  return (
    <div className={`flex flex-col h-full bg-slate-900 text-slate-200 ${!isOpen ? 'hidden' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 shrink-0">
        <div className="flex items-center gap-2">
          {/* Hierarchy icon */}
          <svg className="h-4 w-4 text-nebula-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
          </svg>
          <span className="text-sm font-semibold text-slate-100">Orchestration</span>
          {activeCnt > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white animate-pulse">
              {activeCnt}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeCnt > 0 && (
            <>
              <button
                onClick={() => stopAgent()}
                title="Stop all running agents"
                className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors text-[9px] font-bold uppercase tracking-wider"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Stop All
              </button>
            </>
          )}
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1 rounded">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 pt-2 pb-1 shrink-0">
        {(['all', 'active', 'done'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono font-semibold uppercase transition-colors ${
              filter === f
                ? 'bg-nebula-600/30 text-nebula-300 border border-nebula-500/30'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {f}
            {f === 'active' && activeCnt > 0 && (
              <span className="ml-1 text-blue-400">{activeCnt}</span>
            )}
            {f === 'done' && doneCnt > 0 && (
              <span className="ml-1 text-slate-600">{doneCnt}</span>
            )}
          </button>
        ))}
        {tasks.length > 0 && (
          <button
            onClick={() => setTasks([])}
            className="ml-auto text-[9px] font-mono text-slate-600 hover:text-slate-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
        {filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-600">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-[11px] font-mono">No delegations yet</span>
          </div>
        ) : (
          filteredTasks.map(entry => (
            <TaskCard key={entry.taskId} entry={entry} onStop={stopAgent} />
          ))
        )}
      </div>

      {/* Footer: legend */}
      <div className="px-3 py-2 border-t border-slate-700/40 shrink-0">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {(Object.keys(STATUS_LABEL) as TaskStatus[]).map(s => (
            <div key={s} className="flex items-center gap-1">
              {STATUS_ICON[s]}
              <span className={`text-[9px] font-mono ${STATUS_COLORS[s]}`}>{STATUS_LABEL[s]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OrchestrationPanel;