import React, { useEffect, useState } from 'react';
import { Agent, LogEntry, Notification, ColorTheme, Project } from '../types';
import DebugConsole from './DebugConsole';
import { TerminalPanel } from './TerminalPanel';
import NotificationDropdown from './NotificationContainer';
import ProjectPanel from './ProjectPanel';
import OrchestrationPanel from './OrchestrationPanel';
import RailBtn from './ui/RailBtn';
import AgentPanel from './AgentPanel';
import SessionPanel from './SessionPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface LayoutProps {
  users?: Array<{ id: string; username: string; displayName?: string }>;
  onSwitchUser?: (username: string) => void;
  children: React.ReactNode;
  agents: Agent[];
  activeAgentId: string;
  onSelectAgent: (id: string) => void;
  onAddAgent: () => void;
  onEditAgent: (agent: Agent) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onNavigateToChat?: () => void; // unused — kept for App.tsx compat
  onOpenScheduler: () => void;
  onOpenAutomation: () => void;
  onOpenCommands: () => void;
  onOpenDashboard: () => void;
  onOpenMemory: () => void;
  runningAgents?: Set<string>;
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  username: string;
  theme: 'light' | 'dark';
  colorTheme: ColorTheme;
  onToggleTheme: () => void;
  showConsole: boolean;
  toggleConsole: () => void;
  logs: LogEntry[];
  clearLogs: () => void;
  showTerminal: boolean;
  toggleTerminal: () => void;
  notifications: Notification[];
  onDismissNotification: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearNotifications: () => void;
  onNewSession: (agentId: string) => void;
  onSelectSession: (agentId: string, sessionId: string) => void;
  onDeleteSession: (agentId: string, sessionId: string) => void;
  onRenameSession: (agentId: string, sessionId: string, title: string) => void;
  isSessionPanelOpen: boolean;
  toggleSessionPanel: () => void;
  // View atual para highlight do rail
  currentView: string;
  onSetView: (view: string) => void;
  // Projects
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onAddProject: (p: Project) => void;
  onEditProject: (p: Project) => void;
  onDeleteProject: (id: string) => void;
  onScanProject?: (id: string) => Promise<any>;
  scanLoading?: boolean;
  scanDraft?: import('../types').ProjectContext | null;
  onApproveContext?: (ctx: import('../types').ProjectContext) => void;
  onDismissDraft?: () => void;
  isProjectPanelOpen: boolean;
  toggleProjectPanel: () => void;
  isOrchestrationPanelOpen?: boolean;
  toggleOrchestrationPanel?: () => void;
  isChatVisible?: boolean; // kept for App.tsx compat
  onToggleChat?: () => void; // kept for App.tsx compat
  syncStatus?: 'idle' | 'saving' | 'saved' | 'error';

}

// ---------------------------------------------------------------------------
// NavItem interface — elimina cast (item as any)
// ---------------------------------------------------------------------------
interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: () => void;
  activeOverride?: boolean;
  badge?: number;
}

