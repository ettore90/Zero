export const NODE_META: Record<string, { label: string; color: string; bg: string; border: string; iconPath: string; description: string; }> = {
  trigger:     { label: 'Trigger',      color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', iconPath: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z', description: 'Pipeline entry point' },
  llm:         { label: 'LLM',          color: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/30',  iconPath: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z', description: 'Language model inference' },
  http:        { label: 'HTTP',         color: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/30',     iconPath: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9', description: 'External API request' },
  condition:   { label: 'Condition',    color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   iconPath: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z', description: 'Branch on expression' },
  loop:        { label: 'Loop',         color: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  iconPath: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15', description: 'Iterate over items — cada iteração tem contexto limpo' },
  code:        { label: 'Code',         color: 'text-pink-400',    bg: 'bg-pink-500/10',    border: 'border-pink-500/30',    iconPath: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', description: 'JS/Python snippet' },
  subworkflow: { label: 'Sub-Pipeline', color: 'text-teal-400',    bg: 'bg-teal-500/10',    border: 'border-teal-500/30',    iconPath: 'M13 10V3L4 14h7v7l9-11h-7z', description: 'Invoke another pipeline' },
  transform:   { label: 'Transform',   color: 'text-indigo-400',  bg: 'bg-indigo-500/10',  border: 'border-indigo-500/30',  iconPath: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4', description: 'Shape data between steps' },
  agent:       { label: 'Agent Task',  color: 'text-nebula-400',  bg: 'bg-nebula-500/10',  border: 'border-nebula-500/30',  iconPath: 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18', description: 'Run task via agent (with tools & memory)' },
  delay:       { label: 'Delay',       color: 'text-slate-400',   bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   iconPath: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z', description: 'Wait before next step' },
  alert:       { label: 'Alert',       color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     iconPath: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9', description: 'Send notification' },
};

const NodeIcon = ({ type, sz = 4 }: { type: string; sz?: number }) => {
  const m = NODE_META[type] || NODE_META.trigger;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-${sz} w-${sz}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={m.iconPath} />
    </svg>
  );
};

export default NodeIcon;
