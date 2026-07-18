import { getSessionNoteIdentity, isSessionNoteTabPath } from './sessionNoteHelpers';

export type NormalizedSessionNote = {
  id?: string | null;
  noteId?: string | null;
  sessionId?: string | null;
  title?: string | null;
  contentHtml?: string | null;
};

export type NormalizeSessionNoteResult = {
  notes: NormalizedSessionNote[];
  activeNoteId: string | null;
  sessionNote: NormalizedSessionNote | null;
  contentHtml: string;
};

export type SessionNoteSessionInput = {
  notes?: unknown;
  activeNoteId?: unknown;
  note?: unknown;
} | null | undefined;

export type SessionNoteTabLike = {
  id?: string | null;
  path?: string | null;
  content?: string | null;
  savedContent?: string | null;
};

export type ResolveCandidateSessionNoteTabInput = {
  matchingTabs: SessionNoteTabLike[];
  targetSessionNoteTabPath: string;
  nextContent: string;
  isTabDirty: (tab: SessionNoteTabLike | null | undefined, nextContent: string) => boolean;
};

export type BuildSessionNoteLoadKeyInput = {
  activeSessionId?: string | null;
  activeNoteId?: string | null;
  sessionNote?: NormalizedSessionNote | null;
  notes?: NormalizedSessionNote[];
};

export type SessionNoteSnapshot = NormalizeSessionNoteResult & {
  targetSessionNoteTabPath: string;
  loadKey: string;
};

export type BuildSessionNoteSnapshotInput = {
  session: SessionNoteSessionInput;
  activeSessionId?: string | null;
};

export type DeriveRelevantSessionNotePathsInput = {
  notes?: NormalizedSessionNote[];
  tabs?: SessionNoteTabLike[];
  activeSessionId?: string | null;
};

export type BuildSessionNoteSyncPlanInput = {
  tabs?: SessionNoteTabLike[];
  targetSessionNoteTabPath: string;
  title?: string | null;
  contentHtml: string;
  intent?: 'load' | 'save';
  activate?: boolean;
  preserveVisibility?: boolean;
};

export type BuildSessionNoteLoadContextInput = {
  notes?: NormalizedSessionNote[];
  tabs?: SessionNoteTabLike[];
  activeSessionId?: string | null;
};

export type BuildSessionNotePersistenceStateInput = {
  activeSessionId?: string | null;
  saved: SessionNoteSessionInput;
  path?: string | null;
  fallbackTabId?: string | null;
  fallbackTitle?: string | null;
  fallbackContent?: string | null;
};

export type SessionNotePersistenceSyncInput = NormalizedSessionNote;

export type SessionNotePersistenceState = {
  shouldProceed: boolean;
  loadKey: string;
  savedTitle: string;
  syncInput: SessionNotePersistenceSyncInput;
  syncOptions: { intent: 'save'; activeNoteId?: string | null; activate: true };
  resolvedTabId: string;
  resolvedPath: string;
  resolvedContent: string;
};

export type SessionNoteLoadContext = {
  sessionNotePaths: string[];
  activeSessionTab: SessionNoteTabLike | null;
  preserveVisibility: boolean;
  shouldRevealEditorRail: boolean;
};

export type ShouldApplySessionNoteRemoteLoadInput = {
  loadKey: string;
  currentLoadKey?: string | null;
  previousRemoteRefreshKey?: number;
  remoteRefreshKey?: number;
  sessionNote?: NormalizedSessionNote | null;
};

export type ShouldApplySessionNoteRemoteLoadResult = {
  hasSessionNote: boolean;
  hasNewRemoteRefresh: boolean;
  hasMatchingLoadKey: boolean;
  shouldApply: boolean;
};

export type SessionNoteSyncPlan = {
  targetSessionNoteTabPath: string;
  title: string;
  contentHtml: string;
  intent: 'load' | 'save';
  activate: boolean;
  preserveVisibility: boolean;
  existingTabId: string | null;
  existingTabPath: string | null;
  existingTabContent: string;
  existingTabSavedContent: string;
  existingTabTitle: string;
  shouldOpenFile: boolean;
  shouldUpdateTabContent: boolean;
  shouldMarkTabSaved: boolean;
  shouldPinTab: boolean;
  shouldActivateSavedTab: boolean;
  staleTabIds: string[];
};

