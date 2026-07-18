import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { getConfig, saveConfig, patchConfig } from '../services/userStateService.js';

const router = Router();

router.get('/config', checkLocalAccess, async (req, res) => {
  const username = String(req.username || req.query?.username || 'admin');
  const config = await getConfig(username);
  return res.json(config);
});

// POST /api/config — salva config completa (legado, mantido para compatibilidade)
router.post('/config', checkLocalAccess, (req, res) => {
  const username = String(req.username || req.body?.username || 'admin');
  const { config } = req.body;
  if (!config) {
    return res.status(400).json({ error: 'config required' });
  }

  saveConfig(username, config);
  return res.json({ success: true, username });
});

// PATCH /api/config — merge cirúrgico de um ou mais campos específicos
// Body: { username, fields: { workflows: [...], apiKeys: [...], ... } }
// Nunca sobrescreve campos não enviados.
router.patch('/config', checkLocalAccess, (req, res) => {
  const username = String(req.username || req.body?.username || 'admin');
  const { fields } = req.body;
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'fields required' });
  }

  patchConfig(username, fields);
  return res.json({ success: true, username });
});

export default router;
