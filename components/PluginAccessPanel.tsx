import React from 'react';
import {
  createPluginAccessRequest,
  decidePluginAccessRequest,
  deleteAgentPluginGrant,
  fetchAgentPluginCatalog,
  fetchAgentPluginGrants,
  fetchPluginAccessEvents,
  fetchPluginAccessRequests,
  upsertAgentPluginGrant,
} from '../services/localApiService';
import type { NonEmptyPluginFeatureSelections, PluginAccessMode, PluginCatalogEntry, PluginFeatureKind, PluginFeatureSelections } from '../types';

type Selections = PluginFeatureSelections;
type Editor = { mode: PluginAccessMode; approved: Selections; excluded: Selections; requested: Selections };

const kinds: PluginFeatureKind[] = ['skills', 'bundles', 'tools'];
const emptySelections = (): Selections => ({ skills: [], bundles: [], tools: [] });
const selectionCount = (value: Selections) => kinds.reduce((count, kind) => count + value[kind].length, 0);
const nonEmpty = (value: Selections): NonEmptyPluginFeatureSelections | null => selectionCount(value) ? value as NonEmptyPluginFeatureSelections : null;
const toggle = (value: Selections, kind: PluginFeatureKind, id: string): Selections => ({
  ...value,
  [kind]: value[kind].includes(id) ? value[kind].filter(item => item !== id) : [...value[kind], id],
});
const formatDate = (value: number | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value < 100000000000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};
const scopeFor = (plugin: PluginCatalogEntry) => ({ packageKey: plugin.package.packageKey, versionId: plugin.version.id });
const featuresFor = (plugin: PluginCatalogEntry): Selections => plugin.access === 'direct'
  ? { skills: plugin.features.skills, bundles: plugin.features.bundles.map(bundle => bundle.key), tools: plugin.features.tools }
  : emptySelections();
// A direct grant may only edit feature IDs already granted by the catalog. The
// requestable inventory uses request IDs, not grant feature IDs; mixing both made
// “select all” submit unsupported additions and triggered a false approval error.
const selectableFor = (plugin: PluginCatalogEntry): Selections => featuresFor(plugin);
const requestableFor = (plugin: PluginCatalogEntry): Selections => plugin.requestableFeatures
  ? { ...plugin.requestableFeatures }
  : emptySelections();
const editorFor = (plugin: PluginCatalogEntry, existing?: { mode: PluginAccessMode; approvedFeatures: Selections; exclusions: Selections }): Editor => ({
  mode: existing?.mode ?? plugin.access,
  approved: existing?.approvedFeatures ?? featuresFor(plugin),
  excluded: existing?.exclusions ?? emptySelections(),
  requested: emptySelections(),
});

export interface PluginAccessPanelProps {
  agentId: string;
  onClose?: () => void;
}

