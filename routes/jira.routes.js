// =============================================================================
// jira.routes.js — Jira integration endpoints for workflow automation
// =============================================================================
// GET  /api/jira/queue   — fetch tickets via JQL and return structured issue data
// POST /api/jira/queue/stop — interrupt an in-flight queue collection
// POST /api/jira/action  — execute Jira write operations (comment, update, transition, label)
//
// Usage notes:
// - Preferred auth pattern for workflows: send header `x-jira-token: {{JIRA_KEY}}`
//   and let the platform resolve the secret at request time.
// - The route also accepts `x-jira-token` with a raw Basic token or `JIRA_TOKEN` from env.
// - If the header value does not start with `Basic `, the route prefixes it automatically.
// - Persistence behavior uses SQLite snapshot reuse for all queue modes.
// - If comment mode is requested and Jira total is greater than 200, comment
//   collection is blocked intentionally.
// =============================================================================

import { Router } from 'express';
import https from 'https';
import { getDb } from '../db.js';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import {
  getJiraToken,
  describeMissingCredential,
  buildAuthorizationHeader,
  normalizeJiraPath,
  forwardToJira,
} from '../services/jiraProxyService.js';

const router = Router();
const JIRA_HOSTNAME = 'stefaninisophiedelivery.atlassian.net';
const COMMENT_LIMIT_THRESHOLD = 200;
const PAGE_SIZE = 200;
const LARGE_QUEUE_LOG_THRESHOLD = 100;
const LONG_COLLECTION_WARN_MS = 15000;

