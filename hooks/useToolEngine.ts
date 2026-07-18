import { MutableRefObject } from 'react';
import { Agent, ExternalTool, LogEntry, ModelConfig, Workflow, ApiKey, ColorTheme, Message, ToolCall, Attachment } from '../types';
import { generateId } from '../utils/helpers';
import * as SystemService from '../services/systemService';
import { SYSTEM_TOOLS } from '../utils/toolDefinitions';
import { APP_BASE_PATH, AUTH_USERNAME_STORAGE_KEY, LEGACY_AUTH_USERNAME_STORAGE_KEYS, NEBULA_API_BASE } from '../constants';
import { handleSystemTool } from './tools/systemTools';

interface ToolEngineContext {
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
    /** Optional callback so useToolEngine can use the orchestration engine */
    delegateTask?: (masterAgentId: string, subAgentId: string, task: string, options?: any) => Promise<any>;
    /** Dry-run: called before write_file — return false to block, true to proceed */
    onWriteFileDryRun?: (path: string, originalContent: string, proposedContent: string, agentId: string, toolCallId: string) => Promise<boolean>;
    /** Terminal mirror: if set, agent's run_terminal_command output is also sent to the xterm terminal */
    onTerminalOutput?: (output: string, agentId: string) => void;
    /** Auto-memory: called after git_commit */
    onGitCommit?: (message: string, output: string, agentId: string) => void;
}