export type SessionNoteCanvasSyncAdapter = {
  renameTab?: ((tabId: string, nextPath: string, options?: { activate?: boolean; preserveVisibility?: boolean; pinTitle?: string }) => void) | null;
  upsertTab?: ((path: string, content: string, options?: { preserveVisibility?: boolean; activate?: boolean; pinTitle?: string }) => void) | null;
  updateTabContent?: ((tabId: string, content: string) => void) | null;
  markTabSaved?: ((tabId: string, content: string) => void) | null;
  closeTab?: ((tabId: string) => void) | null;
  pinTabByPath?: ((path: string, title?: string) => void) | null;
  setActiveTab?: ((tabId: string) => void) | null;
  openFile?: ((path: string, content: string) => void) | null;
  tabs?: SessionNoteTabLike[];
};

export type ExecuteSessionNoteSyncPlanResult = {
  tabId: string;
  path: string;
  title: string;
  contentHtml: string;
} | null;

export const normalizeSessionNote = (session: SessionNoteSessionInput): NormalizeSessionNoteResult => {
  const sessionNotes = Array.isArray(session?.notes) ? (session.notes as NormalizedSessionNote[]) : [];
  const notes = sessionNotes.filter((note: NormalizedSessionNote) => note && typeof note === 'object');
  const activeNoteId = typeof session?.activeNoteId === 'string' ? session.activeNoteId : null;
  const activeNote = notes.find((note: NormalizedSessionNote) => note?.id === activeNoteId || note?.noteId === activeNoteId) || null;
  const fallbackSessionNote = session?.note && typeof session.note === 'object'
    ? (session.note as NormalizedSessionNote)
    : null;
  const sessionNote = activeNote || fallbackSessionNote || notes[0] || null;
  const contentHtml = typeof sessionNote?.contentHtml === 'string' ? sessionNote.contentHtml : '';
  return { notes, activeNoteId, sessionNote, contentHtml };
};

export const isSessionNoteTabDirty = (tab: SessionNoteTabLike | null | undefined, nextContent: string) => {
  if (!tab) return false;
  const currentContent = typeof tab.content === 'string' ? tab.content : '';
  const savedContent = typeof tab.savedContent === 'string' ? tab.savedContent : currentContent;
  return currentContent !== savedContent && currentContent !== nextContent;
};

export const resolveCandidateSessionNoteTab = ({
  matchingTabs,
  targetSessionNoteTabPath,
  nextContent,
  isTabDirty,
}: ResolveCandidateSessionNoteTabInput) => matchingTabs
  .slice()
  .sort((left: SessionNoteTabLike, right: SessionNoteTabLike) => {
    const leftPath = String(left?.path || '').trim();
    const rightPath = String(right?.path || '').trim();
    const leftMatchesTarget = leftPath === targetSessionNoteTabPath ? 1 : 0;
    const rightMatchesTarget = rightPath === targetSessionNoteTabPath ? 1 : 0;
    if (leftMatchesTarget !== rightMatchesTarget) return rightMatchesTarget - leftMatchesTarget;
    const leftDirty = isTabDirty(left, nextContent) ? 1 : 0;
    const rightDirty = isTabDirty(right, nextContent) ? 1 : 0;
    if (leftDirty !== rightDirty) return rightDirty - leftDirty;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  })[0] ?? null;

export const buildSessionNoteLoadKey = ({
  activeSessionId,
  activeNoteId,
  sessionNote,
  notes,
}: BuildSessionNoteLoadKeyInput) => `${activeSessionId || ''}:${activeNoteId || sessionNote?.noteId || sessionNote?.id || 'default'}:${(Array.isArray(notes) ? notes : [])
  .map((note: NormalizedSessionNote) => String(note?.noteId || note?.id || '').trim())
  .filter(Boolean)
  .sort()
  .join('|')}`;

export const buildSessionNoteSnapshot = ({
  session,
  activeSessionId,
}: BuildSessionNoteSnapshotInput): SessionNoteSnapshot => {
  const normalized = normalizeSessionNote(session);
  const ownerSessionId = String(normalized.sessionNote?.sessionId || activeSessionId || '').trim() || activeSessionId;
  const targetSessionNoteTabPath = getSessionNoteIdentity(
    normalized.sessionNote,
    ownerSessionId,
    normalized.activeNoteId,
  ).path;
  const loadKey = buildSessionNoteLoadKey({
    activeSessionId,
    activeNoteId: normalized.activeNoteId,
    sessionNote: normalized.sessionNote,
    notes: normalized.notes,
  });
  return {
    ...normalized,
    targetSessionNoteTabPath,
    loadKey,
  };
};

