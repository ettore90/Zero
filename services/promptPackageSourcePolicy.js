const SOURCE_PIN_FIELDS = new Set(['provider', 'repository', 'ref', 'commit']);
const REPOSITORY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PRINTABLE_NON_WHITESPACE = /^[\x21-\x7E]+$/;

export class PromptPackageSourcePolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PromptPackageSourcePolicyError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PromptPackageSourcePolicyError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Validates an inert canonical GitHub source identity without performing I/O. */
export function normalizePromptPackageSourcePin(value, field = 'sourcePin') {
  if (!isPlainObject(value)) fail('INVALID_SOURCE_PIN', `${field} must be a plain object`);
  for (const key of Object.keys(value)) {
    if (!SOURCE_PIN_FIELDS.has(key)) fail('UNSUPPORTED_SOURCE_PIN_FIELD', `${field}.${key} is not supported`);
  }
  for (const key of SOURCE_PIN_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('MISSING_SOURCE_PIN_FIELD', `${field}.${key} is required`);
  }
  if (value.provider !== 'github') fail('UNSUPPORTED_SOURCE_PROVIDER', `${field}.provider must be github`);

  const repository = normalizeGithubRepository(value.repository, `${field}.repository`);
  if (typeof value.ref !== 'string' || value.ref.length === 0 || value.ref.length > 255 || !PRINTABLE_NON_WHITESPACE.test(value.ref)) {
    fail('INVALID_SOURCE_REF', `${field}.ref must be a non-empty printable string without whitespace`);
  }
  if (value.ref.split('/').some((segment) => segment === '..')) {
    fail('INVALID_SOURCE_REF', `${field}.ref must not contain parent path segments`);
  }
  if (typeof value.commit !== 'string' || !COMMIT.test(value.commit)) {
    fail('INVALID_SOURCE_COMMIT', `${field}.commit must be a lowercase 40-character hexadecimal SHA`);
  }
  return { provider: 'github', repository, ref: value.ref, commit: value.commit };
}

export function normalizePromptPackageSourceContext(value, field = 'source') {
  if (!isPlainObject(value)) fail('INVALID_SOURCE_CONTEXT', `${field} context must be a plain object`);
  for (const key of ['repository', 'ref', 'commit']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_SOURCE_CONTEXT', `${field} context must include repository, ref, and commit`);
  }
  const repository = normalizeGithubRepository(value.repository, `${field}.repository`);
  if (typeof value.ref !== 'string' || value.ref.length === 0 || value.ref.length > 255 || !PRINTABLE_NON_WHITESPACE.test(value.ref) || value.ref.split('/').some((segment) => segment === '..')) {
    fail('INVALID_SOURCE_REF', `${field}.ref must be a non-empty printable string without whitespace or parent path segments`);
  }
  if (typeof value.commit !== 'string' || !/^[a-fA-F0-9]{40}$/.test(value.commit)) {
    fail('INVALID_SOURCE_COMMIT', `${field}.commit must be a 40-character hexadecimal SHA`);
  }
  return { repository, ref: value.ref, commit: value.commit.toLowerCase() };
}

export function assertPromptPackageSourcePinMatches(sourcePin, source) {
  const normalizedSource = normalizePromptPackageSourceContext(source);
  if (sourcePin.repository !== normalizedSource.repository) fail('SOURCE_PIN_MISMATCH', 'sourcePin.repository must match source.repository');
  if (sourcePin.ref !== normalizedSource.ref) fail('SOURCE_PIN_MISMATCH', 'sourcePin.ref must match source.ref');
  if (sourcePin.commit !== normalizedSource.commit) fail('SOURCE_PIN_MISMATCH', 'sourcePin.commit must match source.commit');
  return sourcePin;
}

export function normalizeGithubRepository(value, field = 'repository') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || !PRINTABLE_NON_WHITESPACE.test(value)) {
    fail('INVALID_SOURCE_REPOSITORY', `${field} must be a strict owner/repo identifier`);
  }
  const segments = value.split('/');
  if (segments.length !== 2 || segments.some((segment) => !REPOSITORY_SEGMENT.test(segment)) || /\.git$/i.test(value)) {
    fail('INVALID_SOURCE_REPOSITORY', `${field} must be a strict owner/repo identifier`);
  }
  return value.toLowerCase();
}
