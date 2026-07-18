import React, { useEffect, useRef, useState, useCallback } from 'react';
import { APP_DISPLAY_NAME } from '../constants';

// ---------------------------------------------------------------------------
// TerminalPanel
// Terminal interativo usando xterm.js via CDN.
// Conecta ao servidor via SSE (output) + fetch POST (input).
// O agente também pode usar o terminal via run_terminal_command com sessionId.
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    Terminal: any;
    FitAddon: any;
  }
}

interface TerminalPanelProps {
  sessionId: string;
  basePath?: string;  // ex: '/green'
  onClose?: () => void;
  className?: string;
}

const XTERM_CSS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';
const XTERM_JS  = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js';
const FIT_JS    = 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadCSS(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  sessionId,
  basePath = '',
  onClose,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<any>(null);
  const fitRef       = useRef<any>(null);
  const inputRef     = useRef('');
  const sseRef       = useRef<EventSource | null>(null);
  const [ready, setReady]     = useState(false);
  const [connected, setConnected] = useState(false);
  const [cwd, setCwd]         = useState('~');
  const [expanded, setExpanded] = useState(false);

  // -------------------------------------------------------------------------
  // Load xterm.js from CDN and initialize terminal
  // -------------------------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    async function init() {
      loadCSS(XTERM_CSS);
      await loadScript(XTERM_JS);
      await loadScript(FIT_JS);
      if (!mounted || !containerRef.current) return;

      const term = new window.Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#f0f6fc',
        },
        scrollback: 2000,
        convertEol: true,
      });

      const fitAddon = new window.FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      termRef.current = term;
      fitRef.current  = fitAddon;

      // Handle keyboard input
      term.onKey(({ key, domEvent }: { key: string; domEvent: KeyboardEvent }) => {
        const code = domEvent.keyCode;

        if (code === 13) {
          // Enter — execute command
          const cmd = inputRef.current.trim();
          inputRef.current = '';
          term.write('\r\n');
          if (cmd) executeCommand(cmd);
          else term.write('\x1b[32m$\x1b[0m ');
        } else if (code === 8) {
          // Backspace
          if (inputRef.current.length > 0) {
            inputRef.current = inputRef.current.slice(0, -1);
            term.write('\b \b');
          }
        } else if (code === 67 && domEvent.ctrlKey) {
          // Ctrl+C
          inputRef.current = '';
          term.write('^C\r\n\x1b[32m$\x1b[0m ');
        } else if (code === 76 && domEvent.ctrlKey) {
          // Ctrl+L — clear
          term.clear();
          term.write('\x1b[32m$\x1b[0m ');
        } else if (key.length === 1) {
          // Printable character
          inputRef.current += key;
          term.write(key);
        }
      });

      term.write(`\x1b[90mConnecting to ${APP_DISPLAY_NAME} terminal...\x1b[0m\r\n`);
      setReady(true);
    }

    init().catch(console.error);
    return () => { mounted = false; };
  }, []);

  // -------------------------------------------------------------------------
  // Connect SSE stream for output
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!ready) return;

    const url = `${basePath}/api/terminal/stream/${sessionId}?agentId=terminal`;
    const sse = new EventSource(url);
    sseRef.current = sse;

    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.connected) {
          setConnected(true);
          if (data.cwd) setCwd(data.cwd);
          termRef.current?.write('\x1b[32mConnected\x1b[0m — type commands below\r\n\x1b[32m$\x1b[0m ');
        } else if (data.output) {
          termRef.current?.write(data.output);
          // Redraw prompt after output if output ends with newline
          if (data.output.endsWith('\r\n') || data.output.endsWith('\n')) {
            termRef.current?.write('\x1b[32m$\x1b[0m ');
          }
        } else if (data.cwd) {
          setCwd(data.cwd);
        }
      } catch {}
    };

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    sse.onerror = () => {
      setConnected(false);
      sse.close();
      sseRef.current = null;
      termRef.current?.write('\r\n\x1b[33mReconnecting...\x1b[0m\r\n');
      // Reconectar após 2s — o useEffect re-executa quando sseRef muda
      // mas como não é state, forçamos via setTimeout que chama o mesmo bloco
      reconnectTimer = setTimeout(() => {
        const newSse = new EventSource(url);
        sseRef.current = newSse;
        newSse.onmessage = sse.onmessage;
        newSse.onerror = sse.onerror;
      }, 2000);
    };

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      sse.close();
      sseRef.current = null;
    };
  }, [ready, sessionId, basePath]);

  // -------------------------------------------------------------------------
  // executeCommand — POST to /api/terminal/exec
  // -------------------------------------------------------------------------
  const executeCommand = useCallback(async (cmd: string) => {
    try {
      const res = await fetch(`${basePath}/api/terminal/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, sessionId, agentId: 'terminal' }),
      });
      const data = await res.json();
      if (data.cwd) setCwd(data.cwd);
    } catch (e) {
      termRef.current?.write(`\x1b[31mError: ${e}\x1b[0m\r\n\x1b[32m$\x1b[0m `);
    }
  }, [basePath, sessionId]);

  // -------------------------------------------------------------------------
  // Resize observer
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!ready || !containerRef.current) return;
    const observer = new ResizeObserver(() => {
      try { fitRef.current?.fit(); } catch {}
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [ready]);

  // -------------------------------------------------------------------------
  // Public API: write output from agent's run_terminal_command
  // -------------------------------------------------------------------------
  const writeOutput = useCallback((output: string) => {
    if (termRef.current) {
      termRef.current.write(output.replace(/\n/g, '\r\n'));
    }
  }, []);

  // Expose writeOutput on the container DOM element for external use
  useEffect(() => {
    if (containerRef.current) {
      (containerRef.current as any).__writeOutput = writeOutput;
    }
  }, [writeOutput]);

  // Fit quando expanded muda
  useEffect(() => {
    setTimeout(() => { try { fitRef.current?.fit(); } catch {} }, 50);
  }, [expanded]);

  // Shortname do cwd para exibição
  const cwdDisplay = cwd.length > 40 ? '…' + cwd.slice(-38) : cwd;

  return (
    <div className={`flex flex-col bg-[#0d1117] ${expanded ? 'fixed inset-4 z-50 rounded-xl shadow-2xl border border-slate-700' : 'h-full'} ${className}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-700/60 shrink-0 rounded-t-xl">
        <div className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">Terminal</span>
        {/* CWD badge */}
        <span className="text-[10px] text-emerald-400/70 font-mono bg-slate-800 px-2 py-0.5 rounded truncate max-w-[240px]" title={cwd}>
          {cwdDisplay}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          {/* Clear */}
          <button
            type="button"
            onClick={() => { termRef.current?.clear(); termRef.current?.write('\x1b[32m$\x1b[0m '); }}
            className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-700 transition-colors"
            title="Clear"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
          {/* Expand / Collapse */}
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-700 transition-colors"
            title={expanded ? 'Collapse terminal' : 'Expand terminal'}
          >
            {expanded ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9L4 4m0 0h5m-5 0v5M15 9l5-5m0 0h-5m5 0v5M9 15l-5 5m0 0h5m-5 0v-5M15 15l5 5m0 0h-5m5 0v-5" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5" />
              </svg>
            )}
          </button>
          {/* Close */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-slate-700 transition-colors"
              title="Close terminal"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* xterm container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden p-1"
        style={{ minHeight: 0 }}
      />
    </div>
  );
};

export default TerminalPanel;