export const useToolEngine = (context: ToolEngineContext) => {
    const { 
        agentsRef, setAgents, 
        modelsRef,
        externalToolsRef, setExternalTools,
        apiKeysRef, setApiKeys,
        setOllamaHost,
        guidelines, setGuidelines,
        setTheme,
        setColorTheme,
        addLog, addNotification,
        getLiveContent,
        onWriteFileDryRun,
        onGitCommit,
        onTerminalOutput
    } = context;

    // -------------------------------------------------------------------------
    // Retry inteligente para tool calls
    // -------------------------------------------------------------------------
    const RETRYABLE_TOOLS = new Set([
        'run_terminal_command',
        'write_file',
        'run_python_code',
    ]);
    const MAX_TOOL_RETRIES = 2;

    /**
     * Analisa o erro de um tool call e tenta gerar um fix via LLM.
     * Retorna args corrigidos (ou os originais se não conseguir).
     */
    const diagnoseAndFix = async (
        toolName: string,
        originalArgs: Record<string, any>,
        errorOutput: string,
        attempt: number
    ): Promise<Record<string, any>> => {
        const masterAgent = agentsRef.current.find(a => a.isMaster) ?? agentsRef.current[0];
        const modelConfig = modelsRef.current.find(m => m.modelId === masterAgent?.model || m.id === masterAgent?.model) ?? modelsRef.current[0];
        if (!modelConfig) return originalArgs;

        const prompt = `A tool call failed. Analyze the error and provide corrected arguments.

Tool: ${toolName}
Attempt: ${attempt}/${MAX_TOOL_RETRIES}

Original arguments:
${JSON.stringify(originalArgs, null, 2)}

Error output:
${errorOutput}

Provide ONLY a JSON object with the corrected arguments. If the command needs fixing, fix it.
Common fixes:
- "No such file or directory" → create parent dirs first (use mkdir -p) or fix the path
- "Permission denied" → use sudo or check path
- "command not found" → use full path or install the tool
- Syntax error → fix the syntax

Respond ONLY with the corrected JSON arguments object, nothing else.`;

        try {
            const result = await (await import('../services/llmProvider')).executeChatRequest(
                [{ role: 'user', content: prompt, timestamp: Date.now() }],
                modelConfig,
                modelsRef.current,
                () => {},
                addLog
            );
            let jsonStr = result.content.trim();
            const fence = jsonStr.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
            if (fence) jsonStr = fence[1].trim();
            const fixed = JSON.parse(jsonStr);
            addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'info', method: 'TOOL_RETRY_DIAGNOSIS', content: `[${toolName}] Fixed args: ${JSON.stringify(fixed)}` });
            return fixed;
        } catch {
            return originalArgs;
        }
    };

    /**
     * Executa uma tool com retry automático em caso de erro.
     * Só atua em RETRYABLE_TOOLS. Retorna o output final.
     */
    const executeWithRetry = async (
        toolName: string,
        args: Record<string, any>,
        executor: () => Promise<any>,
        agentId: string
    ): Promise<any> => {
        if (!RETRYABLE_TOOLS.has(toolName)) return executor();

        let lastOutput: any;
        for (let attempt = 1; attempt <= MAX_TOOL_RETRIES + 1; attempt++) {
            lastOutput = await executor();
            const outputStr = typeof lastOutput === 'string' ? lastOutput : JSON.stringify(lastOutput);
            const hasError = (
                (typeof lastOutput === 'object' && lastOutput !== null && ('error' in lastOutput || 'stderr' in lastOutput) &&
                    (lastOutput.error || (lastOutput.stderr && !lastOutput.stdout && lastOutput.exitCode !== 0)))
                || (typeof lastOutput === 'string' && (lastOutput.startsWith('Error:') || lastOutput.includes('error:') || lastOutput.includes('No such file')))
            );

            if (!hasError || attempt > MAX_TOOL_RETRIES) break;

            const errorMsg = typeof lastOutput === 'object'
                ? (lastOutput.error ?? lastOutput.stderr ?? outputStr)
                : lastOutput;

            addLog({
                id: Date.now().toString(), timestamp: Date.now(), type: 'warning',
                method: 'TOOL_RETRY',
                content: `[${toolName}] Attempt ${attempt} failed: ${String(errorMsg).slice(0, 200)}. Diagnosing...`
            });
            addNotification('Tool Retry', `${toolName} failed — diagnosing and retrying (${attempt}/${MAX_TOOL_RETRIES})...`, 'warning');

            const fixedArgs = await diagnoseAndFix(toolName, args, String(errorMsg), attempt);
            // Rebuild executor with fixed args
            if (toolName === 'run_terminal_command' && fixedArgs.command !== args.command) {
                args = fixedArgs;
                const cmd = fixedArgs.command;
                const exec = () => SystemService.runCommand(cmd, agentId);
                executor = exec;
            } else if (toolName === 'write_file' && fixedArgs.path !== args.path) {
                args = fixedArgs;
                const p = fixedArgs.path, c = fixedArgs.content;
                executor = () => SystemService.writeFile(p, c, agentId);
            } else if (toolName === 'run_python_code') {
                args = fixedArgs;
                executor = () => SystemService.runPython(fixedArgs.code, agentId);
            }
        }

        return lastOutput;
    };

    const executeBackendTool = async (toolName: string, args: Record<string, any>, agentId: string) => {
        const resp = await fetch(`${NEBULA_API_BASE}/tool/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ toolName, args, agentId }),
        });
        return resp.json();
    };

    const refreshAgentsFromServer = async () => {
        const username = localStorage.getItem(AUTH_USERNAME_STORAGE_KEY) || LEGACY_AUTH_USERNAME_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find((value) => value) || '';
        if (!username) return;
        try {
            const res = await fetch(`${APP_BASE_PATH}/api/agents?username=${encodeURIComponent(username)}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data?.agents?.length) {
                setAgents(data.agents);
                agentsRef.current = data.agents;
            }
        } catch {}
    };

    const processToolCalls = async (
        agentId: string, 
        toolCalls: ToolCall[], 
        signal?: AbortSignal,
        externalHistory?: Message[]  // se fornecido, tool results vão aqui em vez do agent.history
    ) => {
        for (const tool of toolCalls) {
            if (signal?.aborted) return;

            let output: any;
            const rawArgs = tool.function.arguments;
            const args = typeof rawArgs === 'string' 
              ? (rawArgs.trim() === '' ? {} : JSON.parse(rawArgs)) 
              : rawArgs;
              
            const toolName = tool.function.name;

            try {
                // Get fresh agents for each tool call to avoid stale state in recursive calls
                let currentAgents = [...agentsRef.current];
                const agentIndex = currentAgents.findIndex(a => a.id === agentId);
                if (agentIndex === -1) continue;

                // Enforce allowedTools — block unauthorized tool calls
                const currentAgent = currentAgents[agentIndex];
                if (currentAgent.allowedTools && currentAgent.allowedTools.length > 0 && !currentAgent.allowedTools.includes(toolName)) {
                    output = { error: `Tool "${toolName}" is not in the allowed tools list for agent "${currentAgent.name}". Allowed: ${currentAgent.allowedTools.join(', ')}` };
                    addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'warning', method: `TOOL_BLOCKED: ${toolName}`, content: output });
                    // Skip to history update
                } else {

                addLog({ id: Date.now().toString(), timestamp: Date.now(), type: 'info', method: `TOOL_EXEC: ${toolName}`, content: args });

                // --- SYSTEM TOOLS ---
                const systemOutput = await handleSystemTool(toolName, args, tool.id, agentId, {
                    executeWithRetry,
                    onTerminalOutput,
                    onWriteFileDryRun,
                    getLiveContent,
                });
                if (systemOutput !== null) {
                    output = systemOutput;

                // --- FILE UTILITIES ---
                } else if (toolName === 'find_files') {
                    // Chama /api/system/find — rota dedicada que evita tokenização SSH quebrar globs
                    const findRes = await fetch(`${NEBULA_API_BASE}/system/fs/find`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            path: args.path || args.cwd || undefined,
                            pattern: args.pattern || '*',
                            type: args.type || '',
                            max_depth: args.max_depth || undefined,
                            exclude: args.exclude || [],   // string | string[] — padrões a ignorar
                            relative: args.relative ?? false, // true → retorna caminhos relativos ao path
                            agentId,
                        }),
                    });
                    output = await findRes.json();
                } else if (toolName === 'read_project_json') {
                    // read_project_json(path) — reads and parses a JSON file
                    const raw = await SystemService.readFile(args.path, agentId);
                    const text = typeof raw === 'object' ? (raw as any)?.content ?? JSON.stringify(raw) : String(raw);
                    try { output = JSON.parse(text); }
                    catch { output = { error: 'Failed to parse JSON', raw: text.slice(0, 500) }; }
                } else if (toolName === 'run_tests') {
                    // run_tests(cwd?, command?) — runs test suite
                    const cwd = args.cwd || '.';
                    const cmd = args.command || 'npm test -- --watchAll=false 2>&1 || yarn test --watchAll=false 2>&1';
                    const fullCmd = `cd "${cwd}" && ${cmd}`;
                    output = await SystemService.runCommand(fullCmd, agentId);
                } else if (toolName === 'lint_code') {
                    // lint_code(cwd?, files?) — runs eslint/tsc
                    const cwd = args.cwd || '.';
                    const files = args.files ? args.files.join('\n') : '.';
                    const cmd = `cd "${cwd}" && (npx eslint ${files} --max-warnings=0 2>&1 || echo "eslint not found") && (npx tsc --noEmit 2>&1 || echo "tsc not found")`;
                    output = await SystemService.runCommand(cmd, agentId);
                } else if (toolName === 'format_code') {
                    // format_code(cwd?, files?, check?) — runs prettier
                    const cwd = args.cwd || '.';
                    const files = args.files ? args.files.join('\n') : '.';
                    const checkOnly = args.check === true;
                    const flag = checkOnly ? '--check' : '--write';
                    const cmd = `cd "${cwd}" && npx prettier ${flag} ${files} 2>&1`;
                    output = await SystemService.runCommand(cmd, agentId);

                // --- GIT TOOLS (backend-first) ---
                } else if ([
                    'git_status','git_diff','git_add','git_log','git_commit',
                    'git_checkout','git_tag','git_branch','git_push','git_pull'
                ].includes(toolName)) {
                    output = await executeBackendTool(toolName, args, agentId);
                    if (toolName === 'git_commit' && onGitCommit && output && !(output as any).error) {
                        onGitCommit(args.message ?? '', JSON.stringify(output), agentId);
                    }

                } else if (toolName === 'request_plan_approval') {
                    // Interceptado no App.tsx antes de chegar aqui
                    // Se chegar aqui, apenas confirmar recebimento
                    output = { received: true, status: 'awaiting_user_approval' };

                } else if (toolName === 'send_alert') {
                    addNotification(args.title || 'Agent Alert', args.message, args.alert_type || args.type || 'info');
                    output = { success: true };
                } else if (toolName === 'read_guidelines') {
                    output = { guidelines: guidelines };
                } else if (toolName === 'list_commands') {
                     const combinedTools = [
                        ...SYSTEM_TOOLS.map(t => ({
                            name: t.function.name,
                            description: t.function.description,
                            parameters: t.function.parameters
                        })),
                        ...externalToolsRef.current.map(t => ({
                            name: t.name,
                            description: t.description,
                            parameters: t.parameters,
                            is_external: true
                        }))
                    ];
                    output = { available_tools: combinedTools };
                
                // --- VARIABLE / SECRET MANAGEMENT ---
                } else if (toolName === 'manage_variable' || toolName === 'list_secrets' || toolName === 'get_secret') {
                    output = await executeBackendTool(toolName, args, agentId);
                    // Mirror local apiKeys for immediate UI consistency on set/delete
                    if (toolName === 'manage_variable' && output?.success) {
                        const { action, key, value } = args;
                        let currentKeys = [...apiKeysRef.current];
                        if (action === 'set') {
                            const idx = currentKeys.findIndex(k => k.name === key);
                            if (idx !== -1) currentKeys[idx] = { ...currentKeys[idx], value };
                            else currentKeys.push({ name: key, value });
                            setApiKeys(currentKeys);
                        } else if (action === 'delete') {
                            setApiKeys(currentKeys.filter(k => k.name !== key));
                        }
                    }

                // --- BACKEND-FIRST TOOLS ---
                } else if (['remember_fact','recall_memory'].includes(toolName)) {
                    output = await executeBackendTool(toolName, args, agentId);

                } else if (['create_agent','list_agents','get_agent_details','update_agent_profile','delete_agent','delegate_task','send_agent_message'].includes(toolName)) {
                    output = await executeBackendTool(toolName, args, agentId);
                    if (['create_agent','update_agent_profile','delete_agent'].includes(toolName) && output?.success) await refreshAgentsFromServer();

                } else if (['manage_model','manage_workflow','make_http_request','query_usage_history','update_global_settings'].includes(toolName)) {
                    output = await executeBackendTool(toolName, args, agentId);
                    if (toolName === 'update_global_settings') {
                        const settings = (args.settings && typeof args.settings === 'object') ? args.settings : args;
                        if (settings.ollamaHost) setOllamaHost(settings.ollamaHost);
                        if (settings.theme) setTheme(settings.theme);
                        if (settings.colorTheme) setColorTheme(settings.colorTheme);
                        if (settings.guidelines) setGuidelines(settings.guidelines);
                    }

                } else if (toolName === 'manage_external_tool') {
                    output = await executeBackendTool(toolName, args, agentId);
                    const { action, tool_name, definition } = args;
                    let currentTools = [...externalToolsRef.current];
                    if (output?.success && action === 'add' && tool_name && definition) {
                        const existingIdx = currentTools.findIndex(t => t.name === tool_name);
                        const newTool: ExternalTool = {
                            id: existingIdx !== -1 ? currentTools[existingIdx].id : generateId(),
                            name: tool_name,
                            description: definition.description,
                            parameters: definition.parameters,
                            config: definition.config
                        };
                        if (existingIdx !== -1) currentTools[existingIdx] = newTool; else currentTools.push(newTool);
                        setExternalTools(currentTools);
                    } else if (output?.success && action === 'remove' && tool_name) {
                        setExternalTools(currentTools.filter(t => t.name !== tool_name));
                    }
                } else {
                    // --- DYNAMIC EXTERNAL TOOL EXECUTION ---
                    // Thin-client mode: o frontend não interpola secrets nem executa requests.
                    // O backend é a fonte de verdade para external tools e resolução de {{VAR}}.
                    const extTool = externalToolsRef.current.find(t => t.name === toolName);
                    if (extTool) {
                        output = await executeBackendTool(toolName, args, agentId);
                    } else {
                        output = { error: "Unknown tool" };
                    }
                }
                } // end allowedTools check
            } catch (e: any) {
                output = { error: e.message };
            }

            // Update history after each tool call
            const toolResultContent = (() => {
                const normalizeString = (value: string) => value.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n');

                if (typeof output === 'string') {
                    const trimmed = output.trim();
                    if (!trimmed) return JSON.stringify({ output: '' });
                    try {
                        const parsed = JSON.parse(trimmed);
                        return JSON.stringify(parsed);
                    } catch {
                        return JSON.stringify({ output: normalizeString(output) });
                    }
                }

                try {
                    return JSON.stringify(output);
                } catch {
                    return JSON.stringify({ error: 'Failed to serialize tool output' });
                }
            })();

            const toolResult: Message = {
                role: 'tool',
                content: toolResultContent,
                timestamp: Date.now(),
                tool_call_id: tool.id
            } as Message;

            if (externalHistory) {
                // Modo efêmero: escrever no histórico local temporário
                externalHistory.push(toolResult);
            } else {
                // Modo normal: persistir no agent.history
                const finalAgents = [...agentsRef.current];
                const finalIdx = finalAgents.findIndex(a => a.id === agentId);
                if (finalIdx !== -1) {
                    finalAgents[finalIdx].history.push(toolResult);
                    setAgents(finalAgents);
                    agentsRef.current = finalAgents;
                }
            }
        }
    };

    return { processToolCalls };
};