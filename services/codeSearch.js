// =============================================================================
// codeSearch.js — busca por CONTEÚDO de arquivo (o equivalente a ripgrep).
//
// Implementado em Node em vez de delegar para `grep`: o shell do container é
// BusyBox, cujo grep não tem --include nem --exclude-dir, e a varredura própria
// dá controle sobre exclusões, arquivos binários, limites e formato de saída.
// =============================================================================

import fs from 'fs';
import path from 'path';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage',
  'vendor', '__pycache__', '.venv', 'venv', '.cache', '.turbo', 'target',
  '.gradle', '.idea', '.pytest_cache', 'worktrees',
]);
const SKIP_FILE = /\.(min\.js|map|lock|png|jpe?g|gif|webp|ico|svgz|pdf|zip|gz|tar|bz2|7z|rar|mp4|mov|mp3|wav|woff2?|ttf|eot|so|dylib|dll|exe|bin|class|pyc|wasm)$/i;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES_SCANNED = 6000;
const MAX_LINE_CHARS = 400;

function globToRegex(glob) {
  const expanded = String(glob).replace(/\{([^}]*)\}/g, (_, inner) => `(${inner.split(',').map((part) => part.trim()).join('|')})`);
  const source = expanded
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\|/g, '|')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${source}$`, 'i');
}

export function searchCode(options = {}) {
  const rawPattern = typeof options.pattern === 'string' ? options.pattern : '';
  if (!rawPattern.trim()) return { error: 'search_code requires a non-empty pattern' };

  const basePath = path.posix.resolve(String(options.path || '/').replace(/\\/g, '/'));
  const literal = options.literal === true;
  const caseSensitive = options.case_sensitive === true;
  const filesOnly = options.files_only === true;
  const contextLines = Math.max(0, Math.min(Number(options.context) || 0, 4));
  const maxResults = Math.max(1, Math.min(Number(options.max_results) || 80, 300));
  const maxDepth = Math.max(1, Math.min(Number(options.max_depth) || 12, 20));

  let regex;
  try {
    const source = literal ? rawPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : rawPattern;
    regex = new RegExp(source, caseSensitive ? 'g' : 'gi');
  } catch (err) {
    return { error: `Invalid pattern: ${err.message}` };
  }

  let globRegex = null;
  if (typeof options.glob === 'string' && options.glob.trim()) {
    try { globRegex = globToRegex(options.glob.trim()); }
    catch (err) { return { error: `Invalid glob: ${err.message}` }; }
  }

  const extraExcludes = (Array.isArray(options.exclude) ? options.exclude : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const isExcluded = (name) => extraExcludes.some((pattern) => name === pattern || name.includes(pattern));

  let baseStat;
  try { baseStat = fs.statSync(basePath); }
  catch { return { error: `Path not found: ${basePath}` }; }

  const matches = [];
  const fileHits = [];
  let filesScanned = 0;
  let truncated = false;
  let scanLimitReached = false;

  const scanFile = (filePath) => {
    let content;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return;
      const buffer = fs.readFileSync(filePath);
      if (buffer.includes(0)) return; // binário
      content = buffer.toString('utf8');
    } catch { return; }

    filesScanned += 1;
    const lines = content.split('\n');
    let hitsInFile = 0;

    for (let i = 0; i < lines.length; i += 1) {
      regex.lastIndex = 0;
      if (!regex.test(lines[i])) continue;
      hitsInFile += 1;
      if (filesOnly) continue;
      if (matches.length >= maxResults) { truncated = true; break; }
      const entry = { file: filePath, line: i + 1, text: lines[i].slice(0, MAX_LINE_CHARS) };
      if (contextLines > 0) {
        entry.before = lines.slice(Math.max(0, i - contextLines), i).map((line) => line.slice(0, MAX_LINE_CHARS));
        entry.after = lines.slice(i + 1, i + 1 + contextLines).map((line) => line.slice(0, MAX_LINE_CHARS));
      }
      matches.push(entry);
    }

    if (hitsInFile > 0) fileHits.push({ file: filePath, hits: hitsInFile });
  };

  const walk = (dir, depth) => {
    if (depth > maxDepth || scanLimitReached) return;
    if (!filesOnly && matches.length >= maxResults) { truncated = true; return; }

    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const dirent of entries) {
      if (scanLimitReached) return;
      if (!filesOnly && matches.length >= maxResults) { truncated = true; return; }
      const name = dirent.name;
      if (isExcluded(name)) continue;
      const full = path.posix.join(dir, name);

      if (dirent.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        walk(full, depth + 1);
      } else if (dirent.isFile()) {
        if (SKIP_FILE.test(name)) continue;
        if (globRegex && !globRegex.test(name)) continue;
        if (filesScanned >= MAX_FILES_SCANNED) { scanLimitReached = true; truncated = true; return; }
        scanFile(full);
      }
    }
  };

  if (baseStat.isFile()) scanFile(basePath);
  else walk(basePath, 1);

  fileHits.sort((left, right) => right.hits - left.hits || left.file.localeCompare(right.file));

  const summary = {
    pattern: rawPattern,
    path: basePath,
    filesScanned,
    filesMatched: fileHits.length,
    truncated,
  };
  if (truncated) summary.hint = 'Result truncated. Narrow with glob/path, or use files_only:true to map first.';

  return filesOnly
    ? { ...summary, files: fileHits.slice(0, maxResults) }
    : { ...summary, matchCount: matches.length, matches };
}
