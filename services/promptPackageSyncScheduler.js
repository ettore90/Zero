import { listPromptPackageSyncJobs } from './promptPackageSyncJobStore.js';
import { getPromptPackageSyncSource, recordPromptPackageSyncCheckpoint } from './promptPackageSyncConfigStore.js';
import { syncPinnedGithubPromptPackageManually } from './promptPackageSyncService.js';
import { normalizePinnedGithubPromptDescriptor, resolveGithubRefToCommit } from './pinnedGithubPromptClient.js';
import { createGithubPrivateReadFetch } from './githubPrivateAccessProvider.js';

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ERROR_LENGTH = 2048;
const MAX_UNIX_SECONDS = 4_102_444_800;
const SCHEDULER_ACTOR = 'prompt-package-scheduler';

function bounded(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function safeNow(now) {
  try {
    const value = now();
    return Number.isInteger(value) && value >= 0 && value <= MAX_UNIX_SECONDS ? value : null;
  } catch {
    return null;
  }
}

const MIN_JOB_INTERVAL_SECONDS = 60;
const MAX_JOB_INTERVAL_SECONDS = 86_400;
const MAX_SOURCE_KEY_LENGTH = 512;
const SAFE_SOURCE_KEY = /^github:[A-Za-z0-9][A-Za-z0-9._/-]*@[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function isSafeSourceKey(value) {
  return typeof value === 'string' && value.length <= MAX_SOURCE_KEY_LENGTH && SAFE_SOURCE_KEY.test(value);
}

function isValidJobInterval(value) {
  return Number.isInteger(value) && value >= MIN_JOB_INTERVAL_SECONDS && value <= MAX_JOB_INTERVAL_SECONDS;
}

function isDue(source, intervalSeconds, nowSeconds) {
  try {
    const lastSyncAt = source.lastSyncAt;
    return lastSyncAt === null || (Number.isInteger(lastSyncAt)
      && nowSeconds >= lastSyncAt + intervalSeconds);
  } catch {
    return false;
  }
}

function safeJobCandidate(job) {
  try {
    if (!job || typeof job !== 'object') return null;
    const sourceKey = job.sourceKey;
    const enabled = job.enabled;
    const intervalSeconds = job.intervalSeconds;
    if (!isSafeSourceKey(sourceKey) || enabled !== true || !isValidJobInterval(intervalSeconds)) return null;
    return { job, sourceKey, intervalSeconds };
  } catch {
    return null;
  }
}

function isEnabledAndDue(source, intervalSeconds, nowSeconds) {
  try {
    return Boolean(source) && source.enabled === true && isDue(source, intervalSeconds, nowSeconds);
  } catch {
    return false;
  }
}

function ownDataValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOwnDataArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key === 'symbol' || !descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    if (key !== 'length' && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false;
  }
  return Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
}

// Job-store descriptors contain the normalizer's derived `paths`; manual sync deliberately
// accepts only the external descriptor contract, so reconstruct it from own data values.
function canonicalDescriptor(job) {
  try {
    const stored = ownDataValue(job, 'descriptor');
    if (!isPlainObject(stored)) return null;
    const sourcePin = ownDataValue(stored, 'sourcePin');
    const artifactPaths = ownDataValue(stored, 'artifactPaths');
    if (!isPlainObject(sourcePin) || !isOwnDataArray(artifactPaths)) return null;
    const external = {
      schemaVersion: ownDataValue(stored, 'schemaVersion'),
      sourcePin: {
        provider: ownDataValue(sourcePin, 'provider'),
        repository: ownDataValue(sourcePin, 'repository'),
        ref: ownDataValue(sourcePin, 'ref'),
        commit: ownDataValue(sourcePin, 'commit'),
      },
      manifestPath: ownDataValue(stored, 'manifestPath'),
      artifactPaths: artifactPaths.map((path) => path),
    };
    // This validates the projection without passing its derived `paths` to manual sync.
    const normalized = normalizePinnedGithubPromptDescriptor(external);
    return {
      schemaVersion: normalized.schemaVersion,
      sourcePin: {
        provider: normalized.sourcePin.provider,
        repository: normalized.sourcePin.repository,
        ref: normalized.sourcePin.ref,
        commit: normalized.sourcePin.commit,
      },
      manifestPath: normalized.manifestPath,
      artifactPaths: normalized.artifactPaths.map((path) => path),
    };
  } catch {
    return null;
  }
}

function safeSyncInput(job, fetchImpl, timeoutMs, commit) {
  try {
    const descriptor = canonicalDescriptor(job);
    if (!descriptor || typeof commit !== 'string') return null;
    descriptor.sourcePin.commit = commit;
    const input = {
      descriptor,
      package: ownDataValue(job, 'package'),
      version: ownDataValue(job, 'version'),
      fetchImpl,
      documentKey: ownDataValue(job, 'documentKey'),
      artifactMappings: ownDataValue(job, 'artifactMappings'),
      timeoutMs,
      actor: SCHEDULER_ACTOR,
    };
    const references = Object.getOwnPropertyDescriptor(job, 'references');
    const details = Object.getOwnPropertyDescriptor(job, 'details');
    if (references && Object.hasOwn(references, 'value')) input.references = references.value;
    if (details && Object.hasOwn(details, 'value')) input.details = details.value;
    return input;
  } catch {
    return null;
  }
}

function safeLog(logger, event) {
  try {
    if (logger && typeof logger.warn === 'function') logger.warn({ event });
  } catch {
    // Logging is intentionally best effort and must not affect scheduler work.
  }
}

/**
 * Creates an inert, opt-in scheduler. It starts no timer and performs no storage I/O until
 * start() or tick() is invoked. tick() only considers work while started; when stopped it
 * returns a safe { started: false } summary. Successful syncs own their checkpoint through
 * the existing manual-sync service. Failures record only a generic bounded checkpoint error.
 */
export function createPromptPackageSyncScheduler(options = {}) {
  const listJobs = typeof options.listJobs === 'function' ? options.listJobs : listPromptPackageSyncJobs;
  const getSource = typeof options.getSource === 'function' ? options.getSource : getPromptPackageSyncSource;
  const sync = typeof options.sync === 'function' ? options.sync : syncPinnedGithubPromptPackageManually;
  const recordCheckpoint = typeof options.recordCheckpoint === 'function' ? options.recordCheckpoint : recordPromptPackageSyncCheckpoint;
  const now = typeof options.now === 'function' ? options.now : () => Math.floor(Date.now() / 1000);
  const setIntervalFn = typeof options.setIntervalFn === 'function' ? options.setIntervalFn : globalThis.setInterval;
  const clearIntervalFn = typeof options.clearIntervalFn === 'function' ? options.clearIntervalFn : globalThis.clearInterval;
  const logger = options.logger;
  const pollIntervalMs = bounded(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 1_000, 3_600_000);
  const timeoutMs = bounded(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 30_000);
  const configuredFetch = typeof options.fetchImpl === 'function' ? options.fetchImpl : null;

  let started = false;
  let generation = 0;
  let timer = null;
  const inFlight = new Map();

  function getState() {
    return { started, inFlight: inFlight.size };
  }

  function active(workGeneration) {
    return started && generation === workGeneration;
  }

  async function checkpointFailure(sourceKey, intervalSeconds, workGeneration, nowSeconds, event) {
    if (!active(workGeneration)) return false;
    let current;
    try {
      current = await getSource(sourceKey);
    } catch {
      safeLog(logger, 'prompt_package_scheduler_source_recheck_failed');
      return false;
    }
    if (!active(workGeneration) || !isEnabledAndDue(current, intervalSeconds, nowSeconds)) return false;
    try {
      await recordCheckpoint({
        sourceKey,
        lastSyncAt: nowSeconds,
        lastError: 'Scheduled prompt package sync failed'.slice(0, MAX_ERROR_LENGTH),
      });
      return true;
    } catch {
      safeLog(logger, event);
      return false;
    }
  }

  async function tick() {
    const summary = { started, processed: 0, skipped: [] };
    if (!started) return summary;
    const workGeneration = generation;
    const nowSeconds = safeNow(now);
    if (nowSeconds === null) {
      summary.skipped.push({ reason: 'invalid_clock' });
      return summary;
    }

    let jobs;
    let invalidJobCount = 0;
    try {
      const listed = await listJobs();
      if (!Array.isArray(listed)) throw new TypeError('invalid jobs');
      jobs = listed.map((job) => {
        const candidate = safeJobCandidate(job);
        if (!candidate) invalidJobCount += 1;
        return candidate;
      }).filter(Boolean).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
    } catch {
      safeLog(logger, 'prompt_package_scheduler_list_failed');
      summary.skipped.push({ reason: 'list_failed' });
      return summary;
    }

    for (let index = 0; index < invalidJobCount; index += 1) summary.skipped.push({ reason: 'invalid_or_disabled_job' });

    for (const candidate of jobs) {
      if (!active(workGeneration)) break;
      const { job, sourceKey, intervalSeconds } = candidate;
      if (inFlight.has(sourceKey)) {
        summary.skipped.push({ sourceKey, reason: 'in_flight' });
        continue;
      }

      let source;
      try {
        source = await getSource(sourceKey);
      } catch {
        safeLog(logger, 'prompt_package_scheduler_source_read_failed');
        summary.skipped.push({ sourceKey, reason: 'source_unavailable' });
        continue;
      }
      if (!isEnabledAndDue(source, intervalSeconds, nowSeconds)) {
        summary.skipped.push({ sourceKey, reason: 'source_disabled_or_missing' });
        continue;
      }
      if (!isDue(source, intervalSeconds, nowSeconds)) {
        summary.skipped.push({ sourceKey, reason: 'not_due' });
        continue;
      }
      if (!active(workGeneration)) break;

      let fetchImpl = configuredFetch;
      if (!fetchImpl && typeof globalThis.fetch === 'function') {
        try { fetchImpl = await createGithubPrivateReadFetch({ ownerUsername: job.createdBy || SCHEDULER_ACTOR, source: { provider: source.provider, repository: source.repository, ref: source.sourceRef }, fetchImpl: globalThis.fetch }); } catch { fetchImpl = null; }
      }
      const run = (async () => {
        if (!fetchImpl) {
          await checkpointFailure(sourceKey, job.intervalSeconds, workGeneration, nowSeconds, 'prompt_package_scheduler_checkpoint_failed');
          return false;
        }
        if (!active(workGeneration)) return false;
        try {
          const resolved = await resolveGithubRefToCommit({
            source: { provider: source.provider, repository: source.repository, ref: source.sourceRef },
            fetchImpl,
            timeoutMs,
          });
          if (!active(workGeneration)) return false;
          if (source.lastStagedCommit === resolved.commit) {
            await recordCheckpoint({ sourceKey, lastSeenCommit: resolved.commit, lastSyncAt: nowSeconds, lastError: null });
            return true;
          }
          const input = safeSyncInput(job, fetchImpl, timeoutMs, resolved.commit);
          if (!input) {
            await checkpointFailure(sourceKey, job.intervalSeconds, workGeneration, nowSeconds, 'prompt_package_scheduler_checkpoint_failed');
            return false;
          }
          await sync(input);
          return active(workGeneration);
        } catch {
          await checkpointFailure(sourceKey, job.intervalSeconds, workGeneration, nowSeconds, 'prompt_package_scheduler_checkpoint_failed');
          return false;
        }
      })();
      inFlight.set(sourceKey, run);
      try {
        if (await run) summary.processed += 1;
      } finally {
        if (inFlight.get(sourceKey) === run) inFlight.delete(sourceKey);
      }
    }
    return summary;
  }

  function start() {
    if (started) return getState();
    started = true;
    generation += 1;
    try {
      timer = setIntervalFn(() => { void tick().catch(() => safeLog(logger, 'prompt_package_scheduler_tick_failed')); }, pollIntervalMs);
    } catch (error) {
      started = false;
      timer = null;
      generation += 1;
      throw error;
    }
    void tick().catch(() => safeLog(logger, 'prompt_package_scheduler_tick_failed'));
    return getState();
  }

  function stop() {
    if (!started) return getState();
    started = false;
    generation += 1;
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
    return getState();
  }

  return { start, stop, tick, getState };
}