const queueControl = {
  shouldStop: false,
  activeRunId: null,
  activeStartedAt: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureQueueSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jira_queue_snapshot (
      snapshot_key TEXT PRIMARY KEY,
      mode TEXT NOT NULL,
      jql TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      returned INTEGER NOT NULL DEFAULT 0,
      is_last INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS jira_queue_items (
      snapshot_key TEXT NOT NULL,
      issue_key TEXT NOT NULL,
      issue_id TEXT,
      issue_updated TEXT,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (snapshot_key, issue_key)
    );
    CREATE INDEX IF NOT EXISTS idx_jira_queue_items_snapshot ON jira_queue_items(snapshot_key);
    CREATE INDEX IF NOT EXISTS idx_jira_queue_items_issue_updated ON jira_queue_items(issue_updated);
  `);
}

// getJiraToken and buildAuthorizationHeader now live in
// services/jiraProxyService.js so the passthrough route and these endpoints
// resolve the credential identically.

function jiraRequest({ method, path, body, token }) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: JIRA_HOSTNAME,
      port: 443,
      path,
      method,
      headers: {
        Authorization: buildAuthorizationHeader(token),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode;
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        if (status >= 200 && status < 300) {
          resolve({ status, data: parsed });
        } else {
          reject({ status, data: parsed });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function extractText(adfNode) {
  if (!adfNode || !adfNode.content) return '';
  const texts = [];
  function walk(node) {
    if (node.type === 'text') texts.push(node.text || '');
    if (node.content) node.content.forEach(walk);
  }
  adfNode.content.forEach(walk);
  return texts.join(' ').trim();
}

function mapComment(comment) {
  return {
    id: comment?.id || null,
    created: comment?.created || null,
    updated: comment?.updated || null,
    author: {
      accountId: comment?.author?.accountId || null,
      displayName: comment?.author?.displayName || null,
      emailAddress: comment?.author?.emailAddress || null,
      active: comment?.author?.active ?? null,
    },
    updateAuthor: {
      accountId: comment?.updateAuthor?.accountId || null,
      displayName: comment?.updateAuthor?.displayName || null,
      emailAddress: comment?.updateAuthor?.emailAddress || null,
      active: comment?.updateAuthor?.active ?? null,
    },
    body: extractText(comment?.body),
    bodyRaw: comment?.body || null,
    jsdPublic: comment?.jsdPublic ?? null,
  };
}

const BASE_NORMALIZED_FIELD_KEYS = new Set([
  'id',
  'key',
  'summary',
  'status',
  'statusCategory',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'created',
  'updated',
  'labels',
  'components',
  'storyPoints',
  'sprint',
  'description',
  'descriptionRaw',
  'implementationPlan',
  'implementationPlanRaw',
  'acceptanceCriteria',
  'acceptanceCriteriaRaw',
  'assetTag',
  'team',
  'comments',
  'commentCount',
]);

const NORMALIZED_SOURCE_FIELD_KEYS = new Set([
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'created',
  'updated',
  'labels',
  'components',
  'customfield_10026',
  'customfield_10020',
  'description',
  'customfield_10088',
  'customfield_10123',
  'customfield_10822',
  'customfield_10826',
  'comment',
]);

function normalizeFieldAliases(fieldAliases) {
  if (!fieldAliases || typeof fieldAliases !== 'object' || Array.isArray(fieldAliases)) return {};
  return Object.entries(fieldAliases).reduce((acc, [key, value]) => {
    if (typeof key !== 'string' || !key.trim()) return acc;
    if (typeof value !== 'string' || !value.trim()) return acc;
    acc[key.trim()] = value.trim();
    return acc;
  }, {});
}

function buildExtraFields(issueFields, requestedFields, fieldAliases = {}) {
  if (!issueFields || !Array.isArray(requestedFields) || requestedFields.length === 0) return undefined;

  const extraFields = {};
  for (const fieldName of requestedFields) {
    if (!fieldName || fieldName === 'comment' || NORMALIZED_SOURCE_FIELD_KEYS.has(fieldName)) continue;
    if (!Object.prototype.hasOwnProperty.call(issueFields, fieldName)) continue;
    const alias = fieldAliases[fieldName];
    const outputKey = typeof alias === 'string' && alias.trim() ? alias.trim() : fieldName;
    if (!outputKey || BASE_NORMALIZED_FIELD_KEYS.has(outputKey)) continue;
    extraFields[outputKey] = issueFields[fieldName];
  }

  return Object.keys(extraFields).length > 0 ? extraFields : undefined;
}

function mapIssue(issue, comments = null, options = {}) {
  const f = issue.fields || {};
  const inlineComments = Array.isArray(f.comment?.comments)
    ? f.comment.comments.map(mapComment)
    : null;
  const requestedFields = Array.isArray(options.requestedFields) ? options.requestedFields : [];
  const preserveRequestedFields = options.preserveRequestedFields === true;
  const fieldAliases = normalizeFieldAliases(options.fieldAliases);

  const mappedIssue = {
    id: issue.id,
    key: issue.key,
    summary: f.summary || '',
    status: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.name || '',
    issuetype: f.issuetype?.name || '',
    priority: f.priority?.name || '',
    assignee: f.assignee?.displayName || null,
    assigneeAccountId: f.assignee?.accountId || null,
    reporter: f.reporter?.displayName || null,
    reporterAccountId: f.reporter?.accountId || null,
    created: f.created || null,
    updated: f.updated || null,
    labels: f.labels || [],
    components: (f.components || []).map((c) => c.name),
    storyPoints: f.customfield_10026 ?? null,
    sprint: f.customfield_10020?.[0]?.name || null,
    description: extractText(f.description),
    descriptionRaw: f.description || null,
    implementationPlan: extractText(f.customfield_10088),
    implementationPlanRaw: f.customfield_10088 || null,
    acceptanceCriteria: extractText(f.customfield_10123),
    acceptanceCriteriaRaw: f.customfield_10123 || null,
    assetTag: f.customfield_10822 || null,
    team: f.customfield_10826 || null,
    comments: Array.isArray(comments) ? comments : inlineComments,
    commentCount: f.comment?.total ?? (Array.isArray(comments) ? comments.length : inlineComments?.length ?? 0),
  };

  if (preserveRequestedFields) {
    const extraFields = buildExtraFields(f, requestedFields, fieldAliases);
    if (extraFields) {
      mappedIssue.extraFields = extraFields;
    }
  }

  return mappedIssue;
}

function buildCanonicalIssueEnvelope(issue, normalizedIssue, options = {}) {
  const requestedFields = Array.isArray(options.requestedFields) ? options.requestedFields : [];
  const preserveRequestedFields = options.preserveRequestedFields === true;
  const preservedFields = preserveRequestedFields && normalizedIssue?.extraFields && typeof normalizedIssue.extraFields === 'object'
    ? Object.keys(normalizedIssue.extraFields)
    : [];
  const preservationState = preserveRequestedFields
    ? (preservedFields.length > 0 ? 'preserved' : 'requested_no_match')
    : 'not_requested';

  return {
    schemaVersion: 2,
    raw: issue,
    normalized: normalizedIssue,
    requestedFields,
    preservedFields,
    metadata: {
      issueKey: issue?.key || null,
      issueId: issue?.id || null,
      source: 'jira.queue',
      persistedAt: new Date().toISOString(),
      schemaVersion: 2,
      payloadFormat: 'canonical-envelope',
      persistedPayload: 'raw+normalized-derived',
      persistenceModel: 'sqlite_snapshot',
      fullPayloadPersisted: false,
      normalizedRole: 'derived_from_raw_canonical_payload',
      preserveRequestedFields,
      requestedFields,
      preservedFields,
      preservationState,
    },
  };
}

function parseBoolean(value) {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function compactIssue(issue, options = {}) {
  const preserveRequestedFields = options.preserveRequestedFields === true;
  const compact = {
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
    priority: issue.priority,
    issuetype: issue.issuetype,
    storyPoints: issue.storyPoints,
    assignee: issue.assignee,
    comments: issue.comments,
    commentCount: issue.commentCount,
  };

  if (preserveRequestedFields && issue.extraFields && typeof issue.extraFields === 'object') {
    compact.extraFields = issue.extraFields;
  }

  return compact;
}

function assertNotStopped(runId) {
  if (queueControl.shouldStop && queueControl.activeRunId === runId) {
    const err = new Error('Queue collection interrupted by stop request.');
    err.code = 'JIRA_QUEUE_STOPPED';
    throw err;
  }
}

function beginQueueRun() {
  const runId = `jiraq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  queueControl.shouldStop = false;
  queueControl.activeRunId = runId;
  queueControl.activeStartedAt = Date.now();
  return runId;
}

function endQueueRun(runId) {
  if (queueControl.activeRunId === runId) {
    queueControl.activeRunId = null;
    queueControl.activeStartedAt = null;
    queueControl.shouldStop = false;
  }
}

function normalizeFields(fields) {
  return fields ? fields.split(',').map((f) => f.trim()).filter(Boolean) : DEFAULT_FIELDS;
}

async function fetchSearchPage({ token, jql, startAt, fields, maxResults }) {
  const params = new URLSearchParams();
  params.set('jql', jql);
  if (typeof startAt === 'number') params.set('startAt', String(startAt));
  if (typeof maxResults === 'number') params.set('maxResults', String(maxResults));
  if (Array.isArray(fields) && fields.length) params.set('fields', fields.join(','));
  return jiraRequest({
    method: 'GET',
    path: `/rest/api/3/search/jql?${params.toString()}`,
    token,
  });
}

async function fetchAllIssues({ token, jql, fields, runId }) {
  const collected = [];
  let startAt = 0;
  let total = null;
  let pages = 0;
  let isLast = true;

  while (true) {
    assertNotStopped(runId);
    const { data } = await fetchSearchPage({
      token,
      jql,
      startAt,
      fields,
      maxResults: PAGE_SIZE,
    });

    const pageIssues = data.issues || [];
    total = data.total ?? total ?? pageIssues.length;
    isLast = data.isLast ?? (startAt + pageIssues.length >= total);
    pages += 1;
    collected.push(...pageIssues);

    console.log(`[jira/queue] search page ${pages} collected=${collected.length}/${total ?? '?'} startAt=${startAt} pageSize=${pageIssues.length}`);

    if ((total ?? 0) >= LARGE_QUEUE_LOG_THRESHOLD) {
      console.log(`[jira/queue] monitor large queue detected total=${total} pages=${pages} runId=${runId}`);
    }

    if (pageIssues.length === 0 || isLast || collected.length >= total) break;
    startAt += pageIssues.length;
  }

  return {
    total: total ?? collected.length,
    issues: collected,
    isLast,
    pages,
  };
}

async function fetchIssueComments({ token, issueKey, runId, index, totalIssues }) {
  assertNotStopped(runId);
  console.log(`[jira/queue] comment fetch start ${index}/${totalIssues} issue=${issueKey}`);
  const { data } = await jiraRequest({
    method: 'GET',
    path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?maxResults=5000`,
    token,
  });
  const comments = Array.isArray(data.comments) ? data.comments.map(mapComment) : [];
  console.log(`[jira/queue] comment fetch done ${index}/${totalIssues} issue=${issueKey} comments=${comments.length}`);
  return comments;
}

function isCanonicalIssueEnvelope(payload) {
  return Boolean(
    payload &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Object.prototype.hasOwnProperty.call(payload, 'raw') &&
    Object.prototype.hasOwnProperty.call(payload, 'normalized') &&
    payload.raw && typeof payload.raw === 'object' && !Array.isArray(payload.raw) &&
    payload.normalized && typeof payload.normalized === 'object' && !Array.isArray(payload.normalized)
  );
}

function saveSqliteSnapshot({ db, snapshotKey, jql, total, returned, isLast, issues, metadata }) {
  ensureQueueSchema(db);
  const now = Math.floor(Date.now() / 1000);
  const persistedIssues = Array.isArray(issues) ? issues : [];
  const aggregatedPreservedFields = [...new Set(persistedIssues.flatMap((issue) => Array.isArray(issue?.preservedFields) ? issue.preservedFields : []))];
  const aggregatedPreservationState = aggregatedPreservedFields.length > 0
    ? 'preserved_at_least_one_issue'
    : (persistedIssues.some((issue) => issue?.metadata?.preservationState === 'requested_no_match') ? 'requested_no_match' : 'not_requested');
  const snapshotMetadata = {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    preservedFields: aggregatedPreservedFields,
    preservationState: aggregatedPreservedFields.length > 0 || aggregatedPreservationState === 'requested_no_match'
      ? aggregatedPreservationState
      : 'not_requested',
    preservationScope: 'snapshot_aggregate_across_issues',
  };
  const upsertSnapshot = db.prepare(`
    INSERT INTO jira_queue_snapshot (snapshot_key, mode, jql, total, returned, is_last, updated_at, metadata)
    VALUES (?, 'search', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_key) DO UPDATE SET
      mode = excluded.mode,
      jql = excluded.jql,
      total = excluded.total,
      returned = excluded.returned,
      is_last = excluded.is_last,
      updated_at = excluded.updated_at,
      metadata = excluded.metadata
  `);
  const upsertItem = db.prepare(`
    INSERT INTO jira_queue_items (snapshot_key, issue_key, issue_id, issue_updated, payload_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(snapshot_key, issue_key) DO UPDATE SET
      issue_id = excluded.issue_id,
      issue_updated = excluded.issue_updated,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const resolvedIssueKeys = persistedIssues.map((issue) => {
    const envelopeKey = isCanonicalIssueEnvelope(issue) ? issue?.normalized?.key || issue?.raw?.key : null;
    const legacyKey = issue?.key || issue?.raw?.key || issue?.normalized?.key || null;
    return envelopeKey || legacyKey || '';
  }).filter(Boolean);
  const validIssueKeys = [...new Set(resolvedIssueKeys)];
  const deleteMissing = db.prepare(`
    DELETE FROM jira_queue_items
    WHERE snapshot_key = ? AND issue_key NOT IN (${validIssueKeys.map(() => '?').join(',') || "''"})
  `);

  const tx = db.transaction(() => {
    upsertSnapshot.run(snapshotKey, jql, total, returned, isLast ? 1 : 0, now, JSON.stringify(snapshotMetadata));
    for (const issue of persistedIssues) {
      const resolvedIssueKey = (() => {
        const canonicalKey = isCanonicalIssueEnvelope(issue)
          ? issue?.normalized?.key || issue?.raw?.key || null
          : null;
        return canonicalKey || issue?.key || issue?.raw?.key || issue?.normalized?.key || null;
      })();
      if (!resolvedIssueKey) continue;
      const payload = isCanonicalIssueEnvelope(issue)
        ? issue
        : buildCanonicalIssueEnvelope(issue, mapIssue(issue, null, {}), {});
      const issueId = issue?.normalized?.id || issue?.raw?.id || issue?.id || payload?.normalized?.id || payload?.raw?.id || payload?.id || null;
      const issueUpdated = issue?.normalized?.updated || issue?.raw?.updated || issue?.updated || payload?.normalized?.updated || payload?.raw?.updated || payload?.updated || null;
      upsertItem.run(snapshotKey, resolvedIssueKey, issueId, issueUpdated, JSON.stringify(payload), now);
    }
    if (validIssueKeys.length > 0) {
      deleteMissing.run(snapshotKey, ...validIssueKeys);
    }
  });

  tx();
}

export function persistJiraQueueSnapshot(db, { snapshotKey = 'default', jql, total, returned, isLast, issues, metadata }) {
  saveSqliteSnapshot({ db, snapshotKey, jql, total, returned, isLast, issues, metadata });
}

const DEFAULT_FIELDS = [
  'summary', 'status', 'issuetype', 'priority', 'assignee', 'reporter',
  'description', 'labels', 'components', 'created', 'updated',
  'customfield_10026',
  'customfield_10020',
  'customfield_10088',
  'customfield_10123',
  'customfield_10822',
  'customfield_10826',
];


function parseJsonObjectParam(rawValue, label) {
  if (typeof rawValue === 'undefined') return null;
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) return rawValue;
  if (typeof rawValue !== 'string' || !rawValue.trim()) return null;
  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed;
  } catch (_) {
    const error = new Error(`Invalid ${label}. Expected JSON object.`);
    error.status = 400;
    throw error;
  }
}

function parseBooleanOrObjectParam(rawValue, label) {
  if (typeof rawValue === 'undefined') return { enabled: false, options: null };
  if (rawValue === true || rawValue === false) {
    return { enabled: rawValue, options: null };
  }
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return { enabled: true, options: rawValue };
  }
  if (typeof rawValue !== 'string') {
    const error = new Error(`Invalid ${label}. Expected boolean, JSON object, or JSON string.`);
    error.status = 400;
    throw error;
  }

  const trimmed = rawValue.trim();
  if (!trimmed) return { enabled: false, options: null };
  if (trimmed === 'true' || trimmed === '1') return { enabled: true, options: null };
  if (trimmed === 'false' || trimmed === '0') return { enabled: false, options: null };

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    const error = new Error(`Invalid ${label}. Expected boolean or JSON object.`);
    error.status = 400;
    throw error;
  }

  if (typeof parsed === 'boolean') {
    return { enabled: parsed, options: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error(`Invalid ${label}. Expected boolean or JSON object.`);
    error.status = 400;
    throw error;
  }
  return { enabled: true, options: parsed };
}

function hasExportRawConflictWithAnalytics(exportRawRequested, hasAnalytics) {
  return exportRawRequested && hasAnalytics;
}

function normalizeSnapshotKey(snapshotKey, includeComments) {
  const normalized = typeof snapshotKey === 'string' && snapshotKey.trim() ? snapshotKey.trim() : '';
  if (normalized) return normalized;
  return includeComments ? 'comments' : 'default';
}

function parsePersistedIssuePayload(payload) {
  const invalid = { kind: 'invalid', payload: null, issue: null, canonical: null, raw: null, invalidPayload: true, invalidCount: 1 };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid;

  if (isCanonicalIssueEnvelope(payload)) {
    const raw = payload.raw;
    const canonicalIssue = payload.normalized;
    const canonical = {
      schemaVersion: Number.isFinite(Number(payload.schemaVersion)) ? Number(payload.schemaVersion) : 2,
      raw,
      normalized: canonicalIssue,
      requestedFields: Array.isArray(payload.requestedFields) ? payload.requestedFields : [],
      preservedFields: Array.isArray(payload.preservedFields) ? payload.preservedFields : [],
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
    };
    return { kind: 'canonical', payload, issue: canonicalIssue, canonical, raw, invalidPayload: false, invalidCount: 0 };
  }

  const hasCanonicalShape = Object.prototype.hasOwnProperty.call(payload, 'raw') || Object.prototype.hasOwnProperty.call(payload, 'normalized');
  if (hasCanonicalShape) return invalid;

  const legacyFields = payload.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields) ? payload.fields : null;
  const source = legacyFields || payload;
  const looksFlat = typeof payload.key === 'string' || typeof payload.id === 'string' || typeof payload.summary === 'string' || legacyFields || payload.comments;
  if (looksFlat) {
    const issueKey = payload.key || payload.issueKey || payload.keyName || source.key || null;
    const statusSource = source.status && typeof source.status === 'object' ? source.status : null;
    const statusCategorySource = statusSource?.statusCategory || source.statusCategory || null;
    const issuetypeSource = source.issuetype && typeof source.issuetype === 'object' ? source.issuetype : null;
    const prioritySource = source.priority && typeof source.priority === 'object' ? source.priority : null;
    const assigneeSource = source.assignee && typeof source.assignee === 'object' ? source.assignee : null;
    const reporterSource = source.reporter && typeof source.reporter === 'object' ? source.reporter : null;
    const normalized = {
      id: payload.id || source.id || null,
      key: issueKey,
      summary: payload.summary || source.summary || '',
      status: statusSource?.name || source.status || '',
      statusCategory: statusCategorySource?.name || statusCategorySource || '',
      issuetype: issuetypeSource?.name || source.issuetype || source.issueType || '',
      priority: prioritySource?.name || source.priority || '',
      assignee: assigneeSource?.displayName || source.assignee || null,
      assigneeAccountId: assigneeSource?.accountId || source.assigneeAccountId || null,
      reporter: reporterSource?.displayName || source.reporter || null,
      reporterAccountId: reporterSource?.accountId || source.reporterAccountId || null,
      created: payload.created || source.created || null,
      updated: payload.updated || source.updated || null,
      labels: Array.isArray(source.labels) ? source.labels : (Array.isArray(payload.labels) ? payload.labels : []),
      components: Array.isArray(source.components) ? source.components.map((c) => c?.name || c).filter(Boolean) : (Array.isArray(payload.components) ? payload.components : []),
      storyPoints: source.customfield_10026 ?? payload.storyPoints ?? null,
      sprint: source.customfield_10020?.[0]?.name || payload.sprint || null,
      description: extractText(source.description || payload.description),
      descriptionRaw: source.description || payload.descriptionRaw || payload.description || null,
      implementationPlan: extractText(source.customfield_10088 || payload.implementationPlan),
      implementationPlanRaw: source.customfield_10088 || payload.implementationPlanRaw || payload.implementationPlan || null,
      acceptanceCriteria: extractText(source.customfield_10123 || payload.acceptanceCriteria),
      acceptanceCriteriaRaw: source.customfield_10123 || payload.acceptanceCriteriaRaw || payload.acceptanceCriteria || null,
      assetTag: source.customfield_10822 || payload.assetTag || null,
      team: source.customfield_10826 || payload.team || null,
      comments: Array.isArray(source.comment?.comments) ? source.comment.comments.map(mapComment) : (Array.isArray(payload.comments) ? payload.comments : []),
      commentCount: Number.isFinite(Number(source.comment?.total ?? payload.commentCount)) ? Number(source.comment?.total ?? payload.commentCount) : (Array.isArray(source.comment?.comments) ? source.comment.comments.length : (Array.isArray(payload.comments) ? payload.comments.length : 0)),
    };
    return {
      kind: legacyFields ? 'legacy-fields' : 'flat',
      payload,
      issue: normalized,
      canonical: {
        schemaVersion: 2,
        raw: payload.raw && typeof payload.raw === 'object' ? payload.raw : payload,
        normalized,
        requestedFields: [],
        preservedFields: [],
        metadata: { source: legacyFields ? 'legacy_fields_payload' : 'legacy_flat_payload', payloadFormat: legacyFields ? 'legacy-fields' : 'legacy-flat' },
      },
      raw: payload.raw && typeof payload.raw === 'object' ? payload.raw : payload,
      invalidPayload: false,
      invalidCount: 0,
    };
  }

  return invalid;
}

