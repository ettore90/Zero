import React from 'react';
import { activatePromptPackage, createGithubPrivateAccessRequest, fetchAgents, getGithubConnectionStatus, getGithubCliDeviceFlowStatus, startGithubCliDeviceFlow, startGithubOAuth, disconnectGithubOAuth, decideGithubPrivateAccessRequest, deactivatePromptPackage, deletePromptPackageSyncJob, discoverClaudePluginsFromSource, getPromptPackageDetail, importClaudePluginFromSource, listGithubPrivateAccessEvents, listGithubPrivateAccessRequests, listPromptPackages, listPromptPackageSyncJobs, listPromptPackageSyncSources, revokeGithubPrivateAccessRequest, rollbackPromptPackage, syncPinnedGithubPromptPackageManually, upsertPromptPackageSyncJob, upsertPromptPackageSyncSource, type ClaudePluginImportCandidate, type GithubPrivateAccessEvent, type GithubPrivateAccessRequest, type PromptPackageManualSyncRequest, type PromptPackageSyncJob, type PromptPackageSyncSource, type UpsertPromptPackageSyncJobRequest } from '../services/localApiService';

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => !!value && typeof value === 'object' && !Array.isArray(value);
const hasOnlyKeys = (value: UnknownRecord, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const parseManualSyncRequest = (value: unknown): PromptPackageManualSyncRequest | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['descriptor', 'package', 'version', 'documentKey', 'artifactMappings', 'timeoutMs', 'references', 'details'])) return null;
  const descriptor = value.descriptor;
  if (!isRecord(descriptor) || !hasOnlyKeys(descriptor, ['schemaVersion', 'sourcePin', 'manifestPath', 'artifactPaths']) || descriptor.schemaVersion !== 1 || typeof descriptor.manifestPath !== 'string' || !Array.isArray(descriptor.artifactPaths) || !descriptor.artifactPaths.every(path => typeof path === 'string')) return null;
  const sourcePin = descriptor.sourcePin;
  if (!isRecord(sourcePin) || !hasOnlyKeys(sourcePin, ['provider', 'repository', 'ref', 'commit']) || sourcePin.provider !== 'github' || typeof sourcePin.repository !== 'string' || typeof sourcePin.ref !== 'string' || typeof sourcePin.commit !== 'string') return null;
  if (!isRecord(value.package) || !isRecord(value.version) || typeof value.documentKey !== 'string' || !Array.isArray(value.artifactMappings) || !value.artifactMappings.every(isRecord)) return null;
  if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== 'number' || !Number.isFinite(value.timeoutMs))) return null;
  if (value.references !== undefined && (!Array.isArray(value.references) || !value.references.every(reference => isRecord(reference) && hasOnlyKeys(reference, ['sourcePath', 'artifactKey']) && typeof reference.sourcePath === 'string' && (reference.artifactKey === undefined || typeof reference.artifactKey === 'string')))) return null;
  if (value.details !== undefined && !isRecord(value.details)) return null;
  return value as unknown as PromptPackageManualSyncRequest;
};
const hasMatchingEnabledSyncSource = (request: PromptPackageManualSyncRequest, sources: PromptPackageSyncSource[]) => sources.some(source => source.enabled
  && source.provider === 'github'
  && source.repository === request.descriptor.sourcePin.repository
  && source.sourceRef === request.descriptor.sourcePin.ref);
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
};
const date = (value: unknown) => {
  if (typeof value !== 'number' && typeof value !== 'string') return '—';
  const numeric = typeof value === 'number' || /^\d+$/.test(value) ? Number(value) : value;
  const parsed = new Date(typeof numeric === 'number' && numeric < 100000000000 ? numeric * 1000 : numeric);
  return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toLocaleString();
};
const manifestMetadataFields = ['schemaVersion', 'packageKey', 'version', 'source', 'repository', 'sourceRef', 'sourceCommit', 'createdAt'] as const;
type ManifestMetadataField = typeof manifestMetadataFields[number];
type ManifestMetadata = [ManifestMetadataField, string][];
const manifestMetadata = (value: unknown): ManifestMetadata => {
  if (!isRecord(value)) return [];
  return manifestMetadataFields.flatMap(field => {
    const metadata = value[field];
    if ((typeof metadata !== 'string' && typeof metadata !== 'number' && typeof metadata !== 'boolean') || metadata === '') return [];
    return [[field, String(metadata)]];
  });
};

