import React, { useState } from 'react';

export interface StrategyPlan {
  title?: string;
  objective?: string;
  approach?: string;
  risks?: string;
  checklist?: string[] | { text?: string; done?: boolean }[];
}

interface StrategyPlanModalProps {
  plan: StrategyPlan;
  agentName: string;
  onApprove: (revisedPlan?: StrategyPlan) => void;
  onReject: () => void;
  embedded?: boolean;
  primaryActionLabel?: string;
  onPrimaryAction?: (() => void) | null;
  hideRejectButton?: boolean;
  hidePrimaryButton?: boolean;
  reviewSummaryText?: string;
}

// ---------------------------------------------------------------------------
// StrategyPlanModal
// Mostrado quando o agente mestre chama request_plan_approval.
// Exibe o plano estratégico (objetivo, abordagem, riscos, checklist)
// e permite ao usuário aprovar, rejeitar ou editar antes de executar.
// ---------------------------------------------------------------------------

export const StrategyPlanModal: React.FC<StrategyPlanModalProps> = ({
  plan,
  agentName,
  onApprove,
  onReject,
  embedded = false,
  primaryActionLabel,
  onPrimaryAction = null,
  hideRejectButton = false,
  hidePrimaryButton = false,
  reviewSummaryText,
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

  const buildRevisedPlan = (): StrategyPlan => {
    const pendingNewItem = newItem.trim();
    const revisedChecklist = checklist.map((item, i) => ({ text: item, done: Boolean(checked[i]) }));

    if (pendingNewItem) {
      revisedChecklist.push({ text: pendingNewItem, done: false });
    }

    return {
      ...plan,
      checklist: revisedChecklist,
    };
  };

  return (
    <div className={embedded ? 'flex h-full min-h-0 min-w-0 w-full items-stretch justify-stretch bg-white dark:bg-slate-950' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'}>
      <div className={embedded ? 'flex h-full min-h-0 min-w-0 w-full flex-col bg-white text-slate-800 dark:bg-transparent dark:text-slate-100' : 'w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-100'}>

        {/* Header */}
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 flex items-center justify-center text-xl shrink-0">🧠</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-bold text-slate-900 dark:text-white">{plan.title ?? 'Execution Plan'}</h2>
              {hasRisks && (
                <span className="shrink-0 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                  ⚠ risks
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{agentName} is requesting approval to proceed</p>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Objective */}
          <section>
            <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-500">Objective</span>
            <p className="text-[12px] leading-relaxed text-slate-700 dark:text-slate-200">{plan.objective ?? ''}</p>
          </section>

          {/* Approach */}
          <section>
            <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-500">Approach</span>
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300">{plan.approach ?? ''}</p>
          </section>

          {/* Risks */}
          {hasRisks && (
            <section className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
              <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">⚠ Risks & Side Effects</span>
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-amber-900 dark:text-amber-200/80">{plan.risks}</p>
            </section>
          )}

          {/* Checklist */}
          <section>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-2">
              Checklist
              <span className="ml-2 font-normal normal-case text-slate-400 dark:text-slate-600">— edit, reorder or add steps</span>
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
                        : 'border-slate-300 hover:border-slate-400 dark:border-slate-600 dark:hover:border-slate-400'
                    }`}
                  >
                    {checked[i] && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </button>

                  {editingIdx === i ? (
                    <div className="flex-1 flex gap-1">
                      <input
                        className="flex-1 rounded border border-indigo-500 bg-white px-2 py-0.5 text-[11px] text-slate-800 outline-none dark:bg-slate-800 dark:text-slate-200"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingIdx(null); }}
                        autoFocus
                      />
                      <button type="button" onClick={saveEdit} className="text-[10px] text-emerald-400 hover:text-emerald-300 px-1">✓</button>
                      <button type="button" onClick={() => setEditingIdx(null)} className="px-1 text-[10px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-400">✕</button>
                    </div>
                  ) : (
                    <span
                      className={`flex-1 text-[12px] leading-snug cursor-pointer ${checked[i] ? 'line-through text-slate-400 dark:text-slate-600' : 'text-slate-800 dark:text-slate-200'}`}
                      onClick={() => startEdit(i)}
                    >
                      {item}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="mt-0.5 shrink-0 text-[10px] text-slate-400 opacity-0 transition-all group-hover:opacity-100 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* Add item */}
            <div className="flex gap-2 mt-2">
              <input
                className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:placeholder:text-slate-600"
                placeholder="Add a step..."
                value={newItem}
                onChange={e => setNewItem(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
              />
              <button
                type="button"
                onClick={addItem}
                className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] text-slate-600 transition-colors hover:border-slate-400 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-white"
              >
                + Add
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          {!hideRejectButton && (
            <button
              type="button"
              onClick={onReject}
              className="rounded-xl border border-slate-300 px-4 py-2 text-[12px] font-semibold text-slate-600 transition-all hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Reject
            </button>
          )}
          <div className="flex-1" />
          <p className="mr-2 text-[10px] text-slate-500 dark:text-slate-600">
            {reviewSummaryText ?? `${checklist.filter((_, i) => checked[i]).length}/${checklist.length} reviewed`}
          </p>
          {!hidePrimaryButton && (
            <button
              type="button"
              onClick={() => onPrimaryAction ? onPrimaryAction() : onApprove(buildRevisedPlan())}
              className="px-5 py-2 rounded-xl text-[12px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-500/20"
            >
              {primaryActionLabel ?? 'Approve & Execute'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StrategyPlanModal;
