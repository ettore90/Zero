// workflow-runs.routes.js — Serve histórico de runs dos workflows a partir do SQLite
import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { cancelWorkflow, runScheduledWorkflow } from '../workflowExecutor.js';
import { getDb } from '../db.js';

const router = Router();


function normalizePersistedStatus(status) {
    if (status === 'success') return 'completed';
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'running') return status;
    return status || 'running';
}

function mapDbRunsToResponse(rows) {
    const runsById = new Map();
    for (const row of rows) {
        runsById.set(row.id, {
            id: row.id,
            workflowName: row.workflow_name || 'unknown',
            workflowId: row.workflow_id,
            startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
            finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
            status: normalizePersistedStatus(row.status),
            events: [],
        });
    }
    return runsById;
}

function attachDbEvents(runsById, eventRows) {
    for (const row of eventRows) {
        const run = runsById.get(row.run_id);
        if (!run) continue;
        const event = {
            event: row.event,
            workflow: row.workflow_name || run.workflowName,
            workflowName: row.workflow_name || run.workflowName,
            workflowId: row.workflow_id || run.workflowId,
            timestamp: new Date(row.timestamp).toISOString(),
            nodeId: row.node_id,
            nodeLabel: row.node_label,
            agentId: row.agent_id,
            message: row.message,
            payload: (() => { try { return JSON.parse(row.payload); } catch { return row.payload; } })(),
        };
        run.events.push(event);
        if (row.event === 'workflow_complete') {
            run.finishedAt = event.timestamp;
            const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
            const hasErrorSignal = Boolean(
                row.message ||
                payload.error ||
                payload.errors?.length ||
                payload.nodeErrors?.length ||
                payload.failed ||
                payload.status === 'failed' ||
                row.node_label === 'all_attempts_failed' ||
                row.node_label === 'node_exception' ||
                row.node_label === 'node_error' ||
                row.event === 'inactivity_timeout' ||
                payload.reason === 'inactivity_timeout'
            );
            run.status = hasErrorSignal ? 'failed' : 'completed';
        } else if (row.event === 'workflow_cancelled') {
            run.finishedAt = event.timestamp;
            run.status = 'cancelled';
        } else if (row.event === 'inactivity_timeout') {
            run.finishedAt = event.timestamp;
            run.status = 'failed';
        } else if (row.event === 'all_attempts_failed' || row.event === 'node_exception' || row.event === 'node_error') {
            run.status = 'failed';
        }
    }
}

function normalizeRuns(runs) {
    return runs;
}

