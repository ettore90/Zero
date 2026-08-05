import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { sessionStore } from '../services/runtime.js';
import {
  normalizeSessionNote,
  readSessionNoteFragment,
  editSessionNoteLocalized,
  isValidSessionNoteOperation,
  hasSessionNoteTarget,
} from '../services/sessionNoteService.js';

const router = Router();

function resolveScopedUsername(req) {
  return String(req.username || req.user?.username || '').trim();
}

function assertSessionOwnership(session, username, res) {
  if (!session) { res.status(404).json({ error: 'Session not found' }); return false; }
  if (String(session.username) !== String(username)) { res.status(403).json({ error: 'Forbidden' }); return false; }
  return true;
}

function getSessionNoteList(session) {
  return Array.isArray(session?.notes) ? session.notes : [];
}

function serializeNoteListItem(note, sessionId) {
  return {
    id: note?.id || note?.noteId || null,
    noteId: note?.noteId || note?.id || null,
    title: note?.title || 'Session Note',
    updatedAt: note?.updatedAt || null,
    updatedBy: note?.updatedBy || null,
    createdAt: note?.createdAt || null,
    sessionId,
  };
}

function areSessionNotesEnabled(session) {
  if (!session || typeof session !== 'object') return false;
  if (session.notesEnabled === true) return true;
  if (session.notesEnabled === false) return false;
  const notes = Array.isArray(session.notes) ? session.notes.filter(Boolean) : [];
  return notes.length > 0 || String(session.activeNoteId || session.active_note || '').trim().length > 0;
}

function findNoteById(session, noteId) {
  return getSessionNoteList(session).find((note) => String(note?.noteId || note?.id || '') === String(noteId || '')) || null;
}

router.get('/sessions', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { agentId, sessionId } = req.query;
  if (!username) return res.status(401).json({ error: 'username required' });

  const sessions = sessionStore.getSessions(username, agentId).filter((session) => !sessionId || String(session.id) === String(sessionId));
  return res.json({
    sessions: sessions.map((s) => {
      const activeNote = findNoteById(s, s.activeNoteId);
      return {
        id: s.id,
        agentId: s.agentId,
        title: s.title,
        summary: s.summary,
        messageCount: (s.messages || []).length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        lastModified: s.updatedAt,
        activeNoteId: s.activeNoteId || null,
        notesEnabled: areSessionNotesEnabled(s),
        noteVersion: activeNote?.version || 0,
        noteUpdatedAt: activeNote?.updatedAt || null,
        noteUpdatedBy: activeNote?.updatedBy || null,
      };
    }),
  });
});

router.get('/notes', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { sessionId } = req.query;
  if (!username) return res.status(401).json({ error: 'username required' });

  const sessions = sessionId
    ? [sessionStore.getSession(String(sessionId))].filter(Boolean)
    : sessionStore.getSessions(username, req.query.agentId);

  const notes = [];
  for (const session of sessions) {
    if (!assertSessionOwnership(session, username, res)) return;
    for (const note of getSessionNoteList(session)) notes.push(serializeNoteListItem(note, session.id));
  }

  return res.json({ sessionId: sessionId ? String(sessionId) : null, notes, activeNoteId: sessionId ? (sessionStore.getSession(String(sessionId))?.activeNoteId || null) : null });
});

router.get('/notes/:noteId', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { sessionId } = req.query;
  if (!username) return res.status(401).json({ error: 'username required' });

  const sessions = sessionId
    ? [sessionStore.getSession(String(sessionId))].filter(Boolean)
    : sessionStore.getSessions(username, req.query.agentId);

  const matches = [];
  for (const session of sessions) {
    if (!assertSessionOwnership(session, username, res)) return;
    const note = findNoteById(session, req.params.noteId);
    if (note) {
      matches.push({
        sessionId: session.id,
        noteId: note.noteId || note.id || null,
        note,
      });
    }
  }

  if (!sessionId && matches.length > 1) {
    return res.json({
      ok: true,
      ambiguous: true,
      noteId: String(req.params.noteId),
      discriminator: 'sessionId',
      matches: matches.map(({ sessionId, note }) => ({
        noteId: note.noteId || note.id || null,
        sessionId,
        title: note.title || 'Session Note',
        updatedAt: note.updatedAt || null,
        version: note.version || 0,
        summary: note.summary || null,
      })),
    });
  }

  if (matches.length === 1) {
    const match = matches[0];
    return res.json({
      ok: true,
      sessionId: match.sessionId,
      noteId: match.noteId,
      activeNoteId: sessionStore.getSession(match.sessionId)?.activeNoteId || null,
      note: match.note,
    });
  }

  return res.status(404).json({ ok: false, error: 'note_not_found', noteId: String(req.params.noteId) });
});

