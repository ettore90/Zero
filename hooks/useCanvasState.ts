import { useState, useCallback, useEffect, useRef } from 'react';
import { storageKey } from '../constants';

// ---------------------------------------------------------------------------
// Event Bus (micro pub/sub para comunicação entre ToolEngine <-> Canvas)
// ---------------------------------------------------------------------------
type CanvasEventType = 'file:open' | 'file:diff' | 'file:writing';

interface CanvasEvent {
  type: CanvasEventType;
  payload: any;
}

type CanvasEventHandler = (event: CanvasEvent) => void;

const handlers: Set<CanvasEventHandler> = new Set();

export const canvasBus = {
  emit: (event: CanvasEvent) => {
    handlers.forEach(h => h(event));
  },
  on: (handler: CanvasEventHandler) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  },
};

// ---------------------------------------------------------------------------
// Canvas Content Bridge — permite que useToolEngine acesse o conteúdo live
// do editor sem precisar de prop drilling através do App.tsx
// ---------------------------------------------------------------------------
let _getLiveContent: ((path: string) => string | null) | null = null;

export const canvasContentBridge = {
  register: (fn: (path: string) => string | null) => { _getLiveContent = fn; },
  unregister: () => { _getLiveContent = null; },
  getLiveContent: (path: string): string | null => _getLiveContent ? _getLiveContent(path) : null,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CanvasTab {
  id: string;
  path: string;
  filename: string;
  language: string;
  content: string;
  savedContent: string;    // conteúdo que está no disco (para detectar unsaved)
  originalContent?: string; // presente apenas em modo diff
  isDiff: boolean;
  isWriting: boolean; // borda pulsando enquanto agente escreve
  isPinned?: boolean;
}

export interface CanvasState {
  tabs: CanvasTab[];
  activeTabId: string | null;
  splitRatio: number; // 0.0–1.0, proporção do chat (esquerda)
  isCanvasVisible: boolean;
  activeCanvasTab: 'editor' | 'commands'; // aba interna do canvas
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STORAGE_KEY = storageKey('canvas_split');
const LEGACY_STORAGE_KEY = 'codex_canvas_split';
const DEFAULT_SPLIT = 0.42; // chat ocupa ~42% em landscape

const getInitialSplitRatio = (): number => {
  try {
    if (typeof window === 'undefined') return DEFAULT_SPLIT;
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = raw ? parseFloat(raw) : DEFAULT_SPLIT;
    if (!Number.isFinite(parsed)) return DEFAULT_SPLIT;
    return Math.min(0.85, Math.max(0.15, parsed));
  } catch {
    return DEFAULT_SPLIT;
  }
};

const getLanguageFromPath = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript',
    py: 'python',
    json: 'json',
    md: 'markdown',
    css: 'css', scss: 'scss',
    html: 'html',
    sh: 'shell', bash: 'shell',
    yml: 'yaml', yaml: 'yaml',
    go: 'go',
    rs: 'rust',
    java: 'java',
    rb: 'ruby',
    php: 'php',
    sql: 'sql',
    dockerfile: 'dockerfile',
  };
  return map[ext] ?? 'plaintext';
};

const normalizeTabPath = (path: string): string => {
  const value = String(path ?? '').trim().replace(/\\/g, '/');
  return value.replace(/\/+/g, '/');
};

const getFilename = (path: string): string =>
  normalizeTabPath(path).split('/').pop() ?? normalizeTabPath(path);


