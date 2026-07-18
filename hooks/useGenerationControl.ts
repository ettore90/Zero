// =============================================================================
// useGenerationControl.ts — controle de geração/abort/stop por agente
// =============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import * as ServerChat from '../services/serverChatService';

interface UseGenerationControlOptions {
  username: string;
  addNotification: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  setPendingApproval: (value: any) => void;
}

type RunState = {
  isGenerating: boolean;
  abortController: AbortController | null;
  sessionId?: string | null;
};

export const useGenerationControl = ({ username, addNotification, setPendingApproval }: UseGenerationControlOptions) => {
  const [runStateByAgent, setRunStateByAgent] = useState<Record<string, RunState>>({});
  const runStateByAgentRef = useRef<Record<string, RunState>>({});
  const isGeneratingRef = useRef(false);

  const syncRefs = useCallback((next: Record<string, RunState>) => {
    runStateByAgentRef.current = next;
    isGeneratingRef.current = Object.values(next).some((state) => state.isGenerating);
  }, []);

  const setAgentGenerating = useCallback((agentId: string, isGenerating: boolean, abortController: AbortController | null = null, sessionId: string | null = null) => {
    setRunStateByAgent((prev) => {
      const next = {
        ...prev,
        [agentId]: {
          isGenerating,
          abortController: isGenerating ? abortController : null,
          sessionId: isGenerating ? sessionId : null,
        },
      };
      syncRefs(next);
      return next;
    });
  }, [syncRefs]);

  const isAgentGenerating = useCallback((agentId: string) => {
    return !!runStateByAgentRef.current[agentId]?.isGenerating;
  }, []);

  const handleStop = useCallback(async (agentId: string, sessionId: string) => {
    if (!agentId || !sessionId) return;

    const current = runStateByAgentRef.current[agentId];
    if (!current?.isGenerating || current.sessionId !== sessionId) return;

    const targetAgentId = agentId;
    if (current?.abortController) {
      current.abortController.abort();
    }

    try {
      if (username) {
        await ServerChat.stopAgentRun(username, targetAgentId, sessionId);
      }

      setRunStateByAgent((prev) => {
        const next = {
          ...prev,
          [targetAgentId]: {
            isGenerating: false,
            abortController: null,
            sessionId: null,
          },
        };
        syncRefs(next);
        return next;
      });

      setPendingApproval(null);
      addNotification('System', 'Process stopped by user.', 'warning');
    } catch (error: any) {
      setRunStateByAgent((prev) => {
        const next = {
          ...prev,
          [targetAgentId]: {
            isGenerating: true,
            abortController: null,
            sessionId: null,
          },
        };
        syncRefs(next);
        return next;
      });
      addNotification('System', error?.message || 'Failed to stop agent run on server.', 'error');
    }
  }, [addNotification, setPendingApproval, syncRefs, username]);

  useEffect(() => {
    return () => {
      for (const state of Object.values(runStateByAgentRef.current)) {
        if (state?.abortController) state.abortController.abort();
      }
    };
  }, []);

  return {
    runStateByAgent,
    runStateByAgentRef,
    isGenerating: Object.values(runStateByAgent).some((state) => state.isGenerating),
    isGeneratingRef,
    setAgentGenerating,
    isAgentGenerating,
    handleStop,
  };
};
