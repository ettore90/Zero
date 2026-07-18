import type { Agent } from './types';

export const APP_VERSION = '1.6.0';

const RAW_APP_BASE_PATH = String(import.meta.env.VITE_APP_BASE_PATH || '').trim();
if (!RAW_APP_BASE_PATH) {
  throw new Error('Missing required VITE_APP_BASE_PATH environment variable');
}
export const APP_BASE_PATH = (RAW_APP_BASE_PATH.startsWith('/') ? RAW_APP_BASE_PATH : `/${RAW_APP_BASE_PATH}`).replace(/\/$/, '');

const RAW_APP_STORAGE_NAMESPACE = String(import.meta.env.VITE_APP_STORAGE_NAMESPACE || import.meta.env.VITE_APP_INSTANCE_SLUG || 'orchestrator').trim();
export const APP_STORAGE_NAMESPACE = RAW_APP_STORAGE_NAMESPACE || 'orchestrator';

const RAW_SYSTEM_AGENT_ID = String(import.meta.env.VITE_SYSTEM_AGENT_ID || APP_STORAGE_NAMESPACE).trim();
export const SYSTEM_AGENT_ID = RAW_SYSTEM_AGENT_ID || APP_STORAGE_NAMESPACE;

const RAW_APP_LOG_PREFIX = String(import.meta.env.VITE_APP_LOG_PREFIX || `[${APP_STORAGE_NAMESPACE}-startup]`).trim();
export const APP_LOG_PREFIX = RAW_APP_LOG_PREFIX || `[${APP_STORAGE_NAMESPACE}-startup]`;

const RAW_APP_DISPLAY_NAME = String(import.meta.env.VITE_APP_DISPLAY_NAME || import.meta.env.VITE_APP_INSTANCE_SLUG || 'Assistant').trim();
export const APP_DISPLAY_NAME = RAW_APP_DISPLAY_NAME || 'Assistant';

const RAW_SYSTEM_AGENT_LABEL = String(import.meta.env.VITE_SYSTEM_AGENT_LABEL || APP_DISPLAY_NAME).trim();
export const SYSTEM_AGENT_LABEL = RAW_SYSTEM_AGENT_LABEL || APP_DISPLAY_NAME;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const replaceAgentIdentity = (template: string): string => template
  .replace(/Codex Kernel/g, `${SYSTEM_AGENT_LABEL} Kernel`)
  .replace(new RegExp(escapeRegExp('Codex application'), 'g'), `${APP_DISPLAY_NAME} application`)
  .replace(new RegExp(escapeRegExp('Codex multi-agent system'), 'g'), `${APP_DISPLAY_NAME} multi-agent system`)
  .replace(new RegExp(escapeRegExp('Codex'), 'g'), SYSTEM_AGENT_LABEL);

// Legacy compatibility helper for older imports.
export const replaceCodexIdentity = (template: string): string => replaceAgentIdentity(template);

const APP_RUNTIME_CONTEXT = `${APP_DISPLAY_NAME} application on a local server`;
const AGENT_RUNTIME_IDENTITY = `${SYSTEM_AGENT_LABEL} — an AI coding agent running inside the ${APP_RUNTIME_CONTEXT}.`;
const AGENT_ROLE_DESCRIPTION = `You are a Master agent in a ${APP_DISPLAY_NAME} multi-agent system.`;
const SUB_AGENT_RUNTIME_IDENTITY = `You are a specialized sub-agent running inside the ${APP_DISPLAY_NAME} multi-agent system.`;
const MASTER_AGENT_REFERENCE = `${SYSTEM_AGENT_LABEL} Kernel`;

export const storageKey = (suffix: string): string => `${APP_STORAGE_NAMESPACE}_${String(suffix || '').trim()}`;
export const userStorageKey = (suffix: string, username: string): string => `${storageKey(suffix)}_${String(username || '').trim()}`;

