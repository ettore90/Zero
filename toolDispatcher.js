// =============================================================================
// toolDispatcher.js — Fase 3 do Daemon Mode
// Executa tools server-side sem depender do browser.
// Importado pelo server.js e usado diretamente no loop do /api/chat.
//
// Recebe um contexto (ctx) com as funções internas do servidor:
//   ctx.executeCommand, ctx.executeSSHCommand, ctx.getCwd, ctx.setCwd,
//   ctx.containerToHost, ctx.hostToContainer, ctx.escapeShellArg,
//   ctx.splitCommand, ctx.resolveSafePath, ctx.readState, ctx.writeState,
//   ctx.getAgents, ctx.saveAgents, ctx.PYTHON_CMD, ctx.STORAGE_PATH,
//   ctx.fetchWithRetry, ctx.ollamaServer, ctx.runAgentLoop (para delegate_task)
// =============================================================================

import path from 'path';
import fs from 'fs';
import { executeWorkflowNode as executeWorkflowNodeShared, runScheduledWorkflow } from './workflowExecutor.js';
import { resolveSecretsInObject } from './utils/resolveSecrets.js';
import { appendSubagentAuditLog } from './services/subagentAuditService.js';
import { listAgents, getAgent, upsertAgent, deleteVisibleAgent } from './services/agentStore.js';
import { getCurrentPromptVersion, getOrBootstrapPromptDocumentByAgent, listPromptVersions, upsertPromptDocument, getPromptDocumentById, getPromptDocumentByKey, listPromptBlocks, findPromptBlockById, listPromptBlockVersions, createPromptBlock, createPromptBlockVersion, deletePromptBlock, deletePromptBlockTypeAssignments, inspectPromptBlockAssignmentDrift, reconcilePromptBlockAssignmentDrift, resolvePromptFinalByCompositionForDocument, publishPromptCompositionSnapshot, getOrBootstrapGlobalPromptDocument, listPromptDocumentBlockRefs, resolveEffectivePromptRefsForAgentDocument, rollbackPromptVersion, reorderPromptDocumentBlockRefs, setPromptBlockRefs, resolvePromptUsageMap, resolvePromptOperationalDiff, validatePromptArchitecture } from './services/promptStore.js';
import { rememberMemory, recallMemories, updateMemoryRecord, deleteMemories } from './services/sqliteMemoryTools.js';
import { editSessionNoteLocalized, normalizeSessionNote, hasSessionNoteTarget, readSessionNoteFragment } from './services/sessionNoteService.js';
import { broadcastToUser } from './services/streamBroker.js';
import { pendingApprovals } from './services/runtime.js';
import { appendCommentToPlanItem, broadcastPlanUpdate, findLatestInProgressPlanForAgent, markPlanItemCompleted, normalizePlanForStorage } from './services/planState.js';

const ISOLATED_SUBAGENT_MAX_ITERATIONS = 20;
const ISOLATED_SUBAGENT_TOOL_HEAVY_DEFAULT_ITERATIONS = 20;

function normalizeDelegateConfig(raw = {}, fallback = {}) {
    const mode = raw.mode || fallback.mode || raw.executionMode || fallback.executionMode || 'strict';
    const outputMode = raw.outputMode || fallback.outputMode || ((Array.isArray(raw.expectedOutputFields) && raw.expectedOutputFields.length > 0) ? 'json' : 'text');
    const ephemeral = raw.ephemeral !== undefined ? raw.ephemeral : (fallback.ephemeral !== undefined ? fallback.ephemeral : true);
    const requestedMaxIterations = Number(raw.maxIterations ?? fallback.maxIterations ?? ISOLATED_SUBAGENT_TOOL_HEAVY_DEFAULT_ITERATIONS) || ISOLATED_SUBAGENT_TOOL_HEAVY_DEFAULT_ITERATIONS;
    const maxIterations = Math.max(2, Math.min(requestedMaxIterations, ISOLATED_SUBAGENT_MAX_ITERATIONS));
    const timeoutSeconds = Math.max(5, Math.min(Number(raw.timeoutSeconds || fallback.timeoutSeconds || 45) || 45, 300));
    const targetEnvironment = raw.targetEnvironment || fallback.targetEnvironment || '';
    const targetRoot = raw.targetRoot || fallback.targetRoot || '';
    const forbiddenRoots = normalizeStringList(raw.forbiddenRoots ?? fallback.forbiddenRoots).filter((item) => String(item || '').trim());
    return {
        mode,
        outputMode,
        expectedOutputFields: Array.isArray(raw.expectedOutputFields) ? raw.expectedOutputFields.filter(Boolean) : [],
        expectedSchema: raw.expectedSchema && typeof raw.expectedSchema === 'object' ? raw.expectedSchema : null,
        expectedOutputDescription: raw.expectedOutputDescription || fallback.expectedOutputDescription || '',
        contextMode: raw.contextMode || fallback.contextMode || 'task-only',
        ephemeral,
        maxIterations,
        timeoutSeconds,
        targetEnvironment,
        targetRoot,
        forbiddenRoots,
    };
}

function buildDelegatePromptPayload({ subAgent, task, config }) {
    const requiresJson = config.outputMode === 'json' || config.expectedOutputFields.length > 0;
    const fixedHeader = [
        `AGENT_ID: ${subAgent.id}`,
        `AGENT_NAME: ${subAgent.name}`,
        `AGENT_ROLE: ${subAgent.role || (subAgent.isMaster ? 'master' : 'worker')}`,
        `EXECUTION_MODE: ${config.mode}`,
        `OUTPUT_MODE: ${config.outputMode}`,
        `EPHEMERAL: ${config.ephemeral ? 'true' : 'false'}`,
        `MAX_ITERATIONS: ${config.maxIterations}`,
        `TARGET_ENVIRONMENT: ${config.targetEnvironment || ''}`,
        `TARGET_ROOT: ${config.targetRoot || ''}`,
        `FORBIDDEN_ROOTS: ${(config.forbiddenRoots || []).join(', ')}`,
        'RULES: no nested delegation; execute directly; keep final answer short; output exactly one final payload only; no prose before or after the payload',
        `FINAL_RESPONSE_MODE: ${requiresJson ? 'json' : 'text'}`,
    ].join('\n');
    const contractBlock = [
        config.expectedOutputFields.length ? `EXPECTED_FIELDS: ${config.expectedOutputFields.join(', ')}` : null,
        config.expectedOutputDescription ? `EXPECTED_OUTPUT: ${config.expectedOutputDescription}` : null,
        config.expectedSchema ? `EXPECTED_SCHEMA: ${JSON.stringify(config.expectedSchema)}` : null,
        requiresJson
            ? 'FINAL_RULES: respond once with exactly one valid JSON object; no markdown fences; no explanatory prose; all required fields must be present; if a string field is unavailable use an empty string, if an array field is unavailable use [], if a boolean field is unavailable use false, if an object field is unavailable use {}.'
            : 'FINAL_RULES: respond once with plain text only; no markdown fences; no explanatory preface or trailing commentary.',
    ].filter(Boolean).join('\n');
    const dynamicTaskBlock = `TASK:\n${String(task || '').trim()}`;
    return [fixedHeader, contractBlock, dynamicTaskBlock].filter(Boolean).join('\n\n');
}

function normalizeStringList(value) {
    if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
    if (value === undefined || value === null) return [];
    return [String(value)];
}

function getSessionNotes(session) {
    if (!session || typeof session !== 'object') return [];

    const notes = Array.isArray(session.notes) ? session.notes : [];
    const deduped = [];
    const seen = new Set();

    for (const note of notes) {
        if (!note) continue;
        const key = String(note?.noteId ?? note?.id ?? '').trim();
        if (key) {
            if (seen.has(key)) continue;
            seen.add(key);
        }
        deduped.push(note);
    }

    return deduped;
}

function normalizeNoteUpdatedAt(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
}

function sortNotesByUpdatedAtDesc(notes) {
    return [...notes].sort((a, b) => {
        const diff = normalizeNoteUpdatedAt(b?.updatedAt) - normalizeNoteUpdatedAt(a?.updatedAt);
        if (diff !== 0) return diff;
        return String(b?.id || b?.noteId || '').localeCompare(String(a?.id || a?.noteId || ''));
    });
}

function getActiveNote(session) {
    const notes = sortNotesByUpdatedAtDesc(getSessionNotes(session));
    const activeNoteId = String(session?.activeNoteId || session?.active_note || '').trim();
    if (activeNoteId) {
        const byActiveId = notes.find((note) => String(note?.id || note?.noteId || '').trim() === activeNoteId);
        if (byActiveId) return byActiveId;
    }
    return notes.find((note) => Boolean(note?.active || note?.isActive)) || notes[0] || null;
}

function findNoteById(session, noteId) {
    const targetNoteId = String(noteId || '').trim();
    if (!targetNoteId) return null;
    return getSessionNotes(session).find((note) => String(note?.id || note?.noteId || '').trim() === targetNoteId) || null;
}

function resolveNoteAlias(session, noteId) {
    const normalized = String(noteId || '').trim();
    if (!normalized) return null;
    if (normalized === 'active_note' || normalized === 'active-note' || normalized === 'active') {
        return getActiveNote(session);
    }
    return findNoteById(session, normalized);
}

function getUserSessions(sessionStore, username) {
    if (!sessionStore?.getSessions) return [];
    const sessions = sessionStore.getSessions(username);
    return Array.isArray(sessions) ? sessions.filter(Boolean) : [];
}

function findNoteGloballyForUser(sessionStore, username, noteId) {
    const targetNoteId = String(noteId || '').trim();
    if (!targetNoteId) return null;

    for (const session of getUserSessions(sessionStore, username)) {
        const note = findNoteById(session, targetNoteId);
        if (note) {
            return { session, note };
        }
    }

    return null;
}

function listNotesGloballyForUser(sessionStore, username) {
    const collected = [];

    for (const session of getUserSessions(sessionStore, username)) {
        const activeNote = getActiveNote(session);
        const activeNoteId = String(activeNote?.id || activeNote?.noteId || '').trim();
        for (const note of getSessionNotes(session)) {
            const noteId = String(note?.id || note?.noteId || '').trim();
            const { content, contentHtml, body, text, markdown, ...metadata } = note && typeof note === 'object' ? note : {};
            collected.push({
                ...metadata,
                sessionId: session.id,
                isActive: Boolean(activeNoteId && noteId && activeNoteId === noteId),
            });
        }
    }

    return sortNotesByUpdatedAtDesc(collected);
}


function areSessionNotesEnabled(session) {
    if (!session || typeof session !== 'object') return false;
    if (session.notesEnabled === true) return true;
    if (session.notesEnabled === false) return false;
    const hasLegacyNotes = getSessionNotes(session).length > 0 || String(session.activeNoteId || session.active_note || '').trim().length > 0;
    return hasLegacyNotes;
}

function buildNotesDisabledError(sessionId = null) {
    return {
        error: 'Notes tools are disabled for this session',
        sessionId: sessionId || null,
        notesEnabled: false,
    };
}

function resolveNotesToolSession(sessionStore, username, agentId, requestedSessionId) {
    const resolved = resolveSessionNoteTargetSession(sessionStore, username, agentId, requestedSessionId);
    if (resolved.error) return resolved;
    const session = resolved.session || (sessionStore?.getSession ? sessionStore.getSession(resolved.sessionId) : null);
    if (!session) return { error: 'Session not found' };
    if (String(session.username) !== String(username)) return { error: 'Forbidden' };
    return { sessionId: resolved.sessionId || session.id, session };
}

function persistAndBroadcastSessionNoteChange({ sessionStore, session, username, event = {} }) {
    if (sessionStore?.saveSession) sessionStore.saveSession(session);
    const payload = {
        sessionId: String(session?.id || ''),
        activeNoteId: session?.activeNoteId ? String(session.activeNoteId) : null,
        operation: event?.operation || 'updated',
        noteId: event?.noteId ? String(event.noteId) : null,
        deletedNoteId: event?.deletedNoteId ? String(event.deletedNoteId) : null,
    };
    broadcastToUser(username || session?.username, 'session_updated', payload);
    return payload;
}

const APP_INSTANCE_SLUG = String(process.env.APP_INSTANCE_SLUG || '').trim().toLowerCase();
const SYSTEM_AGENT_ID = String(process.env.SYSTEM_AGENT_ID || APP_INSTANCE_SLUG || '').trim().toLowerCase();

function looksLikeAgentIdentifier(value) {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return false;
    return v.startsWith('agent-') || v === SYSTEM_AGENT_ID;
}

function chooseDefaultChatModel(models = []) {
    const candidates = Array.isArray(models) ? models : [];
    const preferred = candidates.find((m) => {
        const modelId = String(m?.modelId || m?.name || '').toLowerCase();
        return modelId && !modelId.includes('embed') && !modelId.includes('embedding');
    });
    return preferred || candidates[0] || null;
}


function resolveSessionNoteTargetSession(sessionStore, username, agentId, requestedSessionId) {
    const normalizedSessionId = String(requestedSessionId || '').trim();
    if (!normalizedSessionId) return { error: 'sessionId required' };
    if (normalizedSessionId !== 'current' && normalizedSessionId !== 'active') {
        return { sessionId: normalizedSessionId };
    }

    const activeAgent = agentId ? getAgent(username, agentId) : null;
    const activeSessionId = String(activeAgent?.activeSessionId || '').trim();
    if (activeSessionId) {
        const activeSession = sessionStore?.getSession ? sessionStore.getSession(activeSessionId) : null;
        if (activeSession && String(activeSession.username) === String(username) && String(activeSession.agentId ?? '') === String(agentId ?? '')) {
            return { sessionId: activeSession.id, session: activeSession };
        }
    }

    const sessions = sessionStore?.getSessions ? sessionStore.getSessions(username, agentId) : [];
    const recentSession = Array.isArray(sessions) ? sessions[0] : null;
    if (recentSession && String(recentSession.username) === String(username) && String(recentSession.agentId ?? '') === String(agentId ?? '')) {
        return { sessionId: recentSession.id, session: recentSession };
    }

    return { error: 'No resolvable session for alias current/active' };
}

function resolvePromptDocumentTarget(args = {}, username = '') {
    const rawIdentifier = args.agentId || args.identifier || args.name || '';
    const targetId = String(rawIdentifier || '').trim();
    const documentId = String(args.documentId || '').trim();
    const documentKey = String(args.documentKey || args.key || '').trim();
    const agents = listAgents(username);
    const target = targetId ? agents.find(a => a.id === targetId || a.id.toLowerCase() === targetId.toLowerCase() || a.name?.toLowerCase() === targetId.toLowerCase()) : null;
    if (targetId && !target) return { error: `Agent '${rawIdentifier}' not found.` };
    const document = target
        ? getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(target.id) })
        : (documentId ? getPromptDocumentById(documentId) : (documentKey ? getPromptDocumentByKey(documentKey) : null));
    return { target, document };
}

function resolvePromptDocumentTargetWithGlobal(args = {}, username = '') {
    const wantsGlobal = Boolean(args.global || String(args.scope || '').trim().toLowerCase() === 'global');
    if (wantsGlobal) {
        const document = getOrBootstrapGlobalPromptDocument();
        return { target: null, document, scope: 'global' };
    }
    const resolved = resolvePromptDocumentTarget(args, username);
    const scope = resolved?.target ? 'agent' : 'document';
    return { ...resolved, scope };
}

function serializePromptDocument(document) {
    if (!document) return null;
    return {
        id: document.id,
        key: document.key,
        title: document.title,
        currentVersionId: document.currentVersionId || null,
        metadata: document.metadata || {},
        createdAt: document.createdAt || null,
        updatedAt: document.updatedAt || null,
    };
}

function serializePromptRef(ref) {
    if (!ref) return null;
    return {
        id: ref.id,
        documentId: ref.documentId,
        blockId: ref.blockId,
        blockVersionId: ref.blockVersionId || null,
        pinnedBlockVersionId: ref.pinnedBlockVersionId || null,
        followCurrent: !!ref.followCurrent,
        blockType: ref.blockType || null,
        position: ref.position ?? null,
        included: !!ref.included,
        canonicalRefIdentity: ref.canonicalRefIdentity || null,
        metadata: ref.metadata || {},
        createdAt: ref.createdAt || null,
        updatedAt: ref.updatedAt || null,
    };
}

