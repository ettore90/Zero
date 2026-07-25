import React, { ReactNode, useEffect, useRef, useState } from 'react';
import { Message, Project } from '../types';
import CanvasRail from './CanvasRail';
import RightPanel from './RightPanel';
import CodeCanvas from './CodeCanvas';

export interface ChatCanvasShellProps {
  agent: { id: string; activeSessionId?: string | null; history: Message[] | { messages?: Message[] } };
  pendingApproval: { agentId: string } | null;
  isChatVisible: boolean;
  chatContent: ReactNode;
  shellState: {
    isCanvasVisible: boolean;
    isCanvasProjectTreeSectionOpen: boolean;
    isCanvasSessionNotesSectionOpen: boolean;
  };
  canvas: any;
  isDarkTheme: boolean;
  sessionNotes?: Array<{ id: string; noteId?: string | null; sessionId?: string | null; title?: string | null; contentHtml?: string | null }>;
  activeNoteId?: string | null;
  projects?: Project[];
  activeProjectId?: string | null;
  onScanProject?: (id: string) => Promise<any>;
  scanLoading?: boolean;
  scanDraft?: import('../types').ProjectContext | null;
  onApproveContext?: (ctx: import('../types').ProjectContext) => void;
  onDismissDraft?: () => void;
  shellActions: {
    onEditAgent: () => void;
    onCreateSessionNote: () => void;
    onCreateScratchTab: () => void;
    onSelectProject?: (id: string) => void;
    onAddProject?: (project: Project) => void;
    onEditProject?: (project: Project) => void;
    onDeleteProject?: (id: string) => void;
    onApproveTool: () => void;
    onDenyTool: () => void;
    onClearCanvasRailSelection: () => void;
    onOpenSessionNoteFromRail?: (noteId: string, noteSessionId?: string | null) => void;
    setIsCanvasProjectTreeSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsCanvasSessionNotesSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
    handleSaveTab: (tabId: string, content: string, path: string) => void | Promise<void>;
    handleSaveAsTab: (tabId: string, content: string, currentPath: string) => void | Promise<void>;
  };
}

