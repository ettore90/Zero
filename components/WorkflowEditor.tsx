import React, { useState, useEffect, useRef } from 'react';
import { Workflow, Agent, ModelConfig, WorkflowNode, WorkflowSchedule } from '../types';
import { generateId, calculateNextRun } from '../utils/helpers';
import { fetchConfig, fetchAgents } from '../services/localApiService';
import RunHistory from './workflow/RunHistory';
import LiveLog from './workflow/LiveLog';
import NodeIcon, { NODE_META } from './workflow/NodeIcon';
import NodeCard from './workflow/NodeCard';


interface WorkflowEditorProps {
  workflow: Workflow;
  agents: Agent[];
  models: ModelConfig[];
  workflows?: Workflow[];
  username: string;
  timezone?: string;
  onSave: (wf: Workflow) => void;
  onBack: () => void;
  onRun: (wf: Workflow) => void;
}

const ADD_TYPES = ['agent','llm','http','condition','loop','code','subworkflow','transform','delay','alert'];
const IC  = "w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-slate-400 dark:focus:border-slate-500 transition-colors placeholder-slate-400 dark:placeholder-slate-600";
const LC  = "block text-[10px] font-bold text-slate-500 dark:text-slate-500 uppercase tracking-widest mb-1.5";
const TA  = `${IC} resize-none leading-relaxed`;

// ── WorkflowEditor ────────────────────────────────────────────────────────────

