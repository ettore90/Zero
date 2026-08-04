import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface StrategyPlanComment { id?: string; author?: string; role?: 'agent' | 'user'; text?: string; createdAt?: number; }
export interface StrategyPlanChecklistItem { id?: string; text?: string; done?: boolean; comments?: StrategyPlanComment[]; }
export interface StrategyPlan {
  title?: string;
  objective?: string;
  approach?: string;
  risks?: string;
  checklist?: string[] | StrategyPlanChecklistItem[];
}

interface StrategyPlanModalProps {
  plan: StrategyPlan;
  agentName: string;
  onApprove: (revisedPlan?: StrategyPlan) => void;
  onReject?: () => void;
  embedded?: boolean;
  primaryActionLabel?: string;
  onPrimaryAction?: (() => void) | null;
  hideRejectButton?: boolean;
  hidePrimaryButton?: boolean;
  reviewSummaryText?: string;
  status?: 'open' | 'in_progress' | 'completed' | 'canceled';
  onCommentItem?: (itemId: string | undefined, itemText: string | undefined, text: string) => Promise<void> | void;
  onCompleteItem?: (itemId: string | undefined, itemText: string | undefined, done?: boolean) => Promise<void> | void;
  readOnly?: boolean;
}

type LocalChecklistItem = {
  id?: string;
  localKey: string;
  text: string;
  done: boolean;
  comments: StrategyPlanComment[];
};

type ChecklistItemIdentity = string;

const createStableItemId = (() => {
  let counter = 0;
  return () => `item_${Date.now()}_${++counter}`;
})();

const createLocalItemKey = (() => {
  let counter = 0;
  return () => `local-item-${++counter}`;
})();

const createLocalComment = (text: string): StrategyPlanComment => ({
  id: `comment_${Date.now()}`,
  text,
  role: 'user',
  createdAt: Date.now(),
});

