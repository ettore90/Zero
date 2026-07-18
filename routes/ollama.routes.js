import { Router } from 'express';
import { env } from '../config/env.js';

const router = Router();

router.get('/api/tags', async (req, res) => {
  try {
    const upstream = await fetch(`${env.OLLAMA_SERVER}/api/tags`);
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({
      error: 'Falha ao acessar Ollama',
      detail: String(err?.message || err),
    });
  }
});

router.post('/api/embeddings', async (req, res) => {
  try {
    const upstream = await fetch(`${env.OLLAMA_SERVER}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });
    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    return res.status(500).json({
      error: 'Falha ao acessar Ollama',
      detail: String(err?.message || err),
    });
  }
});

router.post('/api/chat', async (req, res) => {
  try {
    const upstream = await fetch(`${env.OLLAMA_SERVER}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (err) {
    return res.status(500).json({
      error: 'Falha ao acessar Ollama',
      detail: String(err?.message || err),
    });
  }
});

export default router;