// =============================================================================
// projectContext.js — carrega instruções de projeto (CLAUDE.md / AGENTS.md)
// a partir do diretório de trabalho do agente.
//
// O mesmo arquivo que o Claude Code lê no host é lido aqui: o workspace do host
// está montado dentro do container, então `/uby/<projeto>/CLAUDE.md` é
// literalmente `~/Software/Uby/<projeto>/CLAUDE.md`. Um único arquivo serve os
// dois harnesses; não existe cópia para manter em sincronia.
//
// O ponto de partida preferido é o projeto ativo do project tree, que o frontend
// envia no corpo de /api/chat; o cwd do agente é apenas o fallback. A busca sobe
// desse ponto até a raiz e monta os arquivos do mais genérico para o mais
// específico, de forma que a instrução mais próxima do projeto venha por último
// e prevaleça em caso de conflito.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { hostToContainer } from '../utils/pathTransforms.js';

const INSTRUCTION_FILENAMES = ['CLAUDE.md', 'AGENTS.md'];
const WORKSPACE_ROOT = (typeof env?.CONTAINER_APP_ROOT === 'string' && env.CONTAINER_APP_ROOT.trim()) || '/uby';
const MAX_FILES = 5;
const MAX_FILE_CHARS = 16000;
const MAX_TOTAL_CHARS = 24000;
const MAX_DEPTH = 12;

// path -> { mtimeMs, size, content }. Evita reler o arquivo a cada turno sem
// nunca servir conteúdo velho: mtime e size são revalidados em cada leitura.
const fileCache = new Map();

function isDirectory(candidate) {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
}

/**
 * Traduz o caminho do projeto ativo para um diretório que exista neste processo.
 * O project tree guarda o caminho como o usuário o cadastrou, que pode ser o do
 * host; o mapeamento host→container resolve esse caso, e a última tentativa
 * reancora o sufixo do caminho na raiz do workspace (`/uby/<projeto>`) para
 * quando não houver HOST_WORKSPACE_ROOT configurado. Retorna null se nada existir.
 */
export function resolveProjectRoot(projectPath) {
  const raw = String(projectPath || '').trim();
  if (!raw) return null;

  const normalized = path.posix.resolve(raw.replace(/\\/g, '/'));
  if (isDirectory(normalized)) return normalized;

  const mapped = path.posix.resolve(String(hostToContainer(normalized, env) || '').replace(/\\/g, '/'));
  if (mapped && isDirectory(mapped)) return mapped;

  const workspaceRoot = path.posix.resolve(String(WORKSPACE_ROOT || '/uby').replace(/\\/g, '/'));
  const segments = normalized.split('/').filter(Boolean);
  for (let start = 0; start < segments.length; start += 1) {
    const candidate = path.posix.join(workspaceRoot, segments.slice(start).join('/'));
    if (isDirectory(candidate)) return candidate;
  }

  return null;
}

/** Branch atual lido direto de .git/HEAD — sem shell e sem custo perceptível. */
function readGitBranch(projectRoot) {
  try {
    const head = fs.readFileSync(path.posix.join(projectRoot, '.git', 'HEAD'), 'utf8').trim();
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (match) return match[1];
    return /^[0-9a-f]{7,40}$/i.test(head) ? `${head.slice(0, 12)} (detached)` : null;
  } catch {
    return null;
  }
}

function readInstructionFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return null;
  } catch {
    return null;
  }

  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.content;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  if (content.length > MAX_FILE_CHARS) {
    content = `${content.slice(0, MAX_FILE_CHARS)}\n\n[...truncado em ${MAX_FILE_CHARS} caracteres]`;
  }

  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, content });
  return content;
}

