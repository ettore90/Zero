export const SESSION_NOTES_TOOL_NAMES = new Set(['list_notes', 'read_note', 'write_note', 'delete_note', 'set_active_note']);

export function areSessionNotesEnabled(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.notesEnabled === true) return true;
  if (session.notesEnabled === false) return false;
  const notes = Array.isArray(session.notes) ? session.notes.filter(Boolean) : [];
  return notes.length > 0 || String(session.activeNoteId || session.active_note || '').trim().length > 0;
}

export function isToolAllowedForSession(toolName, session) {
  const name = String(toolName || '').trim();
  if (!name) return false;
  if (name === 'set_session_notes_enabled') return true;
  if (!SESSION_NOTES_TOOL_NAMES.has(name)) return true;
  return areSessionNotesEnabled(session);
}
