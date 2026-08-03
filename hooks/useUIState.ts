// =============================================================================
// useUIState.ts — estado de UI do App (painéis, modais, viewMode)
// =============================================================================

import { useState } from 'react';
import { Agent, ToolCall } from '../types';
import { DryRunPayload } from '../components/DryRunModal';


export type StrategyPlanTrackingStatus = 'open' | 'in_progress' | 'completed' | 'canceled';

export interface StrategyPlanTrackingItem {
  id: string;
  agentId: string;
  requestId?: string;
  planKey?: string;
  approvalKey?: string;
  source: 'strategyPlanTracking';
  status: StrategyPlanTrackingStatus;
  plan: { title?: string; objective?: string; approach?: string; risks?: string; checklist?: any[] | string[] };
  createdAt: string;
  updatedAt: string;
  onApprove?: (revisedPlan?: any) => void;
  onReject?: () => void;
  onCommentItem?: (itemId: string | undefined, itemText: string | undefined, text: string) => Promise<void> | void;
  onCompleteItem?: (itemId: string | undefined, itemText: string | undefined, done?: boolean) => Promise<void> | void;
}


export const useUIState = () => {
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(false);
  const [isOrchestrationPanelOpen, setIsOrchestrationPanelOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSessionPanelOpen, setIsSessionPanelOpen] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [viewMode, setViewMode] = useState<'chat' | 'automation' | 'commands' | 'dashboard' | 'memory'>('chat');
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [showAgentManager, setShowAgentManager] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showScheduler, setShowScheduler] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | undefined>(undefined);
  const [showConsole, setShowConsole] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);

  const [pendingPlan, setPendingPlan] = useState<{ agentId: string; toolCalls: any[]; signal?: AbortSignal } | null>(null);
  const [pendingStrategyPlan, setPendingStrategyPlan] = useState<{
    agentId: string;
    requestId?: string;
    planKey?: string;
  approvalKey?: string;
    plan: { title?: string; objective?: string; approach?: string; risks?: string; checklist?: any[] | string[] };
    signal?: AbortSignal;
    onApprove: (revisedPlan?: { title?: string; objective?: string; approach?: string; risks?: string; checklist?: any[] | string[] }) => void;
    onReject: () => void;
    onCommentItem?: (itemId: string | undefined, itemText: string | undefined, text: string) => Promise<void> | void;
    onCompleteItem?: (itemId: string | undefined, itemText: string | undefined, done?: boolean) => Promise<void> | void;
  } | null>(null);
  const [pendingDryRun, setPendingDryRun] = useState<{ payload: DryRunPayload; resolve: (v: boolean) => void } | null>(null);
  const [strategyPlanItems, setStrategyPlanItems] = useState<StrategyPlanTrackingItem[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{ agentId: string; toolCalls: ToolCall[]; sensitiveCalls: ToolCall[] } | null>(null);

  return {
    isProjectPanelOpen, setIsProjectPanelOpen,
    isOrchestrationPanelOpen, setIsOrchestrationPanelOpen,
    isSidebarOpen, setIsSidebarOpen,
    isSessionPanelOpen, setIsSessionPanelOpen,
    isChatVisible, setIsChatVisible,
    viewMode, setViewMode,
    editingWorkflowId, setEditingWorkflowId,
    showAgentManager, setShowAgentManager,
    showSettings, setShowSettings,
    showScheduler, setShowScheduler,
    editingAgent, setEditingAgent,
    showConsole, setShowConsole,
    showTerminal, setShowTerminal,
    pendingPlan, setPendingPlan,
    pendingStrategyPlan, setPendingStrategyPlan,
    strategyPlanItems, setStrategyPlanItems,
    pendingDryRun, setPendingDryRun,
    pendingApproval, setPendingApproval,
  };
};
