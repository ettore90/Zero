import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { migrateLegacyJsonAgents } from '../services/agentStore.js';
import { readState } from '../services/userStateService.js';

const router = Router();

router.post('/migrate', checkLocalAccess, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });

  try {
    const state = readState(username);
    if (!state) {
      return res.json({ migrated: false, reason: 'no state found' });
    }

    const migration = migrateLegacyJsonAgents(username);
    const legacyAgentCount = migration.migrated
      ? (Array.isArray(migration.agents) ? migration.agents.length : 0)
      : 0;

    return res.json({
      migrated: migration.migrated || legacyAgentCount > 0,
      agentCount: legacyAgentCount,
      sqliteAgentCount: Array.isArray(migration.agents) ? migration.agents.length : 0,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;