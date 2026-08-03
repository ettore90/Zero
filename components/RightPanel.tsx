import React from 'react';
import { Project } from '../types';
import ProjectTreePanel from './ProjectTreePanel';

export interface RightPanelSessionNote {
  id: string;
  noteId?: string | null;
  sessionId?: string | null;
  title?: string | null;
  contentHtml?: string | null;
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
  onOpenSessionNote?: (noteId: string, noteSessionId?: string | null) => void;
  onOpenApproval?: (id: string) => void;
  onCollapseCanvas?: () => void;
  onProjectTreeFileOpened?: () => void;
}

const RightPanel: React.FC<RightPanelProps> = ({
  isVisible,
  isProjectTreeOpen,
  isSessionNotesOpen,
  isApprovalsOpen = false,
  sessionNotes = [],
  approvals = [],
  activeNoteId = null,
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
  onOpenSessionNote,
  onOpenApproval,
  onCollapseCanvas,
  onProjectTreeFileOpened,
}) => {
  const panelOpen = isVisible && (isProjectTreeOpen || isSessionNotesOpen || isApprovalsOpen);
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

          {isSessionNotesOpen ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-3 py-2">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300">Session notes</div>
                <button
                  onClick={onCreateSessionNote}
                  className="rounded bg-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-800 hover:bg-slate-300 dark:bg-slate-700 dark:text-white dark:hover:bg-slate-600"
                  type="button"
                >
                  New
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {sessionNotes.length === 0 ? (
                  <div className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    No session notes yet.
                  </div>
                ) : (
                  <div className="min-w-0 space-y-1">
                    {sessionNotes.map((note) => {
                      const canonicalNoteId = String(note.noteId ?? note.id ?? '').trim();
                      const isActive = canonicalNoteId !== '' && canonicalNoteId === normalizedActiveNoteId;
                      return (
                        <button
                          key={canonicalNoteId}
                          type="button"
                          onClick={() => canonicalNoteId && onOpenSessionNote?.(canonicalNoteId, note.sessionId ?? null)}
                          className={`w-full min-w-0 overflow-hidden rounded border px-3 py-2 text-left transition-colors ${
                            isActive
                              ? 'border-nebula-500 bg-nebula-500/10 text-nebula-900 dark:text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300 dark:hover:bg-slate-800/70'
                          }`}
                        >
                          <div className="truncate text-xs font-medium">{note.title || 'Session note'}</div>
                          <div className="mt-1 truncate text-[10px] text-slate-500">{canonicalNoteId}</div>
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
