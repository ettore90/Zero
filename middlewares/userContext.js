import { ensureUser, resolveSessionFromRequest } from '../services/userSessionService.js';
import { sanitizeUsername } from '../services/userStateService.js';

export function attachUserContext(req, _res, next) {
  const resolved = resolveSessionFromRequest(req);
  if (resolved?.user) {
    req.user = resolved.user;
    req.session = resolved.session;
    req.username = resolved.user.username;
    return next();
  }

  const explicit = String(
    req.query?.username ||
    req.body?.username ||
    req.headers['x-username'] ||
    ''
  ).trim();

  const username = sanitizeUsername(explicit);
  if (username) {
    const user = ensureUser(username, { metadata: { source: 'request-fallback' } });
    req.user = user;
    req.session = null;
    req.username = user?.username || username;
    return next();
  }

  req.user = null;
  req.session = null;
  req.username = '';
  return next();
}
