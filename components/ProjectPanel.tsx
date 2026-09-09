import React, { useState, useEffect, useCallback } from 'react';
import { Project } from '../types';
import { canvasBus } from '../hooks/useCanvasState';
import { NEBULA_API_BASE } from '../constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
  expanded?: boolean;
}

interface GitInfo {
  branch: string;
  status: string; // saída do git status --short
  ahead: number;
  behind: number;
}

interface ProjectPanelProps {
  projects: Project[];
  activeProjectId: string | null;
  onSelectProject: (id: string) => void;
  onAddProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (id: string) => void;
  onScanProject?: (id: string) => Promise<any>;
  scanLoading?: boolean;
  scanDraft?: import('../types').ProjectContext | null;
  onApproveContext?: (ctx: import('../types').ProjectContext) => void;
  onDismissDraft?: () => void;
  activeAgentId?: string;        // agentId para emitir no canvas certo
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PROJECT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16',
];

const getFileIcon = (name: string, isDir: boolean) => {
  if (isDir) return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-yellow-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const colorMap: Record<string, string> = {
    ts: 'text-blue-400', tsx: 'text-blue-300', js: 'text-yellow-300',
    jsx: 'text-yellow-200', py: 'text-green-400', json: 'text-orange-300',
    md: 'text-slate-300', css: 'text-pink-400', html: 'text-orange-400',
    sh: 'text-green-300', yml: 'text-red-300', yaml: 'text-red-300',
    env: 'text-purple-300', go: 'text-cyan-400', rs: 'text-orange-500',
  };
  const color = colorMap[ext] ?? 'text-slate-400';
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
};


// ---------------------------------------------------------------------------
// Add/Edit Project Modal
// ---------------------------------------------------------------------------
interface ProjectFormProps {
  initial?: Project;
  onSave: (p: Project) => void;
  onCancel: () => void;
}

