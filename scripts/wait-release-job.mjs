#!/usr/bin/env node
/**
 * wait-release-job.mjs
 * Polls the release-runner until the current job finishes.
 * Usage: node scripts/wait-release-job.mjs [timeoutSeconds]
 */

const RUNNER_URL = process.env.RELEASE_RUNNER_URL || 'http://release-runner:3020';
const POLL_INTERVAL_MS = 4000;
const TIMEOUT_MS = (Number(process.argv[2] || 300)) * 1000;

async function poll() {
  const start = Date.now();

  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed > TIMEOUT_MS) {
      console.error(`[wait] Timeout after ${TIMEOUT_MS / 1000}s`);
      process.exit(2);
    }

    let job;
    try {
      const res = await fetch(`${RUNNER_URL}/jobs/current`);
      job = await res.json();
    } catch (err) {
      console.log(`[wait] Runner unreachable: ${err.message} — retrying...`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (!job.active) {
      // No active job — fetch last job from runtime dir to get result
      console.log('[wait] No active job. Done.');
      process.exit(0);
    }

    const step = job.currentStep || '?';
    const elapsed_s = Math.round(elapsed / 1000);
    console.log(`[wait] ${elapsed_s}s — step: ${step} | status: ${job.status}`);

    await sleep(POLL_INTERVAL_MS);
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

poll();
