import React from 'react';

const BOOT_LINES = [
  { delay: 0,    prompt: 'root@zero:~#', cmd: 'systemctl start zero-engine', out: null },
  { delay: 220,  prompt: null, cmd: null, out: '[ OK ] Started Zero Engine v1.6.0' },
  { delay: 420,  prompt: 'root@zero:~#', cmd: 'zero-ctl load-agents --registry /etc/zero/agents.d/', out: null },
  { delay: 620,  prompt: null, cmd: null, out: '[ OK ] Agent registry loaded — 9 agents online' },
  { delay: 820,  prompt: 'root@zero:~#', cmd: 'mount -t vectorfs /dev/memory0 /var/zero/memory', out: null },
  { delay: 1000, prompt: null, cmd: null, out: '[ OK ] Vector memory store mounted (nomic-embed-text)' },
  { delay: 1180, prompt: 'root@zero:~#', cmd: 'zero-ctl probe-llm --all', out: null },
  { delay: 1360, prompt: null, cmd: null, out: '[ OK ] LLM providers: azure-foundry gpt-5.4-LAB  sai  ollama' },
  { delay: 1520, prompt: 'root@zero:~#', cmd: 'zero-ctl load-tools /etc/zero/tools.d/', out: null },
  { delay: 1680, prompt: null, cmd: null, out: '[ OK ] Tool definitions compiled — 57 tools registered' },
  { delay: 1840, prompt: 'root@zero:~#', cmd: 'zero-ctl start-orchestrator --mode=master', out: null },
  { delay: 2020, prompt: null, cmd: null, out: '[ OK ] Orchestration engine running (PID 1337)' },
  { delay: 2180, prompt: 'root@zero:~#', cmd: 'zero-ctl sync-sessions --hydrate', out: null },
  { delay: 2360, prompt: null, cmd: null, out: '[ OK ] Session store hydrated — all agents ready' },
  { delay: 2500, prompt: 'root@zero:~#', cmd: '', out: null },
];

const BootScreen: React.FC = () => {
  const [visibleLines, setVisibleLines] = React.useState<number[]>([]);

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    BOOT_LINES.forEach((_, i) => {
      timers.push(setTimeout(() => {
        setVisibleLines(prev => [...prev, i]);
      }, BOOT_LINES[i].delay));
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  const isDone = visibleLines.length >= BOOT_LINES.length;

  return (
    <div className="h-screen w-screen bg-[#0d1117] font-mono flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-2 bg-[#161b22] border-b border-slate-800/60">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isDone ? 'bg-green-500' : 'bg-nebula-500 animate-pulse'}`} />
          <span className="text-[10px] font-black tracking-[0.35em] uppercase text-slate-400">Zero Engine</span>
        </div>
        <span className="text-[9px] text-slate-600 tracking-widest">boot sequence</span>
        <span className="text-[9px] text-slate-600 font-mono">v1.6.0</span>
      </div>

      {/* Terminal body — full screen */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-0.5">
        {/* Kernel banner */}
        <div className="mb-4 text-[11px] text-slate-600 leading-relaxed select-none">
          <div>Linux zero-engine 6.1.0-zero #1 SMP PREEMPT_DYNAMIC</div>
          <div>Zero AI Orchestration Engine — Copyright (c) Stefanini</div>
          <div className="mt-1 text-slate-700">──────────────────────────────────────────────────</div>
        </div>

        {BOOT_LINES.map((line, i) => (
          visibleLines.includes(i) && (
            <div key={i} className="text-[12px] leading-6">
              {line.cmd !== null ? (
                <div className="flex items-center gap-0">
                  <span className="text-green-500 select-none">root@zero</span>
                  <span className="text-slate-500 select-none">:</span>
                  <span className="text-nebula-400 select-none">~</span>
                  <span className="text-slate-500 select-none"># </span>
                  <span className="text-white">{line.cmd}</span>
                  {i === visibleLines.length - 1 && !line.out && line.cmd !== '' && (
                    <span className="inline-block w-2 h-4 bg-white/80 ml-0.5 animate-pulse" />
                  )}
                </div>
              ) : (
                <div className={`pl-0 ${line.out?.startsWith('[ OK ]') ? 'text-green-400' : 'text-slate-400'}`}>
                  {line.out?.startsWith('[ OK ]') ? (
                    <>
                      <span className="text-green-600">[</span>
                      <span className="text-green-400 font-bold"> OK </span>
                      <span className="text-green-600">]</span>
                      <span className="text-slate-300">{line.out.slice(6)}</span>
                    </>
                  ) : (
                    line.out
                  )}
                </div>
              )}
            </div>
          )
        ))}

        {/* Blinking cursor at end */}
        {isDone && (
          <div className="text-[12px] leading-6 flex items-center gap-0 mt-1">
            <span className="text-green-500 select-none">root@zero</span>
            <span className="text-slate-500 select-none">:</span>
            <span className="text-nebula-400 select-none">~</span>
            <span className="text-slate-500 select-none"># </span>
            <span className="inline-block w-2 h-4 bg-white/80 animate-pulse" />
          </div>
        )}
      </div>

      {/* Bottom status bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-1.5 bg-[#161b22] border-t border-slate-800/60">
        <div className="flex items-center gap-4">
          <span className="text-[9px] text-slate-600">
            {isDone ? (
              <span className="text-green-500">● all systems nominal</span>
            ) : (
              <span className="text-nebula-400 animate-pulse">● booting zero...</span>
            )}
          </span>
        </div>
        <div className="h-1 w-32 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-nebula-600 to-green-500 transition-all duration-500 ease-out"
            style={{ width: `${Math.round((visibleLines.length / BOOT_LINES.length) * 100)}%` }}
          />
        </div>
        <span className="text-[9px] text-slate-600 tabular-nums">
          {Math.round((visibleLines.length / BOOT_LINES.length) * 100)}%
        </span>
      </div>
    </div>
  );
};


export default BootScreen;
