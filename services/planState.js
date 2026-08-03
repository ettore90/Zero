import { pendingApprovals } from './runtime.js';
import { upsertPlan, getPlan, hydratePlanStore } from './planStore.js';
import { broadcastToUser } from './streamBroker.js';

const makeId = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const MAX_PLAN_TEXT_LENGTH = 20000;
const MAX_CHECKLIST_ITEMS = 200;
const MAX_COMMENTS_PER_ITEM = 100;
const MAX_COMMENT_TEXT_LENGTH = 4000;

const CANONICAL_PLAN_TERMINAL_STATUSES = new Set(['completed', 'canceled']);

export function normalizePlanStatus(status) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (!normalized) return '';
  if (normalized === 'cancelled' || normalized === 'rejected') return 'canceled';
  if (normalized === 'approved') return 'in_progress';
  return normalized;
}

export function isTerminalPlanStatus(status) {
  return CANONICAL_PLAN_TERMINAL_STATUSES.has(normalizePlanStatus(status));
}

const clampTrimmedString = (value, maxLength) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

const sanitizeComment = (comment, index = 0, commentIndex = 0) => {
  const rawText = typeof comment === 'string'
    ? comment
    : (comment && typeof comment === 'object' && typeof comment.text === 'string' ? comment.text : '');
  const text = clampTrimmedString(rawText, MAX_COMMENT_TEXT_LENGTH);
  if (!text) return null;
  const base = comment && typeof comment === 'object' ? { ...comment } : {};
  return {
    ...base,
    id: isNonEmptyString(base.id) ? base.id.trim() : makeId(`comment_${index + 1}_${commentIndex + 1}`),
    author: typeof base.author === 'string' && base.author.trim() ? base.author.trim() : undefined,
    role: base.role === 'user' ? 'user' : 'agent',
    text,
    createdAt: Number.isFinite(Number(base.createdAt)) ? Number(base.createdAt) : Date.now(),
  };
};

