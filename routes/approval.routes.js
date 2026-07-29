import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { pendingApprovals, approvalDecisions, approvalDeliveryQueue, runningAgentControllers } from '../services/runtime.js';
import { broadcastToUser } from '../services/streamBroker.js';
import { flushApprovalContinuationIfIdle } from '../services/llmService.js';

const router = Router();

router.post('/approval/respond', checkLocalAccess, (req, res) => {
  const { requestId, approved, payload } = req.body;

  if (!requestId) {
    return res.status(400).json({ error: 'requestId required' });
  }

  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    return res.status(404).json({ error: 'No pending approval with this requestId' });
  }

  const decidedAt = Date.now();
  const status = approved === true ? 'approved' : 'rejected';
  const hasPayloadOverride = payload && typeof payload === 'object';
  const updated = {
    ...pending,
    payload: hasPayloadOverride ? payload : pending.payload,
    plan: hasPayloadOverride ? payload : pending.plan,
    status,
    updatedAt: decidedAt,
    decision: {
      approved: approved === true,
      decidedAt,
    },
  };
  pendingApprovals.set(requestId, updated);

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
    agentId: updated.agentId || null,
    sessionId: updated.sessionId || null,
    approved: approved === true,
    delivery,
  });
});

export default router;