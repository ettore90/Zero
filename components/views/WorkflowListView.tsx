// =============================================================================
// WorkflowListView.tsx — Lista de pipelines de automação
// =============================================================================

import React from 'react';
import { Workflow } from '../../types';
import { generateId } from '../../utils/helpers';

interface WorkflowListViewProps {
    workflows: Workflow[];
    activeAgentId: string;
    setWorkflows: (wf: Workflow[]) => void;
    saveField: (field: string, value: any) => Promise<void>;
    setEditingWorkflowId: (id: string) => void;
    handleRunWorkflow: (wf: Workflow, isAuto?: boolean) => void;
}

const WorkflowListView: React.FC<WorkflowListViewProps> = ({
    workflows, activeAgentId, setWorkflows, saveField, setEditingWorkflowId, handleRunWorkflow,
}) => {
    return (
        <div className="h-full overflow-y-auto bg-white dark:bg-dark-950 transition-colors">
            {/* Header */}
            <div className="sticky top-0 z-10 bg-white dark:bg-dark-900 border-b border-slate-200 dark:border-slate-800 px-8 py-4 flex items-center justify-between transition-colors">
                <div>
                    <h1 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-widest">Automation Pipelines</h1>
                    <p className="text-[11px] text-slate-500 mt-0.5">Chain agents and tools into executable logic flows.</p>
                </div>
                <button
                    onClick={() => {
                        const nw: Workflow = { id: generateId(), name: 'New Pipeline', description: '', agentId: activeAgentId, nodes: [], edges: [], status: 'active' };
                        const updated = [...workflows, nw];
                        setWorkflows(updated);
                        saveField('workflows', updated);
                        setEditingWorkflowId(nw.id);
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-nebula-600 hover:bg-nebula-700 text-white text-xs font-bold shadow-lg shadow-nebula-600/20 transition-colors"
                >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    New Pipeline
                </button>
            </div>

            {/* List */}
            <div className="max-w-4xl mx-auto px-8 py-6 space-y-3">
                {workflows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-32 text-center">
                        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mb-4">
                            <svg className="h-7 w-7 text-slate-400 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        </div>
                        <p className="text-slate-500 font-bold text-sm">No pipelines yet</p>
                        <p className="text-slate-400 dark:text-slate-600 text-xs mt-1">Create your first automation pipeline above.</p>
                    </div>
                ) : (
                    workflows.map(wf => {
                        const stepCount = (wf.nodes || []).filter((n: any) => n.type !== 'trigger').length;
                        const nodeTypes = [...new Set((wf.nodes || []).filter((n: any) => n.type !== 'trigger').map((n: any) => n.type as string))];
                        const schedEnabled = wf.schedule?.enabled;
                        const schedLabel = schedEnabled ? `${wf.schedule?.type} @ ${wf.schedule?.time}` : null;
                        const isPaused = wf.status === 'paused';
                        return (
                            <div key={wf.id} onClick={() => setEditingWorkflowId(wf.id)} className={`group relative rounded-2xl border bg-white dark:bg-slate-900 hover:shadow-sm transition-all duration-150 cursor-pointer ${isPaused ? 'border-slate-200 dark:border-slate-800/60 opacity-60' : 'border-slate-200 dark:border-slate-800 hover:border-nebula-400 dark:hover:border-nebula-500/40 dark:hover:bg-slate-900/80'}`}>
                                <div className="p-5 flex items-start gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">{wf.name}</h3>
                                            {isPaused && (
                                                <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Disabled</span>
                                            )}
                                            {!isPaused && schedEnabled && (
                                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider shrink-0">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                    {schedLabel}
                                                </span>
                                            )}
                                            {!isPaused && !schedEnabled && (
                                                <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Manual</span>
                                            )}
                                        </div>
                                        <p className="text-[11px] text-slate-500 mb-2 truncate">{wf.description || 'No description'}</p>
                                        <div className="flex flex-wrap gap-1.5">
                                            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                                                {stepCount} step{stepCount !== 1 ? 's' : ''}
                                            </span>
                                            {nodeTypes.map((t: string) => (
                                                <span key={t} className="px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                        {/* Enable / Disable toggle */}
                                        <button
                                            onClick={() => {
                                                const next = wf.status === 'paused' ? 'active' : 'paused';
                                                const updated = workflows.map(w => w.id === wf.id ? { ...w, status: next as 'active' | 'paused' } : w);
                                                setWorkflows(updated);
                                                saveField('workflows', updated);
                                            }}
                                            title={wf.status === 'paused' ? 'Enable workflow' : 'Disable workflow'}
                                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${
                                                wf.status === 'paused'
                                                    ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-300 dark:hover:border-emerald-500/30'
                                                    : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/25 text-emerald-600 dark:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-700 hover:text-slate-500 dark:hover:text-slate-400'
                                            }`}
                                        >
                                            {wf.status === 'paused' ? (
                                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" /></svg>
                                            ) : (
                                                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                                            )}
                                            {wf.status === 'paused' ? 'Enable' : 'Disable'}
                                        </button>
                                        <button
                                            onClick={() => handleRunWorkflow(wf)}
                                            title="Run now"
                                            disabled={wf.status === 'paused'}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>
                                            Run
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (!confirm(`Delete "${wf.name}"?`)) return;
                                                const updated = workflows.filter(w => w.id !== wf.id);
                                                setWorkflows(updated);
                                                saveField('workflows', updated);
                                            }}
                                            title="Delete"
                                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-500/30 transition-colors"
                                        >
                                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default WorkflowListView;
