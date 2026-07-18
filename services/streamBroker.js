import { readState } from './userStateService.js';

const activeStreams = new Map();

export function getStreams(username) {
  if (!activeStreams.has(username)) {
    activeStreams.set(username, new Set());
  }
  return activeStreams.get(username);
}

export function broadcastToUser(username, event, data) {
  const streams = getStreams(username);
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const res of streams) {
    try {
      res.write(payload);
    } catch {}
  }
}

export function attachUserStream(username, req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {}
  }, 30000);

  const state = readState(username) || {};
  const unread = (state.alerts || []).filter((a) => !a.read);

  if (unread.length > 0) {
    res.write(`event: alerts\ndata: ${JSON.stringify({ alerts: unread })}\n\n`);
  }

  getStreams(username).add(res);
  console.log(`[SSE] Client connected | user: ${username} | total: ${getStreams(username).size}`);

  req.on('close', () => {
    clearInterval(heartbeat);
    getStreams(username).delete(res);
    console.log(`[SSE] Client disconnected | user: ${username} | total: ${getStreams(username).size}`);
  });
}