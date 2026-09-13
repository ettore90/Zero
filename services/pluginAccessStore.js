import { getDb, generateId } from '../db.js';

const OWN = Object.prototype.hasOwnProperty;
const MODES = new Set(['direct', 'request', 'unavailable']);
const REQUEST_STATUSES = new Set(['pending', 'approved', 'rejected', 'cancelled']);
const FEATURE_TYPES = ['skills', 'bundles', 'tools'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_REASON = 500;
const MAX_EVENT = 96;

function fail(message) { throw new Error(`Invalid plugin access record: ${message}`); }
function own(object, key) { return OWN.call(object, key); }
function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${field} must be a plain object`);
  return value;
}
function identifier(value, field) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`${field} must be a safe identifier string`);
  return value;
}
function optionalActor(value, field) {
  if (value === undefined || value === null) return null;
  return identifier(value, field);
}
function timestamp(value, field) {
  if (value === undefined || value === null) return Math.floor(Date.now() / 1000);
  if (!Number.isInteger(value) || value < 0 || value > 253402300799) fail(`${field} must be a valid Unix-seconds integer`);
  return value;
}

/**
 * Normalizes feature selections and exclusions. The only accepted shape is
 * {skills: string[], bundles: string[], tools: string[]}; omitted groups become
 * empty arrays. Keys use safe identifier syntax only, so paths, URLs, credentials,
 * permission objects, and executable configuration cannot be persisted.
 */
export function normalizeFeatureSelections(value, field = 'selections') {
  if (value === undefined || value === null) return { skills: [], bundles: [], tools: [] };
  const input = plainObject(value, field);
  for (const key of Object.keys(input)) if (!FEATURE_TYPES.includes(key)) fail(`${field}.${key} is not supported`);
  const result = {};
  for (const type of FEATURE_TYPES) {
    const values = own(input, type) ? input[type] : [];
    if (!Array.isArray(values)) fail(`${field}.${type} must be an array`);
    const seen = new Set();
    result[type] = values.map((item, index) => {
      const normalized = identifier(item, `${field}.${type}[${index}]`);
      if (seen.has(normalized)) fail(`${field}.${type} contains duplicate feature id ${normalized}`);
      seen.add(normalized);
      return normalized;
    });
  }
  return result;
}

export const normalizeFeatureExclusions = (value) => normalizeFeatureSelections(value, 'exclusions');

function ownerUsername(value) { return identifier(value, 'username'); }
function scope(input) {
  plainObject(input, 'scope');
  const packageKey = identifier(input.packageKey, 'packageKey');
  const hasVersionId = own(input, 'versionId') && input.versionId !== undefined && input.versionId !== null;
  const hasCommit = own(input, 'sourceCommit') && input.sourceCommit !== undefined && input.sourceCommit !== null;
  if (hasVersionId === hasCommit) fail('scope requires exactly one of versionId or sourceCommit');
  return { packageKey, versionId: hasVersionId ? identifier(input.versionId, 'versionId') : null, sourceCommit: hasCommit ? identifier(input.sourceCommit, 'sourceCommit') : null };
}
function resolveVersion(scopeInput) {
  const s = scope(scopeInput);
  const sql = s.versionId
    ? 'SELECT v.id, v.package_id, p.package_key FROM prompt_package_versions v JOIN prompt_packages p ON p.id = v.package_id WHERE p.package_key = ? AND v.id = ?'
    : 'SELECT v.id, v.package_id, p.package_key FROM prompt_package_versions v JOIN prompt_packages p ON p.id = v.package_id WHERE p.package_key = ? AND v.source_commit = ?';
  const row = getDb().prepare(sql).get(s.packageKey, s.versionId || s.sourceCommit);
  if (!row) fail(`unknown package/version scope ${s.packageKey}`);
  return row;
}
function parse(value, field, id) { try { return JSON.parse(value); } catch { throw new Error(`Corrupt plugin access ${field} for ${id}`); } }
function toGrant(row) {
  if (!row) return null;
  return { id: row.id, ownerUsername: row.owner_username, agentId: row.agent_id, packageVersionId: row.package_version_id, mode: row.mode, exclusions: parse(row.exclusions, 'exclusions', row.id), approvedFeatures: normalizeFeatureSelections(parse(row.approved_features, 'approvedFeatures', row.id), 'approvedFeatures'), actor: row.actor, createdAt: row.created_at, updatedAt: row.updated_at };
}
function toRequest(row) {
  if (!row) return null;
  return { id: row.id, ownerUsername: row.owner_username, agentId: row.agent_id, packageVersionId: row.package_version_id, selections: parse(row.selections, 'selections', row.id), reason: row.reason, status: row.status, requesterActor: row.requester_actor, decisionActor: row.decision_actor, decisionAt: row.decision_at, createdAt: row.created_at, updatedAt: row.updated_at };
}
function toEvent(row) {
  if (!row) return null;
  return { id: row.id, ownerUsername: row.owner_username, grantId: row.grant_id, requestId: row.request_id, packageVersionId: row.package_version_id, event: row.event, actor: row.actor, details: parse(row.details, 'details', row.id), createdAt: row.created_at };
}
function normalizedDetails(value) {
  if (value === undefined || value === null) return {};
  const object = plainObject(value, 'details');
  const result = {};
  for (const [key, item] of Object.entries(object)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) fail('details has invalid key');
    if (typeof item === 'string') result[key] = identifier(item, `details.${key}`);
    else if (typeof item === 'boolean' || (Number.isInteger(item) && item >= 0)) result[key] = item;
    else fail(`details.${key} must be a declarative identifier, boolean, or non-negative integer`);
  }
  return result;
}
function append(db, input, versionId, username) {
  const event = identifier(input.event, 'event');
  if (event.length > MAX_EVENT) fail('event is too long');
  const now = timestamp(input.createdAt, 'createdAt');
  const grantId = input.grantId === undefined ? null : input.grantId;
  const requestId = input.requestId === undefined ? null : input.requestId;
  if (grantId !== null) {
    identifier(grantId, 'grantId');
    const grant = db.prepare('SELECT package_version_id FROM plugin_access_grants WHERE id = ? AND owner_username = ?').get(grantId, username);
    if (!grant || grant.package_version_id !== versionId) fail('grantId does not match package version scope');
  }
  if (requestId !== null) {
    identifier(requestId, 'requestId');
    const request = db.prepare('SELECT package_version_id FROM plugin_access_requests WHERE id = ? AND owner_username = ?').get(requestId, username);
    if (!request || request.package_version_id !== versionId) fail('requestId does not match package version scope');
  }
  const id = generateId('plugin_access_event');
  db.prepare('INSERT INTO plugin_access_events (id, owner_username, grant_id, request_id, package_version_id, event, actor, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, username, grantId, requestId, versionId, event, optionalActor(input.actor, 'actor'), JSON.stringify(normalizedDetails(input.details)), now);
  return toEvent(db.prepare('SELECT * FROM plugin_access_events WHERE id = ?').get(id));
}

export function upsertPluginAccessGrant(input) {
  plainObject(input, 'input'); const username = ownerUsername(input.username); const version = resolveVersion(input.scope); const agentId = identifier(input.agentId, 'agentId');
  if (!MODES.has(input.mode)) fail('mode must be direct, request, or unavailable');
  const exclusions = normalizeFeatureExclusions(input.exclusions); const hasApprovedFeatures = own(input, 'approvedFeatures');
  if (input.mode === 'direct' && !hasApprovedFeatures) fail('approvedFeatures must be explicitly supplied for direct mode');
  if (input.mode !== 'direct' && hasApprovedFeatures) fail('approvedFeatures is only supported for direct mode');
  const approvedFeatures = input.mode === 'direct' ? normalizeFeatureSelections(input.approvedFeatures, 'approvedFeatures') : { skills: [], bundles: [], tools: [] };
  if (input.mode === 'direct' && !Object.values(approvedFeatures).some((keys) => keys.length)) fail('approvedFeatures must be nonempty for direct mode');
  const actor = optionalActor(input.actor, 'actor'); const now = timestamp(input.updatedAt, 'updatedAt'); const db = getDb();
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM plugin_access_grants WHERE owner_username = ? AND agent_id = ? AND package_version_id = ?').get(username, agentId, version.id);
    if (input.mode === 'direct') {
      const old = existing ? normalizeFeatureSelections(parse(existing.approved_features, 'approvedFeatures', existing.id), 'approvedFeatures') : { skills: [], bundles: [], tools: [] };
      const additions = FEATURE_TYPES.reduce((r, type) => ({ ...r, [type]: approvedFeatures[type].filter((key) => !old[type].includes(key)) }), {});
      // Establishing direct access (including a transition from request/unavailable)
      // is an explicit operator baseline. Once already direct, every expansion must
      // be backed by an approved request for this owner/agent/exact version.
      if (existing?.mode === 'direct' && Object.values(additions).some((keys) => keys.length)) {
        const rows = db.prepare("SELECT selections FROM plugin_access_requests WHERE owner_username = ? AND agent_id = ? AND package_version_id = ? AND status = 'approved'").all(username, agentId, version.id);
        const allowed = { skills: new Set(), bundles: new Set(), tools: new Set() };
        for (const row of rows) { const selections = normalizeFeatureSelections(parse(row.selections, 'request selections', version.id), 'request selections'); for (const type of FEATURE_TYPES) selections[type].forEach((key) => allowed[type].add(key)); }
        for (const type of FEATURE_TYPES) for (const key of additions[type]) if (!allowed[type].has(key)) fail(`approvedFeatures.${type} addition requires an approved feature request`);
      }
    }
    const id = existing?.id || generateId('plugin_access_grant');
    if (existing) db.prepare('UPDATE plugin_access_grants SET mode=?, exclusions=?, approved_features=?, actor=?, updated_at=? WHERE id=? AND owner_username=?').run(input.mode, JSON.stringify(exclusions), JSON.stringify(approvedFeatures), actor, now, id, username);
    else db.prepare('INSERT INTO plugin_access_grants (id, owner_username, agent_id, package_version_id, mode, exclusions, approved_features, actor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, username, agentId, version.id, input.mode, JSON.stringify(exclusions), JSON.stringify(approvedFeatures), actor, now, now);
    const grant = toGrant(db.prepare('SELECT * FROM plugin_access_grants WHERE id = ? AND owner_username = ?').get(id, username)); append(db, { event: existing ? 'grant_updated' : 'grant_created', actor, grantId: id, details: { mode: input.mode } }, version.id, username); return grant;
  })();
}
export function getPluginAccessGrant(input) { plainObject(input, 'input'); const username = ownerUsername(input.username); const version = resolveVersion(input.scope); return toGrant(getDb().prepare('SELECT * FROM plugin_access_grants WHERE owner_username=? AND agent_id=? AND package_version_id=?').get(username, identifier(input.agentId, 'agentId'), version.id)); }
export function listPluginAccessGrants(input = {}) { plainObject(input, 'input'); const username = ownerUsername(input.username); const db = getDb(); const clauses=['owner_username=?']; const args=[username]; if (input.scope) { clauses.push('package_version_id=?'); args.push(resolveVersion(input.scope).id); } if (input.agentId !== undefined) { clauses.push('agent_id=?'); args.push(identifier(input.agentId, 'agentId')); } return db.prepare(`SELECT * FROM plugin_access_grants WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`).all(...args).map(toGrant); }
export function deletePluginAccessGrant(input) { plainObject(input, 'input'); const username=ownerUsername(input.username); const version=resolveVersion(input.scope); const agentId=identifier(input.agentId,'agentId'); const db=getDb(); return db.transaction(() => { const row=db.prepare('SELECT * FROM plugin_access_grants WHERE owner_username=? AND agent_id=? AND package_version_id=?').get(username,agentId,version.id); if(!row)return false; db.prepare('DELETE FROM plugin_access_grants WHERE id=? AND owner_username=?').run(row.id,username); append(db,{event:'grant_deleted',actor:input.actor,details:{}},version.id,username); return true; })(); }
export function createPluginAccessRequest(input) { plainObject(input,'input'); const username=ownerUsername(input.username); const version=resolveVersion(input.scope); const agentId=identifier(input.agentId,'agentId'); const selections=normalizeFeatureSelections(input.selections); const reason=input.reason==null?null:input.reason; if(reason!==null&&(typeof reason!=='string'||!reason.trim()||reason.length>MAX_REASON))fail('reason must be a bounded non-empty string or null'); const actor=optionalActor(input.requesterActor,'requesterActor'); const now=timestamp(input.createdAt,'createdAt'); const db=getDb(); return db.transaction(()=>{const id=generateId('plugin_access_request');db.prepare('INSERT INTO plugin_access_requests (id,owner_username,agent_id,package_version_id,selections,reason,status,requester_actor,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,username,agentId,version.id,JSON.stringify(selections),reason,'pending',actor,now,now);append(db,{event:'request_created',actor,requestId:id,details:{}},version.id,username);return toRequest(db.prepare('SELECT * FROM plugin_access_requests WHERE id=? AND owner_username=?').get(id,username));})(); }
export function getPluginAccessRequest(input) { plainObject(input,'input'); return toRequest(getDb().prepare('SELECT * FROM plugin_access_requests WHERE id=? AND owner_username=?').get(identifier(input.requestId,'requestId'),ownerUsername(input.username))); }
export function listPluginAccessRequests(input = {}) { plainObject(input,'input');const username=ownerUsername(input.username);const clauses=['owner_username=?'];const args=[username];if(input.scope){clauses.push('package_version_id=?');args.push(resolveVersion(input.scope).id)}if(input.agentId!==undefined){clauses.push('agent_id=?');args.push(identifier(input.agentId,'agentId'))}if(input.status!==undefined){if(!REQUEST_STATUSES.has(input.status))fail('invalid request status');clauses.push('status=?');args.push(input.status)}return getDb().prepare(`SELECT * FROM plugin_access_requests WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC,id DESC`).all(...args).map(toRequest); }
export function decidePluginAccessRequest(input) { plainObject(input,'input');const username=ownerUsername(input.username);const id=identifier(input.requestId,'requestId');if(!['approved','rejected','cancelled'].includes(input.status))fail('decision status must be approved, rejected, or cancelled');const actor=optionalActor(input.decisionActor,'decisionActor');const at=timestamp(input.decisionAt,'decisionAt');const db=getDb();return db.transaction(()=>{const row=db.prepare('SELECT * FROM plugin_access_requests WHERE id=? AND owner_username=?').get(id,username);if(!row)fail(`unknown request ${id}`);if(row.status!=='pending')fail('only pending requests can be decided');db.prepare('UPDATE plugin_access_requests SET status=?,decision_actor=?,decision_at=?,updated_at=? WHERE id=? AND owner_username=?').run(input.status,actor,at,at,id,username);append(db,{event:`request_${input.status}`,actor,requestId:id,details:{status:input.status}},row.package_version_id,username);return toRequest(db.prepare('SELECT * FROM plugin_access_requests WHERE id=? AND owner_username=?').get(id,username));})(); }
export function appendPluginAccessEvent(input) { plainObject(input,'input');const username=ownerUsername(input.username);const version=resolveVersion(input.scope);return getDb().transaction(()=>append(getDb(),input,version.id,username))(); }
export function listPluginAccessEvents(input = {}) { plainObject(input,'input');const username=ownerUsername(input.username);const db=getDb();if(input.requestId!==undefined)return db.prepare('SELECT * FROM plugin_access_events WHERE owner_username=? AND request_id=? ORDER BY created_at ASC,id ASC').all(username,identifier(input.requestId,'requestId')).map(toEvent);if(input.grantId!==undefined)return db.prepare('SELECT * FROM plugin_access_events WHERE owner_username=? AND grant_id=? ORDER BY created_at ASC,id ASC').all(username,identifier(input.grantId,'grantId')).map(toEvent);if(input.scope)return db.prepare('SELECT * FROM plugin_access_events WHERE owner_username=? AND package_version_id=? ORDER BY created_at ASC,id ASC').all(username,resolveVersion(input.scope).id).map(toEvent);return db.prepare('SELECT * FROM plugin_access_events WHERE owner_username=? ORDER BY created_at ASC,id ASC').all(username).map(toEvent); }