function collectAncestorDirectories(startPath) {
  const normalized = path.posix.resolve(String(startPath || '/').replace(/\\/g, '/'));
  const directories = [];
  let current = normalized;

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    directories.push(current);
    const parent = path.posix.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
  }

  // Do mais genérico (raiz) para o mais específico (cwd).
  directories.reverse();

  // A raiz do workspace entra sempre, mesmo quando o cwd ainda é `/`: é onde mora
  // o arquivo de instrução compartilhado entre projetos. Se já estiver na cadeia
  // de ancestrais, a deduplicação abaixo preserva a posição original.
  const workspaceRoot = path.posix.resolve(String(WORKSPACE_ROOT || '/uby').replace(/\\/g, '/'));
  const ordered = directories.includes(workspaceRoot) ? directories : [workspaceRoot, ...directories];

  return [...new Set(ordered)];
}

/**
 * Resolve os arquivos de instrução aplicáveis a um diretório de trabalho.
 * Retorna null quando não houver nenhum.
 */
export function resolveProjectInstructions(startPath) {
  const directories = collectAncestorDirectories(startPath);
  const files = [];
  let totalChars = 0;
  let truncated = false;

  for (const directory of directories) {
    if (files.length >= MAX_FILES) { truncated = true; break; }

    for (const filename of INSTRUCTION_FILENAMES) {
      const filePath = path.posix.join(directory, filename);
      const content = readInstructionFile(filePath);
      if (!content) continue;

      if (totalChars + content.length > MAX_TOTAL_CHARS) { truncated = true; break; }

      files.push({ path: filePath, content, chars: content.length });
      totalChars += content.length;
      break; // um arquivo de instrução por diretório
    }
  }

  if (!files.length) return null;
  return { files, totalChars, truncated };
}

/**
 * Monta o bloco de sistema com o projeto ativo e suas instruções.
 *
 * `projectPath`/`projectName` vêm do project tree (projeto ativo no frontend) e
 * têm prioridade sobre `fallbackCwd`, que é apenas o diretório corrente do agente.
 * Retorna null quando não há projeto resolvível nem arquivo de instrução —
 * nesse caso nada é injetado no contexto.
 */
export function buildProjectInstructionsBlock({ projectPath, projectName, fallbackCwd } = {}) {
  const projectRoot = resolveProjectRoot(projectPath);
  const startPath = projectRoot || fallbackCwd || '/';
  const resolved = resolveProjectInstructions(startPath);
  if (!projectRoot && !resolved) return null;

  const header = [];
  if (projectRoot) {
    const name = String(projectName || '').trim() || path.posix.basename(projectRoot);
    const branch = readGitBranch(projectRoot);
    header.push('## Projeto ativo');
    header.push('');
    header.push(`Repositório selecionado no project tree: **${name}**`);
    header.push(`- Caminho: \`${projectRoot}\``);
    if (branch) header.push(`- Branch: \`${branch}\``);
    header.push('');
    header.push('É o projeto sobre o qual o usuário está falando quando não disser outro.');
    header.push('Use esse caminho como raiz para buscas, leituras e comandos.');
  }

  const body = [];
  if (resolved) {
    const sections = resolved.files.map(({ path: filePath, content }) => `### ${filePath}\n\n${content}`);
    body.push('## Instruções do projeto');
    body.push('');
    body.push('São instruções do repositório e valem para o trabalho nele: siga-as como');
    body.push('convenção obrigatória do projeto. Quando dois arquivos conflitarem, o mais');
    body.push('próximo do projeto prevalece (eles aparecem do mais genérico para o mais');
    body.push('específico). Regras de sistema e de segurança continuam acima delas.');
    if (resolved.truncated) body.push('Parte do conteúdo foi omitida por limite de tamanho.');
    body.push('');
    body.push(sections.join('\n\n'));
  }

  const content = [header.join('\n'), body.join('\n')].filter(Boolean).join('\n\n');

  return {
    content,
    projectRoot,
    files: resolved ? resolved.files.map(({ path: filePath, chars }) => ({ path: filePath, chars })) : [],
  };
}

/** Exposto para teste e para invalidação explícita. */
export function clearProjectInstructionsCache() {
  fileCache.clear();
}
