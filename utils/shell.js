import fs from 'fs';

// Absolute path to the shell every server-side command execution runs under.
// Single source of truth: services/llmService.js, routes/system.routes.js and
// routes/git.routes.js all pass this as child_process' `shell` option. It used
// to be a module-local const in llmService.js, which left it undefined in both
// route files at runtime.
export const BASH_BIN = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';

// Returns the first candidate that exists and is a directory, or null.
// Spawning with a nonexistent cwd fails as `spawn <shell> ENOENT`, which names
// the shell but actually means the directory — so every exec path resolves its
// cwd through this before handing it to child_process.
export function firstExistingDir(...candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.statSync(String(candidate)).isDirectory()) return String(candidate);
    } catch {
      /* not there, try the next one */
    }
  }
  return null;
}