function ensurePromptBlockMatchesContext(block, args = {}, username = '') {
    const wantsContext = Boolean(args.agentId || args.identifier || args.name || args.documentId || args.documentKey || args.key);
    if (!wantsContext) return null;
    const { error, document } = resolvePromptDocumentTarget(args, username);
    if (error) return { error };
    if (!document?.id) return { error: 'Prompt document not found.' };
    if (String(block?.documentId || '') !== String(document.id)) {
        return { error: 'Prompt block does not belong to the resolved prompt document.' };
    }
    return { document };
}

function resolveSessionNoteTarget(sessionStore, username, agentId, requestedSessionId, requestedNoteId) {
    const sessionTarget = resolveSessionNoteTargetSession(sessionStore, username, agentId, requestedSessionId);
    if (sessionTarget?.error || !sessionTarget?.session) return sessionTarget;
    const noteId = String(requestedNoteId || '').trim();
    if (!noteId) {
        const activeNote = getActiveNote(sessionTarget.session);
        return activeNote ? { ...sessionTarget, note: activeNote } : sessionTarget;
    }
    const resolvedNote = resolveNoteAlias(sessionTarget.session, noteId);
    return resolvedNote ? { ...sessionTarget, note: resolvedNote } : { ...sessionTarget, error: 'No resolvable note for alias active_note/noteId' };
}

