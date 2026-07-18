import http from 'http';
import { env } from './config/env.js';
import { paths } from './config/paths.js';
import { bootstrapStorage } from './config/bootstrap.js';
import { initDb, closeDb } from './db.js';
import { purgeExpiredSubagentAudits } from './services/subagentAuditService.js';

// ── 1. Ensure storage directories and JSON files exist ──────────────────────
bootstrapStorage();

// ── 2. Initialize SQLite BEFORE any module that calls getDb() is imported ────
//    ESM static imports are hoisted and executed before module-level code,
//    so app.js (and its route chain → runtime.js → sessionStore → getDb())
//    must be loaded dynamically, after initDb() has run.
const DB_PATH = paths.databasePath;
initDb(DB_PATH);
const auditCleanup = purgeExpiredSubagentAudits();
console.log(`[subagent_audit] startup cleanup deleted ${auditCleanup.deleted} expired rows`);

// ── 3. Dynamic import of app — DB is guaranteed to be ready ─────────────────
const { createApp } = await import('./app.js');

const app = createApp();
const server = http.createServer(app);

server.listen(env.PORT, () => {
  console.log(`Server listening on ${env.PORT}`);
});

// ── 4. Graceful shutdown ─────────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
