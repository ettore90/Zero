// =============================================================================
// useExecutionPlanApproval.ts — aprovação do plano de múltiplas tool calls
// =============================================================================

import { useCallback } from 'react';
import { ToolCall } from '../types';

interface PendingPlan {
  agentId: string;
  toolCalls: ToolCall[];
  signal?: AbortSignal;
  planKey?: string;
  approvalKey?: string;
}

const getPlanKey = (pendingPlan: PendingPlan | null) => String(pendingPlan?.planKey || pendingPlan?.approvalKey || '').trim();

interface UseExecutionPlanApprovalOptions {
  pendingPlan: PendingPlan | null;
  setPendingPlan: (value: PendingPlan | null) => void;
  setIsGenerating: (value: boolean) => void;
  isGeneratingRef: React.MutableRefObject<boolean>;
  processToolCalls: (agentId: string, toolCalls: ToolCall[], signal?: AbortSignal, externalHistory?: any[]) => Promise<void>;
  persistAndSync: () => Promise<void>;
}

export const useExecutionPlanApproval = ({
  pendingPlan,
  setPendingPlan,
  setIsGenerating,
  isGeneratingRef,
  processToolCalls,
  persistAndSync,
}: UseExecutionPlanApprovalOptions) => {
  const handleApprovePlan = useCallback(async (approvedToolCalls: ToolCall[]) => {
    if (!pendingPlan) return;
    const { agentId, signal } = pendingPlan;
    const planKey = getPlanKey(pendingPlan);
    setPendingPlan(null);
    setIsGenerating(true);
    isGeneratingRef.current = true;
    await processToolCalls(agentId, approvedToolCalls, signal);
    await persistAndSync();
    if (isGeneratingRef.current && planKey) {
      setIsGenerating(false);
      isGeneratingRef.current = false;
    }
  }, [pendingPlan, setPendingPlan, setIsGenerating, isGeneratingRef, processToolCalls, persistAndSync]);

  const handleCancelPlan = useCallback(() => {
    setPendingPlan(null);
    setIsGenerating(false);
    isGeneratingRef.current = false;
  }, [setPendingPlan, setIsGenerating, isGeneratingRef]);

  return { handleApprovePlan, handleCancelPlan };
};