const PromptPackageCatalog: React.FC = () => {
  const [filters, setFilters] = React.useState({ status: '', source: '', repository: '' });
  const [packages, setPackages] = React.useState<UnknownRecord[]>([]);
  const [selectedKey, setSelectedKey] = React.useState('');
  const [detail, setDetail] = React.useState<UnknownRecord | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [lifecycleAction, setLifecycleAction] = React.useState('');
  const [syncSources, setSyncSources] = React.useState<PromptPackageSyncSource[]>([]);
  const [syncSourcesLoading, setSyncSourcesLoading] = React.useState(false);
  const [syncSourceError, setSyncSourceError] = React.useState('');
  const [syncSourceSaving, setSyncSourceSaving] = React.useState(false);
  const [syncSourceForm, setSyncSourceForm] = React.useState({ repository: '', ref: '', enabled: true });
  const [githubAccessRequests, setGithubAccessRequests] = React.useState<GithubPrivateAccessRequest[]>([]);
  const [githubAccessEvents, setGithubAccessEvents] = React.useState<GithubPrivateAccessEvent[]>([]);
  const [githubAccessLoading, setGithubAccessLoading] = React.useState(false);
  const [githubAccessError, setGithubAccessError] = React.useState('');
  const [githubAccessAction, setGithubAccessAction] = React.useState('');
  const [githubAccessAuditOpen, setGithubAccessAuditOpen] = React.useState(false);
  const [manualSyncPayload, setManualSyncPayload] = React.useState('');
  const [manualSyncSaving, setManualSyncSaving] = React.useState(false);
  const [manualSyncError, setManualSyncError] = React.useState('');
  const [manualSyncStatus, setManualSyncStatus] = React.useState('');
  const [syncJobs, setSyncJobs] = React.useState<PromptPackageSyncJob[]>([]);
  const [syncJobsLoading, setSyncJobsLoading] = React.useState(false);
  const [syncJobError, setSyncJobError] = React.useState('');
  const [syncJobStatus, setSyncJobStatus] = React.useState('');
  const [syncJobAction, setSyncJobAction] = React.useState('');
  const [syncJobForm, setSyncJobForm] = React.useState({ intervalSeconds: '3600', enabled: true });
  const [claudeImportForm, setClaudeImportForm] = React.useState({ sourceKey: '', agentId: '' });
  const [agentChoices, setAgentChoices] = React.useState<Array<{ id: string; name?: string }>>([]);
  const [githubConnection, setGithubConnection] = React.useState<{ oauthConfigured: boolean; oauth: { connected: boolean }; cliAvailable: boolean; cliConnected: boolean; runtimeTokenAvailable: boolean } | null>(null);
  const [githubCliFlow, setGithubCliFlow] = React.useState<{ active: boolean; connected: boolean; verificationUri?: string; userCode?: string | null; expiresAt?: number; error?: string | null } | null>(null);
  const [githubConnectionError, setGithubConnectionError] = React.useState('');
  const [claudeCandidates, setClaudeCandidates] = React.useState<ClaudePluginImportCandidate[]>([]);
  const [selectedClaudeRoot, setSelectedClaudeRoot] = React.useState<string | null>(null);
  const [claudeImportError, setClaudeImportError] = React.useState('');
  const [claudeImportStatus, setClaudeImportStatus] = React.useState('');
  const [claudeImportAction, setClaudeImportAction] = React.useState<'preview' | 'import' | ''>('');

  const detailRequestRef = React.useRef(0);
  const packagesRequestRef = React.useRef(0);
  const lifecycleActionRef = React.useRef('');
  const lifecycleRequestRef = React.useRef(0);
  const selectedKeyRef = React.useRef('');
  const syncSourcesRequestRef = React.useRef(0);
  const syncSourceSaveRequestRef = React.useRef(0);
  const githubAccessRequestRef = React.useRef(0);
  const githubAccessActionRef = React.useRef('');
  const manualSyncRequestRef = React.useRef(0);
  const syncJobsRequestRef = React.useRef(0);
  const syncJobActionRef = React.useRef('');
  const parsedManualSyncRequest = React.useMemo(() => {
    try { return parseManualSyncRequest(JSON.parse(manualSyncPayload)); } catch { return null; }
  }, [manualSyncPayload]);
  const manualSyncSourceMatches = !!parsedManualSyncRequest && hasMatchingEnabledSyncSource(parsedManualSyncRequest, syncSources);
  const syncJobInterval = Number(syncJobForm.intervalSeconds);
  const syncJobIntervalValid = Number.isInteger(syncJobInterval) && syncJobInterval >= 60 && syncJobInterval <= 86400;
  const syncJobCanSave = !!parsedManualSyncRequest && manualSyncSourceMatches && syncJobIntervalValid && !syncJobAction;

  const invalidateLifecycleAction = React.useCallback(() => {
    ++lifecycleRequestRef.current;
    lifecycleActionRef.current = '';
    setLifecycleAction('');
  }, []);

  const loadPackages = React.useCallback(async (canApply: () => boolean = () => true) => {
    if (!canApply()) return;
    const requestToken = ++packagesRequestRef.current;
    setLoading(true); setError('');
    try {
      const result = await listPromptPackages<unknown>(filters);
      if (requestToken !== packagesRequestRef.current || !canApply()) return;
      const response = isRecord(result) ? result : {};
      const next = asArray(response.packages).filter(isRecord);
      setPackages(next);
      const currentSelectedKey = selectedKeyRef.current;
      if (currentSelectedKey && !next.some(item => text(item.packageKey, '') === currentSelectedKey)) {
        invalidateLifecycleAction();
        ++detailRequestRef.current;
        selectedKeyRef.current = '';
        setSelectedKey(''); setDetail(null); setDetailLoading(false);
      }
      return next;
    } catch (e: any) {
      if (requestToken !== packagesRequestRef.current || !canApply()) return;
      setPackages([]); setError(e?.message || 'Failed to load prompt packages.');
    } finally {
      if (requestToken === packagesRequestRef.current && canApply()) setLoading(false);
    }
  }, [filters, invalidateLifecycleAction]);

  const loadSyncSources = React.useCallback(async () => {
    const requestToken = ++syncSourcesRequestRef.current;
    setSyncSourcesLoading(true);
    setSyncSourceError('');
    try {
      const result = await listPromptPackageSyncSources();
      if (requestToken !== syncSourcesRequestRef.current) return;
      setSyncSources(Array.isArray(result.sources) ? result.sources : []);
    } catch (e: any) {
      if (requestToken !== syncSourcesRequestRef.current) return;
      setSyncSources([]);
      setSyncSourceError(e?.message || 'Failed to load pinned GitHub sync sources.');
    } finally {
      if (requestToken === syncSourcesRequestRef.current) setSyncSourcesLoading(false);
    }
  }, []);

  const loadGithubAccess = React.useCallback(async () => {
    const requestToken = ++githubAccessRequestRef.current;
    setGithubAccessLoading(true);
    setGithubAccessError('');
    try {
      const [requestResult, eventResult] = await Promise.all([listGithubPrivateAccessRequests(), listGithubPrivateAccessEvents()]);
      if (requestToken !== githubAccessRequestRef.current) return;
      setGithubAccessRequests(Array.isArray(requestResult.requests) ? requestResult.requests : []);
      setGithubAccessEvents(Array.isArray(eventResult.events) ? eventResult.events : []);
    } catch (e: any) {
      if (requestToken !== githubAccessRequestRef.current) return;
      setGithubAccessError(e?.message || 'Unable to load private GitHub access authorization.');
    } finally {
      if (requestToken === githubAccessRequestRef.current) setGithubAccessLoading(false);
    }
  }, []);

  const latestGithubAccessRequest = React.useCallback((source: PromptPackageSyncSource) => githubAccessRequests
    .filter(request => request.source.provider === 'github' && request.source.repository === source.repository && request.source.ref === source.sourceRef && request.purpose === 'read_only')
    .sort((a, b) => b.requestedAt - a.requestedAt || b.id.localeCompare(a.id))[0], [githubAccessRequests]);

  const runGithubAccessAction = async (action: 'request' | 'approve' | 'reject' | 'revoke', source: PromptPackageSyncSource, request?: GithubPrivateAccessRequest) => {
    const actionKey = `${action}:${request?.id || source.sourceKey}`;
    if (githubAccessActionRef.current) return;
    if ((action === 'approve' || action === 'reject' || action === 'revoke') && !request) return;
    githubAccessActionRef.current = actionKey;
    setGithubAccessAction(actionKey);
    setGithubAccessError('');
    try {
      if (action === 'request') await createGithubPrivateAccessRequest({ provider: 'github', repository: source.repository, ref: source.sourceRef });
      else if (action === 'approve') await decideGithubPrivateAccessRequest(request!.id, 'approved', Math.floor(Date.now() / 1000) + 3600);
      else if (action === 'reject') await decideGithubPrivateAccessRequest(request!.id, 'rejected');
      else await revokeGithubPrivateAccessRequest(request!.id);
      await loadGithubAccess();
    } catch (e: any) {
      setGithubAccessError(e?.message || `Unable to ${action} private GitHub read access.`);
    } finally {
      githubAccessActionRef.current = '';
      setGithubAccessAction('');
    }
  };

  const loadSyncJobs = React.useCallback(async () => {
    const requestToken = ++syncJobsRequestRef.current;
    setSyncJobsLoading(true);
    setSyncJobError('');
    try {
      const result = await listPromptPackageSyncJobs();
      if (requestToken !== syncJobsRequestRef.current) return;
      setSyncJobs(Array.isArray(result.jobs) ? result.jobs : []);
    } catch {
      if (requestToken !== syncJobsRequestRef.current) return;
      setSyncJobs([]);
      setSyncJobError('Unable to load scheduled sync jobs.');
    } finally {
      if (requestToken === syncJobsRequestRef.current) setSyncJobsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPackages();
    void loadSyncSources();
    void loadGithubAccess();
    void loadSyncJobs();
    void getGithubConnectionStatus().then(setGithubConnection).catch((error: unknown) => setGithubConnectionError(error instanceof Error ? error.message : 'Unable to load GitHub connection.'));
    void fetchAgents('ettore').then((agents) => setAgentChoices(Array.isArray(agents) ? agents : []));
  }, [loadGithubAccess, loadPackages, loadSyncJobs, loadSyncSources]);

  React.useEffect(() => {
    if (!githubCliFlow?.active) return undefined;
    const timer = window.setInterval(() => { void getGithubCliDeviceFlowStatus().then((flow) => { setGithubCliFlow(flow); if (flow.connected) void getGithubConnectionStatus().then(setGithubConnection); }).catch((error: unknown) => setGithubConnectionError(error instanceof Error ? error.message : 'Unable to check GitHub CLI connection.')); }, 3000);
    return () => window.clearInterval(timer);
  }, [githubCliFlow?.active]);

  const submitSyncSource = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const repository = syncSourceForm.repository.trim();
    const ref = syncSourceForm.ref.trim();
    if (syncSourceSaveRequestRef.current) return;
    if (!repository || !ref) {
      setSyncSourceError('Repository and ref are required.');
      return;
    }
    const requestToken = ++syncSourceSaveRequestRef.current;
    setSyncSourceSaving(true);
    setSyncSourceError('');
    try {
      await upsertPromptPackageSyncSource({ source: { provider: 'github', repository, ref }, enabled: syncSourceForm.enabled });
      if (requestToken !== syncSourceSaveRequestRef.current) return;
      await loadSyncSources();
    } catch (e: any) {
      if (requestToken === syncSourceSaveRequestRef.current) setSyncSourceError(e?.message || 'Failed to save GitHub sync source.');
    } finally {
      if (requestToken === syncSourceSaveRequestRef.current) {
        syncSourceSaveRequestRef.current = 0;
        setSyncSourceSaving(false);
      }
    }
  };

  const submitManualSync = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (manualSyncRequestRef.current) return;
    let request: PromptPackageManualSyncRequest | null = null;
    try {
      request = parseManualSyncRequest(JSON.parse(manualSyncPayload));
    } catch {
      // The generic validation message below intentionally does not expose payload details.
    }
    if (!request) {
      setManualSyncError('Enter a valid manual sync JSON request using only the allowed fields.');
      return;
    }
    if (!hasMatchingEnabledSyncSource(request, syncSources)) {
      setManualSyncError('Configure an enabled pinned GitHub source that exactly matches this descriptor before submitting a manual sync.');
      return;
    }
    const requestToken = ++manualSyncRequestRef.current;
    setManualSyncSaving(true);
    setManualSyncError('');
    setManualSyncStatus('');
    try {
      const result = await syncPinnedGithubPromptPackageManually(request);
      if (requestToken !== manualSyncRequestRef.current) return;
      const commit = result.checkpoint.lastStagedCommit || result.checkpoint.lastSeenCommit || 'unavailable';
      setManualSyncStatus(`${result.staged.changed ? 'Staged changes' : 'Already staged'} · ${result.checkpoint.sourceKey} · ${commit}`);
      await Promise.all([loadSyncSources(), loadPackages()]);
    } catch {
      if (requestToken === manualSyncRequestRef.current) setManualSyncError('Manual pinned sync could not be submitted.');
    } finally {
      if (requestToken === manualSyncRequestRef.current) {
        manualSyncRequestRef.current = 0;
        setManualSyncSaving(false);
      }
    }
  };

  const submitSyncJob = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (syncJobActionRef.current || !syncJobCanSave || !parsedManualSyncRequest) return;
    const sourceKey = `github:${parsedManualSyncRequest.descriptor.sourcePin.repository}@${parsedManualSyncRequest.descriptor.sourcePin.ref}`;
    const request: UpsertPromptPackageSyncJobRequest = {
      enabled: syncJobForm.enabled,
      intervalSeconds: syncJobInterval,
      descriptor: parsedManualSyncRequest.descriptor,
      package: parsedManualSyncRequest.package,
      version: parsedManualSyncRequest.version,
      documentKey: parsedManualSyncRequest.documentKey,
      artifactMappings: parsedManualSyncRequest.artifactMappings,
      ...(parsedManualSyncRequest.references !== undefined ? { references: parsedManualSyncRequest.references } : {}),
      ...(parsedManualSyncRequest.details !== undefined ? { details: parsedManualSyncRequest.details } : {}),
    };
    syncJobActionRef.current = `save:${sourceKey}`;
    setSyncJobAction(`save:${sourceKey}`);
    setSyncJobError(''); setSyncJobStatus('');
    try {
      await upsertPromptPackageSyncJob(sourceKey, request);
      setSyncJobStatus('Scheduled sync job configuration saved.');
      await loadSyncJobs();
    } catch {
      setSyncJobError('Unable to save scheduled sync job configuration.');
    } finally {
      syncJobActionRef.current = '';
      setSyncJobAction('');
    }
  };

  const deleteSyncJob = async (sourceKey: string) => {
    if (syncJobActionRef.current || !window.confirm(`Delete scheduled sync job configuration "${sourceKey}"?`)) return;
    syncJobActionRef.current = `delete:${sourceKey}`;
    setSyncJobAction(`delete:${sourceKey}`);
    setSyncJobError(''); setSyncJobStatus('');
    try {
      await deletePromptPackageSyncJob(sourceKey);
      setSyncJobStatus('Scheduled sync job configuration removed.');
      await loadSyncJobs();
    } catch {
      setSyncJobError('Unable to remove scheduled sync job configuration.');
    } finally {
      syncJobActionRef.current = '';
      setSyncJobAction('');
    }
  };

  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    invalidateLifecycleAction();
    setFilters(previous => ({ ...previous, [key]: value }));
  };

  const selectPackage = async (packageKey: string) => {
    invalidateLifecycleAction();
    const requestToken = ++detailRequestRef.current;
    selectedKeyRef.current = packageKey;
    setSelectedKey(packageKey); setDetail(null); setDetailLoading(true); setError('');
    try {
      const result = await getPromptPackageDetail<unknown>(packageKey);
      if (requestToken === detailRequestRef.current) setDetail(isRecord(result) ? result : {});
    } catch (e: any) {
      if (requestToken === detailRequestRef.current) setError(e?.message || 'Failed to load prompt package detail.');
    } finally {
      if (requestToken === detailRequestRef.current) setDetailLoading(false);
    }
  };

  const runLifecycleAction = async (action: 'activate' | 'rollback' | 'deactivate', version: UnknownRecord) => {
    const packageKey = selectedKeyRef.current;
    const versionId = text(version.id, '');
    if (!packageKey || !versionId || lifecycleActionRef.current) return;
    const summaries = {
      activate: 'This makes the selected staged version active.',
      rollback: 'This rolls the package back to the selected superseded version.',
      deactivate: 'This deactivates the selected active version.'
    };
    if (!window.confirm(`${action === 'rollback' ? 'Roll back' : action[0].toUpperCase() + action.slice(1)} package "${packageKey}" version "${versionId}"?\n\n${summaries[action]} This action changes the package lifecycle state and cannot be undone from this confirmation.`)) return;

    const actionKey = `${action}:${versionId}`;
    const actionToken = ++lifecycleRequestRef.current;
    const isCurrentAction = () => lifecycleRequestRef.current === actionToken && selectedKeyRef.current === packageKey;
    lifecycleActionRef.current = actionKey;
    setLifecycleAction(actionKey); setError('');
    try {
      if (action === 'activate') await activatePromptPackage(packageKey, { versionId });
      else if (action === 'rollback') await rollbackPromptPackage(packageKey, { targetVersionId: versionId });
      else await deactivatePromptPackage(packageKey, { versionId });
      const refreshedPackages = await loadPackages(isCurrentAction);
      if (!isCurrentAction() || !refreshedPackages?.some(item => text(item.packageKey, '') === packageKey)) return;
      const detailToken = ++detailRequestRef.current;
      setDetailLoading(true);
      try {
        const refreshed = await getPromptPackageDetail<unknown>(packageKey);
        if (isCurrentAction() && detailToken === detailRequestRef.current) setDetail(isRecord(refreshed) ? refreshed : {});
      } finally {
        if (isCurrentAction() && detailToken === detailRequestRef.current) setDetailLoading(false);
      }
    } catch (e: any) {
      if (isCurrentAction()) setError(e?.message || `Failed to ${action} prompt package.`);
    } finally {
      if (isCurrentAction()) {
        lifecycleActionRef.current = '';
        setLifecycleAction('');
      }
    }
  };

  const previewClaudePlugin = async () => {
    if (!claudeImportForm.sourceKey) return;
    setClaudeImportAction('preview'); setClaudeImportError(''); setClaudeImportStatus(''); setClaudeCandidates([]); setSelectedClaudeRoot(null);
    try {
      const result = await discoverClaudePluginsFromSource(claudeImportForm.sourceKey);
      setClaudeCandidates(result.candidates); if (result.candidates.length === 1) setSelectedClaudeRoot(result.candidates[0].pluginRoot);
      setClaudeImportStatus(`Resolved ${result.resolvedCommit}. Select a discovered plugin to stage it.`);
    } catch (cause) { setClaudeImportError(cause instanceof Error ? cause.message : 'Claude plugin discovery failed.'); }
    finally { setClaudeImportAction(''); }
  };
  const importClaudePlugin = async () => {
    const candidate = claudeCandidates.find(item => item.pluginRoot === selectedClaudeRoot);
    if (!candidate || !claudeImportForm.sourceKey || !claudeImportForm.agentId) return;
    setClaudeImportAction('import'); setClaudeImportError(''); setClaudeImportStatus('');
    try {
      const result = await importClaudePluginFromSource(claudeImportForm.sourceKey, { pluginRoot: candidate.pluginRoot, agentId: claudeImportForm.agentId });
      setClaudeImportStatus(`${result.changed ? 'Plugin staged' : 'Matching staged plugin already exists'} at ${result.resolvedCommit}. A sync job and direct skill grant for the selected agent were created; package activation remains explicit.`);
      await Promise.all([loadPackages(), loadSyncJobs(), loadSyncSources()]);
    } catch (cause) { setClaudeImportError(cause instanceof Error ? cause.message : 'Claude plugin import failed.'); }
    finally { setClaudeImportAction(''); }
  };

  const versions = asArray(detail?.versions).filter(isRecord);
  const artifacts = asArray(detail?.artifacts).filter(isRecord);
  const events = asArray(detail?.events).filter(isRecord);

  return <div className="space-y-5 max-w-4xl">
    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-950/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-xs font-black uppercase text-indigo-700 dark:text-indigo-300 tracking-widest">Prompt Packages</h3><p className="text-xs text-indigo-700/80 dark:text-indigo-300/80 mt-1">Read-only catalog of persisted prompt package metadata.</p></div>
        <button type="button" onClick={() => void loadPackages()} disabled={loading} className="text-[10px] px-2 py-1 rounded-md bg-indigo-600 text-white font-bold disabled:opacity-60">{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20 p-4 space-y-3" aria-labelledby="pinned-github-sync-source-heading">
      <div className="flex items-start justify-between gap-3"><div><h3 id="pinned-github-sync-source-heading" className="text-xs font-black uppercase text-slate-600 dark:text-slate-300 tracking-widest">GitHub sync source</h3><p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Each sync resolves the ref to an immutable commit. Configuring a source does not fetch, stage, or activate prompt packages.</p></div><button type="button" onClick={() => void loadSyncSources()} disabled={syncSourcesLoading || syncSourceSaving} className="text-[10px] px-2 py-1 rounded-md border border-slate-300 dark:border-slate-700 font-bold text-slate-600 dark:text-slate-300 disabled:opacity-60">{syncSourcesLoading ? 'Refreshing…' : 'Refresh'}</button></div>
      <form onSubmit={submitSyncSource} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <label className="text-[10px] font-bold text-slate-500">Provider<input value="GitHub" readOnly aria-readonly="true" className="mt-1 w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-500 dark:text-slate-400" /></label>
        <label className="text-[10px] font-bold text-slate-500">Repository<input value={syncSourceForm.repository} onChange={e => setSyncSourceForm(previous => ({ ...previous, repository: e.target.value }))} className="mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs dark:text-slate-200" required /></label>
        <label className="text-[10px] font-bold text-slate-500">Ref<input value={syncSourceForm.ref} onChange={e => setSyncSourceForm(previous => ({ ...previous, ref: e.target.value }))} className="mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs dark:text-slate-200" required /></label>
        <div className="flex items-center gap-3 pb-0.5"><label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={syncSourceForm.enabled} onChange={e => setSyncSourceForm(previous => ({ ...previous, enabled: e.target.checked }))} />Enabled</label><button type="submit" disabled={syncSourceSaving} className="text-[10px] px-2 py-1.5 rounded-md bg-indigo-600 text-white font-bold disabled:opacity-60">{syncSourceSaving ? 'Saving…' : 'Save source'}</button></div>
      </form>
      {syncSourceError ? <div className="text-xs text-red-500" role="alert">{syncSourceError}</div> : null}
      {syncSourcesLoading && syncSources.length === 0 ? <div className="text-xs text-slate-500">Loading GitHub sync sources...</div> : null}
      {!syncSourcesLoading && !syncSourceError && syncSources.length === 0 ? <div className="text-xs text-slate-400">No GitHub sync sources configured.</div> : null}
      {syncSources.length > 0 ? <div className="space-y-1">{syncSources.map(source => <div key={source.sourceKey} className="grid grid-cols-1 md:grid-cols-3 gap-x-3 gap-y-1 rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-[11px] text-slate-600 dark:text-slate-300"><div><b>Key:</b> {source.sourceKey}</div><div><b>Repository:</b> {source.repository}</div><div><b>Ref:</b> {source.sourceRef}</div><div><b>Observed SHA:</b> {source.lastSeenCommit || '—'}</div><div><b>Staged SHA:</b> {source.lastStagedCommit || '—'}</div><div><b>Enabled:</b> {source.enabled ? 'Yes' : 'No'}</div><div><b>Last sync:</b> {date(source.lastSyncAt)}</div></div>)}</div> : null}
    </section>
    <section className="rounded-xl border border-sky-200 dark:border-sky-900/50 bg-sky-50/50 dark:bg-sky-950/10 p-4 space-y-2"><div className="flex items-center justify-between gap-3"><div><h3 className="text-xs font-black uppercase text-sky-700 dark:text-sky-300 tracking-widest">GitHub connection</h3><p className="text-xs text-sky-800/80 dark:text-sky-200/80 mt-1">OAuth is preferred; the server may fall back to an explicitly enabled GitHub CLI or runtime token. Credentials are never shown.</p></div><div className="flex gap-2">{githubConnection?.oauth.connected || githubConnection?.cliConnected ? <button type="button" onClick={() => void disconnectGithubOAuth().then(() => getGithubConnectionStatus()).then(setGithubConnection)} className="text-[10px] px-2 py-1 rounded-md border border-red-300 text-red-600 font-bold">Disconnect</button> : <>{githubConnection?.oauthConfigured ? <button type="button" onClick={() => void startGithubOAuth().then(({ authorizationUrl }) => window.location.assign(authorizationUrl)).catch((error: unknown) => setGithubConnectionError(error instanceof Error ? error.message : 'Unable to start GitHub OAuth.'))} className="text-[10px] px-2 py-1 rounded-md bg-sky-700 text-white font-bold">Connect OAuth</button> : null}<button type="button" onClick={() => void startGithubCliDeviceFlow().then(setGithubCliFlow).catch((error: unknown) => setGithubConnectionError(error instanceof Error ? error.message : 'Unable to start GitHub CLI sign-in.'))} className="text-[10px] px-2 py-1 rounded-md bg-sky-700 text-white font-bold">Connect with GitHub CLI</button></>}</div></div><div className="text-[11px] text-slate-600 dark:text-slate-300">OAuth: {githubConnection?.oauth.connected ? 'connected' : githubConnection?.oauthConfigured ? 'not connected' : 'not configured'} · CLI: {githubConnection?.cliConnected ? 'connected' : 'available'} · Runtime fallback: {githubConnection?.runtimeTokenAvailable ? 'available' : 'unavailable'}</div>{githubCliFlow?.active ? <div className="text-xs text-sky-800 dark:text-sky-200">Open <a className="underline font-bold" href={githubCliFlow.verificationUri || 'https://github.com/login/device'} target="_blank" rel="noreferrer">GitHub device login</a>{githubCliFlow.userCode ? <> and enter code <b>{githubCliFlow.userCode}</b></> : <>; waiting for GitHub to provide the device code…</>}. This page checks the connection automatically.</div> : null}{githubCliFlow?.error ? <div className="text-xs text-red-500" role="alert">{githubCliFlow.error}</div> : null}{githubConnectionError ? <div className="text-xs text-red-500" role="alert">{githubConnectionError}</div> : null}</section>
    <section className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/10 p-4 space-y-3" aria-labelledby="github-private-read-access-heading">
      <div className="flex items-start justify-between gap-3"><div><h3 id="github-private-read-access-heading" className="text-xs font-black uppercase text-emerald-700 dark:text-emerald-300 tracking-widest">Private GitHub read authorization</h3><p className="text-xs text-emerald-800/80 dark:text-emerald-200/80 mt-1">A decision only permits use of an external credential already available at runtime. No token is requested or shown; if that secret is unavailable, access remains closed and sync fails.</p></div><button type="button" onClick={() => void loadGithubAccess()} disabled={githubAccessLoading || !!githubAccessAction} className="text-[10px] px-2 py-1 rounded-md border border-emerald-300 dark:border-emerald-800 font-bold text-emerald-700 dark:text-emerald-300 disabled:opacity-60">{githubAccessLoading ? 'Refreshing…' : 'Refresh'}</button></div>
      {githubAccessError ? <div className="text-xs text-red-500" role="alert">{githubAccessError}</div> : null}
      {syncSources.length === 0 ? <div className="text-xs text-slate-500">Configure a pinned GitHub source before requesting private read access.</div> : <div className="space-y-2">{syncSources.map(source => {
        const request = latestGithubAccessRequest(source);
        const actionKey = (action: string) => `${action}:${request?.id || source.sourceKey}`;
        const status = request?.status || 'not requested';
        return <div key={source.sourceKey} className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 p-3 text-xs space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{source.repository}</b> · {source.sourceRef} · observed {source.lastSeenCommit || '—'} · staged {source.lastStagedCommit || '—'}</div><span className="uppercase font-bold text-[10px] text-emerald-700 dark:text-emerald-300">{status}</span></div><div className="text-[11px] text-slate-500 dark:text-slate-400">Latest request: {request ? date(request.requestedAt) : '—'}{request?.status === 'approved' ? ` · expires ${date(request.expiresAt)}` : ''}</div><div className="flex flex-wrap gap-2">{!request || request.status !== 'pending' ? <button type="button" onClick={() => void runGithubAccessAction('request', source)} disabled={!!githubAccessAction} className="text-[10px] px-2 py-1 rounded-md bg-emerald-700 text-white font-bold disabled:opacity-60">{githubAccessAction === actionKey('request') ? 'Requesting…' : 'Request read access'}</button> : null}{request?.status === 'pending' ? <><button type="button" onClick={() => void runGithubAccessAction('approve', source, request)} disabled={!!githubAccessAction} className="text-[10px] px-2 py-1 rounded-md bg-emerald-700 text-white font-bold disabled:opacity-60">{githubAccessAction === actionKey('approve') ? 'Approving…' : 'Approve (1 hour)'}</button><button type="button" onClick={() => void runGithubAccessAction('reject', source, request)} disabled={!!githubAccessAction} className="text-[10px] px-2 py-1 rounded-md border border-red-300 text-red-600 font-bold disabled:opacity-60">{githubAccessAction === actionKey('reject') ? 'Rejecting…' : 'Reject'}</button></> : null}{request?.status === 'approved' ? <button type="button" onClick={() => void runGithubAccessAction('revoke', source, request)} disabled={!!githubAccessAction} className="text-[10px] px-2 py-1 rounded-md border border-red-300 text-red-600 font-bold disabled:opacity-60">{githubAccessAction === actionKey('revoke') ? 'Revoking…' : 'Revoke'}</button> : null}</div></div>;
      })}</div>}
      <details open={githubAccessAuditOpen} onToggle={event => setGithubAccessAuditOpen(event.currentTarget.open)} className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 p-3"><summary className="cursor-pointer text-[10px] uppercase font-black text-emerald-700 dark:text-emerald-300 tracking-widest">Authorization audit history (no secrets)</summary><div className="mt-2 space-y-1">{githubAccessLoading && githubAccessEvents.length === 0 ? <div className="text-xs text-slate-500">Loading authorization history...</div> : null}{!githubAccessLoading && githubAccessEvents.length === 0 ? <div className="text-xs text-slate-400">No authorization events.</div> : null}{githubAccessEvents.map(event => <div key={event.id} className="text-[11px] text-slate-600 dark:text-slate-300">{date(event.occurredAt)} · {event.event} · {event.source.repository}@{event.source.ref} · actor {event.actor || 'system'}</div>)}</div></details>
    </section>
    <section className="rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/50 dark:bg-violet-950/10 p-4 space-y-3" aria-labelledby="claude-plugin-import-heading">
      <div><h3 id="claude-plugin-import-heading" className="text-xs font-black uppercase text-violet-700 dark:text-violet-300 tracking-widest">Discover Claude plugins</h3><p className="text-xs text-violet-800/80 dark:text-violet-200/80 mt-1">Select an enabled configured source. Discovery resolves its ref and is read-only; staging derives the immutable package metadata and creates its sync job. MCP configuration remains inventory-only and inert.</p></div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2"><label className="text-[10px] font-bold text-slate-500">Configured source<select value={claudeImportForm.sourceKey} onChange={event => setClaudeImportForm(previous => ({ ...previous, sourceKey: event.target.value }))} className="mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs dark:text-slate-200"><option value="">Select source…</option>{syncSources.filter(source => source.enabled).map(source => <option key={source.sourceKey} value={source.sourceKey}>{source.repository}@{source.sourceRef}</option>)}</select></label><label className="text-[10px] font-bold text-slate-500">Target agent<select value={claudeImportForm.agentId} onChange={event => setClaudeImportForm(previous => ({ ...previous, agentId: event.target.value }))} className="mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs dark:text-slate-200"><option value="">Select agent…</option>{agentChoices.map(agent => <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>)}</select></label></div>
      <div className="flex gap-2"><button type="button" onClick={() => void previewClaudePlugin()} disabled={!!claudeImportAction || !claudeImportForm.sourceKey} className="text-[10px] px-2 py-1.5 rounded-md bg-violet-700 text-white font-bold disabled:opacity-60">{claudeImportAction === 'preview' ? 'Discovering…' : 'Discover plugins'}</button><button type="button" onClick={() => void importClaudePlugin()} disabled={!!claudeImportAction || !claudeCandidates.some(item => item.pluginRoot === selectedClaudeRoot) || !claudeImportForm.agentId} className="text-[10px] px-2 py-1.5 rounded-md border border-violet-400 text-violet-800 dark:text-violet-200 font-bold disabled:opacity-60">{claudeImportAction === 'import' ? 'Staging…' : 'Stage selected plugin'}</button></div>
      {claudeImportError ? <div className="text-xs text-red-500" role="alert">{claudeImportError}</div> : null}{claudeImportStatus ? <div className="text-xs text-emerald-700 dark:text-emerald-300" role="status">{claudeImportStatus}</div> : null}
      {claudeCandidates.map(candidate => <label key={candidate.pluginRoot} className="block rounded-lg border border-violet-200 dark:border-violet-900 p-2 text-xs"><input type="radio" name="claude-plugin-candidate" checked={selectedClaudeRoot === candidate.pluginRoot} onChange={() => setSelectedClaudeRoot(candidate.pluginRoot)} className="mr-2" /><b>{candidate.manifest.metadata?.claudePlugin?.name || 'Claude plugin'}</b> · {candidate.manifest.metadata?.claudePlugin?.version || 'unversioned'} · root {candidate.pluginRoot || '.'}<div className="mt-1 text-slate-500">Skills: {candidate.manifest.skills.map(skill => skill.key).join(', ') || 'none'} · MCP server inventory: {candidate.manifest.metadata?.mcpInventory?.serverKeys?.length || 0} (inert; not imported or executable)</div></label>)}
    </section>
    <section className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/10 p-4 space-y-3" aria-labelledby="manual-pinned-sync-heading">
      <div><h3 id="manual-pinned-sync-heading" className="text-xs font-black uppercase text-amber-700 dark:text-amber-300 tracking-widest">Manual pinned sync</h3><p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1">Submit an explicit pinned descriptor only after its matching source is configured. This fetches and stages content; it never activates a package.</p></div>
      <form onSubmit={submitManualSync} className="space-y-2">
        <label className="block text-[10px] font-bold text-slate-500" htmlFor="manual-pinned-sync-payload">Manual sync JSON request
          <textarea id="manual-pinned-sync-payload" value={manualSyncPayload} onChange={event => setManualSyncPayload(event.target.value)} rows={8} spellCheck={false} placeholder={'{\n  "descriptor": { "schemaVersion": 1, "sourcePin": { "provider": "github", "repository": "…", "ref": "…", "commit": "…" }, "manifestPath": "…", "artifactPaths": ["…"] },\n  "package": {}, "version": {}, "documentKey": "…", "artifactMappings": []\n}'} className="mt-1 w-full resize-y font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs dark:text-slate-200" required />
        </label>
        <div className="flex items-center justify-between gap-3"><span className="text-[10px] text-slate-500 dark:text-slate-400">Allowed optional fields: timeoutMs, references, details.</span><button type="submit" disabled={manualSyncSaving || !manualSyncSourceMatches} className="shrink-0 text-[10px] px-2 py-1.5 rounded-md bg-amber-600 text-white font-bold disabled:opacity-60">{manualSyncSaving ? 'Submitting…' : 'Fetch and stage'}</button></div>
      </form>
      {manualSyncError ? <div className="text-xs text-red-500" role="alert">{manualSyncError}</div> : null}
      {manualSyncStatus ? <div className="text-xs text-emerald-700 dark:text-emerald-300" role="status">{manualSyncStatus}</div> : null}
    </section>
    <section className="rounded-xl border border-cyan-200 dark:border-cyan-900/50 bg-cyan-50/50 dark:bg-cyan-950/10 p-4 space-y-3" aria-labelledby="scheduled-sync-job-heading">
      <div className="flex items-start justify-between gap-3"><div><h3 id="scheduled-sync-job-heading" className="text-xs font-black uppercase text-cyan-700 dark:text-cyan-300 tracking-widest">Scheduled sync job (inert)</h3><p className="text-xs text-cyan-800/80 dark:text-cyan-200/80 mt-1">Saving or enabling a job stores configuration only. It does not execute until a future server scheduler is explicitly enabled by an operator. The job uses the descriptor and payload in the manual JSON above.</p></div><button type="button" onClick={() => void loadSyncJobs()} disabled={syncJobsLoading || !!syncJobAction} className="text-[10px] px-2 py-1 rounded-md border border-cyan-300 dark:border-cyan-800 font-bold text-cyan-700 dark:text-cyan-300 disabled:opacity-60">{syncJobsLoading ? 'Refreshing…' : 'Refresh'}</button></div>
      <form onSubmit={submitSyncJob} className="flex flex-wrap items-end gap-3">
        <label className="text-[10px] font-bold text-slate-500">Interval seconds<input type="number" min="60" max="86400" step="1" value={syncJobForm.intervalSeconds} onChange={event => setSyncJobForm(previous => ({ ...previous, intervalSeconds: event.target.value }))} className="mt-1 block w-32 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs dark:text-slate-200" required /></label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={syncJobForm.enabled} onChange={event => setSyncJobForm(previous => ({ ...previous, enabled: event.target.checked }))} />Enabled</label>
        <button type="submit" disabled={!syncJobCanSave} className="text-[10px] px-2 py-1.5 rounded-md bg-cyan-700 text-white font-bold disabled:opacity-60">{syncJobAction.startsWith('save:') ? 'Saving…' : 'Save job'}</button>
      </form>
      <div className="text-[10px] text-slate-500 dark:text-slate-400">Save is available only with valid manual JSON, an exactly matching enabled source, and an interval from 60 to 86400 seconds.</div>
      {syncJobError ? <div className="text-xs text-red-500" role="alert">{syncJobError}</div> : null}
      {syncJobStatus ? <div className="text-xs text-emerald-700 dark:text-emerald-300" role="status">{syncJobStatus}</div> : null}
      {syncJobsLoading && syncJobs.length === 0 ? <div className="text-xs text-slate-500">Loading scheduled sync jobs...</div> : null}
      {!syncJobsLoading && !syncJobError && syncJobs.length === 0 ? <div className="text-xs text-slate-400">No scheduled sync jobs configured.</div> : null}
      {syncJobs.length > 0 ? <div className="space-y-1">{syncJobs.map(job => <div key={job.sourceKey} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-[11px] text-slate-600 dark:text-slate-300"><div className="grid grid-cols-1 md:grid-cols-3 gap-x-3 gap-y-1"><div><b>Source:</b> {job.sourceKey}</div><div><b>Enabled:</b> {job.enabled ? 'Yes' : 'No'}</div><div><b>Interval:</b> {job.intervalSeconds}s</div><div><b>Document:</b> {job.documentKey}</div><div><b>Updated:</b> {date(job.updatedAt)}</div></div><button type="button" onClick={() => void deleteSyncJob(job.sourceKey)} disabled={!!syncJobAction} className="text-[10px] px-2 py-1 rounded-md border border-red-300 text-red-600 font-bold disabled:opacity-60">{syncJobAction === `delete:${job.sourceKey}` ? 'Removing…' : 'Remove'}</button></div>)}</div> : null}
    </section>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {(['status', 'source', 'repository'] as const).map(key => <input key={key} value={filters[key]} onChange={e => handleFilterChange(key, e.target.value)} placeholder={`Filter by ${key}`} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs dark:text-slate-200" />)}
    </div>
    {error ? <div className="text-xs text-red-500">{error}</div> : null}
    {loading ? <div className="text-xs text-slate-500">Loading prompt packages...</div> : null}
    {!loading && !error && packages.length === 0 ? <div className="text-xs text-slate-400">No prompt packages match the selected filters.</div> : null}
    {packages.length > 0 ? <div className="space-y-2">{packages.map((item, index) => {
      const packageKey = text(item.packageKey, '');
      return <button type="button" key={packageKey || index} onClick={() => packageKey && void selectPackage(packageKey)} className={`w-full text-left rounded-xl border p-3 transition-colors ${selectedKey === packageKey ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/20' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-black/20'}`}>
        <div className="flex justify-between gap-3"><span className="text-sm font-bold text-slate-800 dark:text-slate-100">{packageKey || 'Unnamed package'}</span><span className="text-[10px] uppercase font-bold text-slate-500">{text(item.status)}</span></div>
        <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{text(item.source)} · {text(item.repository)} · updated {date(item.updatedAt)}</div>
      </button>;
    })}</div> : null}
    {detailLoading ? <div className="text-xs text-slate-500">Loading package detail...</div> : null}
    {detail ? <div className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50 dark:bg-black/20">
      <div><h4 className="text-xs font-black uppercase text-slate-500 tracking-widest">Package detail</h4><p className="text-xs text-slate-400 mt-1">Origin, persisted versions, artifacts, and audit metadata only.</p></div>
      {isRecord(detail.package) ? <div className="text-xs grid grid-cols-1 md:grid-cols-2 gap-2"><div><b>Origin:</b> {text(detail.package.source)} · {text(detail.package.repository)}</div><div><b>Status:</b> {text(detail.package.status)}</div></div> : null}
      <div className="space-y-2"><h5 className="text-[10px] uppercase font-black text-slate-400">Persisted versions</h5>{versions.length === 0 ? <div className="text-xs text-slate-400">No persisted versions.</div> : versions.map((version, index) => {
        const validationIsRecord = isRecord(version.validation);
        const validation: UnknownRecord = validationIsRecord ? version.validation as UnknownRecord : {};
        const errors = asArray(validation.errors);
        const metadata = manifestMetadata(version.manifest);
        const status = text(version.status, '').toLowerCase();
        const action = status === 'staged' ? 'activate' : status === 'superseded' ? 'rollback' : status === 'active' ? 'deactivate' : null;
        const canActivate = validationIsRecord && validation.valid === true;
        const actionLabel = action === 'activate' ? 'Activate' : action === 'rollback' ? 'Roll back' : 'Deactivate';
        const versionId = text(version.id, '');
        const actionPending = lifecycleAction === `${action}:${versionId}`;
        return <div key={text(version.id, String(index))} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs space-y-2"><div className="flex items-start justify-between gap-3"><div><b>{text(version.version, 'Unversioned')}</b> · {text(version.status)} · {text(version.sourceCommit)} · {text(version.sourceRef)}</div>{action && (action !== 'activate' || canActivate) ? <button type="button" onClick={() => void runLifecycleAction(action, version)} disabled={!!lifecycleAction || !versionId} className="shrink-0 text-[10px] px-2 py-1 rounded-md bg-indigo-600 text-white font-bold disabled:opacity-60">{actionPending ? 'Working…' : actionLabel}</button> : null}</div>{status === 'staged' && !canActivate ? <div className="text-slate-500 dark:text-slate-400">Activation requires a valid persisted validation result.</div> : null}<div>Validation: {validation.valid === true ? 'valid' : validation.valid === false ? 'invalid' : 'not recorded'}{errors.length ? `; errors: ${errors.map(item => text(item)).join('; ')}` : ''}</div>{metadata.length === 0 ? <div className="text-slate-400">Manifest metadata unavailable.</div> : <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-slate-600 dark:text-slate-300">{metadata.map(([field, value]) => <div key={field}><b>{field}:</b> {field === 'createdAt' ? date(value) : value}</div>)}</div>}</div>;
      })}</div>
      <div className="space-y-2"><h5 className="text-[10px] uppercase font-black text-slate-400">Artifacts</h5>{artifacts.length === 0 ? <div className="text-xs text-slate-400">No artifact metadata.</div> : artifacts.map((artifact, index) => <div key={text(artifact.id, String(index))} className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 p-2">{text(artifact.type)} · {text(artifact.artifactKey)} · {text(artifact.sourcePath)} · hash {text(artifact.contentHash)}</div>)}</div>
      <div className="space-y-2"><h5 className="text-[10px] uppercase font-black text-slate-400">Audit events</h5>{events.length === 0 ? <div className="text-xs text-slate-400">No audit events.</div> : events.map((event, index) => <div key={text(event.id, String(index))} className="text-xs rounded-lg border border-slate-200 dark:border-slate-700 p-2">{text(event.event)} · {date(event.createdAt)}</div>)}</div>
    </div> : null}
  </div>;
};

export default PromptPackageCatalog;
