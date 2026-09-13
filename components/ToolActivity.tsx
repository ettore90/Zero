import { memo, useMemo, useState } from 'react';
import { Message, ToolCall } from '../types';

// ---------------------------------------------------------------------------
// ToolActivity
//
// A run of tool calls used to render as one pill per call, so a single agent
// turn could push dozens of rows of noise between two sentences of actual
// answer. Instead the whole run collapses into one line — how long it took,
// how many calls, how many sub-agents — and expands to the per-call detail
// only when asked.
// ---------------------------------------------------------------------------

export interface ToolActivityCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  hasResult: boolean;
  isError: boolean;
}

export interface ToolActivityGroup {
  key: string;
  calls: ToolActivityCall[];
  startedAt: number;
  endedAt: number;
}

/** Tools that hand work to another agent — worth calling out separately. */
const SUBAGENT_TOOLS = new Set(['delegate_task', 'delegate_parallel']);

const TOOL_ICONS: Record<string, string> = {
  run_terminal_command: '⚡',
  run_python_code: '🐍',
  run_tests: '🧪',
  write_file: '✏️',
  replace_in_file: '✏️',
  read_file: '📖',
  find_files: '🔎',
  list_directory: '📁',
  delegate_task: '🤖',
  delegate_parallel: '🤖',
  remember_fact: '🧠',
  recall_memory: '🧠',
  make_http_request: '🌐',
  git_status: '🔀',
  git_diff: '🔀',
  git_commit: '🔀',
  git_log: '🔀',
  jira_action: '📋',
  jira_queue: '📋',
  request_plan_approval: '📋',
  complete_plan_checklist_item: '☑️',
  comment_plan_checklist_item: '💬',
};

const parseArgs = (raw: string): Record<string, any> => {
  if (!raw) return {};
  if (typeof raw !== 'string') return raw as any;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { value: parsed };
  } catch {
    return {};
  }
};

/** The one field of a call's arguments a human actually scans for. */
export const summarizeToolArgs = (name: string, raw: string): string => {
  const args = parseArgs(raw);
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  if (SUBAGENT_TOOLS.has(name)) {
    const target = pick('agent_id', 'agent_name', 'agent');
    const task = pick('task', 'prompt', 'instructions');
    return [target && `→ ${target}`, task].filter(Boolean).join(': ');
  }
  const direct = pick('command', 'path', 'file_path', 'query', 'url', 'content', 'text', 'task', 'title');
  if (direct) return direct;
  const serialized = JSON.stringify(args);
  return serialized === '{}' ? '' : serialized;
};

const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
};

const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value);

/** `role: 'tool'` content is usually JSON; show the human-readable part of it. */
const previewResult = (result: string | undefined): string => {
  const raw = String(result ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      for (const key of ['error', 'stdout', 'output', 'result', 'content', 'message', 'summary']) {
        const value = (parsed as any)[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
  } catch {
    return raw;
  }
  return raw;
};

export const isToolResultError = (result: string | undefined): boolean => {
  const raw = String(result ?? '').trim();
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as any).error);
  } catch {
    return false;
  }
};

/**
 * Builds the activity group for one run of tool calls. `messages` is the slice
 * of history holding the assistant messages that issued the calls plus the
 * `role: 'tool'` messages carrying their results.
 */
export const buildToolActivityGroup = (key: string, messages: Message[]): ToolActivityGroup | null => {
  const calls: ToolActivityCall[] = [];
  const resultsByCallId = new Map<string, string>();
  let startedAt = 0;
  let endedAt = 0;

  for (const msg of messages) {
    const timestamp = Number(msg?.timestamp);
    if (Number.isFinite(timestamp) && timestamp > 0) {
      if (!startedAt) startedAt = timestamp;
      endedAt = Math.max(endedAt, timestamp);
    }
    if (msg.role === 'tool') {
      const id = String(msg.tool_call_id || '').trim();
      if (id) resultsByCallId.set(id, String(msg.content ?? ''));
      continue;
    }
    for (const tc of (Array.isArray(msg.tool_calls) ? msg.tool_calls : []) as ToolCall[]) {
      calls.push({
        id: String(tc?.id || `${key}-${calls.length}`),
        name: tc?.function?.name || 'tool',
        arguments: typeof tc?.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc?.function?.arguments ?? {}),
        hasResult: false,
        isError: false,
      });
    }
  }

  if (calls.length === 0) return null;

  return {
    key,
    startedAt,
    endedAt,
    calls: calls.map((call) => {
      const result = resultsByCallId.get(call.id);
      return { ...call, result, hasResult: result !== undefined, isError: isToolResultError(result) };
    }),
  };
};

