// =============================================================================
// AppRouter.tsx — Renderização condicional das views principais do App
// =============================================================================

import React from 'react';
import ChatInterface from '../ChatInterface';
import WorkflowEditor from '../WorkflowEditor';
import WorkflowListView from './WorkflowListView';
import CommandLibrary from '../CommandLibrary';
import ModelDashboard from '../ModelDashboard';
import MemoryExplorer from '../MemoryExplorer';
import { Agent, Workflow, Project } from '../../types';

interface AppRouterProps {
  viewMode: 'chat' | 'automation' | 'commands' | 'dashboard' | 'memory';
  isChatVisible: boolean;
  activeAgent: Agent;
  activeAgentId: string;
  agents: Agent[];
  editingWorkflowId: string | null;
  workflows: Workflow[];
  modelConfigs: any[];
  externalTools: any[];
  usageHistory: any[];
  ollamaHost: string;
  username: string;
  timezone?: string;
  saveField: (field: string, value: any) => Promise<void>;
  setWorkflows: (wf: Workflow[]) => void;
  setEditingWorkflowId: (id: string | null) => void;
  setIsChatVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  setPersistedAgents: (agents: Agent[]) => void;
  setShowAgentManager: (v: boolean) => void;
  setEditingAgent: (agent: Agent | undefined) => void;
  handleSendMessage: (msg: string, images?: string[], attachments?: any[]) => void;
  handleRunWorkflow: (wf: Workflow, isAuto?: boolean) => Promise<void>;
  handleSaveWorkflow: (wf: Workflow) => void;
  onApproveTool: () => void;
  onDenyTool: () => void;
  onStop: () => void;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error';
  isGenerating: boolean;
  pendingApproval: any;
  strategyPlanItems?: any;
  pendingStrategyPlan?: any;
  onMarkStrategyPlanCompleted?: (planId: string) => void;
  sessionNoteRemoteRefreshKey?: number;
  projects?: Project[];
  activeProjectId?: string | null;
  onSelectProject?: (id: string) => void;
  onAddProject?: (project: Project) => void;
  onEditProject?: (project: Project) => void;
  onDeleteProject?: (id: string) => void;
  onScanProject?: (id: string) => Promise<any>;
  scanLoading?: boolean;
  scanDraft?: import('../../types').ProjectContext | null;
  onApproveContext?: (ctx: import('../../types').ProjectContext) => void;
  onDismissDraft?: () => void;
}

const AppRouter: React.FC<AppRouterProps> = (props) => {
  const {
    viewMode, isChatVisible, activeAgent, activeAgentId, agents, editingWorkflowId,
    workflows, modelConfigs, externalTools, usageHistory,
    ollamaHost, username, timezone,
    saveField, setWorkflows, setEditingWorkflowId, setIsChatVisible,
    setPersistedAgents, setShowAgentManager, setEditingAgent,
    handleSendMessage, handleRunWorkflow, handleSaveWorkflow,
    onApproveTool, onDenyTool, onStop, syncStatus, isGenerating,
    pendingApproval, strategyPlanItems, pendingStrategyPlan, onMarkStrategyPlanCompleted, sessionNoteRemoteRefreshKey, projects = [], activeProjectId = null, onSelectProject,
    onAddProject, onEditProject, onDeleteProject,
    onScanProject, scanLoading, scanDraft, onApproveContext, onDismissDraft,
  } = props;

  return (
    <>
      <div className={`h-full overflow-hidden shrink-0 ${viewMode === 'chat' && isChatVisible ? 'w-full' : 'w-0'}`}>
        <ChatInterface
          agent={activeAgent}
          username={username}
          onSendMessage={handleSendMessage}
          onEditAgent={() => { setEditingAgent(activeAgent); setShowAgentManager(true); }}
          onClearSummary={() => setPersistedAgents(agents.map(a => a.id === activeAgent.id ? { ...a, summary: '' } : a))}
          isGenerating={isGenerating}
          pendingApproval={pendingApproval}
          strategyPlanItems={strategyPlanItems}
          pendingStrategyPlan={pendingStrategyPlan}
          onMarkStrategyPlanCompleted={onMarkStrategyPlanCompleted}
          onApproveTool={onApproveTool}
          onDenyTool={onDenyTool}
          onStop={onStop}
          syncStatus={syncStatus}
          isChatVisible={isChatVisible}
          onToggleChat={() => setIsChatVisible(v => !v)}
          sessionNoteRemoteRefreshKey={sessionNoteRemoteRefreshKey}
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={onSelectProject}
          onAddProject={onAddProject}
          onEditProject={onEditProject}
          onDeleteProject={onDeleteProject}
          onScanProject={onScanProject}
          scanLoading={scanLoading}
          scanDraft={scanDraft}
          onApproveContext={onApproveContext}
          onDismissDraft={onDismissDraft}
        />
      </div>

      <div className={`flex-1 h-full overflow-hidden ${viewMode !== 'chat' ? 'block' : 'hidden'}`}>
        {viewMode === 'automation' && (
          <div className="h-full overflow-hidden bg-white dark:bg-dark-950 transition-colors">
            {editingWorkflowId ? (
              <WorkflowEditor
                workflow={workflows.find(w => w.id === editingWorkflowId)!}
                agents={agents}
                models={modelConfigs}
                workflows={workflows.filter(w => w.id !== editingWorkflowId)}
                username={username}
                timezone={timezone}
                onSave={handleSaveWorkflow}
                onBack={() => setEditingWorkflowId(null)}
                onRun={(wf: Workflow) => handleRunWorkflow(wf)}
              />
            ) : (
              <WorkflowListView
                workflows={workflows}
                activeAgentId={activeAgentId}
                setWorkflows={setWorkflows}
                saveField={saveField}
                setEditingWorkflowId={setEditingWorkflowId as any}
                handleRunWorkflow={handleRunWorkflow}
              />
            )}
          </div>
        )}

        {viewMode === 'commands' && (
          <CommandLibrary
            externalTools={externalTools}
          />
        )}

        {viewMode === 'dashboard' && (
          <div className="h-full overflow-y-auto">
            <ModelDashboard usageHistory={usageHistory} models={modelConfigs} />
          </div>
        )}

        {viewMode === 'memory' && <MemoryExplorer ollamaHost={ollamaHost} agents={agents} />}
      </div>
    </>
  );
};

export default AppRouter;
