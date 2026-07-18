import React, { useMemo, useState } from 'react';

// ---------------------------------------------------------------------------
// DryRunModal
// Exibe diff entre conteúdo atual e proposto antes de write_file.
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNo: number;
}

function computeDiff(original: string, proposed: string): DiffLine[] {
  const origLines = original.split('\n');
  const propLines = proposed.split('\n');

  // Simple LCS-based diff
  const m = origLines.length;
  const n = propLines.length;

  // Build LCS table (capped to avoid perf issues on large files)
  const MAX = 300;
  const useSimple = m > MAX || n > MAX;

  if (useSimple) {
    // For large files: just show unified +/- without LCS
    const result: DiffLine[] = [];
    const removedSet = new Set<string>(origLines.filter(l => !propLines.includes(l)));
    const added = new Set<string>(propLines.filter(l => !origLines.includes(l)));
    let ln = 1;
    void removedSet; // used for symmetry, added set drives the diff
    for (const line of propLines) {
      result.push({
        type: added.has(line) ? 'added' : 'unchanged',
        content: line,
        lineNo: ln++,
      });
    }
    return result;
  }

  // LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = origLines[i - 1] === propLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === propLines[j - 1]) {
      result.unshift({ type: 'unchanged', content: origLines[i - 1], lineNo: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', content: propLines[j - 1], lineNo: j });
      j--;
    } else {
      result.unshift({ type: 'removed', content: origLines[i - 1], lineNo: i });
      i--;
    }
  }
  return result;
}

function DiffStats({ lines }: { lines: DiffLine[] }) {
  const added = lines.filter(l => l.type === 'added').length;
  const removedCount = lines.filter(l => l.type === 'removed').length;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="text-emerald-400 font-bold">+{added}</span>
      <span className="text-red-400 font-bold">-{removedCount}</span>
      <span className="text-slate-500">{lines.filter(l => l.type === 'unchanged').length} unchanged</span>
    </div>
  );
}

export interface DryRunPayload {
  path: string;
  originalContent: string;
  proposedContent: string;
  agentId: string;
  toolCallId: string;
}

interface DryRunModalProps {
  payload: DryRunPayload;
  agentName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

type ViewMode = 'diff' | 'original' | 'proposed';

export const DryRunModal: React.FC<DryRunModalProps> = ({
  payload,
  agentName,
  onConfirm,
  onCancel,
}) => {
  const { path, originalContent, proposedContent } = payload;
  const [viewMode, setViewMode] = useState<ViewMode>('diff');
  const [showAll, setShowAll] = useState(false);

  const diffLines = useMemo(
    () => computeDiff(originalContent, proposedContent),
    [originalContent, proposedContent]
  );

  const isNewFile = !originalContent;
  const hasChanges = originalContent !== proposedContent;

  // For diff view: only show changed lines + 2 context lines around them
  const visibleLines = useMemo(() => {
    if (showAll || viewMode !== 'diff') return diffLines;
    const changedIdxs = new Set<number>();
    diffLines.forEach((l, i) => {
      if (l.type !== 'unchanged') {
        for (let c = Math.max(0, i - 2); c <= Math.min(diffLines.length - 1, i + 2); c++) {
          changedIdxs.add(c);
        }
      }
    });
    if (changedIdxs.size === 0) return diffLines.slice(0, 10);

    const result: (DiffLine | 'ellipsis')[] = [];
    let lastIdx = -1;
    for (const idx of [...changedIdxs].sort((a, b) => a - b)) {
      if (lastIdx !== -1 && idx > lastIdx + 1) result.push('ellipsis');
      result.push(diffLines[idx]);
      lastIdx = idx;
    }
    return result;
  }, [diffLines, showAll, viewMode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center text-xl">✏️</div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white">Write File — Review Changes</h2>
            <p className="text-[11px] text-slate-400 font-mono truncate">{path}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-slate-500">via {agentName}</p>
            {isNewFile
              ? <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">New File</span>
              : <DiffStats lines={diffLines} />
            }
          </div>
        </div>

        {/* View mode tabs */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-slate-800/60 shrink-0">
          {(['diff', 'original', 'proposed'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
                viewMode === mode
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {mode}
            </button>
          ))}
          <div className="flex-1" />
          {viewMode === 'diff' && diffLines.length > 20 && (
            <button
              onClick={() => setShowAll(p => !p)}
              className="text-[9px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              {showAll ? 'Show context only' : 'Show all lines'}
            </button>
          )}
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed">
          {viewMode === 'diff' && (
            <div>
              {(visibleLines as (DiffLine | 'ellipsis')[]).map((line, i) => {
                if (line === 'ellipsis') {
                  return (
                    <div key={`ellipsis-${i}`} className="px-4 py-0.5 text-slate-600 bg-slate-800/30 text-center">
                      ···
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className={`flex gap-3 px-4 py-0.5 ${
                      line.type === 'added' ? 'bg-emerald-500/10 text-emerald-300' :
                      line.type === 'removed' ? 'bg-red-500/10 text-red-300 line-through opacity-60' :
                      'text-slate-400'
                    }`}
                  >
                    <span className="w-4 shrink-0 text-right text-slate-600 select-none">
                      {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all">{line.content}</span>
                  </div>
                );
              })}
            </div>
          )}

          {viewMode === 'original' && (
            <div>
              {(originalContent || '(empty file)').split('\n').map((line, i) => (
                <div key={i} className="flex gap-3 px-4 py-0.5 text-slate-400">
                  <span className="w-8 shrink-0 text-right text-slate-600 select-none">{i + 1}</span>
                  <span className="flex-1 whitespace-pre-wrap break-all">{line}</span>
                </div>
              ))}
            </div>
          )}

          {viewMode === 'proposed' && (
            <div>
              {proposedContent.split('\n').map((line, i) => (
                <div key={i} className="flex gap-3 px-4 py-0.5 text-slate-300">
                  <span className="w-8 shrink-0 text-right text-slate-600 select-none">{i + 1}</span>
                  <span className="flex-1 whitespace-pre-wrap break-all">{line}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-800 flex items-center gap-3 shrink-0">
          {!hasChanges && (
            <span className="text-xs text-slate-500 italic">No changes detected</span>
          )}
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 text-white transition-all"
          >
            {isNewFile ? '📄 Create File' : '✏️ Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DryRunModal;