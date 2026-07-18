import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { readState, writeState } from '../services/userStateService.js';

const router = Router();

router.get('/alerts', checkLocalAccess, (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'username required' });

  const state = readState(username) || {};
  return res.json({ alerts: state.alerts || [] });
});

router.post('/alerts/read', checkLocalAccess, (req, res) => {
  const { username, ids } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  const state = readState(username) || {};
  if (!state.alerts) return res.json({ success: true });

  state.alerts = state.alerts.map((a) =>
    !ids || ids.includes(a.id) ? { ...a, read: true } : a
  );

  writeState(username, state);
  return res.json({ success: true });
});

export default router;