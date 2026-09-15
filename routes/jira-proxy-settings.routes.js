import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { readState } from '../services/userStateService.js';
import { forwardToJira } from '../services/jiraProxyService.js';
import { listJiraProxyAudits, recordJiraProxyAudit } from '../services/jiraProxyAuditService.js';

const router = Router();
function operator(req) { return req.session && req.user?.username === 'ettore' && req.user?.role === 'admin' ? req.user.username : null; }
function statusFor(username) { const state = readState(username) || {}; const configured = Boolean((state.apiKeys || []).find((key) => key.name === 'JIRA_KEY' || key.name === 'JIRA_TOKEN')?.value?.trim() || process.env.JIRA_TOKEN); return { id: 'jira-proxy', label: 'Jira Proxy', transport: 'internal', configured, connected: configured, endpoint: '/api/jira/rest/*', capabilities: ['jira-read', 'jira-write'], authentication: 'server-side credential' }; }
router.get('/settings/mcp/connections', checkLocalAccess, (req, res) => { const actor = operator(req); if (!actor) return res.status(401).json({ error: 'authenticated operator session required' }); return res.json({ connections: [statusFor(actor), { id: 'grafana', label: 'Grafana', transport: 'pending', configured: false, connected: false, capabilities: ['dashboard-read'] }, { id: 'mongodb', label: 'MongoDB', transport: 'pending', configured: false, connected: false, capabilities: ['database-read'] }] }); });
router.post('/settings/mcp/jira-proxy/health', checkLocalAccess, async (req, res) => { const actor = operator(req); if (!actor) return res.status(401).json({ error: 'authenticated operator session required' }); const state = readState(actor) || {}; const token = (state.apiKeys || []).find((key) => key.name === 'JIRA_KEY' || key.name === 'JIRA_TOKEN')?.value?.trim() || process.env.JIRA_TOKEN || ''; if (!token) return res.status(409).json({ ok: false, error: 'Jira credential is not configured' }); const result = await forwardToJira({ method: 'GET', path: '/rest/api/3/myself', token }); recordJiraProxyAudit({ actor, method: 'GET', path: '/rest/api/3/myself', status: result.status }); return res.status(result.status >= 200 && result.status < 300 ? 200 : 502).json({ ok: result.status >= 200 && result.status < 300, upstreamStatus: result.status }); });
router.get('/settings/mcp/jira-proxy/audits', checkLocalAccess, (req, res) => { if (!operator(req)) return res.status(401).json({ error: 'authenticated operator session required' }); return res.json({ audits: listJiraProxyAudits() }); });
export default router;
