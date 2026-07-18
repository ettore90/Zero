// =============================================================================
// modelLoader.ts — Auto-detecção e merge de modelos Ollama
// =============================================================================

import { ModelConfig } from '../types';
import { fetchModels } from '../services/ollamaService';

export const createOllamaModelConfig = (modelId: string, ollamaHost: string): ModelConfig => ({
    id: `auto-ollama-${modelId}`,
    name: modelId,
    provider: 'ollama',
    modelId,
    intent: 'Auto-detected',
    baseUrl: ollamaHost,
});

/**
 * Merge de modelos Ollama detectados com os modelos já salvos.
 * Adiciona modelos novos sem sobrescrever os existentes.
 * Se não houver modelos e Ollama não responder, retorna fallback offline.
 */
export async function mergeOllamaModels(
    existingModels: ModelConfig[],
    ollamaHost: string
): Promise<ModelConfig[]> {
    try {
        const availableModels = await fetchModels(ollamaHost);
        if (availableModels.length > 0) {
            const existingOllamaIds = new Set(
                existingModels
                    .filter((m: ModelConfig) => m.provider === 'ollama')
                    .map((m: ModelConfig) => m.modelId)
            );
            const newModels = [...existingModels];
            availableModels.forEach((modelName: string) => {
                if (!existingOllamaIds.has(modelName)) {
                    newModels.push(createOllamaModelConfig(modelName, ollamaHost));
                }
            });
            return newModels;
        }
    } catch (e) {
        console.warn('Failed to fetch Ollama models:', e);
    }

    // Fallback offline se não há modelos
    if (existingModels.length === 0) {
        return [createOllamaModelConfig('llama3', ollamaHost)];
    }

    return existingModels;
}
