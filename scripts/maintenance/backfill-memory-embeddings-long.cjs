// Rows nomic-embed-text rejects for exceeding its context. The cap that fits
// depends on token density (code and JSON tokenize far worse than prose), so
// step down until one is accepted rather than guessing a single number.
const Database = require('/app/node_modules/better-sqlite3');
const db = new Database('/app/storage/zero.db');
db.pragma('busy_timeout = 30000');
const CAPS = [6000, 3000, 1500, 800];
const rows = db.prepare(
  `SELECT id, content, LENGTH(content) len FROM memories
    WHERE category IN ('knowledge','design','issue','behavior','fact')
      AND (embedding IS NULL OR embedding = '')
      AND content IS NOT NULL AND content != ''`
).all();
const update = db.prepare('UPDATE memories SET embedding = ? WHERE id = ?');
(async () => {
  for (const r of rows) {
    let done = false;
    for (const cap of CAPS) {
      try {
        const res = await fetch(`${process.env.OLLAMA_SERVER}/api/embeddings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'nomic-embed-text', prompt: r.content.slice(0, cap) }),
        });
        if (!res.ok) continue;
        const { embedding } = await res.json();
        if (!Array.isArray(embedding) || embedding.length !== 768) continue;
        update.run(JSON.stringify(embedding), r.id);
        console.log(`ok  ${r.id}  ${r.len} chars -> embedou com cap ${cap}`);
        done = true;
        break;
      } catch { /* try a smaller cap */ }
    }
    if (!done) console.log(`FALHA ${r.id} (${r.len} chars) em todos os caps`);
  }
  db.close();
})();