/** Isolated declarative plugin-access surface. It does not execute MCP or alter generic agent tools. */
const PluginAccessPanel: React.FC<PluginAccessPanelProps> = ({ agentId, onClose }) => {
  const [catalog, setCatalog] = React.useState<PluginCatalogEntry[]>([]);
  const [grants, setGrants] = React.useState<Record<string, { mode: PluginAccessMode; approvedFeatures: Selections; exclusions: Selections }>>({});
  const [requests, setRequests] = React.useState<Awaited<ReturnType<typeof fetchPluginAccessRequests>>['requests']>([]);
  const [events, setEvents] = React.useState<Awaited<ReturnType<typeof fetchPluginAccessEvents>>['events']>([]);
  const [editors, setEditors] = React.useState<Record<string, Editor>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [action, setAction] = React.useState('');

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalogResult, grantsResult, requestsResult, eventsResult] = await Promise.all([
        fetchAgentPluginCatalog(agentId), fetchAgentPluginGrants(agentId), fetchPluginAccessRequests({ agentId }), fetchPluginAccessEvents(),
      ]);
      const nextCatalog = Array.isArray(catalogResult.plugins) ? catalogResult.plugins : [];
      const nextGrants = Array.isArray(grantsResult.grants) ? grantsResult.grants : grantsResult.grant ? [grantsResult.grant] : [];
      const grantMap = Object.fromEntries(nextGrants.map(grant => [grant.packageVersionId, grant]));
      setCatalog(nextCatalog);
      setGrants(grantMap);
      setRequests(Array.isArray(requestsResult.requests) ? requestsResult.requests : []);
      setEvents(Array.isArray(eventsResult.events) ? eventsResult.events.filter(event => nextGrants.some(grant => grant.id === event.grantId) || requestsResult.requests.some(request => request.id === event.requestId)) : []);
      setEditors(previous => Object.fromEntries(nextCatalog.map(plugin => [plugin.version.id, previous[plugin.version.id] ?? editorFor(plugin, grantMap[plugin.version.id])])) as Record<string, Editor>);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load plugin access data.');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const updateEditor = (versionId: string, update: (editor: Editor) => Editor) => {
    setEditors(current => current[versionId] ? { ...current, [versionId]: update(current[versionId]) } : current);
  };
  const run = async (key: string, operation: () => Promise<void>) => {
    setAction(key); setError('');
    try { await operation(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Plugin access update failed.'); }
    finally { setAction(''); }
  };
  const save = (plugin: PluginCatalogEntry) => {
    const editor = editors[plugin.version.id];
    if (!editor) return;
    const approved = nonEmpty(editor.approved);
    if (editor.mode === 'direct' && !approved) { setError('Select at least one approved feature before saving direct access.'); return; }
    if (editor.mode === 'request' && !nonEmpty(editor.requested)) { setError('Select at least one requestable feature before submitting a request.'); return; }
    void run(`save-${plugin.version.id}`, async () => {
      const scope = scopeFor(plugin);
      if (editor.mode === 'direct') await upsertAgentPluginGrant(agentId, { scope, mode: 'direct', approvedFeatures: approved!, exclusions: editor.excluded });
      else await upsertAgentPluginGrant(agentId, { scope, mode: editor.mode, exclusions: editor.excluded });
      // Requestable IDs are distinct request capabilities. They are deliberately
      // never submitted as approved grant features.
      if ((editor.mode === 'request' || editor.mode === 'direct') && nonEmpty(editor.requested)) await createPluginAccessRequest({ agentId, scope, selections: nonEmpty(editor.requested)! });
    });
  };

  const checkboxList = (title: string, values: Selections, checked: Selections, onToggle: (kind: PluginFeatureKind, id: string) => void, disabled = false) => {
    if (!selectionCount(values)) return null;
    return <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{title}</p>
      {kinds.map(kind => values[kind].length > 0 && <div key={kind} className="flex flex-wrap gap-x-3 gap-y-1">
        {values[kind].map(id => <label key={`${kind}-${id}`} className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" className="accent-cyan-500" checked={checked[kind].includes(id)} disabled={disabled} onChange={() => onToggle(kind, id)} />{kind}: {id}</label>)}
      </div>)}
    </div>;
  };

  return <section className="flex h-full min-h-0 flex-col rounded-lg border border-slate-700 bg-slate-900 text-slate-100">
    <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
      <div><h2 className="font-semibold">Plugin access</h2><p className="mt-1 text-xs text-slate-400">Declarative grants only. MCP is inert and never executed here; approving a request does not automatically alter a grant.</p></div>
      <div className="flex gap-2"><button type="button" onClick={() => void refresh()} className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800" disabled={loading}>Refresh</button>{onClose && <button type="button" onClick={onClose} className="rounded border border-slate-600 px-2 py-1 text-xs hover:bg-slate-800">Close</button>}</div>
    </header>
    <div className="min-h-0 space-y-5 overflow-y-auto p-4">
      {error && <p role="alert" className="rounded border border-red-800 bg-red-950/50 p-2 text-sm text-red-200">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading plugin access…</p>}
      {!loading && <div className="space-y-3">{catalog.map(plugin => {
        const editor = editors[plugin.version.id]; const grant = grants[plugin.version.id]; const selectable = selectableFor(plugin); const requestable = requestableFor(plugin);
        if (!editor) return null;
        const pendingCount = requests.filter(request => request.packageVersionId === plugin.version.id && request.status === 'pending').length;
        const approvedCount = selectionCount(editor.approved);
        const modeHelp = editor.mode === 'direct'
          ? 'Direct: save the approved baseline. New features still require a request.'
          : editor.mode === 'request'
            ? 'Request: choose features to send for approval; they are not enabled yet.'
            : 'Unavailable: this package cannot be configured or requested.';
        return <article key={plugin.version.id} className="rounded border border-slate-700 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-medium">{plugin.package.packageKey} <span className="text-sm font-normal text-slate-400">v{plugin.version.version}</span></h3><p className="text-xs text-slate-400">Package: {plugin.package.status} · Version: {plugin.version.status} · Catalog access: {plugin.access}{grant ? ` · Grant: ${grant.mode}` : ''}</p><p className="mt-1 text-xs text-cyan-200">Status: {editor.mode} · {approvedCount} approved · {pendingCount} pending request{pendingCount === 1 ? '' : 's'}</p></div>{grant && <button type="button" disabled={!!action} onClick={() => void run(`delete-${plugin.version.id}`, () => deleteAgentPluginGrant(agentId, scopeFor(plugin)))} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950">Revoke</button>}</div>
          <p className="mt-3 text-xs text-slate-300">{modeHelp} MCP bundles and tools are informational only and cannot be executed here.</p>
          <div className="mt-3 space-y-3">
            <div><p className="text-xs font-medium text-slate-200">1. Choose access mode</p><label className="mt-1 inline-block text-xs text-slate-300">Mode <select value={editor.mode} onChange={event => updateEditor(plugin.version.id, value => ({ ...value, mode: event.target.value as PluginAccessMode }))} className="ml-1 rounded border border-slate-600 bg-slate-800 px-2 py-1"><option value="direct">direct</option><option value="request">request</option><option value="unavailable">unavailable</option></select></label></div>
            {editor.mode !== 'unavailable' && <><div><p className="mb-2 text-xs font-medium text-slate-200">2. Choose allowed or requested features</p><div className="grid gap-3 md:grid-cols-2">{editor.mode === 'direct' && checkboxList('Approved direct baseline', selectable, editor.approved, (kind, id) => updateEditor(plugin.version.id, value => ({ ...value, approved: toggle(value.approved, kind, id) })))}{checkboxList(editor.mode === 'request' ? 'Requestable features' : 'Request new features', requestable, editor.requested, (kind, id) => updateEditor(plugin.version.id, value => ({ ...value, requested: toggle(value.requested, kind, id) })))}</div></div><details className="rounded border border-slate-800 p-2"><summary className="cursor-pointer text-xs font-medium text-slate-300">Advanced exclusions</summary><div className="mt-2">{checkboxList('Exclude from this grant', selectable, editor.excluded, (kind, id) => updateEditor(plugin.version.id, value => ({ ...value, excluded: toggle(value.excluded, kind, id) }))) || <p className="text-xs text-slate-500">No features available to exclude.</p>}</div></details><div><p className="mb-1 text-xs font-medium text-slate-200">3. {editor.mode === 'request' ? 'Send request' : 'Save access'}</p><button type="button" disabled={!!action || (editor.mode === 'direct' && !nonEmpty(editor.approved))} onClick={() => save(plugin)} className="rounded bg-cyan-700 px-3 py-1 text-xs font-medium hover:bg-cyan-600 disabled:cursor-not-allowed disabled:opacity-50">{editor.mode === 'request' ? 'Submit request' : 'Save grant'}</button></div></>}
          </div>
          {editor.mode === 'unavailable' && <div className="mt-3 space-y-2"><p className="text-xs text-slate-500">This explicitly denies loading and requests for this package version.</p><button type="button" disabled={!!action} onClick={() => void run(`deny-${plugin.version.id}`, async () => { await upsertAgentPluginGrant(agentId, { scope: scopeFor(plugin), mode: 'unavailable', exclusions: emptySelections() }); })} className="rounded border border-amber-800 px-3 py-1 text-xs font-medium text-amber-200 hover:bg-amber-950 disabled:cursor-not-allowed disabled:opacity-50">Save unavailable access</button></div>}
        </article>;
      })}{!catalog.length && <p className="text-sm text-slate-400">No declarative plugin packages are available.</p>}</div>}
      <section><h3 className="mb-2 font-medium">Requests</h3><div className="space-y-2">{requests.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-700 p-2 text-xs"><span>{request.packageVersionId} · {request.status} · {formatDate(request.createdAt)}</span><span className="flex gap-1">{request.status === 'pending' && <><button type="button" disabled={!!action} onClick={() => void run(`approve-${request.id}`, async () => { await decidePluginAccessRequest(request.id, { status: 'approved' }); })} className="rounded border border-emerald-800 px-2 py-1 text-emerald-300">Approve</button><button type="button" disabled={!!action} onClick={() => void run(`reject-${request.id}`, async () => { await decidePluginAccessRequest(request.id, { status: 'rejected' }); })} className="rounded border border-red-800 px-2 py-1 text-red-300">Reject</button><button type="button" disabled={!!action} onClick={() => void run(`cancel-${request.id}`, async () => { await decidePluginAccessRequest(request.id, { status: 'cancelled' }); })} className="rounded border border-slate-600 px-2 py-1">Cancel</button></>}</span></div>)}{!requests.length && <p className="text-sm text-slate-500">No request history.</p>}</div></section>
      <details className="rounded border border-slate-800 p-3"><summary className="cursor-pointer font-medium">Audit trail</summary><div className="mt-2 space-y-1">{events.map(event => <div key={event.id} className="rounded border border-slate-800 px-2 py-1 text-xs text-slate-400">{formatDate(event.createdAt)} · {event.event} · {event.packageVersionId} · {event.actor || 'system'}</div>)}{!events.length && <p className="text-sm text-slate-500">No audit events.</p>}</div></details>
    </div>
  </section>;
};

export default PluginAccessPanel;
