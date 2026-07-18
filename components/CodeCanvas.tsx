import React, { Suspense, lazy, useRef } from 'react';
import { CanvasTab } from '../hooks/useCanvasState';
import { Message, ToolCall } from '../types';
import { isSessionNoteTab } from './CanvasRail';
import RichNotesEditor from './RichNotesEditor';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface CommandStreamProps {
  history: Message[];
  pendingApproval: { agentId: string; toolCalls: ToolCall[]; sensitiveCalls: ToolCall[] } | null;
  agentId: string;
  onApprove: () => void;
  onDeny: () => void;
}

const SmartValue = ({ value, depth = 0 }: { value: any; depth?: number }) => {
  if (value === null || value === undefined) return <span className="text-slate-500 italic">null</span>;
  if (typeof value === 'boolean') return <span className="text-amber-400">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-blue-400">{value}</span>;
  if (typeof value === 'string') {
    if (value.length > 300) {
      return (
        <details className="inline">
          <summary className="cursor-pointer text-green-400 hover:text-green-300 select-none">
            "{value.slice(0, 60)}…" <span className="text-slate-500 text-[9px]">({value.length} chars)</span>
          </summary>
          <pre className="text-green-300 whitespace-pre-wrap break-all mt-1 text-[10px] bg-black/20 p-2 rounded">
            {value}
          </pre>
        </details>
      );
    }
    return <span className="text-green-400">"{value}"</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">[]</span>;
    return (
      <div className={depth > 0 ? 'ml-3' : ''}>
        {value.map((item, i) => (
          <div key={i} className="flex gap-1">
            <span className="text-slate-600 select-none shrink-0">{i}:</span>
            <SmartValue value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    return (
      <div className={depth > 0 ? 'ml-3' : ''}>
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="flex gap-1 items-start min-w-0">
            <span className="text-slate-400 font-bold shrink-0 text-[9px] uppercase tracking-wider">{k}:</span>
            <div className="min-w-0 break-all"><SmartValue value={v} depth={depth + 1} /></div>
          </div>
        ))}
      </div>
    );
  }
  return <span className="text-slate-300">{String(value)}</span>;
};

const CommandStream: React.FC<CommandStreamProps> = ({ history, pendingApproval, agentId, onApprove, onDeny }) => {
  const streamRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = viewportRef.current ?? streamRef.current;
    if (!el) return;
    if (Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history.length]);

  const commandLog = history.filter(m => (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) || m.role === 'tool');

  return (
    <div ref={viewportRef} className="flex-1 min-h-0 overflow-auto">
      <div ref={streamRef} className="p-3 space-y-3 text-xs font-mono">
        {commandLog.length === 0 && (
          <div className="text-center py-10 text-slate-600 select-none">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-[10px] uppercase tracking-widest">No commands yet</p>
        </div>
        )}

        {commandLog.map((msg, idx) => (
        <div key={msg.timestamp + idx} className="animate-in fade-in duration-200">
          {msg.role === 'assistant' && msg.tool_calls?.map((tc: ToolCall, i: number) => (
            <div key={i} className="rounded-lg border border-purple-900/40 bg-purple-950/20 overflow-hidden mb-1.5">
              <div className="flex items-center justify-between px-3 py-1.5 bg-purple-900/20 border-b border-purple-900/30">
                <div className="flex items-center gap-2 text-purple-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                  <span className="font-bold">{tc.function.name}</span>
                </div>
                <span className="text-[9px] text-purple-600">{new Date(msg.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="p-2 max-h-40 overflow-y-auto custom-scrollbar">
                <SmartValue value={(() => { try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; } })()} />
              </div>
            </div>
          ))}

          {msg.role === 'tool' && (
            <div className="ml-3 rounded-lg border border-slate-800 bg-black/20 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-1 bg-white/5 border-b border-white/5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-[9px] font-black uppercase text-slate-500 tracking-wider">Output</span>
              </div>
              <div className="p-2 max-h-40 overflow-y-auto custom-scrollbar">
                <SmartValue value={(() => { try { return JSON.parse(msg.content); } catch { return msg.content; } })()} />
              </div>
            </div>
          )}
        </div>
      ))}

      {pendingApproval && pendingApproval.agentId === agentId && (
        <div className="sticky bottom-0 rounded-xl border border-orange-500/40 bg-orange-950/40 p-3 shadow-xl animate-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 mb-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-orange-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-orange-300 font-black text-[10px] uppercase tracking-wider">Approval Required</span>
          </div>
          <div className="space-y-1 mb-3 max-h-32 overflow-y-auto custom-scrollbar">
            {pendingApproval.sensitiveCalls.map((tc, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] bg-orange-900/20 rounded px-2 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" />
                <span className="text-orange-300 font-bold">{tc.function.name}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={onApprove} className="flex-1 py-1.5 rounded-lg bg-green-600 hover:bg-green-500 text-white font-black text-[10px] uppercase tracking-wider transition-colors">✓ Approve</button>
            <button onClick={onDeny} className="flex-1 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white font-black text-[10px] uppercase tracking-wider transition-colors">✗ Deny</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

const SessionNoteSurface: React.FC<{
  tab: CanvasTab;
  onUpdateContent: (id: string, content: string) => void;
  onSaveTab: (tabId: string, content: string, path: string, title?: string) => void;
}> = ({ tab, onUpdateContent, onSaveTab }) => {
  const [draftContent, setDraftContent] = React.useState(tab.content);
  const [draftTitle, setDraftTitle] = React.useState(tab.filename || 'Session note');
  const surfaceRef = useRef<HTMLDivElement>(null);

  const lastHydratedSignatureRef = React.useRef(`${tab.id}::${tab.path}::${tab.filename || 'Session note'}::${tab.savedContent ?? tab.content ?? ''}`);

  React.useEffect(() => {
    const nextSignature = `${tab.id}::${tab.path}::${tab.filename || 'Session note'}::${tab.savedContent ?? tab.content ?? ''}`;
    const signatureChanged = lastHydratedSignatureRef.current !== nextSignature;
    lastHydratedSignatureRef.current = nextSignature;
    if (signatureChanged) {
      setDraftContent(tab.content);
      setDraftTitle(tab.filename || 'Session note');
    }
  }, [tab.id, tab.path, tab.content, tab.savedContent, tab.filename]);

  const isDirty = draftContent !== tab.savedContent || draftTitle !== (tab.filename || 'Session note');
  const saveLabel = isDirty ? 'Save note' : 'Saved';

  const handleSave = React.useCallback(() => {
    onSaveTab(tab.id, draftContent, tab.path, draftTitle.trim() || 'Session note');
  }, [draftContent, draftTitle, onSaveTab, tab.id, tab.path]);

  const handleEditorChange = React.useCallback((html: string) => {
    setDraftContent(html);
    onUpdateContent(tab.id, html);
  }, [onUpdateContent, tab.id]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.key.toLowerCase() !== 's') return;

      const activeElement = document.activeElement;
      const target = event.target;
      const withinSurface =
        (target instanceof Node && surfaceRef.current?.contains(target)) ||
        (activeElement instanceof Node && surfaceRef.current?.contains(activeElement));

      if (!withinSurface) return;

      event.preventDefault();
      handleSave();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  return (
    <div ref={surfaceRef} className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${tab.isWriting ? 'ring-2 ring-nebula-500/30 ring-inset' : ''}`}>
      <div className="relative flex min-w-0 items-center justify-between gap-4 border-b border-slate-200/80 bg-[#252526] px-4 py-3 dark:border-slate-700/80 dark:bg-[#252526]">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.32em] text-slate-500 dark:text-slate-500">Session Note</div>
          <div className="mt-1 flex items-center gap-2 min-w-0">
            <input
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              className="min-w-0 max-w-[28rem] truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold tracking-[-0.02em] text-slate-100 outline-none transition placeholder:text-slate-400 focus:border-nebula-300 focus:bg-white/80 dark:text-slate-100 dark:focus:border-nebula-500 dark:focus:bg-slate-800/70"
              placeholder="Session note"
              aria-label="Rename session note"
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${isDirty ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            <span>{isDirty ? 'Unsaved changes' : 'Saved'}</span>
            <span className="text-nebula-100 dark:text-slate-600">•</span>
            <span>Ctrl/Cmd+S</span>
          </div>
        </div>
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-lg border border-nebula-100 bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-nebula-800 shadow-[0_10px_24px_-18px_rgba(15,23,42,0.18)] transition hover:-translate-y-[1px] hover:border-nebula-500/35 hover:bg-nebula-50 dark:border-slate-600 dark:bg-slate-800 dark:text-nebula-100 dark:shadow-[0_10px_24px_-18px_rgba(0,0,0,0.55)] dark:hover:border-nebula-500/45 dark:hover:bg-slate-700"
          title="Save note (Ctrl/Cmd+S)"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isDirty ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          {saveLabel}
        </button>
      </div>
      <div className="relative flex-1 min-h-0 min-w-0 overflow-hidden">
        <RichNotesEditor
          value={draftContent}
          onChange={handleEditorChange}
          placeholder="Write your session note here..."
          className="h-full min-h-0 min-w-0 border-0 bg-transparent"
          editorClassName="h-full min-h-0 min-w-0"
          toolbarClassName=""
        />
      </div>
    </div>
  );
};

export interface CodeCanvasProps {
  onEditAgent: () => void;
  onCreateSessionNote: () => void;
  onCollapseCanvas?: () => void;
  tabs: CanvasTab[];
  activeTabId: string | null;
  activeTab: CanvasTab | null;
  activeCanvasTab: 'editor' | 'commands';
  isDarkTheme: boolean;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onUpdateContent: (id: string, content: string) => void;
  onSwitchCanvasTab: (tab: 'editor' | 'commands') => void;
  onSaveTab: (tabId: string, content: string, path: string, title?: string) => void;
  onSaveAsTab: (tabId: string, content: string, currentPath: string) => void;
  onCreateScratchTab: () => void;
  onAcceptDiff: (id: string) => void;
  onRejectDiff: (id: string, originalContent: string) => void;
  agentHistory: Message[];
  agentId: string;
  hasSessionNoteTarget: boolean;
  pendingApproval: { agentId: string; toolCalls: ToolCall[]; sensitiveCalls: ToolCall[] } | null;
  onApproveTool: () => void;
  onDenyTool: () => void;
}

const CanvasViewport: React.FC<{ className?: string; children: React.ReactNode }> = ({ className = '', children }) => (
  <div className={`flex-1 min-h-0 min-w-0 overflow-hidden ${className}`.trim()}>
    <div className="h-full min-h-0 min-w-0 w-full overflow-auto">{children}</div>
  </div>
);

const MonacoLoader = () => (
  <div className="flex flex-1 min-h-0 min-w-0 items-center justify-center bg-[#1e1e1e]">
    <div className="flex gap-1.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="w-2 h-2 bg-nebula-500/60 rounded-full animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  </div>
);

const CodeCanvas: React.FC<CodeCanvasProps> = ({
  onCollapseCanvas,
  activeTab, activeCanvasTab, isDarkTheme,
  onUpdateContent, onSaveTab, onSaveAsTab,
  onAcceptDiff, onRejectDiff,
  agentHistory, agentId, pendingApproval, onApproveTool, onDenyTool,
}) => {
  const monacoTheme = isDarkTheme ? 'vs-dark' : 'vs';

  const headerTitle = activeCanvasTab === 'commands'
    ? 'Command Stream'
    : activeTab
      ? (isSessionNoteTab(activeTab)
        ? 'Session Note'
        : `Scratch Pad${activeTab.filename ? ` > ${activeTab.filename}` : ''}`)
      : 'Canvas';
  const canShowFileActions = !!activeTab && !isSessionNoteTab(activeTab) && !activeTab.isDiff;

  const monacoOptions = {
    minimap: { enabled: true },
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontLigatures: true,
    padding: { top: 12 },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    lineNumbersMinChars: 3,
    renderWhitespace: 'selection' as const,
    smoothScrolling: true,
    cursorBlinking: 'smooth' as const,
    bracketPairColorization: { enabled: true },
    wordWrap: 'off' as const,
  };

  const renderEmptyState = () => (
    <CanvasViewport className="bg-[#1e1e1e]">
      <div className="flex h-full min-h-0 min-w-0 items-center justify-center text-slate-500">
        <div className="flex flex-col items-center gap-2 text-center px-6">
          <div className="text-sm font-medium text-slate-300">Canvas ready</div>
          <div className="text-[12px] text-slate-500">Use the rail to open a Note, Scratch Pad, or Stream.</div>
        </div>
      </div>
    </CanvasViewport>
  );

  const renderEditor = () => {
    if (!activeTab) {
      return renderEmptyState();
    }

    if (activeTab.isDiff && activeTab.originalContent !== undefined) {
      return (
        <CanvasViewport>
          <div className="flex h-full min-h-0 min-w-0 flex-col relative overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-amber-950/40 border-b border-amber-800/30 shrink-0 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-300 text-[10px] font-black uppercase tracking-wider truncate">Proposed Changes — {activeTab.filename}</span>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => onRejectDiff(activeTab.id, activeTab.originalContent!)} className="px-3 py-1 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  Reject
                </button>
                <button onClick={() => onAcceptDiff(activeTab.id)} className="px-3 py-1 rounded-lg bg-green-600 hover:bg-green-500 text-white text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  Accept
                </button>
              </div>
            </div>
            <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
              <div className="flex-1 flex flex-col min-w-0 min-h-0 border-r border-slate-700/50 overflow-hidden">
                <div className="px-3 py-1 bg-red-900/20 border-b border-red-800/30 text-[9px] font-black text-red-400 uppercase tracking-wider shrink-0">Original</div>
                <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                  <Suspense fallback={<MonacoLoader />}>
                    <MonacoEditor height="100%" theme={monacoTheme} defaultLanguage={activeTab.language} value={activeTab.originalContent} options={{ ...monacoOptions, readOnly: true }} />
                  </Suspense>
                </div>
              </div>
              <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
                <div className="px-3 py-1 bg-green-900/20 border-b border-green-800/30 text-[9px] font-black text-green-400 uppercase tracking-wider shrink-0">Proposed</div>
                <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
                  <Suspense fallback={<MonacoLoader />}>
                    <MonacoEditor height="100%" theme={monacoTheme} defaultLanguage={activeTab.language} value={activeTab.content} options={{ ...monacoOptions, readOnly: true }} />
                  </Suspense>
                </div>
              </div>
            </div>
          </div>
        </CanvasViewport>
      );
    }

    if (isSessionNoteTab(activeTab)) {
      return (
        <CanvasViewport>
          <SessionNoteSurface tab={activeTab} onUpdateContent={onUpdateContent} onSaveTab={onSaveTab} />
        </CanvasViewport>
      );
    }

    return (
      <CanvasViewport>
        <div className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden ${activeTab.isWriting ? 'ring-2 ring-nebula-500/50 ring-inset' : ''}`}>
          {activeTab.isWriting && <div className="absolute top-0 left-0 right-0 z-10 h-0.5 bg-nebula-500/60 animate-pulse" />}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            <Suspense fallback={<MonacoLoader />}>
              <MonacoEditor
                height="100%"
                theme={monacoTheme}
                defaultLanguage={activeTab.language}
                value={activeTab.content}
                onChange={val => onUpdateContent(activeTab.id, val ?? '')}
                options={monacoOptions}
                onMount={(editor) => {
                  editor.addCommand(2097 | (1 << 11), () => onSaveTab(activeTab.id, editor.getValue(), activeTab.path));
                }}
              />
            </Suspense>
          </div>
        </div>
      </CanvasViewport>
    );
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 bg-[#1e1e1e] dark:bg-[#1e1e1e] overflow-hidden">
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {((activeCanvasTab === 'commands') || activeCanvasTab === 'editor') && (
          <div className="px-4 py-2 bg-[#252526] border-b border-[#3e3e3e] shrink-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                {onCollapseCanvas && (
                  <button onClick={onCollapseCanvas} className="h-7 w-7 shrink-0 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors" title="Collapse canvas" aria-label="Collapse canvas">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                )}
                <div className="min-w-0 truncate text-[12px] font-medium text-slate-200">{headerTitle}</div>
              </div>
              <div className="ml-auto flex items-center gap-2 min-w-0 shrink-0">
                {canShowFileActions && activeTab && (
                  <>
                    {activeTab.content !== activeTab.savedContent && (
                      <button onClick={() => onSaveTab(activeTab.id, activeTab.content, activeTab.path)} className="flex items-center gap-1 px-2 py-0.5 rounded bg-nebula-600/80 hover:bg-nebula-500 text-white text-[9px] font-black uppercase tracking-wider transition-colors" title="Save file (Ctrl+S)">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                        Save
                      </button>
                    )}
                    <button onClick={() => onSaveAsTab(activeTab.id, activeTab.content, activeTab.path)} className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-700/80 hover:bg-slate-600 text-white text-[9px] font-black uppercase tracking-wider transition-colors" title="Save as...">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      Save As
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {activeCanvasTab === 'editor' ? (
          renderEditor()
        ) : (
          <CanvasViewport>
            <CommandStream history={agentHistory} pendingApproval={pendingApproval} agentId={agentId} onApprove={onApproveTool} onDeny={onDenyTool} />
          </CanvasViewport>
        )}
      </div>
    </div>
  );
};

export default CodeCanvas;