router.get('/sessions/:id', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'username required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  return res.json({ session: session ? { ...session, notesEnabled: areSessionNotesEnabled(session) } : session });
});

router.post('/sessions', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { agentId, id, title, summary, noteId, notes, activeNoteId } = req.body;
  if (!username) return res.status(401).json({ error: 'username required' });
  if (!agentId || !id) return res.status(400).json({ error: 'agentId and id required' });

  const existingSession = sessionStore.getSession(String(id));
  if (existingSession) {
    if (String(existingSession.username) !== String(username)) return res.status(403).json({ error: 'Forbidden' });
    if (String(existingSession.agentId) !== String(agentId)) return res.status(400).json({ error: 'Session does not belong to this agent' });
  }

  const session = sessionStore.ensureSession({ id, agentId, username, title: title || 'New Session' });
  if (title !== undefined) session.title = title;
  if (summary !== undefined) session.summary = summary;
  if (noteId && session.activeNoteId && String(noteId) !== String(session.activeNoteId)) return res.status(400).json({ error: 'noteId does not match active note' });
  if (Array.isArray(notes)) session.notes = notes.map((note) => normalizeSessionNote(note, username, null)).filter(Boolean);
  if (activeNoteId !== undefined) session.activeNoteId = activeNoteId;
  sessionStore.saveSession(session);
  return res.json({ success: true, session });
});


router.post('/sessions/:id/notes-enabled', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { enabled } = req.body || {};
  if (!username) return res.status(401).json({ error: 'username required' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled boolean required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  session.notesEnabled = enabled;
  sessionStore.saveSession(session);
  return res.json({ success: true, sessionId: session.id, notesEnabled: session.notesEnabled === true, session: { ...session, notesEnabled: session.notesEnabled === true } });
});

router.post('/sessions/:id/active-note', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { noteId } = req.body || {};
  if (!username) return res.status(401).json({ error: 'username required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  const note = findNoteById(session, noteId);
  if (!note) return res.status(404).json({ error: 'Session note not found' });
  session.activeNoteId = note.noteId || note.id || null;
  sessionStore.saveSession(session);
  return res.json({ success: true, sessionId: session.id, activeNoteId: session.activeNoteId || null });
});

router.get('/sessions/:id/notes', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'username required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  const activeNote = findNoteById(session, session.activeNoteId);
  return res.json({ sessionId: session.id, activeNoteId: session.activeNoteId || null, noteId: activeNote?.noteId || null, note: activeNote, notes: session.notes || [] });
});

router.get('/sessions/:id/notes/:noteId/read', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'username required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  const targetNoteId = req.params.noteId === 'active_note' ? session.activeNoteId : req.params.noteId;
  const note = findNoteById(session, targetNoteId);
  if (!note) return res.status(404).json({ error: 'Session note not found' });
  const target = { blockId: req.query.blockId, sectionId: req.query.sectionId, anchor: req.query.anchor };
  const includeHtml = req.query.includeHtml !== '0';
  const includeText = req.query.includeText === '1';
  if (!hasSessionNoteTarget(target)) return res.json({ sessionId: session.id, noteId: note.noteId || null, version: note.version || 0, target: null, note, fragment: includeHtml ? { html: note.contentHtml } : {} });
  const result = readSessionNoteFragment(note, target, { includeHtml, includeText });
  if (!result.found) return res.status(404).json({ error: 'Session note target not found', target });
  return res.json({ sessionId: session.id, noteId: note.noteId || null, version: note.version || 0, target: result.target, fragment: result.fragment });
});

