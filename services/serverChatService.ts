// =============================================================================
// serverChatService.ts — Daemon Mode client
// Server owns all session history. Browser sends only the new message.
// =============================================================================

import { Message, ToolCall } from '../types';
import { APP_BASE_PATH } from '../constants';

const LOCAL_BASE = window.location.pathname.split('/').slice(0, 2).join('/') || APP_BASE_PATH;

export interface ServerChatResult {
    content: string;
    tool_calls: ToolCall[] | undefined;
    model: string;
    sessionId?: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        reasoning_tokens?: number;
    };
    reasoningTokens?: number;
}

export interface ServerChatOptions {
    username: string;
    agentId: string;
    sessionId: string;          // required — server loads history by this ID
    newMessage: Message;        // only the new user message
    model?: string;             // optional model override (bypasses agent.model from DB)
    signal?: AbortSignal;
    onChunk?: (chunk: string) => void;
    onLog?: (entry: any) => void;
    onEvent?: (event: string, data: any) => void;
    projectPath?: string;
}

// ---------------------------------------------------------------------------
// Session API helpers
// ---------------------------------------------------------------------------

export async function loadSession(sessionId: string, username: string): Promise<{ messages: Message[]; title: string; summary: string; notes?: any[]; activeNoteId?: string | null; note?: any; notesEnabled?: boolean } | null> {
    try {
        const res = await fetch(`${LOCAL_BASE}/api/sessions/${encodeURIComponent(sessionId)}?username=${encodeURIComponent(username)}`);
        if (!res.ok) return null;
        const { session } = await res.json();
        if (!session || typeof session !== 'object') return null;

        const notes = Array.isArray(session.notes) ? session.notes : [];
        const activeNoteId = session.activeNoteId ?? session.active_note ?? null;
        const activeNote = activeNoteId
            ? notes.find((note: any) => String(note?.noteId ?? note?.id) === String(activeNoteId)) || null
            : notes[0] || null;

        return {
            ...session,
            notes,
            activeNoteId,
            note: activeNote,
            notesEnabled: session.notesEnabled === true,
        };
    } catch {
        return null;
    }
}



export async function listNotes(username: string, sessionId?: string): Promise<{ notes: any[]; activeNoteId: string | null; sessionId: string | null }> {
    try {
        const query = new URLSearchParams({ username });
        const res = await fetch(`${LOCAL_BASE}/api/notes?${query.toString()}`);
        if (!res.ok) return { notes: [], activeNoteId: null, sessionId: sessionId ?? null };
        const payload = await res.json();
        return {
            notes: Array.isArray(payload?.notes) ? payload.notes : (payload?.note ? [payload.note] : []),
            activeNoteId: typeof payload?.activeNoteId === 'string' ? payload.activeNoteId : null,
            sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : (sessionId ?? null),
        };
    } catch {
        return { notes: [], activeNoteId: null, sessionId: sessionId ?? null };
    }
}

export async function readNote(username: string, noteId: string, sessionId?: string): Promise<{ note: any | null; noteId: string | null; sessionId: string | null; ambiguous?: boolean; matches?: any[] }> {
    try {
        const query = new URLSearchParams({ username });
        if (sessionId) query.set('sessionId', sessionId);
        const res = await fetch(`${LOCAL_BASE}/api/notes/${encodeURIComponent(noteId)}?${query.toString()}`);
        const payload = await res.json().catch(() => null);
        if (!res.ok) return { note: null, noteId: typeof payload?.noteId === 'string' ? payload.noteId : null, sessionId: sessionId ?? null };
        return {
            note: payload?.ambiguous ? null : (payload?.note ?? payload?.fragment ?? null),
            noteId: typeof payload?.noteId === 'string' ? payload.noteId : null,
            sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : (sessionId ?? null),
            ambiguous: Boolean(payload?.ambiguous),
            matches: Array.isArray(payload?.matches) ? payload.matches : undefined,
        };
    } catch {
        return { note: null, noteId: null, sessionId: sessionId ?? null };
    }
}


export async function setSessionNotesEnabled(sessionId: string, username: string, enabled: boolean): Promise<{ success: boolean; sessionId: string | null; notesEnabled: boolean; session?: any }> {
    const path = `/api/sessions/${encodeURIComponent(sessionId)}/notes-enabled`;
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, enabled }),
    });
    await ensureOk(res, 'POST', path);
    const payload = await res.json();
    return {
        success: Boolean(payload?.success),
        sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : sessionId,
        notesEnabled: payload?.notesEnabled === true,
        session: payload?.session || null,
    };
}

