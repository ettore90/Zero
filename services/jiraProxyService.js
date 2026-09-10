// =============================================================================
// jiraProxyService.js — credential-injecting passthrough to the Jira REST API
// =============================================================================
// Callers hit Zero with a real Jira REST path and no credential; Zero attaches
// the stored one and forwards. The point is reach and rate limits: the Jira MCP
// covers a fraction of the REST surface and throttles harder than the API does.
//
// This is deliberately NOT shaped like routes/proxy.routes.js. That one takes
// its target URL from the request, which makes it an open SSRF relay. Here the
// host is a constant, the path must be under /rest/, and nothing in the request
// can redirect the call somewhere else.
// =============================================================================

import { readState } from './userStateService.js';
import { resolveSecrets } from '../utils/resolveSecrets.js';

export const JIRA_HOSTNAME = 'stefaninisophiedelivery.atlassian.net';

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_PATH_PREFIX = 'rest/';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const PASSTHROUGH_RESPONSE_HEADERS = [
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-interval-seconds',
  'x-ratelimit-fillrate-seconds',
  'retry-after',
  'x-aretry-after',
];

/**
 * Canonical token resolution order:
 *   1. the current user's stored secret (apiKeys in user state), JIRA_KEY or JIRA_TOKEN
 *   2. the x-jira-token header, raw or as a {{JIRA_KEY}} placeholder
 *   3. the JIRA_TOKEN environment variable
 */
export function getJiraToken(req) {
  const username = req.user?.username || req.headers['x-username'] || '';

  if (username) {
    try {
      const state = readState(username) || {};
      const apiKeys = state.apiKeys || [];
      const stored = apiKeys.find((k) => k.name === 'JIRA_KEY' || k.name === 'JIRA_TOKEN');
      if (stored?.value?.trim()) return stored.value.trim();
    } catch {
      // non-fatal: fall through to header/env
    }
  }

  const headerRaw = (req.headers['x-jira-token'] || '').trim();
  if (headerRaw) {
    if (headerRaw.includes('{{') && username) {
      try {
        const state = readState(username) || {};
        const resolved = resolveSecrets(headerRaw, state.apiKeys || []);
        if (resolved && !resolved.includes('{{')) return resolved;
      } catch {
        // fall through
      }
    }
    if (!headerRaw.includes('{{')) return headerRaw;
  }

  return (process.env.JIRA_TOKEN || '').trim();
}

/**
 * Explains why getJiraToken came back empty, naming the header that actually
 * fixes it. The credential is stored per user, so the usual cause is a request
 * with no `x-username` at all -- and the old message never mentioned it, which
 * sent callers off to re-store a secret that was already there.
 */
export function describeMissingCredential(req) {
  const username = req.user?.username || req.headers['x-username'] || '';

  if (!username) {
    return 'No Jira credential available: the request carried no user, so there '
      + "was no stored secret to look up. Send the header `x-username: <user>` "
      + "(e.g. `-H 'x-username: ettore'`) -- that is what selects whose stored "
      + 'credential is used. Alternatively send x-jira-token, or set JIRA_TOKEN.';
  }

  return `No Jira credential available for user "${username}": no JIRA_KEY or `
    + 'JIRA_TOKEN is stored in that user\'s Zero secrets. Store one there, or '
    + 'send x-jira-token, or set the JIRA_TOKEN environment variable.';
}

export function buildAuthorizationHeader(token) {
  if (!token) return '';
  if (token.toLowerCase().startsWith('basic ')) return token;

  const raw = token.trim();
  const isLikelyBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(raw) && raw.length >= 8 && raw.length % 4 === 0;
  const looksLikeUsernameKey = raw.includes(':') && !raw.includes(' ');

  return (isLikelyBase64 || looksLikeUsernameKey)
    ? `Basic ${Buffer.from(raw).toString('base64')}`
    : `Basic ${raw}`;
}

/**
 * Validates the caller-supplied path. Returns { path } or { error }.
 * The path is everything after the mount point, e.g. "api/3/issue/ABC-1".
 */
export function normalizeJiraPath(rawPath = '') {
  const trimmed = String(rawPath).replace(/^\/+/, '');
  if (!trimmed) return { error: 'path is required, e.g. rest/api/3/myself' };

  // Reject traversal in both plain and encoded form before anything else.
  const decoded = (() => {
    try {
      return decodeURIComponent(trimmed);
    } catch {
      return trimmed;
    }
  })();
  if (decoded.includes('..') || decoded.includes('\\')) {
    return { error: 'path may not contain ".." or backslashes' };
  }
  if (!trimmed.startsWith(ALLOWED_PATH_PREFIX)) {
    return { error: `path must start with "${ALLOWED_PATH_PREFIX}" (got "${trimmed.split('?')[0]}")` };
  }
  return { path: `/${trimmed}` };
}

/**
 * Forwards one request to Jira. Never returns or logs the credential.
 * Resolves to { status, headers, body } where body is a Buffer.
 */
export async function forwardToJira({ method = 'GET', path, query = '', body, token }) {
  const upper = String(method).toUpperCase();
  if (!ALLOWED_METHODS.has(upper)) {
    return { status: 405, headers: {}, body: Buffer.from(JSON.stringify({ error: `method ${upper} not allowed` })) };
  }

  const url = `https://${JIRA_HOSTNAME}${path}${query ? `?${query}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const hasBody = body !== undefined && body !== null && upper !== 'GET' && upper !== 'DELETE';
    const response = await fetch(url, {
      method: upper,
      headers: {
        Authorization: buildAuthorizationHeader(token),
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      body: hasBody ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      return {
        status: 502,
        headers: {},
        body: Buffer.from(JSON.stringify({
          error: `Jira response exceeded ${MAX_RESPONSE_BYTES} bytes; narrow the query or use pagination`,
        })),
      };
    }

    // Rate-limit signals are the whole reason to prefer the API over the MCP,
    // so they have to survive the hop. Everything else is dropped -- notably
    // set-cookie, which must not leak back to the caller.
    const headers = { 'content-type': response.headers.get('content-type') || 'application/json' };
    for (const name of PASSTHROUGH_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) headers[name] = value;
    }

    return { status: response.status, headers, body: buffer };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      status: aborted ? 504 : 502,
      headers: {},
      body: Buffer.from(JSON.stringify({
        error: aborted ? `Jira request timed out after ${REQUEST_TIMEOUT_MS}ms` : 'Jira request failed',
        // err.message can carry the URL but never the Authorization header.
        detail: aborted ? undefined : String(err?.message || err),
      })),
    };
  } finally {
    clearTimeout(timer);
  }
}
