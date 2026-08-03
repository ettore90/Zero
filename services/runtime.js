import { createSessionStore } from '../sessionStore.js';
import { env } from '../config/env.js';
import { globalCircuitBreaker } from './circuitBreaker.js';
import { hydratePlansFromStore, normalizePlanStatus } from './planState.js';
import { hydratePlanStore } from './planStore.js';

export const sessionStore = createSessionStore(env.STORAGE_PATH);

// requestId -> { requestId, username, agentId, sessionId, tool_call_id, payload, status, createdAt, updatedAt, decision? }
export const pendingApprovals = new Map();

// requestId -> { requestId, approved, decidedAt, username, agentId, sessionId }
export const approvalDecisions = new Map();

// `${username}:${agentId}:${sessionId}` -> AbortController
export const runningAgentControllers = new Map();

// `${username}:${agentId}:${sessionId}` -> approval delivery items awaiting same-session continuation
export const approvalDeliveryQueue = new Map();

export { globalCircuitBreaker };
// `${username}:${agentId}:${sessionId}` -> boolean guard to avoid duplicate idle approval flush scheduling
export const approvalFlushInFlight = new Map();

const reconcileHydratedPlans = () => {
  const hydratedPlans = hydratePlansFromStore() || hydratePlanStore() || [];
  pendingApprovals.clear();
  approvalDecisions.clear();

  for (const record of hydratedPlans) {
    if (!record || typeof record !== 'object') continue;
    const requestId = typeof record.requestId === 'string' ? record.requestId.trim() : '';
    if (!requestId) continue;

    const normalizedRecord = { ...record, status: normalizePlanStatus(record?.status) || 'open' };
    pendingApprovals.set(requestId, normalizedRecord);
    if (record.decision && typeof record.decision === 'object') {
      approvalDecisions.set(requestId, {
        requestId,
        approved: Boolean(record.decision.approved),
        decidedAt: Number.isFinite(Number(record.decision.decidedAt)) ? Number(record.decision.decidedAt) : (Number.isFinite(Number(record.updatedAt)) ? Number(record.updatedAt) : Date.now()),
        username: typeof record.username === 'string' ? record.username.trim() : '',
        agentId: typeof record.agentId === 'string' ? record.agentId.trim() : null,
        sessionId: typeof record.sessionId === 'string' ? record.sessionId.trim() : null,
      });
    }
  }

  return hydratedPlans;
};

reconcileHydratedPlans();