export async function setActiveSessionNote(sessionId: string, username: string, noteId: string): Promise<{ success: boolean; activeNoteId: string | null; sessionId: string | null }> {
    const path = `/api/sessions/${encodeURIComponent(sessionId)}/active-note`;
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, noteId }),
    });
    await ensureOk(res, 'POST', path);
    const payload = await res.json();
    return {
        success: Boolean(payload?.success),
        activeNoteId: typeof payload?.activeNoteId === 'string' ? payload.activeNoteId : null,
        sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : sessionId,
    };
}

export async function listSessions(username: string, agentId: string): Promise<any[]> {
    try {
        const res = await fetch(`${LOCAL_BASE}/api/sessions?username=${encodeURIComponent(username)}&agentId=${encodeURIComponent(agentId)}`);
        if (!res.ok) return [];
        const { sessions } = await res.json();
        return sessions || [];
    } catch {
        return [];
    }
}

async function ensureOk(res: Response, method: string, path: string): Promise<void> {
    if (res.ok) return;
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `${method} ${path} failed: ${res.status}`);
}

export async function createSession(username: string, agentId: string, id: string, title?: string): Promise<void> {
    const path = '/api/sessions';
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, agentId, id, title }),
    });
    await ensureOk(res, 'POST', path);
}

export async function renameSession(sessionId: string, username: string, agentId: string, title: string): Promise<void> {
    const path = '/api/sessions';
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, agentId, id: sessionId, title }),
    });
    await ensureOk(res, 'POST', path);
}

export async function deleteSession(sessionId: string, username: string): Promise<void> {
    const path = `/api/sessions/${encodeURIComponent(sessionId)}?username=${encodeURIComponent(username)}`;
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'DELETE',
    });
    await ensureOk(res, 'DELETE', path);
}

export async function saveSessionNote(sessionId: string, username: string, sessionNote: any): Promise<{ success: boolean; note: any; session: any; noteId?: string | null; version?: number | null }> {
    const payload = sessionNote && typeof sessionNote === 'object' && !Array.isArray(sessionNote)
        ? { ...sessionNote }
        : { contentHtml: sessionNote };
    const hasSpecificNoteId = typeof payload.noteId === 'string' && payload.noteId.trim().length > 0;

    if (!hasSpecificNoteId) {
        const path = `/api/sessions/${encodeURIComponent(sessionId)}/notes`;
        const res = await fetch(`${LOCAL_BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                note: {
                    title: payload.title ?? 'Session note',
                    contentHtml: payload.contentHtml ?? '<p></p>',
                },
            }),
        });
        await ensureOk(res, 'POST', path);
        const created = await res.json();
        return {
            success: Boolean(created?.success),
            note: created?.session?.notes?.find((entry: any) => String(entry?.noteId || entry?.id || '') === String(created?.noteId || '')) || created?.note || null,
            session: created?.session || null,
            noteId: created?.noteId ?? null,
            version: created?.version ?? null,
        };
    }

    const path = `/api/sessions/${encodeURIComponent(sessionId)}/notes/${encodeURIComponent(payload.noteId)}/read`;
    const readRes = await fetch(`${LOCAL_BASE}${path}?username=${encodeURIComponent(username)}`);
    await ensureOk(readRes, 'GET', path);
    const existing = await readRes.json();
    const currentVersion = existing?.version ?? existing?.note?.version ?? 0;
    const patchPath = `/api/sessions/${encodeURIComponent(sessionId)}/notes/${encodeURIComponent(payload.noteId)}`;
    const patchRes = await fetch(`${LOCAL_BASE}${patchPath}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username,
            noteId: payload.noteId,
            title: payload.title ?? 'Session note',
            expectedVersion: currentVersion,
            target: { anchor: 'root' },
            operation: 'replace',
            contentHtml: payload.contentHtml ?? '',
        }),
    });
    await ensureOk(patchRes, 'PATCH', patchPath);
    const updated = await patchRes.json();
    const refreshedSession = await loadSession(sessionId, username);
    return {
        success: Boolean(updated?.success),
        note: updated?.note || refreshedSession?.note || null,
        session: refreshedSession || null,
        noteId: updated?.noteId ?? payload.noteId ?? refreshedSession?.activeNoteId ?? null,
        version: updated?.version ?? null,
    };
}


