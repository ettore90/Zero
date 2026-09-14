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
  const selectAgent = (id: string) => { onSelectAgent(id); onClose(); };
  const editAgent = (agent: Agent) => { onEditAgent(agent); onClose(); };

  return (
    <div className="flex h-full w-full flex-col border-r border-slate-800/60 bg-slate-900 shadow-2xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800/50 px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-nebula-600 shadow-lg shadow-nebula-600/20"><div className="h-1.5 w-1.5 rounded-full bg-white" /></div>
          <h1 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/90">Agents</h1>
        </div>
        <button type="button" onClick={onClose} aria-label="Close agents" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-800 hover:text-white">◀</button>
      </div>
      <div className="custom-scrollbar flex-1 overflow-y-auto p-3">
        <div className="space-y-1">
          {sortedAgents.map(agent => (
            <div key={agent.id} className={`group relative flex items-center gap-2 rounded-xl transition-all ${activeAgentId === agent.id ? 'bg-nebula-600/15 ring-1 ring-nebula-500/20' : 'hover:bg-slate-800/40'}`}>
              <button type="button" onClick={() => selectAgent(agent.id)} className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 text-left ${activeAgentId === agent.id ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                <div className="relative shrink-0"><div className={`h-2 w-2 rounded-full ${agent.isMaster ? 'ring-2 ring-nebula-500 ring-offset-2 ring-offset-slate-900' : ''}`} style={{ background: agent.color }} />{runningAgents.has(agent.id) && <span className="absolute -inset-1 rounded-full animate-ping opacity-75" style={{ background: agent.color }} />}</div>
                <div className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{agent.name}</span>{agent.isMaster && <span className="text-[8px] font-black uppercase tracking-widest text-nebula-500">Master</span>}{agent.model ? <span className="mt-0.5 block truncate font-mono text-[9px] leading-none text-slate-600">{agent.model.split('/').pop()}</span> : <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wide leading-none text-amber-500">no model</span>}</div>
              </button>
              <button type="button" onClick={() => editAgent(agent)} aria-label={agent.model ? `Edit ${agent.name}` : `Configure ${agent.name}`} title={agent.model ? 'Edit agent' : 'Configure model'} className={`mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-1 text-base transition-colors ${agent.model ? 'text-slate-400 hover:bg-white/10 hover:text-slate-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100' : 'text-amber-500 hover:bg-amber-500/20'}`}>⚙</button>
            </div>
          ))}
          <button type="button" onClick={() => { onAddAgent(); onClose(); }} className="group mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-700/50 px-3 py-2 text-slate-600 transition-all hover:border-slate-500 hover:bg-slate-800/20 hover:text-slate-300"><span className="text-[10px] font-black uppercase tracking-wider">New Agent</span></button>
        </div>
      </div>
      <div className="shrink-0 border-t border-slate-800/40 p-3"><div className="flex items-center justify-between select-none opacity-30"><span className="font-mono text-[7px] font-black uppercase tracking-[0.2em] text-slate-600">Zero Engine</span><span className="font-mono text-[9px] font-black uppercase tracking-widest text-slate-500">{APP_VERSION}</span></div></div>
    </div>
  );
};

export default React.memo(AgentPanel);
