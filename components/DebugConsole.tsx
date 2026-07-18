import React, { useState, useRef, useEffect } from 'react';
import { LogEntry } from '../types';

interface DebugConsoleProps {
  logs: LogEntry[];
  isOpen: boolean;
  onToggle: () => void;
  onClear: () => void;
}

const DebugConsole: React.FC<DebugConsoleProps> = ({ logs, isOpen, onToggle, onClear }) => {
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  const [copied, setCopied] = useState(false);

  const copyToClipboard = (text: string) => {
    // Try modern API first, fallback for non-HTTPS / Safari
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  };

  const fallbackCopy = (text: string) => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Helper to check if content is an object with usage
  const hasUsageInfo = (log: LogEntry): boolean => {
    return typeof log.content === 'object' && log.content !== null && 'usage' in log.content;
  };

  // Helper to get usage data safely
  const getUsageData = (log: LogEntry) => {
    if (typeof log.content === 'object' && log.content !== null) {
      return log.content as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
    }
    return {};
  };

  // Helper to get numeric value safely
  const getNumber = (value?: number | null) => value ?? 0;

  if (!isOpen) return null;

  return (
    <div className={`border-t border-slate-700 bg-[#0d1117] text-slate-300 flex flex-col font-mono text-xs shadow-2xl z-[100] transition-all duration-300 ease-in-out ${
      isMaximized ? 'fixed inset-0 h-screen' : 'fixed bottom-0 inset-x-0 h-64'
    }`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-nebula-500 text-[10px] tracking-widest">KERNEL TRAFFIC</span>
          <span className="px-2 py-0.5 rounded-full bg-slate-700 text-[10px] text-slate-400">
            {logs.length} events
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsMaximized(!isMaximized)}
            className="hover:text-white hover:bg-slate-700 p-1.5 rounded transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            )}
          </button>
          <button 
            onClick={onClear}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-700 px-2 py-1 rounded transition-colors"
          >
            Clear
          </button>
          <button 
            onClick={onToggle}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-700 px-2 py-1 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Log List */}
        <div 
          ref={scrollRef}
          className={`flex-1 overflow-y-auto p-2 space-y-1 ${selectedLog ? 'border-r border-slate-700 w-1/3 md:w-1/2' : 'w-full'}`}
        >
          {logs.length === 0 && (
            <div className="text-slate-600 text-center mt-10 italic">Awaiting kernel events...</div>
          )}
          {logs.map((log) => (
            <div 
              key={log.id}
              onClick={() => setSelectedLog(log)}
              className={`cursor-pointer p-2 rounded flex items-center gap-3 transition-colors ${
                selectedLog?.id === log.id 
                  ? 'bg-nebula-900/30 text-nebula-200 border border-nebula-900' 
                  : 'hover:bg-slate-800'
              }`}
            >
              <span className="text-slate-500 shrink-0 text-[10px]">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit', fractionalSecondDigits: 3 } as any)}
              </span>
              
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase shrink-0 w-24 text-center truncate ${
                log.type === 'request' ? 'bg-nebula-900/50 text-nebula-300' :
                log.type === 'response' ? 'bg-green-900/50 text-green-300' :
                log.type === 'error' ? 'bg-red-900/50 text-red-300 animate-pulse' :
                log.method === 'JS_BUILDER_OUTPUT' ? 'bg-purple-900/50 text-purple-300' :
                'bg-slate-700 text-slate-300'
              }`}>
                {log.method.replace('BROWSER_', '').replace('_OUTPUT', '')}
              </span>

              <span className={`truncate flex-1 font-semibold ${log.type === 'error' ? 'text-red-400' : 'text-slate-300'}`}>
                {log.summary || log.model || 'System'}
              </span>

              {log.tokens !== undefined && (
                <div className="flex flex-col items-end shrink-0 leading-none">
                    <span className="text-green-400 font-bold text-[11px]">{log.tokens} T</span>
                    {hasUsageInfo(log) && (
                        <span className="text-[9px] text-slate-500">
                            {getUsageData(log).usage?.prompt_tokens || 0}↑ {getUsageData(log).usage?.completion_tokens || 0}↓
                        </span>
                    )}
                </div>
              )}

              {log.durationMs !== undefined && (
                 <span className={`shrink-0 w-16 text-right ${log.durationMs > 1500 ? 'text-yellow-500' : 'text-slate-400'}`}>
                   {log.durationMs}ms
                 </span>
              )}
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        {selectedLog && (
          <div className={`${selectedLog ? 'w-2/3 md:w-1/2' : 'hidden'} overflow-y-auto bg-[#0d1117] p-4 relative border-l border-slate-800 flex flex-col`}>
             <button 
                onClick={() => setSelectedLog(null)}
                className="absolute top-2 right-2 text-slate-500 hover:text-white p-1"
             >
               <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
               </svg>
             </button>
             
             <div className="flex items-center justify-between mb-4 pr-8">
                <h3 className="text-nebula-400 font-black uppercase tracking-widest text-[10px]">Payload Inspector</h3>
                <button 
                  onClick={() => copyToClipboard(
                    typeof selectedLog.content === 'string' 
                      ? selectedLog.content 
                      : JSON.stringify(selectedLog.content, null, 2)
                  )}
                  className={`text-[9px] px-2 py-1 rounded border transition-colors ${copied ? 'bg-green-800 text-green-300 border-green-600' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'}`}
                >
                  {copied ? '✓ Copied!' : 'Copy JSON'}
                </button>
             </div>
             
             {/* Request Details */}
             {selectedLog.type === 'request' && (
                 <div className="grid grid-cols-3 gap-2 mb-4 bg-slate-800/50 p-2 rounded border border-slate-700">
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase font-black">Method</div>
                        <div className="text-lg text-nebula-400 font-black">{selectedLog.method}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase font-black">Model</div>
                        <div className="text-lg text-green-400 font-black">{selectedLog.model || 'N/A'}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase font-black">Tokens</div>
                        <div className="text-lg text-white font-black">{getNumber(selectedLog.tokens)}</div>
                    </div>
                 </div>
             )}

             {/* Usage info for responses */}
             {selectedLog.type === 'response' && hasUsageInfo(selectedLog) && (
                 <div className="grid grid-cols-3 gap-2 mb-4 bg-slate-800/50 p-2 rounded border border-slate-700">
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase font-black">Prompt</div>
                        <div className="text-lg text-nebula-500 font-black">{getUsageData(selectedLog).usage?.prompt_tokens || 0}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase font-black">Completion</div>
                        <div className="text-lg text-green-400 font-black">{getUsageData(selectedLog).usage?.completion_tokens || 0}</div>
                    </div>
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase font-black">Total</div>
                        <div className="text-lg text-white font-black">{getUsageData(selectedLog).usage?.total_tokens || 0}</div>
                    </div>
                 </div>
             )}

             {selectedLog.tokensPerSec !== undefined && (
                 <div className="grid grid-cols-2 gap-2 mb-4 bg-slate-800/50 p-2 rounded border border-slate-700">
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase font-black">Speed</div>
                        <div className="text-lg text-green-400 font-black">{selectedLog.tokensPerSec} <span className="text-[10px]">t/s</span></div>
                    </div>
                    <div>
                        <div className="text-[10px] text-slate-500 uppercase font-black">Volume</div>
                        <div className="text-lg text-white font-black">{getNumber(selectedLog.tokens)} <span className="text-[10px]">tokens</span></div>
                    </div>
                 </div>
             )}

             {selectedLog.durationMs !== undefined && (
                 <div className="mb-4 bg-slate-800/50 p-2 rounded border border-slate-700">
                    <div className="text-[10px] text-slate-500 uppercase font-black">Duration</div>
                    <div className={`text-lg font-black ${selectedLog.durationMs > 1500 ? 'text-yellow-500' : 'text-white'}`}>
                        {selectedLog.durationMs}ms
                    </div>
                 </div>
             )}

             <pre className="flex-1 text-[10px] text-slate-400 whitespace-pre-wrap break-all bg-black/40 p-3 rounded-xl border border-slate-700/50 leading-relaxed overflow-x-hidden font-mono">
               {JSON.stringify(selectedLog.content, null, 2)}
             </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default DebugConsole;
