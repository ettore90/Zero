import { generateId, getDb } from '../db.js';

const INPUT_KEYS = new Set([
  'auditKind', 'documentId', 'documentVersionId', 'packageVersionId', 'agentId',
  'sessionId', 'executionId', 'requestId', 'idempotencyKey', 'compositionHash',
  'inputHash', 'selectedItems', 'excludedItems', 'contextIds', 'budget',
  'candidateCount', 'selectedCount', 'excludedCount', 'createdAt',
]);
const SELECTED_KEYS = new Set(['blockId', 'blockVersionId', 'contentHash', 'blockType', 'position', 'priority', 'forceInclude', 'forcedPosition', 'estimatedChars']);
const EXCLUDED_KEYS = new Set(['blockId', 'blockVersionId', 'contentHash', 'code', 'estimatedChars']);
const CONTEXT_KEYS = new Set(['agentType', 'sessionId', 'executionId', 'requestId', 'taskId']);
const BUDGET_KEYS = new Set(['maxChars', 'selectedChars']);
const FILTER_KEYS = new Set(['documentId', 'sessionId', 'executionId', 'requestId', 'auditKind', 'from', 'to', 'limit', 'offset']);

function fail(message) { throw new TypeError(`Invalid prompt composition audit: ${message}`); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function assertStrictObject(value, allowed, name) {
  if (!isObject(value)) fail(`${name} must be an object`);
  if (Object.getOwnPropertySymbols(value).length) fail(`${name} must not contain symbol keys`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable) fail(`${name}.${key} must be enumerable`);
    if (!allowed.has(key)) fail(`${name}.${key} is not allowed`);
  }
  for (const key in value) if (!Object.hasOwn(value, key)) fail(`${name}.${key} must be an own property`);
}
function own(value, key, required = false) {
  const has = Object.hasOwn(value, key);
  if (required && !has) fail(`${key} must be an own property`);
  return has;
}
function nonempty(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail(`${name} must be a nonempty string`);
  return value;
}
function optionalString(value, key) {
  if (!own(value, key)) return null;
  if (value[key] === null) return null;
  return nonempty(value[key], key);
}
function integer(value, key) {
  if (!Number.isInteger(value) || value < 0) fail(`${key} must be a nonnegative integer`);
  return value;
}
function optionalInteger(value, key) {
  if (!own(value, key) || value[key] === null) return null;
  return integer(value[key], key);
}
function stableJson(value) { return JSON.stringify(value); }
function assertStrictArray(value, name) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${name} must be a native array`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) fail(`${name} must not contain extra properties or holes`);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${name}[${index}] must be an own enumerable data property`);
  }
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || length.enumerable || length.configurable || !Object.hasOwn(length, 'value') || length.value !== value.length) fail(`${name}.length must be a natural array length property`);
}

function sanitizeSelected(item, index) {
  assertStrictObject(item, SELECTED_KEYS, `selectedItems[${index}]`);
  own(item, 'blockId', true);
  const forceInclude = own(item, 'forceInclude') ? item.forceInclude : false;
  if (typeof forceInclude !== 'boolean') fail(`selectedItems[${index}].forceInclude must be boolean`);
  const forcedPosition = optionalInteger(item, 'forcedPosition');
  if (forcedPosition !== null && !forceInclude) fail(`selectedItems[${index}].forcedPosition requires forceInclude`);
  return {
    blockId: nonempty(item.blockId, `selectedItems[${index}].blockId`),
    blockVersionId: optionalString(item, 'blockVersionId'),
    contentHash: optionalString(item, 'contentHash'),
    blockType: optionalString(item, 'blockType'),
    position: optionalInteger(item, 'position'),
    priority: optionalInteger(item, 'priority'),
    forceInclude,
    forcedPosition,
    estimatedChars: optionalInteger(item, 'estimatedChars'),
  };
}
function sanitizeExcluded(item, index) {
  assertStrictObject(item, EXCLUDED_KEYS, `excludedItems[${index}]`);
  own(item, 'blockId', true); own(item, 'code', true);
  return {
    blockId: nonempty(item.blockId, `excludedItems[${index}].blockId`),
    blockVersionId: optionalString(item, 'blockVersionId'),
    contentHash: optionalString(item, 'contentHash'),
    code: nonempty(item.code, `excludedItems[${index}].code`),
    estimatedChars: optionalInteger(item, 'estimatedChars'),
  };
}
function sanitizeStringObject(value, allowed, name) {
  if (!own(value, name) || value[name] === null) return {};
  assertStrictObject(value[name], allowed, name);
  const out = {};
  for (const key of [...allowed].sort()) {
    if (!own(value[name], key) || value[name][key] === null) continue;
    out[key] = nonempty(value[name][key], `${name}.${key}`);
  }
  return out;
}
function sanitizeBudget(value) {
  if (!own(value, 'budget') || value.budget === null) return {};
  assertStrictObject(value.budget, BUDGET_KEYS, 'budget');
  const out = {};
  for (const key of ['maxChars', 'selectedChars']) if (own(value.budget, key) && value.budget[key] !== null) out[key] = integer(value.budget[key], `budget.${key}`);
  return out;
}
function sanitizeInput(input) {
  assertStrictObject(input, INPUT_KEYS, 'input');
  own(input, 'auditKind', true); own(input, 'compositionHash', true);
  own(input, 'selectedItems', true); own(input, 'excludedItems', true);
  own(input, 'candidateCount', true); own(input, 'selectedCount', true); own(input, 'excludedCount', true);
  assertStrictArray(input.selectedItems, 'selectedItems');
  assertStrictArray(input.excludedItems, 'excludedItems');
  const selectedItems = input.selectedItems.map(sanitizeSelected);
  const excludedItems = input.excludedItems.map(sanitizeExcluded);
  const candidateCount = integer(input.candidateCount, 'candidateCount');
  const selectedCount = integer(input.selectedCount, 'selectedCount');
  const excludedCount = integer(input.excludedCount, 'excludedCount');
  if (selectedCount !== selectedItems.length || excludedCount !== excludedItems.length || selectedCount + excludedCount !== candidateCount) fail('counts must match items and candidateCount');
  const budget = sanitizeBudget(input);
  const estimatedChars = selectedItems.reduce((sum, item) => sum + (item.estimatedChars ?? 0), 0);
  if (budget.selectedChars !== undefined && budget.selectedChars !== estimatedChars) fail('budget.selectedChars must equal selected estimatedChars');
  budget.selectedChars = estimatedChars;
  const createdAt = own(input, 'createdAt') ? integer(input.createdAt, 'createdAt') : Math.floor(Date.now() / 1000);
  return {
    auditKind: nonempty(input.auditKind, 'auditKind'), documentId: optionalString(input, 'documentId'), documentVersionId: optionalString(input, 'documentVersionId'), packageVersionId: optionalString(input, 'packageVersionId'), agentId: optionalString(input, 'agentId'), sessionId: optionalString(input, 'sessionId'), executionId: optionalString(input, 'executionId'), requestId: optionalString(input, 'requestId'), idempotencyKey: optionalString(input, 'idempotencyKey'), compositionHash: nonempty(input.compositionHash, 'compositionHash'), inputHash: optionalString(input, 'inputHash'), selectedItems, excludedItems, contextIds: sanitizeStringObject(input, CONTEXT_KEYS, 'contextIds'), budget, candidateCount, selectedCount, excludedCount, createdAt,
  };
}
function fromRow(row) {
  if (!row) return null;
  let input;
  try {
    input = {
      auditKind: row.audit_kind, documentId: row.document_id, documentVersionId: row.document_version_id, packageVersionId: row.package_version_id, agentId: row.agent_id, sessionId: row.session_id, executionId: row.execution_id, requestId: row.request_id, idempotencyKey: row.idempotency_key, compositionHash: row.composition_hash, inputHash: row.input_hash,
      selectedItems: JSON.parse(row.selected_items), excludedItems: JSON.parse(row.excluded_items), contextIds: JSON.parse(row.context_ids), budget: JSON.parse(row.budget), candidateCount: row.candidate_count, selectedCount: row.selected_count, excludedCount: row.excluded_count, createdAt: row.created_at,
    };
  } catch { throw new Error('Invalid persisted prompt composition audit JSON'); }
  return { id: row.id, ...sanitizeInput(input) };
}
function equalAudit(a, b) { return stableJson(a) === stableJson(b); }

