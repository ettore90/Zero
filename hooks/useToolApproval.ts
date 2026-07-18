// =============================================================================
// useToolApproval.ts — aprovação de tool calls sensíveis
// =============================================================================

import { useCallback } from 'react';
import { ToolCall } from '../types';

interface PendingApproval {
  agentId: string;
  toolCalls: ToolCall[];
  sensitiveCalls: ToolCall[];
}

interface UseToolApprovalOptions {
  pendingApproval: PendingApproval | null;
  setPendingApproval: (value: PendingApproval | null) => void;
  setIsGenerating: (value: boolean) => void;
  isGeneratingRef: React.MutableRefObject<boolean>;
  processToolCalls: (agentId: string, toolCalls: ToolCall[], signal?: AbortSignal, externalHistory?: any[]) => Promise<void>;
  persistAndSync: () => Promise<void>;
}

export const useToolApproval = ({
  pendingApproval,
  setPendingApproval,
  setIsGenerating,
  isGeneratingRef,
  processToolCalls,
  persistAndSync,
}: UseToolApprovalOptions) => {
  const handleApproveTool = useCallback(async () => {
    if (!pendingApproval) return;
    const { agentId, toolCalls } = pendingApproval;
    setPendingApproval(null);
    setIsGenerating(true);
    isGeneratingRef.current = true;
    await processToolCalls(agentId, toolCalls);
    await persistAndSync();
    setIsGenerating(false);
    isGeneratingRef.current = false;
  }, [pendingApproval, setPendingApproval, setIsGenerating, isGeneratingRef, processToolCalls, persistAndSync]);

  const handleDenyTool = useCallback(() => {
    setPendingApproval(null);
    setIsGenerating(false);
    isGeneratingRef.current = false;
  }, [setPendingApproval, setIsGenerating, isGeneratingRef]);

  return { handleApproveTool, handleDenyTool };
};
