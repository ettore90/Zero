import crypto from 'node:crypto';
import { getDb } from '../db.js';
import { readKeyVaultSecret } from './azureCliService.js';

// Read-only MongoDB access for the SophieX2 Atlas clusters.
//
// The clusters sit behind Azure private endpoints, so this only works while
// the host's corporate VPN is up: the `pl-*` seedlists resolve to 10.x
// addresses that are routed through tun0. The container inherits that path
// through the Docker bridge, so no per-container VPN setup is needed.
//
// The mode table mirrors the sams-copilot plugin's `bin/mongodb-mcp`: one
// row per (region, environment), with the host a literal here and never
// derived from caller input, so no argument can re-point a mode at another
// cluster. Every mode is read-only in Zero regardless of what the
// credential allows, because this service exposes no write operation at
// all — `find`, `aggregate` (with $out/$merge rejected), `count`,
// `distinct`, `indexes` and the two list operations are the whole surface.

const VAULT = 'kv-sams-plugin';
const MAX_LIMIT = 50;
const MAX_TIME_MS = 15000;
const MAX_BYTES = 1024 * 1024;
const IDLE_MS = 5 * 60 * 1000;

const MODES = Object.freeze({
  'na-qa': { secretName: 'sams-plugin-mongodb-qa-uri', host: null, label: 'NA QA config' },
  'na-prod': { secretName: 'sams-plugin-mongodb-prod-uri', host: null, label: 'NA production config' },
  'na-indexer-qa': { secretName: 'sams-plugin-mongodb-qa-uri', host: 'llmindexer-qa-pl-1.ksjpw.mongodb.net', label: 'NA QA LLM indexer' },
  'na-indexer-prod-ksjpw': { secretName: 'sams-plugin-mongodb-prod-uri', host: 'llmindexer-prod-pl-1.ksjpw.mongodb.net', label: 'NA prod indexer (ksjpw)' },
  'na-indexer-prod-wdxzo': { secretName: 'sams-plugin-mongodb-wdxzo-ro-uri', host: 'llmindexer-prod-pl-1.wdxzo.mongodb.net', label: 'NA prod indexer (wdxzo)' },
  'emea-qa': { secretName: 'sams-plugin-mongodb-emea-qa-uri', host: null, label: 'EMEA QA config + indexes' },
  'emea-prod': { secretName: 'sams-plugin-mongodb-emea-prod-uri', host: null, label: 'EMEA production config + indexes' },
  'emea-dev': { secretName: 'sams-plugin-mongodb-emea-prod-uri', host: 'mongo-emea-dev-pl-0.e6do4.mongodb.net', label: 'EMEA shared sandbox' },
  '4agent-ro': { secretName: 'sams-plugin-mongodb-wdxzo-ro-uri', host: null, label: 'PowerAgent / 4Agent' },
});

const OPERATIONS = Object.freeze(['list_databases', 'list_collections', 'find', 'count', 'distinct', 'aggregate', 'indexes']);

// Aggregation stages that write. Rejected before the pipeline is sent, so a
// read-only claim does not depend on the credential alone.
const WRITE_STAGES = Object.freeze(['$out', '$merge']);

export function listMongoModes() { return Object.keys(MODES).map((id) => ({ id, label: MODES[id].label, host: MODES[id].host })); }

function now() { return Math.floor(Date.now() / 1000); }

// Only the host is replaced; scheme, credential, path and query options are
// carried over untouched, including for a URI with no path separator (the
// shape Atlas's connect dialog hands out). Split on the LAST '@' — an
// unencoded one cannot appear in a password.
function applyHostOverride(uri, host) {
  if (!host) return uri;
  const at = uri.lastIndexOf('@');
  if (at === -1) throw new Error('The stored connection string has no credential/host separator.');
  const creds = uri.slice(0, at);
  const after = uri.slice(at + 1);
  const slash = after.indexOf('/');
  if (slash !== -1) return `${creds}@${host}/${after.slice(slash + 1)}`;
  const question = after.indexOf('?');
  if (question !== -1) return `${creds}@${host}/?${after.slice(question + 1)}`;
  return `${creds}@${host}`;
}

export function targetHost(uri) {
  const after = uri.includes('@') ? uri.slice(uri.lastIndexOf('@') + 1) : uri.slice(uri.indexOf('://') + 3);
  return after.split(/[/?]/)[0];
}

