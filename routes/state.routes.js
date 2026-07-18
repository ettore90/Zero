import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { readState, saveConfig } from '../services/userStateService.js';

const router = Router();

router.get('/state/:username', checkLocalAccess, (req, res) => {
  try {
    const username = req.params.username;
    const state = readState(username);
    if (!state) {
      return res.json(null);
    }

    const { agents: _legacyAgents, ...rest } = state || {};
    return res.json(rest);
  } catch {
    return res.status(500).json({ error: 'Failed to read state from disk' });
  }
});

router.post('/state/:username', checkLocalAccess, (req, res) => {
  const username = req.params.username;

  try {
    const payload = req.body || {};
    const nextConfig = { ...payload };
    delete nextConfig.agents;

    saveConfig(username, nextConfig);

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Failed to write to disk' });
  }
});

export default router;