// =============================================================================
// localApiService.ts — HTTP client para o servidor local (mesmo container)
// Backend e frontend estão na mesma rede Docker — latência ~0ms
// Fonte de verdade sempre é o backend — nunca o estado React
// =============================================================================

import { APP_BASE_PATH, AUTH_TOKEN_STORAGE_KEY, LEGACY_AUTH_TOKEN_STORAGE_KEYS } from '../constants';

const LOCAL_BASE = APP_BASE_PATH;


function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || LEGACY_AUTH_TOKEN_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find((value) => value);
    return token
        ? { ...extra, Authorization: `Bearer ${token}` }
        : extra;
}

export interface SessionUser {
    id: string;
    username: string;
    displayName: string;
    email: string | null;
    role: string;
    isActive: boolean;
    metadata?: Record<string, any>;
    createdAt: number;
    updatedAt: number;
}

export interface SessionInfo {
    id: string;
    userId: string;
    token: string;
    createdAt: number;
    updatedAt: number;
    expiresAt: number | null;
    lastSeenAt: number | null;
    metadata?: Record<string, any>;
}

export async function localGet<T = any>(path: string, username: string): Promise<T | null> {
    try {
        const url = `${LOCAL_BASE}${path}?username=${encodeURIComponent(username)}`;
        const res = await fetch(url, {
            headers: getAuthHeaders(),
        });
        if (!res.ok) {
            return null;
        }
        const data = await res.json();
        return data;
    } catch (error: any) {
        return null;
    }
}

export async function localPost<T = any>(path: string, body: object): Promise<T> {
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
}

export async function localPatch<T = any>(path: string, body: object): Promise<T> {
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
    return res.json();
}

