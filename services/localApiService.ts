// =============================================================================
// localApiService.ts — HTTP client para o servidor local (mesmo container)
// Backend e frontend estão na mesma rede Docker — latência ~0ms
// Fonte de verdade sempre é o backend — nunca o estado React
// =============================================================================

import { APP_BASE_PATH, AUTH_TOKEN_STORAGE_KEY, LEGACY_AUTH_TOKEN_STORAGE_KEYS } from '../constants';
import type { PluginAccessEvent, PluginAccessEventFilters, PluginAccessGrant, PluginAccessGrantUpsert, PluginAccessRequest, PluginAccessRequestCreate, PluginAccessRequestDecision, PluginAccessRequestFilters, PluginCatalogEntry } from '../types';

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
    if (!res.ok) throw await requestError('POST', path, res);
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

async function requestError(method: string, path: string, res: Response): Promise<Error> {
    let detail = '';
    try {
        const body: unknown = await res.json();
        if (body && typeof body === 'object' && 'error' in body && typeof (body as { error?: unknown }).error === 'string') detail = (body as { error: string }).error;
    } catch { /* keep the bounded HTTP fallback */ }
    return new Error(`${method} ${path} failed: ${res.status}${detail ? ` — ${detail}` : ''}`);
}

export async function localPut<T = any>(path: string, body: object): Promise<T> {
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    });
    if (!res.ok) throw await requestError('PUT', path, res);
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

export interface PromptPackageFilters {
    status?: string;
    source?: string;
    repository?: string;
}