// ---------------------------------------------------------------------------
// Main Layout
// ---------------------------------------------------------------------------
const Layout: React.FC<LayoutProps> = ({
  children,
  agents,
  activeAgentId,
  onSelectAgent,
  onAddAgent, onEditAgent,
  users = [],
  onSwitchUser,
  onLogout,
  onOpenSettings,
  onOpenScheduler,
  onOpenAutomation,
  onOpenCommands,
  onOpenDashboard,
  onOpenMemory,
  runningAgents,
  isSidebarOpen,
  toggleSidebar,
  username,
  theme,
  colorTheme,
  onToggleTheme,
  showConsole,
  toggleConsole,
  logs,
  clearLogs,
  showTerminal,
  toggleTerminal,
  notifications,
  onDismissNotification,
  onMarkAsRead,
  onMarkAllRead,
  onClearNotifications,
  onNewSession,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  isSessionPanelOpen,
  toggleSessionPanel,
  currentView,
  onSetView,
  projects,
  activeProjectId,
  onSelectProject,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onScanProject, scanLoading, scanDraft, onApproveContext, onDismissDraft,
  isProjectPanelOpen,
  toggleProjectPanel,
  isOrchestrationPanelOpen,
  toggleOrchestrationPanel,
  isChatVisible: _isChatVisible = true,
  onToggleChat: _onToggleChat,
  syncStatus = 'idle',
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

  // Fix Chrome mobile viewport height — lock to window.innerHeight to prevent layout jump
  const [vh, setVh] = useState<number | null>(null);
  useEffect(() => {
    // Every resize is honoured. This used to skip changes under 120px while a
    // text field was focused, to avoid re-rendering the shell on the resizes a
    // tablet's on-screen keyboard fires while typing (~108ms of main-thread
    // blocking each, measured at 6x throttling). That was the wrong trade
    // twice over: the stutter it targeted turned out to be Chrome-on-iOS input
    // handling, not these re-renders, and the skip broke the layout -- a
    // tablet browser's toolbar collapses the viewport by a few dozen pixels,
    // which is under that threshold, so the root stayed TALLER than the window
    // and the message input dropped off the bottom of the screen. Reproduced
    // at 1180x688 -> 1180x622 while typing: root stuck at 688px, input bottom
    // at 634px against a 622px window. See chat-viewport-height.spec.ts.
    //
    // The re-render cost is addressed where it belongs instead: the panels
    // Layout hosts are memoized, so a height change no longer re-renders them.
    let frame: number | null = null;

    const apply = () => {
      frame = null;
      setVh(window.innerHeight);
    };
    // Coalesced into a frame so a burst of resizes costs one update.
    const schedule = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('focusout', schedule);
    };
  }, []);

  // Stable identities so the memoized panels below are not re-rendered by
  // this component's own state (viewport lock, notification popover, menus).
  const navigateToChat = React.useCallback(() => { onSetView('chat'); }, [onSetView]);
  const selectProjectFromMobile = React.useCallback((id: string) => {
    onSelectProject(id);
    toggleProjectPanel();
  }, [onSelectProject, toggleProjectPanel]);

  const closeAuxPanelsForMainView = React.useCallback(() => {
    if (isProjectPanelOpen) toggleProjectPanel();
    if (isOrchestrationPanelOpen) toggleOrchestrationPanel?.();
    if (isSessionPanelOpen) toggleSessionPanel();
    if (showNotifications) setShowNotifications(false);
    if (showAccountMenu) setShowAccountMenu(false);
  }, [isProjectPanelOpen, toggleProjectPanel, isOrchestrationPanelOpen, toggleOrchestrationPanel, isSessionPanelOpen, toggleSessionPanel, showNotifications, showAccountMenu]);

  // Apply Color Theme
  useEffect(() => {
    const classes = ['theme-blue', 'theme-green', 'theme-purple', 'theme-orange', 'theme-amber', 'theme-indigo'];
    document.body.classList.remove(...classes);
    if (colorTheme !== 'amber') document.body.classList.add(`theme-${colorTheme}`);
  }, [colorTheme]);

  useEffect(() => {
    if (!showAccountMenu) return;
    const handleClickOutside = () => setShowAccountMenu(false);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [showAccountMenu]);

  const navItems: NavItem[] = [
    {
      id: 'projects',
      label: 'Projects',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
        </svg>
      ),
      action: () => toggleProjectPanel(),
      activeOverride: isProjectPanelOpen,
    },
    {
      id: 'orchestration',
      label: 'Orchestration',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
        </svg>
      ),
      action: () => toggleOrchestrationPanel?.(),
      activeOverride: isOrchestrationPanelOpen,
    },
    {
      id: 'chat',
      label: currentView === 'chat' ? 'Sessions' : 'Chat',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      ),
      action: () => {
        if (currentView === 'chat') {
          // Já está no chat — abre/fecha o painel de sessões
          toggleSessionPanel();
        } else {
          // Está em outra tela — vai pro chat
          if (isSessionPanelOpen) toggleSessionPanel();
          closeAuxPanelsForMainView();
          onSetView('chat');
        }
      },
      activeOverride: currentView === 'chat' || isSessionPanelOpen,
    },
    {
      id: 'automation',
      label: 'Pipelines',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      action: () => { closeAuxPanelsForMainView(); onOpenAutomation(); onSetView('automation'); },
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      action: () => { closeAuxPanelsForMainView(); onOpenDashboard(); onSetView('dashboard'); },
    },
    {
      id: 'memory',
      label: 'Memory',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
      ),
      action: () => { closeAuxPanelsForMainView(); onOpenMemory(); onSetView('memory'); },
    },
    {
      id: 'commands',
      label: 'Commands',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
      action: () => { closeAuxPanelsForMainView(); onOpenCommands(); onSetView('commands'); },
    },
  ];

  return (
    <div className="flex bg-gray-50 dark:bg-dark-950 overflow-hidden font-sans text-sm selection:bg-nebula-500/30 selection:text-nebula-900 dark:selection:text-white transition-colors" style={{ height: vh ? `${vh}px` : '100dvh' }}>

      {/* Backdrop mobile — fixed, fora do flex row */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden animate-in fade-in duration-200"
          onClick={toggleSidebar}
        />
      )}

      {/* Mobile top bar with hamburger navigation */}
      <div className="md:hidden fixed top-0 inset-x-0 z-50 flex items-center gap-2 px-3 py-2 bg-slate-900/95 dark:bg-dark-950/95 backdrop-blur border-b border-slate-800/60">
        <button
          onClick={toggleSidebar}
          aria-label="Open agents"
          className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all ${
            isSidebarOpen ? 'bg-nebula-600/20 ring-1 ring-nebula-500/30 text-nebula-400' : 'text-slate-300 hover:bg-slate-800/70'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Zero</div>
          <div className="truncate text-xs font-semibold text-slate-100">{username}</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { closeAuxPanelsForMainView(); onSetView('chat'); }}
            className="rounded-lg px-2.5 py-2 text-[10px] font-black uppercase tracking-widest text-slate-200 hover:bg-slate-800/70"
          >
            Chat
          </button>
          <button
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex items-center justify-center w-10 h-10 rounded-xl text-slate-300 hover:bg-slate-800/70 transition-all"
          >
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
          <button
            onClick={toggleSessionPanel}
            aria-label="Open sessions"
            className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all ${
              isSessionPanelOpen ? 'bg-nebula-600/20 ring-1 ring-nebula-500/30 text-nebula-400' : 'text-slate-300 hover:bg-slate-800/70'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16h6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile: AgentPanel fixed slide-over */}
      <div className={`md:hidden fixed top-14 bottom-0 left-0 z-50 w-72 max-w-[calc(100vw-3rem)] transition-transform duration-300 ease-in-out ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <AgentPanel
          agents={agents}
          activeAgentId={activeAgentId}
          onSelectAgent={onSelectAgent}
          onAddAgent={onAddAgent}
          onEditAgent={onEditAgent}
          onClose={toggleSidebar}
          runningAgents={runningAgents}
        />
      </div>

      {/* Mobile: SessionPanel fixed slide-over */}
      <div className={`md:hidden fixed top-14 bottom-0 left-0 z-50 w-72 max-w-[calc(100vw-3rem)] transition-transform duration-300 ease-in-out ${
        isSessionPanelOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <SessionPanel
          agents={agents}
          activeAgentId={activeAgentId}
          username={username}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          onRenameSession={onRenameSession}
          onNewSession={onNewSession}
          onNavigateToChat={navigateToChat}
          onClose={toggleSessionPanel}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Notification popover                                                 */}
      {/* ------------------------------------------------------------------ */}
      {showNotifications && (
        <div className="fixed bottom-16 left-0 md:left-14 z-[60] w-80 animate-in slide-in-from-left-2">
          <NotificationDropdown
            notifications={notifications}
            onDismiss={onDismissNotification}
            onMarkAsRead={onMarkAsRead}
            onMarkAllRead={onMarkAllRead}
            onClear={onClearNotifications}
            onClose={() => setShowNotifications(false)}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Icon Rail — desktop only; mobile uses top bar */}
      {/* ------------------------------------------------------------------ */}
      <aside className="hidden md:flex w-14 shrink-0 bg-slate-900 dark:bg-dark-950 border-r border-slate-800/40 flex-col items-center py-3 z-30 relative">
        {/* Logo / Agents toggle */}
        <button
          onClick={toggleSidebar}
          title="Agents"
          className={`flex items-center justify-center w-10 h-10 rounded-xl mb-4 transition-all group relative ${
            isSidebarOpen
              ? 'bg-nebula-600/20 ring-1 ring-nebula-500/30'
              : 'hover:bg-slate-800/60'
          }`}
        >
          <div className="w-5 h-5 bg-nebula-600 rounded flex items-center justify-center shadow-lg shadow-nebula-600/20">
            <div className="w-1.5 h-1.5 bg-white rounded-full" />
          </div>
          <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-[10px] font-bold uppercase tracking-wider text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[100]">
            Agents
          </span>
        </button>

        {/* Divider */}
        <div className="w-6 h-px bg-slate-800 mb-3" />

        {/* Nav items */}
        <div className="flex flex-col gap-1 flex-1">
          {navItems.map(item => (
            <RailBtn
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={item.activeOverride !== undefined ? item.activeOverride : currentView === item.id}
              onClick={item.action}
            />
          ))}
        </div>

        {/* Bottom section */}
        <div className="flex flex-col gap-1 mt-auto">
          {/* Terminal toggle */}
          <RailBtn
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            }
            label="Terminal"
            active={showTerminal}
            onClick={toggleTerminal}
          />

          {/* Console toggle */}
          <RailBtn
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
            label="Logs"
            active={showConsole}
            onClick={toggleConsole}
          />

          {/* Theme toggle */}
          <RailBtn
            icon={
              theme === 'dark' ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )
            }
            label={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
          />

          {/* Notifications */}
          <RailBtn
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
            }
            label="Notifications"
            badge={unreadCount}
            active={showNotifications}
            aria-label="Notifications"
            onClick={() => setShowNotifications(p => !p)}
          />

          {/* Divider */}
          <div className="w-6 h-px bg-slate-800 my-1 mx-auto" />

          {/* Scheduler */}
          <RailBtn
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            label="Scheduler"
            onClick={onOpenScheduler}
          />

          {/* Sync status indicator — sempre visível */}
          <div className={`flex items-center justify-center w-10 h-10 rounded-xl transition-all relative group ${
            syncStatus === 'saving' ? 'text-amber-400' :
            syncStatus === 'saved'  ? 'text-emerald-400' :
            syncStatus === 'error'  ? 'text-red-400' :
            'text-slate-700'
          }`}>
            {syncStatus === 'saving' && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            )}
            {syncStatus === 'saved' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            )}
            {syncStatus === 'error' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
              </svg>
            )}
            {syncStatus === 'idle' && (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4"/>
              </svg>
            )}
            <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-[10px] font-bold uppercase tracking-wider text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[100]">
              {syncStatus === 'saving' ? 'Saving...' : syncStatus === 'saved' ? 'Saved' : syncStatus === 'error' ? 'Sync error' : 'In sync'}
            </span>
          </div>

          {/* Account Menu */}
          <div className="group relative">
            <button
              aria-label="Account menu"
              onClick={(e) => {
                e.stopPropagation();
                setShowAccountMenu((prev) => !prev);
              }}
              title={`Account (${username})`}
              className="flex items-center justify-center w-10 h-10 rounded-xl text-slate-600 hover:text-indigo-500 hover:bg-indigo-500/10 transition-all group relative"
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black text-white"
                style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}
              >
                {username.charAt(0).toUpperCase()}
              </div>
              <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-slate-900 border border-slate-700 text-[10px] font-bold uppercase tracking-wider text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[100]">
                Account ({username})
              </span>
            </button>

            {showAccountMenu && (
              <div
                className="absolute bottom-0 left-full ml-3 w-64 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-3 z-[120]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Active User</div>
                  <div className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-100">{username}</div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Switch User</label>
                    <select
                      aria-label="Switch user"
                      value={username}
                      onChange={(e) => {
                        onSwitchUser?.(e.target.value);
                        setShowAccountMenu(false);
                      }}
                      className="w-full rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-500 transition-all cursor-pointer px-3 py-2"
                    >
                      {users.map((user) => (
                        <option key={user.id} value={user.username}>
                          {user.displayName || user.username}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      setShowAccountMenu(false);
                      onOpenSettings();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37.996.608 2.296.07 2.572-1.065z" />
                      <circle cx="12" cy="12" r="3" strokeWidth={2} />
                    </svg>
                    Settings
                  </button>

                  <button
                    onClick={() => {
                      setShowAccountMenu(false);
                      onLogout();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H6a2 2 0 01-2-2V7a2 2 0 012-2h5a2 2 0 012 2v1" />
                    </svg>
                    Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Desktop: AgentPanel inline no flex row */}
      <div className={`hidden md:block h-full overflow-hidden shrink-0 transition-all duration-200 ${
        isSidebarOpen ? 'w-72' : 'w-0'
      }`}>
        <AgentPanel
          agents={agents}
          activeAgentId={activeAgentId}
          onSelectAgent={onSelectAgent}
          onAddAgent={onAddAgent}
          onEditAgent={onEditAgent}
          onClose={toggleSidebar}
          runningAgents={runningAgents}
        />
      </div>

      {/* Desktop: SessionPanel inline no flex row */}
      <div className={`hidden md:block h-full overflow-hidden shrink-0 transition-all duration-200 ${
        isSessionPanelOpen ? 'w-72' : 'w-0'
      }`}>
        <SessionPanel
          agents={agents}
          activeAgentId={activeAgentId}
          username={username}
          onSelectSession={onSelectSession}
          onDeleteSession={onDeleteSession}
          onRenameSession={onRenameSession}
          onNewSession={onNewSession}
          onNavigateToChat={navigateToChat}
          onClose={toggleSessionPanel}
        />
      </div>

      {/* Project Panel — inline no flex row */}
      <div className={`hidden md:block h-full overflow-hidden shrink-0 ${
        currentView === 'chat' ? 'w-0' : (isProjectPanelOpen ? 'w-72' : 'w-0')
      }`}>
        <ProjectPanel
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
          activeAgentId={activeAgentId}
        />
      </div>

      {/* Mobile: Project Panel fixed slide-over */}
      <div className={`md:hidden fixed inset-y-0 left-0 z-50 w-72 max-w-[calc(100vw-3rem)] transition-transform duration-300 ease-in-out ${
        currentView === 'chat' ? '-translate-x-full' : (isProjectPanelOpen ? 'translate-x-0' : '-translate-x-full')
      }`}>
        <ProjectPanel
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={selectProjectFromMobile}
          onAddProject={onAddProject}
          onEditProject={onEditProject}
          onDeleteProject={onDeleteProject}
          onScanProject={onScanProject}
          scanLoading={scanLoading}
          scanDraft={scanDraft}
          onApproveContext={onApproveContext}
          onDismissDraft={onDismissDraft}
          activeAgentId={activeAgentId}
        />
      </div>

      {/* Orchestration Panel */}
      <div
        className={`flex-shrink-0 overflow-hidden border-r border-slate-700/50 ${
          isOrchestrationPanelOpen ? 'w-72' : 'w-0'
        }`}
      >
        <OrchestrationPanel
          isOpen={!!isOrchestrationPanelOpen}
          onClose={() => toggleOrchestrationPanel?.()}
          username={username}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main content area                                                    */}
      {/* ------------------------------------------------------------------ */}
      <main className="flex-1 flex flex-row h-full w-full bg-white dark:bg-dark-950 transition-colors overflow-hidden pt-14 md:pt-0">
        {children}
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Overlays                                                             */}
      {/* ------------------------------------------------------------------ */}
      <DebugConsole logs={logs} isOpen={showConsole} onToggle={toggleConsole} onClear={clearLogs} />
      {showTerminal && (
        <div className="fixed bottom-0 left-0 md:left-14 right-0 z-40 h-72 border-t border-slate-700/60 shadow-2xl">
          <TerminalPanel
            sessionId="main-terminal"
            basePath={window.location.pathname.split("/").filter(Boolean)[0] ? "/" + window.location.pathname.split("/").filter(Boolean)[0] : ""}
            onClose={toggleTerminal}
          />
        </div>
      )}
    </div>
  );
};

export default Layout;