function readSnapshotRows(db, snapshotKey, options = {}) {
  ensureQueueSchema(db);
  const parsedLimit = Number.parseInt(options.limit, 10);
  const parsedOffset = Number.parseInt(options.offset, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 100;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const rows = db.prepare(`
    SELECT issue_key, issue_id, issue_updated, payload_json, updated_at
    FROM jira_queue_items
    WHERE snapshot_key = ?
    ORDER BY issue_key ASC
    LIMIT ? OFFSET ?
  `).all(snapshotKey, limit, offset);
  let pageInvalidPayloadCount = 0;
  const rowsMapped = rows.map((item) => {
    let parsedPayload = null;
    try { parsedPayload = item.payload_json ? JSON.parse(item.payload_json) : null; } catch (_) { parsedPayload = null; }
    const parsed = parsePersistedIssuePayload(parsedPayload);
    pageInvalidPayloadCount += parsed.kind === 'invalid' ? 1 : 0;
    return {
      issueKey: item.issue_key,
      issueId: item.issue_id,
      issueUpdated: item.issue_updated,
      updatedAt: item.updated_at,
      payload: parsed.payload,
      payloadKind: parsed.kind,
      issue: parsed.issue,
      canonical: parsed.canonical,
      raw: parsed.raw,
      invalidPayload: Boolean(parsed.invalidPayload),
      invalidCount: parsed.invalidCount || 0,
    };
  });
  return {
    limit,
    offset,
    returned: rows.length,
    pageInvalidPayloadCount,
    rows: rowsMapped,
  };
}

function dumpSnapshot(db, snapshotKey, options = {}) {
  ensureQueueSchema(db);
  const snapshot = db.prepare(`SELECT snapshot_key, mode, jql, total, returned, is_last, updated_at, metadata FROM jira_queue_snapshot WHERE snapshot_key = ?`).get(snapshotKey);
  if (!snapshot) return null;
  let metadata = {};
  try { metadata = snapshot.metadata ? JSON.parse(snapshot.metadata) : {}; } catch (_) { metadata = {}; }
  const parsedLimit = Number.parseInt(options.limit, 10);
  const parsedOffset = Number.parseInt(options.offset, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 100;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const page = readSnapshotRows(db, snapshotKey, { limit, offset });
  const snapshotInvalidPayloadCount = Number(metadata.invalidPayloadCount ?? 0);
  return {
    mode: 'dumpSnapshot',
    snapshot: {
      snapshotKey: snapshot.snapshot_key,
      mode: snapshot.mode,
      jql: snapshot.jql,
      total: snapshot.total,
      returned: snapshot.returned,
      isLast: Boolean(snapshot.is_last),
      updatedAt: snapshot.updated_at,
      metadata,
      invalidPayloadCount: snapshotInvalidPayloadCount,
    },
    page: {
      limit: page.limit,
      offset: page.offset,
      returned: page.returned,
      hasMore: (page.offset + page.returned) < (snapshot.returned ?? 0),
      invalidPayloadCount: page.pageInvalidPayloadCount || 0,
    },
    rows: page.rows,
  };
}

function loadSnapshot(db, snapshotKey) {
  const dumped = dumpSnapshot(db, snapshotKey, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
  if (!dumped) return null;
  const issues = dumped.rows
    .map((row) => row.canonical || row.issue || row.payload)
    .filter(Boolean);
  return {
    snapshot: dumped.snapshot,
    issues,
  };
}

function listSnapshots(db, filters = {}) {
  ensureQueueSchema(db);
  const clauses = [];
  const params = [];

  if (typeof filters.search === 'string' && filters.search.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    clauses.push('(snapshot_key LIKE ? OR jql LIKE ?)');
    params.push(pattern, pattern);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const allowedSortBy = new Set(['snapshot_key', 'updated_at', 'returned', 'total', 'mode']);
  const requestedSortBy = typeof filters.sortBy === 'string' ? filters.sortBy.trim() : '';
  const sortBy = allowedSortBy.has(requestedSortBy) ? requestedSortBy : 'updated_at';
  const order = String(filters.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const parsedLimit = Number.parseInt(filters.limit, 10);
  const parsedOffset = Number.parseInt(filters.offset, 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 50;
  const offset = Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const includeStats = filters.includeStats === true;

  const rows = db.prepare(`
    SELECT snapshot_key, mode, jql, total, returned, is_last, updated_at, metadata
    FROM jira_queue_snapshot
    ${where}
    ORDER BY ${sortBy} ${order}, snapshot_key ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const snapshots = rows.map((row) => {
    let metadata = {};
    try { metadata = row.metadata ? JSON.parse(row.metadata) : {}; } catch (_) { metadata = {}; }
    return {
      snapshotKey: row.snapshot_key,
      mode: row.mode,
      jql: row.jql,
      total: row.total,
      returned: row.returned,
      isLast: Boolean(row.is_last),
      updatedAt: row.updated_at,
      metadata,
    };
  });

  const response = {
    mode: 'listSnapshots',
    filters: {
      search: typeof filters.search === 'string' ? filters.search.trim() : '',
      sortBy,
      order: order.toLowerCase(),
      limit,
      offset,
      includeStats,
    },
    snapshots,
  };

  if (includeStats) {
    const statsRow = db.prepare(`
      SELECT COUNT(*) AS totalSnapshots, COALESCE(SUM(returned), 0) AS totalPersistedIssues
      FROM jira_queue_snapshot
      ${where}
    `).get(...params);
    response.stats = {
      totalSnapshots: statsRow?.totalSnapshots ?? 0,
      totalPersistedIssues: statsRow?.totalPersistedIssues ?? 0,
    };
  }

  return response;
}

function deleteSnapshot(db, snapshotKey, options = {}) {
  ensureQueueSchema(db);
  const dryRun = options.dryRun === true;
  const snapshot = db.prepare(`SELECT snapshot_key FROM jira_queue_snapshot WHERE snapshot_key = ?`).get(snapshotKey);
  const itemRow = db.prepare(`SELECT COUNT(*) AS count FROM jira_queue_items WHERE snapshot_key = ?`).get(snapshotKey);
  const itemsCount = itemRow?.count ?? 0;

  if (!snapshot) {
    return {
      mode: 'deleteSnapshot',
      snapshotKey,
      dryRun,
      found: false,
      deletedSnapshots: 0,
      deletedItems: 0,
    };
  }

  if (dryRun) {
    return {
      mode: 'deleteSnapshot',
      snapshotKey,
      dryRun: true,
      found: true,
      wouldDeleteSnapshots: 1,
      wouldDeleteItems: itemsCount,
    };
  }

  const deleteItemsStmt = db.prepare(`DELETE FROM jira_queue_items WHERE snapshot_key = ?`);
  const deleteSnapshotStmt = db.prepare(`DELETE FROM jira_queue_snapshot WHERE snapshot_key = ?`);
  const result = db.transaction(() => {
    const deletedItems = deleteItemsStmt.run(snapshotKey).changes;
    const deletedSnapshots = deleteSnapshotStmt.run(snapshotKey).changes;
    return { deletedItems, deletedSnapshots };
  })();

  return {
    mode: 'deleteSnapshot',
    snapshotKey,
    dryRun: false,
    found: true,
    deletedSnapshots: result.deletedSnapshots,
    deletedItems: result.deletedItems,
  };
}

function getPathValue(source, path, options = {}) {
  if (!path || typeof path !== 'string') return { value: null, resolved: false, path: '', reason: 'invalid_path' };
  const normalizedPath = path.trim().replace(/^root\./, '');
  if (!normalizedPath) return { value: null, resolved: false, path: '', reason: 'invalid_path' };

  const candidates = [source];
  if (source && typeof source === 'object') {
    if (Object.prototype.hasOwnProperty.call(source, 'normalized')) candidates.push(source.normalized);
    if (Object.prototype.hasOwnProperty.call(source, 'raw')) candidates.push(source.raw);
    if (Object.prototype.hasOwnProperty.call(source, 'issue')) candidates.push(source.issue);
    if (Object.prototype.hasOwnProperty.call(source, 'payload')) candidates.push(source.payload);
  }

  const resolve = (target, rawPath) => {
    const segments = rawPath.split('.').filter(Boolean);
    let current = target;
    for (const segment of segments) {
      if (current == null) return { value: null, exists: false, incompatible: false };
      if (Array.isArray(current)) {
        if (/^\d+$/.test(segment)) {
          current = current[Number(segment)];
          continue;
        }
        return { value: null, exists: false, incompatible: true };
      }
      if (typeof current !== 'object') return { value: null, exists: false, incompatible: true };
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return { value: null, exists: false, incompatible: false };
      }
      current = current[segment];
    }
    if (current !== null && typeof current !== 'object') {
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && rawPath.includes(`${lastSegment}.`)) {
        return { value: null, exists: false, incompatible: true };
      }
    }
    return { value: current, exists: true, incompatible: false };
  };

  let sawIncompatible = false;
  let sawMissing = false;
  for (const candidate of candidates) {
    const result = resolve(candidate, normalizedPath);
    if (result.exists) {
      return { value: result.value, resolved: true, path: normalizedPath, reason: null };
    }
    if (result.incompatible) sawIncompatible = true;
    else sawMissing = true;
  }

  if (normalizedPath === 'fields') {
    const fallback = source?.fields ?? source?.raw?.fields ?? source?.normalized?.fields ?? null;
    if (fallback !== null && typeof fallback !== 'undefined') {
      return { value: fallback, resolved: true, path: normalizedPath, reason: null };
    }
  }

  const normalizedIssue = source?.normalized || source?.issue || source;
  const rawIssue = source?.raw || source?.payload || source;
  const scalarAliasPaths = new Set([
    'fields.summary',
    'fields.status.name',
    'fields.priority.name',
    'fields.issuetype.name',
    'fields.status.statusCategory.name',
  ]);
  const scalarAliasValues = {
    'fields.summary': normalizedIssue?.summary ?? rawIssue?.fields?.summary,
    'fields.status.name': normalizedIssue?.status ?? rawIssue?.fields?.status?.name,
    'fields.priority.name': normalizedIssue?.priority ?? rawIssue?.fields?.priority?.name,
    'fields.issuetype.name': normalizedIssue?.issuetype ?? rawIssue?.fields?.issuetype?.name,
    'fields.status.statusCategory.name': normalizedIssue?.statusCategory ?? rawIssue?.fields?.status?.statusCategory?.name,
  };
  if (normalizedPath === 'status.name') {
    return { value: null, resolved: false, path: normalizedPath, reason: 'incompatible_path', warning: options.warnOnMissing === false ? null : `analytics path incompatible path: ${normalizedPath}` };
  }
  if (Object.prototype.hasOwnProperty.call(scalarAliasValues, normalizedPath) && typeof scalarAliasValues[normalizedPath] !== 'undefined') {
    return { value: scalarAliasValues[normalizedPath], resolved: true, path: normalizedPath, reason: null };
  }
  if (normalizedPath === 'fields.summary.name') {
    return { value: null, resolved: false, path: normalizedPath, reason: 'incompatible_path', warning: options.warnOnMissing === false ? null : `analytics path incompatible path: ${normalizedPath}` };
  }
  if (normalizedPath.includes('.') && Array.from(scalarAliasPaths).some((aliasPath) => normalizedPath.startsWith(`${aliasPath}.`))) {
    return { value: null, resolved: false, path: normalizedPath, reason: 'incompatible_path', warning: options.warnOnMissing === false ? null : `analytics path incompatible path: ${normalizedPath}` };
  }
  const pathMap = {
    'fields.summary.name': ['summary'],
    'fields.description': ['descriptionRaw', 'description'],
    'fields.description.raw': ['descriptionRaw'],
    'fields.comment': ['comments'],
    'fields.comment.comments': ['comments'],
    'fields.comment.total': ['commentCount'],
  };
  const mapped = pathMap[normalizedPath];
  if (mapped) {
    for (const mappedPath of mapped) {
      const normalizedResult = resolve(normalizedIssue, mappedPath);
      if (normalizedResult.exists) {
        return { value: normalizedResult.value, resolved: true, path: normalizedPath, reason: null };
      }
      const rawResult = resolve(rawIssue, mappedPath);
      if (rawResult.exists) {
        return { value: rawResult.value, resolved: true, path: normalizedPath, reason: null };
      }
      sawIncompatible = sawIncompatible || normalizedResult.incompatible || rawResult.incompatible;
      sawMissing = sawMissing || (!normalizedResult.incompatible && !rawResult.incompatible);
    }
  }

  const reason = sawIncompatible ? 'incompatible_path' : 'missing_path';
  const warning = options.warnOnMissing === false ? null : `analytics path ${reason.replace('_', ' ')}: ${normalizedPath}`;
  return { value: null, resolved: false, path: normalizedPath, reason, warning };
}

function getValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesPrefix(path, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  return patterns.some((pattern) => typeof pattern === 'string' && pattern && (path === pattern || path.startsWith(pattern)));
}

function shouldIncludeDiscoveredPath(path, options = {}) {
  const include = Array.isArray(options.include) ? options.include : [];
  const exclude = Array.isArray(options.exclude) ? options.exclude : [];
  const parsedMaxDepth = Number.parseInt(options.maxDepth, 10);
  const maxDepth = Number.isFinite(parsedMaxDepth) ? parsedMaxDepth : null;
  const depth = path.split('.').length;
  if (include.length && !matchesPrefix(path, include)) return false;
  if (exclude.length && matchesPrefix(path, exclude)) return false;
  if (maxDepth !== null && depth > maxDepth) return false;
  return true;
}

function walkDiscoveredPaths(value, currentPath, visitor) {
  if (!currentPath) return;
  visitor(currentPath, value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      if (entry !== null && typeof entry === 'object') {
        walkDiscoveredPaths(entry, `${currentPath}.${index}`, visitor);
      }
    });
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walkDiscoveredPaths(child, `${currentPath}.${key}`, visitor);
    }
  }
}

function cloneSampleValue(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return String(value);
  }
}

function buildDiscoveryResponse(snapshotData, discoverOptions = {}) {
  const parsedSampleIssues = Number.parseInt(discoverOptions.sampleIssues, 10);
  const parsedMaxPaths = Number.parseInt(discoverOptions.maxPaths, 10);
  const sampleIssues = Number.isFinite(parsedSampleIssues) && parsedSampleIssues > 0 ? parsedSampleIssues : 10;
  const maxPaths = Number.isFinite(parsedMaxPaths) && parsedMaxPaths > 0 ? parsedMaxPaths : 100;
  const includeSamples = discoverOptions.includeSamples === true;
  const allowedTypes = Array.isArray(discoverOptions.types)
    ? new Set(discoverOptions.types.filter((value) => typeof value === 'string' && value))
    : null;
  const issues = snapshotData.issues.slice(0, sampleIssues);
  const discovered = new Map();
  const canonicalAliasSpecs = [
    ['summary', ['summary', 'fields.summary']],
    ['status', ['status', 'fields.status.name']],
    ['priority', ['priority', 'fields.priority.name']],
    ['issuetype', ['issuetype', 'fields.issuetype.name']],
    ['statusCategory', ['statusCategory', 'fields.status.statusCategory.name']],
    ['fields.summary', ['fields.summary', 'summary']],
    ['fields.status.name', ['fields.status.name', 'status']],
    ['fields.priority.name', ['fields.priority.name', 'priority']],
    ['fields.issuetype.name', ['fields.issuetype.name', 'issuetype']],
    ['fields.status.statusCategory.name', ['fields.status.statusCategory.name', 'statusCategory']],
  ];

  const addPath = (path, value, coverageBoost = 1, forceInclude = false) => {
    if (!path) return;
    if (!forceInclude && !shouldIncludeDiscoveredPath(path, discoverOptions)) return;
    const valueType = getValueType(value);
    if (allowedTypes && !allowedTypes.has(valueType)) return;
    const entry = discovered.get(path) || { path, types: new Set(), coverage: 0, sampleValues: [] };
    entry.types.add(valueType);
    entry.coverage += coverageBoost;
    if (includeSamples && entry.sampleValues.length < 3) entry.sampleValues.push(cloneSampleValue(value));
    discovered.set(path, entry);
  };

  const resolveCanonicalAliasValue = (issue, candidates) => {
    const normalized = issue?.normalized || issue?.issue || issue;
    const raw = issue?.raw || issue?.payload || issue;
    for (const candidatePath of candidates) {
      const normalizedResult = getPathValue(normalized, candidatePath, { warnOnMissing: false });
      if (normalizedResult.resolved) return normalizedResult.value;
      const rawResult = getPathValue(raw, candidatePath, { warnOnMissing: false });
      if (rawResult.resolved) return rawResult.value;
    }
    return undefined;
  };

  for (const issue of issues) {
    walkDiscoveredPaths(issue, 'root', (path, value) => {
      const normalizedPath = path.replace(/^root\./, '');
      if (!normalizedPath) return;
      addPath(normalizedPath, value);
    });

    for (const [path, candidates] of canonicalAliasSpecs) {
      const resolvedValue = resolveCanonicalAliasValue(issue, candidates);
      if (resolvedValue !== undefined && resolvedValue !== null) addPath(path, resolvedValue, 1, true);
    }
  }

  const rows = Array.from(discovered.values())
    .map((entry) => ({
      path: entry.path,
      types: Array.from(entry.types).sort(),
      coverage: entry.coverage,
      ...(includeSamples ? { sampleValues: entry.sampleValues } : {}),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  const truncated = rows.length > maxPaths;
  const limitedRows = rows.slice(0, maxPaths);
  const response = {
    snapshot: {
      snapshotKey: snapshotData.snapshot.snapshotKey,
      storageMode: 'sqlite',
      totalPersisted: snapshotData.snapshot.returned,
      sampledIssues: issues.length,
    },
    discovery: {
      returnedPaths: limitedRows.length,
      truncated,
      paths: limitedRows,
    },
  };
  if (truncated) response.discovery.nextStepHint = 'Refine discover.include/exclude or increase maxPaths to inspect more fields.';
  return response;
}

function compareValues(a, b) {
  if (a === b) return 0;
  if (a === null || typeof a === 'undefined') return 1;
  if (b === null || typeof b === 'undefined') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function matchesFilter(actualValue, filter) {
  const op = String(filter?.op || 'eq');
  const expected = filter?.value;
  if (op === 'eq') return actualValue === expected;
  if (op === 'neq') return actualValue !== expected;
  if (op === 'in') return Array.isArray(expected) && expected.includes(actualValue);
  if (op === 'contains') {
    if (Array.isArray(actualValue)) return actualValue.includes(expected);
    if (typeof actualValue === 'string') return actualValue.includes(String(expected ?? ''));
    return false;
  }
  if (op === 'gt') return Number(actualValue) > Number(expected);
  if (op === 'gte') return Number(actualValue) >= Number(expected);
  if (op === 'lt') return Number(actualValue) < Number(expected);
  if (op === 'lte') return Number(actualValue) <= Number(expected);
  return false;
}

function runSnapshotAnalytics(snapshotData, analytics = {}) {
  const select = Array.isArray(analytics.select) ? analytics.select : [];
  if (select.length === 0) {
    const error = new Error('Invalid analytics. select must contain at least one path.');
    error.status = 400;
    throw error;
  }

  const pathIssues = [];
  const projection = select.map((item, index) => {
    const path = typeof item?.path === 'string' ? item.path.trim() : '';
    const alias = typeof item?.as === 'string' && item.as.trim() ? item.as.trim() : `col${index + 1}`;
    if (!path) {
      const error = new Error('Invalid analytics. Each select item requires a non-empty path.');
      error.status = 400;
      throw error;
    }
    const probe = getPathValue(snapshotData.issues[0] || {}, path, { warnOnMissing: false });
    if (!probe.resolved) pathIssues.push({ type: probe.reason, path: probe.path, warning: probe.warning });
    return { path, alias };
  });

  const incompatibleSelect = pathIssues.find((issue) => issue.type === 'incompatible_path');
  if (incompatibleSelect) {
    const error = new Error(`Invalid analytics path: ${incompatibleSelect.path}`);
    error.status = 400;
    error.details = pathIssues;
    throw error;
  }
  const warningMessages = pathIssues.filter((issue) => issue.type === 'missing_path' && issue.warning).map((issue) => issue.warning);

  const filters = Array.isArray(analytics.filters) ? analytics.filters : [];
  const filterIssues = [];
  const filterPathCache = new Map();
  const filterIssueKeys = new Set();
  const getFilterPathResult = (filterPath) => {
    const normalizedFilterPath = typeof filterPath === 'string' ? filterPath.trim() : '';
    if (!normalizedFilterPath) return { value: null, resolved: false, path: '', reason: 'missing_path' };
    if (filterPathCache.has(normalizedFilterPath)) return filterPathCache.get(normalizedFilterPath);
    const result = getPathValue(snapshotData.issues[0] || {}, normalizedFilterPath, { warnOnMissing: false });
    filterPathCache.set(normalizedFilterPath, result);
    return result;
  };
  const groupBy = (Array.isArray(analytics.groupBy) ? analytics.groupBy : [])
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return typeof item.as === 'string' && item.as.trim() ? item.as.trim() : '';
      }
      return '';
    })
    .filter(Boolean);
  const sort = Array.isArray(analytics.sort) ? analytics.sort : [];
  const parsedTop = Number.parseInt(analytics.top, 10);
  const top = Number.isFinite(parsedTop) && parsedTop > 0 ? parsedTop : null;

  for (const filter of filters) {
    const filterProbe = getFilterPathResult(filter?.path);
    if (filterProbe.reason === 'incompatible_path') {
      const issueKey = `incompatible_path::${filterProbe.path}`;
      if (!filterIssueKeys.has(issueKey)) {
        filterIssueKeys.add(issueKey);
        filterIssues.push({ type: 'incompatible_path', path: filterProbe.path, warning: filterProbe.warning });
      }
    }
  }

  const incompatibleFilter = filterIssues.find((issue) => issue.type === 'incompatible_path');
  if (incompatibleFilter) {
    const error = new Error(`Invalid analytics filter path: ${incompatibleFilter.path}`);
    error.status = 400;
    error.details = filterIssues;
    throw error;
  }

  const filteredRows = snapshotData.issues.filter((issue) => filters.every((filter) => {
    const filterProbe = getFilterPathResult(filter?.path);
    if (filterProbe.reason === 'incompatible_path') return false;
    if (!filterProbe.resolved) return false;
    return matchesFilter(filterProbe.value, filter);
  }));

  const projected = filteredRows.map((issue) => projection.reduce((acc, column) => {
    acc[column.alias] = getPathValue(issue, column.path, { warnOnMissing: false }).value;
    return acc;
  }, {})).map((row) => {
    if (row.summary == null && row['fields.summary'] != null) row.summary = row['fields.summary'];
    if (row.status == null && row['fields.status.name'] != null) row.status = row['fields.status.name'];
    if (row.priority == null && row['fields.priority.name'] != null) row.priority = row['fields.priority.name'];
    if (row.issuetype == null && row['fields.issuetype.name'] != null) row.issuetype = row['fields.issuetype.name'];
    return row;
  });

  let rows = projected;
  if (groupBy.length > 0) {
    const grouped = new Map();
    for (const row of projected) {
      const key = JSON.stringify(groupBy.map((alias) => row[alias] ?? null));
      const current = grouped.get(key) || groupBy.reduce((acc, alias) => {
        acc[alias] = row[alias] ?? null;
        return acc;
      }, { count: 0 });
      current.count += 1;
      grouped.set(key, current);
    }
    rows = Array.from(grouped.values());
  }

  if (sort.length > 0) {
    rows.sort((left, right) => {
      for (const clause of sort) {
        const by = clause?.by;
        const order = String(clause?.order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
        const result = compareValues(left?.[by], right?.[by]);
        if (result !== 0) return result * order;
      }
      return 0;
    });
  }

  const limitedRows = top ? rows.slice(0, top) : rows;
  return {
    snapshot: {
      snapshotKey: snapshotData.snapshot.snapshotKey,
      storageMode: 'sqlite',
      totalPersisted: snapshotData.snapshot.returned,
    },
    rows: limitedRows,
    warning: warningMessages.length > 0 ? warningMessages.join('; ') : undefined,
  };
}

function runSummaryAnalytics(snapshotData, summarySpec) {
  const analyticsResult = runSnapshotAnalytics(snapshotData, summarySpec);
  return {
    rows: analyticsResult.rows,
  };
}

function buildPersistedAnalyticsBase(db, snapshotKey, fallbackSnapshotData) {
  const persistedSnapshot = loadSnapshot(db, snapshotKey);
  if (persistedSnapshot?.issues?.length) return persistedSnapshot;
  return fallbackSnapshotData;
}

function buildCompactFetchResponse({ snapshotKey, total, returned, isLast, includeComments, preserveRequestedFields, commentsCollected, durationMs, summary, warning }) {
  const response = {
    snapshotKey,
    storageMode: 'sqlite',
    fullPayloadPersisted: false,
    persistedPayloadFormat: 'canonical-envelope / normalized+raw',
    total,
    returned,
    isLast,
    includeComments,
    preserveRequestedFields,
    commentsCollected,
    durationMs,
  };
  if (summary !== undefined) response.summary = summary;
  if (warning) response.warning = warning;
  return response;
}
router.post('/jira/queue/stop', checkLocalAccess, (req, res) => {
  if (!queueControl.activeRunId) {
    return res.json({ success: true, stopped: false, message: 'No active Jira queue collection.' });
  }

  queueControl.shouldStop = true;
  console.log(`[jira/queue] stop requested runId=${queueControl.activeRunId}`);
  return res.json({
    success: true,
    stopped: true,
    runId: queueControl.activeRunId,
    startedAt: queueControl.activeStartedAt,
    message: 'Stop requested. Collection will stop at the next safe checkpoint.',
  });
});

router.get('/jira/queue', async (req, res) => {
  const startedAt = Date.now();
  const runId = beginQueueRun();
  const token = getJiraToken(req);
  const debugPrefix = '[jira_queue_debug]';
  const safeDebugJson = (value) => {
    try {
      return JSON.stringify(value);
    } catch (_) {
      return '[unserializable]';
    }
  };

  if (!token) {
    endQueueRun(runId);
    return res.status(401).json({ error: describeMissingCredential(req) });
  }

  const { jql, fields, snapshotKey: snapshotKeyParam } = req.query;
  const includeComments = parseBoolean(req.query.includeComments);
  const preserveRequestedFields = parseBoolean(req.query.preserveRequestedFields);
  let fieldAliases = {};

  try {
    if (typeof req.query.fieldAliases === 'string' && req.query.fieldAliases.trim()) {
      const parsedFieldAliases = JSON.parse(req.query.fieldAliases);
      fieldAliases = normalizeFieldAliases(parsedFieldAliases);
    }
  } catch (err) {
    console.warn(`${debugPrefix} parse fieldAliases error`, {
      originalUrl: req.originalUrl,
      exportRawRequested: req.query.exportRaw,
      rawQuery: safeDebugJson(req.query),
      error: err?.message || String(err),
    });
    endQueueRun(runId);
    return res.status(400).json({ error: 'Invalid fieldAliases. Expected JSON object.' });
  }

  let summarySpec;
  let discoverSpec;
  let analyticsSpec;
  let exportRawSpec;
  let listSnapshotsSpec;
  let deleteSnapshotSpec;
  try {
    summarySpec = parseJsonObjectParam(req.query.summary, 'summary');
    discoverSpec = parseJsonObjectParam(req.query.discover, 'discover');
    analyticsSpec = parseJsonObjectParam(req.query.analytics, 'analytics');
    exportRawSpec = parseBooleanOrObjectParam(req.query.exportRaw, 'exportRaw');
    listSnapshotsSpec = parseBooleanOrObjectParam(req.query.listSnapshots, 'listSnapshots');
    deleteSnapshotSpec = parseBooleanOrObjectParam(req.query.deleteSnapshot, 'deleteSnapshot');
  } catch (err) {
    console.warn(`${debugPrefix} parse exportRaw error`, {
      originalUrl: req.originalUrl,
      rawQuery: safeDebugJson(req.query),
      exportRawRaw: req.query.exportRaw,
      error: err?.message || String(err),
    });
    endQueueRun(runId);
    return res.status(err.status || 400).json({ error: err.message });
  }

  const exportRawRequested = exportRawSpec.enabled;
  const listSnapshotsRequested = listSnapshotsSpec.enabled;
  const deleteSnapshotRequested = deleteSnapshotSpec.enabled;
  const hasJql = typeof jql === 'string' && jql.trim().length > 0;
  const hasSnapshotKey = typeof snapshotKeyParam === 'string' && snapshotKeyParam.trim().length > 0;
  const hasDiscover = Boolean(discoverSpec);
  const hasAnalytics = Boolean(analyticsSpec);
  const hasSummary = Boolean(summarySpec);

  console.log(`${debugPrefix} parsed exportRaw`, {
    originalUrl: req.originalUrl,
    rawQuery: safeDebugJson(req.query),
    exportRawRaw: req.query.exportRaw,
    exportRawRequested,
    exportRawEnabled: exportRawSpec?.enabled ?? false,
    exportRawOptions: exportRawSpec?.options || {},
    snapshotKey: snapshotKeyParam,
    flags: {
      snapshotKey: hasSnapshotKey,
      analytics: hasAnalytics,
      discover: hasDiscover,
      summary: hasSummary,
      exportRawRequested,
    },
  });
  const db = getDb();

  try {
    if (deleteSnapshotRequested) {
      if (hasJql || hasDiscover || hasAnalytics || hasSummary || exportRawRequested || listSnapshotsRequested) {
        endQueueRun(runId);
        return res.status(400).json({ error: 'Invalid query combination: deleteSnapshot cannot be combined with exportRaw, listSnapshots, jql, summary, discover, or analytics.' });
      }
      if (!hasSnapshotKey) {
        endQueueRun(runId);
        return res.status(400).json({ error: 'deleteSnapshot requires snapshotKey.' });
      }
      const result = deleteSnapshot(db, snapshotKeyParam.trim(), deleteSnapshotSpec.options || {});
      endQueueRun(runId);
      return res.json(result);
    }

    if (listSnapshotsRequested) {
      if (hasJql || hasDiscover || hasAnalytics || hasSummary || exportRawRequested || hasSnapshotKey) {
        endQueueRun(runId);
        return res.status(400).json({ error: 'Invalid query combination: listSnapshots cannot be combined with exportRaw, snapshotKey, jql, summary, discover, or analytics.' });
      }
      const result = listSnapshots(db, listSnapshotsSpec.options || {});
      endQueueRun(runId);
      return res.json(result);
    }

    if (!hasJql) {
      if (!hasSnapshotKey) {
        endQueueRun(runId);
        return res.status(400).json({ error: 'Missing required query params. Use deleteSnapshot, listSnapshots, jql, or snapshotKey with exactly one of discover, analytics, exportRaw, summary.' });
      }

      const snapshotOps = [
        { name: 'discover', enabled: hasDiscover },
        { name: 'analytics', enabled: hasAnalytics },
        { name: 'exportRaw', enabled: exportRawRequested },
        { name: 'summary', enabled: hasSummary },
      ].filter((op) => op.enabled);

      if (snapshotOps.length === 0) {
        endQueueRun(runId);
        return res.status(400).json({ error: 'Missing required query params. Use deleteSnapshot, listSnapshots, jql, or snapshotKey with exactly one of discover, analytics, exportRaw, summary.' });
      }

      if (hasExportRawConflictWithAnalytics(exportRawRequested, hasAnalytics)) {
        endQueueRun(runId);
        return res.status(400).json({
          error: 'Invalid query combination: snapshotKey exportRaw cannot be combined with analytics.',
          conflict: ['exportRaw', 'analytics'],
        });
      }

      if (snapshotOps.length > 1) {
        endQueueRun(runId);
        return res.status(400).json({
          error: 'Invalid query combination: snapshotKey mode requires exactly one main operation among discover, analytics, exportRaw, or summary.',
          conflict: snapshotOps.map((op) => op.name),
        });
      }

      const snapshotData = loadSnapshot(db, snapshotKeyParam.trim());
      if (!snapshotData) {
        endQueueRun(runId);
        return res.status(404).json({ error: `Snapshot not found: ${snapshotKeyParam.trim()}` });
      }

      const response = {};
      if (hasDiscover) response.discover = buildDiscoveryResponse(snapshotData, discoverSpec);
      if (exportRawRequested) response.exportRaw = dumpSnapshot(db, snapshotKeyParam.trim(), exportRawSpec.options || {});
      if (hasAnalytics) {
        try {
          response.analytics = runSnapshotAnalytics(snapshotData, analyticsSpec);
        } catch (err) {
          endQueueRun(runId);
          return res.status(err.status || 400).json({ error: err.message, detail: err.details || undefined });
        }
      }
      if (hasSummary) {
        try {
          response.summary = runSummaryAnalytics(snapshotData, summarySpec);
        } catch (err) {
          endQueueRun(runId);
          return res.status(err.status || 400).json({ error: err.message, detail: err.details || undefined });
        }
      }
      endQueueRun(runId);
      return res.json(response);
    }

    if (hasDiscover || hasAnalytics || exportRawRequested || listSnapshotsRequested || deleteSnapshotRequested) {
      endQueueRun(runId);
      return res.status(400).json({ error: 'Invalid query combination: jql fetch mode cannot be combined with deleteSnapshot, listSnapshots, discover, analytics, or exportRaw.' });
    }

    const fieldList = normalizeFields(fields);
    const searchFields = includeComments ? Array.from(new Set([...fieldList, 'comment'])) : fieldList;

    console.log(`[jira/queue] start runId=${runId} includeComments=${includeComments} jql=${jql}`);
    const search = await fetchAllIssues({ token, jql, fields: searchFields, runId });
    const total = search.total ?? search.issues.length;

    if (includeComments && total > COMMENT_LIMIT_THRESHOLD) {
      console.warn(`[jira/queue] comments blocked total=${total} threshold=${COMMENT_LIMIT_THRESHOLD} runId=${runId}`);
      endQueueRun(runId);
      return res.status(409).json({
        error: 'Comment collection blocked for large queue.',
        total,
        threshold: COMMENT_LIMIT_THRESHOLD,
        includeComments: true,
      });
    }

    const mapIssueOptions = {
      requestedFields: fieldList,
      preserveRequestedFields,
      fieldAliases,
    };

    let mappedIssues = search.issues.map((issue) => buildCanonicalIssueEnvelope(issue, mapIssue(issue, null, mapIssueOptions), mapIssueOptions));
    let commentsCollected = false;

    if (includeComments) {
      for (let index = 0; index < search.issues.length; index += 1) {
        assertNotStopped(runId);
        const rawIssue = search.issues[index];
        const inlineComments = rawIssue?.fields?.comment?.comments;
        const inlineTotal = rawIssue?.fields?.comment?.total;
        let comments = Array.isArray(inlineComments) ? inlineComments.map(mapComment) : [];
        const requiresFallback = !Array.isArray(inlineComments) || (typeof inlineTotal === 'number' && comments.length < inlineTotal);
        if (requiresFallback) {
          comments = await fetchIssueComments({
            token,
            issueKey: rawIssue.key,
            runId,
            index: index + 1,
            totalIssues: search.issues.length,
          });
        }
        const normalizedWithComments = mapIssue(rawIssue, comments, mapIssueOptions);
        mappedIssues[index] = buildCanonicalIssueEnvelope(rawIssue, normalizedWithComments, mapIssueOptions);
      }
      commentsCollected = true;
    }

    const durationMs = Date.now() - startedAt;
    if (durationMs > LONG_COLLECTION_WARN_MS || total >= LARGE_QUEUE_LOG_THRESHOLD) {
      console.warn(`[jira/queue] monitor duration=${durationMs}ms total=${total} includeComments=${includeComments} runId=${runId}`);
    }

    const snapshotKey = normalizeSnapshotKey(snapshotKeyParam, includeComments);
    saveSqliteSnapshot({
      db,
      snapshotKey,
      jql,
      total,
      returned: mappedIssues.length,
      isLast: search.isLast ?? true,
      issues: mappedIssues,
      metadata: {
        schemaVersion: 2,
        snapshotSchemaVersion: 2,
        persistedFormat: 'sqlite_snapshot',
        payloadFormat: 'canonical-envelope',
        fullPayloadPersisted: false,
        includeComments,
        commentsCollected,
        preserveRequestedFields,
        requestedFields: fieldList,
        preservedFields: Array.from(new Set(mappedIssues.flatMap((issue) => Array.isArray(issue.preservedFields) ? issue.preservedFields : []))),
        fieldAliases,
        pages: search.pages,
        normalizedRole: 'derived_from_raw_canonical_payload',
        normalizedSource: 'raw',
        normalizedDerivedFrom: 'raw',
        preservationState: preserveRequestedFields ? 'requested' : 'not_requested',
        updatedAt: new Date().toISOString(),
        runId,
      },
    });

    let summary;
    let warning;
    if (summarySpec) {
      try {
        const persistedSnapshot = loadSnapshot(db, snapshotKey) || {
          snapshot: { snapshotKey, returned: mappedIssues.length },
          issues: mappedIssues,
        };
        const analyticsBase = persistedSnapshot.issues?.length
          ? persistedSnapshot
          : { snapshot: { snapshotKey, returned: mappedIssues.length }, issues: mappedIssues };
        summary = runSummaryAnalytics(analyticsBase, summarySpec);
      } catch (err) {
        warning = `summary omitted: ${err.message}`;
      }
    }

    console.log(`[jira/queue] success runId=${runId} total=${total} returned=${mappedIssues.length} includeComments=${includeComments} durationMs=${durationMs}`);
    endQueueRun(runId);
    return res.json(buildCompactFetchResponse({
      snapshotKey,
      total,
      returned: mappedIssues.length,
      isLast: search.isLast ?? true,
      includeComments,
      preserveRequestedFields,
      commentsCollected,
      durationMs,
      summary,
      warning,
    }));
  } catch (err) {
    const stopped = err?.code === 'JIRA_QUEUE_STOPPED';
    console.error('[jira/queue] error:', err);
    endQueueRun(runId);
    return res.status(stopped ? 409 : (err.status || 500)).json({
      error: stopped ? 'Jira queue collection stopped.' : 'Jira API error',
      detail: err.data || err.message || String(err),
      stopped,
    });
  }
});

router.post('/jira/action', async (req, res) => {
  const token = getJiraToken(req);
  if (!token) {
    return res.status(401).json({ error: describeMissingCredential(req) });
  }

  const { action, issueKey, issueId, ...params } = req.body || {};
  const targetIssueIdentifier = issueKey || issueId || null;

  if (!action) {
    return res.status(400).json({ error: 'Missing required field: action' });
  }

  if ((action === 'comment' || action === 'update_fields' || action === 'add_label') && !issueKey) {
    return res.status(400).json({ error: 'Missing required field: issueKey' });
  }

  if (action === 'transition' && !targetIssueIdentifier) {
    return res.status(400).json({ error: 'Missing required field: issueKey or issueId' });
  }

  if (action === 'delete_issue' && !targetIssueIdentifier) {
    return res.status(400).json({ error: 'Missing required field: issueKey or issueId' });
  }

  try {
    let result;

    switch (action) {
      case 'comment': {
        const structuredCommentBody =
          params.commentBody && typeof params.commentBody === 'object' && !Array.isArray(params.commentBody)
            ? params.commentBody
            : null;
        const isValidAdfDoc = (value) => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          if (value.type !== 'doc' || value.version !== 1 || !Array.isArray(value.content)) return false;
          return true;
        };
        const body = isValidAdfDoc(structuredCommentBody)
          ? structuredCommentBody
          : (!params.text ? null : {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: params.text }],
                },
              ],
            });
        if (!body) return res.status(400).json({ error: 'Missing: text or valid commentBody' });
        result = await jiraRequest({
          method: 'POST',
          path: `/rest/api/3/issue/${issueKey}/comment`,
          body: { body },
          token,
        });
        break;
      }

      case 'update_fields': {
        if (!params.fields || typeof params.fields !== 'object') {
          return res.status(400).json({ error: 'Missing or invalid: fields (object)' });
        }
        result = await jiraRequest({
          method: 'PUT',
          path: `/rest/api/3/issue/${issueKey}`,
          body: { fields: params.fields },
          token,
        });
        break;
      }

      case 'transition': {
        if (!params.transitionId) return res.status(400).json({ error: 'Missing: transitionId' });
        const id = issueId || issueKey;
        const transitionBody = { transition: { id: String(params.transitionId) } };
        if (params.fields && typeof params.fields === 'object' && !Array.isArray(params.fields) && Object.keys(params.fields).length > 0) {
          transitionBody.fields = params.fields;
        }
        result = await jiraRequest({
          method: 'POST',
          path: `/rest/api/2/issue/${encodeURIComponent(id)}/transitions`,
          body: transitionBody,
          token,
        });
        break;
      }

      case 'add_label': {
        if (!params.label) return res.status(400).json({ error: 'Missing: label' });
        const { data: current } = await jiraRequest({
          method: 'GET',
          path: `/rest/api/3/issue/${issueKey}?fields=labels`,
          token,
        });
        const existingLabels = current?.fields?.labels || [];
        if (!existingLabels.includes(params.label)) {
          existingLabels.push(params.label);
        }
        result = await jiraRequest({
          method: 'PUT',
          path: `/rest/api/3/issue/${issueKey}`,
          body: { fields: { labels: existingLabels } },
          token,
        });
        break;
      }

      case 'create_issue': {
        const fields = params.fields && typeof params.fields === 'object' ? { ...params.fields } : null;
        const serviceDeskId = params.serviceDeskId;
        const requestTypeId = params.requestTypeId;
        const requestFieldValues = params.requestFieldValues && typeof params.requestFieldValues === 'object' ? { ...params.requestFieldValues } : null;
        const postUpdateFields = params.postUpdateFields && typeof params.postUpdateFields === 'object' ? { ...params.postUpdateFields } : null;
        const hasGenericFields = fields && Object.keys(fields).length > 0;
        const hasServiceDeskPayload = serviceDeskId && requestTypeId && requestFieldValues && Object.keys(requestFieldValues).length > 0;

        if (!hasGenericFields && !hasServiceDeskPayload) {
          return res.status(400).json({ error: 'Missing or invalid: fields (object) or servicedesk payload' });
        }

        if (hasServiceDeskPayload) {
          const createResult = await jiraRequest({
            method: 'POST',
            path: '/rest/servicedeskapi/request',
            body: {
              serviceDeskId,
              requestTypeId,
              requestFieldValues,
            },
            token,
          });
          const issueKey = createResult.data?.issueKey || null;
          const issueId = createResult.data?.issueId || null;
          const shouldPostUpdate = !!(postUpdateFields && Object.keys(postUpdateFields).length > 0 && issueKey);
          if (shouldPostUpdate) {
            await jiraRequest({
              method: 'PUT',
              path: `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
              body: { fields: postUpdateFields },
              token,
            });
          }
          return res.json({
            success: true,
            action,
            issueKey,
            issueId,
            issueIdentifier: issueKey || issueId || null,
            status: createResult.status,
            postUpdateRan: shouldPostUpdate,
          });
        }

        result = await jiraRequest({
          method: 'POST',
          path: '/rest/api/3/issue',
          body: { fields },
          token,
        });
        break;
      }

      case 'delete_issue': {
        const id = issueId || issueKey;
        if (!id) return res.status(400).json({ error: 'Missing: issueKey or issueId' });
        result = await jiraRequest({
          method: 'DELETE',
          path: `/rest/api/3/issue/${encodeURIComponent(id)}`,
          token,
        });
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const createdKey = action === 'create_issue' ? (result?.data?.key || result?.data?.issueKey || null) : (result?.data?.key || null);
    const createdId = action === 'create_issue' ? (result?.data?.id || result?.data?.issueId || null) : (result?.data?.id || null);
    const resolvedKey = action === 'create_issue' ? (createdKey || issueKey || null) : (issueKey || null);
    const resolvedId = action === 'create_issue' ? (createdId || issueId || null) : (issueId || null);
    return res.json({ success: true, action, issueKey: resolvedKey, issueId: resolvedId, issueIdentifier: action === 'delete_issue' ? (resolvedId || resolvedKey || null) : (resolvedKey || resolvedId || null), status: result.status });
  } catch (err) {
    console.error(`[jira/action] ${action} on ${issueKey} error:`, err);
    return res.status(err.status || 500).json({
      success: false,
      error: 'Jira API error',
      detail: err.data || String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// ALL /api/jira/rest/* — credential-injecting passthrough to the Jira REST API
//
// Write the real Jira path and send no credential:
//   curl -sk https://localhost/zero/api/jira/rest/api/3/myself -H 'x-username: ettore'
//   curl -sk 'https://localhost/zero/api/jira/rest/api/3/search/jql?jql=project%3DABC&maxResults=5' \
//        -H 'x-username: ettore'
//   (note /rest/api/3/search was removed by Atlassian; use search/jql, and JQL
//    must be bounded -- an unrestricted query is rejected upstream)
//   curl -sk -X POST https://localhost/zero/api/jira/rest/api/3/issue/ABC-1/comment \
//        -H 'x-username: ettore' -H 'Content-Type: application/json' \
//        -d '{"body":{"type":"doc","version":1,"content":[]}}'
//
// Method, query string, body and upstream status are passed through unchanged.
// The host is a constant and the path must be under rest/, so unlike
// POST /api/proxy nothing in the request can retarget the call.
// ---------------------------------------------------------------------------
router.all('/jira/rest/*', checkLocalAccess, async (req, res) => {
  const token = getJiraToken(req);
  if (!token) {
    return res.status(401).json({ error: describeMissingCredential(req) });
  }

  const { path, error } = normalizeJiraPath(`rest/${req.params[0] || ''}`);
  if (error) return res.status(400).json({ error });

  const queryIndex = req.originalUrl.indexOf('?');
  const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex + 1);

  const hasBody = req.body && Object.keys(req.body).length > 0;
  const result = await forwardToJira({
    method: req.method,
    path,
    query,
    body: hasBody ? req.body : undefined,
    token,
  });

  res.status(result.status);
  for (const [name, value] of Object.entries(result.headers)) {
    if (name === 'content-type') res.type(value);
    else res.set(name, value);
  }
  return res.send(result.body);
});

export default router;
