import React, { useState } from 'react';
import { ToolCall } from '../types';

// ---------------------------------------------------------------------------
// ExecutionPlanModal
// Mostrado quando o agente planeja executar 2+ tool calls em sequência.
// Permite ao usuário revisar, editar args ou cancelar antes de executar.
// ---------------------------------------------------------------------------

interface ToolStep {
  toolCall: ToolCall;
  args: Record<string, any>;
  risk: 'safe' | 'caution' | 'destructive';
}

interface ExecutionPlanModalProps {
  toolCalls: ToolCall[];
  agentName: string;
  onApprove: (toolCalls: ToolCall[]) => void;
  onCancel: () => void;
}

const RISK_MAP: Record<string, 'safe' | 'caution' | 'destructive'> = {
  run_terminal_command: 'caution',
  write_file: 'caution',
  run_python_code: 'caution',
  read_file: 'safe',
  list_directory: 'safe',
  remember_fact: 'safe',
  search_memory: 'safe',
  send_alert: 'safe',
  delegate_task: 'safe',
  send_agent_message: 'safe',
};

const RISK_DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf?\b/i,
  /\bdrop\s+table\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push.*--force\b/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
];

function classifyRisk(toolName: string, args: Record<string, any>): 'safe' | 'caution' | 'destructive' {
  const base = RISK_MAP[toolName] ?? 'caution';
  if (base === 'caution' && args.command) {
    const isDestructive = RISK_DESTRUCTIVE_PATTERNS.some(p => p.test(args.command));
    if (isDestructive) return 'destructive';
  }
  return base;
}

function summarizeArgs(toolName: string, args: Record<string, any>): string {
  if (toolName === 'run_terminal_command') return args.command ?? '';
  if (toolName === 'write_file') return `${args.path} (${(args.content?.length ?? 0)} chars)`;
  if (toolName === 'read_file') return args.path ?? '';
  if (toolName === 'list_directory') return args.path ?? '';
  if (toolName === 'delegate_task') return `→ ${args.agent_id ?? args.agent_name ?? '?'}: ${(args.task ?? '').slice(0, 60)}`;
  if (toolName === 'remember_fact') return (args.content ?? '').slice(0, 60);
  return JSON.stringify(args).slice(0, 80);
}

const TOOL_ICONS: Record<string, string> = {
  run_terminal_command: '⚡',
  write_file: '✏️',
  read_file: '📖',
  list_directory: '📁',
  run_python_code: '🐍',
  delegate_task: '🤖',
  remember_fact: '🧠',
  search_memory: '🔍',
  send_alert: '🔔',
  make_http_request: '🌐',
};

export const ExecutionPlanModal: React.FC<ExecutionPlanModalProps> = ({
  toolCalls,
  agentName,
  onApprove,
  onCancel,
}) => {
  const safeToolCalls = Array.isArray(toolCalls) ? toolCalls : [];

  const steps: ToolStep[] = safeToolCalls.map(tc => {
    let args: Record<string, any> = {};
    try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments; } catch {}
    return { toolCall: tc, args, risk: classifyRisk(tc.function.name, args) };
  });

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editedArgs, setEditedArgs] = useState<Record<number, string>>({});

  const hasDestructive = steps.some(s => s.risk === 'destructive');

  const buildFinalToolCalls = (): ToolCall[] => {
    return safeToolCalls.map((tc, i) => {
      if (editedArgs[i] !== undefined) {
        return { ...tc, function: { ...tc.function, arguments: editedArgs[i] } };
      }
      return tc;
    });
  };

  const riskColor = {
    safe: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    caution: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    destructive: 'text-red-400 bg-red-500/10 border-red-500/20',
  };

  const riskLabel = { safe: 'safe', caution: 'caution', destructive: '⚠ destructive' };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-lg">📋</div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white">Execution Plan</h2>
            <p className="text-xs text-slate-400">{agentName} wants to run {steps.length} operations</p>
          </div>
          {hasDestructive && (
            <span className="text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-lg">
              ⚠ Destructive
            </span>
          )}
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {steps.map((step, i) => {
            const isEditing = editingIdx === i;
            const currentArgs = editedArgs[i] !== undefined
              ? editedArgs[i]
              : (typeof step.toolCall.function.arguments === 'string'
                  ? step.toolCall.function.arguments
                  : JSON.stringify(step.args, null, 2));

            return (
              <div key={i} className={`rounded-xl border p-3 transition-all ${riskColor[step.risk]}`}>
                <div className="flex items-start gap-2">
                  {/* Step number */}
                  <span className="text-[10px] font-black text-slate-500 w-4 shrink-0 mt-0.5">{i + 1}</span>

                  {/* Icon + name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-sm">{TOOL_ICONS[step.toolCall.function.name] ?? '🔧'}</span>
                      <span className="text-xs font-bold text-white font-mono">{step.toolCall.function.name}</span>
                      <span className={`ml-auto text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${riskColor[step.risk]}`}>
                        {riskLabel[step.risk]}
                      </span>
                    </div>

                    {/* Args summary / editor */}
                    {isEditing ? (
                      <textarea
                        className="w-full text-[11px] font-mono bg-slate-800 text-slate-200 border border-slate-600 rounded-lg p-2 resize-none outline-none focus:border-indigo-500 mt-1"
                        rows={4}
                        value={currentArgs}
                        onChange={e => setEditedArgs(prev => ({ ...prev, [i]: e.target.value }))}
                        autoFocus
                      />
                    ) : (
                      <p className="text-[11px] font-mono text-current opacity-80 truncate">
                        {summarizeArgs(step.toolCall.function.name, step.args)}
                      </p>
                    )}
                  </div>

                  {/* Edit toggle */}
                  <button
                    onClick={() => setEditingIdx(isEditing ? null : i)}
                    className="shrink-0 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
                    title={isEditing ? 'Done' : 'Edit args'}
                  >
                    {isEditing ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => onApprove(buildFinalToolCalls())}
            className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${
              hasDestructive
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {hasDestructive ? '⚠ Execute Anyway' : 'Execute Plan'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExecutionPlanModal;
