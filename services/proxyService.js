import { globalCircuitBreaker } from './runtime.js';

const forbiddenHeaders = [
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'content-encoding',
  'keep-alive',
  'upgrade',
  'user-agent',
];

function sanitizeHeaders(headers = {}) {
  const safeHeaders = {};

  for (const [key, value] of Object.entries(headers || {})) {
    if (!forbiddenHeaders.includes(String(key).toLowerCase())) {
      safeHeaders[key] = value;
    }
  }

  safeHeaders['User-Agent'] =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  if (!safeHeaders.Accept) {
    safeHeaders.Accept = 'application/json';
  }

  return safeHeaders;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterMs(response) {
  const retryAfter = response.headers.get('retry-after');
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryDate = Date.parse(retryAfter);
  if (Number.isNaN(retryDate)) return null;

  return Math.max(0, retryDate - Date.now());
}

function calculateBackoffMs(attempt, baseDelay = 1500, maxDelay = 12000) {
  const jitter = Math.floor(Math.random() * 400);
  return Math.min(maxDelay, baseDelay * Math.pow(2, Math.max(0, attempt - 1))) + jitter;
}

function isRetriableStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'manual',
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeProxyRequest({ targetUrl, headers, body, method }) {
  const safeHeaders = sanitizeHeaders(headers);
  const requestBodyString = body ? JSON.stringify(body) : undefined;
  const maxAttempts = 4;
  let lastError;

  const response = await (async () => {
    if (globalCircuitBreaker.isOpen()) {
      throw new Error('Circuit breaker is OPEN');
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetchWithTimeout(targetUrl, {
          method: method || 'POST',
          headers: safeHeaders,
          body: method === 'GET' || method === 'HEAD' ? undefined : requestBodyString,
        });

        if (res.ok || !isRetriableStatus(res.status) || attempt >= maxAttempts) {
          globalCircuitBreaker.recordSuccess();
          return res;
        }

        const waitMs = getRetryAfterMs(res) ?? calculateBackoffMs(attempt);
        console.warn(`[proxy] upstream returned ${res.status}. Retry ${attempt}/${maxAttempts} in ${waitMs}ms: ${targetUrl}`);
        await sleep(waitMs);
      } catch (err) {
        lastError = err;
        if (attempt >= maxAttempts) {
          globalCircuitBreaker.recordFailure();
          throw err;
        }

        const waitMs = calculateBackoffMs(attempt, 800, 8000);
        console.warn(`[proxy] network error on attempt ${attempt}/${maxAttempts}. Retrying in ${waitMs}ms: ${err?.message || err}`);
        await sleep(waitMs);
      }
    }

    globalCircuitBreaker.recordFailure();
    throw lastError || new Error('Proxy request failed after retry attempts');
  })();

  return response;
}