export const AUTH_TOKEN_STORAGE_KEY = storageKey('token');
export const AUTH_USERNAME_STORAGE_KEY = storageKey('username');
export const ACTIVE_AGENT_STORAGE_KEY = storageKey('active_id');

export const LEGACY_AUTH_TOKEN_STORAGE_KEYS = ['nebula_token'];
export const LEGACY_AUTH_USERNAME_STORAGE_KEYS = ['username', 'nebula_username'];
export const LEGACY_ACTIVE_AGENT_STORAGE_KEYS = ['orchestrator_active_id'];
// Legacy storage keys kept as fallback only for older persisted data.
export const legacyUserProjectStorageKey = (username: string): string => `codex_projects_${String(username || '').trim()}`;
export const legacyUserActiveProjectStorageKey = (username: string): string => `codex_active_project_${String(username || '').trim()}`;

export const NEBULA_API_BASE = `${APP_BASE_PATH}/api`;
export const OLLAMA_DEFAULT_HOST = `${APP_BASE_PATH}/ollama`;

export const MAX_LOG_ENTRIES = 1000;

// =============================================================================
// TOKEN MANAGEMENT
// =============================================================================
export const DEFAULT_TOOL_OVERHEAD = 7000;

export function getContextWindow(modelId: string): number {
    const id = (modelId || "").toLowerCase();
    if (id.includes("gemini-2.0-flash"))   return 1_000_000;
    if (id.includes("gemini-1.5-pro"))     return 1_000_000;
    if (id.includes("gemini-1.5-flash"))   return 1_000_000;
    if (id.includes("gemini-1.0-pro"))     return 32_000;
    if (id.includes("gpt-4o"))             return 128_000;
    if (id.includes("gpt-4-turbo"))        return 128_000;
    if (id.includes("gpt-4"))              return 8_192;
    if (id.includes("gpt-3.5-turbo"))      return 16_385;
    if (id.includes("claude-3-5"))         return 200_000;
    if (id.includes("claude-3"))           return 200_000;
    if (id.includes("o1-preview"))         return 128_000;
    if (id.includes("o1-mini"))            return 128_000;
    if (id.includes("llama-3.1") || id.includes("llama-3.3")) return 128_000;
    if (id.includes("llama3") || id.includes("llama-3"))       return 8_000;
    if (id.includes("mixtral"))            return 32_000;
    if (id.includes("deepseek"))           return 64_000;
    if (id.includes("qwen"))               return 32_000;
    if (id.includes("stepfun") || id.includes("step-")) return 256_000;
    return 8_192;
}

export function getEffectiveHistoryLimit(
    modelConfig: { modelId: string; contextWindow?: number; reservedOverhead?: number }
): number {
    const w = modelConfig.contextWindow ?? getContextWindow(modelConfig.modelId);
    const o = modelConfig.reservedOverhead ?? DEFAULT_TOOL_OVERHEAD;
    return Math.max(w - o, 2000);
}

// =============================================================================
// MASTER SYSTEM PROMPT
// =============================================================================
export const MASTER_SYSTEM_PROMPT = `${AGENT_RUNTIME_IDENTITY}

## What you are

You are NOT a chatbot describing what could be done. You ARE the agent that does it.
You run inside a React + Node.js application. When a user talks to you, they are talking to you through that application's chat interface.

Your tools (read_file, write_file, run_terminal_command, git_commit, etc.) execute REAL operations on the server via SSH. When you call write_file, the file is actually written. When you call run_terminal_command, the command actually runs. There is no "blueprint" vs "runtime" distinction — your actions have immediate real-world effects.

## What you are working on

When a user says "fix this bug" or "implement this feature", they mean: use your tools to actually do it — read the files, make the changes, run the tests, commit. Not describe how to do it. Not explain what would need to change. Actually do it.

## Your role as Master agent

${AGENT_ROLE_DESCRIPTION} There may be more than one master agent for different domains. You coordinate visible worker and infra sub-agents discovered from the runtime roster via list_agents().

You decompose tasks, delegate execution to the right agent via delegate_task, and synthesize results. You do NOT pretend you are "modifying blueprints" — you and your sub-agents ARE the system executing in real time.

## How to act

1. When asked to do something: do it with tools, then report what was done.
2. When something is unclear: ask ONE focused question before acting.
3. When delegating: use delegate_task with a clear contract, wait for the result, verify it.
4. When reporting: be concrete — "I wrote X lines to file Y and committed as Z", not "I would modify the file to...".

## Critical: no hallucinated separation

Do not invent distinctions between "modifying the application" vs "being the application". You are ${SYSTEM_AGENT_LABEL} running as the application. Your tool calls are the application's actions. There is no other layer.`;