export function normalizeChecklistItem(item, index = 0) {
  if (typeof item === 'string') {
    return { id: makeId(`item_${index + 1}`), text: clampTrimmedString(item, MAX_COMMENT_TEXT_LENGTH), done: false, comments: [] };
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const base = { ...item };
  const text = clampTrimmedString(base.text, MAX_COMMENT_TEXT_LENGTH);
  if (!text) return null;
  const comments = Array.isArray(base.comments)
    ? base.comments.slice(0, MAX_COMMENTS_PER_ITEM).map((comment, commentIndex) => sanitizeComment(comment, index, commentIndex)).filter(Boolean)
    : [];
  return {
    ...base,
    id: isNonEmptyString(base.id) ? base.id.trim() : makeId(`item_${index + 1}`),
    text,
    done: Boolean(base.done),
    comments,
  };
}

export function isPlausiblePlanPayload(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return false;
  const title = clampTrimmedString(plan.title, MAX_PLAN_TEXT_LENGTH);
  const objective = clampTrimmedString(plan.objective, MAX_PLAN_TEXT_LENGTH);
  const approach = clampTrimmedString(plan.approach, MAX_PLAN_TEXT_LENGTH);
  const risks = typeof plan.risks === 'undefined' || typeof plan.risks === 'string';
  const checklistOk = typeof plan.checklist === 'undefined' || Array.isArray(plan.checklist);
  return Boolean(title || objective || approach) && risks && checklistOk;
}

export function validateCommentInput(text) {
  if (typeof text !== 'string') return { ok: false, error: 'Comment text required' };
  const normalized = text.trim();
  if (!normalized) return { ok: false, error: 'Comment text required' };
  if (normalized.length > MAX_COMMENT_TEXT_LENGTH) {
    return { ok: false, error: `Comment text too long (max ${MAX_COMMENT_TEXT_LENGTH} characters)` };
  }
  return { ok: true, text: normalized };
}

function matchChecklistItem(item, { itemId, itemText }) {
  const normalizedItemId = isNonEmptyString(itemId) ? itemId.trim() : '';
  const normalizedItemText = isNonEmptyString(itemText) ? itemText.trim() : '';
  const itemHasId = isNonEmptyString(item?.id);
  const itemHasText = typeof item?.text === 'string' && item.text.trim().length > 0;

  if (normalizedItemId) {
    if (!itemHasId) return false;
    return item.id.trim() === normalizedItemId;
  }

  if (normalizedItemText && itemHasText) return item.text.trim() === normalizedItemText;
  return false;
}

function resolveChecklistItemIndex(checklist, { itemId, itemText }) {
  const matches = checklist
    .map((item, index) => (matchChecklistItem(item, { itemId, itemText }) ? index : -1))
    .filter((index) => index >= 0);
  if (matches.length === 0) return { ok: false, error: 'Checklist item not found' };
  if (matches.length > 1) return { ok: false, error: 'Ambiguous checklist item match' };
  return { ok: true, index: matches[0] };
}

export function markPlanItemCompleted(record, { itemId, itemText }) {
  const normalizedPlan = normalizePlanForStorage(record?.plan ?? record?.payload);
  const checklist = Array.isArray(normalizedPlan?.checklist) ? [...normalizedPlan.checklist] : [];
  const resolved = resolveChecklistItemIndex(checklist, { itemId, itemText });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const index = resolved.index;
  const updatedItem = { ...checklist[index], done: true };
  checklist[index] = updatedItem;
  const allDone = checklist.length > 0 && checklist.every((item) => Boolean(item?.done));
  const updatedPlan = { ...normalizedPlan, checklist, ...(allDone ? { status: 'completed' } : {}) };
  const updatedRecord = { ...record, plan: updatedPlan, payload: updatedPlan, status: allDone ? 'completed' : normalizePlanStatus(record?.status), updatedAt: Date.now() };
  return { ok: true, record: updatedRecord, item: updatedItem };
}

export function normalizePlanForStorage(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return plan;
  const incomingChecklist = Array.isArray(plan.checklist) ? plan.checklist : [];
  const checklist = incomingChecklist.map((item, index) => {
    const normalized = normalizeChecklistItem(item, index);
    return normalized ? normalized : null;
  }).filter(Boolean);
  const normalizedStatus = normalizePlanStatus(plan.status);
  return {
    ...plan,
    ...(normalizedStatus ? { status: normalizedStatus } : {}),
    title: typeof plan.title === 'string' ? clampTrimmedString(plan.title, MAX_PLAN_TEXT_LENGTH) : plan.title,
    objective: typeof plan.objective === 'string' ? clampTrimmedString(plan.objective, MAX_PLAN_TEXT_LENGTH) : plan.objective,
    approach: typeof plan.approach === 'string' ? clampTrimmedString(plan.approach, MAX_PLAN_TEXT_LENGTH) : plan.approach,
    risks: typeof plan.risks === 'string' ? clampTrimmedString(plan.risks, MAX_PLAN_TEXT_LENGTH) : plan.risks,
    checklist,
  };
}

export function appendCommentToPlanItem(record, { itemId, itemText, text, author, role = 'agent' }) {
  const commentValidation = validateCommentInput(text);
  if (!commentValidation.ok) return { ok: false, error: commentValidation.error };
  const normalizedPlan = normalizePlanForStorage(record?.plan ?? record?.payload);
  const checklist = Array.isArray(normalizedPlan?.checklist) ? [...normalizedPlan.checklist] : [];
  const resolved = resolveChecklistItemIndex(checklist, { itemId, itemText });
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const index = resolved.index;
  const comment = {
    id: makeId('comment'),
    author: typeof author === 'string' && author.trim() ? author.trim() : undefined,
    role: role === 'user' ? 'user' : 'agent',
    text: commentValidation.text,
    createdAt: Date.now(),
  };
  const existingComments = Array.isArray(checklist[index]?.comments) ? checklist[index].comments.slice(0, MAX_COMMENTS_PER_ITEM - 1) : [];
  const updatedItem = {
    ...checklist[index],
    comments: [...existingComments, comment],
  };
  checklist[index] = updatedItem;
  const updatedPlan = { ...normalizedPlan, checklist };
  const updatedRecord = { ...record, plan: updatedPlan, payload: updatedPlan, updatedAt: Date.now() };
  return { ok: true, record: updatedRecord, item: updatedItem, comment };
}

export function persistPlanRecord(record) {
  const saved = upsertPlan(record);
  return saved;
}


export function finalizePlanIfComplete(record) {
  const normalizedPlan = normalizePlanForStorage(record?.plan ?? record?.payload);
  const checklist = Array.isArray(normalizedPlan?.checklist) ? normalizedPlan.checklist : [];
  if (checklist.length > 0 && !checklist.every((item) => Boolean(item?.done))) {
    const pendingCount = checklist.filter((item) => !item?.done).length;
    return { ok: false, error: 'Plan cannot be finalized until all checklist items are done', details: { pendingCount, totalCount: checklist.length } };
  }
  const finalizedRecord = { ...record, plan: normalizedPlan, payload: normalizedPlan, status: 'completed', updatedAt: Date.now() };
  return { ok: true, record: finalizedRecord };
}

export function hydratePlansFromStore() {
  hydratePlanStore();
}

export function broadcastPlanUpdate(record) {
  const username = typeof record?.username === 'string' ? record.username.trim() : '';
  if (!username) return false;
  broadcastToUser(username, 'approval:plan_updated', {
    requestId: record.requestId,
    agentId: record.agentId || null,
    sessionId: record.sessionId || null,
    status: record.status || null,
    plan: record.plan ?? null,
    payload: record.payload ?? null,
    updatedAt: record.updatedAt || Date.now(),
  });
  return true;
}

export function getPersistedPlan(requestId) {
  return getPlan(requestId);
}

export function findLatestInProgressPlanForAgent({ username, agentId, sessionId }) {
  let best = null;
  for (const record of pendingApprovals.values()) {
    if (!record || record.username !== username || record.agentId !== agentId) continue;
    if (sessionId && record.sessionId !== sessionId) continue;
    if (record.status !== 'in_progress') continue;
    if (!best || Number(record.updatedAt || 0) > Number(best.updatedAt || 0)) best = record;
  }
  return best;
}
