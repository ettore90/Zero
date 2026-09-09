import React from 'react';
import { Project } from '../types';
import ProjectTreePanel from './ProjectTreePanel';

export interface RightPanelSessionNote {
  id: string;
  noteId?: string | null;
  sessionId?: string | null;
  title?: string | null;
  contentHtml?: string | null;
  updatedAt?: string | number | null;
}

export interface RightPanelApprovalItem {
  id: string;
  title?: string | null;
  source?: string;
  status?: 'open' | 'in_progress' | 'completed' | 'canceled';
  updatedAt?: string;
  unread?: boolean;
}

export interface RightPanelProps {
  isVisible: boolean;
  isProjectTreeOpen: boolean;
  isSessionNotesOpen: boolean;
  isApprovalsOpen?: boolean;
  sessionNotes?: RightPanelSessionNote[];
  approvals?: RightPanelApprovalItem[];
  activeNoteId?: string | null;
  notesEnabled?: boolean;
  isTogglingSessionNotes?: boolean;
  activeApprovalId?: string | null;
  projects?: Project[];
  activeProjectId?: string | null;
  onSelectProject?: (id: string) => void;
  onAddProject?: (project: Project) => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (id: string) => void;
  onScanProject?: (id: string) => Promise<any>;
  scanLoading?: boolean;
  scanDraft?: import('../types').ProjectContext | null;
  onApproveContext?: (ctx: import('../types').ProjectContext) => void;
  onDismissDraft?: () => void;
  activeAgentId?: string;
  onCreateSessionNote: () => void;
  onToggleSessionNotesEnabled?: (enabled: boolean) => void | Promise<void>;
  onOpenSessionNote?: (noteId: string, noteSessionId?: string | null) => void;
  onOpenApproval?: (id: string) => void;
  onCollapseCanvas?: () => void;
  isCanvasFullscreen?: boolean;
  onToggleCanvasFullscreen?: () => void;
  onProjectTreeFileOpened?: () => void;
}

/**
 * A one-line preview of the note, for the list. The rows used to show the
 * note's id under the title, which is the one thing about a note nobody
 * recognises it by.
 */
function notePreview(contentHtml?: string | null): string {
  if (!contentHtml) return '';
  const text = contentHtml
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 90 ? `${text.slice(0, 90)}\u2026` : text;
}

