import { Agent, ModelConfig, LogEntry, AppConfig } from '../types';
import { executeChatRequest } from './llmProvider';
import { generateId, extractJson } from '../utils/helpers';
import { APP_BASE_PATH } from '../constants';
import * as MemoryService from './memoryService';

export const findAgent = (identifier: string, agents: Agent[]): Agent | undefined => {
    const id = identifier.toLowerCase();
    return agents.find(a => a.id === id || a.name.toLowerCase() === id);
};


export const createAgentFromGuidelines = async (
    intent: string,
    context: string,
    appConfig: AppConfig,
    log: (entry: LogEntry) => void
): Promise<Agent> => {
    const model = appConfig.modelConfigs[0];
    const prompt = `You are an Agent Architect. Create a new AI Agent profile for this specific task: "${intent}".\n    \n    Additional Context: \n    ${context}\n    \n    Return strictly JSON:\n    {\n      "name": "Short Name",\n      "systemPrompt": "Detailed system instructions defining role, tone, and capabilities."\n    }`;

    let responseText = "";
    await executeChatRequest(
        [{ role: 'user', content: prompt }],
        model,
        appConfig.modelConfigs,
        (chunk) => responseText += chunk,
        (entry) => log(entry)
    );

    try {
        const json = extractJson(responseText);
        const newId = generateId();
        const defaultSessionId = generateId();
        return {
            id: newId,
            name: json.name || "New Agent",
            model: model.modelId,
            systemPrompt: json.systemPrompt || "You are a helpful assistant.",
            summary: "",
            history: [],
            sessions: [{
                id: defaultSessionId,
                title: 'New Session',
                history: [],
                summary: '',
                lastModified: Date.now()
            }],
            activeSessionId: defaultSessionId,
            color: 'bg-indigo-500'
        };
    } catch (e) {
        const newId = generateId();
        const defaultSessionId = generateId();
        return {
            id: newId,
            name: "Auto Agent",
            model: model.modelId,
            systemPrompt: responseText || "You are a helpful assistant.",
            summary: "",
            history: [],
            sessions: [{
                id: defaultSessionId,
                title: 'New Session',
                history: [],
                summary: '',
                lastModified: Date.now()
            }],
            activeSessionId: defaultSessionId,
            color: 'bg-indigo-500'
        };
    }
};

export const summarizeContext = async (
    agent: Agent,
    models: ModelConfig[],
    log: (entry: LogEntry) => void,
    ollamaHost: string = 'http://localhost:11434',
    serverAvailable: boolean = false,
    username: string = 'default'
): Promise<string> => {
    if (agent.history.length === 0) return agent.summary;

    // 1. Filtrar histórico — remover mensagens vazias, tool_calls puros, role:system
    const relevantHistory = agent.history.filter(m => {
        if (m.role === 'system') return false;
        if (!m.content || m.content.trim() === '') return false;
        if (m.role === 'tool') return false; // tool results são ruído para summarização
        return true;
    });

    if (relevantHistory.length === 0) return agent.summary;

    const historyText = relevantHistory
        .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
        .join('\n');

    // Resolver modelo do agente — mesmo modelo usado nas conversas dele
    const model = models.find(m => m.modelId === agent.model && m.provider === (agent as any).provider)
        || models.find(m => m.modelId === agent.model)
        || models[0];
    console.log(`[Summarize] Using model: ${model?.modelId} (agent: ${agent.name})`);

    // 2. Prompt principal — summary narrativo
    const summaryPrompt = `You are summarizing a conversation to preserve long-term context for an AI agent named "${agent.name}".

Current summary (may be empty): ${agent.summary || 'none'}

Recent conversation:
${historyText}

Write a concise summary (3-6 sentences) covering: what was accomplished, key decisions made, and any pending tasks. Output only the summary text.`;

    // 3. Prompt de extração de memórias estruturadas
    const memoryPrompt = `You are extracting structured memories from a conversation for an AI agent named "${agent.name}".

Conversation:
${historyText}

Extract up to 8 important facts, states, events, behaviors, issues, knowledge items, or design-intent items from this conversation.
Respond ONLY with a JSON array (no markdown, no backticks):
[
  { "content": "...", "category": "fact|state|event|behavior|issue|knowledge|design", "tags": ["tag1", "tag2"] },
  ...
]

Categories:
- fact: objective stable information
- state: current status of something mutable  
- event: something that happened at a point in time
- behavior: user preference or pattern
- issue: problem or limitation observed
- knowledge: structural understanding of a system or codebase
- design: solution design, architecture, or implementation intent`;

    let summary = '';
    let extractedMemories: { content: string; category: string; tags: string[] }[] = [];

    // 4. Executar os dois prompts — via /api/llm/complete (sem broadcast) ou llmProvider
    if (serverAvailable) {
        try {
            const LOCAL_BASE = APP_BASE_PATH;
            const call = (prompt: string) => fetch(`${LOCAL_BASE}/api/llm/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, agentId: agent.id, prompt }),
            }).then(r => r.json()).then(d => d.content || '');

            [summary, ] = await Promise.all([
                call(summaryPrompt),
                call(memoryPrompt).then(raw => {
                    try {
                        const clean = raw.replace(/```json|```/g, '').trim();
                        extractedMemories = JSON.parse(clean);
                    } catch { extractedMemories = []; }
                }),
            ]);
        } catch (e) {
            console.warn('[Summarize] Server path failed, falling back to llmProvider', e);
            serverAvailable = false;
        }
    }

    if (!serverAvailable) {
        // Fallback: llmProvider client-side (sequencial)
        await executeChatRequest(
            [{ role: 'user', content: summaryPrompt }],
            model, models,
            (chunk) => summary += chunk,
            (entry) => log(entry)
        );
        let memRaw = '';
        await executeChatRequest(
            [{ role: 'user', content: memoryPrompt }],
            model, models,
            (chunk) => memRaw += chunk,
            (entry) => log(entry)
        );
        try {
            const clean = memRaw.replace(/```json|```/g, '').trim();
            extractedMemories = JSON.parse(clean);
        } catch { extractedMemories = []; }
    }

    // 5. Persistir memórias extraídas categorizadas
    const validCategories = ['fact', 'state', 'event', 'behavior', 'issue', 'knowledge', 'design'];
    const savePromises = extractedMemories
        .filter(m => m.content && m.content.trim().length > 10)
        .map(m => {
            const category = validCategories.includes(m.category)
                ? m.category as 'fact' | 'state' | 'event' | 'behavior' | 'issue' | 'knowledge' | 'design'
                : 'fact';
            const tags = [...(m.tags || []), 'summarized', agent.name.toLowerCase().replace(/\s+/g, '-')];
            return MemoryService.addMemory(ollamaHost, m.content, tags, agent.id, category)
                .catch(e => console.warn('[Summarize] Failed to save memory:', e));
        });

    await Promise.allSettled(savePromises);
    console.log(`[Summarize] Saved ${savePromises.length} memories from context of agent "${agent.name}"`);

    return summary.trim();
};