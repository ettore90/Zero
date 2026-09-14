// =============================================================================
// useMessageQueue.ts — fila de mensagens do usuário durante um ciclo do agente
//
// A barra de input não trava mais enquanto o agente trabalha: o que o usuário
// escrever no meio do ciclo entra numa fila, continua editável enquanto espera,
// e é entregue assim que o ciclo termina — nunca no meio dele, onde a mensagem
// competiria com a rodada de tools em andamento.
//
// A fila é por agente: trocar de agente não mistura o que estava pendente.
// As mensagens enfileiradas são unidas numa única entrega para não gerar um
// ciclo por linha digitada; anexos e imagens são concatenados na mesma ordem.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Attachment } from '../types';

export interface QueuedMessage {
  id: string;
  agentId: string;
  text: string;
  images?: string[];
  attachments?: Attachment[];
  createdAt: number;
}

interface UseMessageQueueOptions {
  /** Estado de geração por agente, como exposto por useGenerationControl. */
  runStateByAgent: Record<string, { isGenerating: boolean }>;
  /** Falso enquanto houver modal bloqueante (aprovação de tool, plano). */
  canFlush: () => boolean;
  /** Entrega a mensagem unificada ao ciclo do agente. */
  onFlush: (agentId: string, text: string, images?: string[], attachments?: Attachment[]) => void;
}

const newId = () => `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const useMessageQueue = ({ runStateByAgent, canFlush, onFlush }: UseMessageQueueOptions) => {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);
  const flushingRef = useRef(false);

  const commit = useCallback((next: QueuedMessage[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const enqueue = useCallback((agentId: string, text: string, images?: string[], attachments?: Attachment[]) => {
    const trimmed = String(text ?? '').trim();
    if (!trimmed && !images?.length && !attachments?.length) return null;
    const item: QueuedMessage = { id: newId(), agentId, text: trimmed, images, attachments, createdAt: Date.now() };
    commit([...queueRef.current, item]);
    return item;
  }, [commit]);

  const updateQueued = useCallback((id: string, text: string) => {
    const trimmed = String(text ?? '').trim();
    const current = queueRef.current;
    const target = current.find((item) => item.id === id);
    if (!target) return;
    // Esvaziar o texto de uma mensagem sem anexo é o mesmo que cancelá-la.
    if (!trimmed && !target.images?.length && !target.attachments?.length) {
      commit(current.filter((item) => item.id !== id));
      return;
    }
    commit(current.map((item) => (item.id === id ? { ...item, text: trimmed } : item)));
  }, [commit]);

  const removeQueued = useCallback((id: string) => {
    commit(queueRef.current.filter((item) => item.id !== id));
  }, [commit]);

  const clearQueue = useCallback((agentId?: string) => {
    commit(agentId ? queueRef.current.filter((item) => item.agentId !== agentId) : []);
  }, [commit]);

  useEffect(() => {
    if (flushingRef.current) return;
    const pending = queueRef.current;
    if (pending.length === 0) return;
    if (!canFlush()) return;

    const agentId = pending.find((item) => !runStateByAgent[item.agentId]?.isGenerating)?.agentId;
    if (!agentId) return;

    const items = pending.filter((item) => item.agentId === agentId);
    const rest = pending.filter((item) => item.agentId !== agentId);
    const text = items.map((item) => item.text).filter(Boolean).join('\n\n');
    const images = items.flatMap((item) => item.images ?? []);
    const attachments = items.flatMap((item) => item.attachments ?? []);

    flushingRef.current = true;
    commit(rest);
    try {
      onFlush(agentId, text, images.length ? images : undefined, attachments.length ? attachments : undefined);
    } finally {
      flushingRef.current = false;
    }
  }, [runStateByAgent, queue, canFlush, onFlush, commit]);

  return { queue, enqueue, updateQueued, removeQueued, clearQueue };
};

export default useMessageQueue;
