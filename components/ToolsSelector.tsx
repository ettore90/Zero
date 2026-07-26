// =============================================================================
// ToolsSelector.tsx
// Seção de checkboxes para selecionar tools permitidas por agente.
// Tool list is auto-generated from toolDefinitions.js — always in sync.
// =============================================================================

import React from 'react';
import { SYSTEM_TOOLS } from '../utils/toolDefinitions';

// Auto-generate groups from SYSTEM_TOOLS based on name prefix/pattern
type ToolGroup = { label: string; icon: string; tools: { name: string; description: string }[] };

const GROUP_ICONS: Record<string, string> = {
  'File System': '📁', 'Execution': '⚡', 'Git': '🔀',
  'Orchestration': '🤖', 'Memory': '🧠', 'Config & System': '⚙️',
  'HTTP': '🌐', 'Notes': '📝', 'Jira': '🎫', 'Other': '🔧',
};

const GROUP_ORDER = ['File System', 'Execution', 'Git', 'Notes', 'Memory', 'Orchestration', 'Config & System', 'HTTP', 'Jira', 'Other'];

function buildToolGroups(): ToolGroup[] {
  // Group by the 'group' field defined in toolDefinitions.js — fully automatic
  const map = new Map<string, { name: string; description: string }[]>();
  const tools = Array.isArray(SYSTEM_TOOLS) ? SYSTEM_TOOLS : [];

  for (const t of tools) {
    const toolName = t?.function?.name;
    const toolDescription = t?.function?.description;
    if (!toolName || typeof toolDescription !== 'string') continue;

    const group = t?.group || 'Other';
    if (!map.has(group)) map.set(group, []);
    map.get(group)?.push({ name: toolName, description: toolDescription.slice(0, 60) });
  }

  const orderedGroups = GROUP_ORDER.filter(g => map.has(g));
  const remainingGroups = [...map.keys()].filter(g => !GROUP_ORDER.includes(g));

  return [...orderedGroups, ...remainingGroups]
    .map(g => ({ label: g, icon: GROUP_ICONS[g] || '🔧', tools: map.get(g) ?? [] }))
    .filter(group => Array.isArray(group.tools));
}

const TOOL_GROUPS = buildToolGroups();

// Helper: preset de tools por papel do agente
export const AGENT_TOOL_PRESETS: Record<string, string[]> = {
  master: [], // vazio = todas as tools
  developer: [
    'read_file', 'write_file', 'list_directory', 'find_files', 'read_project_json',
    'run_terminal_command', 'run_python_code', 'run_tests', 'lint_code', 'format_code',
    'git_status', 'git_diff',
    'send_alert', 'remember_fact', 'recall_memory', 'scan_project',
  ],
  qa: [
    'read_file', 'list_directory', 'find_files',
    'run_tests', 'lint_code',
    'git_status', 'git_diff',
    'send_alert', 'remember_fact',
  ],
  git_expert: [
    'read_file',
    'git_status', 'git_diff', 'git_commit', 'git_log', 'git_branch', 'git_push', 'git_pull',
    'run_terminal_command',
    'send_alert',
  ],
  code_reviewer: [
    'read_file', 'list_directory', 'find_files', 'read_project_json',
    'git_diff', 'git_log',
    'send_alert', 'remember_fact', 'recall_memory',
  ],
  memory_manager: [
    'remember_fact', 'recall_memory', 'read_guidelines',
    'manage_variable',
    'send_alert',
  ],
};

interface ToolsSelectorProps {
  allowedTools: string[];  // [] = all tools allowed
  onChange: (tools: string[]) => void;
}

