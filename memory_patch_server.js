// =============================================================================
// PATCH: Vector Memory Endpoints — server.js
// Substitua os três handlers abaixo no seu server.js
// Busca por: "// --- Vector Memory Endpoints ---"
// =============================================================================

// --- Cosine Similarity (substitui o simpleSimilarity para buscas vetoriais) ---
function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot   += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

// --- Vector Memory Endpoints ---
router.get('/api/memory/list', async (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        // Retorna memories SEM o campo embedding para não pesar na resposta
        const memories = (data.memories || []).map(({ embedding, ...rest }) => rest);
        res.json({ memories });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/memory/add', async (req, res) => {
    try {
        // FIX: incluir 'embedding' que antes era ignorado
        const { content, tags, agentId, embedding } = req.body;
        if (!content) return res.status(400).json({ error: 'Content required' });

        const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        const newMemory = {
            id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            content,
            tags: tags || [],
            timestamp: Date.now(),
            agentId: agentId || null,
            embedding: Array.isArray(embedding) && embedding.length > 0 ? embedding : null
        };
        data.memories.push(newMemory);
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));

        const hasEmbedding = !!newMemory.embedding;
        console.log(`[Memory] Saved: "${content.substring(0, 60)}..." | embedding: ${hasEmbedding ? `${newMemory.embedding.length}d` : 'NONE (keyword-only fallback)'}`);
        res.json({ success: true, id: newMemory.id, hasEmbedding });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/memory/search', async (req, res) => {
    try {
        // FIX: aceita tanto 'embedding' (vetor, vindo do memoryService)
        //      quanto 'query' (string, vindo do MemoryExplorer UI)
        const { embedding, query, limit = 5, threshold = 0.1 } = req.body;

        if (!embedding && !query) {
            return res.status(400).json({ error: 'Either embedding (vector) or query (string) is required' });
        }

        const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        const memories = data.memories || [];

        let results;

        if (Array.isArray(embedding) && embedding.length > 0) {
            // --- Modo Vetor: Cosine Similarity real ---
            const memoriesWithEmbedding = memories.filter(m => Array.isArray(m.embedding) && m.embedding.length > 0);
            const memoriesWithoutEmbedding = memories.filter(m => !Array.isArray(m.embedding) || m.embedding.length === 0);

            const vectorResults = memoriesWithEmbedding
                .map(mem => ({
                    ...mem,
                    embedding: undefined, // não retorna o vetor para o cliente
                    relevance: cosineSimilarity(embedding, mem.embedding)
                }))
                .filter(mem => mem.relevance >= threshold);

            // Fallback keyword para memórias sem embedding (antigas, salvas antes do fix)
            const keywordResults = query
                ? memoriesWithoutEmbedding
                    .map(mem => ({
                        ...mem,
                        embedding: undefined,
                        relevance: simpleSimilarity(query.toLowerCase(), mem.content.toLowerCase())
                    }))
                    .filter(mem => mem.relevance >= 0.05) // threshold mais baixo para keyword
                : [];

            results = [...vectorResults, ...keywordResults]
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, limit);

            console.log(`[Memory] Vector search | threshold: ${threshold} | found: ${vectorResults.length} vector + ${keywordResults.length} keyword fallback → returning ${results.length}`);

        } else {
            // --- Modo Keyword: fallback para o MemoryExplorer UI que manda só string ---
            results = memories
                .map(mem => ({
                    ...mem,
                    embedding: undefined,
                    relevance: simpleSimilarity(query.toLowerCase(), mem.content.toLowerCase())
                }))
                .filter(mem => mem.relevance >= threshold)
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, limit);

            console.log(`[Memory] Keyword search: "${query}" | found: ${results.length}`);
        }

        res.json({ results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/memory/delete', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'ID required' });

        const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        const before = data.memories.length;
        data.memories = data.memories.filter(m => m.id !== id);
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
        console.log(`[Memory] Deleted id: ${id} (was present: ${data.memories.length < before})`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
