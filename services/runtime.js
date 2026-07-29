import { createSessionStore } from '../sessionStore.js';
import { env } from '../config/env.js';
import { globalCircuitBreaker } from './circuitBreaker.js';

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