const ToolActivity = memo(({ group, isRunning }: { group: ToolActivityGroup; isRunning: boolean }) => {
  const [isOpen, setIsOpen] = useState(false);

  const { toolCount, subagentCount, errorCount, durationLabel, toolNames } = useMemo(() => {
    const names = new Map<string, number>();
    let subagents = 0;
    let errors = 0;
    for (const call of group.calls) {
      names.set(call.name, (names.get(call.name) ?? 0) + 1);
      if (SUBAGENT_TOOLS.has(call.name)) subagents += 1;
      if (call.isError) errors += 1;
    }
    return {
      toolCount: group.calls.length,
      subagentCount: subagents,
      errorCount: errors,
      durationLabel: formatDuration(group.endedAt - group.startedAt),
      toolNames: Array.from(names.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [group]);

  const headline = [
    isRunning ? 'Working' : 'Worked',
    durationLabel ? `for ${durationLabel}` : null,
  ].filter(Boolean).join(' ');

  const facts = [
    `${toolCount} ${toolCount === 1 ? 'tool call' : 'tool calls'}`,
    subagentCount > 0 ? `${subagentCount} ${subagentCount === 1 ? 'subagent' : 'subagents'}` : null,
    errorCount > 0 ? `${errorCount} failed` : null,
  ].filter(Boolean) as string[];

  const toolBreakdown = toolNames
    .slice(0, 4)
    .map(([name, count]) => (count > 1 ? `${name}×${count}` : name))
    .join(', ');

  return (
    <div className="flex gap-3 justify-start">
      <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0 mt-0.5">
        {isRunning
          ? <div className="w-2 h-2 rounded-full bg-nebula-500 animate-pulse" />
          : <div className="w-2 h-2 rounded-full bg-nebula-500" />}
      </div>

      <div className="min-w-0 max-w-[85%] flex-1">
        <button
          type="button"
          onClick={() => setIsOpen(open => !open)}
          aria-expanded={isOpen}
          className="group flex w-full min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/50 dark:bg-slate-800/60 dark:hover:border-slate-600 dark:hover:bg-slate-800"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-700 dark:text-slate-200">{headline}</span>
              {facts.length > 0 && <span className="text-slate-500 dark:text-slate-400"> · {facts.join(' · ')}</span>}
            </span>
            {toolBreakdown && (
              <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400 dark:text-slate-500">
                {toolBreakdown}{toolNames.length > 4 ? ` +${toolNames.length - 4} more` : ''}
              </span>
            )}
          </span>
          {isRunning && (
            <span className="flex shrink-0 items-center gap-1">
              {[0, 150, 300].map(delay => (
                <span key={delay} className="h-1 w-1 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
          )}
        </button>

        {isOpen && (
          <div className="mt-1.5 space-y-1.5">
            {group.calls.map((call, index) => {
              const argSummary = summarizeToolArgs(call.name, call.arguments);
              const resultPreview = previewResult(call.result);
              return (
                <div
                  key={`${call.id}-${index}`}
                  className={`rounded-lg border px-3 py-2 text-[11px] ${
                    call.isError
                      ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/5'
                      : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="shrink-0 text-[11px]">{TOOL_ICONS[call.name] ?? '🔧'}</span>
                    <span className="truncate font-mono font-bold text-slate-700 dark:text-slate-200">{call.name}</span>
                    <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      {call.isError ? 'failed' : call.hasResult ? 'done' : isRunning ? 'running' : 'no result'}
                    </span>
                  </div>
                  {argSummary && (
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10px] text-slate-600 dark:text-slate-400">
                      {truncate(argSummary, 600)}
                    </pre>
                  )}
                  {resultPreview && (
                    <pre className={`mt-1.5 overflow-x-auto whitespace-pre-wrap break-words border-t pt-1.5 font-mono text-[10px] ${
                      call.isError
                        ? 'border-red-200 text-red-600 dark:border-red-500/30 dark:text-red-300'
                        : 'border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-500'
                    }`}>
                      {truncate(resultPreview, 1200)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

ToolActivity.displayName = 'ToolActivity';

export default ToolActivity;