const ProjectForm: React.FC<ProjectFormProps> = ({ initial, onSave, onCancel }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [path, setPath] = useState(initial?.path ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? PROJECT_COLORS[0]);
  const [gitEnabled, setGitEnabled] = useState(initial?.gitEnabled ?? true);

  const handleSave = () => {
    if (!name.trim() || !path.trim()) return;
    onSave({
      id: initial?.id ?? `proj_${Date.now()}`,
      name: name.trim(),
      path: path.trim(),
      description: description.trim() || undefined,
      color,
      gitEnabled,
      createdAt: initial?.createdAt ?? Date.now(),
    });
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-black uppercase tracking-wider text-white">
            {initial ? 'Edit Project' : 'Add Project'}
          </h2>
          <button onClick={onCancel} className="text-slate-500 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Project Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Project"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-nebula-500 transition-colors"
            />
          </div>

          {/* Path */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Server Path</label>
            <input
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder="/home/user/projects/my-app"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 font-mono focus:outline-none focus:border-nebula-500 transition-colors"
            />
            <p className="text-[9px] text-slate-600 mt-1">Absolute path on the SSH server</p>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5">Description <span className="normal-case font-normal">(optional)</span></label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Short description..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-nebula-500 transition-colors"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {PROJECT_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : 'opacity-60 hover:opacity-100'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* Git */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => setGitEnabled(p => !p)}
              className={`w-9 h-5 rounded-full transition-colors relative ${gitEnabled ? 'bg-nebula-600' : 'bg-slate-700'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${gitEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-xs text-slate-300 font-medium">Show git status & branch</span>
          </label>
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 rounded-xl border border-slate-700 text-slate-400 text-sm font-bold hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !path.trim()}
            className="flex-1 px-4 py-2 rounded-xl bg-nebula-600 text-white text-sm font-black uppercase tracking-wider hover:bg-nebula-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {initial ? 'Save' : 'Add Project'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// File Tree Node
// ---------------------------------------------------------------------------
interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  onOpenFile: (path: string) => void;
  onToggleDir: (path: string) => void;
  loadingDirs: Set<string>;
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({ node, depth, onOpenFile, onToggleDir, loadingDirs }) => {
  const indent = depth * 12;
  const isDir = node.type === 'dir';
  const isLoadingThis = isDir && loadingDirs.has(node.path);

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer transition-colors group text-slate-400 hover:text-slate-100 hover:bg-slate-800/60`}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={() => isDir ? onToggleDir(node.path) : onOpenFile(node.path)}
      >
        {/* Expand arrow / spinner for dirs */}
        {isDir && (
          isLoadingThis
            ? <svg className="h-2.5 w-2.5 shrink-0 animate-spin text-indigo-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            : <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-2.5 w-2.5 shrink-0 transition-transform text-slate-600 ${node.expanded ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
        )}
        {!isDir && <span className="w-2.5 shrink-0" />}

        {getFileIcon(node.name, isDir)}
        <span className="text-[11px] font-mono truncate flex-1">{node.name}</span>
      </div>

      {/* Children */}
      {isDir && node.expanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              onToggleDir={onToggleDir}
              loadingDirs={loadingDirs}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Git Status Badge
// ---------------------------------------------------------------------------
const GitStatusBar: React.FC<{ info: GitInfo | null; loading: boolean }> = ({ info, loading }) => {
  if (loading) return (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-800/60 rounded-lg">
      <div className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />
      <span className="text-[9px] text-slate-600 font-mono">Loading git...</span>
    </div>
  );

  if (!info) return null;

  const hasChanges = info.status.trim().length > 0;
  const changedFiles = info.status.trim().split('\n').filter(Boolean).length;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/40 rounded-lg border border-slate-700/40">
      {/* Branch */}
      <div className="flex items-center gap-1 text-nebula-400">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
        </svg>
        <span className="text-[10px] font-mono font-bold">{info.branch}</span>
      </div>

      <div className="w-px h-3 bg-slate-700" />

      {/* Status */}
      <div className={`flex items-center gap-1 ${hasChanges ? 'text-amber-400' : 'text-green-400'}`}>
        <div className={`w-1.5 h-1.5 rounded-full ${hasChanges ? 'bg-amber-400' : 'bg-green-400'}`} />
        <span className="text-[10px] font-mono">
          {hasChanges ? `${changedFiles} change${changedFiles > 1 ? 's' : ''}` : 'clean'}
        </span>
      </div>

      {/* Ahead/Behind */}
      {(info.ahead > 0 || info.behind > 0) && (
        <>
          <div className="w-px h-3 bg-slate-700" />
          <span className="text-[9px] text-slate-500 font-mono">
            {info.ahead > 0 && `↑${info.ahead}`}{info.behind > 0 && ` ↓${info.behind}`}
          </span>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main ProjectPanel
// ---------------------------------------------------------------------------
const ProjectPanel: React.FC<ProjectPanelProps> = ({
  projects, activeProjectId, onSelectProject,
  onAddProject, onEditProject, onDeleteProject,
  onScanProject, scanLoading, scanDraft, onApproveContext, onDismissDraft,
  activeAgentId,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [showContextApproval, setShowContextApproval] = useState(false);
  const [editedDraft, setEditedDraft] = useState<import('../types').ProjectContext | null>(null);
  const [editingProject, setEditingProject] = useState<Project | undefined>(undefined);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set()); // paths sendo carregados agora
  const [loadedDirs, setLoadedDirs] = useState<Set<string>>(new Set()); // paths já carregados
  const [loadingGit, setLoadingGit] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null;

  // Carregar file tree quando projeto muda
  useEffect(() => {
    if (!activeProject) { setFileTree([]); setGitInfo(null); return; }
    loadFileTree(activeProject.path, null);
    if (activeProject.gitEnabled) loadGitInfo(activeProject.path);
  }, [activeProjectId]);

  const loadFileTree = useCallback(async (projectPath: string, dirPath: string | null) => {
    const targetPath = dirPath ?? projectPath;
    // Para subdirs: usar loadingDirs local (não bloquear o painel inteiro)
    if (dirPath !== null) {
      setLoadingDirs(prev => new Set(prev).add(dirPath));
    } else {
      setLoadingTree(true);
    }
    setTreeError(null);
    try {
      const res = await fetch(`${NEBULA_API_BASE}/system/fs/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      });
      if (!res.ok) {
        if (res.status === 502) throw new Error('SSH connection failed (502). Is the server SSH target reachable?');
        throw new Error(`Server returned ${res.status}`);
      }
      const data = await res.json();

      if (data.error) throw new Error(data.error);

      // Servidor retorna: { path, files: [{name, isDirectory, size}] }
      const rawList: any[] = Array.isArray(data) ? data : (data.files ?? data.entries ?? data.items ?? []);

      const nodes: FileNode[] = rawList.map((f: any) => {
        const isDir = f.isDirectory === true || f.isDir === true || f.is_dir === true
          || f.type === 'dir' || f.type === 'directory'
          || f.kind === 'dir' || f.kind === 'directory'
          || (typeof f.name === 'string' && f.name.endsWith('/'));
        const cleanName = (f.name ?? f.filename ?? '').replace(/\/$/, '');
        return {
          name: cleanName,
          path: (targetPath + '/' + cleanName).replace(/\/+/g, '/'),
          type: isDir ? 'dir' : 'file',
          children: isDir ? [] : undefined,
          expanded: false,
        } as FileNode;
      });

      // Ordenar: dirs primeiro, depois arquivos, ambos alfabéticos
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      // Filtrar arquivos/pastas ocultos e comuns desnecessários
      const filtered = nodes.filter(n => {
        const hidden = ['.git', 'node_modules', '__pycache__', '.next', 'dist', 'build', '.cache'];
        return !n.name.startsWith('.') && !hidden.includes(n.name);
      });

      if (dirPath === null) {
        // Root load
        setFileTree(filtered);
      } else {
        // Expandir subdir
        setFileTree(prev => updateTreeNode(prev, dirPath, filtered));
      }
    } catch (e: any) {
      if (dirPath === null) setTreeError(e.message);
      else console.warn(`[ProjectPanel] Failed to load ${dirPath}:`, e.message);
    } finally {
      if (dirPath !== null) {
        setLoadingDirs(prev => { const s = new Set(prev); s.delete(dirPath); return s; });
        setLoadedDirs(prev => new Set(prev).add(dirPath));
      } else {
        setLoadingTree(false);
        setLoadedDirs(new Set()); // reset on root reload
      }
    }
  }, []);

  // Helper: executa comando SSH via /system/exec
  // Retorna string vazia em caso de falha (502 SSH, timeout, etc)
  const execCommand = useCallback(async (command: string): Promise<string> => {
    try {
      const res = await fetch(`${NEBULA_API_BASE}/system/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      return (data.output ?? data.result ?? data.stdout ?? '').trim();
    } catch {
      return '';
    }
  }, []);

  const loadGitInfo = useCallback(async (projectPath: string) => {
    setLoadingGit(true);
    try {
      // Branch
      const branch = await execCommand(`cd "${projectPath}" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-git"`);

      if (branch === 'no-git' || !branch) { setGitInfo(null); return; }

      // Status
      const statusOut = await execCommand(`cd "${projectPath}" && git status --short 2>/dev/null`);

      // Ahead/behind
      const aheadOut = await execCommand(`cd "${projectPath}" && git rev-list --count --left-right @{upstream}...HEAD 2>/dev/null || echo "0 0"`);
      const [behind, ahead] = (aheadOut || '0 0').split(/\s+/).map(Number);

      setGitInfo({
        branch,
        status: statusOut,
        ahead: ahead || 0,
        behind: behind || 0,
      });
    } catch {
      setGitInfo(null);
    } finally {
      setLoadingGit(false);
    }
  }, []);

  const handleToggleDir = useCallback((path: string) => {
    setFileTree(prev => {
      const node = findNode(prev, path);
      if (!node) return prev;

      const alreadyLoaded = loadedDirs.has(path);
      const isLoading = loadingDirs.has(path);

      // Carregar filhos se: está fechando → expandindo E ainda não foi carregado E não está carregando
      if (!node.expanded && !alreadyLoaded && !isLoading) {
        loadFileTree(activeProject!.path, path);
      }
      return updateNodeExpanded(prev, path, !node.expanded);
    });
  }, [activeProject, loadFileTree, loadedDirs, loadingDirs]);

  const handleOpenFile = useCallback(async (filePath: string) => {
    try {
      const res = await fetch(`${NEBULA_API_BASE}/system/fs/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      const fileContent = data.content ?? data.text ?? data.output ?? '';
      canvasBus.emit({ type: 'file:open', payload: { path: filePath, content: fileContent, agentId: activeAgentId } });
    } catch (e: any) {
      console.error('Failed to open file:', e.message);
    }
  }, [activeAgentId]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 border-r border-slate-800/60">

      {/* Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-slate-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-emerald-600 rounded flex items-center justify-center shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
            </svg>
          </div>
          <h1 className="text-[10px] font-black tracking-[0.25em] uppercase text-white/90">Projects</h1>
        </div>
        <button
          onClick={() => { setEditingProject(undefined); setShowForm(true); }}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
          title="Add Project"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-[9px] font-black uppercase tracking-wider">Add</span>
        </button>
      </div>

      {/* Project list */}
      <div className="flex flex-col overflow-hidden" style={{ maxHeight: projects.length > 0 ? `${Math.min(projects.length * 56 + 16, 220)}px` : 'auto' }}>
        <div className="overflow-y-auto p-2 space-y-1">
          {projects.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center mx-auto mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              </div>
              <p className="text-[10px] text-slate-600 font-bold">No projects yet</p>
              <p className="text-[9px] text-slate-700 mt-1">Click + Add to register a project</p>
            </div>
          ) : (
            projects.map(project => (
              <div key={project.id} className="group relative">
                <button
                  onClick={() => onSelectProject(project.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left ${
                    activeProjectId === project.id
                      ? 'bg-slate-800 text-white ring-1 ring-slate-600'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                  }`}
                >
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: project.color ?? '#6366f1' }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold block truncate">{project.name}</span>
                    <span className="text-[9px] text-slate-600 font-mono truncate block leading-none mt-0.5">{project.path}</span>
                  </div>
                  {activeProjectId === project.id && (
                    <span className="text-[8px] font-black text-emerald-500 uppercase tracking-wider shrink-0">Active</span>
                  )}
                </button>

                {/* Edit/Delete on hover */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                  <button
                    onClick={e => { e.stopPropagation(); setEditingProject(project); setShowForm(true); }}
                    className="p-1 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); if (confirm(`Delete "${project.name}"?`)) onDeleteProject(project.id); }}
                    className="p-1 rounded-md bg-slate-700 hover:bg-red-900/60 text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Divider */}
      {activeProject && <div className="h-px bg-slate-800/60 mx-3 shrink-0" />}

      {/* Active project detail: git + file tree */}
      {activeProject && (
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Project header */}
          <div className="px-3 pt-3 pb-2 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ background: activeProject.color }} />
              <span className="text-[10px] font-black text-white uppercase tracking-wider truncate flex-1">{activeProject.name}</span>
              <button
                onClick={() => activeProject.gitEnabled && loadGitInfo(activeProject.path)}
                className="text-slate-600 hover:text-slate-400 transition-colors"
                title="Refresh"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${loadingGit ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* Context badge + Scan button */}
            <div className="flex items-center gap-1.5 mt-1.5">
              {activeProject.context?.approved ? (
                <span className="text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                  ✓ Context
                </span>
              ) : (
                <span className="text-[9px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                  No context
                </span>
              )}
              {onScanProject && (
                <button
                  onClick={async () => {
                    if (!activeProject) return;
                    await onScanProject(activeProject.id);
                    setShowContextApproval(true);
                  }}
                  disabled={scanLoading}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 text-[9px] font-bold uppercase tracking-wide transition-colors disabled:opacity-50"
                >
                  {scanLoading ? (
                    <svg className="h-2.5 w-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                  {scanLoading ? 'Scanning...' : 'Scan Project'}
                </button>
              )}
            </div>

            {/* Git status */}
            {activeProject.gitEnabled && (
              <GitStatusBar info={gitInfo} loading={loadingGit} />
            )}
          </div>

          {/* File tree */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-1 pb-3">
            {loadingTree && fileTree.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-4 h-4 border-2 border-nebula-500/30 border-t-nebula-500 rounded-full animate-spin" />
              </div>
            ) : treeError ? (
              <div className="px-3 py-4 text-center">
                <p className="text-[10px] text-red-400 font-mono">{treeError}</p>
                <button
                  onClick={() => loadFileTree(activeProject.path, null)}
                  className="mt-2 text-[9px] text-slate-500 hover:text-slate-300 underline"
                >
                  Retry
                </button>
              </div>
            ) : fileTree.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] text-slate-600">Empty directory</div>
            ) : (
              fileTree.map(node => (
                <FileTreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  onOpenFile={handleOpenFile}
                  onToggleDir={handleToggleDir}
                  loadingDirs={loadingDirs}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Form modal */}
      {/* Context Approval Modal */}
      {showContextApproval && scanDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-lg">🧠</div>
              <div className="flex-1">
                <h2 className="text-sm font-bold text-white">Project Context</h2>
                <p className="text-xs text-slate-400">Review and approve before injecting into agent prompts</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Stack */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Tech Stack</label>
                <div className="flex flex-wrap gap-1.5">
                  {(editedDraft ?? scanDraft).stack.map((tech, i) => (
                    <span key={i} className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-mono">{tech}</span>
                  ))}
                </div>
              </div>

              {/* Key Files */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Key Files</label>
                <div className="space-y-1">
                  {Object.entries((editedDraft ?? scanDraft).keyFiles).map(([file, desc], i) => (
                    <div key={i} className="flex gap-2 text-[11px]">
                      <span className="font-mono text-indigo-400 shrink-0">{file}</span>
                      <span className="text-slate-400">— {desc as string}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Conventions */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 block">Conventions</label>
                <ul className="space-y-1">
                  {(editedDraft ?? scanDraft).conventions.map((c, i) => (
                    <li key={i} className="text-[11px] text-slate-300 flex gap-2">
                      <span className="text-emerald-500 shrink-0">✓</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-800 flex gap-3">
              <button
                onClick={() => { setShowContextApproval(false); onDismissDraft?.(); }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-400 border border-slate-700 hover:border-slate-500 transition-all"
              >
                Discard
              </button>
              <button
                onClick={() => {
                  if (onApproveContext && activeProject) {
                    onApproveContext(editedDraft ?? scanDraft);
                    setShowContextApproval(false);
                    setEditedDraft(null);
                  }
                }}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
              >
                ✓ Approve & Inject
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <ProjectForm
          initial={editingProject}
          onSave={p => {
            if (editingProject) onEditProject(p);
            else onAddProject(p);
            setShowForm(false);
          }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
};

export default React.memo(ProjectPanel);

// ---------------------------------------------------------------------------
// Tree helpers (pure functions)
// ---------------------------------------------------------------------------
function findNode(tree: FileNode[], path: string): FileNode | null {
  for (const node of tree) {
    if (node.path === path) return node;
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) return found;
    }
  }
  return null;
}

function updateTreeNode(tree: FileNode[], dirPath: string, children: FileNode[]): FileNode[] {
  return tree.map(node => {
    if (node.path === dirPath) return { ...node, children, expanded: true };
    if (node.children) return { ...node, children: updateTreeNode(node.children, dirPath, children) };
    return node;
  });
}

function updateNodeExpanded(tree: FileNode[], path: string, expanded: boolean): FileNode[] {
  return tree.map(node => {
    if (node.path === path) return { ...node, expanded };
    if (node.children) return { ...node, children: updateNodeExpanded(node.children, path, expanded) };
    return node;
  });
}