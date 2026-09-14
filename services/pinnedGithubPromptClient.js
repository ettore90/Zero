import { createHash } from 'node:crypto';
import { normalizePromptPackageSourcePin } from './promptPackageSourcePolicy.js';

const INPUT_FIELDS = new Set(['sourcePin', 'paths', 'fetchImpl', 'timeoutMs']);
const TREE_INPUT_FIELDS = new Set(['sourcePin', 'fetchImpl', 'timeoutMs']);
const RESOLVE_INPUT_FIELDS = new Set(['source', 'fetchImpl', 'timeoutMs']);
const MAX_TREE_PATHS = 512;
const SHA = /^[a-fA-F0-9]{40}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_FILE_BYTES = 256 * 1024;
// Base64 expands every three bytes to four characters; this includes up to two padding characters.
const MAX_BASE64_CONTENT_LENGTH = Math.ceil(MAX_FILE_BYTES / 3) * 4;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

export const PINNED_GITHUB_PROMPT_DESCRIPTOR_SCHEMA_VERSION = 1;
const DESCRIPTOR_FIELDS = new Set(['schemaVersion', 'sourcePin', 'manifestPath', 'artifactPaths']);
const SOURCE_PIN_FIELDS = new Set(['provider', 'repository', 'ref', 'commit']);

export class PinnedGithubPromptClientError extends Error {
  constructor(code) {
    super('Pinned GitHub prompt file request failed');
    this.name = 'PinnedGithubPromptClientError';
    this.code = code;
  }
}

function fail(code) {
  throw new PinnedGithubPromptClientError(code);
}

function isPlainOwnDataObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value');
  });
}

function ownValue(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function normalizePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail('INVALID_PATH');
  if (value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) fail('INVALID_PATH');
  return value;
}

function isNativeOwnDataArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    if (key !== 'length' && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
  }
  return true;
}

function isStrictOwnDataObject(value, fields) {
  if (!isPlainOwnDataObject(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.size || keys.some((key) => typeof key !== 'string' || !fields.has(key))) return false;
  return [...fields].every((key) => Object.hasOwn(value, key));
}

/**
 * Normalizes an inert, versioned GitHub prompt descriptor. It does not perform I/O.
 */
export function normalizePinnedGithubPromptDescriptor(input) {
  try {
    if (!isStrictOwnDataObject(input, DESCRIPTOR_FIELDS)) fail('INVALID_DESCRIPTOR');
    if (ownValue(input, 'schemaVersion') !== PINNED_GITHUB_PROMPT_DESCRIPTOR_SCHEMA_VERSION) fail('INVALID_DESCRIPTOR');

    const rawSourcePin = ownValue(input, 'sourcePin');
    if (!isStrictOwnDataObject(rawSourcePin, SOURCE_PIN_FIELDS)) fail('INVALID_DESCRIPTOR');
    const sourcePin = normalizePromptPackageSourcePin(rawSourcePin);

    const manifestPath = normalizePath(ownValue(input, 'manifestPath'));
    const rawArtifactPaths = ownValue(input, 'artifactPaths');
    if (!isNativeOwnDataArray(rawArtifactPaths) || rawArtifactPaths.length < 1 || rawArtifactPaths.length > 63) fail('INVALID_DESCRIPTOR');
    const artifactPaths = rawArtifactPaths.map(normalizePath);
    if (new Set(artifactPaths).size !== artifactPaths.length || artifactPaths.includes(manifestPath)) fail('INVALID_DESCRIPTOR');

    artifactPaths.sort();
    const paths = [manifestPath, ...artifactPaths].sort();
    return Object.freeze({
      schemaVersion: PINNED_GITHUB_PROMPT_DESCRIPTOR_SCHEMA_VERSION,
      sourcePin: Object.freeze({ ...sourcePin }),
      manifestPath,
      artifactPaths: Object.freeze(artifactPaths),
      paths: Object.freeze(paths),
    });
  } catch {
    fail('INVALID_DESCRIPTOR');
  }
}

function validateInput(value) {
  if (!isPlainOwnDataObject(value)) fail('INVALID_INPUT');
  for (const key of Object.keys(value)) if (!INPUT_FIELDS.has(key)) fail('UNSUPPORTED_INPUT_FIELD');
  if (!Object.hasOwn(value, 'sourcePin') || !Object.hasOwn(value, 'paths') || !Object.hasOwn(value, 'fetchImpl')) fail('MISSING_INPUT_FIELD');
  let sourcePin;
  try { sourcePin = normalizePromptPackageSourcePin(ownValue(value, 'sourcePin')); } catch { fail('INVALID_SOURCE_PIN'); }
  const rawPaths = ownValue(value, 'paths');
  if (!Array.isArray(rawPaths) || rawPaths.length < 1 || rawPaths.length > 64) fail('INVALID_PATHS');
  const paths = rawPaths.map(normalizePath);
  if (new Set(paths).size !== paths.length) fail('DUPLICATE_PATH');
  const fetchImpl = ownValue(value, 'fetchImpl');
  if (typeof fetchImpl !== 'function') fail('INVALID_FETCH');
  const timeoutMs = Object.hasOwn(value, 'timeoutMs') ? ownValue(value, 'timeoutMs') : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) fail('INVALID_TIMEOUT');
  return { sourcePin, paths: paths.sort(), fetchImpl, timeoutMs };
}