function summarizeRawDelegateOutput(value, maxChars = 600) {
    if (value === undefined || value === null) return '';
    const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const compact = String(raw).trim();
    if (!compact) return '';
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, maxChars)}...[truncated ${compact.length - maxChars} chars]`;
}

function safeJsonParse(value) {
    if (value && typeof value === 'object') return value;
    const text = String(value || '').trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch {}
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) {
        try { return JSON.parse(fenced[1]); } catch {}
    }

    const extractBalancedJsonObject = (input) => {
        let start = -1;
        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = 0; i < input.length; i += 1) {
            const ch = input[i];

            if (start === -1) {
                if (ch === '{') {
                    start = i;
                    depth = 1;
                }
                continue;
            }

            if (inString) {
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (ch === '\\') {
                    escaped = true;
                    continue;
                }
                if (ch === '"') {
                    inString = false;
                }
                continue;
            }

            if (ch === '"') {
                inString = true;
                continue;
            }

            if (ch === '{') depth += 1;
            if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    return input.slice(start, i + 1);
                }
            }
        }

        return null;
    };

    const balanced = extractBalancedJsonObject(text);
    if (balanced) {
        try { return JSON.parse(balanced); } catch {}
    }
    return null;
}

export async function invokeAgentWithContract({
    runAgentLoop,
    broadcastToUser,
    username,
    orchestratorAgentId,
    subAgent,
    task,
    delegateConfig,
    systemContext,
    delegatedExecution = 'standard',
}) {
    delegateConfig = normalizeDelegateConfig(delegateConfig || {}, { mode: subAgent?.executionMode || 'strict' });
    const timeoutSeconds = Number(delegateConfig?.timeoutSeconds ?? 45);
    const timeoutMs = timeoutSeconds * 1000;
    const payload = buildDelegatePromptPayload({ subAgent, task, config: delegateConfig });
    const subMessages = systemContext
        ? [{ role: 'system', content: systemContext }, { role: 'user', content: payload }]
        : [{ role: 'user', content: payload }];
    const subAgentRole = subAgent?.role || (subAgent?.isMaster ? 'master' : 'worker');
    const isDelegatedMaster = subAgentRole === 'master';

    return runAgentLoop({
        username,
        agentId: subAgent.id,
        messages: subMessages,
        isEphemeral: delegateConfig.ephemeral || isDelegatedMaster,
        timeoutMs,
        sandbox: {
            mode: 'isolated-subagent',
            orchestratorAgentId,
            task,
            contract: { ...delegateConfig, delegatedExecution },
            maxIterations: delegateConfig.maxIterations,
            delegatedAgentRole: subAgentRole,
            disableSessionPersistence: isDelegatedMaster,
        },
        onEvent: (event, data) => {
            broadcastToUser?.(username, 'delegate_status', {
                masterAgentId: orchestratorAgentId,
                subAgentId: subAgent.id,
                subAgentName: subAgent.name,
                status: event,
                detail: data || null,
            });
        },
    });
}

function estimateSerializedSize(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

function truncateJiraQueueToolPayload(payload) {
    const issueList = Array.isArray(payload?.issues) ? payload.issues : null;
    if (!payload || typeof payload !== 'object' || !issueList) return payload;

    const MAX_SERIALIZED_BYTES = 120000;
    const SAMPLE_ISSUES = 5;
    const estimatedBytes = estimateSerializedSize(payload);
    if (estimatedBytes <= MAX_SERIALIZED_BYTES) return payload;

    const sampledIssues = issueList.slice(0, SAMPLE_ISSUES);
    const omittedIssues = Math.max(issueList.length - sampledIssues.length, 0);

    return {
        ...payload,
        issues: sampledIssues,
        returned: sampledIssues.length,
        truncated: true,
        truncation: {
            surface: 'tool_dispatcher',
            reason: 'jira_queue tool response truncated to protect model context from oversized payloads',
            estimatedBytes,
            maxBytes: MAX_SERIALIZED_BYTES,
            originalReturned: issueList.length,
            returnedSample: sampledIssues.length,
            omittedIssues,
            analyticalGuidance: 'For large Jira result sets, use run_python_code or the analytical workflow to process exported data instead of loading the full raw queue payload into model context.',
        },
    };
}


// ---------------------------------------------------------------------------
// dispatchTool — entry point principal
// ---------------------------------------------------------------------------
function getToolCallerContext(ctx = {}) {
    if (!ctx || typeof ctx !== 'object') return null;
    const callerContext = ctx.callerContext;
    return callerContext && typeof callerContext === 'object' ? callerContext : null;
}

function getToolTimeoutMs(ctx = {}) {
    const value = Number(ctx?.toolTimeoutMs);
    return Number.isFinite(value) && value > 0 ? value : null;
}

function buildToolTrustMetadata(toolName, output) {
    const normalized = String(toolName || '').trim();
    const trustedSensitiveTools = new Set(['get_secret']);
    const untrustedTools = new Set(['make_http_request']);
    const semiTrustedTools = new Set([
        'read_file',
        'recall_memory',
        'delegate_task',
        'send_agent_message',
        'list_agents',
        'get_agent_details',
    ]);

    let level = 'semi-trusted';
    let source = normalized || 'tool';
    let contentType = 'mixed';

    if (trustedSensitiveTools.has(normalized)) {
        level = 'trusted-sensitive';
    } else if (untrustedTools.has(normalized)) {
        level = 'untrusted';
    } else if (semiTrustedTools.has(normalized)) {
        level = 'semi-trusted';
    }

    return {
        level,
        source,
        contentType,
    };
}

export async function dispatchTool(toolName, args, agentId, username, ctx) {
    const callerContext = getToolCallerContext(ctx);
    const timeoutMs = getToolTimeoutMs(ctx);
    try {
        const output = await _dispatch(toolName, args, agentId, username, ctx);
        return { output, trust: buildToolTrustMetadata(toolName, output), callerContext, timeoutMs };
    } catch (err) {
        console.error(`[Tool] ✗ ${toolName} | ${err.message}`);
        return {
            output: { error: err.message },
            trust: buildToolTrustMetadata(toolName, { error: err.message }),
            callerContext,
            timeoutMs,
        };
    }
}

async function _dispatch(toolName, args, agentId, username, ctx) {
    const { executeSSHCommand, executeSSHWrite, executeGit, getCwd, setCwd,
            containerToHost, hostToContainer, escapeShellArg,
            splitCommand, resolveSafePath, readState, writeState, getAgents, saveAgents,
            PYTHON_CMD, STORAGE_PATH, sessionStore,
            MEMORY_FILE, fetchWithRetry, OLLAMA_SERVER,
            runAgentLoop, broadcastToUser } = ctx;

    const getEffectiveContainerCwd = (override) => override || getCwd(agentId) || '/';

    // Helper para executar comando e retornar resultado
    const runCmd = (cmd, cwd) => new Promise((resolve) => {
        const containerCwd = getEffectiveContainerCwd(cwd);
        // executeSSHCommand runs locally — pass container path directly, no host translation
        executeSSHCommand(cmd, containerCwd, (result) => resolve(result));
    });

    // Resolve path: if relative, prepend agent's cwd
    const resolvePath = (p) => (p && !p.startsWith('/')) ? `${getEffectiveContainerCwd()}/${p}` : (p || getEffectiveContainerCwd());

    // Helper para ler arquivo via SSH
    const readFileSSH = (filePath) => new Promise((resolve, reject) => {
        const resolvedPath = resolvePath(filePath);
        const parentDir = path.posix.dirname(resolvedPath);
        const baseName = path.posix.basename(resolvedPath);
        // executeSSHCommand runs locally — pass container path directly, no host translation
        executeSSHCommand(`cat ${escapeShellArg(baseName)}`, parentDir, (result) => {
            if (result.exitCode !== 0) reject(new Error(`Cannot read file: ${result.error}`));
            else resolve(result.output);
        });
    });

    // =========================================================================
    // GRUPO A — System / File / Git
    // =========================================================================

    const isNonEmptyObject = (value) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;

    if (toolName === 'run_terminal_command') {
        const { command, cwd: argCwd, env = {}, timeout } = args;
        const cwd = getEffectiveContainerCwd(argCwd);
        const trimmedCmd = String(command || '').trim();
        if (!trimmedCmd) return { error: 'Empty command' };

        // Handle cd — mantém estado por agente
        if (trimmedCmd === 'cd' || trimmedCmd.startsWith('cd ')) {
            const target = trimmedCmd === 'cd' ? '~' : trimmedCmd.substring(3).trim();
            const resolveCmd = `cd ${escapeShellArg(target)} && pwd`;
            const result = await runCmd(resolveCmd, cwd);
            if (result.exitCode !== 0) {
                return { output: '', error: `bash: cd: ${target}: ${result.error}`, cwd };
            }
            const newCwd = hostToContainer(result.output.trim());
            if (newCwd && newCwd.startsWith('/')) setCwd(agentId, newCwd);
            return { output: '', error: '', cwd: getCwd(agentId) };
        }

        // Bloqueia comandos interativos que travam o loop do agente
        const interactivePattern = /(^|\s)(vi|vim|nvim|nano|less|more|top|htop|watch|man|ssh|sftp|scp|ftp|telnet|tmux|screen)(\s|$)/i;
        if (interactivePattern.test(trimmedCmd)) {
            return { output: '', error: 'Interactive command blocked. Use non-interactive shell commands only.', exitCode: 126, cwd: getCwd(agentId) };
        }

                const timeoutSeconds = Math.max(1, Math.min(Number(timeout) || 60, 600));
        const envPrefix = Object.entries(env || {})
            .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
            .map(([key, value]) => `${key}=${escapeShellArg(String(value))}`)
            .join(' ');

        const wrapped = `${envPrefix ? `${envPrefix} ` : ''}timeout ${timeoutSeconds}s sh -lc ${escapeShellArg(trimmedCmd)}`;
        const result = await runCmd(wrapped, cwd);
        return { output: result.output, error: result.error, exitCode: result.exitCode, cwd: getCwd(agentId) };
    }

    if (toolName === 'run_python_code') {
        const cwd = getEffectiveContainerCwd();
        const b64Code = Buffer.from(args.code).toString('base64');
        const remoteCmd = `PYTHON_BIN=""; for candidate in ${escapeShellArg(PYTHON_CMD)} python3 python /usr/bin/python3 /usr/local/bin/python3; do if [ -n "$candidate" ] && command -v "$candidate" >/dev/null 2>&1; then PYTHON_BIN="$candidate"; break; fi; done; if [ -z "$PYTHON_BIN" ]; then echo "Python interpreter not found. Checked: ${PYTHON_CMD}, python3, python, /usr/bin/python3, /usr/local/bin/python3" >&2; exit 127; fi; printf "%s" ${escapeShellArg(b64Code)} | base64 -d | "$PYTHON_BIN"`;
        const result = await runCmd(remoteCmd, cwd);
        return { output: result.output, error: result.error, exitCode: result.exitCode, pythonCommand: result.exitCode === 0 ? 'resolved dynamically' : undefined };
    }


    if (toolName === 'set_session_notes_enabled') {
        const resolved = resolveNotesToolSession(sessionStore, username, agentId, args.sessionId);
        if (resolved.error) return { error: resolved.error };
        const { sessionId, session } = resolved;
        session.notesEnabled = args.enabled === true;
        if (sessionStore?.saveSession) sessionStore.saveSession(session);
        broadcastToUser(session.username || username, 'session_updated', {
            sessionId: String(sessionId || session.id || ''),
            notesEnabled: session.notesEnabled === true,
            operation: 'notes_tools_toggled',
        });
        return {
            success: true,
            sessionId: String(sessionId || session.id || ''),
            enabled: session.notesEnabled === true,
            updatedAt: session.updatedAt || Date.now(),
        };
    }


    if (toolName === 'read_note') {
        const access = resolveNotesToolSession(sessionStore, username, agentId, args.sessionId);
        if (access.error) return { error: access.error };
        if (!areSessionNotesEnabled(access.session)) return buildNotesDisabledError(access.sessionId);
        const requestedId = String(args.noteId || '').trim();
        const requestsActiveAlias = requestedId === 'active_note' || requestedId === 'active-note' || requestedId === 'active';

        let session = null;
        let targetNote = null;

        if (requestedId && !requestsActiveAlias && !String(args.sessionId || '').trim()) {
            const globalMatch = findNoteGloballyForUser(sessionStore, username, requestedId);
            if (!globalMatch) return { error: 'Note not found' };
            session = globalMatch.session;
            targetNote = globalMatch.note;
        } else {
            const resolved = resolveSessionNoteTargetSession(sessionStore, username, agentId, args.sessionId);
            if (resolved.error) return { error: resolved.error };
            session = resolved.session || (sessionStore?.getSession ? sessionStore.getSession(resolved.sessionId) : null);
            if (!session) return { error: 'Session not found' };
            targetNote = requestedId ? resolveNoteAlias(session, requestedId) : getActiveNote(session);
            if (!targetNote) return { error: 'Note not found' };
        }

        if (session.username !== username) return { error: 'Forbidden' };

        const targetNoteId = String(targetNote.id || targetNote.noteId || '').trim() || null;
        const activeNote = getActiveNote(session);
        const activeNoteId = String(activeNote?.id || activeNote?.noteId || '').trim();
        const normalizedTargetNoteId = String(targetNote?.id || targetNote?.noteId || '').trim();
        const isActive = Boolean(activeNoteId && normalizedTargetNoteId && activeNoteId === normalizedTargetNoteId);
        const target = {
            blockId: args.blockId,
            sectionId: args.sectionId,
            anchor: args.anchor,
        };
        const includeHtml = args.includeHtml !== false;
        const includeText = args.includeText === true;

        if (hasSessionNoteTarget(target)) {
            const result = readSessionNoteFragment(targetNote, target, { includeHtml, includeText });
            if (!result?.found) return { error: 'Session note target not found', target };
            return {
                sessionId: session.id,
                noteId: targetNoteId,
                isActive,
                version: targetNote.version || 0,
                target: result.target,
                fragment: result.fragment,
            };
        }

        const note = targetNote && typeof targetNote === 'object'
            ? (() => {
                const { content, body, text, markdown, ...rest } = targetNote;
                return rest;
            })()
            : targetNote;

        return {
            sessionId: session.id,
            noteId: targetNoteId,
            isActive,
            note,
        };
    }

    if (toolName === 'write_note') {
        const access = resolveNotesToolSession(sessionStore, username, agentId, args.sessionId);
        if (access.error) return { error: access.error };
        if (!areSessionNotesEnabled(access.session)) return buildNotesDisabledError(access.sessionId);
        if (Object.prototype.hasOwnProperty.call(args || {}, 'content')) {
            return { error: 'write_note no longer accepts `content`; use `contentHtml` instead' };
        }
        const { sessionId, noteId, title, expectedVersion, target, operation, contentHtml, operations } = args;
        const normalizedOperations = Array.isArray(operations) ? operations.map((op) => {
            if (!op || typeof op !== 'object') return op;
            const ref = { ...(op.ref && typeof op.ref === 'object' ? op.ref : {}) };
            const opTarget = op.target && typeof op.target === 'object' ? op.target : null;
            if (!ref.blockId && opTarget?.blockId) ref.blockId = opTarget.blockId;
            if (!ref.sectionId && opTarget?.sectionId) ref.sectionId = opTarget.sectionId;
            if (!ref.anchor && opTarget?.anchor) ref.anchor = opTarget.anchor;
            if (!ref.sectionId && target?.sectionId) ref.sectionId = target.sectionId;
            if (!ref.blockId && target?.blockId) ref.blockId = target.blockId;
            if (!ref.anchor && target?.anchor) ref.anchor = target.anchor;
            const normalizedOp = {
                ...op,
                type: op.type || op.operation,
                operation: op.operation || op.type,
                ref: Object.keys(ref).length ? ref : undefined,
                target: opTarget || undefined,
                contentHtml: typeof op.contentHtml === 'string' ? op.contentHtml : undefined,
            };
            if (!normalizedOp.type) delete normalizedOp.type;
            if (!normalizedOp.operation) delete normalizedOp.operation;
            if (!normalizedOp.target) delete normalizedOp.target;
            if (!normalizedOp.contentHtml) delete normalizedOp.contentHtml;
            if (!normalizedOp.ref) delete normalizedOp.ref;
            return normalizedOp;
        }) : [];
        const hasLocalizedEdit = normalizedOperations.length > 0 || Boolean(operation && target);
        const resolved = resolveSessionNoteTargetSession(sessionStore, username, agentId, sessionId);
        if (resolved.error) return { error: resolved.error };
        const session = resolved.session || (sessionStore?.getSession ? sessionStore.getSession(resolved.sessionId) : null);
        if (!session) return { error: 'Session not found' };
        if (session.username !== username) return { error: 'Forbidden' };

        if (hasLocalizedEdit) {
            const requestedNoteId = String(noteId || '').trim();
            const existingNote = requestedNoteId ? resolveNoteAlias(session, requestedNoteId) : getActiveNote(session);
            if (!existingNote) return { error: 'Note not found' };
            const localizedExpectedVersion = expectedVersion === undefined ? existingNote.version : expectedVersion;
            const localizedTarget = target && typeof target === 'object' ? { ...target } : undefined;
            const localizedOperation = operation;
            const localizedContentHtml = typeof contentHtml === 'string' ? contentHtml : undefined;
            const localizedBlockId = String(target?.blockId || normalizedOperations.find((op) => op && typeof op === 'object' && op.target && typeof op.target === 'object' && op.target.blockId)?.target?.blockId || normalizedOperations.find((op) => op && typeof op === 'object' && op.ref && typeof op.ref === 'object' && op.ref.blockId)?.ref?.blockId || '').trim();
            const localizedPayload = { expectedVersion: localizedExpectedVersion, target: localizedTarget, operation: localizedOperation, contentHtml: localizedContentHtml, operations: normalizedOperations.length > 0 ? normalizedOperations : operations };
            if (localizedBlockId) localizedPayload.blockId = localizedBlockId;
            const localizedResult = await editSessionNoteLocalized(existingNote, localizedPayload, session.username || 'agent');
            const localizedNote = localizedResult?.note && typeof localizedResult.note === 'object' ? localizedResult.note : localizedResult;
            const finalizedNote = title !== undefined && title !== '' ? { ...localizedNote, title } : localizedNote;
            const noteIdentity = String(existingNote.noteId || existingNote.id || requestedNoteId || '');
            const notes = getSessionNotes(session).map((note) => String(note?.noteId || note?.id || '') === noteIdentity ? finalizedNote : note);
            session.notes = notes;
            session.activeNoteId = String(finalizedNote.noteId || finalizedNote.id || session.activeNoteId || '');
            persistAndBroadcastSessionNoteChange({
                sessionStore,
                session,
                username: session.username,
                event: {
                    operation: 'updated',
                    noteId: String(finalizedNote.noteId || finalizedNote.id || ''),
                },
            });

            return {
                success: true,
                sessionId: session.id,
                operation: 'updated',
                noteId: String(finalizedNote.noteId || finalizedNote.id || ''),
                note: finalizedNote,
                appliedOperations: Array.isArray(localizedResult?.appliedOperations) ? localizedResult.appliedOperations : undefined,
                resolvedTarget: localizedResult?.resolvedTarget || undefined,
            };
        }

        const requestedNoteId = String(noteId || '').trim();
        const existing = requestedNoteId ? resolveNoteAlias(session, requestedNoteId) : null;
        const base = existing || {};
        const resolvedNoteId = String(base.noteId || base.id || requestedNoteId || `note_${Date.now()}`).trim();
        const legacyOperation = existing ? 'updated' : 'created';
        const structuredInput = (args && typeof args === 'object' && !Array.isArray(args) && (args.rootType === 'session-note' || Array.isArray(args.sections) || (args.structured && typeof args.structured === 'object')))
            ? {
                rootType: args.rootType,
                sections: args.sections,
                structured: args.structured,
                summary: args.summary,
            }
            : null;
        const usesStructuredPayload = Boolean(
            structuredInput
            && typeof structuredInput === 'object'
            && !Array.isArray(structuredInput)
            && (
                structuredInput.rootType === 'session-note'
                || Array.isArray(structuredInput.sections)
                || (structuredInput.structured && typeof structuredInput.structured === 'object')
            )
        );
        const normalizedStructuredNote = usesStructuredPayload
            ? normalizeSessionNote({
                ...structuredInput,
                noteId: resolvedNoteId,
                title: title !== undefined ? title : (structuredInput.title !== undefined ? structuredInput.title : (base.title || '')),
            }, username, existing || null)
            : null;
        const nextNote = usesStructuredPayload ? {
            ...base,
            ...normalizedStructuredNote,
            id: base.id || resolvedNoteId,
            noteId: normalizedStructuredNote?.noteId || base.noteId || resolvedNoteId,
            title: normalizedStructuredNote?.title ?? (title !== undefined ? title : (base.title || '')),
            contentHtml: normalizedStructuredNote?.contentHtml || '',
            updatedAt: new Date((normalizedStructuredNote?.updatedAt) || Date.now()).toISOString(),
            updatedBy: normalizedStructuredNote?.updatedBy || username,
        } : {
            ...base,
            id: base.id || resolvedNoteId,
            noteId: base.noteId || resolvedNoteId,
            title: title !== undefined ? title : (base.title || ''),
            contentHtml: typeof contentHtml === 'string' ? contentHtml : (base.contentHtml || ''),
            updatedAt: new Date().toISOString(),
            updatedBy: username,
        };
        if (!existing && !nextNote.createdAt) {
            nextNote.createdAt = nextNote.updatedAt;
        }
        const noteIdentity = String(nextNote.noteId || nextNote.id || '');
        const notes = getSessionNotes(session).filter((note) => String(note?.noteId || note?.id || '') !== noteIdentity);
        notes.unshift(nextNote);
        session.notes = notes;
        session.activeNoteId = String(nextNote.noteId || nextNote.id || '');
        persistAndBroadcastSessionNoteChange({
            sessionStore,
            session,
            username: session.username,
            event: {
                operation: legacyOperation,
                noteId: String(nextNote.noteId || nextNote.id || ''),
            },
        });

        return {
            success: true,
            sessionId: session.id,
            operation: legacyOperation,
            noteId: String(nextNote.noteId || nextNote.id || ''),
            note: nextNote,
        };
    }

    if (toolName === 'delete_note') {
        const access = resolveNotesToolSession(sessionStore, username, agentId, args.sessionId);
        if (access.error) return { error: access.error };
        if (!areSessionNotesEnabled(access.session)) return buildNotesDisabledError(access.sessionId);
        const resolved = resolveSessionNoteTargetSession(sessionStore, username, agentId, args.sessionId);
        if (resolved.error) return { error: resolved.error };
        const session = resolved.session || (sessionStore?.getSession ? sessionStore.getSession(resolved.sessionId) : null);
        if (!session) return { error: 'Session not found' };
        if (session.username !== username) return { error: 'Forbidden' };

        const targetNote = String(args.noteId || '').trim() ? resolveNoteAlias(session, args.noteId) : getActiveNote(session);
        if (!targetNote) return { error: 'Note not found' };
        const removedId = String(targetNote.noteId || targetNote.id || '');
        const notes = getSessionNotes(session).filter((note) => String(note?.noteId || note?.id || '') !== removedId);
        session.notes = notes;
        if (String(session.activeNoteId || '') === removedId) {
            const nextActive = getActiveNote(session);
            session.activeNoteId = String(nextActive?.noteId || nextActive?.id || '');
        }
        persistAndBroadcastSessionNoteChange({
            sessionStore,
            session,
            username: session.username,
            event: {
                operation: 'deleted',
                deletedNoteId: removedId,
            },
        });
        return {
            success: true,
            sessionId: session.id,
            deletedNoteId: removedId,
            activeNoteId: session.activeNoteId || null,
        };
    }

    if (toolName === 'list_notes') {
        const access = resolveNotesToolSession(sessionStore, username, agentId, args.sessionId);
        if (access.error) return { error: access.error };
        if (!areSessionNotesEnabled(access.session)) return buildNotesDisabledError(access.sessionId);
        const requestedSessionId = String(args.sessionId || '').trim();
        const limit = Number.parseInt(args.limit, 10);
        const cursor = Number.parseInt(args.cursor, 10);
        const normalizedLimit = Number.isFinite(limit) ? Math.max(0, limit) : undefined;
        const normalizedCursor = Number.isFinite(cursor) ? Math.max(0, cursor) : 0;

        let allNotes = [];
        let responseSessionId = requestedSessionId || null;
        let activeNoteId = null;

        if (requestedSessionId) {
            const resolved = resolveSessionNoteTargetSession(sessionStore, username, agentId, requestedSessionId);
            if (resolved.error) return { error: resolved.error };
            const session = resolved.session || (sessionStore?.getSession ? sessionStore.getSession(resolved.sessionId) : null);
            if (!session) return { error: 'Session not found' };
            if (String(session.username) !== String(username)) return { error: 'Forbidden' };

            responseSessionId = resolved.sessionId || session.id;
            activeNoteId = session.activeNoteId || null;
            allNotes = sortNotesByUpdatedAtDesc(getSessionNotes(session)).map((note) => {
                const {
                    content,
                    contentHtml,
                    body,
                    text,
                    markdown,
                    ...metadata
                } = note && typeof note === 'object' ? note : {};
                return metadata;
            });
        } else {
            allNotes = listNotesGloballyForUser(sessionStore, username);
        }

        const sliceEnd = normalizedLimit === undefined ? undefined : normalizedCursor + normalizedLimit;
        const notes = allNotes.slice(normalizedCursor, sliceEnd);
        const nextCursor = normalizedLimit === undefined
            ? null
            : (sliceEnd < allNotes.length ? sliceEnd : null);
        return {
            sessionId: responseSessionId,
            activeNoteId,
            notes,
            limit: normalizedLimit,
            cursor: normalizedCursor,
            nextCursor,
        };
    }

    if (toolName === 'set_active_note') {
        const access = resolveNotesToolSession(sessionStore, username, agentId, args.sessionId);
        if (access.error) return { error: access.error };
        if (!areSessionNotesEnabled(access.session)) return buildNotesDisabledError(access.sessionId);
        const resolved = resolveSessionNoteTargetSession(sessionStore, username, agentId, args.sessionId);
        if (resolved.error) return { error: resolved.error };
        const session = resolved.session || (sessionStore?.getSession ? sessionStore.getSession(resolved.sessionId) : null);
        if (!session) return { error: 'Session not found' };
        if (session.username !== username) return { error: 'Forbidden' };

        const targetNote = resolveNoteAlias(session, args.noteId || 'active_note');
        if (!targetNote) return { error: 'Note not found' };
        const nextActiveNoteId = String(targetNote.noteId || targetNote.id || '').trim();
        if (String(session.activeNoteId || '').trim() === nextActiveNoteId) {
            return { success: true, sessionId: session.id, activeNoteId: session.activeNoteId || null, unchanged: true };
        }
        session.activeNoteId = nextActiveNoteId;
        persistAndBroadcastSessionNoteChange({
            sessionStore,
            session,
            username: session.username,
            event: {
                operation: 'set_active',
                noteId: nextActiveNoteId,
            },
        });
        return { success: true, sessionId: session.id, activeNoteId: session.activeNoteId };
    }

    if (toolName === 'read_file') {
        let content = await readFileSSH(args.path);

        if (args.start_line !== undefined || args.end_line !== undefined) {
            const lines = content.split('\n');
            const total = lines.length;
            const start = Math.max(0, (Number(args.start_line) || 1) - 1);
            const end = Math.min(total, Number(args.end_line) || total);
            const payload = { content: lines.slice(start, end).join('\n'), path: args.path,
                     start_line: start + 1, end_line: end, total_lines: total, partial: true };
            console.log(`[Tool] read_file:output | path=${args.path} | partial=true | content_len=${String(payload.content || '').length} | preview=${String(payload.content || '').slice(0, 240)}`);
            appendSubagentAuditLog(agentId, {
                type: 'tool_result_preview',
                iteration: 0,
                toolName: 'read_file',
                data: {
                    path: args.path,
                    partial: true,
                    contentLen: String(payload.content || '').length,
                    preview: String(payload.content || '').slice(0, 500),
                    start_line: payload.start_line,
                    end_line: payload.end_line,
                    total_lines: payload.total_lines,
                },
            });
            return payload;
        }
        const payload = { content, path: args.path };
        console.log(`[Tool] read_file:output | path=${args.path} | partial=false | content_len=${String(payload.content || '').length} | preview=${String(payload.content || '').slice(0, 240)}`);
        appendSubagentAuditLog(agentId, {
            type: 'tool_result_preview',
            iteration: 0,
            toolName: 'read_file',
            data: {
                path: args.path,
                partial: false,
                contentLen: String(payload.content || '').length,
                preview: String(payload.content || '').slice(0, 500),
            },
        });
        return payload;
    }

    if (toolName === 'write_file') {
        const resolvedPath = resolvePath(args.path);
        const dirCmd = `mkdir -p ${escapeShellArg(path.dirname(resolvedPath))}`;
        await runCmd(dirCmd, '/');
        const result = await new Promise((resolve) => executeSSHWrite(resolvedPath, args.content, resolve));
        if (result.exitCode !== 0) throw new Error(result.error || `write_file failed with exit ${result.exitCode}`);
        return { success: true, path: resolvedPath };
    }

    if (toolName === 'replace_in_file') {
        const content = await readFileSSH(args.path); // readFileSSH uses resolvePath internally
        const { old_str, new_str, replace_all = false } = args;
        if (!content.includes(old_str)) throw new Error(`String not found in file: ${args.path}`);
        const updated = replace_all ? content.split(old_str).join(new_str) : content.replace(old_str, new_str);
        const result = await new Promise((resolve) => executeSSHWrite(resolvePath(args.path), updated, resolve));
        if (result.exitCode !== 0) throw new Error(result.error);
        return { success: true, replacements: replace_all ? content.split(old_str).length - 1 : 1 };
    }

    if (toolName === 'list_directory') {
        const target = args.path || getEffectiveContainerCwd();
        const listTarget = target === getEffectiveContainerCwd() ? '.' : path.posix.basename(target);
        const listCwd = target === getEffectiveContainerCwd() ? target : path.posix.dirname(target);
        const result = await runCmd(`ls -F ${escapeShellArg(listTarget)}`, listCwd);
        if (result.exitCode !== 0) throw new Error(result.error);
        const files = result.output.split('\n').filter(Boolean).map(f => {
            const isDir = f.endsWith('/');
            return { name: isDir ? f.slice(0, -1) : f, isDirectory: isDir };
        });
        return { path: target, files };
    }

    if (toolName === 'find_files') {
        const searchPath = args.path || args.cwd || getEffectiveContainerCwd();
        const pattern = args.pattern || '*';
        const maxDepth = args.max_depth ? `-maxdepth ${args.max_depth}` : '';
        const excludes = (args.exclude || []).map(e => `-not -path "*/${e}/*"`).join(' ');
        const findTarget = searchPath === getEffectiveContainerCwd() ? '.' : path.posix.basename(searchPath);
        const findCwd = searchPath === getEffectiveContainerCwd() ? searchPath : path.posix.dirname(searchPath);
        const cmd = `find ${escapeShellArg(findTarget)} ${maxDepth} -name ${escapeShellArg(pattern)} ${excludes} 2>/dev/null | head -200`;
        const result = await runCmd(cmd, findCwd);
        const files = result.output.split('\n').filter(Boolean);
        return { files };
    }

    if (toolName === 'read_project_json') {
        const content = await readFileSSH(args.filePath || args.path);
        try { return JSON.parse(content); }
        catch { return { error: 'Failed to parse JSON', raw: content.slice(0, 500) }; }
    }

    if (toolName === 'run_tests') {
        const cwd = containerToHost(args.cwd || getCwd(agentId) || '.');
        const mode = String(args.mode || 'auto').toLowerCase();
        const explicitFiles = Array.isArray(args.files) ? args.files.filter(Boolean) : [];
        const passWithNoTests = args.passWithNoTests !== false;
        const timeoutSeconds = Math.max(10, Math.min(Number(args.timeout) || 180, 900));

        const pkgPath = path.join(cwd, 'package.json');
        let pkg = {};
        if (fs.existsSync(pkgPath)) {
            try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch {}
        }
        const scripts = pkg.scripts || {};
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        const detectPackageManager = () => {
            const field = typeof pkg.packageManager === 'string' ? pkg.packageManager.toLowerCase() : '';
            if (field.startsWith('pnpm@') || fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
            if (field.startsWith('yarn@') || fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
            if (field.startsWith('bun@') || fs.existsSync(path.join(cwd, 'bun.lockb')) || fs.existsSync(path.join(cwd, 'bun.lock'))) return 'bun';
            return 'npm';
        };

        const packageManager = detectPackageManager();
        const execPrefix = packageManager === 'yarn' ? 'yarn' : packageManager;
        const fileArgs = explicitFiles.map(f => escapeShellArg(f)).join(' ');

        const scriptLooksLikeNoTest = (value) => {
            const text = String(value || '').toLowerCase();
            return !text || text.includes('no test specified');
        };

        const hasDep = (...names) => names.some(name => deps[name]);
        const makeTimed = (cmd) => `timeout ${timeoutSeconds}s sh -lc ${escapeShellArg(`cd ${cwd} && ${cmd}`)}`;

        const candidates = [];
        const addCandidate = (cmd, reason, meta = {}) => {
            if (!cmd) return;
            if (!candidates.some(c => c.cmd === cmd)) candidates.push({ cmd, reason, ...meta });
        };

        if (args.command) {
            addCandidate(String(args.command), 'explicit-command', { explicit: true });
        } else {
            const orderedScriptNames = mode === 'smoke'
                ? ['test:smoke', 'smoke', 'test:quick', 'test:unit', 'test:ci', 'test']
                : ['test:ci', 'test:unit', 'test', 'smoke', 'test:smoke'];

            for (const scriptName of orderedScriptNames) {
                const scriptValue = scripts[scriptName];
                if (!scriptValue || scriptLooksLikeNoTest(scriptValue)) continue;
                const lower = String(scriptValue).toLowerCase();

                if (lower.includes('vitest')) {
                    addCandidate(`${execPrefix} exec vitest run ${passWithNoTests ? '--passWithNoTests ' : ''}${fileArgs}`.trim(), `script:${scriptName}`, { runner: 'vitest', script: scriptName });
                    continue;
                }
                if (lower.includes('jest')) {
                    addCandidate(`${execPrefix} exec jest --runInBand --ci ${passWithNoTests ? '--passWithNoTests ' : ''}${fileArgs}`.trim(), `script:${scriptName}`, { runner: 'jest', script: scriptName });
                    continue;
                }
                if (lower.includes('playwright')) {
                    addCandidate(`${execPrefix} exec playwright test ${fileArgs}`.trim(), `script:${scriptName}`, { runner: 'playwright', script: scriptName });
                    continue;
                }
                if (lower.includes('cypress')) {
                    addCandidate(`${execPrefix} exec cypress run`, `script:${scriptName}`, { runner: 'cypress', script: scriptName });
                    continue;
                }
                if (scriptName === 'test' && lower.includes('react-scripts test')) {
                    addCandidate(`CI=1 ${packageManager} test -- --watchAll=false ${passWithNoTests ? '--passWithNoTests ' : ''}${fileArgs}`.trim(), `script:${scriptName}`, { runner: 'react-scripts', script: scriptName });
                    continue;
                }
                if (scriptName === 'test') {
                    addCandidate(`CI=1 ${packageManager} test`, `script:${scriptName}`, { runner: 'package-script', script: scriptName });
                    continue;
                }
                addCandidate(`${packageManager} run ${scriptName}`, `script:${scriptName}`, { runner: 'package-script', script: scriptName });
            }

            if (hasDep('vitest')) addCandidate(`${execPrefix} exec vitest run ${passWithNoTests ? '--passWithNoTests ' : ''}${fileArgs}`.trim(), 'dependency:vitest', { runner: 'vitest' });
            if (hasDep('jest')) addCandidate(`${execPrefix} exec jest --runInBand --ci ${passWithNoTests ? '--passWithNoTests ' : ''}${fileArgs}`.trim(), 'dependency:jest', { runner: 'jest' });
            if (hasDep('@playwright/test')) addCandidate(`${execPrefix} exec playwright test ${fileArgs}`.trim(), 'dependency:playwright', { runner: 'playwright' });
            if (fs.existsSync(path.join(cwd, 'vitest.config.ts')) || fs.existsSync(path.join(cwd, 'vitest.config.js'))) {
                addCandidate(`${execPrefix} exec vitest run ${passWithNoTests ? '--passWithNoTests ' : ''}${fileArgs}`.trim(), 'config:vitest', { runner: 'vitest' });
            }
            if (fs.existsSync(path.join(cwd, 'jest.config.js')) || fs.existsSync(path.join(cwd, 'jest.config.ts')) || fs.existsSync(path.join(cwd, 'jest.config.cjs'))) {
                addCandidate(`${execPrefix} exec jest --runInBand --ci ${passWithNoTests ? '--passWithNoTests ' : ''}${fileArgs}`.trim(), 'config:jest', { runner: 'jest' });
            }
            if (fs.existsSync(path.join(cwd, 'pytest.ini')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
                addCandidate(`pytest -q ${fileArgs}`.trim(), 'config:pytest', { runner: 'pytest' });
            }
            if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) {
                addCandidate('cargo test --quiet', 'config:cargo', { runner: 'cargo' });
            }
            if (fs.existsSync(path.join(cwd, 'go.mod'))) {
                addCandidate('go test ./...', 'config:go', { runner: 'go' });
            }

            // Last-resort smoke/sanity commands so the tool never becomes a silent no-op.
            addCandidate('node -e "const fs=require(\'fs\'); const p=JSON.parse(fs.readFileSync(\'package.json\',\'utf8\')); console.log(\'package.json ok\'); console.log(\'scripts:\', Object.keys(p.scripts||{}).join(\', \')||\'(none)\');"', 'sanity:package-json', { runner: 'node-sanity', smoke: true });
            addCandidate('npx tsc --noEmit', 'sanity:tsc', { runner: 'tsc', smoke: true });
        }

        const attempts = [];
        let lastResult = null;
        for (const candidate of candidates) {
            const wrappedCmd = makeTimed(candidate.cmd + ' 2>&1');
            const result = await runCmd(wrappedCmd, '/');
            const attempt = {
                command: candidate.cmd,
                reason: candidate.reason,
                runner: candidate.runner || null,
                exitCode: result.exitCode,
                outputPreview: String(result.output || result.error || '').slice(0, 1000),
            };
            attempts.push(attempt);
            lastResult = { ...result, selectedCommand: candidate.cmd, selectedReason: candidate.reason, selectedRunner: candidate.runner || null };
            if (result.exitCode === 0) break;
        }

        const selected = lastResult || { output: '', error: 'No runnable test command detected', exitCode: 1, selectedCommand: null, selectedReason: null, selectedRunner: null };
        return {
            output: selected.output,
            error: selected.error,
            exitCode: selected.exitCode,
            passed: selected.exitCode === 0,
            mode,
            cwd: hostToContainer(cwd),
            packageManager,
            selectedCommand: selected.selectedCommand,
            selectedReason: selected.selectedReason,
            selectedRunner: selected.selectedRunner,
            attemptedCommands: attempts,
            discovery: {
                scripts: Object.keys(scripts),
                packageManager,
                dependenciesDetected: Object.keys(deps).filter(name => ['vitest', 'jest', '@playwright/test', 'cypress'].includes(name)),
                files: explicitFiles,
                timeoutSeconds,
            },
        };
    }

    if (toolName === 'lint_code') {
        const cwd = containerToHost(args.cwd || getCwd(agentId) || '.');
        const files = args.files ? args.files.join(' ') : '';
        // Try ESLint first, fall back to TypeScript type-check
        const eslintCmd = `cd ${escapeShellArg(cwd)} && npx eslint ${files || '.'} --max-warnings=0 2>&1`;
        const tscCmd = `cd ${escapeShellArg(cwd)} && npx tsc --noEmit 2>&1`;
        const eslintResult = await runCmd(eslintCmd, '/');
        const hasEslint = !eslintResult.output.includes('not found') && !eslintResult.output.includes('No ESLint configuration');
        if (hasEslint) {
            return { tool: 'eslint', output: eslintResult.output, error: eslintResult.error, exitCode: eslintResult.exitCode, passed: eslintResult.exitCode === 0 };
        }
        // Fallback: TypeScript type-check
        const tscResult = await runCmd(tscCmd, '/');
        return { tool: 'tsc', output: tscResult.output, error: tscResult.error, exitCode: tscResult.exitCode, passed: tscResult.exitCode === 0 };
    }

    if (toolName === 'format_code') {
        const cwd = args.cwd || '.';
        const files = args.files ? args.files.join(' ') : '.';
        const flag = args.check ? '--check' : '--write';
        const cmd = `cd ${escapeShellArg(containerToHost(cwd))} && npx prettier ${flag} ${files} 2>&1`;
        const result = await runCmd(cmd, '/');
        return { output: result.output, error: result.error };
    }

    // --- GIT ---

    if (toolName === 'git_status') {
        const cwd = args.cwd || getCwd(agentId);
        const result = await executeGit('git status --porcelain', cwd);
        const branchResult = await executeGit('git branch --show-current', cwd).catch(() => ({ output: '' }));
        const lines = result.output.split('\n').filter(Boolean);
        const changes = lines.map(l => ({ status: l.slice(0, 2).trim(), file: l.slice(3) }));
        const branch = branchResult.output.trim();
        return { branch, changes, clean: changes.length === 0, count: changes.length };
    }

    if (toolName === 'git_diff') {
        const files = Array.isArray(args.files) ? args.files.join(' ') : (args.files || '');
        const cmd = `git diff ${args.staged ? '--staged' : ''} ${files}`.trim();
        const result = await executeGit(cmd, args.cwd || getCwd(agentId));
        const lines = result.output.split('\n');
        const added = lines.filter(l => l.startsWith('+')).length;
        const removed = lines.filter(l => l.startsWith('-')).length;
        return { diff: result.output, added, removed, empty: !result.output.trim() };
    }

    if (toolName === 'git_add') {
        const files = args.files && args.files.length ? args.files.join(' ') : '-A';
        const result = await executeGit(`git add ${files}`, args.cwd || getCwd(agentId));
        return { success: true, output: result.output };
    }

    if (toolName === 'git_commit') {
        const cwd = args.cwd || getCwd(agentId);
        if (!args.no_add) await executeGit('git add -A', cwd);
        const result = await executeGit(`git commit -m ${escapeShellArg(args.message)}`, cwd);
        const hashResult = await executeGit('git rev-parse --short HEAD', cwd).catch(() => ({ output: '' }));
        return { success: true, message: args.message, hash: hashResult.output.trim(), output: result.output };
    }

    if (toolName === 'git_checkout') {
        const flag = args.create ? '-b' : '';
        const result = await executeGit(`git checkout ${flag} ${escapeShellArg(args.branch)}`, args.cwd || getCwd(agentId));
        return { success: true, output: result.output };
    }

    if (toolName === 'git_log') {
        const limit = args.limit || 10;
        const author = args.author ? `--author=${escapeShellArg(args.author)}` : '';
        const result = await executeGit(`git log --oneline -${limit} ${author}`.trim(), args.cwd || getCwd(agentId));
        const commits = result.output.split('\n').filter(Boolean);
        return { commits, count: commits.length };
    }

    if (toolName === 'git_branch') {
        const { action = 'list', name, filter, cwd: gitCwd } = args;
        const cwd = gitCwd || getCwd(agentId);
        if (action === 'list') {
            const result = await executeGit(`git branch ${filter === 'merged' ? '--merged' : filter === 'no-merged' ? '--no-merged' : ''}`, cwd);
            return { branches: result.output.split('\n').filter(Boolean).map(b => b.trim()) };
        }
        if (action === 'create') {
            const wfData = args.workflow || args.newWorkflowData;
            if (!wfData) return { error: 'Missing workflow data. Provide workflow parameter.' };
            const newId = `wf-${Date.now()}`;
            workflows.push({ id: newId, nodes: [], edges: [], status: 'active', ...wfData });
            state.workflows = workflows;
            writeState(username, state);
            return { success: true, id: newId, message: `Workflow "${wfData.name || 'unnamed'}" created.` };
        }
    }

    if (toolName === 'git_tag') {
        const { action = 'list', tag, message, cwd: gitCwd } = args;
        const cwd = gitCwd || args.cwd || getCwd(agentId);
        if (action === 'list') {
            const result = await executeGit('git tag --list', cwd);
            return { tags: result.output.split('\n').filter(Boolean) };
        }
        if (action === 'create') {
            if (!tag) return { error: 'Missing tag name.' };
            const cmd = message
                ? `git tag -a ${escapeShellArg(tag)} -m ${escapeShellArg(message)}`
                : `git tag ${escapeShellArg(tag)}`;
            const result = await executeGit(cmd, cwd);
            return { success: true, tag, output: result.output };
        }
        if (action === 'delete') {
            if (!tag) return { error: 'Missing tag name.' };
            const result = await executeGit(`git tag -d ${escapeShellArg(tag)}`, cwd);
            return { success: true, tag, output: result.output };
        }
        return { error: 'Invalid git_tag action. Use list|create|delete' };
    }

    if (toolName === 'git_pull') {
        const remote = args.remote || 'origin';
        const branch = args.branch || '';
        const result = await executeGit(`git pull ${remote} ${branch}`.trim(), args.cwd || getCwd(agentId));
        return { success: true, output: result.output };
    }

    if (toolName === 'git_push') {
        const remote = args.remote || 'origin';
        const branch = args.branch || '';
        const tagsFlag = args.tags ? '--tags' : '';
        const result = await executeGit(`git push ${tagsFlag} ${remote} ${branch}`.trim(), args.cwd || getCwd(agentId));
        return { success: true, output: result.output };
    }

    // =========================================================================
    // GRUPO B — Estado local
    // =========================================================================

    if (toolName === 'delete_memory') {
        const { id, ids, category, force = false } = args;
        const tagList = normalizeStringList(args.tags);
        const dangerousRefs = [
            ...(id ? [id] : []),
            ...normalizeStringList(ids),
            ...tagList,
        ].filter(looksLikeAgentIdentifier);

        if (dangerousRefs.length > 0 && !force) {
            return {
                success: false,
                error: `delete_memory cannot target agent identifiers/tags (${dangerousRefs.join(', ')}). This tool only deletes memories, not agents. If you truly want to remove those memory tags, pass force=true.`,
                blockedTargets: dangerousRefs,
            };
        }

        const result = deleteMemories({ id, ids, category, tags: tagList });
        if (result?.success) {
            console.log(`[Memory] Deleted ${result.deleted} memories via tool`);
        }
        return result;
    }

    if (toolName === 'update_memory') {
        return updateMemoryRecord({
            id: args.id,
            content: args.content,
            summary: args.summary,
            tags: args.tags,
            category: args.category,
            confidence: args.confidence,
            importance: args.importance,
            scope: args.scope,
            ownerId: args.ownerId,
            promotionCandidate: args.promotionCandidate,
            promotionReason: args.promotionReason,
            lastInjectedAt: args.lastInjectedAt,
            lastConfirmedAt: args.lastConfirmedAt,
        });
    }

    if (toolName === 'remember_fact') {
        const result = await rememberMemory({
            content: args.content,
            tags: args.tags || [],
            agentId,
            category: args.category || 'fact',
            summary: typeof args.summary === 'string' ? args.summary : '',
            confidence: typeof args.confidence === 'number' ? args.confidence : 1,
            importance: typeof args.importance === 'number' ? args.importance : 1,
            consolidatedFrom: Array.isArray(args.consolidatedFrom) ? args.consolidatedFrom : [],
            scope: args.scope,
            ownerId: args.ownerId || username,
            promotionCandidate: args.promotionCandidate,
            promotionReason: args.promotionReason,
            lastInjectedAt: args.lastInjectedAt,
            lastConfirmedAt: args.lastConfirmedAt,
            fetchWithRetry,
            ollamaServer: OLLAMA_SERVER,
        });
        if (result?.duplicate) return { success: true, message: 'Duplicate memory — skipped.', id: result.id, duplicate: true };
        if (result?.reinforced) return { success: true, message: 'Similar memory reinforced — importance increased.', id: result.id, reinforced: true };
        return { success: true, message: 'Fact saved to SQLite memory.', id: result.id };
    }

    if (toolName === 'recall_memory') {
        const queryAsCategory = String(args.query || '').toLowerCase().trim();
        const validCategories = ['fact', 'state', 'event', 'behavior', 'issue', 'knowledge', 'design', 'summary'];
        const effectiveCategory = args.category || (validCategories.includes(queryAsCategory) ? queryAsCategory : null);
        const results = await recallMemories({
            query: args.query,
            limit: args.limit ?? 10,
            threshold: args.threshold ?? 0.3,
            category: effectiveCategory,
            tags: args.tags,
            fetchWithRetry,
            ollamaServer: OLLAMA_SERVER,
        });
        return { results };
    }

    if (toolName === 'list_agents') {
        const agents = listAgents(username);
        return {
            agents: agents.map(a => ({
                id: a.id, name: a.name, model: a.model, isMaster: !!a.isMaster, role: a.role || (!!a.isMaster ? 'master' : 'worker'), executionMode: a.executionMode || 'flex', tags: a.tags || [],
                capabilities: {
                    execute_commands: !a.allowedTools?.length || a.allowedTools.includes('run_terminal_command'),
                    edit_files: !a.allowedTools?.length || a.allowedTools.includes('write_file'),
                    git_operations: !a.allowedTools?.length || a.allowedTools.includes('git_commit'),
                    delegate_tasks: !a.allowedTools?.length || a.allowedTools.includes('delegate_task'),
                    memory: !a.allowedTools?.length || a.allowedTools.includes('remember_fact'),
                },
            })),
        };
    }

    if (toolName === 'get_agent_details') {
        const rawIdentifier = args.agentId || args.identifier || args.name || '';
        if (!String(rawIdentifier).trim()) return { error: 'agentId or identifier is required.' };
        const targetId = String(rawIdentifier).trim();
        const agents = listAgents(username);
        const target = agents.find(a => a.id === targetId || a.id.toLowerCase() === targetId.toLowerCase() || a.name?.toLowerCase() === targetId.toLowerCase());
        if (!target) return { error: `Agent '${rawIdentifier}' not found.` };
        return { id: target.id, name: target.name, model: target.model,
                 isMaster: !!target.isMaster, role: target.role || (!!target.isMaster ? 'master' : 'worker'), executionMode: target.executionMode || 'flex', tags: target.tags || [], systemPrompt: target.systemPrompt,
                 allowedTools: target.allowedTools || [] };
    }

    if (toolName === 'create_agent') {
        const state = readState(username) || {};
        const defaultModel = chooseDefaultChatModel(state.modelConfigs || []);
        const agent = upsertAgent(username, {
            id: `agent-${Date.now()}`,
            name: args.name,
            model: args.modelId || args.model || defaultModel?.id || defaultModel?.modelId || '',
            systemPrompt: args.systemPrompt,
            summary: '', history: [], sessions: [], activeSessionId: 'default',
            color: args.color || '#6366f1',
            role: args.role || (args.isMaster ? 'master' : 'worker'),
            executionMode: args.executionMode || ((args.role || (args.isMaster ? 'master' : 'worker')) === 'worker' ? 'strict' : 'flex'),
            tags: Array.isArray(args.tags) ? args.tags : [args.role || (args.isMaster ? 'master' : 'worker') || 'worker'],
            isMaster: (args.role || (args.isMaster ? 'master' : 'worker')) === 'master',
            allowedTools: Array.isArray(args.allowedTools) ? args.allowedTools : [],
            lastModified: Date.now(),
        });
        return { success: true, agentId: agent.id, model: agent.model, message: 'Agent created.' };
    }

    if (toolName === 'update_agent_profile') {
        const rawIdentifier = args.identifier || args.agentId || args.name || '';
        const targetId = String(rawIdentifier).trim();
        const agents = listAgents(username);
        const existing = agents.find(a => a.id === targetId || a.id.toLowerCase() === targetId.toLowerCase() || a.name?.toLowerCase() === targetId.toLowerCase());
        if (!existing) return { error: `Agent '${rawIdentifier}' not found.` };
        const nextRole = args.role || existing.role || (existing.isMaster ? 'master' : 'worker');
        const updated = upsertAgent(username, {
            ...existing,
            ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
            ...(args.name ? { name: args.name } : {}),
            ...(args.modelId || args.model ? { model: args.modelId || args.model } : {}),
            ...(args.color ? { color: args.color } : {}),
            ...(args.role ? { role: args.role, isMaster: args.role === 'master' } : {}),
            ...(args.executionMode ? { executionMode: args.executionMode } : {}),
            ...(args.tags !== undefined ? { tags: Array.isArray(args.tags) ? args.tags : [] } : {}),
            ...(args.allowedTools !== undefined ? { allowedTools: args.allowedTools } : {}),
            role: nextRole,
            isMaster: nextRole === 'master',
            lastModified: Date.now(),
        });
        return { success: true, message: `Agent '${updated.name}' updated.`, agentId: updated.id, role: updated.role, isMaster: !!updated.isMaster, executionMode: updated.executionMode, tags: updated.tags || [] };
    }

    if (toolName === 'get_prompt_document') {
        const rawIdentifier = args.agentId || args.identifier || args.name || '';
        const targetId = String(rawIdentifier).trim();
        const documentId = String(args.documentId || '').trim();
        const documentKey = String(args.documentKey || args.key || '').trim();
        const agents = listAgents(username);
        const target = targetId ? agents.find(a => a.id === targetId || a.id.toLowerCase() === targetId.toLowerCase() || a.name?.toLowerCase() === targetId.toLowerCase()) : null;
        if (targetId && !target) return { error: `Agent '${rawIdentifier}' not found.` };
        const document = target
            ? getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(target.id) })
            : (documentId ? getPromptDocumentById(documentId) : (documentKey ? getPromptDocumentByKey(documentKey) : null));
        if (!document) return { error: 'Prompt document not found.' };
        const currentVersion = document?.id ? getCurrentPromptVersion(document.id) : null;
        return {
            document: document ? {
                id: document.id,
                key: document.key,
                title: document.title,
                currentVersionId: document.currentVersionId || null,
                metadata: document.metadata || {},
                createdAt: document.createdAt || null,
                updatedAt: document.updatedAt || null,
            } : null,
            currentVersion: currentVersion ? {
                id: currentVersion.id,
                documentId: currentVersion.documentId,
                version: currentVersion.version,
                content: currentVersion.content,
                createdAt: currentVersion.createdAt,
                createdBy: currentVersion.createdBy || null,
                metadata: currentVersion.metadata || {},
            } : null,
        };
    }

    if (toolName === 'upsert_prompt_document') {
        const rawIdentifier = args.agentId || args.identifier || args.name || '';
        const targetId = String(rawIdentifier).trim();
        const documentId = String(args.documentId || '').trim();
        const documentKey = String(args.documentKey || args.key || '').trim();
        const agents = listAgents(username);
        const target = targetId ? agents.find(a => a.id === targetId || a.id.toLowerCase() === targetId.toLowerCase() || a.name?.toLowerCase() === targetId.toLowerCase()) : null;
        if (targetId && !target) return { error: `Agent '${rawIdentifier}' not found.` };
        const ensuredDocument = target ? getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(target.id) }) : null;
        const resolvedDocumentId = ensuredDocument?.id || documentId || '';
        const resolvedKey = ensuredDocument?.key || documentKey || '';
        if (!resolvedDocumentId && !resolvedKey) return { error: 'agentId/identifier, documentId, or documentKey required' };
        const metadata = args.metadata && typeof args.metadata === 'object' ? args.metadata : undefined;
        const updatedDocument = upsertPromptDocument({
            documentId: resolvedDocumentId || null,
            key: resolvedKey || '',
            title: args.title,
            content: args.content,
            metadata,
            createdBy: args.createdBy ?? (target?.id || null),
        });
        if (!updatedDocument?.id) return { error: 'Failed to upsert prompt document.' };
        const refreshedDocument = getPromptDocumentById(updatedDocument.id) || getPromptDocumentByKey(updatedDocument.key) || updatedDocument;
        const currentVersion = refreshedDocument?.id ? getCurrentPromptVersion(refreshedDocument.id) : null;
        return {
            success: true,
            document: refreshedDocument ? {
                id: refreshedDocument.id,
                key: refreshedDocument.key,
                title: refreshedDocument.title,
                currentVersionId: refreshedDocument.currentVersionId || null,
                metadata: refreshedDocument.metadata || {},
                createdAt: refreshedDocument.createdAt || null,
                updatedAt: refreshedDocument.updatedAt || null,
            } : null,
            currentVersion: currentVersion ? {
                id: currentVersion.id,
                documentId: currentVersion.documentId,
                version: currentVersion.version,
                content: currentVersion.content,
                createdAt: currentVersion.createdAt,
                createdBy: currentVersion.createdBy || null,
                metadata: currentVersion.metadata || {},
            } : null,
        };
    }

    if (toolName === 'get_current_prompt_version') {
        const { error, document, scope } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        return {
            scope,
            document: serializePromptDocument(document),
            currentVersion: getCurrentPromptVersion(document.id),
        };
    }

    if (toolName === 'rollback_prompt_version') {
        const versionId = String(args.versionId || '').trim();
        if (!versionId) return { error: 'versionId is required.' };
        const { error, document, scope } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        const rolledBack = rollbackPromptVersion(document.id, versionId);
        if (!rolledBack?.document) return { error: `Prompt version '${versionId}' not found for document.` };
        return {
            scope,
            document: serializePromptDocument(rolledBack.document),
            currentVersion: rolledBack.currentVersion || null,
        };
    }

    if (toolName === 'list_prompt_versions') {
        const rawIdentifier = args.agentId || args.identifier || args.name || '';
        const targetId = String(rawIdentifier).trim();
        const agents = listAgents(username);
        const target = agents.find(a => a.id === targetId || a.id.toLowerCase() === targetId.toLowerCase() || a.name?.toLowerCase() === targetId.toLowerCase());
        if (!target) return { error: `Agent '${rawIdentifier}' not found.` };
        const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(target.id) });
        if (!document?.id) return { error: 'Prompt document not found.' };
        return {
            document: {
                id: document.id,
                key: document.key,
                title: document.title,
                currentVersionId: document.currentVersionId || null,
                metadata: document.metadata || {},
                createdAt: document.createdAt || null,
                updatedAt: document.updatedAt || null,
            },
            versions: listPromptVersions(document.id).map(v => ({
                id: v.id,
                documentId: v.documentId,
                version: v.version,
                content: v.content,
                createdAt: v.createdAt,
                createdBy: v.createdBy || null,
                metadata: v.metadata || {},
            })),
        };
    }

    if (toolName === 'resolve_prompt_preview') {
        const { error, target, document, scope } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        const currentVersion = getCurrentPromptVersion(document.id);
        const agentType = String(args.agentType || target?.role || '').trim().toLowerCase() || undefined;
        const resolved = resolvePromptFinalByCompositionForDocument(document.id, { agentType });
        const overrideContent = typeof args.content === 'string' ? args.content : '';
        const resolvedContent = overrideContent || resolved?.content || currentVersion?.content || target?.systemPrompt || '';
        return {
            preview: resolvedContent,
            content: resolvedContent,
            scope,
            document: {
                id: document.id,
                key: document.key,
                title: document.title,
                currentVersionId: document.currentVersionId || null,
                metadata: document.metadata || {},
                createdAt: document.createdAt || null,
                updatedAt: document.updatedAt || null,
            },
            currentVersion: currentVersion ? {
                id: currentVersion.id,
                documentId: currentVersion.documentId,
                version: currentVersion.version,
                content: currentVersion.content,
                createdAt: currentVersion.createdAt,
                createdBy: currentVersion.createdBy || null,
                metadata: currentVersion.metadata || {},
            } : null,
            resolved: {
                content: resolved?.content || '',
                refs: Array.isArray(resolved?.refs) ? resolved.refs : [],
                blocks: Array.isArray(resolved?.blocks) ? resolved.blocks : [],
            },
        };
    }

    if (toolName === 'publish_prompt_version') {
        const { error, target, document, scope } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Failed to ensure prompt document.' };
        const agentType = String(target?.role || args.agentType || '').trim().toLowerCase() || undefined;
        const createdBy = args.createdBy ?? target?.id ?? username;
        const metadata = args.metadata && typeof args.metadata === 'object' ? args.metadata : {};
        const resolved = resolvePromptFinalByCompositionForDocument(document.id, { agentType });
        const legacyContent = typeof args.content === 'string' ? args.content.trim() : '';
        const published = publishPromptCompositionSnapshot(document.id, {
            createdBy,
            metadata: { ...metadata, publishSource: legacyContent ? 'legacy-content-override' : 'composition-snapshot' },
            content: legacyContent || undefined,
            agentType,
        });
        const currentVersion = published || getCurrentPromptVersion(document.id);
        if (target) {
            upsertAgent(username, {
                ...target,
                promptDocumentId: document.id,
                systemPrompt: currentVersion?.content || resolved?.content || legacyContent || target.systemPrompt || '',
            });
        }
        return {
            success: true,
            scope,
            document: {
                id: document.id,
                key: document.key,
                title: document.title,
                currentVersionId: document.currentVersionId || null,
                metadata: document.metadata || {},
                createdAt: document.createdAt || null,
                updatedAt: document.updatedAt || null,
            },
            currentVersion: currentVersion ? {
                id: currentVersion.id,
                documentId: currentVersion.documentId,
                version: currentVersion.version,
                content: currentVersion.content,
                createdAt: currentVersion.createdAt,
                createdBy: currentVersion.createdBy || null,
                metadata: currentVersion.metadata || {},
            } : null,
            resolved: {
                content: resolved?.content || '',
                refs: Array.isArray(resolved?.refs) ? resolved.refs : [],
                blocks: Array.isArray(resolved?.blocks) ? resolved.blocks : [],
            },
            compatibility: legacyContent ? { usedLegacyContentOverride: true } : { usedLegacyContentOverride: false },
        };
    }

    if (toolName === 'list_prompt_refs') {
        const { error, document, scope } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        return {
            scope,
            document: {
                id: document.id,
                key: document.key,
                title: document.title,
                currentVersionId: document.currentVersionId || null,
                metadata: document.metadata || {},
                createdAt: document.createdAt || null,
                updatedAt: document.updatedAt || null,
            },
            refs: listPromptDocumentBlockRefs(document.id).map(serializePromptRef),
        };
    }

    if (toolName === 'resolve_prompt_refs') {
        const rawIdentifier = args.agentId || args.identifier || args.name || '';
        const targetId = String(rawIdentifier).trim();
        const agents = listAgents(username);
        const target = agents.find(a => a.id === targetId || a.id.toLowerCase() === targetId.toLowerCase() || a.name?.toLowerCase() === targetId.toLowerCase());
        if (!target) return { error: `Agent '${rawIdentifier}' not found.` };
        const document = getOrBootstrapPromptDocumentByAgent({ username: String(username), agentId: String(target.id) });
        if (!document?.id) return { error: 'Prompt document not found.' };
        const agentType = String(target?.role || args.agentType || '').trim().toLowerCase() || undefined;
        return {
            scope: 'agent',
            document: {
                id: document.id,
                key: document.key,
                title: document.title,
                currentVersionId: document.currentVersionId || null,
                metadata: document.metadata || {},
                createdAt: document.createdAt || null,
                updatedAt: document.updatedAt || null,
            },
            refs: resolveEffectivePromptRefsForAgentDocument(document, { agentType }).map(serializePromptRef),
        };
    }

    if (toolName === 'prompt_usage_map') {
        const rawAgentIdentifier = args.agentId || args.identifier || args.name;
        const agents = rawAgentIdentifier ? listAgents(username) : [];
        const resolvedAgent = rawAgentIdentifier
            ? agents.find(a => a.id === rawAgentIdentifier
                || a.id?.toLowerCase() === String(rawAgentIdentifier).toLowerCase()
                || a.name?.toLowerCase() === String(rawAgentIdentifier).toLowerCase())
            : null;
        const target = {
            blockId: args.blockId,
            documentId: args.documentId,
            documentKey: args.documentKey || args.key,
            agentId: resolvedAgent?.id || rawAgentIdentifier,
            agentType: args.agentType,
            global: args.global,
            scope: args.scope,
        };
        if (!args.agentType && resolvedAgent) {
            const derivedAgentType = String(resolvedAgent?.role || '').trim().toLowerCase();
            if (derivedAgentType) target.agentType = derivedAgentType;
        }
        return resolvePromptUsageMap(target);
    }

    if (toolName === 'prompt_operational_diff') {
        const target = {
            documentId: args.documentId,
            documentKey: args.documentKey || args.key,
            agentId: args.agentId || args.identifier || args.name,
            global: args.global === true,
            compareTo: args.compareTo,
            versionId: args.versionId,
        };
        return resolvePromptOperationalDiff(target, { agentType: args.agentType || null, username: String(username) });
    }

    if (toolName === 'validate_prompt_architecture') {
        const { error, document, scope } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        const target = {
            documentId: document?.id || args.documentId,
            blockId: args.blockId,
            scope,
            agentType: args.agentType,
        };
        return validatePromptArchitecture(target, { username: String(username) });
    }

    if (toolName === 'list_prompt_blocks') {
        const { error, document } = resolvePromptDocumentTarget(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        return {
            document: {
                id: document.id,
                key: document.key,
                title: document.title,
                currentVersionId: document.currentVersionId || null,
                metadata: document.metadata || {},
                createdAt: document.createdAt || null,
                updatedAt: document.updatedAt || null,
            },
            blocks: listPromptBlocks(document.id).map(block => ({
                id: block.id,
                documentId: block.documentId,
                blockKey: block.blockKey,
                blockType: block.blockType,
                title: block.title,
                content: block.content,
                metadata: block.metadata || {},
                createdAt: block.createdAt || null,
                updatedAt: block.updatedAt || null,
            })),
        };
    }

    if (toolName === 'create_prompt_block') {
        const { error, document } = resolvePromptDocumentTarget(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        const created = createPromptBlock(document.id, {
            blockKey: String(args.blockKey || '').trim(),
            blockType: String(args.blockType || 'text').trim() || 'text',
            title: String(args.title || '').trim(),
            content: args.content ?? '',
            metadata: args.metadata && typeof args.metadata === 'object' ? args.metadata : {},
        });
        return { success: true, ...created };
    }

    if (toolName === 'create_prompt_block_version') {
        const blockId = String(args.blockId || '').trim();
        if (!blockId) return { error: 'blockId required' };
        const block = findPromptBlockById(blockId);
        if (!block) return { error: 'Prompt block not found.' };
        const contextCheck = ensurePromptBlockMatchesContext(block, args, username);
        if (contextCheck?.error) return { error: contextCheck.error };
        if (args.content === undefined || args.content === null) return { error: 'content required' };
        const version = createPromptBlockVersion(blockId, {
            content: args.content ?? block.content,
            metadata: args.metadata && typeof args.metadata === 'object' ? args.metadata : {},
        });
        return { success: true, version };
    }

    if (toolName === 'delete_prompt_block') {
        const blockId = String(args.blockId || '').trim();
        if (!blockId) return { error: 'blockId required' };
        const block = findPromptBlockById(blockId);
        if (!block) return { error: 'Prompt block not found.' };
        const contextCheck = ensurePromptBlockMatchesContext(block, args, username);
        if (contextCheck?.error) return { error: contextCheck.error };
        const deleted = deletePromptBlock(block.documentId, blockId);
        if (!deleted) return { error: 'Failed to delete prompt block.' };
        return { success: true, ...deleted };
    }

    if (toolName === 'reorder_prompt_blocks') {
        const { error, document } = resolvePromptDocumentTarget(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        const blockIds = Array.isArray(args.blockIds)
            ? args.blockIds
            : (Array.isArray(args.orderedBlockIds) ? args.orderedBlockIds : []);
        if (!blockIds.length) return { error: 'blockIds required' };
        const result = reorderPromptDocumentBlockRefs(document.id, blockIds);
        if (result?.error) return { error: result.error };
        return { success: true, refs: (result.refs || []).map(serializePromptRef) };
    }

    if (toolName === 'set_prompt_block_refs') {
        const { error, document } = resolvePromptDocumentTarget(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        const refs = Array.isArray(args.refs) ? args.refs : [];
        const result = setPromptBlockRefs(document.id, refs);
        if (result?.error) return { error: result.error };
        return { success: true, refs: (result.refs || []).map(serializePromptRef) };
    }

    if (toolName === 'delete_prompt_block_assignments') {
        const { error, document } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        const blockIds = Array.isArray(args.blockIds) ? args.blockIds : [];
        const orphanOnly = args.orphanOnly === true;
        if (!orphanOnly && !blockIds.length) return { error: 'blockIds required unless orphanOnly=true' };
        const result = deletePromptBlockTypeAssignments(document.id, { blockIds, orphanOnly });
        if (result?.error) return { error: result.error };
        return { success: true, deleted: result?.deleted || 0, documentId: result?.documentId || document.id, blockIds: Array.isArray(result?.blockIds) ? result.blockIds : [], orphanOnly: !!result?.orphanOnly };
    }

    if (toolName === 'inspect_prompt_block_assignment_drift') {
        const { error, document } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        return inspectPromptBlockAssignmentDrift(document.id);
    }

    if (toolName === 'reconcile_prompt_block_assignment_drift') {
        const { error, document } = resolvePromptDocumentTargetWithGlobal(args, username);
        if (error) return { error };
        if (!document?.id) return { error: 'Prompt document not found.' };
        return reconcilePromptBlockAssignmentDrift(document.id);
    }


    if (toolName === 'get_prompt_block') {
        const blockId = String(args.blockId || '').trim();
        if (!blockId) return { error: 'blockId required' };
        const block = findPromptBlockById(blockId);
        if (!block) return { error: 'Prompt block not found.' };
        const contextCheck = ensurePromptBlockMatchesContext(block, args, username);
        if (contextCheck?.error) return { error: contextCheck.error };
        return {
            block: {
                id: block.id,
                documentId: block.documentId,
                blockKey: block.blockKey,
                blockType: block.blockType,
                title: block.title,
                content: block.content,
                metadata: block.metadata || {},
                createdAt: block.createdAt || null,
                updatedAt: block.updatedAt || null,
            },
        };
    }

    if (toolName === 'list_prompt_block_versions') {
        const blockId = String(args.blockId || '').trim();
        if (!blockId) return { error: 'blockId required' };
        const block = findPromptBlockById(blockId);
        if (!block) return { error: 'Prompt block not found.' };
        const contextCheck = ensurePromptBlockMatchesContext(block, args, username);
        if (contextCheck?.error) return { error: contextCheck.error };
        return {
            block: {
                id: block.id,
                documentId: block.documentId,
                blockKey: block.blockKey,
                blockType: block.blockType,
                title: block.title,
                content: block.content,
                metadata: block.metadata || {},
                createdAt: block.createdAt || null,
                updatedAt: block.updatedAt || null,
            },
            versions: listPromptBlockVersions(blockId).map(version => ({
                id: version.id,
                blockId: version.blockId,
                version: version.version,
                content: version.content,
                createdAt: version.createdAt || null,
                createdBy: version.createdBy || null,
                metadata: version.metadata || {},
            })),
        };
    }

    if (toolName === 'delete_agent') {
        const rawIdentifier = args.identifier || args.agentId || args.name || '';
        const targetId = String(rawIdentifier).trim();
        if (!targetId) return { error: 'Missing required parameter: identifier' };
        const agents = listAgents(username);
        const existing = agents.find(a => a.id === targetId || a.id.toLowerCase() === targetId.toLowerCase() || a.name?.toLowerCase() === targetId.toLowerCase());
        if (!existing) return { error: `Agent '${rawIdentifier}' not found.` };
        const deleted = deleteVisibleAgent(username, existing.id);
        if (!deleted) return { error: `Failed to delete agent '${existing.name}'.` };
        return { success: true, deletedId: existing.id, deletedName: existing.name };
    }

    if (toolName === 'manage_variable' || toolName === 'list_secrets' || toolName === 'get_secret') {
        const state = readState(username) || {};
        let keys = state.apiKeys || [];

        if (toolName === 'list_secrets') return { secrets: keys.map(k => k.name) };
        // Accept both `key` (documented/public spec) and legacy `name`
        const key = args.key || args.name;
        if (toolName === 'get_secret') {
            if (!key) return { error: 'Missing required parameter: key' };
            const found = keys.find(k => k.name?.toLowerCase() === key.toLowerCase());
            return found ? { secret: found.value || found.key } : { error: `Secret '${key}' not found.` };
        }

        const { action, value } = args;
        // Accept both 'key' and 'name' as the variable identifier
        if (action === 'list') return { variables: keys.map(k => k.name) };
        if (action === 'get') {
            const found = keys.find(k => k.name === key);
            return found ? { value: found.value || found.key } : { error: `Variable '${key}' not found.` };
        }
        if (action === 'set') {
            if (!key) return { error: 'Missing required parameter: key' };
            const idx = keys.findIndex(k => k.name === key);
            if (idx !== -1) keys[idx] = { ...keys[idx], value };
            else keys.push({ name: key, value });
            state.apiKeys = keys;
            writeState(username, state);
            return { success: true, message: `Variable '${key}' set.` };
        }
        if (action === 'delete') {
            if (!key) return { error: 'Missing required parameter: key' };
            const before = keys.length;
            keys = keys.filter(k => k.name !== key);
            if (keys.length === before) return { error: `Variable '${key}' not found.` };
            state.apiKeys = keys;
            writeState(username, state);
            return { success: true, message: `Variable '${key}' deleted.` };
        }
        return { error: 'Invalid action.' };
    }

    if (toolName === 'manage_model') {
        const state = readState(username) || {};
        let models = state.modelConfigs || [];
        const { action, config = {} } = args;

        if (action === 'list') return { models: models.map(m => ({ id: m.id, name: m.name, modelId: m.modelId })) };
        if (action === 'get') {
            const m = models.find(m => m.id === config.id || m.modelId === config.id);
            return m ? { success: true, model: m } : { error: 'Model not found' };
        }
        if (action === 'add') {
            models.push({ id: `model-${Date.now()}`, ...config });
        } else if (action === 'update' && config.id) {
            models = models.map(m => m.id === config.id ? { ...m, ...config } : m);
        } else if (action === 'delete' && config.id) {
            models = models.filter(m => m.id !== config.id);
        }
        state.modelConfigs = models;
        writeState(username, state);
        return { success: true, models: models.map(m => ({ id: m.id, name: m.name, modelId: m.modelId })) };
    }

    if (toolName === 'manage_workflow') {
        const state = readState(username) || {};
        let workflows = state.workflows || [];
        const { action, workflowId, name, scheduleConfig } = args;
        const newWorkflowData = args.newWorkflowData || args.workflow; // aceita ambos os nomes

        if (action === 'list') return { workflows: workflows.map(w => ({ id: w.id, name: w.name, schedule: w.schedule })) };
        if (action === 'remove') {
            workflows = workflows.filter(w => w.id !== workflowId && w.name !== workflowId);
            state.workflows = workflows;
            writeState(username, state);
            return { success: true };
        }
        if (action === 'rename') {
            if (!workflowId) return { error: 'Missing required parameter: workflowId' };
            if (!name) return { error: 'Missing required parameter: name' };
            const idx = workflows.findIndex(w => w.id === workflowId || w.name === workflowId);
            if (idx === -1) return { error: `Workflow '${workflowId}' not found.` };
            workflows[idx] = { ...workflows[idx], name };
            state.workflows = workflows;
            writeState(username, state);
            return { success: true, id: workflows[idx].id, name: workflows[idx].name };
        }
        if (action === 'create') {
            const wfData = args.workflow || args.newWorkflowData;
            if (!wfData) return { error: 'Missing workflow data. Provide workflow parameter.' };
            const newId = `wf-${Date.now()}`;
            workflows.push({ id: newId, nodes: [], edges: [], status: 'active', ...wfData });
            state.workflows = workflows;
            writeState(username, state);
            return { success: true, id: newId, message: `Workflow "${wfData.name || 'unnamed'}" created.` };
        }
        if (action === 'run') {
            const targetId = args.id || args.workflowId;
            if (!targetId) return { error: 'Missing workflow ID. Provide id or workflowId parameter.' };
            const wf = workflows.find(w => w.id === targetId || w.name === targetId);
            if (!wf) return { error: `Workflow '${targetId}' not found.` };

            const observabilityMode = args.observabilityMode === 'audit' ? 'audit' : 'default';
            const workflowDeps = { readState, writeState, getAgents, saveAgents, broadcastToUser, runAgentLoop, fetchWithRetry, observabilityMode };

            // Run async — don't await so the tool returns immediately
            runScheduledWorkflow(wf, username, workflowDeps).catch(e =>
                console.error(`[manage_workflow run] Error: ${e.message}`)
            );

            return { success: true, workflowId: wf.id, name: wf.name, status: 'started' };
        }
    }

    if (toolName === 'update_global_settings') {
        const state = readState(username) || {};
        const patch = (args.settings && typeof args.settings === 'object') ? args.settings : args;
        const allowedKeys = ['ollamaHost', 'theme', 'colorTheme', 'guidelines', 'routerConfig'];
        for (const key of allowedKeys) {
            if (patch[key] !== undefined) state[key] = patch[key];
        }
        writeState(username, state);
        return { success: true, message: 'Settings updated.', updatedKeys: allowedKeys.filter(key => patch[key] !== undefined) };
    }

    if (toolName === 'read_guidelines') {
        const state = readState(username) || {};
        return { guidelines: state.guidelines || '' };
    }

    if (toolName === 'list_commands') {
        const { TOOL_NAMES } = ctx;
        const names = TOOL_NAMES || [];
        // Try to get descriptions from toolDefinitions if available
        let available_tools;
        try {
            const { SYSTEM_TOOLS } = await import('./toolDefinitions.js');
            available_tools = SYSTEM_TOOLS
                .filter(t => names.length === 0 || names.includes(t.function.name))
                .map(t => ({ name: t.function.name, description: t.function.description }));
        } catch {
            available_tools = names.map(n => ({ name: n }));
        }
        return { available_tools, count: available_tools.length };
    }

    if (toolName === 'list_available_tools') {
        const { SYSTEM_TOOLS, buildToolsForAgent } = await import('./toolDefinitions.js');
        const rawAgentIdentifier = args.agentId || args.identifier || args.name || '';
        const normalizedAgentIdentifier = String(rawAgentIdentifier || '').trim();
        const allTools = Array.isArray(SYSTEM_TOOLS) ? SYSTEM_TOOLS : [];
        let effectiveTools = allTools;
        let agent = null;

        if (normalizedAgentIdentifier) {
            const agents = typeof getAgents === 'function' ? (getAgents(username) || []) : [];
            const lowered = normalizedAgentIdentifier.toLowerCase();
            agent = agents.find((item) => {
                const id = String(item?.id || '').toLowerCase();
                const name = String(item?.name || '').toLowerCase();
                return id === lowered || name === lowered;
            }) || null;
            if (!agent) {
                return { error: `Agent not found: ${normalizedAgentIdentifier}` };
            }
            effectiveTools = buildToolsForAgent(agent) || allTools;
        }

        const available_tools = effectiveTools.map((t) => ({
            name: t.function?.name,
            group: t.group || null,
            description: t.function?.description || '',
            callableBy: Array.isArray(t.function?.callableBy) ? t.function.callableBy : [],
        }));
        const response = { available_tools, count: available_tools.length };
        if (agent) {
            response.agent = { id: agent.id || '', name: agent.name || '', role: agent.role || '' };
        }
        return response;
    }

    if (toolName === 'sleep') {
        const seconds = Math.min(Math.max(Number(args.seconds) || 1, 1), 60);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        return { slept: seconds, message: `Slept for ${seconds} second(s).` };
    }

    if (toolName === 'make_http_request') {
        const state = readState(username) || {};
        const apiKeys = state.apiKeys || [];
        const { url, method = 'GET', headers = {}, body } = resolveSecretsInObject(args, apiKeys);
        const res = await fetchWithRetry(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        });
        const text = await res.text();
        try { return JSON.parse(text); } catch { return { response: text, status: res.status }; }
    }

    if (toolName === 'manage_external_tool') {
        const state = readState(username) || {};
        let tools = state.externalTools || [];
        const { action, tool_name, definition } = args;

        if (action === 'list') return { external_tools: tools.map(t => ({ name: t.name, description: t.description })) };
        if (action === 'add' && tool_name && definition) {
            const idx = tools.findIndex(t => t.name === tool_name);
            const newTool = { id: idx !== -1 ? tools[idx].id : `ext-${Date.now()}`, name: tool_name, ...definition };
            if (idx !== -1) tools[idx] = newTool; else tools.push(newTool);
            state.externalTools = tools;
            writeState(username, state);
            return { success: true, message: `Tool '${tool_name}' registered.` };
        }
        if (action === 'remove' && tool_name) {
            state.externalTools = tools.filter(t => t.name !== tool_name);
            writeState(username, state);
            return { success: true };
        }
        return { error: 'Invalid action.' };
    }

    if (toolName === 'send_alert') {
        // Persiste alerta no estado — browser lê ao abrir
        const state = readState(username) || {};
        if (!state.alerts) state.alerts = [];
        state.alerts.push({
            id: Date.now().toString(),
            title: args.title || 'Agent Alert',
            message: args.message,
            type: args.alert_type || 'info',
            timestamp: Date.now(),
            read: false,
            agentId,
        });
        // Manter apenas últimos 50 alertas
        if (state.alerts.length > 50) state.alerts = state.alerts.slice(-50);
        writeState(username, state);
        console.log(`[Alert] ${args.alert_type || 'info'}: ${args.title} — ${args.message}`);
        return { success: true };
    }

    if (toolName === 'query_usage_history') {
        return { message: 'Usage history not yet implemented server-side.' };
    }

    // =========================================================================
    // GRUPO B — scan_project (#14)
    // Analisa estrutura do projeto e persiste achados como memórias
    // =========================================================================
    if (toolName === 'scan_project') {
        const { path: scanPath = getCwd(agentId) || '/', depth = 3, save_memories = true, server_base_path = null } = args;
        const hostPath = containerToHost(scanPath);

        const findings = [];

        // 1. Estrutura de arquivos (tree limitada)
        const treeResult = await runCmd(
            `find ${escapeShellArg(hostPath)} -maxdepth ${depth} \\( -name node_modules -o -name .git -o -name dist -o -name .next -o -name __pycache__ \\) -prune -o -print 2>/dev/null | head -300`,
            '/'
        );
        const fileTree = treeResult.output?.split('\n').filter(Boolean) || [];
        findings.push(`Project structure (${fileTree.length} entries at depth ${depth}):\n${fileTree.slice(0, 80).join('\n')}`);

        // 2. Arquivos de configuração relevantes
        const configFiles = ['package.json', 'tsconfig.json', 'Dockerfile', 'docker-compose.yml', 'README.md', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod'];
        const foundConfigs = [];

        for (const cf of configFiles) {
            const cfPath = `${hostPath.replace(/\/$/, '')}/${cf}`;
            const readResult = await runCmd(`cat ${escapeShellArg(cfPath)} 2>/dev/null`, '/');
            if (readResult.exitCode === 0 && readResult.output?.trim()) {
                const content = readResult.output.trim().slice(0, 2000);
                foundConfigs.push({ file: cf, content });
            }
        }

        // 3. Extrair metadados do package.json se existir
        const pkgConfig = foundConfigs.find(c => c.file === 'package.json');
        if (pkgConfig) {
            try {
                const pkg = JSON.parse(pkgConfig.content);
                const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 30);
                findings.push(`package.json — name: ${pkg.name || 'unknown'}, version: ${pkg.version || '?'}, main entry: ${pkg.main || pkg.module || 'N/A'}`);
                findings.push(`Dependencies (${deps.length}): ${deps.join(', ')}`);
                if (pkg.scripts) findings.push(`NPM scripts: ${Object.keys(pkg.scripts).join(', ')}`);
            } catch {}
        }

        // 4. Dockerfile
        const dockerConfig = foundConfigs.find(c => c.file === 'Dockerfile');
        if (dockerConfig) {
            findings.push(`Dockerfile found:\n${dockerConfig.content.slice(0, 800)}`);
        }

        // 5. README resumido
        const readmeConfig = foundConfigs.find(c => c.file === 'README.md');
        if (readmeConfig) {
            findings.push(`README.md (excerpt):\n${readmeConfig.content.slice(0, 600)}`);
        }

        // 6. Detectar linguagens predominantes
        const extResult = await runCmd(
            `find ${escapeShellArg(hostPath)} -maxdepth ${depth} \\( -name node_modules -o -name .git -o -name dist \\) -prune -o -type f -print 2>/dev/null | grep -oE '\\.[a-zA-Z0-9]+$' | sort | uniq -c | sort -rn | head -15`,
            '/'
        );
        if (extResult.output?.trim()) {
            findings.push(`File extensions by count:\n${extResult.output.trim()}`);
        }

        // 6b. Health check de endpoints HTTP (se server_base_path fornecido)
        if (server_base_path) {
            const base = `http://localhost:${process.env.PORT || 3011}${server_base_path}`;
            const endpointsToCheck = [
                { method: 'GET',  path: '/api/agents',        label: 'agents list'   },
                { method: 'GET',  path: '/api/memory/list',   label: 'memory list'   },
                { method: 'POST', path: '/api/memory/search', label: 'memory search', body: JSON.stringify({ query: 'test', limit: 1 }) },
                { method: 'GET',  path: '/api/stream',        label: 'SSE stream'    },
            ];
            const results = [];
            for (const ep of endpointsToCheck) {
                try {
                    const curlFlags = ep.method === 'POST'
                        ? `-s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d ${escapeShellArg(ep.body || '{}')} --max-time 3`
                        : `-s -o /dev/null -w "%{http_code}" --max-time 3`;
                    const r = await runCmd(`curl ${curlFlags} "${base}${ep.path}"`, '/');
                    const code = (r.output || '').trim();
                    results.push(`  ${ep.method} ${server_base_path}${ep.path} [${ep.label}] → ${code}`);
                } catch {
                    results.push(`  ${ep.method} ${server_base_path}${ep.path} [${ep.label}] → ERROR`);
                }
            }
            findings.push(`HTTP endpoint health check (base: ${base}):\n${results.join('\n')}`);
        }

        // 7. Persistir achados como memórias
        const savedIds = [];
        if (save_memories) {
            for (const finding of findings) {
                if (finding.trim().length < 20) continue;
                const result = await rememberMemory({
                    content: finding,
                    tags: ['scan_project', `path:${scanPath}`, new Date().toISOString().split('T')[0]],
                    category: 'knowledge',
                    agentId,
                    fetchWithRetry,
                    ollamaServer: OLLAMA_SERVER,
                });
                if (result?.id) savedIds.push(result.id);
            }
        }

        console.log(`[Tool] scan_project | path: ${scanPath} | findings: ${findings.length} | saved: ${savedIds.length} memories`);
        return {
            success: true,
            path: scanPath,
            findings_count: findings.length,
            memories_saved: savedIds.length,
            findings,
        };
    }

    // =========================================================================
    // GRUPO C — Delegate task (recursivo via runAgentLoop)
    // =========================================================================

    if (toolName === 'delegate_task' || toolName === 'send_agent_message') {
        if (!runAgentLoop) return { error: 'runAgentLoop not available in this context.' };

        const subIdentifierRaw = String(args.subAgentIdentifier || args.recipientIdentifier || args.agentId || '').trim();
        const subIdentifier = subIdentifierRaw.toLowerCase();
        const agents = listAgents(username);
        const subAgent = agents.find(a => a.id === subIdentifier || a.name.toLowerCase() === subIdentifier);
        if (!subAgent) return { error: `Sub-agent '${subIdentifierRaw}' not found.` };
        if (subAgent.id === agentId || subIdentifier === agentId.toLowerCase()) {
            return { error: `LOOP PREVENTED: Agent '${subAgent.name}' cannot delegate to itself. Nested/self delegation is blocked.` };
        }
        const subAgentRole = subAgent.role || (subAgent.isMaster ? 'master' : 'worker');
        const isDelegatedMaster = subAgentRole === 'master';

        const task = args.task || args.message;
        const delegateConfig = normalizeDelegateConfig(args, { mode: subAgent.executionMode || 'strict' });
        const timeoutMs = delegateConfig.timeoutSeconds * 1000;
        const modelState = readState(username) || {};
        const assignedModel = chooseDefaultChatModel((modelState.modelConfigs || []).filter(m => m.id === subAgent.model || m.modelId === subAgent.model)) || chooseDefaultChatModel(modelState.modelConfigs || []);
        const assignedModelId = String(assignedModel?.modelId || assignedModel?.name || '').toLowerCase();
        if (!assignedModelId || assignedModelId.includes('embed') || assignedModelId.includes('embedding')) {
            return { success: false, error: `Agent "${subAgent.name}" is configured with an embedding model (${assignedModel?.modelId || subAgent.model || 'unknown'}). Please assign a chat model.`, attempts: 1 };
        }

        const masterCwd = getCwd(agentId);
        if (masterCwd) setCwd(subAgent.id, masterCwd);

        const systemContext = String(subAgent?.systemPrompt || '').trim();

        try {
            const result = await invokeAgentWithContract({
                runAgentLoop,
                broadcastToUser,
                username,
                orchestratorAgentId: agentId,
                subAgent,
                task,
                delegateConfig,
                systemContext,
                delegatedExecution: isDelegatedMaster ? 'master-sandbox' : 'standard',
            });

            const rawContent = typeof result.content === 'string' ? result.content.trim() : result.content;
            const parsed = safeJsonParse(rawContent);
            const rawPreview = summarizeRawDelegateOutput(rawContent);
            if (delegateConfig.outputMode === 'json' || delegateConfig.expectedOutputFields.length > 0) {
                if (!parsed || typeof parsed !== 'object') {
                    return {
                        success: false,
                        error: 'Sub-agent did not return valid JSON.',
                        content: rawContent,
                        rawPreview,
                        parseError: rawContent ? 'Unable to parse final sub-agent output as JSON.' : 'Sub-agent returned empty output.',
                        outputMode: delegateConfig.outputMode,
                        expectedOutputFields: delegateConfig.expectedOutputFields,
                        _subAgent: subAgent.name,
                    };
                }
                const missing = delegateConfig.expectedOutputFields.filter(f => !(f in parsed));
                if (missing.length > 0) {
                    return {
                        success: false,
                        error: `Missing fields: ${missing.join(', ')}`,
                        content: rawContent,
                        rawPreview,
                        missingFields: missing,
                        outputMode: delegateConfig.outputMode,
                        expectedOutputFields: delegateConfig.expectedOutputFields,
                        _subAgent: subAgent.name,
                    };
                }
                return { success: true, ...parsed, _subAgent: subAgent.name };
            }
            if (parsed && typeof parsed === 'object') return { success: true, ...parsed, _subAgent: subAgent.name };
            return { success: true, content: rawContent, _subAgent: subAgent.name };
        } catch (err) {
            const isTimeout = /timeout/i.test(err?.message || '');
            return { success: false, error: isTimeout ? `Timeout after ${Math.round(timeoutMs / 1000)}s` : err.message, timeout: isTimeout || undefined };
        }
    }

    // =========================================================================
    // delegate_parallel — bounded parallel batch using same delegate contract
    // =========================================================================
    if (toolName === 'delegate_parallel') {
        if (!runAgentLoop) return { error: 'runAgentLoop not available in this context.' };

        const tasks = Array.isArray(args.tasks) ? args.tasks : [];
        if (!tasks.length) return { error: 'No tasks provided.' };

        const agents = listAgents(username);
        const failFast = args.failFast === true;
        const maxConcurrency = Math.max(1, Math.min(Number(args.maxConcurrency || tasks.length) || tasks.length, tasks.length));

        const runTask = async (taskDef) => {
            const subIdentifierRaw = String(taskDef.subAgentIdentifier || '').trim();
            const subIdentifier = subIdentifierRaw.toLowerCase();
            const subAgent = agents.find(a => a.id === subIdentifier || a.name.toLowerCase() === subIdentifier);
            const label = taskDef.label || subIdentifierRaw;
            if (!subAgent) return { _label: label, success: false, error: `Agent '${subIdentifierRaw}' not found.` };
            if (subAgent.id === agentId || subIdentifier === agentId.toLowerCase()) return { _label: label, success: false, error: `Agent '${subAgent.name}' cannot delegate to itself.` };
            const subAgentRole = subAgent.role || (subAgent.isMaster ? 'master' : 'worker');
            const isDelegatedMaster = subAgentRole === 'master';

            const state = readState(username) || {};
            const assignedModel = chooseDefaultChatModel((state.modelConfigs || []).filter(m => m.id === subAgent.model || m.modelId === subAgent.model)) || chooseDefaultChatModel(state.modelConfigs || []);
            const assignedModelId = String(assignedModel?.modelId || assignedModel?.name || '').toLowerCase();
            if (!assignedModelId || assignedModelId.includes('embed') || assignedModelId.includes('embedding')) {
                return { _label: label, success: false, error: `Agent '${subAgent.name}' is configured with an embedding model (${assignedModel?.modelId || subAgent.model || 'unknown'}). Please assign a chat model.` };
            }

            const delegateConfig = normalizeDelegateConfig(taskDef, { mode: subAgent.executionMode || 'strict' });
            const masterCwd = getCwd(agentId);
            if (masterCwd) setCwd(subAgent.id, masterCwd);
            const payload = buildDelegatePromptPayload({ subAgent, task: taskDef.task, config: delegateConfig });

            try {
                const result = await runAgentLoop({
                    username,
                    agentId: subAgent.id,
                    messages: subAgent.systemPrompt ? [{ role: 'system', content: subAgent.systemPrompt }, { role: 'user', content: payload }] : [{ role: 'user', content: payload }],
                    isEphemeral: delegateConfig.ephemeral || isDelegatedMaster,
                    timeoutMs: delegateConfig.timeoutSeconds * 1000,
                    sandbox: {
                        mode: 'isolated-subagent',
                        orchestratorAgentId: agentId,
                        task: taskDef.task,
                        contract: { ...delegateConfig, delegatedExecution: isDelegatedMaster ? 'master-sandbox' : 'standard' },
                        maxIterations: delegateConfig.maxIterations,
                        delegatedAgentRole: subAgentRole,
                        disableSessionPersistence: isDelegatedMaster,
                    },
                    onEvent: (event, data) => {
                        broadcastToUser?.(username, 'delegate_status', {
                            masterAgentId: agentId,
                            subAgentId: subAgent.id,
                            subAgentName: subAgent.name,
                            status: event,
                            label,
                            detail: data || null,
                        });
                    },
                });
                const rawContent = typeof result.content === 'string' ? result.content.trim() : result.content;
                const parsed = safeJsonParse(rawContent);
                const rawPreview = summarizeRawDelegateOutput(rawContent);
                if (delegateConfig.outputMode === 'json' || delegateConfig.expectedOutputFields.length > 0) {
                    if (!parsed || typeof parsed !== 'object') {
                        return {
                            _label: label,
                            success: false,
                            error: 'Sub-agent did not return valid JSON.',
                            content: rawContent,
                            rawPreview,
                            parseError: rawContent ? 'Unable to parse final sub-agent output as JSON.' : 'Sub-agent returned empty output.',
                            outputMode: delegateConfig.outputMode,
                            expectedOutputFields: delegateConfig.expectedOutputFields,
                        };
                    }
                    const missing = delegateConfig.expectedOutputFields.filter(f => !(f in parsed));
                    if (missing.length > 0) {
                        return {
                            _label: label,
                            success: false,
                            error: `Missing fields: ${missing.join(', ')}`,
                            content: rawContent,
                            rawPreview,
                            missingFields: missing,
                            outputMode: delegateConfig.outputMode,
                            expectedOutputFields: delegateConfig.expectedOutputFields,
                        };
                    }
                    return { _label: label, success: true, ...parsed };
                }
                if (parsed && typeof parsed === 'object') return { _label: label, success: true, ...parsed };
                return { _label: label, success: true, content: rawContent };
            } catch (err) {
                return { _label: label, success: false, error: err.message };
            }
        };

        const results = [];
        for (let i = 0; i < tasks.length; i += maxConcurrency) {
            const chunk = tasks.slice(i, i + maxConcurrency);
            const chunkResults = await Promise.all(chunk.map(runTask));
            results.push(...chunkResults);
            if (failFast && chunkResults.some(r => !r.success)) break;
        }

        return {
            success: results.every(r => r.success),
            summary: `${results.filter(r => r.success).length}/${results.length} tasks succeeded`,
            results,
        };
    }

    // =========================================================================
    // GRUPO D — Jira tools (jira_queue, jira_action)
    // Calls the local Jira route logic via internal HTTP to localhost.
    // Auth is resolved from user state apiKeys (JIRA_KEY / JIRA_TOKEN),
    // falling back to x-jira-token / JIRA_TOKEN env — matching jira.routes.js.
    // =========================================================================

    if (toolName === 'jira_queue' || toolName === 'jira_action') {
        const state = readState(username) || {};
        const apiKeys = state.apiKeys || [];

        // Resolve Jira token: prefer stored secret, then env
        const storedKey = apiKeys.find((k) => k.name === 'JIRA_KEY' || k.name === 'JIRA_TOKEN');
        const jiraToken = storedKey?.value?.trim() || process.env.JIRA_TOKEN || '';

        if (!jiraToken) {
            return { error: 'Missing Jira token. Store JIRA_KEY or JIRA_TOKEN in your secrets, or set JIRA_TOKEN env var.' };
        }

        const port = process.env.PORT || 3011;
        const baseUrl = `http://localhost:${port}`;

        if (toolName === 'jira_queue') {
            const {
                jql,
                snapshotKey,
                listSnapshots = false,
                deleteSnapshot,
                fields,
                includeComments = false,
                compact = false,
                preserveRequestedFields = false,
                fieldAliases,
                summary,
                discover,
                analytics,
                exportRaw,
            } = args;
            const hasListSnapshots = typeof listSnapshots === 'boolean'
                ? listSnapshots
                : (listSnapshots && typeof listSnapshots === 'object' && !Array.isArray(listSnapshots));
            const hasDeleteSnapshot = !!(deleteSnapshot && typeof deleteSnapshot === 'object' && !Array.isArray(deleteSnapshot));
            if (!jql && !snapshotKey && !hasListSnapshots && !hasDeleteSnapshot) {
                return { error: 'Missing required parameter: jql, snapshotKey, listSnapshots, or deleteSnapshot' };
            }

            const params = new URLSearchParams();
            if (jql) params.set('jql', jql);
            else if (snapshotKey) params.set('snapshotKey', snapshotKey);
            if (hasListSnapshots) {
                params.set(
                    'listSnapshots',
                    typeof listSnapshots === 'boolean' ? 'true' : JSON.stringify(listSnapshots)
                );
            }
            if (hasDeleteSnapshot) {
                params.set('deleteSnapshot', JSON.stringify(deleteSnapshot));
            }
            if (fields) params.set('fields', fields);
            if (includeComments) params.set('includeComments', 'true');
            if (compact) params.set('compact', 'true');
            if (preserveRequestedFields) params.set('preserveRequestedFields', 'true');
            if (fieldAliases && typeof fieldAliases === 'object' && !Array.isArray(fieldAliases)) {
                params.set('fieldAliases', JSON.stringify(fieldAliases));
            }
            if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
                params.set('summary', JSON.stringify(summary));
            }
            if (discover && typeof discover === 'object' && !Array.isArray(discover)) {
                params.set('discover', JSON.stringify(discover));
            }
            if (analytics && typeof analytics === 'object' && !Array.isArray(analytics)) {
                params.set('analytics', JSON.stringify(analytics));
            }
            if (exportRaw && typeof exportRaw === 'object' && !Array.isArray(exportRaw)) {
                params.set('exportRaw', JSON.stringify(exportRaw));
            } else if (typeof exportRaw === 'boolean') {
                params.set('exportRaw', exportRaw ? 'true' : 'false');
            }

            const url = `${baseUrl}/api/jira/queue?${params.toString()}`;
            const res = await fetchWithRetry(url, {
                method: 'GET',
                headers: {
                    'x-jira-token': jiraToken,
                    'x-username': username,
                    'Content-Type': 'application/json',
                },
            });
            const text = await res.text();
            let parsed;
            try { parsed = JSON.parse(text); } catch { parsed = { response: text, status: res.status }; }
            // Large Jira queue payloads can consume too much model context; keep the HTTP route canonical/full
            // and truncate only the tool surface so bigger analyses can be handled via Python or artifact workflows.
            return truncateJiraQueueToolPayload(parsed);
        }

        if (toolName === 'jira_action') {
            const {
                action,
                issueKey,
                issueId,
                text,
                fields,
                transitionId,
                label,
                serviceDeskId,
                requestTypeId,
                requestFieldValues,
                postUpdateFields,
            } = args;
            const hasIssueKey = Boolean(String(issueKey || '').trim());
            const hasIssueId = Boolean(String(issueId || '').trim());
            const hasFieldsObject = fields && typeof fields === 'object' && !Array.isArray(fields) && Object.keys(fields).length > 0;
            const hasText = String(text || '').trim().length > 0;
            const hasCommentBodyObject = args.commentBody !== null && typeof args.commentBody === 'object';
            const hasLabel = String(label || '').trim().length > 0;
            const hasTransitionId = String(transitionId || '').trim().length > 0;
            const hasServiceDeskId = String(serviceDeskId || '').trim().length > 0;
            const hasRequestTypeId = String(requestTypeId || '').trim().length > 0;
            const hasRequestFieldValues = requestFieldValues && typeof requestFieldValues === 'object' && Object.keys(requestFieldValues).length > 0;
            const hasPostUpdateFields = postUpdateFields && typeof postUpdateFields === 'object' && Object.keys(postUpdateFields).length > 0;

            if (!action) return { error: 'Missing required parameter: action' };
            switch (action) {
                case 'create_issue':
                    if (!(hasFieldsObject || (hasServiceDeskId && hasRequestTypeId && hasRequestFieldValues))) {
                        return { error: 'Missing required parameters: fields or serviceDeskId, requestTypeId, requestFieldValues' };
                    }
                    break;
                case 'delete_issue':
                    if (!hasIssueKey && !hasIssueId) return { error: 'Missing required parameter: issueKey or issueId' };
                    break;
                case 'comment': {
                    if (!hasIssueKey || (!hasText && !hasCommentBodyObject)) return { error: 'Missing required parameters: issueKey, text or commentBody' };
                    const commentObservability = {
                        action,
                        issueKey: String(issueKey || '').trim(),
                        hasText,
                        hasCommentBody: hasCommentBodyObject,
                        textSizeApprox: hasText ? String(text || '').length : 0,
                        commentBodySizeApprox: hasCommentBodyObject ? (() => { try { return JSON.stringify(args.commentBody || {}).length; } catch { return 0; } })() : 0,
                        timestamp: new Date().toISOString(),
                    };

                    const body = { action };
                    if (hasIssueKey) body.issueKey = issueKey;
                    if (hasIssueId) body.issueId = issueId;
                    if (text !== undefined) body.text = text;
                    if (args.commentBody !== undefined) body.commentBody = args.commentBody;
                    if (fields !== undefined) body.fields = fields;
                    if (transitionId !== undefined) body.transitionId = transitionId;
                    if (label !== undefined) body.label = label;
                    if (serviceDeskId !== undefined) body.serviceDeskId = serviceDeskId;
                    if (requestTypeId !== undefined) body.requestTypeId = requestTypeId;
                    if (requestFieldValues !== undefined) body.requestFieldValues = requestFieldValues;
                    if (postUpdateFields !== undefined) body.postUpdateFields = postUpdateFields;

                    const url = `${baseUrl}/api/jira/action`;
                    const res = await fetchWithRetry(url, {
                        method: 'POST',
                        headers: {
                            'x-jira-token': jiraToken,
                            'x-username': username,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(body),
                    });
                    const text2 = await res.text();
                    const parsed = safeJsonParse(text2);
                    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                        parsed._observability = {
                            request: commentObservability,
                            result: {
                                action,
                                issueKey: commentObservability.issueKey,
                                hasText,
                                hasCommentBody: hasCommentBodyObject,
                                responseOk: typeof res.ok === 'boolean' ? res.ok : undefined,
                                status: typeof res.status === 'number' ? res.status : undefined,
                            },
                        };
                        return parsed;
                    }
                    return parsed || { response: text2, status: res.status };
                }
                case 'update_fields':
                    if (!hasIssueKey || !hasFieldsObject) return { error: 'Missing required parameters: issueKey, fields' };
                    break;
                case 'transition':
                    if ((!hasIssueKey && !hasIssueId) || !hasTransitionId) return { error: 'Missing required parameters: issueKey or issueId, transitionId' };
                    break;
                case 'add_label':
                    if (!hasIssueKey || !hasLabel) return { error: 'Missing required parameters: issueKey, label' };
                    break;
            }

            const body = { action };
            if (hasIssueKey) body.issueKey = issueKey;
            if (hasIssueId) body.issueId = issueId;
            if (text !== undefined) body.text = text;
            if (args.commentBody !== undefined) body.commentBody = args.commentBody;
            if (fields !== undefined) body.fields = fields;
            if (transitionId !== undefined) body.transitionId = transitionId;
            if (label !== undefined) body.label = label;
            if (serviceDeskId !== undefined) body.serviceDeskId = serviceDeskId;
            if (requestTypeId !== undefined) body.requestTypeId = requestTypeId;
            if (requestFieldValues !== undefined) body.requestFieldValues = requestFieldValues;
            if (postUpdateFields !== undefined) body.postUpdateFields = postUpdateFields;

            const url = `${baseUrl}/api/jira/action`;
            const res = await fetchWithRetry(url, {
                method: 'POST',
                headers: {
                    'x-jira-token': jiraToken,
                    'x-username': username,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            const text2 = await res.text();
            try { return JSON.parse(text2); } catch { return { response: text2, status: res.status }; }
        }
    }

    // =========================================================================
    // GRUPO C — request_plan_approval (daemon: auto-aprova + salva como alerta)
    // =========================================================================

    if (toolName === 'complete_plan_checklist_item') {
        const hasExplicitPlanIdentifier = Boolean(args.planKey || args.requestId);
        const targetRecord = (args.planKey && pendingApprovals.get(args.planKey))
            || (args.requestId && pendingApprovals.get(args.requestId))
            || (!hasExplicitPlanIdentifier ? findLatestInProgressPlanForAgent({ username, agentId, sessionId: ctx?.sessionId || null }) : null);
        if (!targetRecord) return { error: hasExplicitPlanIdentifier ? 'No matching plan found' : 'No active in-progress plan found' };
        if (targetRecord.status !== 'in_progress') return { error: 'Plan is not in progress' };
        const updated = markPlanItemCompleted(targetRecord, { itemId: args.itemId, itemText: args.itemText });
        if (!updated.ok) return { error: updated.error || 'Checklist item not found' };
        pendingApprovals.set(updated.record.requestId, updated.record);
        broadcastPlanUpdate(updated.record);
        return { success: true, planKey: updated.record.requestId, planStatus: updated.record.status, itemStatus: updated.item?.status || 'done', item: updated.item };
    }

    if (toolName === 'comment_plan_checklist_item') {
        const hasExplicitPlanIdentifier = Boolean(args.planKey || args.requestId);
        const targetRecord = (args.planKey && pendingApprovals.get(args.planKey))
            || (args.requestId && pendingApprovals.get(args.requestId))
            || (!hasExplicitPlanIdentifier ? findLatestInProgressPlanForAgent({ username, agentId, sessionId: ctx?.sessionId || null }) : null);
        if (!targetRecord) return { error: hasExplicitPlanIdentifier ? 'No matching plan found' : 'No active in-progress plan found' };
        if (targetRecord.status !== 'in_progress') return { error: 'Plan is not in progress' };
        const updated = appendCommentToPlanItem(targetRecord, {
            itemId: args.itemId,
            itemText: args.itemText,
            text: args.text,
            author: agentId,
            role: 'agent',
        });
        if (!updated.ok) return { error: updated.error || 'Checklist item not found' };
        pendingApprovals.set(updated.record.requestId, updated.record);
        broadcastPlanUpdate(updated.record);
        return { success: true, planKey: updated.record.requestId, item: updated.item };
    }

    if (toolName === 'request_plan_approval') {
        console.warn(`[Tool] request_plan_approval (daemon auto-approve): ${args.title}`);
        const normalizedPlan = normalizePlanForStorage(args);
        const state = ctx.readState(username) || {};
        const pending = state.pendingAlerts || [];
        pending.push({
            id: `plan_${Date.now()}`,
            title: `[Auto-approved] ${args.title || 'Plan'}`,
            message: `Objective: ${args.objective || ''}\n\nApproach: ${args.approach || ''}`,
            type: 'info',
            agentId,
            timestamp: Date.now(),
            read: false,
        });
        state.pendingAlerts = pending;
        ctx.writeState(username, state);
        return { approved: true, auto: true, reason: 'daemon_mode', plan: normalizedPlan };
    }

    // =========================================================================
    // Ferramenta desconhecida
    // =========================================================================
    return { error: `Unknown tool: ${toolName}` };
}