const clients = new Map();

async function clientFor(mode) {
  const cached = clients.get(mode);
  if (cached) { cached.lastUsed = Date.now(); return cached; }

  const config = MODES[mode];
  const raw = await readKeyVaultSecret(VAULT, config.secretName);
  if (!/^mongodb(\+srv)?:\/\//.test(raw)) throw new Error(`The value stored in '${config.secretName}' is not a MongoDB connection string.`);
  const uri = applyHostOverride(raw, config.host);
  const host = targetHost(uri);

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000, connectTimeoutMS: 15000, readPreference: 'secondaryPreferred', appName: 'zero-mongodb-read' });
  await client.connect();

  const entry = { client, host, lastUsed: Date.now() };
  entry.timer = setInterval(() => {
    if (Date.now() - entry.lastUsed < IDLE_MS) return;
    clearInterval(entry.timer);
    clients.delete(mode);
    entry.client.close().catch(() => {});
  }, 60000);
  entry.timer.unref?.();
  clients.set(mode, entry);
  return entry;
}

function validate(args) {
  const mode = String(args?.mode || '');
  if (!MODES[mode]) return { error: `Unknown mode '${mode}'. Known modes: ${Object.keys(MODES).join(', ')}.` };
  const operation = String(args?.operation || '');
  if (!OPERATIONS.includes(operation)) return { error: `Unknown operation '${operation}'. Known operations: ${OPERATIONS.join(', ')}.` };

  const needsDatabase = operation !== 'list_databases';
  const database = args?.database === undefined || args?.database === null ? '' : String(args.database);
  if (needsDatabase && !database) return { error: `'database' is required for operation '${operation}'.` };

  const needsCollection = !['list_databases', 'list_collections'].includes(operation);
  const collection = args?.collection === undefined || args?.collection === null ? '' : String(args.collection);
  if (needsCollection && !collection) return { error: `'collection' is required for operation '${operation}'.` };

  const limitRaw = args?.limit === undefined || args?.limit === null ? 20 : Number(args.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > MAX_LIMIT) return { error: `limit must be an integer from 1 to ${MAX_LIMIT}.` };

  for (const key of ['filter', 'projection', 'sort']) {
    const value = args?.[key];
    if (value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))) return { error: `'${key}' must be an object.` };
  }

  if (operation === 'aggregate') {
    if (!Array.isArray(args?.pipeline) || !args.pipeline.length) return { error: "'pipeline' must be a non-empty array for aggregate." };
    for (const stage of args.pipeline) {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return { error: 'Each aggregation stage must be an object.' };
      for (const name of Object.keys(stage)) {
        if (WRITE_STAGES.includes(name)) return { error: `Aggregation stage '${name}' writes data and is not allowed — this connector is read-only.` };
      }
    }
  }

  if (operation === 'distinct' && !args?.field) return { error: "'field' is required for distinct." };

  return { mode, operation, database, collection, limit: limitRaw, filter: args?.filter || {}, projection: args?.projection || undefined, sort: args?.sort || undefined, pipeline: args?.pipeline, field: args?.field ? String(args.field) : undefined };
}

// A single oversized document would otherwise blow the model's context.
// Trim from the end of the result set rather than truncating a document
// mid-way, so every document that is returned is still valid JSON.
function capBytes(documents) {
  const kept = [];
  let bytes = 0;
  for (const document of documents) {
    const size = JSON.stringify(document)?.length ?? 0;
    if (bytes + size > MAX_BYTES) break;
    bytes += size;
    kept.push(document);
  }
  return { documents: kept, bytes, truncated: kept.length < documents.length };
}

