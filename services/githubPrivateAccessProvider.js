import { getEffectiveGithubPrivateAccessAuthorization } from './githubPrivateAccessStore.js';
import { normalizeGithubRepository } from './promptPackageSourcePolicy.js';

const PURPOSE = 'read_only';
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export class GithubPrivateAccessProviderError extends Error {
  constructor(code) {
    super('GitHub private read access is unavailable');
    this.name = 'GithubPrivateAccessProviderError';
    this.code = code;
  }
}

function fail(code) { throw new GithubPrivateAccessProviderError(code); }

function requiredUsername(value) {
  if (typeof value !== 'string' || !USERNAME.test(value)) fail('ACCESS_DENIED');
  return value;
}

function normalizeSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.provider !== 'github') fail('ACCESS_DENIED');
  const repository = normalizeGithubRepository(value.repository, 'source.repository');
  if (typeof value.ref !== 'string' || !value.ref || /\s/.test(value.ref) || value.ref.split('/').includes('..')) fail('ACCESS_DENIED');
  return { provider: 'github', repository, ref: value.ref };
}

function eligibleUrl(input, repository) {
  let url;
  try { url = new URL(input instanceof Request ? input.url : input); } catch { return false; }
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com' || url.port || url.username || url.password) return false;
  const [owner, repo] = repository.split('/');
  const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
}

/**
 * Creates a narrowly scoped fetch for one approved immutable GitHub source pin.
 * The environment token is only read at construction and never included in outputs or errors.
 */
export function createGithubPrivateReadFetch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('ACCESS_DENIED');
  const { ownerUsername, source, fetchImpl = globalThis.fetch, at } = input;
  const username = requiredUsername(ownerUsername);
  let requestedSource;
  try { requestedSource = normalizeSource(source); } catch { fail('ACCESS_DENIED'); }
  if (typeof fetchImpl !== 'function') fail('ACCESS_DENIED');
  const token = process.env.ZERO_GREEN_GITHUB_READ_TOKEN;
  if (typeof token !== 'string' || token.length === 0) fail('ACCESS_DENIED');
  // Validate once before returning the wrapper and again for every request.
  // The per-request check makes expiry and revocation take effect immediately.
  try {
    if (!getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: username, source: requestedSource, purpose: PURPOSE, ...(at === undefined ? {} : { at }) })) fail('ACCESS_DENIED');
  } catch (error) {
    if (error instanceof GithubPrivateAccessProviderError) throw error;
    fail('ACCESS_DENIED');
  }

  return async function githubPrivateReadFetch(resource, init) {
    let currentAuthorization;
    try {
      currentAuthorization = getEffectiveGithubPrivateAccessAuthorization({ ownerUsername: username, source: requestedSource, purpose: PURPOSE });
    } catch { fail('ACCESS_DENIED'); }
    if (!currentAuthorization) fail('ACCESS_DENIED');
    if (!eligibleUrl(resource, requestedSource.repository)) fail('URL_NOT_ALLOWED');
    const requestInit = init && typeof init === 'object' ? { ...init } : {};
    const headers = new Headers(resource instanceof Request ? resource.headers : undefined);
    if (requestInit.headers !== undefined) {
      for (const [name, value] of new Headers(requestInit.headers)) headers.set(name, value);
    }
    headers.set('Authorization', `Bearer ${token}`);
    requestInit.headers = headers;
    // Never delegate redirect following to fetch: every outbound request carrying
    // this credential must be independently checked against the immutable pin.
    requestInit.redirect = 'manual';
    const request = new Request(resource, requestInit);
    if (request.method !== 'GET' && request.method !== 'HEAD') fail('METHOD_NOT_ALLOWED');
    return fetchImpl(request);
  };
}