export const deriveRelevantSessionNotePaths = ({
  notes,
  tabs,
  activeSessionId,
}: DeriveRelevantSessionNotePathsInput) => {
  const previousSessionNotePaths = Array.isArray(tabs)
    ? tabs
      .map((tab: SessionNoteTabLike) => String(tab.path || '').trim())
      .filter((tabPath: string) => isSessionNoteTabPath(tabPath, activeSessionId))
    : [];
  const nextSessionNotePaths = (Array.isArray(notes) ? notes : [])
    .map((note: NormalizedSessionNote) => getSessionNoteIdentity(note, note?.sessionId || activeSessionId, note?.noteId || note?.id).path)
    .filter(Boolean);
  const relevantPaths = Array.from(new Set([...nextSessionNotePaths, ...previousSessionNotePaths]));
  return { previousSessionNotePaths, nextSessionNotePaths, relevantPaths };
};

export const shouldApplySessionNoteRemoteLoad = ({
  loadKey,
  currentLoadKey,
  previousRemoteRefreshKey,
  remoteRefreshKey,
  sessionNote,
}: ShouldApplySessionNoteRemoteLoadInput): ShouldApplySessionNoteRemoteLoadResult => {
  const hasSessionNote = Boolean(sessionNote);
  const hasNewRemoteRefresh = typeof remoteRefreshKey === 'number'
    && remoteRefreshKey !== previousRemoteRefreshKey;
  const hasMatchingLoadKey = currentLoadKey === loadKey;
  return {
    hasSessionNote,
    hasNewRemoteRefresh,
    hasMatchingLoadKey,
    shouldApply: hasSessionNote && (hasNewRemoteRefresh || !hasMatchingLoadKey),
  };
};

export const buildSessionNoteLoadContext = ({
  tabs,
  activeSessionId,
}: BuildSessionNoteLoadContextInput): SessionNoteLoadContext => {
  const sessionNotePaths = Array.isArray(tabs)
    ? tabs
      .map((tab: SessionNoteTabLike) => String(tab.path || '').trim())
      .filter((tabPath: string) => isSessionNoteTabPath(tabPath, activeSessionId))
    : [];
  const activeSessionTab = Array.isArray(tabs) && sessionNotePaths.length
    ? tabs.find((tab: SessionNoteTabLike) => sessionNotePaths.includes(String(tab.path || '').trim())) ?? null
    : null;
  const preserveVisibility = true;
  return {
    sessionNotePaths,
    activeSessionTab,
    preserveVisibility,
    shouldRevealEditorRail: !activeSessionTab?.id,
  };
};

export const buildSessionNotePersistenceState = ({
  activeSessionId,
  saved,
  path,
  fallbackTabId,
  fallbackTitle,
  fallbackContent,
}: BuildSessionNotePersistenceStateInput): SessionNotePersistenceState => {
  const { activeNoteId, sessionNote, contentHtml, notes } = normalizeSessionNote(saved);
  const canonicalSessionNote: SessionNotePersistenceSyncInput = sessionNote
    ? { ...sessionNote, contentHtml }
    : { title: fallbackTitle || 'Session note', contentHtml: contentHtml ?? fallbackContent ?? '' };
  const normalizedPath = String(path || '').trim();
  const savedTitle = canonicalSessionNote?.title || fallbackTitle || 'Session note';
  return {
    shouldProceed: Boolean(sessionNote),
    loadKey: buildSessionNoteLoadKey({
      activeSessionId,
      activeNoteId,
      sessionNote: canonicalSessionNote,
      notes,
    }),
    savedTitle,
    syncInput: canonicalSessionNote,
    syncOptions: {
      intent: 'save',
      activeNoteId,
      activate: true,
    },
    resolvedTabId: fallbackTabId || '',
    resolvedPath: normalizedPath,
    resolvedContent: contentHtml ?? canonicalSessionNote?.contentHtml ?? fallbackContent ?? '',
  };
};

