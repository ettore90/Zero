import { Router } from 'express';
import { createLoginSession, logoutByToken } from '../services/userSessionService.js';

const router = Router();

router.post('/auth/login', async (req, res) => {
  const username = String(req.body?.username || req.username || 'admin').trim() || 'admin';
  const normalizedUsername = username.toLowerCase();
  const { user, session } = createLoginSession(normalizedUsername, { source: 'auth-login' });

  return res.json({
    ok: true,
    token: session.token,
    sessionToken: session.token,
    sessionId: session.id,
    username: user.username,
    user,
  });
});

router.post('/auth/logout', async (req, res) => {
  const token = String(req.headers.authorization || '').startsWith('Bearer ')
    ? String(req.headers.authorization).slice(7).trim()
    : String(req.body?.token || req.headers['x-session-token'] || '').trim();

  if (!token) return res.json({ ok: true, loggedOut: false });
  return res.json({ ok: true, loggedOut: logoutByToken(token) });
});

router.get('/auth/me', async (req, res) => {
  const hasSession = Boolean(req.session && req.user && req.username);
  return res.json({
    ok: true,
    authenticated: hasSession,
    username: hasSession ? req.username : '',
    user: hasSession ? (req.user || null) : null,
    session: hasSession ? (req.session || null) : null,
  });
});

export default router;
