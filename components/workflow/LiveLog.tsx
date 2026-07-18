import React, { useState, useEffect, useRef } from 'react';
import { APP_BASE_PATH } from '../../constants';

const LOCAL_BASE = window.location.pathname.split('/').slice(0, 2).join('/') || APP_BASE_PATH;

interface LiveLogProps {
  workflowName: string;
  workflowId?: string;
  onClose: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const LiveLog: React.FC<LiveLogProps> = ({ workflowName, workflowId, onClose, fullscreen, onToggleFullscreen }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [, setLastCount] = useState(0);
  const latestRunWorkflowId = useRef<string | undefined>(workflowId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = () => {
    fetch(`${LOCAL_BASE}/api/workflow-runs?workflowName=${encodeURIComponent(workflowName)}`)
      .then(r => r.json())
      .then(d => {
        const runs: any[] = d.runs || [];
        const latest = runs[0];
        if (!latest) return;
        const evs = latest.events || [];
        setEvents(evs);
        const running = latest.status === 'running';
        setIsRunning(running);
        if (!running) setCancelling(false);
        setLastCount(evs.length);
        if (latest.workflowId) latestRunWorkflowId.current = latest.workflowId;
      })
      .catch(() => {});
  };

  const handleCancel = () => {
    const wfId = latestRunWorkflowId.current || workflowId;
    if (!wfId) return;
    setCancelling(true);
    fetch(`${LOCAL_BASE}/api/workflow-runs/cancel`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflowId: wfId }),
    }).catch(() => setCancelling(false));
  };

  useEffect(() => {
    fetchLogs();
    intervalRef.current = setInterval(fetchLogs, 2000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [workflowName]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events.length]);

  const eventColor = (e: string) => {
    if (!e) return 'text-slate-500';
    if (e.includes('fail') || e.includes('error') || e.includes('exception') || e.includes('cancel')) return 'text-red-400';
    if (e.includes('success') || e.includes('complete')) return 'text-emerald-400';
    if (e.includes('start')) return 'text-sky-400';
    if (e.includes('skip')) return 'text-amber-400';
    if (e === 'agent_tool_call') return 'text-violet-400';
    if (e === 'agent_tool_result') return 'text-indigo-400';
    if (e === 'agent_thinking') return 'text-slate-300';
    return 'text-slate-400';
  };

  const fmtExtra = (ev: any) => Object.entries(ev).filter(([k]) => !['event','timestamp','workflow','workflowId','workflowName'].includes(k)).map(([k,v]) => `${k}=${(typeof v === 'string' ? v : JSON.stringify(v)).slice(0,80)}`).join('  ');
  const containerCls = fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-white dark:bg-black' : 'flex-1 flex flex-col bg-white dark:bg-black border-l border-slate-200 dark:border-slate-800 min-h-0 overflow-hidden';

  return (
    <div className={containerCls}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isRunning ? <span className="relative flex h-2 w-2 shrink-0"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span> : <span className="w-2 h-2 rounded-full bg-slate-700 shrink-0" />}
          <span className="text-[10px] font-black text-slate-500 dark:text-slate-300 uppercase tracking-widest truncate">{isRunning ? 'Live' : 'Last run'} — {workflowName}</span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono shrink-0">{events.length} events</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isRunning && <button onClick={handleCancel} disabled={cancelling} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold border transition-colors ${cancelling ? 'text-slate-500 border-slate-700 bg-slate-800 cursor-not-allowed' : 'text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20'}`}>{cancelling ? 'Cancelling...' : 'Cancel'}</button>}
          {onToggleFullscreen && <button onClick={onToggleFullscreen} className="p-1 rounded text-slate-400 hover:text-white transition-colors" title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>⛶</button>}
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white transition-colors">✕</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-0.5">
        {events.length === 0 && <div className="text-slate-400 dark:text-slate-600 text-center py-8">Nenhum evento ainda...</div>}
        {events.map((ev, i) => (
          <div key={i} className="flex gap-2 leading-5 hover:bg-slate-100 dark:hover:bg-white/[0.03] px-1 rounded">
            <span className="text-slate-400 dark:text-slate-600 shrink-0 w-[52px]">{ev.timestamp?.slice(11, 19)}</span>
            <span className={`font-bold shrink-0 w-36 truncate ${eventColor(ev.event)}`}>{ev.event}</span>
            <span className="text-slate-500 dark:text-slate-400 truncate">{fmtExtra(ev)}</span>
          </div>
        ))}
        {isRunning && <div className="flex gap-2 leading-5 px-1"><span className="text-slate-400 dark:text-slate-600 shrink-0 w-[52px]">···</span><span className="text-emerald-500 dark:text-emerald-400 animate-pulse font-bold">running</span></div>}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default LiveLog;