const ChatCanvasShell: React.FC<ChatCanvasShellProps> = ({
  agent,
  pendingApproval,
  isChatVisible,
  chatContent,
  shellState,
  canvas,
  isDarkTheme,
  shellActions,
  sessionNotes = [],
  activeNoteId = null,
  projects = [],
  activeProjectId = null,
  onScanProject,
  scanLoading,
  scanDraft,
  onApproveContext,
  onDismissDraft,
}) => {
  const {
    isCanvasVisible,
    isCanvasProjectTreeSectionOpen,
    isCanvasSessionNotesSectionOpen,
  } = shellState;
  const {
    onEditAgent,
    onCreateSessionNote,
    onCreateScratchTab,
    onSelectProject,
    onAddProject,
    onEditProject,
    onDeleteProject,
    onClearCanvasRailSelection,
    onOpenSessionNoteFromRail,
    setIsCanvasProjectTreeSectionOpen,
    setIsCanvasSessionNotesSectionOpen,
  } = shellActions;

  const hasSessionNoteTarget = !!agent.activeSessionId && agent.activeSessionId !== 'default';
  const isWorkspaceSelectionOpen = isCanvasVisible && (isCanvasProjectTreeSectionOpen || isCanvasSessionNotesSectionOpen);
  const orderedSessionNotes = (Array.isArray(sessionNotes) ? sessionNotes : [])
    .map((note) => {
      const canonicalNoteId = String(note?.noteId ?? note?.id ?? '').trim();
      return canonicalNoteId ? { ...note, id: canonicalNoteId, noteId: canonicalNoteId } : null;
    })
    .filter(Boolean) as Array<{ id: string; noteId?: string | null; sessionId?: string | null; title?: string | null; contentHtml?: string | null }>;

  const handleOpenSessionNoteFromRail = (noteId: string, noteSessionId?: string | null) => {
    const canonicalNoteId = String(noteId || '').trim();
    if (!canonicalNoteId) return;
    if (typeof onOpenSessionNoteFromRail === 'function') {
      void onOpenSessionNoteFromRail(canonicalNoteId, noteSessionId ?? null);
    }
  };

  const [desktopChatWidthPct, setDesktopChatWidthPct] = useState<number | null>(null);
  const dragStateRef = useRef<{ dragging: boolean } | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const desktopSplitRef = useRef<HTMLDivElement | null>(null);

  const cleanupDesktopResizeUi = () => {
    if (typeof document === 'undefined') return;
    document.body.removeAttribute('data-chatcanvas-resizing');
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const syncDesktopWidth = () => {
      if (mq.matches) return;
      dragStateRef.current = null;
      setDesktopChatWidthPct(null);
      cleanupDesktopResizeUi();
    };
    syncDesktopWidth();
    mq.addEventListener?.('change', syncDesktopWidth);
    return () => mq.removeEventListener?.('change', syncDesktopWidth);
  }, []);

  useEffect(() => {
    const handleUp = () => {
      if (dragStateRef.current) dragStateRef.current.dragging = false;
      cleanupDesktopResizeUi();
    };
    const handleMove = (event: MouseEvent) => {
      const drag = dragStateRef.current;
      const split = desktopSplitRef.current;
      if (!drag?.dragging || !split) return;
      event.preventDefault();
      const rect = split.getBoundingClientRect();
      const next = ((event.clientX - rect.left) / rect.width) * 100;
      setDesktopChatWidthPct(Math.max(25, Math.min(75, next)));
    };
    window.addEventListener('mousemove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      cleanupDesktopResizeUi();
    };
  }, []);

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    if (window.innerWidth < 1024) return;
    const split = desktopSplitRef.current;
    if (!split || !isCanvasVisible) return;
    event.preventDefault();
    const rect = split.getBoundingClientRect();
    dragStateRef.current = { dragging: true };
    document.body.setAttribute('data-chatcanvas-resizing', 'true');
    document.body.style.setProperty('user-select', 'none');
    document.body.style.setProperty('cursor', 'col-resize');
    const next = ((event.clientX - rect.left) / rect.width) * 100;
    setDesktopChatWidthPct(Math.max(25, Math.min(75, next)));
  };

  const railState = {
    tabs: canvas.tabs,
    activeTabId: canvas.activeTabId,
    activeCanvasTab: canvas.activeCanvasTab,
    hasSessionNoteTarget,
    pendingApproval: !!pendingApproval && pendingApproval.agentId === agent.id,
    isProjectTreeSectionOpen: isCanvasProjectTreeSectionOpen,
    isSessionNotesSectionOpen: isCanvasSessionNotesSectionOpen,
  };

  const railActions = {
    onToggleSessionNotesSection: () => {
      if (!canvas.isCanvasVisible) canvas.toggleCanvas();
      canvas.setActiveCanvasTab('editor');
      setIsCanvasSessionNotesSectionOpen((prev: boolean) => {
        const next = !prev;
        setIsCanvasProjectTreeSectionOpen(false);
        return next;
      });
    },
    onToggleProjectTreeSection: () => {
      if (!canvas.isCanvasVisible) canvas.toggleCanvas();
      canvas.setActiveCanvasTab('editor');
      setIsCanvasProjectTreeSectionOpen((prev: boolean) => {
        const next = !prev;
        setIsCanvasSessionNotesSectionOpen(false);
        return next;
      });
    },
    onEditAgent,
    onSwitchToCommands: () => {
      if (!canvas.isCanvasVisible) canvas.toggleCanvas();
      onClearCanvasRailSelection();
      setIsCanvasProjectTreeSectionOpen(false);
      setIsCanvasSessionNotesSectionOpen(false);
      canvas.setActiveCanvasTab('commands');
    },
  };

  const mobileRail = <CanvasRail railState={railState} railActions={railActions} compact />;
  const chatContentWithMobileRail = React.isValidElement(chatContent)
    ? React.cloneElement(chatContent as React.ReactElement<any>, { mobileRail })
    : chatContent;

  const workspaceContent = !isCanvasVisible ? null : isWorkspaceSelectionOpen ? (
    <RightPanel
      isVisible={isCanvasVisible}
      isProjectTreeOpen={isCanvasProjectTreeSectionOpen}
      isSessionNotesOpen={isCanvasSessionNotesSectionOpen}
      sessionNotes={orderedSessionNotes}
      activeNoteId={activeNoteId}
      projects={projects}
      activeProjectId={activeProjectId}
      onSelectProject={onSelectProject}
      onAddProject={onAddProject}
      onEditProject={onEditProject}
      onDeleteProject={onDeleteProject}
      onScanProject={onScanProject}
      scanLoading={scanLoading}
      scanDraft={scanDraft}
      onApproveContext={onApproveContext}
      onDismissDraft={onDismissDraft}
      activeAgentId={agent.id}
      onCreateSessionNote={onCreateSessionNote}
      onOpenSessionNote={handleOpenSessionNoteFromRail}
      onCollapseCanvas={canvas.toggleCanvas}
      onProjectTreeFileOpened={() => {
        setIsCanvasProjectTreeSectionOpen(false);
        setIsCanvasSessionNotesSectionOpen(false);
        if (!canvas.isCanvasVisible) canvas.toggleCanvas();
        canvas.setActiveCanvasTab('editor');
      }}
    />
  ) : (
    <CodeCanvas
      onEditAgent={onEditAgent}
      onCreateSessionNote={onCreateSessionNote}
      onCollapseCanvas={canvas.toggleCanvas}
      tabs={canvas.tabs}
      activeTabId={canvas.activeTabId}
      activeTab={canvas.activeTab}
      activeCanvasTab={canvas.activeCanvasTab}
      isDarkTheme={isDarkTheme}
      onSelectTab={canvas.setActiveTab}
      onCloseTab={canvas.closeTab}
      onUpdateContent={canvas.updateTabContent}
      onSwitchCanvasTab={canvas.setActiveCanvasTab}
      onSaveTab={shellActions.handleSaveTab}
      onSaveAsTab={shellActions.handleSaveAsTab}
      onCreateScratchTab={onCreateScratchTab}
      onAcceptDiff={canvas.acceptDiff}
      onRejectDiff={canvas.rejectDiff}
      agentHistory={Array.isArray((agent as any).history) ? (agent as any).history : ((agent as any).history?.messages || [])}
      agentId={agent.id}
      hasSessionNoteTarget={hasSessionNoteTarget}
      pendingApproval={pendingApproval as any}
      onApproveTool={shellActions.onApproveTool}
      onDenyTool={shellActions.onDenyTool}
    />
  );

  return (
    <div className="flex h-full overflow-hidden" ref={shellRef}>
      <div className="hidden lg:flex h-full w-full min-w-0">
        <div ref={desktopSplitRef} className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            style={{ width: !isChatVisible ? '0' : isCanvasVisible ? `calc(${desktopChatWidthPct ?? 60}% - 0.25rem)` : '100%' }}
            className={`flex flex-col overflow-hidden transition-[width,height] duration-300 ease-in-out ${isChatVisible ? 'h-full min-w-0' : 'h-12 w-0 min-w-0'}`}
          >
            <div className={isChatVisible ? (isCanvasVisible ? 'h-full min-h-0' : 'flex-1 min-h-0') : 'h-12 overflow-hidden'}>
              {chatContentWithMobileRail}
            </div>
          </div>
          {isCanvasVisible && (
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startResize}
              className="hidden lg:flex w-2 items-stretch justify-center bg-transparent cursor-col-resize"
            >
              <div className="w-px bg-slate-300 dark:bg-slate-700" />
            </div>
          )}
          <div
            style={{ width: isCanvasVisible ? `calc(${100 - (desktopChatWidthPct ?? 60)}% - 0.25rem)` : '0%' }}
            className={`h-full min-h-0 min-w-0 overflow-hidden bg-[#1e1e1e] transition-[width] duration-300 ease-in-out ${isCanvasVisible ? 'block' : 'hidden'}`}
          >
            <div className="h-full min-h-0 min-w-0 w-full overflow-hidden">{workspaceContent}</div>
          </div>
        </div>
        <div className="h-full w-14 shrink-0 bg-[#1e1e1e]">
          <CanvasRail railState={railState} railActions={railActions} />
        </div>
      </div>

      <div className="flex md:hidden h-full w-full flex-col min-w-0">
        {isCanvasVisible ? (
          <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden bg-[#1e1e1e] border-t border-slate-200 dark:border-slate-800">
            <div className="h-full min-h-0 min-w-0 w-full overflow-hidden">{workspaceContent}</div>
          </div>
        ) : (
          <div className={isChatVisible ? 'relative flex-1 min-h-0' : 'h-12 overflow-hidden'}>
            {chatContentWithMobileRail}
          </div>
        )}
      </div>

      <div className="hidden md:flex lg:hidden h-full w-full min-w-0">
        <div
          style={{ width: !isChatVisible ? '0' : isCanvasVisible ? '52%' : '100%' }}
          className={`flex flex-col overflow-hidden transition-[width,height] duration-300 ease-in-out ${isChatVisible ? 'h-full min-w-0' : 'h-12 w-0 min-w-0'}`}
        >
          <div className={isChatVisible ? 'h-full min-h-0' : 'h-12 overflow-hidden'}>
            {chatContent}
          </div>
        </div>
        {isCanvasVisible ? (
          <>
            <div className="w-px shrink-0 bg-slate-200 dark:bg-slate-800" />
            <div className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#1e1e1e]">
              <div className="h-full min-h-0 min-w-0 w-full overflow-hidden">{workspaceContent}</div>
              <div className="absolute inset-y-0 right-0 h-full w-14 shrink-0">
                <CanvasRail railState={railState} railActions={railActions} />
              </div>
            </div>
          </>
        ) : (
          <div className="relative h-full w-14 shrink-0 overflow-hidden bg-[#1e1e1e]">
            <CanvasRail railState={railState} railActions={railActions} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatCanvasShell;
