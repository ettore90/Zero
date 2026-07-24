#!/usr/bin/env node

import { createReport } from './shared/report.mjs';

const HEALTH_URL = 'http://playwright-runner:3021/health';
const SESSION_URL = 'http://playwright-runner:3021/session';
const ZERO_URL = 'http://zero:3010/zero/';
const GREEN_URL = 'http://green:3011/green/';

function getSessionId(payload) {
  return payload?.sessionId || payload?.id || payload?.data?.sessionId || payload?.data?.id || '';
}

function isUrlExpected(actual, expected) {
  return typeof actual === 'string' && actual === expected;
}

function isTitleExpected(actual, expected) {
  return typeof actual === 'string' && actual.includes(expected);
}

function isCountExpected(actual) {
  return Number(actual) === 1;
}

async function httpJson(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch {}
  }
  return { status: response.status, headers: response.headers, text, json };
}

async function ensureSessionClosed(sessionId, report) {
  if (!sessionId) return;
  try {
    const closeResponse = await httpJson(`${SESSION_URL}/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    report.add(`session:close:status=${closeResponse.status}`);
    if (closeResponse.status !== 200 || !closeResponse.json || closeResponse.json.ok !== true) {
      throw new Error(`session close returned unexpected response status=${closeResponse.status} body=${JSON.stringify(closeResponse.json)}`);
    }
  } catch (error) {
    report.add(`session:close:error=${error?.message || 'unknown'}`);
  }
}

async function runPageChecks(sessionId, label, url, expectedTitle, report) {
  const gotoResponse = await httpJson(`${SESSION_URL}/${encodeURIComponent(sessionId)}/goto`, {
    method: 'POST',
    body: { url },
  });
  const gotoOk = gotoResponse.status >= 200 && gotoResponse.status < 300;
  if (!gotoOk) throw new Error(`${label}: goto failed with status ${gotoResponse.status}`);

  const checks = [
    { mode: 'url', expected: url },
    { mode: 'title', expected: expectedTitle },
    { mode: 'count', selector: '#root', expected: 1 },
  ];

  for (const check of checks) {
    const response = await httpJson(`${SESSION_URL}/${encodeURIComponent(sessionId)}/evaluate`, {
      method: 'POST',
      body: check,
    });
    const result = response.json;
    if (response.status !== 200) throw new Error(`${label}: evaluate ${check.mode} failed with status ${response.status}`);
    if (!result || result.ok !== true || !('result' in result)) {
      throw new Error(`${label}: evaluate ${check.mode} returned unexpected body ${JSON.stringify(result)}`);
    }
    const value = result.result;
    report.add(`${label}:evaluate:${check.mode}=${String(value)}`);
    if (check.mode === 'url' && !isUrlExpected(value, check.expected)) throw new Error(`${label}: expected url ${check.expected}, received ${String(value)}`);
    if (check.mode === 'title' && !isTitleExpected(value, check.expected)) throw new Error(`${label}: expected title containing ${check.expected}, received ${String(value)}`);
    if (check.mode === 'count' && !isCountExpected(value)) throw new Error(`${label}: expected count=1 for #root, received ${String(value)}`);
  }
}

export async function runPlaywrightRunnerSmoke() {
  const report = createReport('playwright-runner-smoke');
  let sessionId = '';
  report.add(`healthUrl=${HEALTH_URL}`);
  report.add(`sessionUrl=${SESSION_URL}`);

  try {
    const health = await httpJson(HEALTH_URL);
    report.add(`healthStatus=${health.status}`);
    if (health.status !== 200) throw new Error(`Expected GET /health to return 200, received ${health.status}`);

    const session = await httpJson(SESSION_URL, { method: 'POST', body: {} });
    report.add(`sessionCreateStatus=${session.status}`);
    sessionId = getSessionId(session.json);
    report.add(`sessionId=${sessionId || 'missing'}`);
    if (session.status !== 200 && session.status !== 201) throw new Error(`Expected POST /session to return 200/201, received ${session.status}`);
    if (!sessionId) throw new Error('POST /session did not return a session id');

    await runPageChecks(sessionId, 'zero', ZERO_URL, 'Zero', report);
    await runPageChecks(sessionId, 'green', GREEN_URL, 'Green', report);

    report.add('checks=passed');
  } finally {
    await ensureSessionClosed(sessionId, report);
    console.log(report.toString());
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPlaywrightRunnerSmoke().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
