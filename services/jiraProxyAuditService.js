import crypto from 'node:crypto';
import { getDb } from '../db.js';

function now() { return Math.floor(Date.now() / 1000); }

export function recordJiraProxyAudit({ actor = null, method, path, status, mutable = false }) {
  try {
    getDb().prepare('INSERT INTO jira_proxy_audits (id,actor,method,path,status,mutable,occurred_at) VALUES (?,?,?,?,?,?,?)')
      .run(`jira_proxy_audit_${crypto.randomUUID().replace(/-/g, '')}`, actor, method, path, Number(status) || 0, mutable ? 1 : 0, now());
  } catch { /* audit failure never exposes credentials or blocks a Jira result */ }
}

export function listJiraProxyAudits(limit = 50) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
  return getDb().prepare('SELECT actor,method,path,status,mutable,occurred_at AS occurredAt FROM jira_proxy_audits ORDER BY occurred_at DESC, id DESC LIMIT ?')
    .all(safeLimit).map((row) => ({ ...row, mutable: Boolean(row.mutable) }));
}
