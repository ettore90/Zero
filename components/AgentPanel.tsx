import React from 'react';
import { Agent } from '../types';
import { APP_VERSION } from '../constants';

interface AgentPanelProps {
  agents: Agent[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  onAddAgent: () => void;
  onEditAgent: (agent: Agent) => void;
  runningAgents?: Set<string>;
  onClose: () => void;
}

const AgentPanel: React.FC<AgentPanelProps> = ({ agents, activeAgentId, onSelectAgent, onAddAgent, onEditAgent, onClose, runningAgents = new Set() }) => {
  const sortedAgents = [...agents].sort((a, b) => a.isMaster ? -1 : b.isMaster ? 1 : 0);
  return (
    <div className="flex flex-col h-full w-full bg-slate-900 border-r border-slate-800/60 shadow-2xl">
      <div className="h-14 flex items-center justify-between px-4 border-b border-slate-800/50 shrink-0">
        <div className="flex items-center gap-2"><div className="w-5 h-5 bg-nebula-600 rounded flex items-center justify-center shadow-lg shadow-nebula-600/20"><div className="w-1.5 h-1.5 bg-white rounded-full" /></div><h1 className="text-[10px] font-black tracking-[0.25em] uppercase text-white/90">Agents</h1></div>
        <button onClick={onClose} className="text-slate-500 hover:text-white p-1 transition-colors">◀</button>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3"><div className="space-y-1">{sortedAgents.map(agent => <button key={agent.id} onClick={() => { onSelectAgent(agent.id); onClose(); }} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative ${activeAgentId === agent.id ? 'bg-nebula-600/15 text-white ring-1 ring-nebula-500/20' : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200'}`}><div className="relative shrink-0"><div className={`w-2 h-2 rounded-full transition-all ${agent.isMaster ? 'ring-2 ring-nebula-500 ring-offset-2 ring-offset-slate-900' : ''}`} style={{ background: agent.color }} />{runningAgents.has(agent.id) && <span className="absolute -inset-1 rounded-full animate-ping opacity-75" style={{ background: agent.color }} />}</div><div className="flex-1 text-left min-w-0"><span className="text-xs font-bold block truncate">{agent.name}</span>{agent.isMaster && <span className="text-[8px] font-black text-nebula-500 uppercase tracking-widest leading-none">Master</span>}{agent.model ? <span className="text-[9px] text-slate-600 font-mono truncate block leading-none mt-0.5">{agent.model.split('/').pop()}</span> : <span className="text-[9px] text-amber-500 font-bold uppercase tracking-wide block leading-none mt-0.5">no model</span>}</div><button onClick={e => { e.stopPropagation(); onEditAgent(agent); onClose(); }} className={`${!agent.model ? 'text-amber-500 hover:bg-amber-500/20' : 'opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300 hover:bg-white/10'} p-1 rounded-md transition-colors shrink-0`} title={agent.model ? 'Edit agent' : 'Configure model'}>⚙</button></button>)}<button onClick={() => { onAddAgent(); onClose(); }} className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2 border border-dashed border-slate-700/50 rounded-xl text-slate-600 hover:text-slate-300 hover:border-slate-500 transition-all hover:bg-slate-800/20 group"><span className="text-[10px] font-black uppercase tracking-wider">New Agent</span></button></div></div>
      <div className="p-3 border-t border-slate-800/40 shrink-0"><div className="flex items-center justify-between opacity-30 select-none"><span className="text-[7px] font-black font-mono text-slate-600 tracking-[0.2em] uppercase">Zero Engine</span><span className="text-[9px] font-black font-mono text-slate-500 tracking-widest uppercase">{APP_VERSION}</span></div></div>
    </div>
  );
};

// Rendered by Layout (twice: mobile + desktop) with ~60 agent rows each, so any
// Layout-local state change would otherwise re-render the whole list.
export default React.memo(AgentPanel);
