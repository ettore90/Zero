// =============================================================================
// toolContext.ts — Tipo compartilhado do contexto de execução de tools
// =============================================================================

import { MutableRefObject } from 'react';
import { Agent, ExternalTool, LogEntry, ModelConfig, Workflow, ApiKey, ColorTheme, Attachment } from '../../types';

export interface ToolContext {
    agentId: string;
    agentsRef: MutableRefObject<Agent[]>;
    setAgents: (agents: Agent[]) => void;
    workflowsRef: MutableRefObject<Workflow[]>;
    setWorkflows: (workflows: Workflow[]) => void;
    modelsRef: MutableRefObject<ModelConfig[]>;
    setModelConfigs: (models: ModelConfig[]) => void;
    externalToolsRef: MutableRefObject<ExternalTool[]>;
    setExternalTools: (tools: ExternalTool[]) => void;
    apiKeysRef: MutableRefObject<ApiKey[]>;
    setApiKeys: (keys: ApiKey[]) => void;
    scheduledMessagesRef: MutableRefObject<any[]>;
    usageHistoryRef: MutableRefObject<any[]>;
    ollamaHost: string;
    setOllamaHost: (host: string) => void;
    guidelines: string;
    setGuidelines: (g: string) => void;
    theme: 'light' | 'dark';
    setTheme: (t: 'light' | 'dark') => void;
    colorTheme: ColorTheme;
    setColorTheme: (c: ColorTheme) => void;
    addLog: (entry: LogEntry) => void;
    addNotification: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
    persistState: (...args: any[]) => void;
    saveField: (field: string, value: any) => Promise<void>;
    handleRunWorkflow: (wf: Workflow) => Promise<void>;
    runAgentCycle: (agentId: string, userMessage: string | null, images?: string[], attachments?: Attachment[], signal?: AbortSignal) => Promise<string | undefined>;
    getLiveContent?: (path: string) => string | null;
    delegateTask?: (masterAgentId: string, subAgentId: string, task: string, options?: any) => Promise<any>;
    onWriteFileDryRun?: (path: string, originalContent: string, proposedContent: string, agentId: string, toolCallId: string) => Promise<boolean>;
    onTerminalOutput?: (output: string, agentId: string) => void;
    onGitCommit?: (message: string, output: string, agentId: string) => void;
    // Retry helpers
    executeWithRetry: (toolName: string, args: Record<string, any>, executor: () => Promise<any>, agentId: string) => Promise<any>;
    interpolateVariables: (text: string) => string;
}