const normalizeChecklist = (plan: StrategyPlan): LocalChecklistItem[] => (
  Array.isArray(plan?.checklist)
    ? plan.checklist
        .map((item, index) => typeof item === 'string'
          ? { id: `item_${index + 1}`, localKey: `item_${index + 1}`, text: item, done: false, comments: [] }
          : {
              id: item?.id,
              localKey: item?.id || createLocalItemKey(),
              text: item?.text ?? '',
              done: Boolean(item?.done),
              comments: Array.isArray(item?.comments) ? item.comments : [],
            })
        .filter(item => item.text)
    : []
);


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
  status,
  onCommentItem,
  onCompleteItem,
  readOnly = false,
}) => {
  const structuredChecklist = useMemo(() => normalizeChecklist(plan), [plan]);
  const [items, setItems] = useState<LocalChecklistItem[]>(structuredChecklist);
  const [newItem, setNewItem] = useState('');
  const [editingKey, setEditingKey] = useState<ChecklistItemIdentity | null>(null);
  const [editValue, setEditValue] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<ChecklistItemIdentity, string>>({});
  const [commentBusy, setCommentBusy] = useState<Record<ChecklistItemIdentity, boolean>>({});
  const [commentErrors, setCommentErrors] = useState<Record<ChecklistItemIdentity, string>>({});
  const [completionErrors, setCompletionErrors] = useState<Record<ChecklistItemIdentity, string>>({});
  const [openCommentKey, setOpenCommentKey] = useState<ChecklistItemIdentity | null>(null);
  const hasCommentSupport = typeof onCommentItem === 'function' && !readOnly;
  const nextLocalKeyRef = useRef(0);
  const COMMENT_MAX_LENGTH = 4000;

  useEffect(() => {
    setItems(structuredChecklist);
  }, [structuredChecklist]);

  const getItemIdentity = (item: LocalChecklistItem, _index?: number): ChecklistItemIdentity => item.id || item.localKey;

  const toggleCheck = async (identity: ChecklistItemIdentity) => {
    const item = items.find(current => getItemIdentity(current) === identity);
    if (!item) return;
    const nextDone = !item.done;
    setCompletionErrors(prev => { const next = { ...prev }; delete next[identity]; return next; });
    setItems(prev => prev.map(current => getItemIdentity(current) === identity ? { ...current, done: nextDone } : current));
    if (nextDone && typeof onCompleteItem === 'function') {
      try {
        await onCompleteItem(item.id, item.text, nextDone);
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : 'Failed to mark checklist item as done.';
        setItems(prev => prev.map(current => getItemIdentity(current) === identity ? { ...current, done: false } : current));
        setCompletionErrors(prev => ({ ...prev, [identity]: message }));
        throw error;
      }
    }
  };

  const removeItem = (identity: ChecklistItemIdentity) => {
    setItems(prev => prev.filter(item => getItemIdentity(item) !== identity));
    setCommentDrafts(prev => { const next = { ...prev }; delete next[identity]; return next; });
    setCommentBusy(prev => { const next = { ...prev }; delete next[identity]; return next; });
    setCommentErrors(prev => { const next = { ...prev }; delete next[identity]; return next; });
    setCompletionErrors(prev => { const next = { ...prev }; delete next[identity]; return next; });
    setOpenCommentKey(prev => prev === identity ? null : prev);
    setEditingKey(prev => prev === identity ? null : prev);
  };

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setItems(prev => [...prev, { id: createStableItemId(), localKey: `local-item-${++nextLocalKeyRef.current}`, text, done: false, comments: [] }]);
    setNewItem('');
  };

  const startEdit = (identity: ChecklistItemIdentity, item: LocalChecklistItem) => {
    setEditingKey(identity);
    setEditValue(item.text || '');
  };

  const saveEdit = () => {
    if (editingKey === null) return;
    setItems(prev => prev.map((item, idx) => getItemIdentity(item, idx) === editingKey ? { ...item, text: editValue } : item));
    setEditingKey(null);
  };

  const hasRisks = plan.risks && plan.risks.trim().length > 0;

  const statusLabel = status === 'open' ? 'Open' : status === 'in_progress' ? 'In progress' : status === 'canceled' ? 'Canceled' : status === 'completed' ? 'Completed' : null;
  const statusClass = status === 'open'
    ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
    : status === 'in_progress'
    ? 'border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'
    : status === 'canceled'
    ? 'border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
    : status === 'completed'
    ? 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
    : '';

  const buildRevisedPlan = (): StrategyPlan => {
    const pendingNewItem = newItem.trim();
    const revisedChecklist = items.map((item) => ({
      id: item.id,
      text: item.text,
      done: item.done,
      comments: item.comments || [],
    }));
    if (pendingNewItem) {
      revisedChecklist.push({ id: createStableItemId(), text: pendingNewItem, done: false, comments: [] });
    }
    return { ...plan, checklist: revisedChecklist };
  };

  return (
    <div className={embedded ? 'flex h-full min-h-0 min-w-0 w-full items-stretch justify-stretch bg-white dark:bg-slate-950' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'}>
      <div className={embedded ? 'flex h-full min-h-0 min-w-0 w-full flex-col bg-white text-slate-800 dark:bg-transparent dark:text-slate-100' : 'w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-100'}>
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/20 flex items-center justify-center text-xl shrink-0">🧠</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="truncate text-sm font-bold text-slate-900 dark:text-white">{plan.title ?? 'Execution Plan'}</h2>
              {statusLabel && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusClass}`}>{statusLabel}</span>}
              {hasRisks && <span className="shrink-0 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">⚠ risks</span>}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{agentName} is requesting approval to proceed</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <section>
            <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-500">Objective</span>
            <p className="text-[12px] leading-relaxed text-slate-700 dark:text-slate-200">{plan.objective ?? ''}</p>
          </section>

          <section>
            <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-500">Approach</span>
            <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-slate-700 dark:text-slate-300">{plan.approach ?? ''}</p>
          </section>

          {hasRisks && (
            <section className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
              <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">⚠ Risks & Side Effects</span>
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-amber-900 dark:text-amber-200/80">{plan.risks}</p>
            </section>
          )}

          <section>
            <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 block mb-2">
              Checklist
              <span className="ml-2 font-normal normal-case text-slate-400 dark:text-slate-600">— edit, reorder or add steps</span>
            </span>
            <div className="space-y-3">
              {items.map((item, i) => {
                const itemKey = getItemIdentity(item, i);
                return (
                  <div key={itemKey} className="space-y-1.5">
                    <div className="group flex items-center gap-2 rounded-lg pr-1 sm:pr-0">
                      <button
                        type="button"
                        onClick={() => !readOnly && void toggleCheck(itemKey)}
                        className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${item.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 hover:border-slate-400 focus-visible:border-slate-400 dark:border-slate-600 dark:hover:border-slate-400'}`}
                      >
                        {item.done && <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                      </button>

                      {editingKey === itemKey ? (
                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                          <input
                            className="min-w-0 flex-1 rounded border border-indigo-500 bg-white px-2 py-1 text-[11px] text-slate-800 outline-none dark:bg-slate-800 dark:text-slate-200"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingKey(null); }}
                            autoFocus
                          />
                          <div className="flex gap-1 sm:shrink-0">
                            <button type="button" onClick={saveEdit} className="rounded border border-emerald-500 px-2 py-1 text-[10px] font-semibold text-emerald-600 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-500/10">Save</button>
                            <button type="button" onClick={() => setEditingKey(null)} className="rounded border border-slate-300 px-2 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:text-slate-200">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { if (!readOnly) startEdit(itemKey, item); }}
                          className={`min-w-0 flex-1 rounded text-left text-[12px] leading-snug ${readOnly ? 'cursor-default' : 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40'} ${item.done ? 'line-through text-slate-400 dark:text-slate-600' : 'text-slate-800 dark:text-slate-200'}`}
                        >
                          {item.text}
                        </button>
                      )}

                      {!readOnly && editingKey !== itemKey && (
                        <div className={openCommentKey === itemKey
                          ? 'flex shrink-0 items-center gap-1 opacity-100 transition-opacity'
                          : 'flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-70 sm:group-hover:opacity-100 sm:focus-within:opacity-100'}>
                          <button
                            type="button"
                            onClick={() => setOpenCommentKey(openCommentKey === itemKey ? null : itemKey)}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 ${openCommentKey === itemKey ? 'border-indigo-400 text-indigo-600 dark:border-indigo-500 dark:text-indigo-300' : 'hover:border-indigo-400 hover:text-indigo-600 dark:hover:border-indigo-500 dark:hover:text-indigo-300'}`}
                            aria-label={openCommentKey === itemKey ? 'Close comment composer' : 'Add comment'}
                            title={openCommentKey === itemKey ? 'Close comment composer' : 'Add comment'}
                          >
                            {openCommentKey === itemKey ? (
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M18 6 6 18" />
                                <path d="m6 6 12 12" />
                              </svg>
                            ) : (
                              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
                              </svg>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeItem(itemKey)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition-colors hover:border-red-400 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-red-500 dark:hover:text-red-400"
                            aria-label="Remove item"
                            title="Remove item"
                          >
                            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M6 6l1 14h10l1-14" />
                              <path d="M10 11v5" />
                              <path d="M14 11v5" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>

                    {completionErrors[itemKey] && (
                      <div className="ml-6 rounded-md border border-rose-300/70 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                        {completionErrors[itemKey]}
                      </div>
                    )}

                  {Array.isArray(item.comments) && item.comments.length > 0 && (
                    <div className="ml-6 space-y-1">
                      {item.comments.map((comment, commentIndex) => (
                        <div key={comment?.id || `${i}-${commentIndex}`} className="rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900/70">
                          <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-500">
                            <span>{comment?.author || (comment?.role === 'user' ? 'User' : 'Agent')}</span>
                            {comment?.createdAt ? <span className="font-normal normal-case tracking-normal">{new Date(comment.createdAt).toLocaleString()}</span> : null}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-[11px] text-slate-700 dark:text-slate-300">{comment?.text || ''}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {hasCommentSupport && openCommentKey === itemKey && (
                    <div className="ml-6 space-y-2">
                      <div className="flex min-w-0 flex-row items-start gap-2">
                        <input
                          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          placeholder="Add progress comment..."
                          maxLength={COMMENT_MAX_LENGTH}
                          value={commentDrafts[itemKey] || ''}
                          onChange={e => {
                            const value = e.target.value.slice(0, COMMENT_MAX_LENGTH);
                            setCommentDrafts(prev => ({ ...prev, [itemKey]: value }));
                            if (commentErrors[itemKey]) {
                              setCommentErrors(prev => ({ ...prev, [itemKey]: '' }));
                            }
                          }}
                          onKeyDown={async e => {
                            if (e.key !== 'Enter') return;
                            const key = itemKey;
                            const text = String(commentDrafts[key] || '').trim();
                            if (!text || text.length > COMMENT_MAX_LENGTH) return;
                            setCommentBusy(prev => ({ ...prev, [key]: true }));
                            try {
                              await onCommentItem(item.id, item.text, text);
                              setItems(prev => prev.map(current => getItemIdentity(current) === key ? { ...current, comments: [...(current.comments || []), createLocalComment(text)] } : current));
                              setCommentDrafts(prev => ({ ...prev, [key]: '' }));
                              setCommentErrors(prev => ({ ...prev, [key]: '' }));
                              setOpenCommentKey(null);
                            } catch (error) {
                              setCommentErrors(prev => ({ ...prev, [key]: error instanceof Error ? error.message : 'Failed to submit comment. Please try again.' }));
                            } finally {
                              setCommentBusy(prev => ({ ...prev, [key]: false }));
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={commentBusy[itemKey] || !String(commentDrafts[itemKey] || '').trim() || String(commentDrafts[itemKey] || '').length > COMMENT_MAX_LENGTH}
                          onClick={async () => {
                            const key = itemKey;
                            const text = String(commentDrafts[key] || '').trim();
                            if (!text || text.length > COMMENT_MAX_LENGTH) return;
                            setCommentBusy(prev => ({ ...prev, [key]: true }));
                            try {
                              await onCommentItem(item.id, item.text, text);
                              setItems(prev => prev.map(current => getItemIdentity(current) === key ? { ...current, comments: [...(current.comments || []), createLocalComment(text)] } : current));
                              setCommentDrafts(prev => ({ ...prev, [key]: '' }));
                              setCommentErrors(prev => ({ ...prev, [key]: '' }));
                              setOpenCommentKey(null);
                            } catch (error) {
                              setCommentErrors(prev => ({ ...prev, [key]: error instanceof Error ? error.message : 'Failed to submit comment. Please try again.' }));
                            } finally {
                              setCommentBusy(prev => ({ ...prev, [key]: false }));
                            }
                          }}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-slate-50 text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-indigo-500 dark:hover:text-indigo-300"
                          aria-label="Save comment"
                          title="Save comment"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 7 10 17l-5-5" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
              })}
            </div>

            {!readOnly && (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-[11px] text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:placeholder:text-slate-600"
                  placeholder="Add a step..."
                  value={newItem}
                  onChange={e => setNewItem(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
                />
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-white"
                  aria-label="Add item"
                  title="Add item"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center dark:border-slate-800">
          {!hideRejectButton && (
            <button type="button" onClick={onReject} className="rounded-xl border border-slate-300 px-4 py-2 text-[12px] font-semibold text-slate-600 transition-all hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:bg-slate-800 dark:hover:text-white">
              Reject
            </button>
          )}
          <div className="hidden flex-1 sm:block" />
          <p className="order-first text-[10px] text-slate-500 sm:order-none sm:mr-2 dark:text-slate-600">{reviewSummaryText ?? `${items.filter(item => item.done).length}/${items.length} reviewed`}</p>
          {!hidePrimaryButton && (
            <button type="button" onClick={() => {
              const revisedPlan = buildRevisedPlan();
              if (onPrimaryAction) {
                onPrimaryAction();
                return;
              }
              onApprove(revisedPlan);
            }} className="w-full rounded-xl bg-indigo-600 px-5 py-2 text-[12px] font-bold text-white transition-colors shadow-lg shadow-indigo-500/20 hover:bg-indigo-500 sm:w-auto">
              {primaryActionLabel ?? 'Approve & Execute'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StrategyPlanModal;
