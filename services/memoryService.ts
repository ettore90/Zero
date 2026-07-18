import { NEBULA_API_BASE } from '../constants';
import { MemoryItem } from '../types';

// Helper to generate embedding using Ollama
export const generateEmbedding = async (host: string, prompt: string): Promise<number[]> => {
    try {
        const response = await fetch(`${host}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nomic-embed-text',
                prompt: prompt
            })
        });

        if (!response.ok) {
            throw new Error(`Embedding failed (${response.status}): ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.embedding || !Array.isArray(data.embedding)) {
            throw new Error('Ollama returned invalid embedding format');
        }

        return data.embedding;
    } catch (e) {
        console.error("Embedding generation error:", e);
        throw e;
    }
};

export const addMemory = async (
    host: string,
    content: string,
    tags: string[],
    agentId: string,
    category: 'fact' | 'state' | 'event' | 'behavior' | 'issue' | 'knowledge' | 'design' | 'summary' = 'fact'
): Promise<{ success: boolean; id: string; hasEmbedding: boolean }> => {
    // 1. Gera embedding via Ollama
    let embedding: number[] = [];
    try {
        embedding = await generateEmbedding(host, content);
    } catch (e) {
        console.warn('[MemoryService] Could not generate embedding, saving without vector:', e);
    }

    // 2. Salva no backend
    const response = await fetch(`${NEBULA_API_BASE}/memory/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, tags, embedding, agentId, category })
    });

    if (!response.ok) throw new Error(`Failed to save memory: ${response.statusText}`);
    return await response.json();
};

export const searchMemory = async (
    host: string,
    query: string,
    limit = 5,
    threshold = 0.1
): Promise<MemoryItem[]> => {
    // 1. Tenta gerar embedding para busca vetorial
    let embedding: number[] = [];
    try {
        embedding = await generateEmbedding(host, query);
    } catch (e) {
        // Se falhar, o backend vai usar keyword como fallback
        console.warn('[MemoryService] Embedding failed for search query, will use keyword fallback:', e);
    }

    // 2. Envia AMBOS: embedding (vetor) e query (string)
    //    O backend usa cosine similarity se tiver embedding, keyword se não tiver
    //    FIX: antes mandava só { embedding, limit } — o backend esperava { query }
    const response = await fetch(`${NEBULA_API_BASE}/memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding, query, limit, threshold })
    });

    if (!response.ok) {
        const err = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to search memory: ${err}`);
    }

    const data = await response.json();
    return data.results ?? [];
};

export const listMemories = async (): Promise<MemoryItem[]> => {
    const response = await fetch(`${NEBULA_API_BASE}/memory/list`, {
        method: 'GET'
    });

    if (!response.ok) throw new Error('Failed to list memories');
    const data = await response.json();
    return data.memories ?? [];
};

export const deleteMemory = async (id: string): Promise<void> => {
    const response = await fetch(`${NEBULA_API_BASE}/memory/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
    });

    if (!response.ok) throw new Error('Failed to delete memory');
};