router.patch('/sessions/:id/notes/:noteId', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const body = req.body || {};
  const { expectedVersion, target, operation, contentHtml, operations, noteId, title } = body;
  if (!username) return res.status(401).json({ error: 'username required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  const targetNoteId = req.params.noteId === 'active_note' ? session.activeNoteId : req.params.noteId;
  const note = findNoteById(session, targetNoteId);
  const hasStructuredOperations = Array.isArray(operations) && operations.length > 0;
  const hasLegacyOperation = typeof operation === 'string' && operation.trim().length > 0;
  if (!note) return res.status(404).json({ error: 'Session note not found' });
  if (noteId && String(noteId) !== String(note.noteId || note.id || '')) return res.status(400).json({ error: 'noteId does not match active session note' });
  if (!hasStructuredOperations && !hasLegacyOperation) return res.status(400).json({ error: 'invalid_session_note_payload', detail: 'Provide operations[] or a legacy operation' });
  if (hasLegacyOperation && !isValidSessionNoteOperation(operation)) return res.status(400).json({ error: 'unsupported_operation' });
  if (!hasStructuredOperations && !hasSessionNoteTarget(target)) return res.status(400).json({ error: 'target selector required' });
  try {
    const edited = editSessionNoteLocalized(note, { expectedVersion, target, operation, contentHtml, operations }, username);
    if (typeof title === 'string') {
      edited.note = normalizeSessionNote({ ...edited.note, title }, username, edited.note, { version: edited.note.version });
    }
    const nextNotes = Array.isArray(session.notes) ? session.notes.filter((n) => String(n.noteId) !== String(edited.note.noteId || '')) : [];
    nextNotes.push(edited.note);
    session.notes = nextNotes;
    session.activeNoteId = edited.note.noteId || session.activeNoteId || null;
    sessionStore.saveSession(session);
    return res.json({ success: true, sessionId: session.id, noteId: edited.note.noteId || null, version: edited.note.version || 0, updatedAt: edited.note.updatedAt, updatedBy: edited.note.updatedBy, appliedOperation: edited.appliedOperation || edited.appliedOperations || null, resolvedTarget: edited.resolvedTarget, anchors: edited.note.anchors || [], note: edited.note });
  } catch (error) {
    if (error?.code === 'version_conflict') return res.status(409).json({ error: 'version_conflict', currentVersion: error.currentVersion ?? null });
    if (error?.code === 'target_not_found') return res.status(404).json({ error: 'target_not_found', target });
    if (error?.code === 'block_target_required') return res.status(400).json({ error: 'invalid_session_note_payload', detail: 'block target required' });
    if (error?.code === 'block_id_required') return res.status(400).json({ error: 'invalid_session_note_payload', detail: 'block id required' });
    if (error?.code === 'section_id_required') return res.status(400).json({ error: 'invalid_session_note_payload', detail: 'section id required' });
    if (error?.code === 'section_not_found') return res.status(404).json({ error: 'session_note_target_not_found', detail: 'section not found' });
    if (error?.code === 'block_not_found') return res.status(404).json({ error: 'session_note_target_not_found', detail: 'block not found' });
    if (error?.code === 'content_required') return res.status(400).json({ error: 'content_required' });
    if (error?.code === 'target_required') return res.status(400).json({ error: 'invalid_session_note_payload', detail: 'target selector required' });
    if (error?.message === 'unsupported_operation' || error?.code === 'unsupported_operation') return res.status(400).json({ error: 'unsupported_operation' });
    if (error?.code === 'invalid_session_note_payload') return res.status(400).json({ error: 'invalid_session_note_payload', detail: error?.message || String(error) });
    return res.status(500).json({ error: 'Failed to edit session note', detail: error?.message || String(error) });
  }
});

router.post('/sessions/:id/notes', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { note, noteId, activeNoteId } = req.body || {};
  if (!username) return res.status(401).json({ error: 'username required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  const notePayload = note && typeof note === 'object' && !Array.isArray(note) ? { ...note } : note;
  if (note === undefined) return res.status(400).json({ error: 'note required' });
  if (notePayload && typeof notePayload === 'object' && !Array.isArray(notePayload)) { delete notePayload.noteId; delete notePayload.activeNoteId; }
  const normalizedSessionNote = normalizeSessionNote(notePayload, username);
  if (normalizedSessionNote === undefined) return res.status(400).json({ error: 'note required' });
  session.notes = [...(session.notes || []), normalizedSessionNote];
  session.activeNoteId = normalizedSessionNote.noteId || null;
  sessionStore.saveSession(session);
  return res.json({ success: true, sessionId: session.id, noteId: normalizedSessionNote.noteId || null, version: normalizedSessionNote.version || 0, updatedAt: normalizedSessionNote.updatedAt || null, updatedBy: normalizedSessionNote.updatedBy || null, anchors: normalizedSessionNote.anchors || [], session });
});

router.delete('/sessions/:id/notes/:noteId', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'username required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  const targetNoteId = req.params.noteId === 'active_note' ? session.activeNoteId : req.params.noteId;
  const note = findNoteById(session, targetNoteId);
  if (!note) return res.status(404).json({ error: 'Session note not found' });
  session.notes = (session.notes || []).filter((n) => String(n.noteId) !== String(note.noteId));
  if (String(session.activeNoteId) === String(note.noteId)) session.activeNoteId = session.notes[0]?.noteId || null;
  sessionStore.saveSession(session);
  return res.json({ success: true, sessionId: session.id, noteId: note.noteId || null, version: note.version || 0, activeNoteId: session.activeNoteId || null });
});

router.delete('/sessions/:id', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  if (!username) return res.status(401).json({ error: 'username required' });
  const session = sessionStore.getSession(req.params.id);
  if (!assertSessionOwnership(session, username, res)) return;
  sessionStore.deleteSession(req.params.id);
  return res.json({ success: true });
});

export default router;