const WorkflowEditor: React.FC<WorkflowEditorProps> = ({ workflow, agents: agentsProp, models, workflows = [], username, timezone, onSave, onBack, onRun }) => {
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [agentId, setAgentId] = useState(workflow.agentId || agentsProp[0]?.id || '');
  const [nodes, setNodes] = useState<WorkflowNode[]>(workflow.nodes.filter(n => n.type !== 'trigger'));
  const [schedule, setSchedule] = useState<WorkflowSchedule>(workflow.schedule || { enabled: false, type: 'daily', time: '09:00' });
  const [agents, setAgents] = useState<Agent[]>(agentsProp);

  // Fetch-on-open: busca workflow e agents frescos do servidor ao montar
  useEffect(() => {
    const load = async () => {
      const [config, freshAgents] = await Promise.all([
        fetchConfig(username),
        fetchAgents(username),
      ]);
      // Atualizar agents disponíveis
      if (freshAgents?.length) setAgents(freshAgents);
      // Atualizar workflow com dados frescos
      if (config?.workflows) {
        const fresh = config.workflows.find((w: Workflow) => w.id === workflow.id);
        if (fresh) {
          setName(fresh.name);
          setDescription(fresh.description);
          setAgentId(fresh.agentId || freshAgents?.[0]?.id || '');
          setNodes(fresh.nodes.filter((n: WorkflowNode) => n.type !== 'trigger'));
          setSchedule(fresh.schedule || { enabled: false, type: 'daily', time: '09:00' });
        }
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Roda só uma vez ao montar
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [liveFullscreen, setLiveFullscreen] = useState(false);
  const [isCompactScreen, setIsCompactScreen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Prevent Chrome mobile scroll jump when Live panel opens
  useEffect(() => {
    // Lock document scroll position
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflow = '';
      window.scrollTo(0, scrollY);
    };
  }, []);

  // Detect compact screens (tablet/mobile) — open Live as fullscreen to avoid layout shift
  useEffect(() => {
    const update = () => setIsCompactScreen(window.innerWidth < 1280);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Reset canvas scroll when Live panel opens/closes
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.scrollTop = 0;
    }
  }, [showLive]);


  const defaults: Record<string, any> = {
    llm:         { modelId: '', prompt: '', temperature: 0.7 },
    http:        { url: '', method: 'GET', headers: {}, body: '' },
    condition:   { expression: '', trueLabel: 'Yes', falseLabel: 'No' },
    loop:        { items: '', variable: 'item', maxIterations: 100 },
    code:        { language: 'javascript', code: '' },
    agent:       { task: '', useContextAgent: true, agentId: '', tools: [], timeoutSeconds: 300, maxRetries: 3, retryDelaySeconds: 10 },
    subworkflow: { workflowId: '', inputMapping: '' },
    transform:   { expression: '', outputVariable: 'result' },
    delay:       { duration: 1000 },
    alert:       { message: '', level: 'info' },
  };

  const addNode = (type: string) => {
    const m = NODE_META[type] || NODE_META.trigger;
    const n: WorkflowNode = { id: generateId(), type: type as any, label: m.label, config: defaults[type] || {}, position: { x: 0, y: 0 } };
    setNodes(prev => [...prev, n]);
    setExpandedId(n.id);
  };

  const removeNode = (id: string) => setNodes(prev => prev.filter(n => n.id !== id));
  const moveNode = (i: number, dir: 'up' | 'down') => setNodes(prev => {
    const arr = [...prev];
    if (dir === 'up' && i > 0) [arr[i], arr[i-1]] = [arr[i-1], arr[i]];
    if (dir === 'down' && i < arr.length-1) [arr[i], arr[i+1]] = [arr[i+1], arr[i]];
    return arr;
  });
  const updateCfg = (id: string, k: string, v: any) => setNodes(prev => prev.map(n => n.id === id ? { ...n, config: { ...n.config, [k]: v } } : n));
  const updateLabel = (id: string, v: string) => setNodes(prev => prev.map(n => n.id === id ? { ...n, label: v } : n));

  const handleSave = () => {
    const fs = { ...schedule };
    if (fs.enabled) fs.nextRun = calculateNextRun(fs.type, fs.time, fs.days, timezone);
    else fs.nextRun = undefined;
    const tid = generateId();
    const trigger: WorkflowNode = { id: tid, type: 'trigger', label: 'Start', config: {}, position: { x: 0, y: 0 } };
    const finalNodes = [trigger, ...nodes];
    const edges = finalNodes.slice(0,-1).map((n, i) => ({ id: `e-${n.id}-${finalNodes[i+1].id}`, source: n.id, target: finalNodes[i+1].id }));
    onSave({ ...workflow, name, description, agentId, nodes: finalNodes, edges, schedule: fs });
    onBack();
  };

  const agent = agents.find(a => a.id === agentId);

  return (
    <div className="flex flex-col overflow-hidden bg-white dark:bg-dark-950 text-slate-900 dark:text-slate-200 transition-colors" style={{ height: '100%' }}>
      {/* Top bar */}
      <div className="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-colors">
        <button onClick={onBack} className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        <div className="w-px h-5 bg-slate-200 dark:bg-slate-800" />
        <input value={name} onChange={e => setName(e.target.value)}
          className="bg-transparent text-sm font-bold text-slate-900 dark:text-white outline-none border-b border-transparent focus:border-slate-400 dark:focus:border-slate-600 transition-colors w-64 placeholder-slate-400 dark:placeholder-slate-600"
          placeholder="Pipeline name..." />
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-nebula-500" />
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 font-mono">{nodes.length} step{nodes.length !== 1 ? 's' : ''}</span>
        </div>
        {agent && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <div className="w-2 h-2 rounded-full" style={{ background: agent.color }} />
            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">{agent.name}</span>
          </div>
        )}
        <div className="flex-1" />
        {/* Live button */}
        <button onClick={() => {
          const next = !showLive;
          setShowLive(next);
          setShowHistory(false);
          if (next && isCompactScreen) setLiveFullscreen(true);
          if (!next) setLiveFullscreen(false);
        }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${showLive ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <span className="relative flex h-2 w-2">
            <span className={`${showLive ? 'animate-ping' : ''} absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${showLive ? 'bg-emerald-500' : 'bg-slate-600'}`} />
          </span>
          Live
        </button>
        {/* History button */}
        <button onClick={() => { setShowHistory(v => !v); setShowLive(false); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-colors ${showHistory ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white' : 'bg-slate-100 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-600'}`}>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          History
        </button>
        <button onClick={() => onRun({ ...workflow, nodes: [{ id: generateId(), type: 'trigger', label: 'Start', config: {}, position: {x:0,y:0} }, ...nodes] })}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>
          Run
        </button>
        <button onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-nebula-600 hover:bg-nebula-700 text-white text-xs font-bold shadow-lg shadow-nebula-600/20 transition-colors">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          Save
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left sidebar — config ── */}
        <div className="w-80 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 overflow-y-auto transition-colors">

          {/* Config */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">Config</p>
            <div>
              <label className={LC}>Agent</label>
              <select value={agentId} onChange={e => setAgentId(e.target.value)} className={IC}>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LC}>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className={TA} placeholder="What does this pipeline do?" />
            </div>
          </div>

          {/* Schedule */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">Schedule</p>
              <button onClick={() => setSchedule(s => ({ ...s, enabled: !s.enabled }))}
                className={`w-8 h-4 rounded-full transition-colors relative ${schedule.enabled ? 'bg-nebula-600' : 'bg-slate-700'}`}>
                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${schedule.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {schedule.enabled && (
              <div className="space-y-2">
                <div>
                  <label className={LC}>Frequency</label>
                  <select value={schedule.type} onChange={e => setSchedule(s => ({ ...s, type: e.target.value as any }))} className={IC}>
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </div>
                <div>
                  <label className={LC}>Time</label>
                  <input type="text" pattern="[0-9]{2}:[0-9]{2}" maxLength={5} value={schedule.time || ''} onChange={e => setSchedule(s => ({ ...s, time: e.target.value }))} className={IC} placeholder="09:00" />
                </div>
                {schedule.type === 'weekly' && (
                  <div>
                    <label className={LC}>Days</label>
                    <div className="flex gap-1 flex-wrap">
                      {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => (
                        <button key={d} onClick={() => {
                          const days = schedule.days || [];
                          setSchedule(s => ({ ...s, days: days.includes(i) ? days.filter(x => x !== i) : [...days, i] }));
                        }} className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${(schedule.days || []).includes(i) ? 'bg-nebula-500/20 text-nebula-400 border-nebula-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Node types reference */}
          <div className="p-4">
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest mb-3">Node types</p>
            <div className="space-y-2">
              {ADD_TYPES.map(type => {
                const m = NODE_META[type];
                return (
                  <div key={type} className="flex items-start gap-2">
                    <span className={`${m.color} mt-0.5 shrink-0`}><NodeIcon type={type} sz={3} /></span>
                    <div>
                      <div className="text-[10px] font-bold text-slate-400">{m.label}</div>
                      <div className="text-[9px] text-slate-700">{m.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Canvas ── */}
        <div ref={canvasRef} className="flex-1 overflow-y-auto bg-slate-100 dark:bg-[#08080d] relative transition-colors">
          <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.025]" style={{ backgroundImage: 'radial-gradient(circle, #94a3b8 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
          <div className="relative max-w-lg mx-auto px-6 py-8 pb-32">

            {/* Trigger */}
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-xs font-black text-emerald-400 uppercase tracking-widest">Trigger</div>
                <div className="text-[10px] text-slate-600">Manual or scheduled execution</div>
              </div>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/15">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Entry</span>
              </div>
            </div>

            {/* Nodes */}
            {nodes.length === 0 ? (
              <>
                <div className="flex justify-center py-3"><div className="w-px h-6 bg-slate-200 dark:bg-slate-800" /></div>
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center">
                  <p className="text-slate-500 dark:text-slate-600 text-xs font-bold mb-1">No steps yet</p>
                  <p className="text-slate-400 dark:text-slate-700 text-[11px]">Add your first step from the panel below</p>
                </div>
              </>
            ) : (
              nodes.map((node, i) => (
                <div key={node.id}>
                  <div className="flex justify-center py-1"><div className="w-px h-3 bg-slate-200 dark:bg-slate-800" /></div>
                  <NodeCard
                    node={node} idx={i} total={nodes.length}
                    agents={agents} models={models} workflows={workflows}
                    expanded={expandedId === node.id}
                    onToggle={() => setExpandedId(expandedId === node.id ? null : node.id)}
                    onMove={(dir: 'up' | 'down') => moveNode(i, dir)}
                    onRemove={() => removeNode(node.id)}
                    onLabel={(v: string) => updateLabel(node.id, v)}
                    onCfg={(k: string, v: any) => updateCfg(node.id, k, v)}
                  />
                </div>
              ))
            )}

            {/* Add strip */}
            <div className="mt-2">
              <div className="flex justify-center py-1"><div className="w-px h-3 bg-slate-200 dark:bg-slate-800" /></div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4">
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest mb-3 text-center">Add step</p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {ADD_TYPES.map(type => {
                    const m = NODE_META[type];
                    return (
                      <button key={type} onClick={() => addNode(type)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 ${m.bg} ${m.border} ${m.color}`}>
                        <NodeIcon type={type} sz={3} />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Live Log panel ── */}
        {showLive && !liveFullscreen && !isCompactScreen && (
          <div className="w-96 shrink-0 min-h-0 flex flex-col">
            <LiveLog
              workflowName={name}
              workflowId={workflow.id}
              onClose={() => setShowLive(false)}
              fullscreen={false}
              onToggleFullscreen={() => setLiveFullscreen(true)}
            />
          </div>
        )}

        {/* ── Run History panel ── */}
        {showHistory && (
          <div className="w-72 shrink-0">
            <RunHistory workflowName={name} onClose={() => setShowHistory(false)} />
          </div>
        )}
      </div>

      {/* ── Live Log fullscreen overlay ── */}
      {showLive && liveFullscreen && (
        <LiveLog
          workflowName={name}
          workflowId={workflow.id}
          onClose={() => { setShowLive(false); setLiveFullscreen(false); }}
          fullscreen={true}
          onToggleFullscreen={() => setLiveFullscreen(false)}
        />
      )}
    </div>
  );
};

export default WorkflowEditor;