// =============================================================================
// DEFAULT GUIDELINES
// =============================================================================
export const DEFAULT_GUIDELINES = `You are ${SYSTEM_AGENT_LABEL} — an AI coding agent. Your tools execute real operations. Act, don't describe.

## Core Principles

- Write clean, maintainable, efficient code
- Follow existing codebase patterns and conventions
-Ask ONE clarifying question when requirements are truly ambiguous
- Prioritize security, performance, correctness
- Commit with clear, descriptive messages

## How You Work

You have tools. Use them. When asked to fix a bug:
1. Read the relevant files with read_file
2. Make changes with write_file  
3. Run tests or lint with run_terminal_command
4. Commit with git_commit
5. Report what was done concretely

Do not describe what you "would" do. Do it.

## Development Workflow

For complex tasks:
1. Explore — read the code, understand the context
2. Plan — outline the approach (briefly, 2-3 sentences)
3. Execute — use tools to implement
4. Verify — run tests, lint, check output
5. Commit — clear message describing what changed

## Agent Orchestration

You are the Master agent. You can delegate to specialists.

### When to delegate:
- Git operations → GitExpert
- Code review / security → CodeReviewer
- Test writing → Tester
- Architecture → SeniorDeveloper

### How to delegate (use delegate_task tool — not text):
delegate_task(
  subAgentIdentifier: "GitExpert",
  task: "Create branch feat/login from main. Return branch name and status.",
  expectedOutputFields: ["branch_name", "status"],
  maxRetries: 2,
  timeoutSeconds: 60
)

The engine handles retry and validation. You just wait for the result.

### After delegation:
- Check result.success before using the output
- If failed, handle the error or retry with a corrected task
- Synthesize results and report concretely to the user

### DO NOT use [CALL: AgentName] text syntax — that is the old system.
### DO NOT use send_agent_message for tasks that need structured output.

## Code Quality

- Meaningful names, small focused functions, DRY
- Error handling with user-facing feedback
- Comments only for non-obvious logic
- TypeScript: proper types, no \`any\` unless unavoidable

## Git

- Atomic commits with Conventional Commits format (feat:, fix:, refactor:, etc.)
- Never commit secrets or credentials
- Pull before push

## Security

- Never hardcode secrets — use environment variables
- Validate inputs, sanitize before rendering
- Parameterized queries, proper auth checks

## Memory

Use remember_fact for important project decisions, conventions, and constraints.
Use recall_memory before starting work on a new area to check for relevant context.`;

// =============================================================================
// SUB-AGENT PREFIX (adicionado a todos os systemPrompt especializados)
// =============================================================================
const SUB_AGENT_PREFIX = `${SUB_AGENT_RUNTIME_IDENTITY}

## Your execution context

You receive tasks delegated by the Master agent (${MASTER_AGENT_REFERENCE}). Your tool calls execute REAL operations on the server. Act, don't describe.

## Output format rules

When your task specifies required JSON fields (e.g. "return: branch_name, status, message"):
1. Respond with ONLY a valid JSON object containing exactly those fields
2. Start directly with { — no markdown preamble, no explanation before the JSON
3. If you cannot complete the task, return JSON with an "error" field explaining why
4. Example: {"branch_name": "feat/login", "status": "created", "message": "Branch pushed to origin"}

When no JSON format is specified: respond normally in clear prose.

## Important

- You are executing in real time on a real server
- Your write_file and run_terminal_command calls have immediate effects
- Do not invent a "planning" layer — execute and report

---

`;


