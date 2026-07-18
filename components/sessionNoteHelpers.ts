export const SESSION_NOTE_TAB_NAMESPACE = '.session-note/';

export const getSessionNoteTabPath = (activeSessionId?: string | null, noteId?: string | null) => {
  const sessionId = activeSessionId || 'no-session';
  const normalizedNoteId = String(noteId || 'default').trim() || 'default';
  return `${SESSION_NOTE_TAB_NAMESPACE}${sessionId}-${normalizedNoteId}.html`;
};

export const isSessionNoteTabPath = (path: string, activeSessionId?: string | null) => {
  const normalizedPath = String(path || '').trim();
  const normalizedSessionId = String(activeSessionId || '').trim();
  if (!normalizedPath.startsWith(SESSION_NOTE_TAB_NAMESPACE)) return false;
  if (!normalizedSessionId) return true;
  return normalizedPath.startsWith(`${SESSION_NOTE_TAB_NAMESPACE}${normalizedSessionId}-`);
};

type SessionNoteIdentitySource = {
  id?: string | null;
  noteId?: string | null;
};

export type SessionNoteIdentityInput = SessionNoteIdentitySource | null | undefined;

export const getSessionNoteIdentity = (sessionNote: SessionNoteIdentityInput, activeSessionId?: string | null, explicitActiveNoteId?: string | null) => {
  const noteId = String(explicitActiveNoteId || sessionNote?.noteId || sessionNote?.id || 'default').trim() || 'default';
  return {
    noteId,
    path: getSessionNoteTabPath(activeSessionId, noteId),
  };
};