async function localGetRequired<T = any>(path: string): Promise<T> {
    const res = await fetch(`${LOCAL_BASE}${path}`, {
        headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
}

export async function listPromptPackages<T = any>(filters?: PromptPackageFilters): Promise<T> {
    const query = new URLSearchParams();
    (['status', 'source', 'repository'] as const).forEach((key) => {
        const value = filters?.[key];
        if (value !== undefined && value.trim()) query.set(key, value);
    });
    const search = query.toString();
    return localGetRequired<T>(`/api/settings/prompt-packages${search ? `?${search}` : ''}`);
}

export async function getPromptPackageDetail<T = any>(packageKey: string): Promise<T> {
    return localGetRequired<T>(`/api/settings/prompt-packages/${encodeURIComponent(packageKey)}`);
}

export async function importPromptPackage<T = any>(payload: object): Promise<T> {
    return localPost<T>('/api/settings/prompt-packages/import', payload);
}

export interface ClaudePluginImportCandidate {
    pluginRoot: string;
    manifest: {
        source: PinnedGithubPromptSourcePin & { contentHash: string };
        skills: Array<{ key: string; path: string }>;
        mcpBundles: [];
        metadata?: { claudePlugin?: { name?: string; version?: string; root?: string }; mcpInventory?: { serverKeys?: string[] } };
    };
}
export interface ClaudePluginDiscoveryResponse { sourceKey: string; resolvedCommit: string; candidates: ClaudePluginImportCandidate[]; }
export async function discoverClaudePluginsFromSource(sourceKey: string): Promise<ClaudePluginDiscoveryResponse> {
    return localPost<ClaudePluginDiscoveryResponse>(`/api/settings/prompt-package-sync-sources/${encodeURIComponent(sourceKey)}/claude-plugins/discover`, {});
}
export async function importClaudePluginFromSource(sourceKey: string, request: { pluginRoot: string; documentKey: string }): Promise<{ changed: boolean; resolvedCommit: string }> {
    return localPost<{ changed: boolean; resolvedCommit: string }>(`/api/settings/prompt-package-sync-sources/${encodeURIComponent(sourceKey)}/claude-plugins/import`, request);
}

export async function stagePromptPackage<T = any>(payload: object): Promise<T> {
    return localPost<T>('/api/settings/prompt-packages/stage', payload);
}

export async function activatePromptPackage<T = any>(packageKey: string, payload: object): Promise<T> {
    return localPost<T>(`/api/settings/prompt-packages/${encodeURIComponent(packageKey)}/activate`, payload);
}

export async function rollbackPromptPackage<T = any>(packageKey: string, payload: object): Promise<T> {
    return localPost<T>(`/api/settings/prompt-packages/${encodeURIComponent(packageKey)}/rollback`, payload);
}

export async function deactivatePromptPackage<T = any>(packageKey: string, payload: object): Promise<T> {
    return localPost<T>(`/api/settings/prompt-packages/${encodeURIComponent(packageKey)}/deactivate`, payload);
}

export interface PinnedGithubPromptSourcePin {
    provider: 'github';
    repository: string;
    ref: string;
    commit: string;
}

export type GithubPrivateAccessRequestStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export interface GithubPrivateAccessRequest {
    id: string;
    ownerUsername: string;
    source: GithubPromptSource;
    purpose: 'read_only';
    status: GithubPrivateAccessRequestStatus;
    requestedBy: string | null;
    decidedBy: string | null;
    requestedAt: number;
    decidedAt: number | null;
    expiresAt: number | null;
    revokedBy: string | null;
    revokedAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface GithubPrivateAccessEvent {
    id: string;
    requestId: string;
    ownerUsername: string;
    source: GithubPromptSource;
    purpose: 'read_only';
    event: 'requested' | 'approved' | 'rejected' | 'revoked';
    actor: string | null;
    occurredAt: number;
}

export async function createGithubPrivateAccessRequest(source: GithubPromptSource): Promise<{ request: GithubPrivateAccessRequest }> {
    return localPost('/api/settings/github-private-access-requests', { source, purpose: 'read_only' });
}

export async function listGithubPrivateAccessRequests(): Promise<{ requests: GithubPrivateAccessRequest[] }> {
    return localGetRequired('/api/settings/github-private-access-requests');
}

export async function decideGithubPrivateAccessRequest(requestId: string, status: 'approved' | 'rejected', expiresAt?: number): Promise<{ request: GithubPrivateAccessRequest }> {
    return localPost(`/api/settings/github-private-access-requests/${encodeURIComponent(requestId)}/decision`, { status, ...(status === 'approved' ? { expiresAt } : {}) });
}

export async function revokeGithubPrivateAccessRequest(requestId: string): Promise<{ request: GithubPrivateAccessRequest }> {
    return localPost(`/api/settings/github-private-access-requests/${encodeURIComponent(requestId)}/revoke`, {});
}

export async function listGithubPrivateAccessEvents(requestId?: string): Promise<{ events: GithubPrivateAccessEvent[] }> {
    return localGetRequired(`/api/settings/github-private-access-requests/events${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''}`);
}

export interface PinnedGithubPromptDescriptor {
    schemaVersion: 1;
    sourcePin: PinnedGithubPromptSourcePin;
    manifestPath: string;
    artifactPaths: string[];
}

export interface GithubPromptSource {
    provider: 'github';
    repository: string;
    ref: string;
}

export interface PromptPackageSyncSource {
    sourceKey: string;
    provider: string;
    repository: string;
    sourceRef: string;
    enabled: boolean;
    lastSeenCommit: string | null;
    lastStagedCommit: string | null;
    lastSyncAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface UpsertPromptPackageSyncSourceRequest {
    source: GithubPromptSource;
    enabled?: boolean;
    metadata?: Record<string, unknown>;
}

export interface PromptPackageManualSyncRequest {
    descriptor: PinnedGithubPromptDescriptor;
    package: Record<string, unknown>;
    version: Record<string, unknown>;
    documentKey: string;
    artifactMappings: Record<string, unknown>[];
    timeoutMs?: number;
    references?: Array<{ sourcePath: string; artifactKey?: string }>;
    details?: Record<string, unknown>;
}

export interface PromptPackageSyncJob {
    sourceKey: string;
    enabled: boolean;
    intervalSeconds: number;
    descriptor: PinnedGithubPromptDescriptor;
    package: Record<string, unknown>;
    version: Record<string, unknown>;
    documentKey: string;
    artifactMappings: Record<string, unknown>[];
    references: Array<{ sourcePath: string; artifactKey?: string }>;
    details: Record<string, unknown>;
    createdBy: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface UpsertPromptPackageSyncJobRequest {
    enabled?: boolean;
    intervalSeconds?: number;
    descriptor: PinnedGithubPromptDescriptor;
    package: Record<string, unknown>;
    version: Record<string, unknown>;
    documentKey: string;
    artifactMappings: Record<string, unknown>[];
    references?: Array<{ sourcePath: string; artifactKey?: string }>;
    details?: Record<string, unknown>;
}

export interface PromptPackageManualSyncResponse {
    materialized: {
        sourcePin: PinnedGithubPromptSourcePin;
        package: Record<string, unknown>;
        version: Record<string, unknown>;
        files: Array<{ path: string; content: string }>;
        references: Array<{ sourcePath: string; artifactKey?: string }>;
    };
    staged: {
        package: Record<string, unknown>;
        version: Record<string, unknown>;
        artifacts: Record<string, unknown>[];
        blocks: Record<string, unknown>[];
        refs: Record<string, unknown>[];
        event: Record<string, unknown>;
        changed: boolean;
    };
    checkpoint: {
        sourceKey: string;
        lastSeenCommit: string | null;
        lastStagedCommit: string | null;
        lastSyncAt: number | null;
    };
}

export async function listPromptPackageSyncSources(): Promise<{ sources: PromptPackageSyncSource[] }> {
    return localGetRequired<{ sources: PromptPackageSyncSource[] }>('/api/settings/prompt-package-sync-sources');
}

export async function upsertPromptPackageSyncSource(request: UpsertPromptPackageSyncSourceRequest): Promise<{ source: PromptPackageSyncSource }> {
    const body: UpsertPromptPackageSyncSourceRequest = { source: request.source };
    if (request.enabled !== undefined) body.enabled = request.enabled;
    if (request.metadata !== undefined) body.metadata = request.metadata;
    return localPut<{ source: PromptPackageSyncSource }>('/api/settings/prompt-package-sync-sources', body);
}

export async function syncPinnedGithubPromptPackageManually(request: PromptPackageManualSyncRequest): Promise<PromptPackageManualSyncResponse> {
    const body: PromptPackageManualSyncRequest = {
        descriptor: request.descriptor,
        package: request.package,
        version: request.version,
        documentKey: request.documentKey,
        artifactMappings: request.artifactMappings,
    };
    if (request.timeoutMs !== undefined) body.timeoutMs = request.timeoutMs;
    if (request.references !== undefined) body.references = request.references;
    if (request.details !== undefined) body.details = request.details;
    return localPost<PromptPackageManualSyncResponse>('/api/settings/prompt-package-sync/manual', body);
}

export async function listPromptPackageSyncJobs(): Promise<{ jobs: PromptPackageSyncJob[] }> {
    return localGetRequired<{ jobs: PromptPackageSyncJob[] }>('/api/settings/prompt-package-sync-jobs');
}

export async function upsertPromptPackageSyncJob(sourceKey: string, request: UpsertPromptPackageSyncJobRequest): Promise<{ job: PromptPackageSyncJob }> {
    const body: UpsertPromptPackageSyncJobRequest = {
        descriptor: request.descriptor,
        package: request.package,
        version: request.version,
        documentKey: request.documentKey,
        artifactMappings: request.artifactMappings,
    };
    if (request.enabled !== undefined) body.enabled = request.enabled;
    if (request.intervalSeconds !== undefined) body.intervalSeconds = request.intervalSeconds;
    if (request.references !== undefined) body.references = request.references;
    if (request.details !== undefined) body.details = request.details;
    return localPut<{ job: PromptPackageSyncJob }>(`/api/settings/prompt-package-sync-jobs/${encodeURIComponent(sourceKey)}`, body);
}

export async function deletePromptPackageSyncJob(sourceKey: string): Promise<void> {
    const res = await fetch(`${LOCAL_BASE}/api/settings/prompt-package-sync-jobs/${encodeURIComponent(sourceKey)}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`DELETE prompt package sync job failed: ${res.status}`);
}

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

export async function fetchAgentMcpBundles(username: string, id: string): Promise<any | null> {
    return localGet(`/api/agents/${encodeURIComponent(id)}/mcp-bundles`, username);
}

function pluginScopeQuery(scope: { packageKey: string; versionId?: string; sourceCommit?: string }): string {
    const query = new URLSearchParams({ packageKey: scope.packageKey });
    if ('versionId' in scope && scope.versionId) query.set('versionId', scope.versionId);
    if ('sourceCommit' in scope && scope.sourceCommit) query.set('sourceCommit', scope.sourceCommit);
    return query.toString();
}

/** Declarative/redacted plugin catalog; skill bodies and executable MCP config are never returned. */
export async function fetchAgentPluginCatalog(agentId: string): Promise<{ agentId: string; plugins: PluginCatalogEntry[] }> {
    return localGetRequired(`/api/agents/${encodeURIComponent(agentId)}/plugins/catalog`);
}
export async function fetchAgentPluginGrants(agentId: string, scope?: { packageKey: string; versionId?: string; sourceCommit?: string }): Promise<{ grant?: PluginAccessGrant | null; grants?: PluginAccessGrant[] }> {
    const query = scope ? `?${pluginScopeQuery(scope)}` : '';
    return localGetRequired(`/api/agents/${encodeURIComponent(agentId)}/plugin-grants${query}`);
}
export async function upsertAgentPluginGrant(agentId: string, input: PluginAccessGrantUpsert): Promise<{ grant: PluginAccessGrant }> {
    const { scope, ...body } = input;
    return localPut(`/api/agents/${encodeURIComponent(agentId)}/plugin-grants`, { ...scope, ...body });
}
export async function deleteAgentPluginGrant(agentId: string, scope: { packageKey: string; versionId?: string; sourceCommit?: string }): Promise<void> {
    const res = await fetch(`${LOCAL_BASE}/api/agents/${encodeURIComponent(agentId)}/plugin-grants?${pluginScopeQuery(scope)}`, { method: 'DELETE', headers: getAuthHeaders() });
    if (!res.ok) throw new Error(`DELETE /api/agents/${encodeURIComponent(agentId)}/plugin-grants failed: ${res.status}`);
}
export async function createPluginAccessRequest(input: PluginAccessRequestCreate): Promise<{ request: PluginAccessRequest }> {
    const { scope, ...body } = input;
    return localPost('/api/plugin-access/requests', { ...scope, ...body });
}
export async function fetchPluginAccessRequests(filters: PluginAccessRequestFilters = {}): Promise<{ requests: PluginAccessRequest[] }> {
    const query = new URLSearchParams();
    if (filters.agentId) query.set('agentId', filters.agentId);
    if (filters.status) query.set('status', filters.status);
    if (filters.scope) for (const [key, value] of new URLSearchParams(pluginScopeQuery(filters.scope))) query.set(key, value);
    return localGetRequired(`/api/plugin-access/requests${query.size ? `?${query}` : ''}`);
}
export async function decidePluginAccessRequest(requestId: string, decision: PluginAccessRequestDecision): Promise<{ request: PluginAccessRequest }> {
    return localPost(`/api/plugin-access/requests/${encodeURIComponent(requestId)}/decision`, decision);
}
export async function fetchPluginAccessEvents(filters: PluginAccessEventFilters = {}): Promise<{ events: PluginAccessEvent[] }> {
    const query = new URLSearchParams();
    if ('scope' in filters && filters.scope) for (const [key, value] of new URLSearchParams(pluginScopeQuery(filters.scope))) query.set(key, value);
    if ('requestId' in filters && filters.requestId) query.set('requestId', filters.requestId);
    if ('grantId' in filters && filters.grantId) query.set('grantId', filters.grantId);
    return localGetRequired(`/api/plugin-access/events${query.size ? `?${query}` : ''}`);
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
