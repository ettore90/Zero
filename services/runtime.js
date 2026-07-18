import { createSessionStore } from '../sessionStore.js';
import { env } from '../config/env.js';
import { globalCircuitBreaker } from './circuitBreaker.js';

export const sessionStore = createSessionStore(env.STORAGE_PATH);

// requestId -> { resolve, reject }
export const pendingApprovals = new Map();

// `${username}:${agentId}:${sessionId}` -> AbortController
export const runningAgentControllers = new Map();

export { globalCircuitBreaker };