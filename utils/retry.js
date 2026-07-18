export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calculateRetryDelay(attempt, baseDelay = 250, maxDelay = 5000) {
  const delay = Math.min(maxDelay, baseDelay * Math.pow(2, Math.max(0, attempt - 1)));
  return delay;
}

export async function withRetry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelay = 250,
    maxDelay = 5000,
    shouldRetry = () => true,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn({ attempt, maxAttempts });
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      await sleep(calculateRetryDelay(attempt, baseDelay, maxDelay));
    }
  }

  throw lastError;
}