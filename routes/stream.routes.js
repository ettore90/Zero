import { Router } from 'express';
import { attachUserStream } from '../services/streamBroker.js';

const router = Router();

router.get('/stream', (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ error: 'username required' });
  }

  attachUserStream(String(username), req, res);
});

export default router;