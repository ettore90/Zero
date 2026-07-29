import React, { ReactNode, useEffect, useState } from 'react';
import { CanvasTab } from '../hooks/useCanvasState';

export const isSessionNoteTab = (tab: CanvasTab): boolean =>
  typeof tab.path === 'string' && tab.path.startsWith('.session-note/');

export interface CanvasRailState {
  tabs: CanvasTab[];
  activeTabId: string | null;
  activeCanvasTab: 'editor' | 'commands';
  isProjectTreeSectionOpen: boolean;
  isSessionNotesSectionOpen: boolean;
  isApprovalsSectionOpen: boolean;
  hasSessionNoteTarget: boolean;
  pendingApproval: boolean;
}

export interface CanvasRailActions {
  onToggleSessionNotesSection: () => void;
  onToggleProjectTreeSection: () => void;
  onToggleApprovalsSection: () => void;
  onEditAgent: () => void;
  onSwitchToCommands: () => void;
}

export interface CanvasRailProps {
  railState: CanvasRailState;
  railActions: CanvasRailActions;
  compact?: boolean;
}

interface RailButtonConfig {
  key: string;
  title: string;
  ariaLabel: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ReactNode;
  badge?: boolean;
}

const CanvasRail: React.FC<CanvasRailProps> = ({ railState, railActions, compact = false }) => {
  const [isCompactExpanded, setIsCompactExpanded] = useState(false);
  const {
    tabs,
    activeTabId,
    activeCanvasTab,
    isProjectTreeSectionOpen,
    isSessionNotesSectionOpen,
    isApprovalsSectionOpen,
    hasSessionNoteTarget,
    pendingApproval,
  } = railState;
  const {
    onToggleSessionNotesSection,
    onToggleProjectTreeSection,
    onToggleApprovalsSection,
    onEditAgent,
    onSwitchToCommands,
  } = railActions;

  const hasActiveSessionNoteTab =
    activeCanvasTab === 'editor' && !!activeTabId && tabs.some((tab) => tab.id === activeTabId && isSessionNoteTab(tab));
  const hasActiveMonacoTab =
    activeCanvasTab === 'editor' && !!activeTabId && tabs.some((tab) => tab.id === activeTabId && !isSessionNoteTab(tab));
  const isStreamActive = activeCanvasTab === 'commands';
  const isSessionNoteActive = !isStreamActive && (isSessionNotesSectionOpen || (hasActiveSessionNoteTab && !isProjectTreeSectionOpen));
  const isMonacoActive = !isStreamActive && (isProjectTreeSectionOpen || (hasActiveMonacoTab && !isSessionNotesSectionOpen));

  const railSizingClass = compact ? 'justify-center w-11 px-1.5' : 'justify-center w-full px-2';
  const railButtonBase = `relative flex h-10 items-center ${railSizingClass} rounded-xl border border-transparent transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nebula-500)] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950`;
  const railActiveStyle = {
    borderColor: 'var(--nebula-500)',
    color: 'var(--nebula-100)',
    boxShadow: '0 10px 28px rgba(0,0,0,0.24)',
  } as const;
  const railActiveIconStyle = { color: 'var(--nebula-500)' } as const;
  const railInactiveIconStyle = { color: '#64748b' } as const;

  const getRailButtonClass = (active: boolean, disabled = false) => {
    if (disabled) return `${railButtonBase} text-slate-500 dark:text-slate-600 opacity-45 cursor-not-allowed`;
    if (active) return `${railButtonBase} border-white/10 bg-white/[0.08] text-white shadow-[0_10px_28px_rgba(0,0,0,0.24)]`;
    return `${railButtonBase} text-slate-500 dark:text-slate-600 hover:border-white/10 hover:bg-white/[0.045] hover:text-slate-100 hover:shadow-[0_8px_24px_rgba(0,0,0,0.18)]`;
  };

  const handleCompactToggle = () => setIsCompactExpanded((prev) => !prev);

  useEffect(() => {
    if (!compact) setIsCompactExpanded(false);
  }, [compact]);

  const wrapCompactAction = (handler: () => void) => () => {
    handler();
    if (compact) setIsCompactExpanded(false);
  };

  const renderRailButton = ({ key, title, ariaLabel, active, disabled, onClick, icon, badge }: RailButtonConfig) => (
    <button key={key} onClick={wrapCompactAction(onClick)} disabled={disabled} className={getRailButtonClass(active, disabled)} style={active && !disabled ? railActiveStyle : undefined} title={title} aria-label={ariaLabel}>
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={active && !disabled ? railActiveIconStyle : railInactiveIconStyle}>
        {icon}
      </svg>
      {badge && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-orange-400 animate-pulse" />}
    </button>
  );

  const upperRailButtons: RailButtonConfig[] = [
    {
      key: 'notes',
      title: hasSessionNoteTarget ? 'Notes' : 'Notes unavailable',
      ariaLabel: 'Notes',
      active: isSessionNoteActive || isSessionNotesSectionOpen,
      disabled: !hasSessionNoteTarget,
      onClick: onToggleSessionNotesSection,
      icon: (
        <>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.75H8.25A2.25 2.25 0 006 6v12a2.25 2.25 0 002.25 2.25h7.5L18 18V6A2.25 2.25 0 0015.75 3.75z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 8.25h6M9 12h6M9 15.75h3.75" />
        </>
      ),
    },
    {
      key: 'project-tree',
      title: 'Project Tree',
      ariaLabel: 'Project Tree',
      active: isMonacoActive || isProjectTreeSectionOpen,
      onClick: onToggleProjectTreeSection,
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 5.25H6A2.25 2.25 0 003.75 7.5v9A2.25 2.25 0 006 18.75h3.75m0-13.5L15 9.75m-5.25-4.5v13.5M14.25 18.75H18A2.25 2.25 0 0020.25 16.5v-9A2.25 2.25 0 0018 5.25h-3.75m0 13.5L9 14.25m5.25 4.5v-13.5" />,
    },
    {
      key: 'stream',
      title: 'Stream',
      ariaLabel: 'Stream',
      active: activeCanvasTab === 'commands',
      onClick: onSwitchToCommands,
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.25 6.75L21 12l-3.75 5.25M2.25 6.75L6 12l-3.75 5.25M8.25 19.5l7.5-15" />,
    },
    {
      key: 'approvals',
      title: 'Approvals',
      ariaLabel: 'Approvals',
      active: isApprovalsSectionOpen,
      badge: pendingApproval,
      onClick: onToggleApprovalsSection,
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75 11.25 15 15 9.75M7.5 4.5h9A2.25 2.25 0 0118.75 6.75v10.5A2.25 2.25 0 0116.5 19.5h-9a2.25 2.25 0 01-2.25-2.25V6.75A2.25 2.25 0 017.5 4.5z" />,
    },
  ];

  const lowerRailButtons: RailButtonConfig[] = [
    {
      key: 'edit-agent',
      title: 'Edit Agent',
      ariaLabel: 'Edit Agent',
      active: false,
      onClick: onEditAgent,
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.586-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.414-8.586z" />,
    },
  ];

  const compactClassName = 'relative flex w-14 flex-col items-center';
  const compactMenuClassName = `absolute bottom-[calc(100%+0.5rem)] left-1/2 flex h-auto -translate-x-1/2 flex-col gap-2 rounded-2xl border border-slate-200/90 bg-white/95 p-2 shadow-2xl backdrop-blur transition-all duration-200 ease-out dark:border-slate-800/80 dark:bg-slate-950/95 ${isCompactExpanded ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`;
  const compactToggleClassName = `relative flex h-14 w-14 items-center justify-center rounded-full border transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nebula-500)] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 ${isCompactExpanded
    ? 'border-slate-300/90 bg-white text-slate-700 shadow-[0_12px_32px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-white/[0.08] dark:text-white dark:shadow-[0_12px_32px_rgba(0,0,0,0.28)]'
    : 'border-slate-200/90 bg-white text-slate-700 shadow-[0_12px_32px_rgba(15,23,42,0.14)] backdrop-blur hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800/80 dark:bg-slate-950/95 dark:text-slate-100 dark:shadow-2xl dark:hover:border-white/10 dark:hover:bg-white/[0.045]'} `;
  const desktopClassName = 'border-l border-slate-800 bg-slate-950/85 flex h-full min-h-0 shrink-0 flex-col py-3 w-14 items-center px-1.5 overflow-hidden';

  if (compact) {
    return (
      <div className={compactClassName}>
        <div className={compactMenuClassName} aria-hidden={!isCompactExpanded}>
          <div className="flex flex-col gap-2">{upperRailButtons.map(renderRailButton)}</div>
          <div className="flex flex-col gap-2 border-t border-slate-800/70 pt-1">
            {lowerRailButtons.map(renderRailButton)}
          </div>
        </div>
        <button
          type="button"
          onClick={handleCompactToggle}
          className={compactToggleClassName}
          aria-label={isCompactExpanded ? 'Close workspace menu' : 'Open workspace menu'}
          aria-expanded={isCompactExpanded}
          title={isCompactExpanded ? 'Close workspace menu' : 'Open workspace menu'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={isCompactExpanded ? railActiveIconStyle : railInactiveIconStyle}>
            {isCompactExpanded ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 7.5h15" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12h15" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 16.5h15" />
              </>
            )}
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className={desktopClassName}>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-hidden">{upperRailButtons.map(renderRailButton)}</div>
      <div className="mt-auto flex w-full flex-col items-center gap-2 pt-4">
        {lowerRailButtons.map(renderRailButton)}
        <div className="flex flex-col items-center gap-1 select-none text-[11px] font-black uppercase tracking-[0.22em] text-slate-600">
          <span className="-rotate-90 origin-center transition-transform duration-200">WS</span>
        </div>
      </div>
    </div>
  );
};

export default CanvasRail;