export async function localPut<T = any>(path: string, body: object): Promise<T> {
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status}`);
    return res.json();
}

export async function localDelete<T = any>(path: string, body: object): Promise<T> {
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'DELETE',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    return res.json();
}

// Helpers de domínio — buscam dados frescos do servidor

export async function fetchConfig(username: string): Promise<any | null> {
    return localGet('/api/config', username);
}

export async function fetchAgents(username: string): Promise<any[] | null> {
    const res = await localGet<{ agents: any[] }>('/api/agents', username);
    return res?.agents ?? null;
}

export async function patchField(username: string, field: string, value: any): Promise<void> {
    await localPatch('/api/config', { username, fields: { [field]: value } });
}

export async function patchFields(username: string, fields: Record<string, any>): Promise<void> {
    await localPatch('/api/config', { username, fields });
}

export async function saveAgentsToServer(username: string, agents: any[]): Promise<void> {
    await localPost('/api/agents', { username, agent: null, agents });
}

export async function createAgentOnServer<T = any>(username: string, agent: object): Promise<T> {
    return localPost<T>('/api/agents', { username, agent });
}

export async function updateAgentOnServer<T = any>(username: string, id: string, agent: object): Promise<T> {
    return localPut<T>(`/api/agents/${encodeURIComponent(id)}`, { username, agent });
}

export async function deleteAgentOnServer<T = any>(username: string, id: string): Promise<T> {
    return localDelete<T>(`/api/agents/${encodeURIComponent(id)}`, { username });
}

export async function fetchAgentPromptDocument(username: string, id: string): Promise<any | null> {
    return localGet(`/api/agents/${encodeURIComponent(id)}/prompt-document`, username);
}

export async function fetchAgentPromptVersions(username: string, id: string): Promise<any | null> {
    return localGet(`/api/agents/${encodeURIComponent(id)}/prompt-versions`, username);
}

export async function publishAgentPrompt(username: string, id: string, content?: string): Promise<any | null> {
    return localPost(`/api/agents/${encodeURIComponent(id)}/prompt-publish`, { username, content: content ?? '' });
}

export async function rollbackAgentPrompt(username: string, agentId: string, versionId: string): Promise<any | null> {
    return localPost(`/api/agents/${encodeURIComponent(agentId)}/prompt-rollback`, { username, versionId });
}


// Prompt blocks / composition helpers (agent-scoped)
export async function fetchAgentPromptBlocks(username: string, agentId: string): Promise<any[] | null> {
    const res = await localGet<{ blocks: any[] }>(`/api/agents/${encodeURIComponent(agentId)}/prompt-blocks`, username);
    return res?.blocks ?? null;
}

export async function createPromptBlock<T = any>(username: string, agentId: string, block: object): Promise<T> {
    return localPost<T>(`/api/agents/${encodeURIComponent(agentId)}/prompt-blocks`, { username, ...block });
}

export async function deletePromptBlock<T = any>(username: string, agentId: string, blockId: string): Promise<T> {
    return localDelete<T>(`/api/agents/${encodeURIComponent(agentId)}/prompt-blocks/${encodeURIComponent(blockId)}`, { username });
}

export async function fetchPromptBlockVersions(username: string, agentId: string, blockId: string): Promise<any[] | null> {
    const res = await localGet<{ versions: any[] }>(`/api/agents/${encodeURIComponent(agentId)}/prompt-blocks/${encodeURIComponent(blockId)}/versions`, username);
    return res?.versions ?? null;
}

export async function createPromptBlockVersion<T = any>(username: string, agentId: string, blockId: string, version: object): Promise<T> {
    return localPost<T>(`/api/agents/${encodeURIComponent(agentId)}/prompt-blocks/${encodeURIComponent(blockId)}/versions`, { username, ...version });
}

export async function fetchPromptAssignments(username: string, agentId: string): Promise<any[] | null> {
    const res = await localGet<{ assignments: any[] }>(`/api/agents/${encodeURIComponent(agentId)}/prompt-assignments`, username);
    return res?.assignments ?? null;
}

export async function updatePromptAssignments<T = any>(username: string, agentId: string, blockId: string, assignment: object): Promise<T> {
    return localPut<T>(`/api/agents/${encodeURIComponent(agentId)}/prompt-assignments/${encodeURIComponent(blockId)}`, { username, ...assignment });
}

export async function fetchPromptRefs(username: string, agentId: string): Promise<any[] | null> {
    const res = await localGet<{ refs: any[] }>(`/api/agents/${encodeURIComponent(agentId)}/prompt-refs`, username);
    return res?.refs ?? null;
}

export async function updatePromptRefs<T = any>(username: string, agentId: string, blockId: string, ref: object): Promise<T> {
    return localPut<T>(`/api/agents/${encodeURIComponent(agentId)}/prompt-refs/${encodeURIComponent(blockId)}`, { username, ...ref });
}

export async function updatePromptRefsBatch<T = any>(username: string, agentId: string, refs: object[]): Promise<T> {
    return localPost<T>(`/api/agents/${encodeURIComponent(agentId)}/prompt-refs/batch`, { username, refs });
}

export async function fetchCompositionPreview(username: string, agentId: string): Promise<any | null> {
    return localGet(`/api/agents/${encodeURIComponent(agentId)}/prompt-composition-preview`, username);
}

export async function publishPromptComposition(username: string, agentId: string): Promise<any | null> {
    return localPost(`/api/agents/${encodeURIComponent(agentId)}/prompt-publish`, { username, useComposition: true });
}

// Prompt helpers — global settings surface (/api/settings/prompt-*)
export async function fetchGlobalPromptDocument(username: string): Promise<any | null> {
    return localGet('/api/settings/prompt-document', username);
}

export async function fetchGlobalPromptBlocks(username: string, agentType?: string): Promise<any[] | null> {
    const path = agentType ? `/api/settings/prompt-blocks?agentType=${encodeURIComponent(agentType)}` : '/api/settings/prompt-blocks';
    const res = await localGet<{ blocks: any[] }>(path, username);
    return res?.blocks ?? null;
}

export async function createGlobalPromptBlock<T = any>(username: string, block: object, agentType?: string): Promise<T> {
    const body = agentType ? { username, agentType, ...block } : { username, ...block };
    return localPost<T>('/api/settings/prompt-blocks', body);
}

export async function fetchGlobalPromptBlockVersions(username: string, blockId: string): Promise<any[] | null> {
    const res = await localGet<{ versions: any[] }>(`/api/settings/prompt-blocks/${encodeURIComponent(blockId)}/versions`, username);
    return res?.versions ?? null;
}

export async function createGlobalPromptBlockVersion<T = any>(username: string, blockId: string, version: object, agentType?: string): Promise<T> {
    const body = agentType ? { username, agentType, ...version } : { username, ...version };
    return localPost<T>(`/api/settings/prompt-blocks/${encodeURIComponent(blockId)}/versions`, body);
}

export async function deleteGlobalPromptBlock<T = any>(username: string, blockId: string): Promise<T> {
    return localDelete<T>(`/api/settings/prompt-blocks/${encodeURIComponent(blockId)}`, { username });
}

export async function fetchGlobalPromptAssignments(username: string, agentType?: string): Promise<any[] | null> {
    const path = agentType ? `/api/settings/prompt-assignments?agentType=${encodeURIComponent(agentType)}` : '/api/settings/prompt-assignments';
    const res = await localGet<{ assignments: any[] }>(path, username);
    return res?.assignments ?? null;
}

export async function updateGlobalPromptAssignments<T = any>(username: string, blockId: string, assignment: object, agentType?: string): Promise<T> {
    const body = agentType ? { username, agentType, ...assignment } : { username, ...assignment };
    return localPut<T>(`/api/settings/prompt-assignments/${encodeURIComponent(blockId)}`, body);
}

export async function fetchGlobalPromptRefs(username: string): Promise<any[] | null> {
    const res = await localGet<{ refs: any[] }>('/api/settings/prompt-refs', username);
    return res?.refs ?? null;
}

export async function updateGlobalPromptRefs<T = any>(username: string, blockId: string, ref: object): Promise<T> {
    return localPut<T>(`/api/settings/prompt-refs/${encodeURIComponent(blockId)}`, { username, ...ref });
}

export async function fetchGlobalCompositionPreview(username: string, agentType?: string): Promise<any | null> {
    const path = agentType ? `/api/settings/prompt-composition-preview?agentType=${encodeURIComponent(agentType)}` : '/api/settings/prompt-composition-preview';
    return localGet(path, username);
}

export async function publishGlobalPromptComposition(username: string, content?: string, agentType?: string): Promise<any | null> {
    const body = agentType ? { username, agentType, content: content ?? '' } : { username, content: content ?? '' };
    return localPost('/api/settings/prompt-publish', body);
}

const localApiService = {
    fetchGlobalPromptBlocks,
    createGlobalPromptBlock,
    fetchGlobalPromptAssignments,
    updateGlobalPromptAssignments,
    fetchGlobalPromptRefs,
    updateGlobalPromptRefs,
    fetchGlobalCompositionPreview,
    publishGlobalPromptComposition,
};

export default localApiService;

export async function fetchSession(): Promise<{ ok: boolean; username: string; user: SessionUser | null; session: SessionInfo | null } | null> {
    try {
        const res = await fetch(`${LOCAL_BASE}/api/auth/me`, {
            headers: getAuthHeaders(),
        });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

export async function loginWithUser(username: string): Promise<{ success: boolean; token: string; username: string; user: SessionUser; session: SessionInfo }> {
    const res = await fetch(`${LOCAL_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
    });
    if (!res.ok) throw new Error(`POST /api/auth/login failed: ${res.status}`);
    return res.json();
}

export async function logoutSession(): Promise<void> {
    await fetch(`${LOCAL_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: getAuthHeaders(),
    }).catch(() => {});
}

export async function fetchUsers(): Promise<SessionUser[]> {
    const res = await fetch(`${LOCAL_BASE}/api/users`, {
        headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`GET /api/users failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.users) ? data.users : [];
}

export async function createUserOnServer(payload: { username: string; displayName?: string; email?: string | null; metadata?: Record<string, any> }): Promise<{ success: boolean; user: SessionUser; users: SessionUser[] }> {
    return localPost<{ success: boolean; user: SessionUser; users: SessionUser[] }>('/api/users', payload);
}

export async function updateUserOnServer<T = any>(id: string, payload: object): Promise<T> {
    return localPut<T>(`/api/users/${encodeURIComponent(id)}`, payload);
}

export async function deleteUserOnServer<T = any>(id: string): Promise<T> {
    return localDelete<T>(`/api/users/${encodeURIComponent(id)}`, {});
}
