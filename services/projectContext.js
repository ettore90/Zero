// =============================================================================
// projectContext.js — carrega instruções de projeto (CLAUDE.md / AGENTS.md)
// a partir do diretório de trabalho do agente.
//
// O mesmo arquivo que o Claude Code lê no host é lido aqui: o workspace do host
// está montado dentro do container, então `/uby/<projeto>/CLAUDE.md` é
// literalmente `~/Software/Uby/<projeto>/CLAUDE.md`. Um único arquivo serve os
// dois harnesses; não existe cópia para manter em sincronia.
//
// A busca sobe do cwd até a raiz e monta os arquivos do mais genérico para o
// mais específico, de forma que a instrução mais próxima do cwd venha por
// último e prevaleça em caso de conflito.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';

const INSTRUCTION_FILENAMES = ['CLAUDE.md', 'AGENTS.md'];
const WORKSPACE_ROOT = (typeof env?.CONTAINER_APP_ROOT === 'string' && env.CONTAINER_APP_ROOT.trim()) || '/uby';
const MAX_FILES = 5;
const MAX_FILE_CHARS = 16000;
const MAX_TOTAL_CHARS = 24000;
const MAX_DEPTH = 12;

// path -> { mtimeMs, size, content }. Evita reler o arquivo a cada turno sem
// nunca servir conteúdo velho: mtime e size são revalidados em cada leitura.
const fileCache = new Map();

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
 * Monta o bloco de sistema com as instruções de projeto, ou null quando não houver.
 */
export function buildProjectInstructionsBlock(startPath) {
  const resolved = resolveProjectInstructions(startPath);
  if (!resolved) return null;

  const sections = resolved.files.map(({ path: filePath, content }) => `### ${filePath}\n\n${content}`);

  const content = [
    '## Instruções do projeto',
    '',
    'Arquivos de instrução encontrados a partir do diretório de trabalho atual.',
    'São instruções do repositório e valem para o trabalho nele: siga-as como',
    'convenção obrigatória do projeto. Quando dois arquivos conflitarem, o mais',
    'próximo do diretório de trabalho prevalece (eles aparecem do mais genérico',
    'para o mais específico). Regras de sistema e de segurança continuam acima delas.',
    resolved.truncated ? 'Parte do conteúdo foi omitida por limite de tamanho.' : null,
    '',
    sections.join('\n\n'),
  ].filter((line) => line !== null).join('\n');

  return { content, files: resolved.files.map(({ path: filePath, chars }) => ({ path: filePath, chars })) };
}

/** Exposto para teste e para invalidação explícita. */
export function clearProjectInstructionsCache() {
  fileCache.clear();
}
