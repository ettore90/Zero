import React, { useState, useEffect } from 'react';
import { APP_BASE_PATH } from '../../constants';

const LOCAL_BASE = window.location.pathname.split('/').slice(0, 2).join('/') || APP_BASE_PATH;

interface RunEvent { event: string; timestamp: string; [k: string]: any; }
interface Run {
  id: string; workflowName: string; workflowId?: string;
  startedAt: string; finishedAt?: string; status: 'running'|'success'|'failed';
  events: RunEvent[];
}

const RunHistory: React.FC<{ workflowName: string; onClose: () => void }> = ({ workflowName, onClose }) => {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${LOCAL_BASE}/api/workflow-runs?workflowName=${encodeURIComponent(workflowName)}`)
      .then(r => r.json())
      .then(d => { setRuns(d.runs || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [workflowName]);

  const fmt = (ts: string) => {
    try { return new Date(ts).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }); }
    catch { return ts; }
  };

  const statusColor = (s: string) =>
    s === 'success' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
    s === 'failed'  ? 'text-red-400 bg-red-500/10 border-red-500/20' :
                      'text-amber-400 bg-amber-500/10 border-amber-500/20';

  const eventColor = (e: string) =>
    e.includes('fail') || e.includes('error') || e.includes('exception') ? 'text-red-400' :
    e.includes('success') || e.includes('complete') ? 'text-emerald-400' :
    e.includes('start') ? 'text-sky-400' : 'text-slate-400';

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 shrink-0">
        <div>
          <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Run History</p>
          <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold truncate max-w-[180px]">{workflowName}</p>
        </div>
        <button onClick={onClose} className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {selectedRun ? (
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <button onClick={() => setSelectedRun(null)} className="p-1 rounded text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            </button>
            <div className="flex-1 min-w-0"><p className="text-[10px] text-slate-500">{fmt(selectedRun.startedAt)}</p></div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${statusColor(selectedRun.status)}`}>{selectedRun.status}</span>
          </div>
          <div className="p-3 space-y-1">
            {selectedRun.events.map((ev, i) => (
              <div key={i} className="flex gap-2 text-[10px] font-mono">
                <span className="text-slate-400 dark:text-slate-600 shrink-0 w-14 truncate">{ev.timestamp?.slice(11,19)}</span>
                <span className={`font-bold shrink-0 ${eventColor(ev.event)}`}>{ev.event}</span>
                <span className="text-slate-500 truncate">{Object.entries(ev).filter(([k]) => !['event','timestamp','workflow','workflowId','workflowName'].includes(k)).map(([k,v]) => `${k}=${typeof v === 'string' ? v.slice(0,60) : JSON.stringify(v).slice(0,60)}`).join(' ')}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-6 text-center text-slate-400 dark:text-slate-600 text-xs">Loading...</div>}
          {!loading && runs.length === 0 && <div className="p-6 text-center text-slate-400 dark:text-slate-600 text-xs">No runs found for this pipeline.</div>}
          {!loading && runs.map(run => (
            <button key={run.id} onClick={() => setSelectedRun(run)} className="w-full text-left px-4 py-3 border-b border-slate-200 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{fmt(run.startedAt)}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider ${statusColor(run.status)}`}>{run.status}</span>
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-600">{run.events.length} events{run.finishedAt && ` · ${Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s`}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default RunHistory;
