import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isSessionNoteTabPath } from './sessionNoteHelpers';
import {
  buildSessionNoteLoadContext,
  buildSessionNotePersistenceState,
  buildSessionNoteSnapshot,
  buildSessionNoteSyncPlan,
  executeSessionNoteSyncPlan,
  normalizeSessionNote as normalizeSessionNoteState,
  shouldApplySessionNoteRemoteLoad,
  type NormalizeSessionNoteResult,
  type SessionNoteSessionInput,
  type SessionNotePersistenceSyncInput,
  type SessionNoteTabLike,
  type ExecuteSessionNoteSyncPlanResult,
  type NormalizedSessionNote,
} from './sessionNoteController';

type SessionNoteSyncLoadResult = SessionNoteSessionInput | null;
type SessionNoteSyncSaveResult = SessionNoteSessionInput | null;
type SessionNoteSyncWriteFileResult = void;

export type SessionNoteSyncPort = {
  loadSession: (sessionId: string, username: string) => Promise<SessionNoteSyncLoadResult>;
  saveSessionNote: (sessionId: string, username: string, payload: { title: string; contentHtml: string; noteId?: string | null }) => Promise<SessionNoteSyncSaveResult>;
  writeFile: (path: string, content: string, mode: string) => Promise<SessionNoteSyncWriteFileResult>;
  revealSessionNotesUi: () => void;
};
export type UseSessionNoteSyncParams = {
  agent: { activeSessionId?: string | null };
  username: string;
  canvas: {
    tabs?: SessionNoteTabLike[];
    activeTabId?: string | null;
    markTabSaved: (tabId: string, content: string) => void;
    pinTabByPath?: (path: string, title?: string) => void;
    renameTab?: (tabId: string, newPath: string, options?: { activate?: boolean; preserveVisibility?: boolean; pinTitle?: string; preserveContent?: boolean; preserveSavedContent?: boolean }) => { tabId: string; path: string } | null;
    upsertTab?: (path: string, content: string, options?: { activate?: boolean }) => void;
  } & import('./sessionNoteController').SessionNoteCanvasSyncAdapter;
  port: SessionNoteSyncPort;
  sessionNoteLoadKeyRef: React.MutableRefObject<string | null>;
  sessionNoteRemoteRefreshKey?: number;
};

export type UseSessionNoteSyncResult = {
  normalizeSessionNote: (session: SessionNoteSessionInput) => NormalizeSessionNoteResult;
  sessionSnapshot: NormalizeSessionNoteResult;
  syncSessionNoteTab: (sessionNote: SessionNotePersistenceSyncInput, options?: SessionNoteSyncOptions) => ExecuteSessionNoteSyncPlanResult;
  selectSessionNoteLocally: (sessionNote: SessionNotePersistenceSyncInput, options?: { activate?: boolean }) => void;
  handleCreateSessionNote: () => Promise<void>;
  handleSaveTab: (tabId: string, content: string, path: string, title?: string) => Promise<void>;
  sessionNoteLoadKeyRef: React.MutableRefObject<string | null>;
};

type SessionNoteSyncOptions = { intent?: 'load' | 'save'; activate?: boolean; preserveVisibility?: boolean; activeNoteId?: string | null; sessionId?: string | null };