function normalizeMutableSource(value) {
  if (!isPlainOwnDataObject(value) || Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !['provider', 'repository', 'ref'].includes(key)) || value.provider !== 'github') fail('INVALID_SOURCE');
  try {
    const pin = normalizePromptPackageSourcePin({ ...value, commit: '0000000000000000000000000000000000000000' });
    return { provider: pin.provider, repository: pin.repository, ref: pin.ref };
  } catch { fail('INVALID_SOURCE'); }
}

/** Resolves a GitHub ref to a full immutable commit SHA before any content read. */
export async function resolveGithubRefToCommit(input) {
  if (!isPlainOwnDataObject(input) || Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !RESOLVE_INPUT_FIELDS.has(key)) || !Object.hasOwn(input, 'source') || !Object.hasOwn(input, 'fetchImpl')) fail('INVALID_INPUT');
  const source = normalizeMutableSource(ownValue(input, 'source'));
  const fetchImpl = ownValue(input, 'fetchImpl');
  if (typeof fetchImpl !== 'function') fail('INVALID_FETCH');
  const timeoutMs = Object.hasOwn(input, 'timeoutMs') ? ownValue(input, 'timeoutMs') : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) fail('INVALID_TIMEOUT');
  const [owner, repository] = source.repository.split('/');
  const response = await fetchWithTimeout(fetchImpl, `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(source.ref)}`, timeoutMs);
  if (!response || response.status < 200 || response.status > 299) fail('HTTP_RESPONSE');
  let payload;
  try { payload = await response.json(); } catch { fail('INVALID_JSON'); }
  const sha = isPlainOwnDataObject(payload) ? ownValue(payload, 'sha') : null;
  if (typeof sha !== 'string' || !SHA.test(sha)) fail('INVALID_COMMIT');
  return Object.freeze({ ...source, commit: sha.toLowerCase() });
}

