import { env } from '../config/env.js';

// nomic-embed-text is what the agent-side memory path already uses, so vectors
// written here are comparable with the ones already stored. 768 dimensions.
const EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_DIMENSIONS = 768;
const REQUEST_TIMEOUT_MS = 15000;

// The model's context is ~2048 tokens, and how many characters fit depends on
// the content: prose packs far more per token than code or JSON. Rather than
// guessing one cap, step down until the model accepts the text. Measured:
// an 11956-char note embedded at 6000, while a 7167-char one needed 3000.
const LENGTH_CAPS = [Infinity, 6000, 3000, 1500, 800];

/**
 * Embeds text with the local Ollama model. Returns a 768-float array, or null
 * when the text is empty or every attempt failed — callers store the memory
 * regardless, since a memory without a vector is still better than no memory.
 */
export async function generateEmbedding(text) {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) return null;

  for (const cap of LENGTH_CAPS) {
    const prompt = cap === Infinity ? source : source.slice(0, cap);
    if (!prompt) continue;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(`${env.OLLAMA_SERVER}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: EMBEDDING_MODEL, prompt }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      // A 500 here is normally "the input length exceeds the context length",
      // which the next, smaller cap fixes.
      if (!response.ok) continue;
      const data = await response.json();
      if (Array.isArray(data?.embedding) && data.embedding.length === EMBEDDING_DIMENSIONS) {
        return data.embedding;
      }
    } catch {
      // Aborted, unreachable, or unparseable — try a smaller cap, then give up.
    }
  }
  return null;
}

export { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS };
