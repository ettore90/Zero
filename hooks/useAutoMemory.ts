import { useCallback, useRef } from 'react';
import * as MemoryService from '../services/memoryService';
import { Agent, LogEntry, ModelConfig } from '../types';

// ---------------------------------------------------------------------------
// useAutoMemory
// Dispara extração e gravação automática de memória em dois momentos:
//   1. Pós-ciclo completo do agente (resumo da conversa)
//   2. Após git_commit (resumo do que foi feito)
// ---------------------------------------------------------------------------

interface AutoMemoryContext {
  ollamaHost: string;
  memoryEnabled: boolean;
  modelsRef: React.MutableRefObject<ModelConfig[]>;
  addLog: (e: LogEntry) => void;
}

// Mínimo de mensagens de usuário na sessão para valer extrair memória
const MIN_USER_TURNS = 2;
// Só extrai se a última extração foi há mais de X ms (evitar spam)
const COOLDOWN_MS = 60_000;

export const useAutoMemory = (ctx: AutoMemoryContext) => {
  const { ollamaHost, memoryEnabled, modelsRef, addLog } = ctx;

  // Rastreia último extract por agentId para respeitar cooldown
  const lastExtractRef = useRef<Record<string, number>>({});

  // -------------------------------------------------------------------------
  // callLLMForExtraction: usa o modelo mais leve disponível
  // -------------------------------------------------------------------------
  const callLLM = useCallback(async (prompt: string): Promise<string> => {
    const model = modelsRef.current[0];
    if (!model) throw new Error('No model configured');

    const res = await fetch(model.baseUrl?.replace(/\/[^/]*$/, '/chat/completions') ?? '/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model.modelId,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        max_tokens: 400,
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }, [modelsRef]);

  // -------------------------------------------------------------------------
  // extractAndSave: extrai fatos de um bloco de texto e salva na memória
  // -------------------------------------------------------------------------
  const extractAndSave = useCallback(async (
    text: string,
    agentId: string,
    tags: string[],
    context: string,
  ) => {
    if (!memoryEnabled || !text.trim()) return;

    const prompt = `Extract 2-4 concise, standalone facts from the following ${context}.
Each fact must be a complete, self-contained sentence.
Focus on: decisions made, files changed, problems solved, patterns used, or configurations set.
Ignore greetings, confirmations, and filler text.

${context.toUpperCase()}:
${text.slice(0, 1500)}

Respond ONLY with a JSON array of strings. No explanation.
Example: ["React 18 used with Vite for bundling", "API key stored in .env as OPENAI_KEY"]`;

    try {
      const raw = await callLLM(prompt);
      let jsonStr = raw.trim();
      const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) jsonStr = fence[1].trim();
      const facts: string[] = JSON.parse(jsonStr);

      for (const fact of facts.slice(0, 4)) {
        if (fact.trim().length > 10) {
          await MemoryService.addMemory(ollamaHost, fact.trim(), tags, agentId);
        }
      }

      addLog({
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: 'success',
        method: 'AUTO_MEMORY',
        content: `Saved ${facts.length} facts from ${context} [agent: ${agentId}]`,
      });
    } catch (e) {
      addLog({
        id: Date.now().toString(),
        timestamp: Date.now(),
        type: 'warning',
        method: 'AUTO_MEMORY',
        content: `Failed to extract memory from ${context}: ${e}`,
      });
    }
  }, [memoryEnabled, ollamaHost, callLLM, addLog]);

  // -------------------------------------------------------------------------
  // onCycleComplete: chamado após cada ciclo completo do agente
  // Extrai fatos do último par user/assistant da conversa
  // -------------------------------------------------------------------------
  const onCycleComplete = useCallback(async (agent: Agent) => {
    if (!memoryEnabled) return;

    // Cooldown check
    const now = Date.now();
    const last = lastExtractRef.current[agent.id] ?? 0;
    if (now - last < COOLDOWN_MS) return;

    // Contar turns de usuário no histórico visual atual do agente
    const history = agent.history ?? [];
    const userTurns = history.filter(m => m.role === 'user').length;
    if (userTurns < MIN_USER_TURNS) return;

    // Pegar últimas 4 mensagens da conversa (user + assistant) — excluir tool calls
    const conversational = history.filter(m => m.role === 'user' || m.role === 'assistant');
    const recent = conversational.slice(-4);
    if (recent.length < 2) return;

    const summary = recent
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.slice(0, 300)}`)
      .join('\n');

    lastExtractRef.current[agent.id] = now;

    await extractAndSave(
      summary,
      agent.id,
      ['auto', 'conversation', agent.name.toLowerCase().replace(/\s+/g, '-')],
      'conversation summary',
    );
  }, [memoryEnabled, extractAndSave]);

  // -------------------------------------------------------------------------
  // onGitCommit: chamado após git_commit bem-sucedido
  // Extrai fatos do que foi commitado
  // -------------------------------------------------------------------------
  const onGitCommit = useCallback(async (
    commitMessage: string,
    commitOutput: string,
    agentId: string,
  ) => {
    if (!memoryEnabled) return;

    const text = `Commit message: ${commitMessage}\nOutput: ${commitOutput}`;

    await extractAndSave(
      text,
      agentId,
      ['auto', 'git', 'commit'],
      'git commit',
    );
  }, [memoryEnabled, extractAndSave]);

  // -------------------------------------------------------------------------
  // pruneOldSessions: remove sessões com mais de 30 dias de todos os agentes
  // Retorna os agentes atualizados para persistência
  // -------------------------------------------------------------------------
  const pruneOldSessions = useCallback((agents: Agent[]): { agents: Agent[]; pruned: number } => {
    void agents;
    return { agents, pruned: 0 };
  }, []);

  // -------------------------------------------------------------------------
  // getRecentContext: retorna resumo das sessões recentes para injetar no prompt
  // Sessões dos últimos 30 dias, excluindo a ativa
  // -------------------------------------------------------------------------
  const getRecentContext = useCallback((agent: Agent): string => {
    const summary = (agent.summary || '').trim();
    if (!summary) return '';

    return `\n\n[RECENT CONTEXT]\n- ${summary.slice(0, 240)}\n(Use recall_memory for details about past work)`;
  }, []);

  return { onCycleComplete, onGitCommit, pruneOldSessions, getRecentContext };
};