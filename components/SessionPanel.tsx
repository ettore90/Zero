import React, { useEffect, useMemo, useState } from 'react';
import { Agent, ChatSession } from '../types';
import * as ServerChat from '../services/serverChatService';

const PAGE_SIZE = 10;

interface SessionPanelProps {
  agents: Agent[];
  activeAgentId: string;
  username: string;
  onSelectSession: (agentId: string, sessionId: string) => void;
  onDeleteSession: (agentId: string, sessionId: string) => void;
  onRenameSession: (agentId: string, sessionId: string, title: string) => void;
  onNewSession: (agentId: string) => void;
  onNavigateToChat: () => void;
  onClose: () => void;
}

const SessionPanel: React.FC<SessionPanelProps> = ({
  agents,
  activeAgentId,
  username,
  onSelectSession,
  onDeleteSession,
  onRenameSession,
  onNewSession,
  onNavigateToChat,
  onClose,
}) => {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  const masterAgent = agents.find(a => a.id === activeAgentId) || agents.find(a => a.isMaster);

  useEffect(() => {
    let cancelled = false;
    const loadSessions = async () => {
      if (!masterAgent?.id) {
        if (!cancelled) setSessions([]);
        return;
      }
      const listed = await ServerChat.listSessions(username, masterAgent.id);
      if (cancelled) return;
      setSessions((listed || []) as ChatSession[]);
    };
    loadSessions();
    const handleSessionUpdated = () => {
      loadSessions();
    };
    const unsubscribe = (window as any).Di?.on?.((event: any) => {
      if (event?.type === 'session_updated' || event === 'session_updated') {
        handleSessionUpdated();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [masterAgent?.id, username]);

  const sorted = useMemo(() => [...sessions].sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0)), [sessions]);
  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  const startRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(session.id);
    setRenameValue(session.title || '');
  };

  const commitRename = (agentId: string, sessionId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed && masterAgent) onRenameSession(agentId, sessionId, trimmed);
    setRenamingId(null);
  };

  const handleSelect = (session: ChatSession) => {
    if (renamingId === session.id || !masterAgent) return;
    setPendingId(session.id);
    onNavigateToChat();
    onSelectSession(masterAgent.id, session.id);
    onClose();
    // Clear pending after a short delay (in case panel stays mounted)
    setTimeout(() => setPendingId(null), 600);
  };

  return (
    <div className="flex flex-col h-full w-full min-h-0 bg-slate-900 border-r border-slate-800/60 shadow-2xl">

      {/* Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-slate-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-[10px] font-black tracking-[0.25em] uppercase text-white/90">Sessions</h1>
          <span className="text-[9px] font-mono text-slate-500">({sorted.length})</span>
        </div>
        <button onClick={onClose} className="p-1 text-slate-500 hover:text-white">◀</button>
      </div>

      {/* New Session */}
      {masterAgent && (
        <div className="px-3 pt-3 pb-2 shrink-0">
          <button
            onClick={() => { onNavigateToChat(); onNewSession(masterAgent.id); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-all bg-nebula-600/15 border border-nebula-500/30 text-nebula-500 dark:text-nebula-300"
          >
            <span className="text-[10px] font-black uppercase tracking-wider">New Session</span>
          </button>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-1">
        {visible.map(session => {
          const isActive = masterAgent?.activeSessionId === session.id;
          const isRenaming = renamingId === session.id;
          const isPending = pendingId === session.id;

          return (
            <div
              key={session.id}
              className="group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors select-none"
              style={{
                background: isActive || isPending ? 'rgba(30,41,59,1)' : 'transparent',
                color: isActive || isPending ? '#fff' : '#64748b',
                opacity: isPending ? 0.75 : 1,
              }}
              onClick={() => handleSelect(session)}
            >
              {/* Text area — no stopPropagation so clicks bubble up to the row */}
              <div className="flex-1 min-w-0">
                {isRenaming ? (
                  <input
                    autoFocus
                    className="w-full bg-slate-700 text-white text-xs px-1.5 py-0.5 rounded outline-none border border-nebula-500/50"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onBlur={() => masterAgent && commitRename(masterAgent.id, session.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && masterAgent) commitRename(masterAgent.id, session.id);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                  />
                ) : (
                  <>
                    <p className="text-xs truncate">{session.title || 'Session'}</p>
                    <p className="text-[9px] text-slate-500">
                      {session.lastModified ? new Date(session.lastModified).toLocaleDateString() : '—'}
                    </p>
                  </>
                )}
              </div>

              {/* Action buttons */}
              {!isRenaming && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                  <button
                    onClick={e => startRename(session, e)}
                    className="p-1 text-slate-500 hover:text-slate-200"
                    title="Rename"
                  >✎</button>
                  <button
                    onClick={e => { e.stopPropagation(); masterAgent && onDeleteSession(masterAgent.id, session.id); }}
                    className="p-1 text-slate-600 hover:text-red-400"
                    title="Delete"
                  >✕</button>
                </div>
              )}
            </div>
          );
        })}

        {hasMore && (
          <button
            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
            className="w-full py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-nebula-300"
          >
            Show more…
          </button>
        )}

        {sorted.length === 0 && (
          <p className="text-center text-xs py-8 text-slate-600">No sessions yet</p>
        )}
      </div>
    </div>
  );
};

export default React.memo(SessionPanel);