async function run(entry, valid) {
  const { client } = entry;
  const options = { maxTimeMS: MAX_TIME_MS };

  if (valid.operation === 'list_databases') {
    const result = await client.db('admin').admin().listDatabases({ nameOnly: false });
    return { databases: result.databases.map((database) => ({ name: database.name, sizeOnDisk: database.sizeOnDisk })) };
  }

  const db = client.db(valid.database);

  if (valid.operation === 'list_collections') {
    const result = await db.listCollections({}, { nameOnly: true }).toArray();
    return { collections: result.map((item) => item.name) };
  }

  const collection = db.collection(valid.collection);

  if (valid.operation === 'count') return { count: await collection.countDocuments(valid.filter, options) };
  if (valid.operation === 'indexes') return { indexes: await collection.indexes() };
  if (valid.operation === 'distinct') {
    const values = await collection.distinct(valid.field, valid.filter, options);
    return { field: valid.field, values: values.slice(0, MAX_LIMIT), truncated: values.length > MAX_LIMIT };
  }

  const cursor = valid.operation === 'aggregate'
    ? collection.aggregate(valid.pipeline, { ...options, allowDiskUse: false })
    : collection.find(valid.filter, { ...options, projection: valid.projection, sort: valid.sort });

  const documents = await cursor.limit(valid.limit).toArray();
  const capped = capBytes(documents);
  return { documents: capped.documents, returned: capped.documents.length, truncated: capped.truncated };
}

// Only network failures get the VPN hint. The Atlas `pl-*` endpoints
// resolve to 10.x addresses that are only routable through the host's
// tunnel, so a timeout there really is the VPN — but a Key Vault refusal
// or a module error is not, and pointing those at the network sends the
// reader to debug the wrong layer (which is exactly what happened once).
function connectHint(error) {
  const name = error?.name || '';
  const message = error?.message || '';
  if (name === 'MongoServerSelectionError' || /ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/.test(message)) {
    return " — the cluster was unreachable. Check that the corporate VPN is up on the host.";
  }
  if (/az |AADSTS|Key Vault|keyvault|Forbidden|SecretNotFound/i.test(message)) {
    return " — the connection string could not be read. Check 'az login --tenant stefaniniinnovation.onmicrosoft.com' in this container.";
  }
  return '';
}

export async function mongoRead(args = {}) {
  const valid = validate(args);
  if (valid.error) return { error: valid.error };

  let entry;
  try {
    entry = await clientFor(valid.mode);
  } catch (error) {
    recordAudit({ actor: args.actor, mode: valid.mode, operation: valid.operation, status: 502, returned: 0 });
    return { error: `Could not connect for mode '${valid.mode}': ${error?.message || error}${connectHint(error)}` };
  }

  try {
    const result = await run(entry, valid);
    recordAudit({ actor: args.actor, mode: valid.mode, operation: valid.operation, status: 200, returned: result.returned ?? 0 });
    return { mode: valid.mode, host: entry.host, ...result };
  } catch (error) {
    recordAudit({ actor: args.actor, mode: valid.mode, operation: valid.operation, status: 500, returned: 0 });
    return { error: `MongoDB ${valid.operation} failed: ${error?.message || error}` };
  }
}

export async function mongoHealth({ mode = 'na-qa', actor } = {}) {
  if (!MODES[mode]) return { ok: false, error: `Unknown mode '${mode}'.` };
  try {
    const entry = await clientFor(mode);
    const ping = await entry.client.db('admin').command({ ping: 1 });
    recordAudit({ actor, mode, operation: 'health', status: 200, returned: 0 });
    return { ok: ping?.ok === 1, mode, host: entry.host };
  } catch (error) {
    recordAudit({ actor, mode, operation: 'health', status: 502, returned: 0 });
    return { ok: false, mode, error: error?.message || 'MongoDB health check failed.' };
  }
}

export function mongoConnectionStatus() {
  const secretNames = [...new Set(Object.values(MODES).map((mode) => mode.secretName))].sort();
  return {
    id: 'mongodb',
    label: 'MongoDB (SophieX2 Atlas)',
    transport: 'internal-driver',
    configured: true,
    connected: clients.size > 0,
    capabilities: ['database-read'],
    authentication: 'Azure Key Vault connection strings',
    vault: VAULT,
    secretNames,
    modes: listMongoModes(),
    note: 'Reaches Atlas private endpoints through the host VPN; read-only operations only.',
  };
}

function recordAudit({ actor, mode, operation, status, returned }) {
  try {
    getDb().prepare('INSERT INTO mongo_read_audits (id,actor,mode,operation,status,returned,occurred_at) VALUES (?,?,?,?,?,?,?)')
      .run(`mongo_read_${crypto.randomUUID().replace(/-/g, '')}`, actor || null, mode, operation, status, returned || 0, now());
  } catch {}
}
