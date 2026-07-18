export interface ProjectContext {
  /** Linguagens, frameworks, ferramentas detectadas (ex: ['TypeScript', 'React', 'Vite']) */
  stack: string[];
  /** Arquivos-chave do projeto com breve descrição (ex: { 'src/App.tsx': 'Root component' }) */
  keyFiles: Record<string, string>;
  /** Convenções do projeto (ex: ['Use Tailwind for styling', 'Functional components only']) */
  conventions: string[];
  /** Timestamp do último scan */
  generatedAt: number;
  /** true = usuário aprovou, false = rascunho pendente */
  approved: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  color?: string;
  gitEnabled?: boolean;
  createdAt: number;
  /** Contexto rico gerado pelo agente e aprovado pelo usuário */
  context?: ProjectContext;
}

export type AgentRole = 'master' | 'worker' | 'infra';
export type AgentExecutionMode = 'strict' | 'flex';

export interface Agent {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  summary: string;
  history: Message[];
  sessions?: ChatSession[];
  activeSessionId: string;
  color: string;
  isMaster?: boolean;
  role?: AgentRole;
  executionMode?: AgentExecutionMode;
  tags?: string[];
  allowedTools?: string[];
  timeoutSeconds?: number;
  maxRetries?: number;
  maxTokensPerPayload?: number;
  reasoning?: boolean;
  lastModified?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  history: Message[];
  summary: string;
  lastModified: number;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  images?: string[];
  attachments?: Attachment[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface Attachment {
  type: 'file' | 'url' | 'text' | 'image';
  name: string;
  content: string;
  size?: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'error' | 'warning' | 'success' | 'request' | 'response';
  method: string;
  content: any;
  model?: string;
  tokens?: number;
  durationMs?: number;
  tokensPerSec?: number;
  summary?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
  read: boolean;
}

export interface UsageRecord {
  id: string;
  timestamp: number;
  modelId: string;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  audioSeconds?: number;
  agentId?: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'ollama' | 'openai' | 'groq' | 'stepfun' | 'anthropic' | 'custom' | 'sai' | 'sai-vertex' | 'sai-nested' | 'gemini' | 'openrouter' | 'azure-openai' | 'azure-foundry';
  modelId: string;
  baseUrl?: string;
  apiKey?: string;
  rateLimits?: {
    rpm?: number;
    tpm?: number;
    rpd?: number;
  };
  requestBuilder?: string;
  intent?: string;
  isFallback?: boolean;
  bypassProxy?: boolean;
  contextWindow?: number;
  reservedOverhead?: number;
  maxTokensPerSession?: number;
  maxTokens?: number;
  temperature?: number;
  apiVersion?: string;
  costPerMToken?: number; // USD per 1M tokens (blended input+output estimate)
  inputCostPerMToken?: number;  // USD per 1M input/prompt tokens
  outputCostPerMToken?: number; // USD per 1M output/completion tokens
}

export interface ExternalTool {
  id?: string;
  name: string;
  description: string;
  parameters: object;
  config: {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: object;
  };
}

export interface ApiKey {
  id?: string;
  name: string;
  value: string;
  provider?: string;
  created?: number;
}

export interface MemoryConfig {
  enabled: boolean;
  maxMemories: number;
  embeddingModel?: string;
  baseUrl?: string;
  maintenanceAgentId?: string;
}

export interface SummaryConfig {
  summaryAgentId: string;
  tokenLimit: number;
  windowSize: number;
  summaryMaxChars: number;
}

export interface MemoryItem {
  id: string;
  content: string;
  summary?: string;
  tags: string[];
  timestamp: number;
  createdAt?: number;
  updatedAt?: number;
  lastInjectedAt?: number | null;
  lastConfirmedAt?: number | null;
  embedding?: number[];
  relevance?: number;
  agentId?: string;
  category?: 'fact' | 'state' | 'event' | 'behavior' | 'issue' | 'knowledge' | 'design' | 'summary';
  importance?: number;
  confidence?: number;
  scope?: 'global' | 'user';
  ownerId?: string | null;
  accessCount?: number;
  fingerprint?: string;
  lastReinforced?: number;
  consolidatedFrom?: string[];
  promotionCandidate?: boolean;
  promotionReason?: string | null;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  agentId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: 'active' | 'paused';
  schedule?: WorkflowSchedule;
}

export type TriggerNodeConfig = {};

export type ConditionNodeConfig = {
  expression: string;
  trueLabel?: string;
  falseLabel?: string;
};

export type LoopNodeConfig = {
  items: string;
  variable: string;
  maxIterations?: number;
};

export type CodeNodeConfig = {
  language: 'javascript' | 'python';
  code: string;
};

export type SubWorkflowNodeConfig = {
  workflowId: string;
  inputMapping?: string;
};

export type TransformNodeConfig = {
  expression: string;
  outputVariable: string;
};

export type AgentTaskNodeConfig = {
  task: string;          // message/instruction sent to the agent
  useContextAgent: boolean; // true = use pipeline's assigned agent, false = pick specific
  agentId?: string;      // specific agent override
  tools?: string[];      // allowed tools override (empty = all agent's tools)
};

export type WorkflowToolOutputClass = 'inline' | 'preview' | 'artifact';

export type WorkflowToolResultStatus = 'success' | 'error' | 'timeout';

export type WorkflowToolBindingValue = string | number | boolean | null | WorkflowToolBindingObject | WorkflowToolBindingValue[];

export interface WorkflowToolBindingObject {
  [key: string]: WorkflowToolBindingValue;
}

export interface WorkflowToolResultTiming {
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  timeoutMs?: number;
}

export interface WorkflowToolResultError {
  message: string;
  code?: string;
  details?: unknown;
}

export interface WorkflowToolResultEnvelope<TData = unknown> {
  ok: boolean;
  status: WorkflowToolResultStatus;
  toolName: string;
  outputClass: WorkflowToolOutputClass;
  data?: TData;
  summary?: string;
  artifactRef?: string | null;
  error?: WorkflowToolResultError | null;
  timings?: WorkflowToolResultTiming;
}

export type ToolNodeConfig = {
  toolName: string;
  input?: WorkflowToolBindingObject;
  output?: {
    class?: WorkflowToolOutputClass;
  };
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
  permissions?: {
    allow?: string[];
  };
};

export interface WorkflowNode {
  id: string;
  type: 'llm' | 'http' | 'delay' | 'alert' | 'trigger' | 'condition' | 'loop' | 'code' | 'subworkflow' | 'transform' | 'agent' | 'tool';
  label: string;
  config: LLMNodeConfig | HTTPNodeConfig | DelayNodeConfig | AlertNodeConfig | TriggerNodeConfig | ConditionNodeConfig | LoopNodeConfig | CodeNodeConfig | SubWorkflowNodeConfig | TransformNodeConfig | AgentTaskNodeConfig | ToolNodeConfig;
  position?: { x: number; y: number };
}

export type LLMNodeConfig = {
  modelId: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
};

export type HTTPNodeConfig = {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
};

export type DelayNodeConfig = {
  duration: number;
};

export type AlertNodeConfig = {
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
};

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface WorkflowSchedule {
  enabled: boolean;
  type: 'once' | 'daily' | 'weekly';
  time: string;
  days?: number[];
  nextRun?: number;
  lastRun?: number;
}

export interface DispatcherResponse {
  target_agent_id?: string;
  refined_query?: string;
  memory_trigger?: boolean;
  memory_filters?: { tags: string[] };
  memory_search_query?: string;
  guideline_trigger?: boolean;
  reasoning?: string;
}

export interface AuthResponse {
  token: string;
  username: string;
}

export interface RouterConfig {
  enabled: boolean;
  modelId: string;
  confidenceThreshold: number;
  confidenceDirectThreshold: number;
  kValue: number;
  keepAgentPrompt: string;
}

export interface RoutingHistoryEntry {
  id: string;
  timestamp: number;
  agentId: string;
  route: string;
  confidence: number;
  reason?: string;
}

export interface AppConfig {
  version?: string;
  agents: Agent[];
  scheduledMessages: ScheduledMessage[];
  workflows: Workflow[];
  modelConfigs: ModelConfig[];
  externalTools: ExternalTool[];
  apiKeys: ApiKey[];
  memoryConfig: MemoryConfig;
  guidelines: string;
  ollamaHost: string;
  theme: 'light' | 'dark';
  colorTheme: string;
  timezone?: string;
  usageHistory?: UsageRecord[];
  trafficLogs?: LogEntry[];
  routerConfig?: RouterConfig;
  routingHistory?: RoutingHistoryEntry[];
}

export interface ScheduledMessage {
  id: string;
  agentId: string;
  content: string;
  scheduledAt: number;
  createdAt: number;
  createdBy: string;
  status: 'pending' | 'sent' | 'failed';
}

export type ColorTheme = 'blue' | 'green' | 'purple' | 'orange' | 'amber' | 'indigo';

export const AGENT_COLORS = [
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#f59e0b',
];

export const MAX_LOG_ENTRIES = 1000;

export const APP_VERSION = '1.6.0';