export const useSessionNoteSync = ({
  agent,
  username,
  canvas,
  port,
  sessionNoteLoadKeyRef,
  sessionNoteRemoteRefreshKey,
}: UseSessionNoteSyncParams): UseSessionNoteSyncResult => {
  const normalizeSessionNote = useCallback((session: SessionNoteSessionInput): NormalizeSessionNoteResult => normalizeSessionNoteState(session), []);
  const [sessionSnapshot, setSessionSnapshot] = useState<NormalizeSessionNoteResult>({ notes: [], activeNoteId: null, sessionNote: null, contentHtml: '' });

  const sessionNoteTabPathsSignature = useMemo(() => {
    if (!Array.isArray(canvas.tabs) || !agent.activeSessionId) return '';
    return canvas.tabs
      .map((tab: SessionNoteTabLike) => String(tab.path || '').trim())
      .filter((tabPath: string) => isSessionNoteTabPath(tabPath, agent.activeSessionId))
      .sort()
      .join('|');
  }, [canvas.tabs, agent.activeSessionId]);

  const lastRemoteRefreshKeyRef = useRef<number | undefined>(undefined);
  const activeOpenRequestRef = useRef<{ seq: number; noteId: string | null; sessionId: string | null }>({ seq: 0, noteId: null, sessionId: null });

  const resolveNoteIdentity = useCallback((sessionNote: SessionNotePersistenceSyncInput | NormalizedSessionNote | null | undefined) => {
    const noteId = String(sessionNote?.noteId || sessionNote?.id || '').trim();
    return noteId || null;
  }, []);

  const beginOpenRequest = useCallback((sessionNote: SessionNotePersistenceSyncInput | NormalizedSessionNote | null | undefined) => {
    const noteId = resolveNoteIdentity(sessionNote);
    const sessionId = String((sessionNote as any)?.sessionId || '').trim() || null;
    const nextSeq = activeOpenRequestRef.current.seq + 1;
    activeOpenRequestRef.current = { seq: nextSeq, noteId, sessionId };
    return { seq: nextSeq, noteId, sessionId };
  }, [resolveNoteIdentity]);

  const matchesOpenRequest = useCallback((
    request: { seq: number; noteId: string | null; sessionId: string | null },
    sessionNote: SessionNotePersistenceSyncInput | NormalizedSessionNote | null | undefined,
    activeNoteId?: string | null,
  ) => {
    const current = activeOpenRequestRef.current;
    if (current.seq !== request.seq) return false;
    const incomingNoteId = String(activeNoteId || resolveNoteIdentity(sessionNote) || '').trim() || null;
    const incomingSessionId = String((sessionNote as any)?.sessionId || '').trim() || null;
    if (request.sessionId && current.sessionId !== request.sessionId) return false;
    if (request.noteId && (current.noteId !== request.noteId || incomingNoteId !== request.noteId)) return false;
    if (request.sessionId && incomingSessionId && incomingSessionId !== request.sessionId) return false;
    return true;
  }, [resolveNoteIdentity]);

  const syncSessionNoteTab = useCallback((sessionNote: SessionNotePersistenceSyncInput, options?: SessionNoteSyncOptions): ExecuteSessionNoteSyncPlanResult => {
    const ownerSessionId = String(options?.sessionId || sessionNote?.sessionId || agent.activeSessionId || '').trim();
    if (!ownerSessionId) return null;
    const sessionSnapshot = buildSessionNoteSnapshot({
      session: { note: { ...sessionNote, sessionId: ownerSessionId }, activeNoteId: options?.activeNoteId },
      activeSessionId: ownerSessionId,
    });
    const plan = buildSessionNoteSyncPlan({
      targetSessionNoteTabPath: sessionSnapshot.targetSessionNoteTabPath,
      tabs: Array.isArray(canvas.tabs) ? canvas.tabs : [],
      title: typeof sessionSnapshot.sessionNote?.title === 'string' ? sessionSnapshot.sessionNote.title : 'Session note',
      contentHtml: sessionSnapshot.contentHtml,
      intent: options?.intent ?? 'load',
      activate: options?.activate ?? false,
      preserveVisibility: options?.preserveVisibility
    });

    return executeSessionNoteSyncPlan(plan, canvas);
  }, [agent.activeSessionId, canvas]);

  const selectSessionNoteLocally = useCallback((sessionNote: SessionNotePersistenceSyncInput, options?: { activate?: boolean }) => {
    if (!agent.activeSessionId) return;
    const request = beginOpenRequest(sessionNote);
    const noteId = request.noteId;
    const contentHtml = typeof sessionNote?.contentHtml === 'string' ? sessionNote.contentHtml : '';
    const nextSessionNote = {
      ...sessionNote,
      noteId: noteId || sessionNote?.noteId || sessionNote?.id || null,
      id: noteId || sessionNote?.id || sessionNote?.noteId || null,
      sessionId: String((sessionNote as any)?.sessionId || agent.activeSessionId || '').trim() || null,
      contentHtml,
    };
    setSessionSnapshot((previous) => {
      const previousNotes = Array.isArray(previous.notes) ? previous.notes : [];
      const nextNotes = previousNotes.some((note) => String(note?.noteId || note?.id || '').trim() === String(noteId || '').trim())
        ? previousNotes.map((note) => String(note?.noteId || note?.id || '').trim() === String(noteId || '').trim() ? { ...note, ...nextSessionNote } : note)
        : [...previousNotes, nextSessionNote];
      return {
        notes: nextNotes,
        activeNoteId: noteId,
        sessionNote: nextSessionNote,
        contentHtml,
      };
    });
    syncSessionNoteTab(nextSessionNote, {
      intent: 'load',
      activeNoteId: noteId,
      activate: options?.activate ?? true,
      preserveVisibility: false,
      sessionId: String((nextSessionNote as any)?.sessionId || '').trim() || null
    });
  }, [agent.activeSessionId, beginOpenRequest, syncSessionNoteTab]);

  useEffect(() => {
    const loadSessionNote = async (cancelledRef: { current: boolean }) => {
      const activeSessionId = agent.activeSessionId;
      if (!activeSessionId) return;
      const request = { ...activeOpenRequestRef.current };
      const ownerSessionId = String(request.sessionId || activeSessionId || '').trim() || activeSessionId;
      const session = await port.loadSession(ownerSessionId, username).catch(() => null);
      const sessionSnapshot = buildSessionNoteSnapshot({ session, activeSessionId: ownerSessionId });
      const { notes, activeNoteId, sessionNote, loadKey } = sessionSnapshot;
      const remoteLoadDecision = shouldApplySessionNoteRemoteLoad({
        loadKey,
        currentLoadKey: sessionNoteLoadKeyRef.current,
        previousRemoteRefreshKey: lastRemoteRefreshKeyRef.current,
        remoteRefreshKey: sessionNoteRemoteRefreshKey,
        sessionNote,
      });
      if (cancelledRef.current || !remoteLoadDecision.shouldApply) return;
      if (!matchesOpenRequest(request, sessionNote, activeNoteId)) return;
      setSessionSnapshot({ notes, activeNoteId, sessionNote, contentHtml: sessionSnapshot.contentHtml });
      lastRemoteRefreshKeyRef.current = sessionNoteRemoteRefreshKey;
      const loadContext = buildSessionNoteLoadContext({
        notes,
        tabs: Array.isArray(canvas.tabs) ? canvas.tabs : [],
        activeSessionId: String(sessionNote?.sessionId || ownerSessionId || activeSessionId || '').trim() || ownerSessionId,
      });
      sessionNoteLoadKeyRef.current = loadKey;
      if (sessionNote) {
        syncSessionNoteTab({ ...sessionNote, contentHtml: typeof sessionNote?.contentHtml === 'string' ? sessionNote.contentHtml : '' }, {
          intent: 'load',
          activeNoteId,
          activate: false,
          preserveVisibility: loadContext.preserveVisibility,
          sessionId: String(sessionNote?.sessionId || ownerSessionId || activeSessionId || '').trim() || ownerSessionId
        });
      }
    };
    if (!username || !agent.activeSessionId || agent.activeSessionId === 'default') return;
    const cancelledRef = { current: false };
    loadSessionNote(cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [username, agent.activeSessionId, matchesOpenRequest, normalizeSessionNote, syncSessionNoteTab, sessionNoteTabPathsSignature, sessionNoteRemoteRefreshKey, port, sessionNoteLoadKeyRef]);

  const handleCreateSessionNote = useCallback(async () => {
    if (!username || !agent.activeSessionId || agent.activeSessionId === 'default') return;
    const saved = await port.saveSessionNote(agent.activeSessionId, username, { title: 'Session note', contentHtml: '<p></p>' }).catch(() => null);
    const savedEnvelope = saved as ({ session?: SessionNoteSessionInput | null; note?: { noteId?: string | null; id?: string | null } | null; noteId?: string | null } | null);
    const createBranchState = buildSessionNotePersistenceState({
      activeSessionId: agent.activeSessionId,
      saved: savedEnvelope?.session || saved,
    });
    if (createBranchState.shouldProceed) {
      const createdNote = {
        ...createBranchState.syncInput,
        noteId: String(createBranchState.syncInput?.noteId || savedEnvelope?.noteId || savedEnvelope?.note?.noteId || savedEnvelope?.note?.id || '').trim() || createBranchState.syncInput?.noteId || null,
        id: String(createBranchState.syncInput?.id || savedEnvelope?.noteId || savedEnvelope?.note?.id || savedEnvelope?.note?.noteId || '').trim() || createBranchState.syncInput?.id || null,
        sessionId: agent.activeSessionId,
        contentHtml: typeof createBranchState.syncInput?.contentHtml === 'string' ? createBranchState.syncInput.contentHtml : '<p></p>',
      };
      beginOpenRequest(createdNote);
      setSessionSnapshot((previous) => {
        const previousNotes = Array.isArray(previous.notes) ? previous.notes : [];
        const createdIdentity = String(createdNote.noteId || createdNote.id || '').trim();
        const nextNotes = createdIdentity
          ? previousNotes.some((note) => String(note?.noteId || note?.id || '').trim() === createdIdentity)
            ? previousNotes.map((note) => String(note?.noteId || note?.id || '').trim() === createdIdentity ? { ...note, ...createdNote } : note)
            : [...previousNotes, createdNote]
          : [...previousNotes, createdNote];
        return {
          notes: nextNotes,
          activeNoteId: String(createdNote.noteId || createdNote.id || '').trim() || null,
          sessionNote: createdNote,
          contentHtml: createdNote.contentHtml,
        };
      });
      sessionNoteLoadKeyRef.current = createBranchState.loadKey;
      syncSessionNoteTab(createdNote, { ...createBranchState.syncOptions, sessionId: agent.activeSessionId });
      port.revealSessionNotesUi();
    }
  }, [username, agent.activeSessionId, beginOpenRequest, syncSessionNoteTab, port, sessionNoteLoadKeyRef]);

  const handleSaveTab = async (tabId: string, content: string, path: string, title?: string) => {
    try {
      if (isSessionNoteTabPath(path) && agent.activeSessionId) {
        const ownerSessionId = String(agent.activeSessionId || '').trim();
        const derivedNoteId = String(
          sessionSnapshot.activeNoteId
          || (sessionSnapshot.sessionNote as any)?.noteId
          || (sessionSnapshot.sessionNote as any)?.id
          || ''
        ).trim() || null;
        const saved = await port.saveSessionNote(ownerSessionId, username, { title: title ?? 'Session note', contentHtml: content, noteId: derivedNoteId });
        const saveBranchState = buildSessionNotePersistenceState({
          activeSessionId: ownerSessionId,
          path,
          fallbackTabId: tabId,
          fallbackTitle: title,
          fallbackContent: content,
          saved,
        });
        if (!saveBranchState.shouldProceed) {
          return;
        }
        const nextSnapshot = normalizeSessionNote(saved);
        beginOpenRequest({ ...saveBranchState.syncInput, sessionId: ownerSessionId });
        setSessionSnapshot(nextSnapshot);
        sessionNoteLoadKeyRef.current = saveBranchState.loadKey;

        const currentTabs = Array.isArray(canvas.tabs) ? canvas.tabs : [];
        const existingSessionTab = currentTabs.find((tab) => String(tab?.id || '').trim() === String(tabId || '').trim()) ?? null;
        const existingTabPath = String(existingSessionTab?.path || '').trim();
        const existingTabContent = String(existingSessionTab?.content || '');
        const existingTabSavedContent = String(existingSessionTab?.savedContent || existingSessionTab?.content || '');
        const existingTabTitle = String((existingSessionTab as any)?.filename || title || 'Session note');
        const canPatchInPlace = Boolean(
          existingSessionTab
          && existingTabPath === saveBranchState.resolvedPath
        );

        if (canPatchInPlace) {
          if (existingTabContent !== saveBranchState.resolvedContent && typeof canvas.updateTabContent === 'function') {
            canvas.updateTabContent(tabId, saveBranchState.resolvedContent);
          }
          if (existingTabSavedContent !== saveBranchState.resolvedContent) {
            canvas.markTabSaved(tabId, saveBranchState.resolvedContent);
          }
          if ((existingTabPath !== saveBranchState.resolvedPath || existingTabTitle !== saveBranchState.savedTitle) && typeof canvas.renameTab === 'function') {
            canvas.renameTab(tabId, saveBranchState.resolvedPath, {
              activate: true,
              preserveVisibility: true,
              pinTitle: saveBranchState.savedTitle,
            });
          } else if (existingTabTitle !== saveBranchState.savedTitle && typeof canvas.pinTabByPath === 'function') {
            canvas.pinTabByPath(saveBranchState.resolvedPath, saveBranchState.savedTitle);
          }
          return;
        }

        syncSessionNoteTab(saveBranchState.syncInput, saveBranchState.syncOptions);
        return;
      }
      await port.writeFile(path, content, 'manual-save');
      if (typeof canvas.upsertTab === 'function') {
        canvas.upsertTab(path, content, { activate: true });
      }
      canvas.markTabSaved(tabId, content);
    } catch (e: unknown) {
      console.error('Save failed:', e);
    }
  };

  return { normalizeSessionNote, sessionSnapshot, syncSessionNoteTab, selectSessionNoteLocally, handleCreateSessionNote, handleSaveTab, sessionNoteLoadKeyRef };
};