function requestUrl(sourcePin, path) {
  const [owner, repository] = sourcePin.repository.split('/');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${owner}/${repository}/contents/${encodedPath}?ref=${sourcePin.commit}`;
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PinnedGithubPromptClientError('TIMEOUT'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'zero-prompt-package-sync',
      },
      redirect: 'manual',
      signal: controller.signal,
    }), timeout]);
  } catch (error) {
    if (error instanceof PinnedGithubPromptClientError) throw error;
    fail('REQUEST_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

async function materialize(response, requestedPath) {
  if (response === null || (typeof response !== 'object' && typeof response !== 'function')) fail('INVALID_RESPONSE');
  let status;
  try { status = response.status; } catch { fail('INVALID_RESPONSE'); }
  if (!Number.isInteger(status)) fail('INVALID_RESPONSE');
  let json;
  try { json = response.json; } catch { fail('INVALID_JSON'); }
  if (typeof json !== 'function') fail('INVALID_JSON');
  if (status < 200 || status > 299) fail(status >= 300 && status < 400 ? 'REDIRECT_RESPONSE' : 'HTTP_RESPONSE');
  let payload;
  try { payload = await json.call(response); } catch { fail('INVALID_JSON'); }
  if (!isPlainOwnDataObject(payload)) fail('INVALID_PAYLOAD');
  if (ownValue(payload, 'type') !== 'file' || ownValue(payload, 'path') !== requestedPath || ownValue(payload, 'encoding') !== 'base64') fail('INVALID_PAYLOAD');
  const content = ownValue(payload, 'content');
  // GitHub's Contents API may fold base64 content across lines. Accept only ASCII
  // whitespace used for folding, then validate and decode the normalized payload.
  if (typeof content !== 'string' || /[^A-Za-z0-9+/=\r\n\t ]/.test(content)) fail('INVALID_CONTENT');
  const normalizedContent = content.replace(/[\r\n\t ]/g, '');
  if (!BASE64.test(normalizedContent)) fail('INVALID_CONTENT');
  if (normalizedContent.length > MAX_BASE64_CONTENT_LENGTH) fail('FILE_TOO_LARGE');
  const bytes = Buffer.from(normalizedContent, 'base64');
  if (Buffer.from(bytes.toString('utf8'), 'utf8').compare(bytes) !== 0) fail('INVALID_UTF8');
  if (bytes.length > MAX_FILE_BYTES) fail('FILE_TOO_LARGE');
  const sha = ownValue(payload, 'sha');
  if (typeof sha !== 'string' || !SHA.test(sha)) fail('INVALID_BLOB_SHA');
  return { path: requestedPath, content: bytes.toString('utf8'), githubBlobSha: sha.toLowerCase(), contentHash: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length };
}

/** Fetches a bounded recursive Git tree at an immutable commit pin, returning blob paths only. */
export async function fetchPinnedGithubTreePaths(input) {
  if (!isPlainOwnDataObject(input) || Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !TREE_INPUT_FIELDS.has(key)) || !Object.hasOwn(input, 'sourcePin') || !Object.hasOwn(input, 'fetchImpl')) fail('INVALID_INPUT');
  let sourcePin;
  try { sourcePin = normalizePromptPackageSourcePin(ownValue(input, 'sourcePin')); } catch { fail('INVALID_SOURCE_PIN'); }
  const fetchImpl = ownValue(input, 'fetchImpl');
  if (typeof fetchImpl !== 'function') fail('INVALID_FETCH');
  const timeoutMs = Object.hasOwn(input, 'timeoutMs') ? ownValue(input, 'timeoutMs') : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) fail('INVALID_TIMEOUT');
  const [owner, repository] = sourcePin.repository.split('/');
  const url = `https://api.github.com/repos/${owner}/${repository}/git/trees/${sourcePin.commit}?recursive=1`;
  const response = await fetchWithTimeout(fetchImpl, url, timeoutMs);
  if (!response || response.status < 200 || response.status > 299) fail('HTTP_RESPONSE');
  let payload;
  try { payload = await response.json(); } catch { fail('INVALID_JSON'); }
  if (!isPlainOwnDataObject(payload) || payload.truncated !== false || !isNativeOwnDataArray(payload.tree) || payload.tree.length > MAX_TREE_PATHS) fail('INVALID_TREE');
  const paths = [];
  for (const entry of payload.tree) {
    if (!isPlainOwnDataObject(entry) || ownValue(entry, 'type') !== 'blob') continue;
    try { paths.push(normalizePath(ownValue(entry, 'path'))); } catch { fail('INVALID_TREE'); }
  }
  if (!paths.length || new Set(paths).size !== paths.length) fail('INVALID_TREE');
  return Object.freeze(paths.sort());
}

/** Downloads explicit text files from GitHub's contents API at an immutable commit pin. */
export async function fetchPinnedGithubPromptFiles(input) {
  const { sourcePin, paths, fetchImpl, timeoutMs } = validateInput(input);
  const files = [];
  let totalBytes = 0;
  for (const path of paths) {
    const file = await materialize(await fetchWithTimeout(fetchImpl, requestUrl(sourcePin, path), timeoutMs), path);
    totalBytes += file.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) fail('TOTAL_TOO_LARGE');
    const { byteLength, ...result } = file;
    files.push(Object.freeze(result));
  }
  return Object.freeze({ sourcePin: Object.freeze({ ...sourcePin }), files: Object.freeze(files) });
}
