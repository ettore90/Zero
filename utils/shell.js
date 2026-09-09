import fs from 'fs';

// Absolute path to the shell every server-side command execution runs under.
// Single source of truth: services/llmService.js, routes/system.routes.js and
// routes/git.routes.js all pass this as child_process' `shell` option. It used
// to be a module-local const in llmService.js, which left it undefined in both
// route files at runtime.
export const BASH_BIN = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