export const ToolsSelector: React.FC<ToolsSelectorProps> = ({ allowedTools, onChange }) => {
  const safeAllowedTools = Array.isArray(allowedTools) ? allowedTools : [];
  const allAllowedTools = safeAllowedTools;
  const isAllTools = allAllowedTools.length === 0;

  const toggle = (toolName: string) => {
    if (isAllTools) {
      // Switching from "all" to specific: start with all except this one
      const all = TOOL_GROUPS.flatMap(g => g.tools.map(t => t.name));
      onChange(all.filter(t => t !== toolName));
    } else if (allAllowedTools.includes(toolName)) {
      const next = allAllowedTools.filter(t => t !== toolName);
      onChange(next.length === 0 ? ['__none__'] : next);
    } else {
      const next = allAllowedTools.filter(t => t !== '__none__');
      onChange([...next, toolName]);
    }
  };

  const isChecked = (toolName: string) => isAllTools || allAllowedTools.includes(toolName);

  const selectAll = () => onChange([]);
  const selectNone = () => onChange(['__none__']); // special sentinel — no tools

  const selectPreset = (preset: string) => {
    onChange(AGENT_TOOL_PRESETS[preset] ?? []);
  };

  const checkedCount = isAllTools
    ? TOOL_GROUPS.flatMap(g => g.tools).length
    : allAllowedTools.filter(t => t !== '__none__').length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-slate-300">Allowed Tools</span>
          <span className="ml-2 text-[10px] text-slate-500">
            {isAllTools ? 'All tools' : `${checkedCount} selected`}
          </span>
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={selectAll} className="text-[9px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors font-bold uppercase tracking-wide">
            All
          </button>
          <button type="button" onClick={selectNone} className="text-[9px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors font-bold uppercase tracking-wide">
            None
          </button>
        </div>
      </div>

      {/* Presets */}
      <div>
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1 block">Presets</span>
        <div className="flex flex-wrap gap-1">
          {Object.keys(AGENT_TOOL_PRESETS).map(preset => (
            <button type="button"
              key={preset}
              onClick={() => selectPreset(preset)}
              className="text-[9px] px-2 py-1 rounded-md bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 hover:text-indigo-200 transition-colors font-bold uppercase tracking-wide"
            >
              {preset.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Tool groups */}
      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
        {TOOL_GROUPS.map(group => (
          <div key={group.label}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm">{group.icon}</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{group.label}</span>
              {/* Group toggle */}
              <button type="button"
                onClick={() => {
                  const groupTools = group.tools.map(t => t.name);
                  const allChecked = groupTools.every(t => isChecked(t));
                  if (allChecked) {
                    // Uncheck all in group
                    const currentAll = isAllTools
                      ? TOOL_GROUPS.flatMap(g => g.tools.map(t => t.name))
                      : [...allAllowedTools];
                    const next = currentAll.filter(t => !groupTools.includes(t));
                    onChange(next.length === 0 ? ['__none__'] : next);
                  } else {
                    // Check all in group
                    const current = isAllTools
                      ? TOOL_GROUPS.flatMap(g => g.tools.map(t => t.name))
                      : allAllowedTools.filter(t => t !== '__none__');
                    const merged = [...new Set([...current, ...groupTools])];
                    onChange(merged);
                  }
                }}
                className="ml-auto text-[8px] text-slate-600 hover:text-slate-400 transition-colors"
              >
                toggle all
              </button>
            </div>
            <div className="grid grid-cols-2 gap-0.5 pl-1">
              {group.tools.map(tool => (
                <label
                  key={tool.name}
                  className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-slate-800/50 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={isChecked(tool.name)}
                    onChange={() => toggle(tool.name)}
                    className="w-3 h-3 accent-indigo-500 shrink-0"
                  />
                  <span className="text-[10px] font-mono text-slate-400 group-hover:text-slate-200 transition-colors flex-1">
                    {tool.name}
                  </span>
                  <span className="text-[9px] text-slate-600 hidden group-hover:block">
                    {tool.description}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ToolsSelector;

// =============================================================================
// INSTRUÇÕES DE INTEGRAÇÃO NO AgentManager.tsx
// =============================================================================
//
// 1. Importar:
//    import { ToolsSelector } from './ToolsSelector';
//
// 2. No estado do formulário, adicionar:
//    const [allowedTools, setAllowedTools] = useState<string[]>(agent?.allowedTools ?? []);
//
// 3. No JSX do formulário (após o campo de model ou cor), adicionar:
//    <ToolsSelector allowedTools={allowedTools} onChange={setAllowedTools} />
//
// 4. No onSave, incluir allowedTools:
//    onSave({ ...agentData, allowedTools });
//
// =============================================================================