/** Compact age for a list row: the exact timestamp is not what you scan for. */
function noteAge(updatedAt?: string | number | null): string {
  if (updatedAt === null || updatedAt === undefined || updatedAt === '') return '';
  const stamp = typeof updatedAt === 'number' ? updatedAt : Date.parse(String(updatedAt));
  if (!Number.isFinite(stamp)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - stamp) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(stamp).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

function noteTimestamp(updatedAt?: string | number | null): number {
  if (updatedAt === null || updatedAt === undefined || updatedAt === '') return 0;
  const stamp = typeof updatedAt === 'number' ? updatedAt : Date.parse(String(updatedAt));
  return Number.isFinite(stamp) ? stamp : 0;
}

const RightPanel: React.FC<RightPanelProps> = ({
  isVisible,
  isProjectTreeOpen,
  isSessionNotesOpen,
  isApprovalsOpen = false,
  sessionNotes = [],
  approvals = [],
  activeNoteId = null,
  notesEnabled = false,
  isTogglingSessionNotes = false,
  activeApprovalId = null,
  projects = [],
  activeProjectId = null,
  onSelectProject,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onScanProject,
  scanLoading,
  scanDraft,
  onApproveContext,
  onDismissDraft,
  activeAgentId,
  onCreateSessionNote,
  onToggleSessionNotesEnabled,
  onOpenSessionNote,
  onOpenApproval,
  onCollapseCanvas,
  isCanvasFullscreen = false,
  onToggleCanvasFullscreen,
  onProjectTreeFileOpened,
}) => {
  const panelOpen = isVisible && (isProjectTreeOpen || isSessionNotesOpen || isApprovalsOpen);
  const [noteQuery, setNoteQuery] = React.useState('');

  // Newest first, and searchable: a long-running session accumulates hundreds
  // of notes that all default to the same title, and insertion order buries the
  // one you were just in.
  const visibleNotes = React.useMemo(() => {
    const decorated = sessionNotes.map((note) => ({
      note,
      preview: notePreview(note.contentHtml),
      stamp: noteTimestamp(note.updatedAt),
    }));
    const query = noteQuery.trim().toLowerCase();
    const filtered = query
      ? decorated.filter(({ note, preview }) =>
          `${note.title ?? ''} ${preview}`.toLowerCase().includes(query))
      : decorated;
    return [...filtered].sort((a, b) => b.stamp - a.stamp);
  }, [noteQuery, sessionNotes]);
  const normalizedActiveNoteId = String(activeNoteId || '').trim();
  const normalizedActiveApprovalId = String(activeApprovalId || '').trim();

  return (
    <section
      aria-label="Workspace selection panel"
      className={`flex h-full min-h-0 min-w-0 w-full flex-1 overflow-hidden bg-slate-100 transition-[opacity,transform] duration-300 ease-in-out dark:bg-[#151618] ${
        panelOpen ? 'opacity-100 translate-x-0' : 'pointer-events-none opacity-0 translate-x-2'
      }`}
    >
      {panelOpen && (
        <div className="flex h-full min-h-0 min-w-0 w-full flex-1 flex-col text-slate-700 dark:text-slate-200">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800/80">
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-500">
              {isSessionNotesOpen ? 'Notes' : isApprovalsOpen ? 'Approvals' : 'Project Tree'}
            </div>
            <div className="flex items-center gap-1">
              {onToggleCanvasFullscreen && (
                <button
                  type="button"
                  onClick={onToggleCanvasFullscreen}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${isCanvasFullscreen ? 'bg-nebula-500/15 text-nebula-800 dark:text-nebula-100' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'}`}
                  aria-label={isCanvasFullscreen ? 'Exit fullscreen canvas' : 'Fullscreen canvas'}
                  aria-pressed={isCanvasFullscreen}
                  title={isCanvasFullscreen ? 'Exit fullscreen canvas' : 'Fullscreen canvas'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {isCanvasFullscreen ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 20H4v-5m0 5l6.5-6.5M15 4h5v5m0-5l-6.5 6.5" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 4H4v5m0-5l6.5 6.5M15 20h5v-5m0 5l-6.5-6.5" />
                    )}
                  </svg>
                </button>
              )}
              {onCollapseCanvas && (
                <button
                  type="button"
                  onClick={onCollapseCanvas}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  aria-label="Minimize canvas"
                  title="Minimize canvas"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {isSessionNotesOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800/80">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notesEnabled}
                    aria-label={notesEnabled ? 'Disable session notes' : 'Enable session notes'}
                    aria-busy={isTogglingSessionNotes || undefined}
                    disabled={isTogglingSessionNotes}
                    onClick={() => onToggleSessionNotesEnabled?.(!notesEnabled)}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-nebula-500 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-100 dark:focus-visible:ring-offset-[#151618] ${notesEnabled ? 'border-nebula-500 bg-nebula-500' : 'border-slate-300 bg-slate-200 hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:hover:bg-slate-600'} ${isTogglingSessionNotes ? 'cursor-wait opacity-70' : 'cursor-pointer'}`}
                  >
                    <span className="sr-only">Toggle session notes</span>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition duration-200 ${notesEnabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5'}`} />
                  </button>
                  <span className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {!notesEnabled
                      ? 'Disabled'
                      : noteQuery.trim()
                      ? `${visibleNotes.length} of ${sessionNotes.length}`
                      : `${sessionNotes.length} note${sessionNotes.length === 1 ? '' : 's'}`}
                  </span>
                </div>
                <button
                  onClick={onCreateSessionNote}
                  disabled={!notesEnabled || isTogglingSessionNotes}
                  className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-black uppercase tracking-wider transition-colors ${notesEnabled ? 'bg-nebula-800 text-white hover:bg-nebula-900 dark:bg-nebula-600 dark:hover:bg-nebula-500' : 'cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-800 dark:text-slate-600'}`}
                  type="button"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 5v14M5 12h14" />
                  </svg>
                  New
                </button>
              </div>
              {notesEnabled && sessionNotes.length > 0 && (
                <div className="border-b border-slate-200 px-2 py-2 dark:border-slate-800/80">
                  <div className="relative mx-auto max-w-3xl">
                    <svg xmlns="http://www.w3.org/2000/svg" className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
                    </svg>
                    <input
                      type="search"
                      value={noteQuery}
                      onChange={(event) => setNoteQuery(event.target.value)}
                      placeholder="Search notes"
                      aria-label="Search notes"
                      className="h-7 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[11px] text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-nebula-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200 dark:placeholder:text-slate-600 dark:focus:border-nebula-500"
                    />
                  </div>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {!notesEnabled ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    Notes tools are disabled for this session. Enable them to create or open notes.
                  </div>
                ) : sessionNotes.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-4 text-center dark:border-slate-700">
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-300">No notes yet</div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">New starts one for this session.</div>
                  </div>
                ) : visibleNotes.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-4 text-center dark:border-slate-700">
                    <div className="text-xs font-medium text-slate-600 dark:text-slate-300">No match</div>
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">Nothing here matches &ldquo;{noteQuery.trim()}&rdquo;.</div>
                  </div>
                ) : (
                  <div className="mx-auto min-w-0 max-w-3xl space-y-1">
                    {visibleNotes.map(({ note, preview }) => {
                      const canonicalNoteId = String(note.noteId ?? note.id ?? '').trim();
                      const isActive = canonicalNoteId !== '' && canonicalNoteId === normalizedActiveNoteId;
                      const age = noteAge(note.updatedAt);
                      return (
                        <button
                          key={canonicalNoteId}
                          type="button"
                          onClick={() => canonicalNoteId && onOpenSessionNote?.(canonicalNoteId, note.sessionId ?? null)}
                          aria-current={isActive || undefined}
                          className={`group relative flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-md border px-2.5 py-2 pl-3 text-left transition-colors ${
                            isActive
                              ? 'border-nebula-500 bg-nebula-500/10 text-nebula-900 dark:text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          {/* Accent bar: tells the active row apart at a glance
                              even when the whole list is tinted by hover. */}
                          <span
                            aria-hidden="true"
                            className={`absolute inset-y-1 left-0 w-0.5 rounded-full transition-colors ${isActive ? 'bg-nebula-500' : 'bg-transparent group-hover:bg-slate-300 dark:group-hover:bg-slate-600'}`}
                          />
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isActive ? 'text-nebula-600 dark:text-nebula-500' : 'text-slate-400 dark:text-slate-600'}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16.5 3.75H8.25A2.25 2.25 0 006 6v12a2.25 2.25 0 002.25 2.25h7.5L18 18V6A2.25 2.25 0 0015.75 3.75z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 8.25h6M9 12h6M9 15.75h3.75" />
                          </svg>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 truncate text-xs font-medium">{note.title || 'Session note'}</span>
                              {age && (
                                <span className={`shrink-0 text-[10px] tabular-nums ${isActive ? 'text-nebula-800/70 dark:text-slate-400' : 'text-slate-400 dark:text-slate-600'}`}>
                                  {age}
                                </span>
                              )}
                            </span>
                            <span className={`mt-0.5 block truncate text-[11px] ${preview ? (isActive ? 'text-nebula-800/70 dark:text-slate-300' : 'text-slate-500 dark:text-slate-500') : 'italic text-slate-400 dark:text-slate-600'}`}>
                              {preview || 'Empty note'}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : isApprovalsOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800/80">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">Approvals</div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {approvals.length === 0 ? (
                  <div className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No approvals yet.
                  </div>
                ) : (() => {
                  const sortByUpdatedAtDesc = (items: RightPanelApprovalItem[]) => [...items].sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')) || String(a?.id || '').localeCompare(String(b?.id || '')));
                  const getApprovalStatus = (approval: RightPanelApprovalItem) => {
                    const rawStatus = String((approval as any)?.planStatus || (approval as any)?.itemStatus || approval?.status || '').trim().toLowerCase();
                    if (rawStatus === 'cancelled' || rawStatus === 'rejected') return 'canceled';
                    return rawStatus;
                  };
                  const openPlans = sortByUpdatedAtDesc(approvals.filter((approval) => approval?.source === 'pendingStrategyPlan' && getApprovalStatus(approval) === 'open'));
                  const inProgressPlans = sortByUpdatedAtDesc(approvals.filter((approval) => approval?.source === 'pendingStrategyPlan' && getApprovalStatus(approval) === 'in_progress'));
                  const completedPlans = sortByUpdatedAtDesc(approvals.filter((approval) => approval?.source === 'pendingStrategyPlan' && getApprovalStatus(approval) === 'completed'));
                  const canceledPlans = sortByUpdatedAtDesc(approvals.filter((approval) => approval?.source === 'pendingStrategyPlan' && getApprovalStatus(approval) === 'canceled'));
                  const otherApprovals = sortByUpdatedAtDesc(approvals.filter((approval) => approval?.source !== 'pendingStrategyPlan'));
                  const renderApprovalButton = (approval: RightPanelApprovalItem) => {
                    const approvalId = String(approval.id || '').trim();
                    const isActive = approvalId !== '' && approvalId === normalizedActiveApprovalId;
                    const statusValue = getApprovalStatus(approval);
                    const statusLabel = statusValue === 'open' ? 'Open' : statusValue === 'in_progress' ? 'In progress' : statusValue === 'completed' ? 'Completed' : statusValue === 'canceled' ? 'Canceled' : null;
                    const statusTone = statusValue === 'open'
                      ? 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300'
                      : statusValue === 'in_progress'
                      ? 'border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'
                      : statusValue === 'completed'
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : statusValue === 'canceled'
                      ? 'border-rose-300 bg-rose-100 text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300'
                      : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
                    return (
                      <button
                        key={approvalId}
                        type="button"
                        onClick={() => approvalId && onOpenApproval?.(approvalId)}
                        className={`w-full min-w-0 overflow-hidden rounded border px-3 py-2 text-left transition-colors ${
                          isActive
                            ? 'border-nebula-500 bg-nebula-500/10 text-nebula-900 dark:text-white'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:bg-slate-800/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-xs font-medium">{approval.title || 'Approval'}</div>
                          <div className="flex items-center gap-2">
                            {approval.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-orange-400 animate-pulse" aria-label="Unread approval" />}
                            {statusLabel && <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${statusTone}`}>{statusLabel}</span>}
                          </div>
                        </div>
                        <div className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-500">{approvalId}</div>
                      </button>
                    );
                  };
                  const renderGroup = (label: string, items: RightPanelApprovalItem[]) => items.length > 0 ? (
                    <div className="space-y-1.5">
                      <div className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-500">{label}</div>
                      <div className="space-y-1">{items.map(renderApprovalButton)}</div>
                    </div>
                  ) : null;
                  return (
                    <div className="min-w-0 space-y-3">
                      {renderGroup('Open plans', openPlans)}
                      {renderGroup('Work in progress', inProgressPlans)}
                      {renderGroup('Completed plans', completedPlans)}
                      {renderGroup('Canceled plans', canceledPlans)}
                      {renderGroup('Other approvals', otherApprovals)}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <ProjectTreePanel
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={onSelectProject ?? (() => {})}
              onAddProject={onAddProject}
              onEditProject={onEditProject}
              onDeleteProject={onDeleteProject}
              onScanProject={onScanProject}
              scanLoading={scanLoading}
              scanDraft={scanDraft}
              onApproveContext={onApproveContext}
              onDismissDraft={onDismissDraft}
              activeAgentId={activeAgentId}
              onFileOpened={onProjectTreeFileOpened}
            />
          )}
        </div>
      )}
    </section>
  );
};

export default RightPanel;
