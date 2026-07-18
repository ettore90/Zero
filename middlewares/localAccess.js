import { env } from '../config/env.js';

export function checkLocalAccess(req, res, next) {
  if (!env.ALLOW_LOCAL_ACCESS) {
    return res.status(403).json({
      error: 'Local system access is disabled. Start server with ALLOW_LOCAL_ACCESS=true to enable.',
    });
  }

  return next();
}