export const buildSessionNoteSyncPlan = ({
  tabs,
  targetSessionNoteTabPath,
  title,
  contentHtml,
  intent = 'load',
  activate = false,
  preserveVisibility = !activate,
}: BuildSessionNoteSyncPlanInput): SessionNoteSyncPlan => {
  const sessionNoteTabs = Array.isArray(tabs)
    ? tabs.filter((tab: SessionNoteTabLike) => isSessionNoteTabPath(String(tab.path || '').trim()))
    : [];
  const targetTab = sessionNoteTabs.find((tab: SessionNoteTabLike) => String(tab.path || '').trim() === targetSessionNoteTabPath) ?? null;
  const existingTabId = targetTab?.id || null;
  const existingTabPath = targetTab ? String(targetTab.path || '').trim() : null;
  const existingTabContent = targetTab ? String(targetTab.content || '') : '';
  const existingTabSavedContent = targetTab ? String(targetTab.savedContent || targetTab.content || '') : '';
  const existingTabTitle = targetTab ? String((targetTab as any).filename || title || 'Session note') : String(title || 'Session note');
  const staleTabIds = sessionNoteTabs
    .filter((tab: SessionNoteTabLike) => String(tab.path || '').trim() !== targetSessionNoteTabPath)
    .map((tab: SessionNoteTabLike) => String(tab.id || '').trim())
    .filter(Boolean);

  return {
    targetSessionNoteTabPath,
    title: title || 'Session note',
    contentHtml,
    intent,
    activate,
    preserveVisibility,
    existingTabId,
    existingTabPath,
    existingTabContent,
    existingTabSavedContent,
    existingTabTitle,
    shouldOpenFile: !existingTabId,
    shouldUpdateTabContent: Boolean(existingTabId && existingTabContent !== contentHtml),
    shouldMarkTabSaved: Boolean(existingTabId && intent === 'save' && existingTabSavedContent !== contentHtml),
    shouldPinTab: true,
    shouldActivateSavedTab: Boolean(existingTabId && activate),
    staleTabIds,
  };
};

export const executeSessionNoteSyncPlan = (
  plan: SessionNoteSyncPlan,
  canvas: SessionNoteCanvasSyncAdapter,
): ExecuteSessionNoteSyncPlanResult => {
  if (typeof canvas.closeTab === 'function') {
    plan.staleTabIds.forEach((tabId: string) => {
      if (tabId) canvas.closeTab?.(tabId);
    });
  }

  if (plan.existingTabId) {
    if (plan.shouldPinTab && typeof canvas.pinTabByPath === 'function' && (plan.existingTabPath !== plan.targetSessionNoteTabPath || plan.existingTabTitle !== plan.title)) {
      canvas.pinTabByPath(plan.targetSessionNoteTabPath, plan.title);
    }
    if (plan.shouldUpdateTabContent && typeof canvas.updateTabContent === 'function') {
      canvas.updateTabContent(plan.existingTabId, plan.contentHtml);
    }
    if (plan.shouldMarkTabSaved && typeof canvas.markTabSaved === 'function') {
      canvas.markTabSaved(plan.existingTabId, plan.contentHtml);
    }
    if ((plan.shouldActivateSavedTab || plan.activate) && typeof canvas.setActiveTab === 'function') {
      canvas.setActiveTab(plan.existingTabId);
    }
    return { tabId: plan.existingTabId, path: plan.targetSessionNoteTabPath, title: plan.title, contentHtml: plan.contentHtml };
  }

  if (typeof canvas.upsertTab === 'function') {
    canvas.upsertTab(plan.targetSessionNoteTabPath, plan.contentHtml, {
      preserveVisibility: plan.preserveVisibility,
      activate: plan.activate,
      pinTitle: plan.title,
    });
    if (plan.shouldPinTab && typeof canvas.pinTabByPath === 'function') {
      canvas.pinTabByPath(plan.targetSessionNoteTabPath, plan.title);
    }
    return { tabId: '', path: plan.targetSessionNoteTabPath, title: plan.title, contentHtml: plan.contentHtml };
  }

  if (typeof canvas.openFile === 'function') {
    canvas.openFile(plan.targetSessionNoteTabPath, plan.contentHtml);
    if (plan.shouldPinTab && typeof canvas.pinTabByPath === 'function') {
      canvas.pinTabByPath(plan.targetSessionNoteTabPath, plan.title);
    }
    return { tabId: '', path: plan.targetSessionNoteTabPath, title: plan.title, contentHtml: plan.contentHtml };
  }

  return null;
};
