import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { globalCircuitBreaker, runningAgentControllers } from '../services/runtime.js';

const router = Router();

function resolveScopedUsername(req) {
  return String(req.username || req.user?.username || '').trim();
}

router.get('/admin/circuit-breaker/status', checkLocalAccess, (req, res) => {
  return res.json(globalCircuitBreaker.status());
});

router.post('/admin/circuit-breaker/reset', checkLocalAccess, (req, res) => {
  globalCircuitBreaker.reset();
  return res.json({ success: true });
});

router.post('/agent/stop', checkLocalAccess, (req, res) => {
  const username = resolveScopedUsername(req);
  const { agentId, sessionId } = req.body;
  if (!username) return res.status(401).json({ error: 'authenticated username required' });

  const stopped = [];

  if (agentId) {
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required when agentId is provided' });

    const key = `${username}:${agentId}:${sessionId}`;
    const ctrl = runningAgentControllers.get(key);
    if (ctrl) {
      ctrl.abort();
      runningAgentControllers.delete(key);
      stopped.push(`${agentId}:${sessionId}`);
    }
  } else {
    for (const [key, ctrl] of runningAgentControllers.entries()) {
      if (key.startsWith(`${username}:`)) {
        ctrl.abort();
        runningAgentControllers.delete(key);
        stopped.push(key.split(':').slice(1).join(':'));
      }
    }
  }

  return res.json({ success: true, stopped, count: stopped.length });
});

router.post('/admin/digest', checkLocalAccess, async (req, res) => {
  return res.json({
    success: true,
    digest: null,
    createdAt: null,
    note: 'digest endpoint preserved but final digest generator still depends on monolith-only memory summarizer',
  });
});

export default router;