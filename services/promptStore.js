import { getDb, generateId } from '../db.js';

function nowSeconds() { return Math.floor(Date.now() / 1000); }
function parseJson(value, fallback) { if (value == null || value === '') return fallback; if (typeof value === 'object') return value; try { return JSON.parse(value); } catch { return fallback; } }
function normalizePromptKeyPart(value) { return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown'; }
function derivePromptKeyForAgent(agent) { return `agent:${normalizePromptKeyPart(agent?.username)}:${normalizePromptKeyPart(agent?.id)}`; }
const GLOBAL_PROMPT_DOCUMENT_KEY = 'global:settings:prompt-document';
function toPromptDocument(row) { if (!row) return null; return { id: row.id, key: row.key, title: row.title, currentVersionId: row.current_version_id, createdAt: row.created_at, updatedAt: row.updated_at, metadata: parseJson(row.metadata, {}) }; }
function toPromptVersion(row) { if (!row) return null; return { id: row.id, documentId: row.document_id, version: row.version, content: row.content, createdAt: row.created_at, createdBy: row.created_by, metadata: parseJson(row.metadata, {}) }; }
function sanitizeBlockMetadata(metadata = {}) { if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}; const next = { ...metadata }; delete next.agentTypes; delete next.agent_types; delete next.role; delete next.agentRole; return next; }
function toBlock(row) { if (!row) return null; return { id: row.id, documentId: row.document_id, blockKey: row.block_key, blockType: row.block_type, title: row.title, content: row.content, metadata: sanitizeBlockMetadata(parseJson(row.metadata, {})), createdAt: row.created_at, updatedAt: row.updated_at }; }
function toBlockVersion(row) { if (!row) return null; return { id: row.id, blockId: row.block_id, version: row.version, content: row.content, createdAt: row.created_at, createdBy: row.created_by, metadata: parseJson(row.metadata, {}) }; }
function parseAgentTypes(value) { if (Array.isArray(value)) return value; if (typeof value === 'string') { const parsed = parseJson(value, null); if (Array.isArray(parsed)) return parsed; } return undefined; }
function normalizeAgentTypes(value) { const source = parseAgentTypes(value); if (!Array.isArray(source)) return undefined; const normalized = source.map(v => String(v ?? '').trim().toLowerCase()).filter(v => ['master', 'worker', 'infra'].includes(v)); return normalized.length ? [...new Set(normalized)] : []; }
function toAssignment(row) { if (!row) return null; const metadata = parseJson(row.metadata, {}); const canonicalType = row.block_type || metadata.canonicalType || metadata.type || 'text'; const agentTypes = normalizeAgentTypes(metadata.agentTypes ?? metadata.agent_types); const nextMetadata = { ...metadata }; const parsedAgentTypes = parseAgentTypes(metadata.agentTypes ?? metadata.agent_types); if (parsedAgentTypes !== undefined) { nextMetadata.agentTypes = parsedAgentTypes; nextMetadata.agent_types = parsedAgentTypes; } return { id: row.id, documentId: row.document_id, blockId: row.block_id, blockType: canonicalType, canonicalType, autoInclude: !!row.auto_include, forceInclude: !!row.force_include, forcedPosition: row.forced_position, eligibility: nextMetadata.eligibility ?? nextMetadata.isEligible ?? null, transversal: nextMetadata.transversal ?? nextMetadata.isTransversal ?? null, agentTypes: agentTypes ?? undefined, metadata: nextMetadata, createdAt: row.created_at, updatedAt: row.updated_at }; }
function toBlockRef(row) { if (!row) return null; const metadata = parseJson(row.metadata, {}); const hasPinnedVersionMeta = Object.prototype.hasOwnProperty.call(metadata, 'pinnedBlockVersionId') || Object.prototype.hasOwnProperty.call(metadata, 'pinned_block_version_id'); const hasFollowCurrentMeta = Object.prototype.hasOwnProperty.call(metadata, 'followCurrent') || Object.prototype.hasOwnProperty.call(metadata, 'follow_current'); const followCurrentRaw = metadata.followCurrent ?? metadata.follow_current; const pinnedMeta = metadata.pinnedBlockVersionId ?? metadata.pinned_block_version_id; let followCurrent = hasFollowCurrentMeta ? !!followCurrentRaw : null; let pinnedBlockVersionId = pinnedMeta ?? null; const legacyPinned = row.block_version_id ?? null; if (followCurrent === true) pinnedBlockVersionId = null; else if (followCurrent === false && pinnedBlockVersionId == null) pinnedBlockVersionId = legacyPinned; else if (followCurrent == null) { if (pinnedBlockVersionId != null) followCurrent = false; else if (legacyPinned != null) { pinnedBlockVersionId = legacyPinned; followCurrent = false; } } if (followCurrent === true) followCurrent = true; else if (followCurrent === false) followCurrent = false; else followCurrent = null; return { id: row.id, documentId: row.document_id, blockId: row.block_id, blockVersionId: row.block_version_id, pinnedBlockVersionId: pinnedBlockVersionId ?? null, followCurrent, blockType: row.block_type, position: row.position, included: !!row.included, metadata, createdAt: row.created_at, updatedAt: row.updated_at }; }
function getLegacyAgentByUsernameAndId(username, agentId) { return getDb().prepare('SELECT * FROM agents WHERE username = ? AND id = ? LIMIT 1').get(username, agentId); }
function extractLegacySystemPrompt(agentData) { const parsed = parseJson(agentData, {}); if (typeof parsed === 'string') return parsed; if (parsed && typeof parsed === 'object') { const direct = parsed.systemPrompt ?? parsed.system_prompt ?? parsed.prompt ?? parsed.system_prompt_text; if (typeof direct === 'string') return direct; if (direct != null) return String(direct); } return ''; }
function parseCanonicalAgentPromptKey(key) { const match = /^agent:([^:]+):([^:]+)$/.exec(String(key ?? '')); if (!match) return null; return { username: match[1], agentId: match[2] }; }
function getPromptDocumentRowByKey(key) { return getDb().prepare('SELECT * FROM prompt_documents WHERE key = ? LIMIT 1').get(key); }
function ensureDocument(key, { title = '', content = '', createdBy = null, metadata = {} } = {}) { const db = getDb(); const existing = getPromptDocumentRowByKey(key); if (existing) return { ...toPromptDocument(existing), initialVersion: getCurrentPromptVersion(existing.id) }; const id = generateId('prompt_doc'); const versionId = generateId('prompt_ver'); const ts = nowSeconds(); const tx = db.transaction(() => { db.prepare('INSERT INTO prompt_documents (id, key, title, current_version_id, created_at, updated_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, key, title, versionId, ts, ts, JSON.stringify(metadata)); db.prepare('INSERT INTO prompt_versions (id, document_id, version, content, created_at, created_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(versionId, id, 1, content, ts, createdBy, JSON.stringify(metadata)); }); tx(); return { ...toPromptDocument(getPromptDocumentRowByKey(key)), initialVersion: toPromptVersion(db.prepare('SELECT * FROM prompt_versions WHERE id = ? LIMIT 1').get(versionId)) }; }
export function getPromptDocumentById(id) { return toPromptDocument(getDb().prepare('SELECT * FROM prompt_documents WHERE id = ? LIMIT 1').get(id)); }
function upsertBlockVersion(blockId, { content = '', createdBy = null, metadata = {} } = {}) { const db = getDb(); const nextVersion = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM prompt_block_versions WHERE block_id = ?').get(blockId).nextVersion; const versionId = generateId('prompt_block_ver'); const ts = nowSeconds(); db.prepare('INSERT INTO prompt_block_versions (id, block_id, version, content, created_at, created_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(versionId, blockId, nextVersion, content, ts, createdBy, JSON.stringify(metadata)); return toBlockVersion(db.prepare('SELECT * FROM prompt_block_versions WHERE id = ? LIMIT 1').get(versionId)); }
function getBlockCurrentVersion(blockId) { return toBlockVersion(getDb().prepare('SELECT * FROM prompt_block_versions WHERE block_id = ? ORDER BY version DESC, created_at DESC LIMIT 1').get(blockId)); }
function resolveCompositionRows(documentId) { const db = getDb(); const blocks = db.prepare('SELECT pb.*, pr.position AS ref_position, pr.included AS ref_included, pr.block_version_id AS ref_block_version_id FROM prompt_document_block_refs pr JOIN prompt_blocks pb ON pb.id = pr.block_id WHERE pr.document_id = ? ORDER BY COALESCE(pr.position, 0) ASC, pb.created_at ASC').all(documentId).map(row => ({ block: toBlock(row), ref: toBlockRef(row) })); const assignments = db.prepare('SELECT * FROM prompt_block_type_assignments WHERE document_id = ?').all(documentId).map(toAssignment); const assignmentByBlockId = new Map(assignments.map(a => [a.blockId, a])); return { blocks, assignmentByBlockId }; }
function assignmentTargetsAgentType(assignment, agentType) { const types = assignment?.agentTypes; if (!Array.isArray(types) || !types.length) return true; return types.includes(String(agentType ?? '').trim().toLowerCase()); }
function syncPromptDocumentBlockRefsFromAssignments(documentId, { materializeAutoInclude = true, materializeForceInclude = true, agentType = null, preserveExistingBlockVersionIds = true } = {}) { const db = getDb(); const refs = db.prepare('SELECT * FROM prompt_document_block_refs WHERE document_id = ?').all(documentId).map(toBlockRef); const assignments = db.prepare('SELECT * FROM prompt_block_type_assignments WHERE document_id = ?').all(documentId).map(toAssignment).filter(a => assignmentTargetsAgentType(a, agentType)); const byBlockId = new Map(assignments.map(a => [a.blockId, a])); const refByBlockId = new Map(refs.map(ref => [ref.blockId, ref])); const items = []; const seen = new Set(); for (const ref of refs.sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.blockId).localeCompare(String(b.blockId)))) { const assignment = byBlockId.get(ref.blockId) || null; items.push({ ref, assignment, existing: refByBlockId.get(ref.blockId) || null }); seen.add(ref.blockId); } for (const assignment of assignments) { if (seen.has(assignment.blockId)) continue; const block = db.prepare('SELECT * FROM prompt_blocks WHERE id = ? LIMIT 1').get(assignment.blockId); if (!block) continue; const existingVersion = getBlockCurrentVersion(block.id); const followCurrent = !preserveExistingBlockVersionIds; const pinnedBlockVersionId = followCurrent ? null : existingVersion?.id ?? null; const ref = { id: generateId('prompt_doc_block_ref'), documentId, blockId: block.id, blockVersionId: pinnedBlockVersionId, pinnedBlockVersionId, followCurrent, blockType: assignment.blockType ?? block.blockType ?? 'text', position: 0, included: false, metadata: followCurrent ? {} : { pinnedBlockVersionId } }; items.push({ ref, assignment, existing: null }); seen.add(assignment.blockId); }
const resolveIncluded = (ref, assignment, existing = null) => {
  const hasPersistedIncluded = !!existing && (Object.prototype.hasOwnProperty.call(existing, 'included') || Object.prototype.hasOwnProperty.call(existing?.metadata ?? {}, 'included'));
  const hasExplicitIncluded = hasPersistedIncluded && Object.prototype.hasOwnProperty.call(ref || {}, 'included');
  if (hasExplicitIncluded) return !!ref.included;
  const existingExplicitOptOut = !!existing && (existing.included === false || existing.metadata?.included === false);
  if (existingExplicitOptOut) return false;
  if (assignment?.forceInclude) return true;
  if (materializeAutoInclude && assignment?.autoInclude) return true;
  return existing ? !!ref.included : true;
};
const forcedItems = items.map((item, index) => ({ ...item, _index: index })).filter(item => materializeForceInclude && item.assignment?.forceInclude && item.assignment?.forcedPosition != null).sort((a, b) => (Number(a.assignment.forcedPosition) || 0) - (Number(b.assignment.forcedPosition) || 0) || a._index - b._index || String(a.ref.blockId).localeCompare(String(b.ref.blockId)));
const nonForcedItems = items.filter(item => !(materializeForceInclude && item.assignment?.forceInclude && item.assignment?.forcedPosition != null)).sort((a, b) => (a.ref.position ?? 0) - (b.ref.position ?? 0) || String(a.ref.blockId).localeCompare(String(b.ref.blockId)));
const ordered = [];
const addStable = item => { if (!ordered.some(existing => existing.ref.blockId === item.ref.blockId)) ordered.push(item); };
nonForcedItems.forEach(addStable);
for (const item of forcedItems) { const desired = Math.max(1, Number(item.assignment.forcedPosition) || 1); const index = Math.min(desired - 1, ordered.length); ordered.splice(index, 0, item); }
const deduped = [];
const seenBlocks = new Set();
for (const item of ordered) { if (seenBlocks.has(item.ref.blockId)) continue; seenBlocks.add(item.ref.blockId); deduped.push(item); }
const tx = db.transaction(() => { for (let i = 0; i < deduped.length; i++) { const item = deduped[i]; const ref = item.ref; const existing = refByBlockId.get(ref.blockId); const nextFollowCurrent = ref.followCurrent == null ? (existing?.followCurrent ?? existing?.metadata?.followCurrent ?? existing?.metadata?.follow_current ?? null) : !!ref.followCurrent; const nextPinnedBlockVersionId = nextFollowCurrent ? null : (ref.pinnedBlockVersionId ?? ref.blockVersionId ?? existing?.pinnedBlockVersionId ?? existing?.blockVersionId ?? null); const nextBlockVersionId = nextFollowCurrent ? null : nextPinnedBlockVersionId; const nextIncluded = resolveIncluded(ref, item.assignment, existing); const baseMetadata = { ...(existing ? parseJson(existing.metadata, {}) : {}), ...(ref.metadata ?? {}) }; const nextMetadata = { ...baseMetadata }; if (nextFollowCurrent === true) { delete nextMetadata.pinnedBlockVersionId; delete nextMetadata.pinned_block_version_id; nextMetadata.followCurrent = true; nextMetadata.follow_current = true; } else { if (nextPinnedBlockVersionId != null) { nextMetadata.pinnedBlockVersionId = nextPinnedBlockVersionId; nextMetadata.pinned_block_version_id = nextPinnedBlockVersionId; } else { delete nextMetadata.pinnedBlockVersionId; delete nextMetadata.pinned_block_version_id; } if (nextFollowCurrent === false) { nextMetadata.followCurrent = false; nextMetadata.follow_current = false; } else { delete nextMetadata.followCurrent; delete nextMetadata.follow_current; } } const payload = { block_version_id: nextBlockVersionId, block_type: ref.blockType ?? existing?.blockType ?? null, position: i + 1, included: nextIncluded ? 1 : 0, metadata: JSON.stringify(nextMetadata), updated_at: nowSeconds() }; if (existing) { db.prepare('UPDATE prompt_document_block_refs SET block_version_id = ?, block_type = ?, position = ?, included = ?, metadata = ?, updated_at = ? WHERE id = ?').run(payload.block_version_id, payload.block_type, payload.position, payload.included, payload.metadata, payload.updated_at, existing.id); } else { db.prepare('INSERT INTO prompt_document_block_refs (id, document_id, block_id, block_version_id, block_type, position, included, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(generateId('prompt_doc_block_ref'), documentId, ref.blockId, payload.block_version_id, payload.block_type, payload.position, payload.included, payload.metadata, payload.updated_at, payload.updated_at); } } }); tx(); return listPromptDocumentBlockRefs(documentId); }

function migrateLegacyPromptBlockTypeAssignmentsIfNeeded(documentId) { const db = getDb(); const doc = db.prepare('SELECT * FROM prompt_documents WHERE id = ? LIMIT 1').get(documentId); if (!doc) return { migrated: false, reason: 'missing-document' }; const metadata = parseJson(doc.metadata, {}); if (metadata?.source !== 'legacy-agent-bootstrap') return { migrated: false, reason: 'not-legacy-bootstrap' }; const refs = db.prepare('SELECT * FROM prompt_document_block_refs WHERE document_id = ?').all(documentId).map(toBlockRef); const assignments = db.prepare('SELECT * FROM prompt_block_type_assignments WHERE document_id = ?').all(documentId).map(toAssignment); if (!refs.length) return { migrated: false, reason: 'no-refs' }; const byBlockId = new Map(assignments.map(a => [String(a.blockId), a])); let createdAssignments = 0; let skippedExistingAssignments = 0; const ts = nowSeconds(); const tx = db.transaction(() => { for (const ref of refs) { if (!ref || !ref.blockId) continue; const blockId = String(ref.blockId); const existing = byBlockId.get(blockId) || null; const block = db.prepare('SELECT * FROM prompt_blocks WHERE id = ? LIMIT 1').get(ref.blockId); if (!block) continue; const blockType = ref.blockType || block.block_type || block.blockType || 'text'; const nextMetadata = { canonicalType: blockType, type: blockType, source: 'legacy-agent-bootstrap-migrated', migrationSource: 'prompt_document_block_refs', migratedFromLegacySource: true, migratedAt: ts }; if (existing) { skippedExistingAssignments += 1; continue; } db.prepare('INSERT INTO prompt_block_type_assignments (id, document_id, block_id, block_type, auto_include, force_include, forced_position, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(generateId('prompt_assign'), documentId, ref.blockId, blockType, ref.included ? 1 : 0, 0, null, JSON.stringify(nextMetadata), ts, ts); createdAssignments += 1; } }); tx(); if (createdAssignments === 0) return { migrated: false, reason: skippedExistingAssignments ? 'no-new-assignments-inserted' : 'no-eligible-refs', createdAssignments, skippedExistingAssignments }; return { migrated: true, createdAssignments, skippedExistingAssignments }; }
function buildPromptResolvedSnapshotSummary(resolved = {}, documentId = null) { const allRefs = Array.isArray(resolved?.refs) ? resolved.refs : []; const includedRefs = Array.isArray(resolved?.includedRefs) ? resolved.includedRefs : []; const blocks = Array.isArray(resolved?.blocks) ? resolved.blocks : []; return { documentId: documentId ?? null, refs: allRefs.map(ref => ({ blockId: ref?.blockId ?? null, refId: ref?.id ?? null, included: !!ref?.included, position: ref?.position ?? null, followCurrent: ref?.followCurrent ?? null, pinnedBlockVersionId: ref?.pinnedBlockVersionId ?? ref?.blockVersionId ?? null, blockVersionId: ref?.blockVersionId ?? ref?.pinnedBlockVersionId ?? null, blockType: ref?.blockType ?? null })), blocks: blocks.map(item => ({ blockId: item?.block?.id ?? null, refId: item?.ref?.id ?? null, versionId: item?.version?.id ?? null, versionNumber: item?.version?.version ?? null, included: !!item?.ref?.included, position: item?.ref?.position ?? null, blockType: item?.block?.blockType ?? item?.ref?.blockType ?? null, content: item?.content ?? '' })), assignments: { total: Array.isArray(resolved?.assignments) ? resolved.assignments.length : 0, allowed: Array.isArray(resolved?.allowedAssignments) ? resolved.allowedAssignments.length : 0, included: includedRefs.length, rendered: blocks.length, allRefs: allRefs.length } }; }
function mergePromptVersionMetadata(baseMetadata = {}, resolvedSnapshot = null) { const next = { ...(baseMetadata && typeof baseMetadata === 'object' && !Array.isArray(baseMetadata) ? baseMetadata : {}) }; if (resolvedSnapshot) next.resolvedSnapshot = resolvedSnapshot; next.compositionResolved = true; return next; }
function resolvePromptFinalByComposition(documentId, { agentType = null } = {}) { const db = getDb(); migrateLegacyPromptBlockTypeAssignmentsIfNeeded(documentId); syncPromptDocumentBlockRefsFromAssignments(documentId, { agentType, preserveExistingBlockVersionIds: true }); const document = getPromptDocumentById(documentId); const assignments = db.prepare('SELECT * FROM prompt_block_type_assignments WHERE document_id = ?').all(documentId).map(toAssignment); const allowedAssignments = assignments.filter(a => assignmentTargetsAgentType(a, agentType)); const allowedBlockIds = new Set(allowedAssignments.map(a => String(a.blockId))); const allRefs = listPromptDocumentBlockRefs(documentId); const refs = allRefs.filter(ref => ref.included).filter(ref => allowedBlockIds.has(String(ref.blockId))).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.blockId).localeCompare(String(b.blockId))); const stable = refs.map(ref => { const blockRow = db.prepare('SELECT * FROM prompt_blocks WHERE id = ? LIMIT 1').get(ref.blockId); return { block: toBlock(blockRow), ref }; }).filter(({ block }) => !!block); const assignmentByBlockId = new Map(allowedAssignments.map(a => [a.blockId, a])); const renderedBlocks = stable.map(({ block, ref }) => { const versionId = ref.followCurrent ? null : (ref.pinnedBlockVersionId ?? ref.blockVersionId ?? null); const version = versionId ? toBlockVersion(db.prepare('SELECT * FROM prompt_block_versions WHERE id = ? LIMIT 1').get(versionId)) : getBlockCurrentVersion(block.id); return { block, ref, version, content: version?.content ?? block.content ?? '' }; }); let rendered = renderedBlocks.map(item => item.content).join('\n\n'); if (!rendered && document?.id && document.key !== GLOBAL_PROMPT_DOCUMENT_KEY) { const effective = resolveEffectivePromptForAgentDocument(document, { agentType }); if (effective?.content) { rendered = effective.content; } } return { content: rendered, assignments, allowedAssignments, refs: allRefs, includedRefs: refs, blocks: renderedBlocks.map(item => ({ block: item.block, ref: item.ref, version: item.version, assignment: assignmentByBlockId.get(item.ref.blockId) || null })) }; }
function publishResolvedSnapshot(documentId, { createdBy = null, metadata = {}, agentType = null } = {}) { const db = getDb(); const resolved = resolvePromptFinalByComposition(documentId, { agentType }); const resolvedSnapshot = buildPromptResolvedSnapshotSummary(resolved, documentId); const nextVersion = db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM prompt_versions WHERE document_id = ?').get(documentId).nextVersion; const versionId = generateId('prompt_ver'); const ts = nowSeconds(); db.prepare('INSERT INTO prompt_versions (id, document_id, version, content, created_at, created_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(versionId, documentId, nextVersion, resolved.content, ts, createdBy, JSON.stringify(mergePromptVersionMetadata(metadata, resolvedSnapshot))); db.prepare('UPDATE prompt_documents SET current_version_id = ?, updated_at = ? WHERE id = ?').run(versionId, ts, documentId); return { version: toPromptVersion(db.prepare('SELECT * FROM prompt_versions WHERE id = ? LIMIT 1').get(versionId)), resolved }; }
function upsertAssignment(documentId, blockId, data = {}) { const db = getDb(); const existing = db.prepare('SELECT * FROM prompt_block_type_assignments WHERE document_id = ? AND block_id = ? LIMIT 1').get(documentId, blockId); const ts = nowSeconds(); const metadata = data.metadata ?? (existing ? parseJson(existing.metadata, {}) : {}); const prevMeta = existing ? parseJson(existing.metadata, {}) : {}; const incomingAgentTypes = normalizeAgentTypes(data.agentTypes ?? data.agent_types ?? metadata.agentTypes ?? metadata.agent_types ?? prevMeta.agentTypes ?? prevMeta.agent_types); const canonicalType = metadata.canonicalType ?? data.blockType ?? metadata.type ?? existing?.block_type ?? 'text'; const nextMetadata = { ...metadata, canonicalType, type: canonicalType, eligibility: metadata.eligibility ?? metadata.isEligible ?? prevMeta.eligibility ?? prevMeta.isEligible ?? null, transversal: metadata.transversal ?? metadata.isTransversal ?? prevMeta.transversal ?? prevMeta.isTransversal ?? null, source: metadata.source || prevMeta.source || 'canonical-assignment' }; if (incomingAgentTypes !== undefined) { nextMetadata.agentTypes = incomingAgentTypes; nextMetadata.agent_types = incomingAgentTypes; } if (existing) { db.prepare('UPDATE prompt_block_type_assignments SET block_type = ?, auto_include = ?, force_include = ?, forced_position = ?, metadata = ?, updated_at = ? WHERE id = ?').run(canonicalType, data.autoInclude ?? existing.auto_include, data.forceInclude ?? existing.force_include, data.forcedPosition ?? existing.forced_position, JSON.stringify(nextMetadata), ts, existing.id); return toAssignment(db.prepare('SELECT * FROM prompt_block_type_assignments WHERE id = ? LIMIT 1').get(existing.id)); } const id = generateId('prompt_assign'); db.prepare('INSERT INTO prompt_block_type_assignments (id, document_id, block_id, block_type, auto_include, force_include, forced_position, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, documentId, blockId, canonicalType, data.autoInclude ?? 1, data.forceInclude ?? 0, data.forcedPosition ?? null, JSON.stringify(nextMetadata), ts, ts); return toAssignment(db.prepare('SELECT * FROM prompt_block_type_assignments WHERE id = ? LIMIT 1').get(id)); }
function upsertBlockRef(documentId, blockId, data = {}) { const db = getDb(); const existing = db.prepare('SELECT * FROM prompt_document_block_refs WHERE document_id = ? AND block_id = ? LIMIT 1').get(documentId, blockId); const ts = nowSeconds(); const hasIncluded = Object.prototype.hasOwnProperty.call(data, 'included'); const nextIncluded = hasIncluded ? !!data.included : (existing ? !!existing.included : true); const baseMetadata = { ...(existing ? parseJson(existing.metadata, {}) : {}), ...(data.metadata ?? {}) }; const followsCurrent = Object.prototype.hasOwnProperty.call(data, 'followCurrent') ? !!data.followCurrent : (data.blockVersionId == null && data.pinnedBlockVersionId == null ? (existing?.followCurrent ?? null) : null); const nextFollowCurrent = followsCurrent === true ? true : followsCurrent === false ? false : (existing?.followCurrent ?? null); const nextPinnedBlockVersionId = nextFollowCurrent === true ? null : (data.pinnedBlockVersionId ?? data.blockVersionId ?? existing?.pinnedBlockVersionId ?? existing?.blockVersionId ?? null); const nextBlockVersionId = nextFollowCurrent === true ? null : nextPinnedBlockVersionId; const nextMetadata = { ...baseMetadata }; if (hasIncluded) nextMetadata.included = nextIncluded; if (nextFollowCurrent === true) { delete nextMetadata.pinnedBlockVersionId; delete nextMetadata.pinned_block_version_id; nextMetadata.followCurrent = true; nextMetadata.follow_current = true; } else { if (nextPinnedBlockVersionId != null) { nextMetadata.pinnedBlockVersionId = nextPinnedBlockVersionId; nextMetadata.pinned_block_version_id = nextPinnedBlockVersionId; } else { delete nextMetadata.pinnedBlockVersionId; delete nextMetadata.pinned_block_version_id; } if (nextFollowCurrent === false) { nextMetadata.followCurrent = false; nextMetadata.follow_current = false; } else { delete nextMetadata.followCurrent; delete nextMetadata.follow_current; } } if (existing) { db.prepare('UPDATE prompt_document_block_refs SET block_version_id = ?, block_type = ?, position = ?, included = ?, metadata = ?, updated_at = ? WHERE id = ?').run(nextBlockVersionId, data.blockType ?? existing.block_type, data.position ?? existing.position, nextIncluded ? 1 : 0, JSON.stringify(nextMetadata), ts, existing.id); return toBlockRef(db.prepare('SELECT * FROM prompt_document_block_refs WHERE id = ? LIMIT 1').get(existing.id)); } const id = generateId('prompt_doc_block_ref'); db.prepare('INSERT INTO prompt_document_block_refs (id, document_id, block_id, block_version_id, block_type, position, included, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, documentId, blockId, nextBlockVersionId, data.blockType ?? null, data.position ?? 0, nextIncluded ? 1 : 0, JSON.stringify(nextMetadata), ts, ts); return toBlockRef(db.prepare('SELECT * FROM prompt_document_block_refs WHERE id = ? LIMIT 1').get(id)); }

export function reorderPromptDocumentBlockRefs(documentId, orderedBlockIds = []) { const db = getDb(); const normalizedIds = orderedBlockIds.map(id => String(id ?? '').trim()).filter(Boolean); const uniqueIds = new Set(normalizedIds); if (uniqueIds.size !== normalizedIds.length) return { error: 'duplicate blockIds are not allowed' }; const refs = listPromptDocumentBlockRefs(documentId); const refByBlockId = new Map(refs.map(ref => [String(ref.blockId), ref])); for (const blockId of normalizedIds) { if (!refByBlockId.has(blockId)) return { error: `Unknown blockId '${blockId}' for the resolved prompt document refs.` }; } const remaining = refs.map(ref => String(ref.blockId)).filter(blockId => !uniqueIds.has(blockId)); const nextOrder = [...normalizedIds, ...remaining]; const ts = nowSeconds(); const tx = db.transaction(() => { nextOrder.forEach((blockId, index) => { const ref = refByBlockId.get(blockId); db.prepare('UPDATE prompt_document_block_refs SET position = ?, updated_at = ? WHERE id = ?').run(index + 1, ts, ref.id); }); }); tx(); return { refs: listPromptDocumentBlockRefs(documentId) }; }

export function setPromptBlockRefs(documentId, refs = []) { const db = getDb(); const documentBlocks = listPromptBlocks(documentId); const documentBlockIds = new Set(documentBlocks.map(block => String(block.id))); const normalizedRefs = Array.isArray(refs) ? refs.map((ref, index) => ({ ...(ref && typeof ref === 'object' ? ref : {}), blockId: String(ref?.blockId ?? '').trim(), _index: index })).filter(ref => ref.blockId) : []; const seen = new Set(); for (const ref of normalizedRefs) { if (seen.has(ref.blockId)) return { error: 'duplicate blockIds are not allowed' }; if (!documentBlockIds.has(ref.blockId)) return { error: `Unknown blockId '${ref.blockId}' for the resolved prompt document.` }; seen.add(ref.blockId); } const currentRefs = listPromptDocumentBlockRefs(documentId); const currentByBlockId = new Map(currentRefs.map(ref => [String(ref.blockId), ref])); const nextByBlockId = new Map(); for (const ref of normalizedRefs) { const existing = currentByBlockId.get(ref.blockId) || null; const hasIncluded = Object.prototype.hasOwnProperty.call(ref, 'included'); const hasPosition = Object.prototype.hasOwnProperty.call(ref, 'position'); const hasFollowCurrent = Object.prototype.hasOwnProperty.call(ref, 'followCurrent'); const baseMetadata = { ...(existing ? parseJson(existing.metadata, {}) : {}), ...(ref.metadata && typeof ref.metadata === 'object' && !Array.isArray(ref.metadata) ? ref.metadata : {}) }; const nextFollowCurrent = hasFollowCurrent ? !!ref.followCurrent : (existing?.followCurrent ?? existing?.metadata?.followCurrent ?? existing?.metadata?.follow_current ?? null); const nextPinnedBlockVersionId = nextFollowCurrent === true ? null : (ref.blockVersionId ?? existing?.pinnedBlockVersionId ?? existing?.blockVersionId ?? null); const nextBlockVersionId = nextFollowCurrent === true ? null : nextPinnedBlockVersionId; const nextIncluded = hasIncluded ? !!ref.included : (existing ? !!existing.included : true); const nextMetadata = { ...baseMetadata }; if (hasFollowCurrent) { if (nextFollowCurrent === true) { delete nextMetadata.pinnedBlockVersionId; delete nextMetadata.pinned_block_version_id; nextMetadata.followCurrent = true; nextMetadata.follow_current = true; } else { if (nextPinnedBlockVersionId != null) { nextMetadata.pinnedBlockVersionId = nextPinnedBlockVersionId; nextMetadata.pinned_block_version_id = nextPinnedBlockVersionId; } else { delete nextMetadata.pinnedBlockVersionId; delete nextMetadata.pinned_block_version_id; } nextMetadata.followCurrent = false; nextMetadata.follow_current = false; } } else if (nextFollowCurrent === true) { delete nextMetadata.pinnedBlockVersionId; delete nextMetadata.pinned_block_version_id; nextMetadata.followCurrent = true; nextMetadata.follow_current = true; } else if (nextFollowCurrent === false) { if (nextPinnedBlockVersionId != null) { nextMetadata.pinnedBlockVersionId = nextPinnedBlockVersionId; nextMetadata.pinned_block_version_id = nextPinnedBlockVersionId; } else { delete nextMetadata.pinnedBlockVersionId; delete nextMetadata.pinned_block_version_id; } nextMetadata.followCurrent = false; nextMetadata.follow_current = false; } if (hasPosition) nextMetadata.position = ref.position; nextByBlockId.set(ref.blockId, { existing, payload: { block_version_id: nextBlockVersionId, block_type: ref.blockType ?? existing?.blockType ?? null, position: hasPosition ? ref.position : null, included: nextIncluded ? 1 : 0, metadata: JSON.stringify(nextMetadata), updated_at: nowSeconds(), }, }); } const remaining = currentRefs.map(ref => String(ref.blockId)).filter(blockId => !nextByBlockId.has(blockId)); const tx = db.transaction(() => { normalizedRefs.forEach((ref, index) => { const current = nextByBlockId.get(ref.blockId); if (!current) return; const position = ref.position != null ? ref.position : index + 1; if (current.existing) { db.prepare('UPDATE prompt_document_block_refs SET block_version_id = ?, block_type = ?, position = ?, included = ?, metadata = ?, updated_at = ? WHERE id = ?').run(current.payload.block_version_id, current.payload.block_type, position, current.payload.included, current.payload.metadata, current.payload.updated_at, current.existing.id); } else { db.prepare('INSERT INTO prompt_document_block_refs (id, document_id, block_id, block_version_id, block_type, position, included, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(generateId('prompt_doc_block_ref'), documentId, ref.blockId, current.payload.block_version_id, current.payload.block_type, position, current.payload.included, current.payload.metadata, current.payload.updated_at, current.payload.updated_at); } }); for (const blockId of remaining) { const ref = currentByBlockId.get(blockId); if (!ref) continue; db.prepare('DELETE FROM prompt_document_block_refs WHERE id = ?').run(ref.id); } }); tx(); return { refs: listPromptDocumentBlockRefs(documentId) }; }

export function getCurrentPromptVersion(documentId) { return toPromptVersion(getDb().prepare('SELECT pv.* FROM prompt_documents pd JOIN prompt_versions pv ON pv.id = pd.current_version_id WHERE pd.id = ? LIMIT 1').get(documentId)); }
export function getOrBootstrapGlobalPromptDocument() { return ensureDocument(GLOBAL_PROMPT_DOCUMENT_KEY, { title: 'Global Prompt Document', content: '', createdBy: null, metadata: { scope: 'global', canonical: true } }); }
export function getOrBootstrapPromptDocumentByAgent({ username, agentId }) { const agent = getLegacyAgentByUsernameAndId(username, agentId); if (!agent) return null; return ensureDocument(derivePromptKeyForAgent(agent), { title: agent.name ? String(agent.name) : '', content: extractLegacySystemPrompt(agent.data), createdBy: agentId, metadata: { source: 'legacy-agent-bootstrap', username: String(username), agentId: String(agentId) } }); }
export function getPromptDocumentByKey(key) { const existing = toPromptDocument(getDb().prepare('SELECT * FROM prompt_documents WHERE key = ? LIMIT 1').get(key)); if (existing) return existing; const canonical = parseCanonicalAgentPromptKey(key); if (!canonical) return null; const legacyAgent = getLegacyAgentByUsernameAndId(canonical.username, canonical.agentId); if (!legacyAgent) return null; return getOrBootstrapPromptDocumentByAgent({ username: legacyAgent.username, agentId: legacyAgent.id }); }
export function getPromptDocumentByKeyNoBootstrap(key) { return toPromptDocument(getDb().prepare('SELECT * FROM prompt_documents WHERE key = ? LIMIT 1').get(key)); }
export function getPromptDocumentWithCurrentVersionByAgent({ username, agentId, bootstrap = false }) { const document = bootstrap ? getOrBootstrapPromptDocumentByAgent({ username, agentId }) : getPromptDocumentByKeyNoBootstrap(derivePromptKeyForAgent({ username, id: agentId })); return { document: document || null, currentVersion: document?.id ? getCurrentPromptVersion(document.id) : null }; }
export function createPromptDocument({ key, title = '', content = '', metadata = {}, createdBy = null } = {}) { return ensureDocument(key, { title, content, metadata, createdBy }); }
export function upsertPromptDocument({ documentId = null, key = '', title, content, metadata, createdBy = null } = {}) { const db = getDb(); const normalizedDocumentId = String(documentId || '').trim(); const normalizedKey = String(key || '').trim(); let existing = null; if (normalizedDocumentId) existing = getPromptDocumentById(normalizedDocumentId); if (!existing && normalizedKey) existing = getPromptDocumentByKeyNoBootstrap(normalizedKey); if (!existing) { if (!normalizedKey) return null; return ensureDocument(normalizedKey, { title: title ?? '', content: content ?? '', metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}, createdBy }); } const nextTitle = title !== undefined ? String(title ?? '') : existing.title; const nextMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : existing.metadata || {}; const ts = nowSeconds(); db.prepare('UPDATE prompt_documents SET title = ?, metadata = ?, updated_at = ? WHERE id = ?').run(nextTitle, JSON.stringify(nextMetadata), ts, existing.id); if (content !== undefined) createPromptVersion(existing.id, { content: String(content ?? ''), createdBy, metadata: nextMetadata }); return getPromptDocumentById(existing.id); }
export function listPromptDocuments() { return getDb().prepare('SELECT * FROM prompt_documents ORDER BY updated_at DESC, created_at DESC').all().map(toPromptDocument); }
export function listPromptVersions(documentId) { return getDb().prepare('SELECT * FROM prompt_versions WHERE document_id = ? ORDER BY version DESC, created_at DESC').all(documentId).map(toPromptVersion); }
export function createPromptVersion(documentId, { content = '', createdBy = null, metadata = {} } = {}) { const doc = getPromptDocumentById(documentId); if (!doc) return null; const nextVersion = getDb().prepare('SELECT COALESCE(MAX(version), 0) + 1 AS nextVersion FROM prompt_versions WHERE document_id = ?').get(documentId).nextVersion; const versionId = generateId('prompt_ver'); const ts = nowSeconds(); getDb().prepare('INSERT INTO prompt_versions (id, document_id, version, content, created_at, created_by, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)').run(versionId, documentId, nextVersion, content, ts, createdBy, JSON.stringify(metadata)); getDb().prepare('UPDATE prompt_documents SET current_version_id = ?, updated_at = ? WHERE id = ?').run(versionId, ts, documentId); return toPromptVersion(getDb().prepare('SELECT * FROM prompt_versions WHERE id = ?').get(versionId)); }
export function rollbackPromptVersion(documentId, versionId) { const version = getDb().prepare('SELECT * FROM prompt_versions WHERE id = ? AND document_id = ? LIMIT 1').get(versionId, documentId); if (!version) return null; const ts = nowSeconds(); getDb().prepare('UPDATE prompt_documents SET current_version_id = ?, updated_at = ? WHERE id = ?').run(versionId, ts, documentId); return { document: getPromptDocumentById(documentId), currentVersion: toPromptVersion(version) }; }
export function createPromptBlock(documentId, { blockKey, blockType = 'text', title = '', content = '', metadata = {} } = {}) { const db = getDb(); const id = generateId('prompt_block'); const ts = nowSeconds(); const sanitizedMetadata = sanitizeBlockMetadata(metadata); db.prepare('INSERT INTO prompt_blocks (id, document_id, block_key, block_type, title, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, documentId, blockKey, blockType, title, content, JSON.stringify(sanitizedMetadata), ts, ts); const block = toBlock(db.prepare('SELECT * FROM prompt_blocks WHERE id = ? LIMIT 1').get(id)); const version = upsertBlockVersion(id, { content, metadata: sanitizedMetadata }); return { block, version }; }
export function createPromptBlockVersion(blockId, payload = {}) { const nextPayload = { ...payload, metadata: sanitizeBlockMetadata(payload?.metadata || {}) }; const version = upsertBlockVersion(blockId, nextPayload); if (!version) return version; const db = getDb(); const ts = nowSeconds(); // Reancora refs pinados para a nova versão criada, preservando a versão fixada como referência explícita no documento.
 db.prepare("UPDATE prompt_document_block_refs SET block_version_id = ?, metadata = json_set(COALESCE(metadata, '{}'), '$.pinnedBlockVersionId', ?, '$.pinned_block_version_id', ?), updated_at = ? WHERE block_id = ? AND (follow_current IS NULL OR follow_current = 0)").run(version.id, version.id, version.id, ts, blockId); return version; }
export function listPromptBlocks(documentId) { return getDb().prepare('SELECT * FROM prompt_blocks WHERE document_id = ? ORDER BY updated_at DESC, created_at DESC').all(documentId).map(toBlock); }
export function findPromptBlockById(blockId) { return toBlock(getDb().prepare('SELECT * FROM prompt_blocks WHERE id = ? LIMIT 1').get(blockId)); }
export function listPromptBlockVersions(blockId) { return getDb().prepare('SELECT * FROM prompt_block_versions WHERE block_id = ? ORDER BY version DESC, created_at DESC').all(blockId).map(toBlockVersion); }
export function deletePromptBlock(documentId, blockId) { const db = getDb(); const tx = db.transaction(() => { const block = db.prepare('SELECT * FROM prompt_blocks WHERE id = ? AND document_id = ? LIMIT 1').get(blockId, documentId); if (!block) return null; db.prepare('DELETE FROM prompt_document_block_refs WHERE document_id = ? AND block_id = ?').run(documentId, blockId); db.prepare('DELETE FROM prompt_block_type_assignments WHERE document_id = ? AND block_id = ?').run(documentId, blockId); db.prepare('UPDATE prompt_documents SET updated_at = ? WHERE id = ?').run(nowSeconds(), documentId); db.prepare('DELETE FROM prompt_block_versions WHERE block_id = ?').run(blockId); db.prepare('DELETE FROM prompt_blocks WHERE id = ? AND document_id = ?').run(blockId, documentId); return { deleted: true, blockId: String(blockId), documentId: String(documentId) }; }); return tx(); }
export function upsertPromptBlockTypeAssignment(documentId, blockId, data = {}) { return upsertAssignment(documentId, blockId, data); }
export function deletePromptBlockTypeAssignments(documentId, { blockIds = null, orphanOnly = false } = {}) {
  const db = getDb();
  const normalizedDocumentId = String(documentId ?? '').trim();
  if (!normalizedDocumentId) return { deleted: 0, documentId: null, blockIds: [], orphanOnly: !!orphanOnly };
  const normalizedBlockIds = Array.isArray(blockIds) ? [...new Set(blockIds.map(id => String(id ?? '').trim()).filter(Boolean))] : [];
  const hasExplicitBlockIds = normalizedBlockIds.length > 0;
  const refs = listPromptDocumentBlockRefs(normalizedDocumentId);
  const refBlockIds = new Set(refs.map(ref => String(ref.blockId)));
  const assignments = listPromptBlockTypeAssignments(normalizedDocumentId);
  const targetAssignments = assignments.filter((assignment) => {
    const blockId = String(assignment?.blockId ?? '').trim();
    if (!blockId) return false;
    if (hasExplicitBlockIds && !normalizedBlockIds.includes(blockId)) return false;
    if (orphanOnly && refBlockIds.has(blockId)) return false;
    return true;
  });
  if (!targetAssignments.length) return { deleted: 0, documentId: normalizedDocumentId, blockIds: [], orphanOnly: !!orphanOnly };
  const targetBlockIds = [...new Set(targetAssignments.map(a => String(a.blockId)).filter(Boolean))];
  const ts = nowSeconds();
  const tx = db.transaction(() => {
    for (const blockId of targetBlockIds) db.prepare('DELETE FROM prompt_block_type_assignments WHERE document_id = ? AND block_id = ?').run(normalizedDocumentId, blockId);
    db.prepare('UPDATE prompt_documents SET updated_at = ? WHERE id = ?').run(ts, normalizedDocumentId);
  });
  tx();
  return { deleted: targetBlockIds.length, documentId: normalizedDocumentId, blockIds: targetBlockIds, orphanOnly: !!orphanOnly };
}

function findAssignmentDriftIssues(documentId) {
  const normalizedDocumentId = String(documentId ?? '').trim();
  if (!normalizedDocumentId) return { documentId: null, assignmentsWithoutRef: [], incoherentIncludedRefs: [], recommendations: [], totalAssignments: 0, totalRefs: 0 };
  const assignments = listPromptBlockTypeAssignments(normalizedDocumentId);
  const refs = listPromptDocumentBlockRefs(normalizedDocumentId);
  const refByBlockId = new Map(refs.map(ref => [String(ref.blockId), ref]));
  const assignmentByBlockId = new Map(assignments.map(assignment => [String(assignment.blockId), assignment]));
  const assignmentsWithoutRef = assignments.filter(assignment => !refByBlockId.has(String(assignment.blockId))).map(assignment => ({
    assignmentId: assignment.id,
    blockId: assignment.blockId,
    blockType: assignment.blockType,
    autoInclude: !!assignment.autoInclude,
    forceInclude: !!assignment.forceInclude,
    forcedPosition: assignment.forcedPosition ?? null,
  }));
  const incoherentIncludedRefs = refs.filter(ref => {
    const assignment = assignmentByBlockId.get(String(ref.blockId)) || null;
    return !!ref.included && !!assignment && assignment.forceInclude === false && assignment.autoInclude === false;
  }).map(ref => ({
    refId: ref.id,
    blockId: ref.blockId,
    included: !!ref.included,
    position: ref.position ?? null,
    blockType: ref.blockType ?? null,
    assignmentId: assignmentByBlockId.get(String(ref.blockId))?.id ?? null,
    assignmentAutoInclude: assignmentByBlockId.get(String(ref.blockId)) ? !!assignmentByBlockId.get(String(ref.blockId)).autoInclude : null,
    assignmentForceInclude: assignmentByBlockId.get(String(ref.blockId)) ? !!assignmentByBlockId.get(String(ref.blockId)).forceInclude : null,
  }));
  const recommendations = [];
  if (assignmentsWithoutRef.length) recommendations.push('Use deletePromptBlockTypeAssignments(..., { orphanOnly: true }) to remove orphan assignments that no longer have matching refs.');
  if (incoherentIncludedRefs.length) recommendations.push('Review the included refs whose assignments are not auto-include/force-include; they may need explicit ref or assignment reconciliation.');
  if (!recommendations.length) recommendations.push('No drift detected between prompt block type assignments and refs.');
  return { documentId: normalizedDocumentId, assignmentsWithoutRef, incoherentIncludedRefs, recommendations, totalAssignments: assignments.length, totalRefs: refs.length };
}

export function inspectPromptBlockAssignmentDrift(documentId) {
  return findAssignmentDriftIssues(documentId);
}

export function reconcilePromptBlockAssignmentDrift(documentId, { deleteOrphans = true, fixIncludedRefs = true } = {}) {
  const normalizedDocumentId = String(documentId ?? '').trim();
  if (!normalizedDocumentId) return { documentId: null, inspected: null, deletedAssignments: { deleted: 0, documentId: null, blockIds: [], orphanOnly: false }, fixedRefs: 0, recommendations: [] };
  const inspected = findAssignmentDriftIssues(normalizedDocumentId);
  let deletedAssignments = { deleted: 0, documentId: normalizedDocumentId, blockIds: [], orphanOnly: true };
  if (deleteOrphans && inspected.assignmentsWithoutRef.length) {
    deletedAssignments = deletePromptBlockTypeAssignments(normalizedDocumentId, { blockIds: inspected.assignmentsWithoutRef.map(item => item.blockId), orphanOnly: true });
  }
  let fixedRefs = 0;
  if (fixIncludedRefs && inspected.incoherentIncludedRefs.length) {
    // Este ramo apenas reporta o drift identificado; não altera persistência de refs incluídos para evitar reconciliação implícita.
    fixedRefs = 0;
  }
  const recommendations = [...inspected.recommendations];
  if (deleteOrphans && inspected.assignmentsWithoutRef.length) recommendations.unshift(`Deleted ${deletedAssignments.deleted} orphan assignment(s).`);
  if (fixIncludedRefs && inspected.incoherentIncludedRefs.length) recommendations.push('Included refs remain unchanged; update them explicitly if their assignment state should differ.');
  return { documentId: normalizedDocumentId, inspected, deletedAssignments, fixedRefs, recommendations };
}
export function listPromptBlockTypeAssignments(documentId) { return getDb().prepare('SELECT * FROM prompt_block_type_assignments WHERE document_id = ? ORDER BY forced_position ASC, created_at ASC').all(documentId).map(toAssignment); }
export function getPromptBlockTypeAssignment(documentId, blockId) { return toAssignment(getDb().prepare('SELECT * FROM prompt_block_type_assignments WHERE document_id = ? AND block_id = ? LIMIT 1').get(documentId, blockId)); }
function rebuildPromptDocumentBlockRefs(documentId, { preferForcePosition = true } = {}) { const db = getDb(); const refs = db.prepare('SELECT * FROM prompt_document_block_refs WHERE document_id = ?').all(documentId).map(toBlockRef); const assignments = db.prepare('SELECT * FROM prompt_block_type_assignments WHERE document_id = ?').all(documentId).map(toAssignment); const byBlockId = new Map(assignments.map(a => [a.blockId, a])); const forceRefs = refs.filter(ref => { const a = byBlockId.get(ref.blockId); return a?.forceInclude && a.forcedPosition != null; }).sort((a, b) => (byBlockId.get(a.blockId).forcedPosition ?? a.position ?? 0) - (byBlockId.get(b.blockId).forcedPosition ?? b.position ?? 0)); const rest = refs.filter(ref => !forceRefs.some(fr => fr.blockId === ref.blockId)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)); const merged = []; const seen = new Set(); let cursor = 1; const append = (ref, position) => { if (seen.has(ref.blockId)) return; seen.add(ref.blockId); merged.push({ ref, position }); }; for (const ref of rest) append(ref, cursor++); for (const ref of forceRefs) { const forced = byBlockId.get(ref.blockId)?.forcedPosition; const desired = preferForcePosition && Number.isFinite(forced) ? Math.max(1, forced) : cursor; const insertionIndex = Math.min(Math.max(0, desired - 1), merged.length); merged.splice(insertionIndex, 0, { ref, position: desired }); for (let i = insertionIndex + 1; i < merged.length; i++) merged[i].position = i + 1; cursor = merged.length + 1; } const tx = db.transaction(() => { for (let i = 0; i < merged.length; i++) { const { ref } = merged[i]; db.prepare('UPDATE prompt_document_block_refs SET position = ?, updated_at = ? WHERE id = ?').run(i + 1, nowSeconds(), ref.id); } }); tx(); return listPromptDocumentBlockRefs(documentId); } export function upsertPromptDocumentBlockRefWithoutSync(documentId, blockId, data = {}) { return upsertBlockRef(documentId, blockId, data); }
export function syncPromptDocumentBlockRefs(documentId, options = {}) { return syncPromptDocumentBlockRefsFromAssignments(documentId, options); }
export function upsertPromptDocumentBlockRef(documentId, blockId, data = {}) { const ref = upsertBlockRef(documentId, blockId, data); syncPromptDocumentBlockRefsFromAssignments(documentId); return ref; }
export function setPromptDocumentBlockRefs(documentId, refs = []) { return setPromptBlockRefs(documentId, refs); }
export function listPromptDocumentBlockRefs(documentId) { return getDb().prepare('SELECT * FROM prompt_document_block_refs WHERE document_id = ? ORDER BY position ASC, created_at ASC').all(documentId).map(toBlockRef); }
export function resolvePromptBlockInventoryForAgentDocument(agentDoc, options = {}) {
  const state = getAgentPromptInheritanceState(agentDoc, options);
  const localBlocks = listPromptBlocks(agentDoc?.id || '').map((block) => ({
    ...block,
    metadata: { ...(block?.metadata || {}) },
  }));
  const localBlockIds = new Set(localBlocks.map((block) => String(block.id)));
  const previewInventoryBlocks = [];
  const seenGlobalBlockIds = new Set();
  for (const assignment of state.globalAssignments || []) {
    if (!assignmentTargetsAgentType(assignment, options?.agentType ?? null)) continue;
    const blockId = String(assignment?.blockId || '').trim();
    if (!blockId || localBlockIds.has(blockId) || seenGlobalBlockIds.has(blockId)) continue;
    const inheritedBlock = (state.blocks || []).find((block) => String(block?.id) === blockId) || null;
    const effectiveRef = (state.refs || []).find((ref) => String(ref?.blockId) === blockId) || null;
    const localOverrideRef = (state.localRefs || []).find((ref) => String(ref?.blockId) === blockId) || null;
    const block = inheritedBlock || findPromptBlockById(blockId);
    if (!block) continue;
    const disabledLocally = state.disabledInheritedBlockIds?.includes?.(blockId) || false;
    previewInventoryBlocks.push({
      ...block,
      metadata: {
        ...(block?.metadata || {}),
        inherited: !localOverrideRef,
        inheritedFromGlobal: true,
        origin: 'global',
        previewInventoryKind: disabledLocally ? 'global-disabled' : (effectiveRef ? 'global-inherited' : 'global-available'),
        effectiveIncluded: localOverrideRef ? localOverrideRef.included !== false : !!effectiveRef?.included,
        included: localOverrideRef ? localOverrideRef.included !== false : !!effectiveRef?.included,
        disabledLocally: !!disabledLocally,
        assignmentAgentTypes: assignment?.agentTypes ?? [],
        inheritedBlockId: blockId,
        globalBlockId: blockId,
      },
    });
    seenGlobalBlockIds.add(blockId);
  }
  return {
    ...state,
    blocks: [
      ...localBlocks,
      ...previewInventoryBlocks,
    ],
  };
}
function cloneJson(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function getAgentPromptInheritanceState(agentDoc, { agentType = null } = {}) {
  const db = getDb();
  const agentDocumentId = agentDoc?.id ?? null;
  const globalDoc = getOrBootstrapGlobalPromptDocument();
  const globalRefs = globalDoc?.id ? listPromptDocumentBlockRefs(globalDoc.id) : [];
  const globalAssignments = globalDoc?.id ? listPromptBlockTypeAssignments(globalDoc.id) : [];
  const inheritedByBlockId = new Map();
  for (const assignment of globalAssignments) {
    if (!assignmentTargetsAgentType(assignment, agentType)) continue;
    inheritedByBlockId.set(assignment.blockId, assignment);
  }
  const localRefs = agentDocumentId ? listPromptDocumentBlockRefs(agentDocumentId) : [];
  const localAssignments = agentDocumentId ? listPromptBlockTypeAssignments(agentDocumentId) : [];
  const localByBlockId = new Map(localRefs.map(ref => [ref.blockId, ref]));
  const localAssignmentByBlockId = new Map(localAssignments.map(assignment => [assignment.blockId, assignment]));
  const disabledInheritedBlockIds = new Set();
  const localEffectiveRefs = [];
  for (const ref of localRefs) {
    const meta = ref?.metadata ?? {};
    const disabled = meta.disableInherited ?? meta.disabledInherited ?? meta.inheritedDisabled ?? null;
    const targetBlockId = meta.inheritedBlockId ?? meta.globalBlockId ?? ref.blockId;
    if (disabled) disabledInheritedBlockIds.add(String(targetBlockId));
    if (ref.included) localEffectiveRefs.push(ref);
  }
  const mergedRefsByBlockId = new Map();
  for (const ref of globalRefs) {
    const assignment = inheritedByBlockId.get(ref.blockId) || null;
    if (!assignment) continue;
    if (!assignmentTargetsAgentType(assignment, agentType)) continue;
    if (disabledInheritedBlockIds.has(String(ref.blockId))) continue;
    const block = db.prepare('SELECT * FROM prompt_blocks WHERE id = ? LIMIT 1').get(ref.blockId);
    mergedRefsByBlockId.set(ref.blockId, { ...ref, origin: 'global', inherited: true, block: block ? toBlock(block) : null, metadata: { ...(ref.metadata ?? {}), inheritedFromGlobal: true } });
  }
  for (const ref of localEffectiveRefs) {
    mergedRefsByBlockId.set(ref.blockId, { ...ref, origin: 'local', inherited: false });
  }
  const mergedRefs = [...mergedRefsByBlockId.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.blockId).localeCompare(String(b.blockId)));
  const blocks = mergedRefs.map(ref => {
    const blockRow = ref.block ?? db.prepare('SELECT * FROM prompt_blocks WHERE id = ? LIMIT 1').get(ref.blockId);
    if (!blockRow) return null;
    const block = toBlock(blockRow);
    const localRef = localByBlockId.get(ref.blockId) || null;
    const localAssignment = localAssignmentByBlockId.get(ref.blockId) || null;
    const inheritedAssignment = inheritedByBlockId.get(ref.blockId) || null;
    const effectiveOrigin = ref.origin || (localRef ? 'local' : 'global');
    const effectiveInherited = effectiveOrigin !== 'local';
    const effectiveRefId = localRef?.id ?? ref.id ?? null;
    const effectiveBlockVersionId = localRef?.pinnedBlockVersionId ?? localRef?.blockVersionId ?? ref.pinnedBlockVersionId ?? ref.blockVersionId ?? null;
    const effectiveRefIdentity = {
      refId: effectiveRefId,
      blockId: ref.blockId,
      blockVersionId: effectiveBlockVersionId,
      origin: effectiveOrigin,
      inherited: effectiveInherited,
      inheritedFromGlobal: effectiveInherited ? true : false,
      globalBlockId: effectiveInherited ? ref.blockId : null,
      localBlockId: localRef ? localRef.blockId : null,
      source: effectiveInherited ? 'effective-ref' : 'local-ref',
    };
    const canonicalRefIdentity = [
      String(ref.blockId ?? ''),
      String(effectiveBlockVersionId ?? 'current'),
      effectiveInherited ? 'global' : 'local',
    ].join('|');
    return {
      ...block,
      effectiveRefIdentity,
      canonicalRefIdentity,
      effectiveRefBlockId: ref.blockId,
      effectiveRefOrigin: effectiveOrigin,
      effectiveRefInherited: effectiveInherited,
      effectiveRefGlobalBlockId: effectiveInherited ? ref.blockId : null,
      effectiveRefLocalBlockId: localRef ? localRef.blockId : null,
      effectiveRefAssignment: localAssignment || inheritedAssignment || null,
    };
  }).filter(Boolean);
  const content = mergedRefs.map(ref => {
    const blockRow = db.prepare('SELECT * FROM prompt_blocks WHERE id = ? LIMIT 1').get(ref.blockId);
    const resolvedVersionId = ref.followCurrent === true ? null : (ref.pinnedBlockVersionId ?? ref.blockVersionId ?? null);
    const version = resolvedVersionId ? toBlockVersion(db.prepare('SELECT * FROM prompt_block_versions WHERE id = ? LIMIT 1').get(resolvedVersionId)) : blockRow ? getBlockCurrentVersion(blockRow.id) : null;
    return version?.content ?? blockRow?.content ?? '';
  }).filter(Boolean).join('\n\n');
  return {
    document: agentDoc || null,
    agentType: agentType ?? null,
    globalDocument: globalDoc,
    blocks,
    refs: mergedRefs,
    content,
    localRefs,
    localAssignments,
    globalRefs,
    globalAssignments,
    disabledInheritedBlockIds: [...disabledInheritedBlockIds],
    localByBlockId,
    localAssignmentByBlockId,
    inheritedByBlockId,
  };
}
export function resolveEffectivePromptForAgentDocument(agentDoc, options = {}) {
  return getAgentPromptInheritanceState(agentDoc, options);
}
export function resolveEffectivePromptBlocksForAgentDocument(agentDoc, options = {}) {
  return getAgentPromptInheritanceState(agentDoc, options).blocks;
}
export function resolveEffectivePromptRefsForAgentDocument(agentDoc, options = {}) {
  return getAgentPromptInheritanceState(agentDoc, options).refs;
}
export function resolveEffectivePromptContentForAgentDocument(agentDoc, options = {}) {
  return getAgentPromptInheritanceState(agentDoc, options).content;
}

function normalizePromptUsageTarget(target = {}) {
  const input = target && typeof target === 'object' ? target : {};
  const blockId = String(input.blockId ?? '').trim();
  const documentId = String(input.documentId ?? input.promptDocumentId ?? '').trim();
  const documentKey = String(input.documentKey ?? '').trim();
  const agentId = String(input.agentId ?? '').trim();
  const scope = String(input.scope ?? '').trim().toLowerCase() || (blockId ? 'block' : documentId ? 'document' : documentKey ? 'document' : agentId ? 'document' : 'global');
  return { input, blockId, documentId, documentKey, agentId, scope, agentType: input.agentType ?? null };
}

function getAgentRowById(agentId) { return getDb().prepare('SELECT * FROM agents WHERE id = ? LIMIT 1').get(agentId); }
function getPromptDocumentForAgentUsage(agentId, { bootstrap = false } = {}) { const agent = getAgentRowById(agentId); if (!agent) return null; const key = derivePromptKeyForAgent(agent); if (!bootstrap) return getPromptDocumentByKeyNoBootstrap(key); const existing = getPromptDocumentByKeyNoBootstrap(key); if (existing) return existing; return getOrBootstrapPromptDocumentByAgent({ username: agent.username, agentId: agent.id }); }

function summarizePromptUsageBuckets({ localDirect = 0, localOverride = 0, inheritedActive = 0, disabledInherited = 0, effectiveAssignments = 0, refs = 0, assignmentCompositions = null } = {}) {
  const total = localDirect + localOverride + inheritedActive + disabledInherited;
  return {
    localDirect,
    localOverride,
    inheritedActive,
    inheritedByAgentType: inheritedActive,
    disabledInherited,
    total,
    active: localDirect + localOverride + inheritedActive,
    refs,
    effectiveAssignments,
    assignmentCompositions: assignmentCompositions ? { ...assignmentCompositions } : null,
    origins: { local: localDirect + localOverride, inherited: inheritedActive, inheritedByAgentType: inheritedActive },
    buckets: { localDirect, localOverride, inheritedActive, disabledInherited },
  };
}

export function resolvePromptUsageMap(target = {}, options = {}) {
  const normalized = normalizePromptUsageTarget(target);
  let document = null;
  let scope = normalized.scope;
  let block = null;
  let refs = [];
  let assignments = [];
  let localRefs = [];
  let localAssignments = [];
  let globalDocument = null;
  let inheritedState = null;
  const agentType = normalized.agentType ?? options.agentType ?? null;

  if (normalized.documentId) {
    document = getPromptDocumentById(normalized.documentId);
  } else if (normalized.documentKey) {
    document = getPromptDocumentByKeyNoBootstrap(normalized.documentKey) || getPromptDocumentByKey(normalized.documentKey);
  } else if (normalized.agentId) {
    document = getPromptDocumentForAgentUsage(normalized.agentId, { bootstrap: true });
  }

  if (normalized.blockId) {
    block = findPromptBlockById(normalized.blockId);
    if (block && !document) {
      document = getPromptDocumentById(block.documentId);
      scope = 'block';
    }
  }

  if (!document && normalized.scope === 'global') {
    document = getOrBootstrapGlobalPromptDocument();
  }

  if (document?.id) {
    refs = listPromptDocumentBlockRefs(document.id);
    assignments = listPromptBlockTypeAssignments(document.id);
    localRefs = refs;
    localAssignments = assignments;
  }

  globalDocument = getOrBootstrapGlobalPromptDocument();
  if (document?.id === globalDocument?.id) {
    globalDocument = document;
  }

  if (document?.id && document.id !== globalDocument?.id) {
    inheritedState = getAgentPromptInheritanceState(document, { agentType });
  }

  const blockId = normalized.blockId || block?.id || null;
  const localBlock = block || (blockId ? findPromptBlockById(blockId) : null);
  const targetDocumentId = document?.id ?? normalized.documentId ?? null;
  const targetDocumentKey = document?.key ?? normalized.documentKey ?? null;
  const targetAgentId = normalized.agentId || document?.metadata?.agentId || null;
  const localRefsForBlock = localRefs.filter(ref => !blockId || String(ref.blockId) === String(blockId));
  const localAssignmentsForBlock = localAssignments.filter(assignment => !blockId || String(assignment.blockId) === String(blockId));
  const isGlobalDocumentTarget = !!(document?.id && document.id === globalDocument?.id);
  const disabledInheritedBlockIds = new Set((inheritedState?.disabledInheritedBlockIds || []).map(String));
  const localAssignmentByBlockId = new Map(localAssignmentsForBlock.map(assignment => [String(assignment.blockId), assignment]));
  const inheritedAssignmentByBlockId = new Map((inheritedState?.globalAssignments || []).filter(assignment => !blockId || String(assignment.blockId) === String(blockId)).map(assignment => [String(assignment.blockId), assignment]));
  const effectiveRefsSource = inheritedState?.refs || refs || [];
  const effectiveRefs = effectiveRefsSource.filter(ref => {
    if (blockId && String(ref.blockId) !== String(blockId)) return false;
    if (!(isGlobalDocumentTarget && agentType)) return true;
    const assignment = localAssignmentByBlockId.get(String(ref.blockId)) || inheritedAssignmentByBlockId.get(String(ref.blockId)) || null;
    return !!assignment && assignmentTargetsAgentType(assignment, agentType);
  });
  const effectiveRefBlockIds = new Set(effectiveRefs.map(ref => String(ref.blockId)));
  const effectiveAssignments = [...effectiveRefBlockIds].map(refBlockId => {
    return localAssignmentByBlockId.get(refBlockId) || inheritedAssignmentByBlockId.get(refBlockId) || null;
  }).filter(Boolean);
  const effectiveAssignmentByBlockId = new Map(effectiveAssignments.map(assignment => [String(assignment.blockId), assignment]));
  const assignmentRefs = effectiveRefs.map(ref => {
    const assignment = effectiveAssignmentByBlockId.get(String(ref.blockId)) || null;
    const matchedByAgentType = !!assignment && assignmentTargetsAgentType(assignment, agentType);
    const source = localAssignmentByBlockId.has(String(ref.blockId)) ? 'local' : (matchedByAgentType ? 'inheritedByAgentType' : 'inherited');
    return {
      blockId: ref.blockId,
      assignmentId: assignment?.id ?? null,
      blockType: assignment?.blockType ?? null,
      canonicalType: assignment?.canonicalType ?? null,
      agentTypes: assignment?.agentTypes ?? [],
      matchedByAgentType,
      source,
    };
  });
  const assignmentRefByBlockId = new Map(assignmentRefs.map(item => [String(item.blockId), item]));
  const localRefsEffective = localRefsForBlock.filter(ref => effectiveRefBlockIds.has(String(ref.blockId)));
  const inheritedRefs = (inheritedState?.globalRefs || (isGlobalDocumentTarget ? refs : [])).filter(ref => effectiveRefBlockIds.has(String(ref.blockId)) && (!blockId || String(ref.blockId) === String(blockId)));
  const inheritedAssignments = (inheritedState?.globalAssignments || []).filter(assignment => effectiveRefBlockIds.has(String(assignment.blockId)) && (!blockId || String(assignment.blockId) === String(blockId)));
  const inheritedAssignmentBlockIds = new Set(inheritedAssignments.map(assignment => String(assignment.blockId)));
  const localAssignmentBlockIds = new Set(localAssignmentsForBlock.map(assignment => String(assignment.blockId)));
  const localDirect = localRefsEffective.filter(ref => ref?.included !== false && !disabledInheritedBlockIds.has(String(ref.blockId))).length;
  const localOverride = localRefsEffective.filter(ref => ref?.included !== false && disabledInheritedBlockIds.has(String(ref.blockId))).length;
  const inheritedActive = effectiveRefs.filter(ref => ref?.included !== false && !localRefsEffective.some(localRef => String(localRef.blockId) === String(ref.blockId) && localRef.included !== false)).length;
  const disabledInherited = inheritedRefs.filter(ref => ref?.included === false || disabledInheritedBlockIds.has(String(ref.blockId))).length;
  const effectiveAssignmentBlockIds = [...new Set(effectiveAssignments.map(assignment => String(assignment.blockId)))];
  const totalAssignmentBlockIds = [...new Set([...localAssignmentBlockIds, ...inheritedAssignmentBlockIds])];
  const assignmentCompositions = {
    totalAssignments: totalAssignmentBlockIds.length,
    effectiveAssignments: effectiveAssignments.length,
    localAssignments: localAssignmentsForBlock.length,
    inheritedAssignments: inheritedAssignments.length,
    localAssignedBlockIds: [...localAssignmentBlockIds],
    inheritedAssignedBlockIds: [...inheritedAssignmentBlockIds],
    effectiveAssignedBlockIds: effectiveAssignmentBlockIds,
  };

  const includeContent = options.includeContent === true || options.includeBlockContent === true;
  const includeDescription = options.includeDescription === true || options.includeSummary === true || options.verbose === true;
  const includeAgentType = options.includeAgentType === true || options.verbose === true;
  const includeAssignmentId = options.includeAssignmentId === true || options.debug === true;
  const includeDebug = options.includeDebug === true || options.debug === true || options.includeDetails === true;

  const effectiveBlocks = effectiveRefs.map(ref => {
    const assignmentRef = assignmentRefByBlockId.get(String(ref.blockId)) || null;
    const assignment = effectiveAssignmentByBlockId.get(String(ref.blockId)) || null;
    const blockRecord = findPromptBlockById(ref.blockId) || null;
    const isLocal = localRefsEffective.some(localRef => String(localRef.blockId) === String(ref.blockId));
    const inherited = !isLocal;
    const origin = isLocal ? 'local' : 'global';
    const byAgentType = agentType ? !!assignmentRef?.matchedByAgentType : null;
    const item = {
      blockId: ref.blockId,
      blockKey: blockRecord?.key ?? blockRecord?.blockKey ?? null,
      title: blockRecord?.title ?? blockRecord?.label ?? blockRecord?.name ?? null,
      blockType: assignment?.blockType ?? blockRecord?.blockType ?? null,
      origin,
      inherited,
      order: ref.position ?? ref.orderIndex ?? ref.sortOrder ?? null,
      active: ref?.included !== false,
      included: ref?.included !== false,
      match: {
        byAssignment: !!assignmentRef,
        byAgentType,
      },
    };
    if (includeDescription) {
      item.description = blockRecord?.summary ?? blockRecord?.description ?? blockRecord?.notes ?? null;
    }
    if (includeAgentType) {
      item.agentTypes = assignment?.agentTypes ?? [];
      item.canonicalType = assignment?.canonicalType ?? null;
    }
    if (includeAssignmentId) {
      item.assignmentId = assignment?.id ?? null;
    }
    if (includeContent) {
      item.content = blockRecord?.content ?? null;
    }
    return item;
  });

  const response = {
    target: { blockId, documentId: targetDocumentId, documentKey: targetDocumentKey, agentId: targetAgentId, scope },
    scope,
    blocks: effectiveBlocks,
    summary: {
      total: effectiveBlocks.length,
      active: effectiveBlocks.filter(item => item.active).length,
      inactive: effectiveBlocks.filter(item => !item.active).length,
    },
  };

  if (includeDebug) {
    response.debug = {
      document: document ? { id: document.id, key: document.key ?? null, scope: document.scope ?? null } : null,
      globalDocument: globalDocument ? { id: globalDocument.id, key: globalDocument.key ?? null, scope: globalDocument.scope ?? null } : null,
      block: localBlock ? { id: localBlock.id, key: localBlock.key ?? null, title: localBlock.title ?? null } : null,
      assignmentRefs,
      summaryBuckets: summarizePromptUsageBuckets({
        localDirect,
        localOverride,
        inheritedActive,
        disabledInherited,
        effectiveAssignments: effectiveAssignments.length,
        refs: effectiveRefs.length,
        assignmentCompositions,
      }),
      localRefs: localRefsEffective.map(ref => ({ ...ref })),
      inheritedRefs: inheritedRefs.map(ref => ({ ...ref })),
      assignments: effectiveAssignments.map(assignment => ({
        ...assignment,
        matchedByAgentType: assignmentTargetsAgentType(assignment, agentType),
        origin: localAssignmentByBlockId.has(String(assignment.blockId)) ? 'local' : (assignmentTargetsAgentType(assignment, agentType) ? 'inheritedByAgentType' : 'inherited'),
      })),
      localAssignments: localAssignmentsForBlock.filter(assignment => effectiveRefBlockIds.has(String(assignment.blockId))).map(assignment => ({ ...assignment })),
      inheritedAssignments: inheritedAssignments.map(assignment => ({ ...assignment })),
      renderedBlocksByAssignment: effectiveAssignments.map(assignment => {
        const matchedByAgentType = assignmentTargetsAgentType(assignment, agentType);
        const origin = localAssignmentByBlockId.has(String(assignment.blockId)) ? 'local' : (matchedByAgentType ? 'inheritedByAgentType' : 'inherited');
        return {
          assignmentId: assignment.id ?? null,
          blockId: assignment.blockId,
          blockType: assignment.blockType ?? null,
          origin,
          renderedRefs: effectiveRefs.filter(ref => String(ref.blockId) === String(assignment.blockId)).map(ref => ({
            ...ref,
            origin,
          })),
        };
      }),
    };
  }

  return response;
}

function normalizePromptCompareTarget(target = {}) {
  const input = target && typeof target === 'object' ? target : {};
  const documentId = String(input.documentId ?? '').trim();
  const documentKey = String(input.documentKey ?? '').trim();
  const agentId = String(input.agentId ?? '').trim();
  const global = !!input.global;
  const compareTo = input.compareTo === 'version' ? 'version' : 'preview';
  const versionId = String(input.versionId ?? '').trim();
  return { input, documentId, documentKey, agentId, global, compareTo, versionId };
}

function findPromptDocumentByAnyTarget(target) {
  if (target.documentId) return getPromptDocumentById(target.documentId);
  if (target.documentKey) return getPromptDocumentByKeyNoBootstrap(target.documentKey) || getPromptDocumentByKey(target.documentKey);
  if (target.agentId) {
    const row = getDb().prepare('SELECT * FROM agents WHERE id = ? LIMIT 1').get(target.agentId);
    if (!row) return null;
    return getPromptDocumentByKeyNoBootstrap(derivePromptKeyForAgent(row)) || getPromptDocumentByKey(derivePromptKeyForAgent(row));
  }
  if (target.global) return getPromptDocumentByKeyNoBootstrap(GLOBAL_PROMPT_DOCUMENT_KEY) || null;
  return null;
}

function normalizeResolvedSnapshotBlockItems(resolvedSnapshot = null) {
  const snapshot = resolvedSnapshot && typeof resolvedSnapshot === 'object' ? resolvedSnapshot : null;
  const items = Array.isArray(snapshot?.blocks) ? snapshot.blocks : [];
  const refs = Array.isArray(snapshot?.refs) ? snapshot.refs : [];
  const refByBlockId = new Map(refs.map(ref => [String(ref?.blockId ?? ''), ref]));
  return items.map(item => {
    const blockId = String(item?.blockId ?? item?.block?.id ?? item?.ref?.blockId ?? '').trim();
    const ref = item?.ref || refByBlockId.get(blockId) || null;
    const block = item?.block || (blockId ? { id: blockId, blockType: item?.blockType ?? ref?.blockType ?? null } : null);
    const version = item?.version || (item?.versionId ? { id: item.versionId, version: item.versionNumber ?? null } : null) || null;
    const content = String(item?.content ?? item?.text ?? '');
    return { block, ref, version, content };
  }).filter(item => String(item?.block?.id ?? item?.ref?.blockId ?? '').trim());
}

function summarizeBlockDiffs(currentBlocks = [], compareBlocks = []) {
  const currentMap = new Map(currentBlocks.map(block => [String(block?.ref?.blockId ?? block?.block?.id ?? ''), block]));
  const compareMap = new Map(compareBlocks.map(block => [String(block?.ref?.blockId ?? block?.block?.id ?? ''), block]));
  const currentIds = new Set([...currentMap.keys()].filter(Boolean));
  const compareIds = new Set([...compareMap.keys()].filter(Boolean));
  let added = 0, removed = 0, changed = 0;
  for (const id of compareIds) if (!currentIds.has(id)) added++;
  for (const id of currentIds) if (!compareIds.has(id)) removed++;
  for (const id of currentIds) {
    if (!compareIds.has(id)) continue;
    const current = currentMap.get(id);
    const compare = compareMap.get(id);
    const currentRef = current?.ref || {};
    const compareRef = compare?.ref || {};
    const currentVersionId = current?.version?.id ?? null;
    const compareVersionId = compare?.version?.id ?? null;
    const currentContent = String(current?.content ?? '');
    const compareContent = String(compare?.content ?? '');
    const currentSignature = JSON.stringify({
      included: currentRef?.included ?? null,
      position: currentRef?.position ?? null,
      followCurrent: currentRef?.followCurrent ?? null,
      pinnedBlockVersionId: currentRef?.pinnedBlockVersionId ?? currentRef?.blockVersionId ?? null,
    });
    const compareSignature = JSON.stringify({
      included: compareRef?.included ?? null,
      position: compareRef?.position ?? null,
      followCurrent: compareRef?.followCurrent ?? null,
      pinnedBlockVersionId: compareRef?.pinnedBlockVersionId ?? compareRef?.blockVersionId ?? null,
    });
    if (currentVersionId !== compareVersionId || currentContent !== compareContent || currentSignature !== compareSignature) changed++;
  }
  return { added, removed, changed };
}

function summarizeTextDiff(currentText = '', compareText = '') {
  const current = String(currentText ?? '');
  const compare = String(compareText ?? '');
  return {
    changed: current !== compare,
    currentLength: current.length,
    compareLength: compare.length,
  };
}

export function resolvePromptOperationalDiff(target = {}, options = {}) {
  const normalized = normalizePromptCompareTarget(target);
  const document = findPromptDocumentByAnyTarget(normalized);
  if (!document?.id) {
    return {
      target: { documentId: normalized.documentId || null, documentKey: normalized.documentKey || null, agentId: normalized.agentId || null, global: normalized.global },
      baseline: null,
      compare: null,
      diff: { mode: normalized.compareTo, content: summarizeTextDiff('', ''), blocks: null },
      summary: { reason: 'document-not-found', valid: false },
      valid: false,
      issue: { code: 'target_not_resolved', message: 'Prompt target could not be resolved.' },
    };
  }

  const agentType = options.agentType ?? null;
  const baselineVersion = getCurrentPromptVersion(document.id);
  const previewState = resolvePromptFinalByComposition(document.id, { agentType });
  const baselineContent = baselineVersion?.content ?? '';
  const previewContent = previewState?.content ?? '';
  const resolvedSnapshot = baselineVersion?.metadata?.resolvedSnapshot ?? null;

  let compareMeta = null;
  let diffBlocks = null;
  let limitations = [];

  if (normalized.compareTo === 'preview') {
    const allAssignments = previewState?.assignments ?? [];
    const allowedAssignments = previewState?.allowedAssignments ?? [];
    const allRefs = previewState?.refs ?? [];
    const includedRefs = previewState?.includedRefs ?? [];
    const renderedBlocks = previewState?.blocks ?? [];
    const baselineBlocks = normalizeResolvedSnapshotBlockItems(resolvedSnapshot);
    const hasResolvedSnapshot = !!(resolvedSnapshot && typeof resolvedSnapshot === 'object' && !Array.isArray(resolvedSnapshot));
    const structuralCounts = {
      baseline: hasResolvedSnapshot
        ? {
            contentLength: baselineContent.length,
            snapshotBlocks: baselineBlocks.length,
            snapshotRefs: Array.isArray(resolvedSnapshot?.refs) ? resolvedSnapshot.refs.length : 0,
            snapshotAssignmentsIncluded: resolvedSnapshot?.assignments?.included ?? 0,
            snapshotAssignmentsRendered: resolvedSnapshot?.assignments?.rendered ?? 0,
          }
        : {
            contentLength: baselineContent.length,
            canonicalBlocksAvailable: false,
            structuralBaselineAvailable: false,
          },
      preview: {
        assignmentsTotal: allAssignments.length,
        assignmentsEligible: allowedAssignments.length,
        refsTotal: allRefs.length,
        refsIncluded: includedRefs.length,
        renderedBlocks: renderedBlocks.length,
        contentLength: previewContent.length,
      },
    };
    const previewDiffBlocks = hasResolvedSnapshot ? summarizeBlockDiffs(renderedBlocks, baselineBlocks) : null;
    diffBlocks = {
      mode: 'preview',
      changed: baselineContent !== previewContent,
      reliable: hasResolvedSnapshot,
      baselineStructuralSource: hasResolvedSnapshot ? 'currentVersion.metadata.resolvedSnapshot' : 'unavailable-resolved-snapshot',
      previewStructuralSource: 'current-composition',
      previewStructureReliable: true,
      counts: structuralCounts,
      blocks: hasResolvedSnapshot
        ? {
            ...previewDiffBlocks,
            baselineCount: baselineBlocks.length,
            previewCount: renderedBlocks.length,
            baselineSource: 'published-resolved-snapshot',
            previewSource: 'current-preview',
          }
        : {
            baselineAvailable: false,
            baselineSource: 'unavailable-resolved-snapshot',
            previewSource: 'current-preview',
            structuralDiffReliable: false,
            added: null,
            removed: null,
            changed: null,
            baselineCount: null,
            previewCount: renderedBlocks.length,
            note: 'Structural baseline unavailable; block diff is not reliable.',
          },
      previewEmpty: previewContent.length === 0,
      previewEmptyReason: previewContent.length === 0 ? {
        assignmentsTotal: allAssignments.length,
        assignmentsEligible: allowedAssignments.length,
        refsTotal: allRefs.length,
        refsIncluded: includedRefs.length,
        renderedBlocks: renderedBlocks.length,
      } : null,
    };
    compareMeta = {
      kind: 'preview',
      contentLength: previewContent.length,
      hasStructuralBlockComparison: hasResolvedSnapshot,
      structuralCounts,
      note: hasResolvedSnapshot
        ? 'Preview compares the live draft against the saved resolved snapshot baseline and the current composition.'
        : 'Preview uses the current resolved version content as fallback because no saved resolved snapshot baseline is available.',
    };
    limitations = [
      ...(hasResolvedSnapshot ? [] : ['Baseline structural snapshot is unavailable; preview comparison falls back to the current resolved version content.']),
      ...(previewContent.length === 0 ? ['Preview render is empty; inspect previewEmptyReason and counts for assignment/ref composition context.'] : []),
    ];
  } else {
    const compareVersion = normalized.versionId
      ? toPromptVersion(getDb().prepare('SELECT * FROM prompt_versions WHERE id = ? AND document_id = ? LIMIT 1').get(normalized.versionId, document.id))
      : null;
    if (normalized.versionId && !compareVersion) {
      return {
        target: { documentId: document.id, documentKey: document.key, agentId: normalized.agentId || null, global: normalized.global },
        baseline: baselineVersion ? { kind: 'current', id: baselineVersion.id, version: baselineVersion.version, contentLength: baselineContent.length } : null,
        compare: { kind: 'version', id: normalized.versionId, version: null, contentLength: 0, hasStructuralBlockComparison: false, note: 'Requested version was not found for this document.' },
        diff: { mode: 'version', content: summarizeTextDiff(baselineContent, ''), blocks: null },
        summary: { compareTo: 'version', baselineId: baselineVersion?.id ?? null, compareId: normalized.versionId, changed: false, valid: false, limitations: ['Requested compare version does not exist for the target document.'] },
        valid: false,
        issue: { code: 'compare_version_not_found', message: 'Requested compare version was not found for the target document.' },
        limitations: ['Requested compare version does not exist for the target document.'],
      };
    }
    compareMeta = {
      kind: 'version',
      id: compareVersion?.id ?? null,
      version: compareVersion?.version ?? null,
      contentLength: String(compareVersion?.content ?? '').length,
      hasStructuralBlockComparison: false,
      note: 'Structural block comparison is not available here.',
    };
    limitations = [
      'Persisted prompt versions store resolved content snapshots, not canonical block/ref structure; version-to-current comparison is content-based only.',
    ];
    return {
      target: { documentId: document.id, documentKey: document.key, agentId: normalized.agentId || null, global: normalized.global },
      baseline: baselineVersion ? { kind: 'current', id: baselineVersion.id, version: baselineVersion.version, contentLength: baselineContent.length } : null,
      compare: compareMeta,
      diff: {
        mode: 'version',
        content: summarizeTextDiff(baselineContent, compareVersion?.content ?? ''),
        blocks: null,
      },
      summary: {
        compareTo: 'version',
        baselineId: baselineVersion?.id ?? null,
        compareId: compareVersion?.id ?? null,
        changed: baselineContent !== String(compareVersion?.content ?? ''),
        limitations,
      },
      limitations,
    };
  }

  return {
    target: { documentId: document.id, documentKey: document.key, agentId: normalized.agentId || null, global: normalized.global },
    baseline: baselineVersion ? { kind: 'current', id: baselineVersion.id, version: baselineVersion.version, contentLength: baselineContent.length } : null,
    compare: compareMeta,
    diff: {
      mode: 'preview',
      content: summarizeTextDiff(baselineContent, previewContent),
      blocks: diffBlocks,
    },
    summary: {
      compareTo: 'preview',
      baselineId: baselineVersion?.id ?? null,
      compareId: 'preview',
      changed: baselineContent !== previewContent,
      blockCounts: diffBlocks,
      limitations,
    },
    limitations,
  };
}

function normalizePromptArchitectureTarget(target = {}) {
  const input = target && typeof target === 'object' ? target : {};
  const documentId = String(input.documentId ?? input.promptDocumentId ?? '').trim();
  const blockId = String(input.blockId ?? '').trim();
  const scope = String(input.scope ?? '').trim().toLowerCase() || 'document';
  return { input, documentId, blockId, scope, agentType: input.agentType ?? null };
}

function makePromptIssue(code, message, details = {}) {
  return { code, message, ...details };
}

export function validatePromptArchitecture(target = {}, options = {}) {
  const normalized = normalizePromptArchitectureTarget(target);
  const db = getDb();
  const document = normalized.documentId ? getPromptDocumentById(normalized.documentId) : (normalized.scope === 'global' ? getPromptDocumentByKeyNoBootstrap(GLOBAL_PROMPT_DOCUMENT_KEY) : null);
  if (!document?.id) {
    return { valid: false, target: { documentId: normalized.documentId || null, blockId: normalized.blockId || null, scope: normalized.scope }, summary: 'target-not-resolved', issues: [makePromptIssue('target_not_resolved', 'Prompt target could not be resolved.', { documentId: normalized.documentId || null, scope: normalized.scope })], recommendations: [], stats: { blocks: 0, refs: 0, assignments: 0, issueCount: 1 } };
  }
  const blocks = document?.id ? listPromptBlocks(document.id) : [];
  const refs = document?.id ? listPromptDocumentBlockRefs(document.id) : [];
  const assignments = document?.id ? listPromptBlockTypeAssignments(document.id) : [];
  const blockById = new Map(blocks.map(block => [String(block.id), block]));
  const refByBlockId = new Map();
  const assignmentByBlockId = new Map(assignments.map(assignment => [String(assignment.blockId), assignment]));
  const issues = [];
  const seenRefIds = new Set();
  const seenBlockKeys = new Set();
  let previousRefPosition = null;
  for (const ref of refs) {
    const refKey = String(ref.blockId ?? '');
    if (!refKey || !blockById.has(refKey)) issues.push(makePromptIssue('broken_ref', 'Prompt ref references a missing block.', { blockId: ref.blockId ?? null, refId: ref.id ?? null }));
    if (seenRefIds.has(refKey)) issues.push(makePromptIssue('duplicate_ref', 'Prompt ref collision detected.', { blockId: ref.blockId ?? null }));
    seenRefIds.add(refKey);
    const currentPosition = Number(ref.position);
    if (Number.isFinite(currentPosition) && currentPosition > 0) {
      if (previousRefPosition != null && currentPosition < previousRefPosition) {
        issues.push(makePromptIssue('ref_out_of_order', 'Prompt refs are not in monotonic ascending position order.', { refId: ref.id ?? null, blockId: ref.blockId ?? null, position: currentPosition, previousPosition: previousRefPosition, severity: 'warning' }));
      }
      previousRefPosition = currentPosition;
    }
    refByBlockId.set(refKey, ref);
  }
  for (const block of blocks) {
    const key = String(block.blockKey ?? '');
    if (key && seenBlockKeys.has(key)) issues.push(makePromptIssue('duplicate_block_key', 'Prompt blockKey collision detected.', { blockKey: key }));
    if (key) seenBlockKeys.add(key);
    const assignment = assignmentByBlockId.get(String(block.id));
    const ref = refByBlockId.get(String(block.id));
    if (!assignment && !ref) issues.push(makePromptIssue('orphan_block', 'Prompt block appears orphaned for the target document.', { blockId: block.id, severity: 'warning', recommendation: 'Review whether this block should be linked or intentionally left standalone.' }));
    if (assignment && assignment.documentId !== document.id) issues.push(makePromptIssue('assignment_outside_target', 'Assignment does not belong to the target document.', { blockId: block.id, assignmentDocumentId: assignment.documentId }));
    if (ref && ref.documentId !== document.id) issues.push(makePromptIssue('ref_outside_target', 'Block ref does not belong to the target document.', { blockId: block.id, refDocumentId: ref.documentId }));
  }
  const forcedPositions = new Map();
  for (const assignment of assignments) {
    const block = blockById.get(String(assignment.blockId));
    if (!block) issues.push(makePromptIssue('assignment_missing_block', 'Assignment references a missing block.', { blockId: assignment.blockId ?? null }));
    if (!refByBlockId.has(String(assignment.blockId))) issues.push(makePromptIssue('assignment_without_ref', 'Assignment exists without a local ref on the target document.', { blockId: assignment.blockId ?? null, severity: 'warning' }));
    if (assignment.blockType && block && assignment.blockType !== block.blockType) issues.push(makePromptIssue('assignment_type_mismatch', 'Assignment blockType does not match block type.', { blockId: assignment.blockId ?? null, assignmentBlockType: assignment.blockType, blockType: block.blockType }));
    if (assignment.forceInclude === true) {
      const forcedPosition = Number(assignment.forcedPosition);
      if (!Number.isFinite(forcedPosition) || forcedPosition <= 0 || forcedPositions.has(forcedPosition)) {
        issues.push(makePromptIssue('forced_position_gap_or_collision', 'Forced include assignment has an invalid or duplicated forcedPosition (gap detection not evaluated).', { blockId: assignment.blockId ?? null, forcedPosition: assignment.forcedPosition ?? null, severity: 'warning' }));
      } else {
        forcedPositions.set(forcedPosition, assignment.blockId);
      }
    }
    const ref = refByBlockId.get(String(assignment.blockId));
    if ((assignment.forceInclude === true || assignment.autoInclude === true) && ref && ref.included === false) {
      issues.push(makePromptIssue('include_assignment_incoherent', 'Assignment implies inclusion but the corresponding ref is excluded; this may reflect transient local override state before sync.', { blockId: assignment.blockId ?? null, severity: 'warning' }));
    }
  }
  for (const ref of refs) {
    if (ref.followCurrent === false && !ref.pinnedBlockVersionId && !ref.blockVersionId) issues.push(makePromptIssue('invalid_pinned_version', 'Pinned ref is missing a version id.', { blockId: ref.blockId ?? null, refId: ref.id ?? null }));
    if (ref.pinnedBlockVersionId || ref.blockVersionId) {
      const versionId = ref.pinnedBlockVersionId ?? ref.blockVersionId;
      const version = db.prepare('SELECT * FROM prompt_block_versions WHERE id = ? LIMIT 1').get(versionId);
      if (!version) issues.push(makePromptIssue('missing_pinned_version', 'Pinned version does not exist.', { blockId: ref.blockId ?? null, versionId }));
      else if (String(version.block_id) !== String(ref.blockId)) issues.push(makePromptIssue('pinned_version_block_mismatch', 'Pinned version does not belong to the referenced block.', { blockId: ref.blockId ?? null, versionId, versionBlockId: version.block_id }));
    }
  }
  const globalDocument = getPromptDocumentByKeyNoBootstrap(GLOBAL_PROMPT_DOCUMENT_KEY);
  if (normalized.agentType && document.id !== globalDocument?.id) {
    const inheritanceState = getAgentPromptInheritanceState(document, { agentType: normalized.agentType });
    const globalAssignmentByBlockId = new Map((inheritanceState.globalAssignments || []).map(assignment => [String(assignment.blockId), assignment]));
    for (const ref of refs) {
      const meta = ref?.metadata ?? {};
      const disableInherited = !!(meta.disableInherited ?? meta.disabledInherited ?? meta.inheritedDisabled);
      const globalBlockId = String(meta.globalBlockId ?? meta.inheritedBlockId ?? ref.blockId ?? '');
      if (disableInherited && (!globalBlockId || !globalAssignmentByBlockId.has(globalBlockId))) {
        issues.push(makePromptIssue('invalid_inherited_override_target', 'Local ref disables inheritance for a block that is not eligible in global inheritance.', { blockId: ref.blockId ?? null, globalBlockId: globalBlockId || null, severity: 'warning' }));
      }
    }
    for (const disabledBlockId of inheritanceState.disabledInheritedBlockIds || []) {
      if (!globalAssignmentByBlockId.has(String(disabledBlockId))) {
        issues.push(makePromptIssue('disabled_inherited_without_global_source', 'Disabled inherited block has no eligible global assignment source.', { blockId: String(disabledBlockId), severity: 'warning' }));
      }
    }
  }
  const valid = issues.length === 0;
  return { valid, target: { documentId: document?.id ?? normalized.documentId ?? null, blockId: normalized.blockId || null, scope: normalized.scope }, summary: valid ? 'architecture-ok' : 'architecture-issues-detected', issues, recommendations: valid ? [] : ['Fix broken refs, missing pinned versions, or review orphaned blocks before wiring.'], stats: { blocks: blocks.length, refs: refs.length, assignments: assignments.length, issueCount: issues.length } };
}
export function resolvePromptFinalByCompositionForDocument(documentId, options = {}) { return resolvePromptFinalByComposition(documentId, options); }
export function publishPromptCompositionSnapshot(documentId, payload = {}) { return publishResolvedSnapshot(documentId, payload); }
