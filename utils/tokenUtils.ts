/**
 * Token counting utilities for payload management
 * Note: These are estimations. For accurate counts, use model-specific tokenizers.
 */

/**
 * Estimates number of tokens in a string using a simple heuristic.
 * Roughly 4 characters per token for English text.
 * For more accurate results, integrate with a tokenizer library.
 */
export function estimateTokenCount(text: string): number {
    if (!text) return 0;
    // Simple approximation: 1 token ≈ 4 characters for English
    // This is a conservative estimate that works reasonably well for most LLMs
    return Math.ceil(text.length / 4);
}

/**
 * Calculate total tokens in a list of messages (excluding system prompt).
 * Includes role tokens and content tokens.
 */
export function calculateMessageTokens(messages: Array<{ role: string; content: string }>): number {
    let total = 0;
    for (const msg of messages) {
        // Role token overhead (~4 tokens for role)
        total += 4;
        total += estimateTokenCount(msg.content);
    }
    return total;
}

/**
 * Truncate message history to fit within maxTokens limit.
 * Removes oldest messages (excluding system prompt) until under limit.
 * Returns the truncated history and number of tokens removed.
 */
export function truncateHistoryToTokenLimit<T extends { role: string; content: string }>(
    messages: T[],
    maxTokens: number,
    systemPrompt: string = ''
): { truncated: T[]; removedCount: number; totalTokens: number } {
    if (maxTokens <= 0) {
        return { truncated: messages, removedCount: 0, totalTokens: calculateMessageTokens(messages) };
    }

    // Start with all messages
    let truncated = [...messages];
    let totalTokens = calculateMessageTokens(truncated);

    // Reserve tokens for system prompt and future response (~1000 tokens)
    const systemTokens = estimateTokenCount(systemPrompt);
    const safetyMargin = 1000;
    const availableForHistory = maxTokens - systemTokens - safetyMargin;

    // If total is already under limit, return as-is
    if (totalTokens <= availableForHistory) {
        return { truncated, removedCount: 0, totalTokens };
    }

    // Remove oldest messages (from the beginning, excluding system if present)
    // We assume system message is first if it exists
    let startIndex = 0;
    if (truncated.length > 0 && truncated[0].role === 'system') {
        startIndex = 1; // Keep system message
    }

    // Remove messages from the start (oldest) until under limit
    while (totalTokens > availableForHistory && truncated.length > startIndex + 1) {
        // Remove the second message (after system), keeping system and most recent
        truncated.splice(startIndex, 1);
        totalTokens = calculateMessageTokens(truncated);
    }

    // If still over limit after removing all but system and latest, we must truncate content
    if (totalTokens > availableForHistory && truncated.length > 0) {
        // Last resort: truncate the content of the oldest remaining message
        const msg = truncated[startIndex];
        const excess = totalTokens - availableForHistory;
        if (excess > 0) {
            // Remove approximately excess tokens from content
            const charsToRemove = excess * 4;
            msg.content = msg.content.slice(charsToRemove).trim();
            totalTokens = calculateMessageTokens(truncated);
        }
    }

    const removedCount = messages.length - truncated.length;
    return { truncated, removedCount, totalTokens };
}

/**
 * Get recommended max tokens based on model capabilities.
 * Returns a sensible default or user-configured value.
 */
export function getRecommendedMaxTokens(modelId?: string, configuredMax?: number): number {
    if (configuredMax && configuredMax > 0) {
        return configuredMax;
    }

    // Model-specific defaults (context window sizes)
    const modelDefaults: Record<string, number> = {
        'gpt-4': 8192,
        'gpt-4-turbo': 128000,
        'gpt-3.5-turbo': 4096,
        'claude-3-opus': 200000,
        'claude-3-sonnet': 200000,
        'claude-3-haiku': 200000,
        'llama3': 4096,
        'llama3:70b': 4096,
        'mistral': 8192,
        'gemini-pro': 32768,
        'gemini-1.5-pro': 1000000,
        'stepfun/step-3.5-flash': 32000,
        'stepfun/step-3.5-turbo': 32000,
        'stepfun/step-3.5-v': 32000
    };

    if (modelId) {
        const direct = modelDefaults[modelId];
        if (direct) return direct;
        // Partial match
        for (const [key, value] of Object.entries(modelDefaults)) {
            if (modelId.includes(key)) return value;
        }
    }

    // Safe default
    return 4096;
}