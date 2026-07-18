import { useState, useCallback, useEffect, useRef } from 'react';
import { Project, ProjectContext } from '../types';

export const useProjectState = (
  initialProjects: Project[] = [],
  initialActiveId: string | null = null,
  onPersist: (projects: Project[], activeId: string | null) => void,
) => {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialActiveId);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanDraft, setScanDraft] = useState<ProjectContext | null>(null);

  const activeProject = projects.find(p => p.id === activeProjectId) ?? null;
  const lastInitialProjectsSignatureRef = useRef<string>('');
  const lastInitialActiveIdRef = useRef<string | null>(null);

  useEffect(() => {
    const nextSignature = JSON.stringify(initialProjects ?? []);
    if (lastInitialProjectsSignatureRef.current === nextSignature) return;
    lastInitialProjectsSignatureRef.current = nextSignature;
    setProjects(initialProjects);
  }, [initialProjects]);

  useEffect(() => {
    const nextActiveId = initialActiveId ?? null;
    if (lastInitialActiveIdRef.current === nextActiveId) return;
    lastInitialActiveIdRef.current = nextActiveId;
    setActiveProjectId(nextActiveId);
  }, [initialActiveId]);

  const addProject = useCallback((project: Project) => {
    const updated = [...projects, project];
    const newActiveId = project.id;
    setProjects(updated);
    setActiveProjectId(newActiveId);
    onPersist(updated, newActiveId);
  }, [projects, onPersist]);

  const editProject = useCallback((project: Project) => {
    const updated = projects.map(p => p.id === project.id ? project : p);
    setProjects(updated);
    onPersist(updated, activeProjectId);
  }, [projects, activeProjectId, onPersist]);

  const deleteProject = useCallback((id: string) => {
    const updated = projects.filter(p => p.id !== id);
    const newActiveId = activeProjectId === id
      ? (updated.length > 0 ? updated[0].id : null)
      : activeProjectId;
    setProjects(updated);
    setActiveProjectId(newActiveId);
    onPersist(updated, newActiveId);
  }, [projects, activeProjectId, onPersist]);

  const selectProject = useCallback((id: string) => {
    setActiveProjectId(id);
    onPersist(projects, id);
  }, [projects, onPersist]);

  // scanProject: varre o projeto e pede ao LLM para gerar contexto rico
  const scanProject = useCallback(async (
    projectId: string,
    callLLM: (prompt: string) => Promise<string>,
    execCommand: (cmd: string) => Promise<string>,
  ): Promise<ProjectContext | null> => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return null;
    setScanLoading(true);
    setScanDraft(null);
    try {
      const path = project.path;
      const [fileTree, packageJson, tsConfig, readmeContent, gitLog] = await Promise.allSettled([
        execCommand(`find "${path}" -maxdepth 3 -not -path "*/.git/*" -not -path "*/node_modules/*" -not -path "*/__pycache__/*" -not -path "*/dist/*" -not -path "*/build/*" | head -80`),
        execCommand(`cat "${path}/package.json" 2>/dev/null || echo "NOT_FOUND"`),
        execCommand(`cat "${path}/tsconfig.json" 2>/dev/null || echo "NOT_FOUND"`),
        execCommand(`cat "${path}/README.md" 2>/dev/null | head -60 || echo "NOT_FOUND"`),
        execCommand(`cd "${path}" && git log --oneline -10 2>/dev/null || echo "NOT_FOUND"`),
      ]);
      const get = (r: PromiseSettledResult<string>) => r.status === 'fulfilled' ? r.value : '';
      const prompt = `You are analyzing a software project to generate a concise context summary.
PROJECT PATH: ${path}
PROJECT NAME: ${project.name}

=== FILE TREE ===
${get(fileTree)}

=== package.json ===
${get(packageJson)}

=== tsconfig.json ===
${get(tsConfig)}

=== README ===
${get(readmeContent)}

=== GIT LOG ===
${get(gitLog)}

Generate a JSON object with EXACTLY this structure (no markdown, no explanation):
{
  "stack": ["technology1", "technology2"],
  "keyFiles": { "relative/path.ts": "what this file does" },
  "conventions": ["convention observed in this project"]
}
Rules: stack max 10, keyFiles max 12 (relative paths), conventions max 8. Be concise and accurate.`;

      const raw = await callLLM(prompt);
      let jsonStr = raw.trim();
      const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) jsonStr = fence[1].trim();
      const parsed = JSON.parse(jsonStr);
      const context: ProjectContext = {
        stack: Array.isArray(parsed.stack) ? parsed.stack.slice(0, 10) : [],
        keyFiles: typeof parsed.keyFiles === 'object' && !Array.isArray(parsed.keyFiles)
          ? Object.fromEntries(Object.entries(parsed.keyFiles).slice(0, 12).map(([k, v]) => [k, String(v)]))
          : {},
        conventions: Array.isArray(parsed.conventions) ? parsed.conventions.slice(0, 8) : [],
        generatedAt: Date.now(),
        approved: false,
      };
      setScanDraft(context);
      return context;
    } catch (e) {
      console.error('[useProjectState] scanProject failed:', e);
      return null;
    } finally {
      setScanLoading(false);
    }
  }, [projects]);

  const approveContext = useCallback((projectId: string, context: ProjectContext) => {
    const approved: ProjectContext = { ...context, approved: true };
    const updated = projects.map(p => p.id === projectId ? { ...p, context: approved } : p);
    setProjects(updated);
    setScanDraft(null);
    onPersist(updated, activeProjectId);
  }, [projects, activeProjectId, onPersist]);

  const dismissDraft = useCallback(() => setScanDraft(null), []);

  const getProjectContext = useCallback((): string => {
    if (!activeProject) return '';
    const lines: string[] = [
      `\n\n[ACTIVE PROJECT]`,
      `Name: ${activeProject.name}`,
      `Path: ${activeProject.path}`,
      activeProject.description ? `Description: ${activeProject.description}` : '',
      ``,
      `You are working inside this project. When executing terminal commands or reading/writing files,`,
      `always use paths relative to "${activeProject.path}" unless explicitly specified otherwise.`,
    ];
    const ctx = activeProject.context;
    if (ctx?.approved) {
      if (ctx.stack.length > 0) lines.push(``, `Tech Stack: ${ctx.stack.join(', ')}`);
      if (Object.keys(ctx.keyFiles).length > 0) {
        lines.push(``, `Key Files:`);
        for (const [file, desc] of Object.entries(ctx.keyFiles)) lines.push(`  - ${file}: ${desc}`);
      }
      if (ctx.conventions.length > 0) {
        lines.push(``, `Project Conventions:`);
        for (const c of ctx.conventions) lines.push(`  - ${c}`);
      }
      const ageDays = Math.round((Date.now() - ctx.generatedAt) / 86400000);
      if (ageDays > 7) lines.push(``, `[Context is ${ageDays} days old — consider re-scanning]`);
    }
    return lines.filter(Boolean).join('\n');
  }, [activeProject]);

  return {
    projects, activeProjectId, activeProject,
    addProject, editProject, deleteProject, selectProject,
    getProjectContext, scanProject, approveContext,
    scanLoading, scanDraft, dismissDraft,
  };
};