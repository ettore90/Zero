import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { pendingApprovals, approvalDecisions, approvalDeliveryQueue, runningAgentControllers } from '../services/runtime.js';
import { broadcastToUser } from '../services/streamBroker.js';
import { flushApprovalContinuationIfIdle } from '../services/llmService.js';
import { normalizePlanForStorage, appendCommentToPlanItem, broadcastPlanUpdate, isPlausiblePlanPayload, validateCommentInput, persistPlanRecord, markPlanItemCompleted, finalizePlanIfComplete, normalizePlanStatus, isTerminalPlanStatus, listPersistedPlans } from '../services/planState.js';

const router = Router();


router.get('/approval/plans', checkLocalAccess, (_req, res) => {
  try {
    const persistedPlans = listPersistedPlans();
    const persistedByKey = new Map();

    for (const record of persistedPlans) {
      if (!record) continue;
      const normalizedRecord = {
        ...record,
        plan: record.plan ?? record.payload ?? null,
      };
      const planKey = typeof record.planKey === 'string' ? record.planKey.trim() : '';
      const requestId = typeof record.requestId === 'string' ? record.requestId.trim() : '';
      if (planKey) persistedByKey.set(planKey, normalizedRecord);
      if (requestId) persistedByKey.set(requestId, normalizedRecord);
      if (planKey) pendingApprovals.set(planKey, normalizedRecord);
      if (requestId) pendingApprovals.set(requestId, normalizedRecord);
    }

    const missingPersisted = new Set();
    for (const record of pendingApprovals.values()) {
      const planKey = typeof record?.planKey === 'string' ? record.planKey.trim() : '';
      const requestId = typeof record?.requestId === 'string' ? record.requestId.trim() : '';
      if (!planKey && !requestId) {
        missingPersisted.add('runtime-record-without-planKey-or-requestId');
        continue;
      }
      if (planKey && !persistedByKey.has(planKey)) missingPersisted.add(planKey);
      if (requestId && !persistedByKey.has(requestId)) missingPersisted.add(requestId);
    }

    if (missingPersisted.size > 0) {
      return res.status(500).json({
        success: false,
        error: 'Found approval plans in runtime memory without persisted records',
        missingPersisted: Array.from(missingPersisted),
      });
    }

    const plans = persistedPlans.map((record) => ({
      ...record,
      plan: record.plan ?? record.payload ?? null,
    }));
    return res.json({ success: true, plans });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to load persisted approval plans',
    });
  }
});


router.post('/approval/comment-item', checkLocalAccess, (req, res) => {
  const { requestId, itemId, itemText, text, username } = req.body || {};

  const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  const normalizedItemId = typeof itemId === 'string' ? itemId.trim() : '';
  const normalizedItemText = typeof itemText === 'string' ? itemText.trim() : '';

  if (!normalizedRequestId) {
    return res.status(400).json({ error: 'requestId required' });
  }
  if (!normalizedUsername) {
    return res.status(400).json({ error: 'username required' });
  }
  if (!normalizedItemId && !normalizedItemText) {
    return res.status(400).json({ error: 'itemId or itemText required' });
  }
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Comment text required' });
  }

  const pending = pendingApprovals.get(normalizedRequestId);
  if (!pending || String(pending.username || '').trim() !== normalizedUsername) {
    return res.status(404).json({ error: 'No pending approval with this requestId' });
  }

  const commentValidation = validateCommentInput(text);
  if (!commentValidation.ok) {
    return res.status(400).json({ error: commentValidation.error });
  }

  const updated = normalizedItemId
    ? appendCommentToPlanItem(pending, {
        itemId: normalizedItemId,
        text: commentValidation.text,
        author: normalizedUsername,
        role: 'user',
      })
    : appendCommentToPlanItem(pending, {
        itemText: normalizedItemText,
        text: commentValidation.text,
        author: normalizedUsername,
        role: 'user',
      });
  if (!updated.ok) {
    if (updated.error === 'Ambiguous checklist item match') {
      return res.status(409).json({ error: 'Ambiguous checklist item match' });
    }
    return res.status(404).json({ error: normalizedItemId ? (updated.error || 'Invalid or not-found itemId') : (updated.error || 'Checklist item not found') });
  }

  pendingApprovals.set(updated.record.requestId, updated.record);
  persistPlanRecord(updated.record);
  broadcastPlanUpdate(updated.record);

  return res.status(200).json({
    success: true,
    requestId: updated.record.requestId,
    item: updated.item,
    comment: updated.comment,
    plan: updated.record.plan,
    updatedAt: updated.record.updatedAt,
  });
});


