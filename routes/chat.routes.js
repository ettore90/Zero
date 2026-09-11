import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { resolveModelConfig, runAgentLoop } from '../services/llmService.js';
import { sessionStore } from '../services/runtime.js';

const router = Router();

function resolveScopedUsername(req) {
  return String(req.username || req.user?.username || '').trim();
}

router.post('/chat', checkLocalAccess, async (req, res) => {
  const username = resolveScopedUsername(req);
  const { agentId, newMessage, sessionId, model } = req.body;
  console.log(`[Chat] REQUEST | agentId=${agentId} | model_from_body=${model || 'undefined'} | username=${username}`);
  const legacyMessages = req.body.messages;

  if (req.body._ping) {
    return res.status(400).json({ pong: true });
  }

  if (!username || !agentId) {
    return res.status(!username ? 401 : 400).json({ error: !username ? 'authenticated username required' : 'agentId required' });
  }

  if (!newMessage && !legacyMessages) {
    return res.status(400).json({ error: 'newMessage or messages required' });
  }

  const resolved = resolveModelConfig(username, agentId, model || null);
  if (!resolved) {
    return res.status(404).json({ error: 'Agent or model not found' });
  }
  console.log(`[Chat] RESOLVED | modelId=${resolved.modelConfig.modelId} | provider=${resolved.modelConfig.provider}`);

  let messages;

  if (newMessage && sessionId) {
    const existingSession = sessionStore.getSession(String(sessionId));
    if (existingSession) {
      if (String(existingSession.username) !== String(username)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (String(existingSession.agentId) !== String(agentId)) {
        return res.status(400).json({ error: 'Session does not belong to this agent' });
      }
    }
    const session = sessionStore.ensureSession({ id: sessionId, agentId, username });
    const existingHistory = session.messages || [];

    const userMsg =
      typeof newMessage === 'string'
        ? { role: 'user', content: newMessage, timestamp: Date.now() }
        : { ...newMessage, timestamp: newMessage.timestamp || Date.now() };

    sessionStore.appendMessages(sessionId, [userMsg]);
    messages = [...existingHistory, userMsg];
  } else if (legacyMessages) {
    messages = legacyMessages;
  } else {
    return res.status(400).json({ error: 'newMessage + sessionId required (or legacy messages array)' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await runAgentLoop({
      username,
      agentId,
      messages,
      modelId: model,
      isEphemeral: false,
      onEvent: (event, data) => sendEvent(event, data),
      sessionId,
    });

    if (sessionId) {
      try {
        const updated = sessionStore.getSession(sessionId);
        sendEvent('session_updated', {
          sessionId,
          messageCount: Array.isArray(updated?.messages) ? updated.messages.length : 0,
        });
      } catch {}
    }

    const usage = result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const donePayload = {
      content: result.content,
      tool_calls: undefined,
      toolSummary: result.toolSummary,
      model: resolved.modelConfig.modelId,
      usage,
    };
    if (typeof result.usage?.reasoning_tokens === 'number') {
      donePayload.reasoningTokens = result.usage.reasoning_tokens;
    }
    sendEvent('done', donePayload);
  } catch (err) {
    const errorCode = err?.code || null;
    const errorMessage = String(err?.message || err || 'Unknown error');
    console.error(`[Chat] Error | agent: ${agentId} | ${errorMessage}`);

    if (errorCode === 'AGENT_ALREADY_RUNNING') {
      sendEvent('error', { message: errorMessage, code: errorCode });
      return res.end();
    }

    if (sessionId) {
      try {
        const existingSession = sessionStore.getSession(String(sessionId));
        if (existingSession) {
          if (String(existingSession.username) !== String(username) || String(existingSession.agentId) !== String(agentId)) {
            throw new Error('Session does not belong to this user/agent');
          }
        }
        const session = sessionStore.ensureSession({ id: sessionId, agentId, username });
        const history = Array.isArray(session.messages) ? session.messages : [];
        const lastMessage = history[history.length - 1];
        const marker = `[SYSTEM ERROR]: ${errorMessage}`;

        if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.content !== marker) {
          sessionStore.appendMessages(sessionId, [{
            role: 'assistant',
            content: marker,
            timestamp: Date.now(),
            meta: { internal: true, error: true },
          }]);
        }

        const updated = sessionStore.getSession(sessionId);
        sendEvent('session_updated', {
          sessionId,
          messageCount: Array.isArray(updated?.messages) ? updated.messages.length : 0,
        });
      } catch (persistErr) {
        console.error('[Chat] Failed to persist error marker:', persistErr.message);
      }
    }

    sendEvent('error', { message: errorMessage });
  }

  res.end();
});

export default router;
