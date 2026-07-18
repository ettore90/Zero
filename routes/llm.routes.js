import { Router } from 'express';
import { ollamaChat, ollamaGenerate } from '../services/ollamaService.server.js';

const router = Router();

router.post('/llm/complete', async (req, res) => {
  try {
    const result = await ollamaGenerate(req.body || {});
    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    return res.send(result.body);
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;