import { Router } from 'express';
import { executeProxyRequest } from '../services/proxyService.js';

const router = Router();

router.post('/proxy', async (req, res) => {
  const { targetUrl, headers, body, method } = req.body || {};

  if (!targetUrl) {
    return res.status(400).json({ error: 'targetUrl required' });
  }

  try {
    const response = await executeProxyRequest({
      targetUrl,
      headers,
      body,
      method,
    });

    if (response.status >= 300 && response.status < 400) {
      return res.status(401).json({
        error: 'Authentication Failed (Upstream Redirect)',
        details: `The API endpoint rejected the request and attempted to redirect to: ${response.headers.get('location')}`,
      });
    }

    res.status(response.status);

    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'access-control-allow-origin'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (!errorText || !errorText.trim()) {
        return res.json({
          error: `Upstream Provider Error (${response.status})`,
          details: 'The upstream server returned an error with no body content.',
        });
      }
      return res.send(errorText);
    }

    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }

    res.end();
  } catch (error) {
    console.error('[CODex] LLM Proxy Error:', error);
    res.status(502).json({ error: `Proxy Request Failed: ${error.message}` });
  }
});

export default router;