function readRunsFromDb(workflowName, workflowId) {
    const db = getDb();
    const clauses = [];
    const params = {};
    if (workflowName) {
        clauses.push('workflow_name = @workflowName');
        params.workflowName = workflowName;
    }
    if (workflowId) {
        clauses.push('workflow_id = @workflowId');
        params.workflowId = workflowId;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const runs = db.prepare(`
        SELECT id, workflow_id, workflow_name, status, started_at, finished_at
          FROM workflow_runs
          ${where}
         ORDER BY started_at DESC
         LIMIT 50
    `).all(params);

    const runIds = runs.map(r => r.id);
    const events = runIds.length ? db.prepare(`
        SELECT id, run_id, workflow_id, workflow_name, event, node_id, node_label, agent_id, message, payload, timestamp
          FROM workflow_run_events
         WHERE run_id IN (${runIds.map(() => '?').join(',')})
         ORDER BY timestamp ASC
    `).all(...runIds) : [];

    const runsById = mapDbRunsToResponse(runs);
    attachDbEvents(runsById, events);
    return normalizeRuns(Array.from(runsById.values()).reverse());
}

// GET /api/workflow-runs?workflowName=xxx
router.get('/workflow-runs', checkLocalAccess, (req, res) => {
    const { workflowName, workflowId, legacyFallback } = req.query;

    let filtered = [];
    let dbReadFailed = false;
    try {
        filtered = readRunsFromDb(workflowName, workflowId);
    } catch {
        dbReadFailed = true;
    }

    res.json({ runs: filtered.slice(0, 50), legacyFallbackUsed: false, dbReadFailed });
});

function normalizeTrustedUsername(value) {
    const username = String(value || '').trim();
    if (!username || username === 'local') return '';
    return username;
}

function resolveCanonicalUsername(req) {
    const authenticatedCandidates = [
        req.user?.username,
        req.userContext?.username,
        req.auth?.username,
        req.session?.username,
        req.username,
    ];

    for (const candidate of authenticatedCandidates) {
        const username = normalizeTrustedUsername(candidate);
        if (username) return username;
    }

    const explicitCandidates = [
        req.hasExplicitRequestUsername ? req.requestUsername : '',
        req.trustedRequestUsername,
        req.body?.requestUsername,
        req.body?.username,
        req.body?.userName,
        req.body?.actorUsername,
        req.query?.requestUsername,
        req.query?.username,
    ];

    for (const candidate of explicitCandidates) {
        const username = normalizeTrustedUsername(candidate);
        if (username) return username;
    }

    return '';
}

function findWorkflowByIdOrName(workflows, workflowId) {
    const list = Array.isArray(workflows) ? workflows : [];
    return list.find((item) => item.id === workflowId || item.name === workflowId) || null;
}

function findWorkflowByExactId(workflows, workflowId) {
    const list = Array.isArray(workflows) ? workflows : [];
    return list.find((item) => item?.id === workflowId) || null;
}

async function findPersistedWorkflowForStart(username, workflowId) {
    const { getConfig } = await import('../services/userStateService.js');
    const actorConfig = await getConfig(username);
    const actorWorkflow = findWorkflowByIdOrName(actorConfig?.workflows, workflowId);
    if (actorWorkflow) {
        return { workflow: actorWorkflow, sourceUsername: username, lookup: 'actor-config' };
    }

    const rows = getDb().prepare(`
        SELECT u.username, uc.config_json
        FROM user_config uc
        JOIN users u ON u.id = uc.user_id
        WHERE u.username = ?
        ORDER BY uc.updated_at DESC, uc.created_at DESC
    `).all(username);

    const exactMatches = [];
    for (const row of rows) {
        let config = {};
        try {
            config = JSON.parse(row.config_json || '{}');
        } catch {
            config = {};
        }
        const workflow = findWorkflowByExactId(config?.workflows, workflowId);
        if (workflow) {
            exactMatches.push({ workflow, sourceUsername: row.username });
        }
    }

    if (exactMatches.length > 1) {
        const error = new Error(`Multiple workflows found with id '${workflowId}' for user '${username}'`);
        error.statusCode = 409;
        throw error;
    }

    if (exactMatches.length === 1) {
        return { ...exactMatches[0], lookup: 'user-exact-id' };
    }

    return { workflow: null, sourceUsername: '', lookup: 'not-found' };
}

// POST /api/workflow-runs/start — inicia um workflow manualmente no backend
router.post('/workflow-runs/start', checkLocalAccess, async (req, res) => {
    const { workflowId } = req.body || {};
    const observabilityMode = req.body?.observabilityMode === 'audit' ? 'audit' : 'default';
    if (!workflowId) return res.status(400).json({ success: false, error: 'workflowId required' });

    try {
        const username = resolveCanonicalUsername(req);
        if (!username) {
            return res.status(401).json({
                success: false,
                error: 'authenticated username required',
            });
        }

        const { workflow: wf } = await findPersistedWorkflowForStart(username, workflowId);
        if (!wf) return res.status(404).json({ success: false, error: `Workflow '${workflowId}' not found.` });

        const { readState, writeState } = await import('../services/userStateService.js');
        const { listAgents, replaceAgents } = await import('../services/agentStore.js');
        const { runAgentLoop } = await import('../services/llmService.js');
        const { broadcastToUser } = await import('../services/streamBroker.js');
        const { fetchWithRetry } = await import('../services/llmService.js');

        let resolveStartConfirmation = () => {};
        const startConfirmationPromise = new Promise((resolve) => {
            resolveStartConfirmation = resolve;
        });

        const workflowDeps = {
            readState,
            writeState,
            getAgents: listAgents,
            saveAgents: replaceAgents,
            broadcastToUser,
            runAgentLoop,
            fetchWithRetry,
            onStartConfirmed: resolveStartConfirmation,
            observabilityMode,
        };

        const runPromise = runScheduledWorkflow(wf, username, workflowDeps);
        const confirmedStart = await Promise.race([
            startConfirmationPromise,
            runPromise.then(() => null),
        ]);

        if (!confirmedStart?.runId) {
            throw new Error(`Workflow start was not durably confirmed for ${wf.id}`);
        }

        runPromise.catch((error) =>
            console.error(`[workflow-runs:start] Error running workflow ${wf.id}: ${error.message}`)
        );

        return res.json({ success: true, workflowId: wf.id, runId: confirmedStart.runId, name: wf.name, status: 'started' });
    } catch (error) {
        const statusCode = Number(error?.statusCode || 0);
        if (statusCode >= 400 && statusCode < 600) {
            return res.status(statusCode).json({ success: false, error: error instanceof Error ? error.message : 'Failed to start workflow' });
        }
        return res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to start workflow' });
    }
});

// POST /api/workflow-runs/cancel — cancela um workflow em execução
router.post('/workflow-runs/cancel', checkLocalAccess, (req, res) => {
    const { workflowId } = req.body;
    if (!workflowId) return res.status(400).json({ success: false, error: 'workflowId required' });
    cancelWorkflow(workflowId);
    res.json({ success: true, message: `Cancellation requested for workflow ${workflowId}` });
});

export default router;