export async function stopAgentRun(username: string, agentId?: string, sessionId?: string): Promise<{ success: boolean; stopped?: string[]; count?: number }> {
    const path = '/api/agent/stop';
    if (agentId && !sessionId) throw new Error('sessionId is required when agentId is provided');
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, agentId, sessionId }),
    });
    await ensureOk(res, 'POST', path);
    return res.json();
}

// ---------------------------------------------------------------------------
// executeChatRequest — sends only new message; server loads history
// ---------------------------------------------------------------------------
export async function executeChatRequest(opts: ServerChatOptions): Promise<ServerChatResult> {
    const { username, agentId, sessionId, newMessage, model, signal, onChunk, onLog, onEvent, projectPath } = opts;

    const requestStart = Date.now();

    const response = await fetch(`${LOCAL_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, agentId, sessionId, newMessage, model, projectPath }),
        signal,
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(err.error || `Chat request failed: ${response.status}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ServerChatResult = { content: '', tool_calls: undefined, model: '', sessionId };
    let currentEvent = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim(); continue; }
            if (!line.startsWith('data: ')) continue;

            try {
                const parsed = JSON.parse(line.slice(6));

                if (currentEvent === 'chunk') {
                    if (parsed.content && onChunk) onChunk(parsed.content);
                    onEvent?.('chunk', parsed);
                } else if (currentEvent === 'assistant_message') {
                    onEvent?.('assistant_message', parsed);
                } else if (currentEvent === 'tool_call') {
                    onEvent?.('tool_call', parsed);
                } else if (currentEvent === 'tool_result') {
                    onEvent?.('tool_result', parsed);
                } else if (currentEvent === 'agent_start') {
                    onEvent?.('agent_start', parsed);
                } else if (currentEvent === 'agent_done') {
                    onEvent?.('agent_done', parsed);
                } else if (currentEvent === 'session_updated') {
                    // Server saved session — browser can refresh display
                    onEvent?.('session_updated', parsed);
                } else if (currentEvent === 'llm_request') {
                    onEvent?.('llm_request', parsed);
                } else if (currentEvent === 'llm_response') {
                    onEvent?.('llm_response', parsed);
                } else if (currentEvent === 'memory_metrics') {
                    onEvent?.('memory_metrics', parsed);
                } else if (currentEvent === 'memory_injection') {
                    onEvent?.('memory_injection', parsed);
                } else if (currentEvent === 'terminal_signal' || currentEvent === 'stopped') {
                    onEvent?.('terminal_signal', parsed);
                } else if (currentEvent === 'done') {
                    result = {
                        content: parsed.content ?? '',
                        tool_calls: parsed.tool_calls ?? undefined,
                        model: parsed.model ?? '',
                        sessionId,
                        usage: parsed.usage,
                        reasoningTokens: parsed.reasoningTokens,
                    };
                    onLog?.({
                        id: `${Date.now()}-res`,
                        timestamp: Date.now(),
                        type: 'response',
                        method: 'SERVER_CHAT',
                        model: parsed.model || agentId,
                        content: { ...result, content: result.content.slice(0, 300) },
                        tokens: parsed.usage?.total_tokens,
                        durationMs: Date.now() - requestStart,
                    });
                } else if (currentEvent === 'error') {
                    throw new Error(parsed.message ?? 'Unknown server error');
                }

                currentEvent = '';
            } catch (e: any) {
                if (e.message && !e.message.startsWith('Unexpected')) throw e;
            }
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// isServerChatAvailable
// ---------------------------------------------------------------------------
export async function transcribeAudio(blob: Blob, mimeType?: string): Promise<{ text: string }> {
    const path = '/api/transcribe';
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': mimeType || blob.type || 'audio/webm',
        },
        body: blob,
    });

    const payload = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) {
        const details = typeof payload?.details === 'string'
            ? payload.details
            : typeof payload?.detail === 'string'
                ? payload.detail
                : '';
        const error = typeof payload?.error === 'string' ? payload.error : `POST ${path} failed: ${res.status}`;
        throw new Error(details ? `${error}: ${details}` : error);
    }

    return { text: typeof payload?.text === 'string' ? payload.text : '' };
}

export async function isServerChatAvailable(): Promise<boolean> {
    try {
        const res = await fetch(`${LOCAL_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ _ping: true }),
            signal: AbortSignal.timeout(2000),
        });
        return res.status === 400;
    } catch {
        return false;
    }
}
