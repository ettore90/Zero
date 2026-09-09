// Backfill embeddings for semantically meaningful memories that have none.
// Skips 'event' and 'state' (operational log, not recallable knowledge).
// Idempotent: only touches rows whose embedding is NULL or ''.
const Database = require('/app/node_modules/better-sqlite3');

const DB = '/app/storage/zero.db';
const OLLAMA = process.env.OLLAMA_SERVER || 'http://ollama:11434';
const MODEL = 'nomic-embed-text';               // matches sqliteMemoryTools.js
const CATEGORIES = ['knowledge', 'design', 'issue', 'behavior', 'fact'];
const DRY = process.argv.includes('--dry-run');

const db = new Database(DB);
db.pragma('busy_timeout = 30000');

const placeholders = CATEGORIES.map(() => '?').join(',');
const rows = db.prepare(
  `SELECT id, content FROM memories
    WHERE category IN (${placeholders})
      AND (embedding IS NULL OR embedding = '')
      AND content IS NOT NULL AND content != ''
    ORDER BY created_at`
).all(...CATEGORIES);

console.log(`alvo: ${rows.length} linhas${DRY ? ' (DRY RUN)' : ''}`);

const update = db.prepare('UPDATE memories SET embedding = ? WHERE id = ?');

async function embed(text) {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data?.embedding) || data.embedding.length === 0) throw new Error('sem vetor');
  return data.embedding;
}

(async () => {
  let ok = 0, fail = 0;
  const failures = [];
  const t0 = Date.now();
  for (const [i, row] of rows.entries()) {
    try {
      const vec = await embed(row.content);
      if (vec.length !== 768) throw new Error(`dim ${vec.length}`);
      if (!DRY) update.run(JSON.stringify(vec), row.id);
      ok++;
    } catch (e) {
      fail++;
      failures.push(`${row.id}: ${e.message}`);
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${rows.length} (ok ${ok}, falha ${fail})`);
  }
  console.log(`\nconcluido em ${((Date.now() - t0) / 1000).toFixed(1)}s — ok ${ok}, falha ${fail}`);
  if (failures.length) console.log('falhas:\n' + failures.slice(0, 10).join('\n'));
  db.close();
})();