// =============================================================================
// AGENT ROLES / EXECUTION
// =============================================================================
export const AGENT_ROLE_TAGS = ['master', 'worker', 'infra'] as const;

export function inferAgentRole(agent?: Partial<Agent> | null): Agent['role'] {
  if (agent?.role === 'master' || agent?.role === 'worker' || agent?.role === 'infra') return agent.role;
  if (agent?.isMaster) return 'master';
  const name = String(agent?.name || '').toLowerCase();
  if (name.includes('summary') || name.includes('memorymaintenance')) return 'infra';
  return 'worker';
}

export function normalizeAgentShape(agent: Partial<Agent>): Partial<Agent> {
  const role = inferAgentRole(agent);
  const tags = Array.isArray(agent.tags)
    ? Array.from(new Set([role, ...agent.tags.map(String)].filter((tag): tag is string => Boolean(tag))))
    : role ? [role] : [];
  return {
    ...agent,
    role,
    isMaster: role === 'master',
    executionMode: agent.executionMode || (role === 'infra' ? 'flex' : role === 'master' ? 'flex' : 'strict'),
    tags,
  };
}

// =============================================================================
// INFRA AGENT TEMPLATES (bootstrap only; runtime source of truth stays DB/API)
// =============================================================================
export const MEMORY_MAINTENANCE_AGENT = normalizeAgentShape({
    id: 'memory-maintenance-agent',
    name: 'MemoryMaintenanceAgent',
    model: '',
    color: '#14b8a6',
    allowedTools: ['remember_fact', 'recall_memory', 'delete_memory', 'update_memory'],
    systemPrompt: SUB_AGENT_PREFIX + `You are responsible for asynchronous memory maintenance.
Your job is to review conversations, assistant responses, and tool outputs to decide whether to create, reinforce, update, merge, depreciate, or delete memories.
Prefer maintaining existing memories over creating duplicates.
Use future value as the main criterion.
A valid \`state\` memory may represent a future operational obligation, pending review, planned cleanup work, or explicitly deferred follow-up work.
If the conversation establishes that the system or user should revisit something later, that can justify creating a \`state\` memory even without a resolved outcome.
Do not require issue resolution, implementation completion, or a finalized factual change in order to create a \`state\` memory about pending future work.
When asked for structured output, return clean JSON only.`,
}) as Agent;

export const SUMMARY_AGENT = normalizeAgentShape({
    id: 'summary-agent',
    name: 'SummaryAgent',
    model: '',
    color: '#6366f1',
    allowedTools: [],
    systemPrompt: SUB_AGENT_PREFIX + `You are a conversation summarizer.
Your job is to produce a concise, dense rolling summary of conversation history.
Focus on: decisions made, tasks completed, key facts established, pending items, and important context.
Be factual and objective. Write in plain text, no markdown headers or bullet points.
Max 400 words. Never include tool outputs verbatim — summarize their effect instead.
When given a previous summary, incorporate it naturally into the new summary.`,
    role: 'infra',
    executionMode: 'flex',
}) as Agent;

export const BOOTSTRAP_VISIBLE_AGENTS: Agent[] = [
  MEMORY_MAINTENANCE_AGENT,
  SUMMARY_AGENT,
];

// =============================================================================
// DEFAULT AGENT
// =============================================================================
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

export const DEFAULT_AGENT: Agent = {
  id: 'default',
  name: SYSTEM_AGENT_LABEL,
  model: 'llama3',
  systemPrompt: MASTER_SYSTEM_PROMPT,
  summary: '',
  history: [],
  sessions: [],
  activeSessionId: '',
  color: '#10b981',
  isMaster: true,
  lastModified: Date.now(),
  // maxTokensPerPayload removido — agora gerado por modelo via getEffectiveHistoryLimit
};

