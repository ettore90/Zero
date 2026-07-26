import React, { useState } from 'react';

// ---------------------------------------------------------------------------
// StrategyPlanModal
// Mostrado quando o agente mestre chama request_plan_approval.
// Exibe o plano estratégico (objetivo, abordagem, riscos, checklist)
// e permite ao usuário aprovar, rejeitar ou editar antes de executar.
// ---------------------------------------------------------------------------

interface StrategyPlan {
  title?: string;
  objective?: string;
  approach?: string;
  risks?: string;
  checklist?: string[] | { text?: string; done?: boolean }[];
}

interface StrategyPlanModalProps {
  plan: StrategyPlan;
  agentName: string;
  onApprove: () => void;
  onReject: () => void;
}

export const StrategyPlanModal: React.FC<StrategyPlanModalProps> = ({
  plan,
  agentName,
  onApprove,
  onReject,
}) => {
  const normalizedChecklist = Array.isArray(plan?.checklist)
    ? plan.checklist.map(item => typeof item === 'string' ? item : (item?.text ?? '')).filter(Boolean)
    : [];
  const [checklist, setChecklist] = useState<string[]>(normalizedChecklist);
  const [newItem, setNewItem] = useState('');
  const [checked, setChecked] = useState<boolean[]>(normalizedChecklist.map(() => false));
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const toggleCheck = (i: number) => {
    const next = [...checked];
    next[i] = !next[i];
    setChecked(next);
  };

  const removeItem = (i: number) => {
    setChecklist(prev => prev.filter((_, idx) => idx !== i));
    setChecked(prev => prev.filter((_, idx) => idx !== i));
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    setChecklist(prev => [...prev, newItem.trim()]);
    setChecked(prev => [...prev, false]);
    setNewItem('');
  };

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setEditValue(checklist[i]);
  };

  const saveEdit = () => {
    if (editingIdx === null) return;
    const next = [...checklist];
    next[editingIdx] = editValue;
    setChecklist(next);
    setEditingIdx(null);
  };

  const hasRisks = plan.risks && plan.risks.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 flex items-center justify-center text-xl shrink-0">🧠</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white truncate">{plan.title ?? 'Execution Plan'}</h2>
              {hasRisks && (
                <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded shrink-0">
                  ⚠ risks
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">{agentName} is requesting approval to proceed</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Objective */}
          <section>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Objective</span>
            <p className="text-[12px] text-slate-200 leading-relaxed">{plan.objective ?? ''}</p>
          </section>

          {/* Approach */}
          <section>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-1">Approach</span>
            <p className="text-[12px] text-slate-300 leading-relaxed whitespace-pre-wrap">{plan.approach ?? ''}</p>
          </section>

          {/* Risks */}
          {hasRisks && (
            <section className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
              <span className="text-[9px] font-black uppercase tracking-widest text-amber-400 block mb-1">⚠ Risks & Side Effects</span>
              <p className="text-[12px] text-amber-200/80 leading-relaxed whitespace-pre-wrap">{plan.risks}</p>
            </section>
          )}

          {/* Checklist */}
          <section>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-2">
              Checklist
              <span className="ml-2 text-slate-600 normal-case font-normal">— edit, reorder or add steps</span>
            </span>
            <div className="space-y-1.5">
              {checklist.map((item, i) => (
                <div key={i} className="flex items-start gap-2 group">
                  <button
                    type="button"
                    onClick={() => toggleCheck(i)}
                    className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
                      checked[i]
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'border-slate-600 hover:border-slate-400'
                    }`}
                  >
                    {checked[i] && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </button>

                  {editingIdx === i ? (
                    <div className="flex-1 flex gap-1">
                      <input
                        className="flex-1 text-[11px] bg-slate-800 border border-indigo-500 rounded px-2 py-0.5 text-slate-200 outline-none"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingIdx(null); }}
                        autoFocus
                      />
                      <button type="button" onClick={saveEdit} className="text-[10px] text-emerald-400 hover:text-emerald-300 px-1">✓</button>
                      <button type="button" onClick={() => setEditingIdx(null)} className="text-[10px] text-slate-500 hover:text-slate-400 px-1">✕</button>
                    </div>
                  ) : (
                    <span
                      className={`flex-1 text-[12px] leading-snug cursor-pointer ${checked[i] ? 'line-through text-slate-600' : 'text-slate-200'}`}
                      onClick={() => startEdit(i)}
                    >
                      {item}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all text-[10px] shrink-0 mt-0.5"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Add item */}
            <div className="flex gap-2 mt-2">
              <input
                className="flex-1 text-[11px] bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-300 placeholder-slate-600 outline-none focus:border-indigo-500 transition-colors"
                placeholder="Add a step..."
                value={newItem}
                onChange={e => setNewItem(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
              />
              <button
                type="button"
                onClick={addItem}
                className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
              >
                + Add
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-800">
          <button
            type="button"
            onClick={onReject}
            className="px-4 py-2 rounded-xl text-[12px] font-semibold text-slate-400 hover:text-white hover:bg-slate-800 border border-slate-700 hover:border-slate-500 transition-all"
          >
            Reject
          </button>
          <div className="flex-1" />
          <p className="text-[10px] text-slate-600 mr-2">
            {checklist.filter((_, i) => checked[i]).length}/{checklist.length} reviewed
          </p>
          <button
            type="button"
            onClick={onApprove}
            className="px-5 py-2 rounded-xl text-[12px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-500/20"
          >
            Approve & Execute
          </button>
        </div>
      </div>
    </div>
  );
};

export default StrategyPlanModal;