export function recordPromptCompositionAudit(input) {
  const audit = sanitizeInput(input);
  const hasCreatedAt = own(input, 'createdAt');
  const db = getDb();
  return db.transaction(() => {
    if (audit.idempotencyKey !== null) {
      const existing = fromRow(db.prepare('SELECT * FROM prompt_composition_audits WHERE idempotency_key = ?').get(audit.idempotencyKey));
      if (existing) {
        const { id, ...persisted } = existing;
        const comparableAudit = hasCreatedAt ? audit : { ...audit, createdAt: persisted.createdAt };
        if (!equalAudit(persisted, comparableAudit)) throw new Error('Prompt composition audit idempotency conflict');
        return existing;
      }
    }
    const id = generateId('prompt_composition_audit');
    db.prepare(`INSERT INTO prompt_composition_audits (id,audit_kind,document_id,document_version_id,package_version_id,agent_id,session_id,execution_id,request_id,idempotency_key,composition_hash,input_hash,selected_items,excluded_items,context_ids,budget,candidate_count,selected_count,excluded_count,created_at) VALUES (@id,@auditKind,@documentId,@documentVersionId,@packageVersionId,@agentId,@sessionId,@executionId,@requestId,@idempotencyKey,@compositionHash,@inputHash,@selectedItems,@excludedItems,@contextIds,@budget,@candidateCount,@selectedCount,@excludedCount,@createdAt)`).run({ ...audit, id, selectedItems: stableJson(audit.selectedItems), excludedItems: stableJson(audit.excludedItems), contextIds: stableJson(audit.contextIds), budget: stableJson(audit.budget) });
    return { id, ...audit };
  })();
}
export function getPromptCompositionAudit(id) {
  if (typeof id !== 'string' || !id) fail('id must be a nonempty string');
  return fromRow(getDb().prepare('SELECT * FROM prompt_composition_audits WHERE id = ?').get(id));
}
export function listPromptCompositionAudits(filters = {}) {
  assertStrictObject(filters, FILTER_KEYS, 'filters');
  const clauses = [], params = {};
  for (const [key, column] of [['documentId','document_id'],['sessionId','session_id'],['executionId','execution_id'],['requestId','request_id'],['auditKind','audit_kind']]) if (own(filters, key)) { params[key] = nonempty(filters[key], `filters.${key}`); clauses.push(`${column} = @${key}`); }
  for (const [key, op] of [['from','>='],['to','<=']]) if (own(filters, key)) { params[key] = integer(filters[key], `filters.${key}`); clauses.push(`created_at ${op} @${key}`); }
  const limit = own(filters, 'limit') ? integer(filters.limit, 'filters.limit') : 50;
  const offset = own(filters, 'offset') ? integer(filters.offset, 'filters.offset') : 0;
  if (limit > 100) fail('filters.limit must be at most 100');
  params.limit = limit; params.offset = offset;
  return getDb().prepare(`SELECT * FROM prompt_composition_audits ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC, id ASC LIMIT @limit OFFSET @offset`).all(params).map(fromRow);
}