const generateTabId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export const useCanvasState = (agentId?: string) => {
  const [state, setState] = useState<CanvasState>({
    tabs: [],
    activeTabId: null,
    splitRatio: getInitialSplitRatio(),
    isCanvasVisible: false,
    activeCanvasTab: 'editor',
  });

  // Ref para o resize drag
  const isDraggingRef = useRef(false);

  // ------------------------------------------------------------------
  // Escuta eventos do canvasBus (emitidos pelo useToolEngine)
  // ------------------------------------------------------------------
  useEffect(() => {
    const unsub = canvasBus.on((event) => {
      // Isolamento por agente:
      // - Evento sem agentId = ação manual do usuário → aceitar sempre
      // - Evento com agentId = ação de agente → só aceitar se for o mesmo agentId
      if (agentId && event.payload.agentId && event.payload.agentId !== agentId) {
        return;
      }
      if (event.type === 'file:open') {
        openFile(event.payload.path, event.payload.content);
      } else if (event.type === 'file:diff') {
        setDiff(event.payload.path, event.payload.original, event.payload.proposed);
      } else if (event.type === 'file:writing') {
        setWriting(event.payload.path, event.payload.active);
      }
    });
    // Retorno void explícito para satisfazer EffectCallback
    return () => { unsub(); };
  }, []);

  // ------------------------------------------------------------------
  // Persistir splitRatio
  // ------------------------------------------------------------------
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(state.splitRatio));
    } catch {}
  }, [state.splitRatio]);

  // ------------------------------------------------------------------
  // Abrir ou focar arquivo
  // ------------------------------------------------------------------
  const upsertTab = useCallback((path: string, content: string, options?: { preserveVisibility?: boolean; activate?: boolean; pinTitle?: string }) => {
    const normalizedPath = normalizeTabPath(path);
    setState(prev => {
      const existing = prev.tabs.find(t => normalizeTabPath(t.path) === normalizedPath);
      const filename = options?.pinTitle || getFilename(normalizedPath);

      if (existing) {
        return {
          ...prev,
          activeTabId: options?.activate === false ? prev.activeTabId : existing.id,
          isCanvasVisible: options?.preserveVisibility ? prev.isCanvasVisible : true,
          activeCanvasTab: options?.activate === false ? prev.activeCanvasTab : 'editor',
          tabs: prev.tabs.map(t =>
            normalizeTabPath(t.path) === normalizedPath
              ? { ...t, path: normalizedPath, filename, content, savedContent: content, isDiff: false, originalContent: undefined, isPinned: options?.pinTitle ? true : t.isPinned, isWriting: false }
              : t
          ),
        };
      }

      const newTab: CanvasTab = {
        id: generateTabId(),
        path: normalizedPath,
        filename,
        language: getLanguageFromPath(normalizedPath),
        content,
        savedContent: content,
        isDiff: false,
        isWriting: false,
        isPinned: !!options?.pinTitle,
      };

      let tabs = [...prev.tabs, newTab];
      if (tabs.length > 8) {
        const unpinnedIdx = tabs.findIndex(t => !t.isPinned);
        if (unpinnedIdx !== -1) tabs.splice(unpinnedIdx, 1);
      }

      return {
        ...prev,
        tabs,
        activeTabId: options?.activate === false ? prev.activeTabId : newTab.id,
        isCanvasVisible: options?.preserveVisibility ? prev.isCanvasVisible : true,
        activeCanvasTab: options?.activate === false ? prev.activeCanvasTab : 'editor',
      };
    });
  }, []);

  const openFile = useCallback((path: string, content: string) => {
    upsertTab(path, content);
  }, [upsertTab]);

  // ------------------------------------------------------------------
  // Abrir em modo diff (write_file pendente de aprovação)
  // ------------------------------------------------------------------
  const setDiff = useCallback((path: string, original: string, proposed: string) => {
    const normalizedPath = normalizeTabPath(path);
    setState(prev => {
      const existing = prev.tabs.find(t => normalizeTabPath(t.path) === normalizedPath);

      if (existing) {
        return {
          ...prev,
          activeTabId: existing.id,
          isCanvasVisible: true,
          activeCanvasTab: 'editor',
          tabs: prev.tabs.map(t =>
            normalizeTabPath(t.path) === normalizedPath
              ? { ...t, path: normalizedPath, content: proposed, savedContent: t.savedContent ?? original, originalContent: original, isDiff: true }
              : t
          ),
        };
      }

      const newTab: CanvasTab = {
        id: generateTabId(),
        path: normalizedPath,
        filename: getFilename(normalizedPath),
        language: getLanguageFromPath(normalizedPath),
        content: proposed,
        savedContent: original,
        originalContent: original,
        isDiff: true,
        isWriting: false,
      };

      return {
        ...prev,
        tabs: [...prev.tabs, newTab],
        activeTabId: newTab.id,
        isCanvasVisible: true,
        activeCanvasTab: 'editor',
      };
    });
  }, []);

  // ------------------------------------------------------------------
  // Indicador de escrita em progresso (borda pulsando)
  // ------------------------------------------------------------------
  const setWriting = useCallback((path: string, active: boolean) => {
    const normalizedPath = normalizeTabPath(path);
    setState(prev => {
      const existing = prev.tabs.find(t => normalizeTabPath(t.path) === normalizedPath);

      if (existing) {
        return {
          ...prev,
          activeTabId: active ? existing.id : prev.activeTabId,
          isCanvasVisible: active ? true : prev.isCanvasVisible,
          activeCanvasTab: active ? 'editor' : prev.activeCanvasTab,
          tabs: prev.tabs.map(t =>
            normalizeTabPath(t.path) === normalizedPath ? { ...t, path: normalizedPath, isWriting: active } : t
          ),
        };
      }

      if (!active) return prev;

      const newTab: CanvasTab = {
        id: generateTabId(),
        path: normalizedPath,
        filename: getFilename(normalizedPath),
        language: getLanguageFromPath(normalizedPath),
        content: '',
        savedContent: '',
        isDiff: false,
        isWriting: true,
      };

      return {
        ...prev,
        tabs: [...prev.tabs, newTab],
        activeTabId: newTab.id,
        isCanvasVisible: true,
        activeCanvasTab: 'editor',
      };
    });
  }, []);

  // ------------------------------------------------------------------
  // Fechar aba
  // ------------------------------------------------------------------
  const closeTab = useCallback((id: string) => {
    setState(prev => {
      const remaining = prev.tabs.filter(t => t.id !== id);
      let nextActiveId = prev.activeTabId;

      if (prev.activeTabId === id) {
        const closedIdx = prev.tabs.findIndex(t => t.id === id);
        nextActiveId =
          remaining[closedIdx]?.id ??
          remaining[closedIdx - 1]?.id ??
          remaining[0]?.id ??
          null;
      }

      return {
        ...prev,
        tabs: remaining,
        activeTabId: nextActiveId,
        isCanvasVisible: remaining.length > 0 ? prev.isCanvasVisible : false,
      };
    });
  }, []);

  // ------------------------------------------------------------------
  // Edição manual no Monaco (modo não-diff)
  // ------------------------------------------------------------------
  const updateTabContent = useCallback((id: string, content: string) => {
    setState(prev => ({
      ...prev,
      tabs: prev.tabs.map(t => (t.id === id ? { ...t, content } : t)),
    }));
  }, []);

  // ------------------------------------------------------------------
  // Aceitar diff → limpa diff flag, mantém novo conteúdo
  // ------------------------------------------------------------------
  const acceptDiff = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      tabs: prev.tabs.map(t =>
        t.id === id ? { ...t, isDiff: false, originalContent: undefined, isWriting: false } : t
      ),
    }));
  }, []);

  // ------------------------------------------------------------------
  // Rejeitar diff → volta ao original
  // ------------------------------------------------------------------
  const rejectDiff = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      tabs: prev.tabs.map(t =>
        t.id === id && t.originalContent !== undefined
          ? { ...t, content: t.originalContent, isDiff: false, originalContent: undefined, isWriting: false }
          : t
      ),
    }));
  }, []);

  // ------------------------------------------------------------------
  // Trocar aba ativa
  // ------------------------------------------------------------------
  const setActiveTab = useCallback((id: string) => {
    setState(prev => ({ ...prev, activeTabId: id, activeCanvasTab: 'editor', isCanvasVisible: true }));
  }, []);

  // ------------------------------------------------------------------
  // Alternar visibilidade do canvas (mobile / toggle)
  // ------------------------------------------------------------------
  const toggleCanvas = useCallback(() => {
    setState(prev => ({ ...prev, isCanvasVisible: !prev.isCanvasVisible }));
  }, []);

  // ------------------------------------------------------------------
  // Trocar aba interna (editor vs commands)
  // ------------------------------------------------------------------
  const setActiveCanvasTab = useCallback((tab: 'editor' | 'commands') => {
    setState(prev => ({ ...prev, activeCanvasTab: tab }));
  }, []);

  // ------------------------------------------------------------------
  // Resize handle drag
  // ------------------------------------------------------------------
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const pointerTarget = e.currentTarget as Element | null;
    const pointerId = e.pointerId;
    const updateRatio = (clientX: number) => {
      const totalWidth = window.innerWidth - 56; // desconta o icon rail (56px)
      const newRatio = Math.min(0.75, Math.max(0.25, clientX / totalWidth));
      setState(prev => ({ ...prev, splitRatio: newRatio }));
    };

    updateRatio(e.clientX);

    if (pointerTarget && 'setPointerCapture' in pointerTarget) {
      try { (pointerTarget as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(pointerId); } catch {}
    }

    const onPointerMove = (ev: PointerEvent) => {
      if (!isDraggingRef.current) return;
      updateRatio(ev.clientX);
    };

    const onPointerUp = () => {
      isDraggingRef.current = false;
      if (pointerTarget && 'releasePointerCapture' in pointerTarget) {
        try { (pointerTarget as Element & { releasePointerCapture: (id: number) => void }).releasePointerCapture(pointerId); } catch {}
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }, []);

  // ------------------------------------------------------------------
  // Live content & save tracking
  // ------------------------------------------------------------------

  // Registrar no bridge global para que useToolEngine possa acessar sem prop drilling
  useEffect(() => {
    canvasContentBridge.register((path: string) => {
      const normalizedPath = normalizeTabPath(path);
      const tab = state.tabs.find(t => normalizeTabPath(t.path) === normalizedPath && !t.isDiff);
      return tab ? tab.content : null;
    });
    return () => canvasContentBridge.unregister();
  }, [state.tabs]);

  const getLiveContent = useCallback((path: string): string | null => {
    const normalizedPath = normalizeTabPath(path);
    const tab = state.tabs.find(t => normalizeTabPath(t.path) === normalizedPath && !t.isDiff);
    return tab ? tab.content : null;
  }, [state.tabs]);

  const markTabSaved = useCallback((tabId: string, savedContent?: string) => {
    setState(prev => ({
      ...prev,
      tabs: prev.tabs.map(t => t.id === tabId ? { ...t, savedContent: savedContent ?? t.content } : t),
    }));
  }, []);

  const pinTabByPath = useCallback((path: string, filename?: string) => {
    const normalizedPath = normalizeTabPath(path);
    setState(prev => ({
      ...prev,
      tabs: prev.tabs.map(t =>
        normalizeTabPath(t.path) === normalizedPath
          ? { ...t, path: normalizedPath, isPinned: true, filename: filename || t.filename }
          : t
      ),
    }));
  }, []);

  const renameTab = useCallback((tabId: string, newPath: string, options?: { activate?: boolean; preserveVisibility?: boolean; pinTitle?: string; preserveContent?: boolean; preserveSavedContent?: boolean }) => {
    const normalizedPath = normalizeTabPath(newPath);
    let result: { tabId: string; path: string } | null = null;

    setState(prev => {
      const sourceTab = prev.tabs.find(t => t.id === tabId);
      if (!sourceTab) return prev;

      const targetTab = prev.tabs.find(t => t.id !== tabId && normalizeTabPath(t.path) === normalizedPath) ?? null;
      const nextFilename = options?.pinTitle || getFilename(normalizedPath);
      const nextLanguage = getLanguageFromPath(normalizedPath);
      const activate = options?.activate ?? false;
      const preserveVisibility = options?.preserveVisibility ?? !activate;
      const survivingTabId = targetTab?.id ?? sourceTab.id;
      const repairedActiveTabId = prev.activeTabId === sourceTab.id ? survivingTabId : prev.activeTabId;

      if (targetTab) {
        const survivingTab = {
          ...targetTab,
          path: normalizedPath,
          filename: nextFilename,
          language: nextLanguage,
          isPinned: options?.pinTitle ? true : targetTab.isPinned,
        };

        result = { tabId: survivingTabId, path: normalizedPath };

        return {
          ...prev,
          activeTabId: activate ? survivingTabId : repairedActiveTabId,
          isCanvasVisible: preserveVisibility ? prev.isCanvasVisible : true,
          activeCanvasTab: activate ? 'editor' : prev.activeCanvasTab,
          tabs: prev.tabs
            .filter(t => t.id !== sourceTab.id)
            .map(t => (t.id === targetTab.id ? survivingTab : t)),
        };
      }

      const updatedSourceTab = {
        ...sourceTab,
        path: normalizedPath,
        filename: nextFilename,
        language: nextLanguage,
        content: options?.preserveContent === false ? '' : sourceTab.content,
        savedContent: options?.preserveSavedContent === false ? '' : sourceTab.savedContent,
        isPinned: options?.pinTitle ? true : sourceTab.isPinned,
      };

      result = { tabId: updatedSourceTab.id, path: normalizedPath };

      return {
        ...prev,
        activeTabId: activate ? updatedSourceTab.id : repairedActiveTabId,
        isCanvasVisible: preserveVisibility ? prev.isCanvasVisible : true,
        activeCanvasTab: activate ? 'editor' : prev.activeCanvasTab,
        tabs: prev.tabs.map(t => (t.id === tabId ? updatedSourceTab : t)),
      };
    });

    return result;
  }, []);

  // ------------------------------------------------------------------
  // Pin/unpin aba
  // ------------------------------------------------------------------
  const togglePinTab = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      tabs: prev.tabs.map(t => (t.id === id ? { ...t, isPinned: !t.isPinned } : t)),
    }));
  }, []);

  return {
    ...state,
    activeTab: state.tabs.find(t => t.id === state.activeTabId) ?? null,
    openFile,
    upsertTab,
    setDiff,
    setWriting,
    closeTab,
    updateTabContent,
    acceptDiff,
    rejectDiff,
    getLiveContent,
    markTabSaved,
    pinTabByPath,
    renameTab,
    setActiveTab,
    toggleCanvas,
    setActiveCanvasTab,
    startResize,
    togglePinTab,
  };
};