router.post('/approval/complete-item', checkLocalAccess, (req, res) => {
  const { requestId, planKey, itemId, itemText, username } = req.body || {};

  const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
  const normalizedPlanKey = typeof planKey === 'string' ? planKey.trim() : '';
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  const normalizedItemId = typeof itemId === 'string' ? itemId.trim() : '';
  const normalizedItemText = typeof itemText === 'string' ? itemText.trim() : '';
  const lookupKey = normalizedPlanKey || normalizedRequestId;

  if (!normalizedUsername) return res.status(400).json({ error: 'username required' });
  if (!lookupKey) return res.status(400).json({ error: 'planKey or requestId required' });
  if (!normalizedItemId && !normalizedItemText) return res.status(400).json({ error: 'itemId or itemText required' });

  const pending = pendingApprovals.get(lookupKey) || (normalizedRequestId ? pendingApprovals.get(normalizedRequestId) : null);
  if (!pending) {
    return res.status(404).json({ error: 'No pending approval found for planKey/requestId' });
  }
  if (String(pending.username || '').trim() !== normalizedUsername) {
    return res.status(403).json({ error: 'Username does not match pending approval' });
  }

  const normalizedStatus = normalizePlanStatus(pending.status);
  if (isTerminalPlanStatus(normalizedStatus)) {
    return res.status(409).json({ error: 'Cannot mutate checklist items on a terminal plan' });
  }

  const completed = markPlanItemCompleted(pending, normalizedItemId ? { itemId: normalizedItemId } : { itemText: normalizedItemText });
  if (!completed.ok) {
    return res.status(404).json({ error: completed.error || 'Checklist item not found' });
  }

  const nextRecord = completed.record;
  const finalized = finalizePlanIfComplete(nextRecord);
  const finalRecord = finalized.ok ? finalized.record : nextRecord;
  const pendingPlanKey = finalRecord.planKey || lookupKey;
  const pendingRequestId = finalRecord.requestId || normalizedRequestId || pendingPlanKey;

  pendingApprovals.set(pendingPlanKey, finalRecord);
  if (pendingRequestId && pendingRequestId !== pendingPlanKey) pendingApprovals.set(pendingRequestId, finalRecord);
  persistPlanRecord(finalRecord);
  broadcastPlanUpdate(finalRecord);

  return res.status(200).json({
    success: true,
    planKey: pendingPlanKey,
    requestId: pendingRequestId,
    item: completed.item,
    itemStatus: completed.item?.done ? 'done' : 'open',
    planStatus: finalRecord.status,
    plan: finalRecord.plan,
    status: finalRecord.status,
    updatedAt: finalRecord.updatedAt,
  });
});

router.post('/approval/respond', checkLocalAccess, (req, res) => {
  const { requestId, planKey, approved, payload } = req.body;

  if (!requestId) {
    return res.status(400).json({ error: 'requestId required' });
  }

  const normalizedPlanKey = typeof planKey === 'string' ? planKey.trim() : '';
  const lookupKey = normalizedPlanKey || requestId;
  const pending = pendingApprovals.get(lookupKey) || pendingApprovals.get(requestId);
  if (!pending) {
    return res.status(404).json({ error: 'No pending approval with this requestId' });
  }

  const decidedAt = Date.now();
  const status = normalizePlanStatus(approved === true ? 'in_progress' : 'canceled');
  const hasPayloadOverride = payload && typeof payload === 'object' && !Array.isArray(payload);
  if (hasPayloadOverride && !isPlausiblePlanPayload(payload)) {
    return res.status(400).json({ error: 'Invalid approval payload shape' });
  }

  const nextPlanPayload = hasPayloadOverride ? payload : (pending.plan ?? pending.payload);
  const normalizedPlan = normalizePlanForStorage(nextPlanPayload);
  const updated = {
    ...pending,
    payload: normalizedPlan,
    plan: normalizedPlan,
    status,
    updatedAt: decidedAt,
    decision: {
      approved: approved === true,
      decidedAt,
    },
  };
  pendingApprovals.set(updated.planKey || lookupKey, updated);
  if (updated.requestId && updated.requestId !== (updated.planKey || lookupKey)) pendingApprovals.set(updated.requestId, updated);
  persistPlanRecord(updated);

  const decisionRecord = {
    requestId,
    approved: approved === true,
    decidedAt,
    username: updated.username || null,
    agentId: updated.agentId || null,
    sessionId: updated.sessionId || null,
    payload: updated.payload ?? null,
  };
  approvalDecisions.set(requestId, decisionRecord);

  const username = typeof updated.username === 'string' ? updated.username.trim() : '';
  const agentId = typeof updated.agentId === 'string' ? updated.agentId.trim() : '';
  const sessionId = typeof updated.sessionId === 'string' ? updated.sessionId.trim() : '';
  const hasCompleteLoopKey = Boolean(username && agentId && sessionId);
  const loopKey = `${username}:${agentId}:${sessionId}`;

  if (username) {
    broadcastToUser(username, 'approval:decision', {
      requestId,
      agentId: updated.agentId || null,
      sessionId: updated.sessionId || null,
      approved: approved === true,
      payload: updated.payload ?? null,
      plan: updated.plan ?? null,
      status,
    });
  }

  let delivery = 'recorded';
  if (approved === true && hasCompleteLoopKey) {
    const existingQueue = approvalDeliveryQueue.get(loopKey) || [];
    approvalDeliveryQueue.set(loopKey, [...existingQueue, decisionRecord]);
    const isRunning = runningAgentControllers.has(loopKey);
    const flushScheduled = !isRunning && flushApprovalContinuationIfIdle({ username, agentId, sessionId });
    delivery = isRunning
      ? 'queued_until_idle'
      : (flushScheduled ? 'scheduled_immediate_idle_delivery' : 'queued_for_immediate_idle_delivery');
  } else if (approved === true) {
    delivery = 'recorded_without_session_delivery_key';
  }

  return res.json({
    success: true,
    status,
    requestId,
    planKey: updated.planKey || requestId,
    agentId: updated.agentId || null,
    sessionId: updated.sessionId || null,
    approved: approved === true,
    delivery,
  });
});

export default router;