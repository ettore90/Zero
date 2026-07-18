import React, { useState, useEffect } from 'react';
import { NEBULA_API_BASE } from '../constants';
import ReactFlow, { Background, Controls, Node, Edge, useNodesState, useEdgesState } from 'reactflow';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import 'reactflow/dist/style.css';
import { MemoryItem } from '../types';
import * as MemoryService from '../services/memoryService';

interface MemoryExplorerProps {
  ollamaHost: string;
  agents?: { id: string; name: string; color?: string }[];
}

const markdownClassName = "prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-headings:font-bold prose-h1:text-sm prose-h2:text-xs prose-h3:text-xs prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2 prose-pre:p-2 prose-pre:rounded-lg prose-pre:bg-slate-900 prose-code:text-[11px] prose-code:before:content-none prose-code:after:content-none break-words [overflow-wrap:anywhere]";

const MemoryExplorer: React.FC<MemoryExplorerProps> = ({ ollamaHost, agents = [] }) => {
  const agentMap = React.useMemo(() =>
    Object.fromEntries(agents.map(a => [a.id, a])),
    [agents]
  );
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemoryItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list');
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterTag, setFilterTag] = useState<string>('');
  const [loadError, setLoadError] = useState<string>('');

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const loadMemories = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const data = await MemoryService.listMemories();
      const nextMemories = data
        .slice()
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      setMemories(nextMemories);
      return nextMemories;
    } catch (e) {
      console.error('Failed to load memories', e);
      setLoadError('Failed to load memories.');
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const resetExplorerState = () => {
    setSearchQuery('');
    setSearchResults(null);
    setFilterCategory('');
    setFilterTag('');
    setSelectedMemory(null);
    setPage(1);
  };

  useEffect(() => {
    loadMemories();
  }, []);

  useEffect(() => {
    if (viewMode !== 'graph') return;

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const tagMap = new Map<string, string>();

    memories.forEach(mem => {
      mem.tags.forEach((tag: string) => {
        if (!tagMap.has(tag)) {
          const id = `tag-${tag}`;
          tagMap.set(tag, id);
          newNodes.push({
            id,
            data: { label: tag },
            position: { x: Math.random() * 800, y: Math.random() * 600 },
            style: { background: '#8b5cf6', color: 'white', borderRadius: '50px', border: 'none', padding: '10px 20px', fontWeight: 'bold' }
          });
        }
      });
    });

    memories.forEach((mem: MemoryItem) => {
      const memNodeId = `mem-${mem.id}`;
      newNodes.push({
        id: memNodeId,
        data: { label: mem.content.substring(0, 30) + '...' },
        position: { x: Math.random() * 800, y: Math.random() * 600 },
        style: { background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', fontSize: '10px', width: 150 }
      });

      mem.tags.forEach((tag: string) => {
        const tagId = tagMap.get(tag);
        if (tagId) {
          newEdges.push({
            id: `e-${mem.id}-${tag}`,
            source: tagId,
            target: memNodeId,
            animated: true,
            style: { stroke: '#64748b' }
          });
        }
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [memories, viewMode, setNodes, setEdges]);

  const handleRefresh = async () => {
    resetExplorerState();
    await loadMemories();
  };

  const handleClearSearch = async () => {
    resetExplorerState();
    await loadMemories();
  };

  const categoryBadgeClass = (category?: string) => {
    switch (category) {
      case 'fact': return 'bg-blue-200 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300';
      case 'state': return 'bg-yellow-200 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300';
      case 'event': return 'bg-purple-200 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300';
      case 'behavior': return 'bg-green-200 dark:bg-green-900/40 text-green-800 dark:text-green-300';
      case 'issue': return 'bg-red-200 dark:bg-red-900/40 text-red-800 dark:text-red-300';
      case 'knowledge': return 'bg-orange-200 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300';
      case 'design': return 'bg-cyan-200 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-300';
      default: return 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300';
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setPage(1);
      return;
    }
    setIsLoading(true);
    try {
      const results = await MemoryService.searchMemory(ollamaHost, searchQuery);
      setSearchResults(results);
      setPage(1);
    } catch (e: any) {
      console.error('[MemoryExplorer] Search failed:', e);
      try {
        const response = await fetch(`${NEBULA_API_BASE}/memory/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: searchQuery, limit: 20, threshold: 0.1 })
        });
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data.results ?? []);
          setPage(1);
          setMemories(prev => prev);
        } else {
          throw new Error(response.statusText);
        }
      } catch (e2) {
        console.error('[MemoryExplorer] Keyword fallback also failed:', e2);
        alert('Busca falhou. Tente novamente.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Forget this memory?')) return;
    await MemoryService.deleteMemory(id);
    handleRefresh();
  };

  const authoritativeItems = searchResults ?? memories;
  const baseItems = authoritativeItems;
  const allCategories = React.useMemo(() =>
    Array.from(new Set(authoritativeItems.map(m => m.category).filter(Boolean))).sort(),
    [authoritativeItems]
  );
  const allTags = React.useMemo(() =>
    Array.from(new Set(authoritativeItems.flatMap(m => Array.isArray(m.tags) ? m.tags : []))).sort(),
    [authoritativeItems]
  );

  const allItems = React.useMemo(() => {
    let items = baseItems;
    if (filterCategory) items = items.filter(m => m.category === filterCategory);
    if (filterTag) items = items.filter(m => Array.isArray(m.tags) && m.tags.includes(filterTag));
    return items;
  }, [baseItems, filterCategory, filterTag]);

  const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
  const displayItems = allItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="h-full bg-white dark:bg-dark-950 flex flex-col overflow-hidden">
      <div className="p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-dark-900 flex flex-col md:flex-row gap-4 justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">Memory Bank</h1>
          <p className="text-slate-500 text-xs">Knowledge Base</p>
        </div>

        <div className="flex flex-wrap gap-2 items-center justify-end">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-black/20 text-xs font-bold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white disabled:opacity-50"
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <div className="flex gap-2 bg-white dark:bg-black/20 p-1 rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setViewMode('list')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === 'list' ? 'bg-nebula-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
            >
              List View
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`px-4 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === 'graph' ? 'bg-nebula-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
            >
              Knowledge Graph
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 bg-white dark:bg-dark-950 border-b border-slate-200 dark:border-slate-800 flex gap-2">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search memories semantically..."
          className="flex-1 bg-slate-100 dark:bg-slate-900 border border-transparent focus:border-nebula-500 dark:text-white rounded-xl px-4 py-2 outline-none text-sm transition-all"
        />
        <button
          onClick={handleSearch}
          disabled={isLoading}
          className="bg-nebula-600 hover:bg-nebula-700 text-white px-6 py-2 rounded-xl font-bold text-sm shadow-lg shadow-nebula-600/20 disabled:opacity-50"
        >
          {isLoading ? 'Scanning...' : 'Recall'}
        </button>
        {searchResults && (
          <button
            onClick={handleClearSearch}
            className="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-4 py-2 rounded-xl font-bold text-sm"
          >
            Clear
          </button>
        )}
      </div>

      {loadError && (
        <div className="px-4 py-2 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900">
          {loadError}
        </div>
      )}

      {selectedMemory && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-4"
          onClick={() => setSelectedMemory(null)}
        >
          <div
            className="relative flex flex-col bg-white dark:bg-dark-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-3xl max-h-[90dvh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
              <div className="min-w-0">
                <h2 className="text-sm font-black text-slate-800 dark:text-white uppercase tracking-tight">Memory Detail</h2>
                <p className="text-[10px] text-slate-400 font-mono break-all mt-0.5">{selectedMemory.id}</p>
              </div>
              <button onClick={() => setSelectedMemory(null)} className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors mt-0.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-wrap gap-2 px-5 pt-3 shrink-0">
              {selectedMemory.category && (
                <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded ${categoryBadgeClass(selectedMemory.category)}`}>
                  {selectedMemory.category}
                </span>
              )}
              {(Array.isArray(selectedMemory.tags) ? selectedMemory.tags : []).map((tag: string) => (
                <span key={tag} className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-black uppercase tracking-wider rounded break-all">
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/10 p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]} className={`${markdownClassName} text-[12px] text-slate-700 dark:text-slate-300`}>
                  {selectedMemory.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="px-4 py-3 bg-slate-50 dark:bg-dark-900 border-b border-slate-200 dark:border-slate-800 flex flex-wrap gap-3 items-center">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 shrink-0">Filtrar</span>
        <div className="flex gap-1 bg-white dark:bg-black/20 p-1 rounded-lg border border-slate-200 dark:border-slate-800 flex-wrap">
          <button
            onClick={() => { setFilterCategory(''); setPage(1); }}
            className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors ${!filterCategory ? 'bg-nebula-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
          >
            Todas categorias
          </button>
          {allCategories.map(cat => (
            <button
              key={cat}
              onClick={() => { setFilterCategory((cat === filterCategory ? '' : cat) as string); setPage(1); }}
              className={`px-3 py-1 text-[10px] font-bold rounded-md transition-colors capitalize ${filterCategory === cat ? 'bg-nebula-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800 dark:hover:text-white'}`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 shrink-0">Tag</span>
          <select
            value={filterTag}
            onChange={e => { setFilterTag(e.target.value); setPage(1); }}
            className="text-[11px] font-bold bg-white dark:bg-black/20 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 rounded-lg px-3 py-1.5 outline-none focus:border-nebula-500 transition-colors max-w-[200px] cursor-pointer"
          >
            <option value="">Todas as tags</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>
        {(filterCategory || filterTag) && (
          <button
            onClick={() => { setFilterCategory(''); setFilterTag(''); setPage(1); }}
            className="px-3 py-1 text-[10px] font-bold rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-colors uppercase tracking-wider"
          >
            × Limpar
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden relative">
        {viewMode === 'list' ? (
          <div className="h-full overflow-y-auto p-4 md:p-8 space-y-4">
            {displayItems.length === 0 && (
              <div className="text-center py-20 text-slate-400">
                <p className="text-lg font-bold opacity-50">No memories found</p>
                <p className="text-xs">Agents create memories using the 'remember_fact' tool.</p>
              </div>
            )}
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[11px] text-slate-400">
                {allItems.length} {allItems.length === 1 ? 'memória' : 'memórias'}
                {totalPages > 1 && ` — página ${page} de ${totalPages}`}
              </span>
            </div>

            {displayItems.map((mem: MemoryItem) => (
              <div
                key={mem.id}
                className="bg-slate-50 dark:bg-dark-900 border border-slate-200 dark:border-slate-800 p-5 rounded-2xl hover:border-nebula-500/30 transition-all group overflow-hidden cursor-pointer"
                onClick={() => setSelectedMemory(mem)}
              >
                <div className="flex justify-between items-start mb-2 gap-3">
                  <div className="flex flex-wrap gap-2">
                    {mem.category && (
                      <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded ${categoryBadgeClass(mem.category)}`}>
                        {mem.category}
                      </span>
                    )}
                    {(Array.isArray(mem.tags) ? mem.tags : []).map((tag: string) => (
                      <span key={tag} className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-black uppercase tracking-wider rounded break-all max-w-full">
                        {tag}
                      </span>
                    ))}
                    {mem.relevance && (
                      <span className="px-2 py-0.5 bg-green-200 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-[10px] font-bold rounded">
                        {(mem.relevance * 100).toFixed(1)}% Match
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(mem.timestamp).toLocaleDateString()}
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(mem.id); }} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="max-h-40 overflow-y-auto pr-1 border border-slate-200/80 dark:border-slate-800/80 rounded-xl bg-white/60 dark:bg-black/10 p-3 cursor-default" onClick={(e) => e.stopPropagation()}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} className={`${markdownClassName} text-[12px] text-slate-700 dark:text-slate-300`}>
                    {mem.content}
                  </ReactMarkdown>
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    {(() => {
                      const agent = mem.agentId ? agentMap[mem.agentId] : null;
                      return (
                        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: agent?.color ?? '#94a3b8' }}>
                          {agent ? agent.name : (mem.agentId ?? 'default')}
                        </span>
                      );
                    })()}
                    {mem.importance !== undefined && (
                      <span className="text-[9px] text-slate-400">
                        importance: <span className={mem.importance > 1 ? 'text-yellow-500 font-bold' : ''}>{mem.importance.toFixed(1)}</span>
                      </span>
                    )}
                    {mem.accessCount !== undefined && (
                      <span className="text-[9px] text-slate-400">
                        accessed: {mem.accessCount}×
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-mono text-slate-400 break-all max-w-full">ID: {mem.id}</span>
                </div>
              </div>
            ))}

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4 pb-2 flex-wrap">
                <button onClick={() => setPage(1)} disabled={page === 1} className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">«</button>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 text-[11px] font-bold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">‹ Anterior</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                  .reduce<(number | '...')[]>((acc, p, i, arr) => {
                    if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, i) =>
                    item === '...'
                      ? <span key={`ellipsis-${i}`} className="text-[11px] text-slate-400 px-1">…</span>
                      : <button
                        key={item}
                        onClick={() => setPage(item as number)}
                        className={`w-7 h-7 text-[11px] font-bold rounded-lg transition-colors ${page === item ? 'bg-nebula-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                      >{item}</button>
                  )
                }
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 text-[11px] font-bold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">Próxima ›</button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-2 py-1 text-[11px] font-bold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">»</button>
              </div>
            )}
          </div>
        ) : (
          <div className="h-full w-full bg-slate-50 dark:bg-[#0B0F17]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
              attributionPosition="bottom-right"
            >
              <Background color="#334155" gap={20} size={1} />
              <Controls className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 fill-slate-500" />
            </ReactFlow>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemoryExplorer;
