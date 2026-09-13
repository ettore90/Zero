import { createHash } from 'node:crypto';

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;
const SHA256 = /^[a-fA-F0-9]{64}$/;
const COMMIT = /^[a-fA-F0-9]{7,64}$/;
const FORBIDDEN_MCP_FIELDS = new Set(['command', 'args', 'env', 'environment', 'secret', 'secrets', 'token', 'password', 'authorization', 'permissions']);
const RAW_CONTENT_KEYS = /^(?:raw)?(?:skill|block)?(?:content|prompt|body)$/i;
const IMPORTED_ARTIFACTS_KEY = /^importedArtifacts$/i;

export const PROMPT_PACKAGE_MANIFEST_SCHEMA_VERSION = 1;

export class PromptPackageManifestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PromptPackageManifestError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PromptPackageManifestError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, field) {
  if (!isPlainObject(value)) fail('INVALID_OBJECT', `${field} must be a plain object`);
  return value;
}

function assertOnlyKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNSUPPORTED_FIELD', `${field}.${key} is not supported`);
  }
}

function normalizeIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    fail('INVALID_IDENTIFIER', `${field} must be a safe identifier`);
  }
  return value.toLowerCase();
}

function normalizeIdentifierList(value, field) {
  if (!Array.isArray(value)) fail('INVALID_LIST', `${field} must be an array`);
  const unique = new Set();
  for (let index = 0; index < value.length; index += 1) {
    unique.add(normalizeIdentifier(value[index], `${field}[${index}]`));
  }
  return [...unique];
}

function normalizePath(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\\') || value.startsWith('/')) {
    fail('INVALID_PATH', `${field} must be a relative slash-separated path`);
  }
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    fail('PATH_TRAVERSAL', `${field} must not contain empty, dot, or parent segments`);
  }
  return value;
}

function normalizeSourceValue(field, value, path) {
  if (typeof value !== 'string' || value.trim() === '') fail('MISSING_SOURCE_FIELD', `${path} must be a non-empty string`);
  const normalized = value.trim();
  if (field === 'commit') {
    if (!COMMIT.test(normalized)) fail('INVALID_COMMIT', `${path} must be a Git commit SHA`);
    return normalized.toLowerCase();
  }
  if (field === 'contentHash') {
    if (!SHA256.test(normalized)) fail('INVALID_CONTENT_HASH', `${path} must be a SHA-256 hex digest`);
    return normalized.toLowerCase();
  }
  return normalized;
}

function normalizeSource(inputSource, context, requireContentHash = true) {
  const hasContextSource = context.source !== undefined;
  const contextualSource = hasContextSource ? requirePlainObject(context.source, 'context.source') : {};
  const source = inputSource === undefined ? {} : requirePlainObject(inputSource, 'source');
  const sourceFields = ['repository', 'ref', 'commit', 'contentHash'];
  assertOnlyKeys(contextualSource, new Set(sourceFields), 'context.source');
  assertOnlyKeys(source, new Set(sourceFields), 'source');
  if (hasContextSource) {
    for (const field of ['repository', 'ref', 'commit']) {
      if (contextualSource[field] === undefined) fail('MISSING_SOURCE_FIELD', `context.source.${field} is required`);
    }
  }

  const result = {};
  for (const field of sourceFields) {
    const manifestValue = source[field] === undefined ? undefined : normalizeSourceValue(field, source[field], `source.${field}`);
    const contextValue = contextualSource[field] === undefined ? undefined : normalizeSourceValue(field, contextualSource[field], `context.source.${field}`);
    if (field !== 'contentHash' && manifestValue !== undefined && contextValue !== undefined && manifestValue !== contextValue) {
      fail('SOURCE_CONTEXT_MISMATCH', `source.${field} must match context.source.${field}`);
    }
    if (field === 'contentHash') {
      if (requireContentHash && manifestValue === undefined) fail('MISSING_SOURCE_FIELD', 'source.contentHash is required');
      if (manifestValue !== undefined && contextValue !== undefined && manifestValue !== contextValue) {
        fail('SOURCE_CONTEXT_MISMATCH', 'source.contentHash must match context.source.contentHash');
      }
      if (manifestValue !== undefined) result[field] = manifestValue;
      continue;
    }
    if (manifestValue === undefined && contextValue === undefined) fail('MISSING_SOURCE_FIELD', `source.${field} is required`);
    result[field] = manifestValue === undefined ? contextValue : manifestValue;
  }
  return result;
}

function normalizeDeclarations(value, field) {
  if (!Array.isArray(value)) fail('INVALID_LIST', `${field} must be an array`);
  const seen = new Set();
  return value.map((entry, index) => {
    requirePlainObject(entry, `${field}[${index}]`);
    assertOnlyKeys(entry, new Set(['key', 'path', 'capabilities']), `${field}[${index}]`);
    const key = normalizeIdentifier(entry.key, `${field}[${index}].key`);
    if (seen.has(key)) fail('DUPLICATE_KEY', `${field} contains duplicate key ${key}`);
    seen.add(key);
    const declaration = { key, path: normalizePath(entry.path, `${field}[${index}].path`) };
    if (entry.capabilities !== undefined) declaration.capabilities = normalizeIdentifierList(entry.capabilities, `${field}[${index}].capabilities`);
    return declaration;
  });
}

function normalizeMcpCapabilities(value, field) {
  const capabilities = normalizeIdentifierList(value, field);
  if (capabilities.some((capability) => /(?:^|[._-])(write|exec)(?:[._-]|$)/.test(capability))) {
    fail('UNSAFE_MCP_PERMISSION', `${field} must not declare write or exec permissions`);
  }
  return capabilities;
}

function normalizeMcpBundles(value) {
  if (!Array.isArray(value)) fail('INVALID_LIST', 'mcpBundles must be an array');
  const seen = new Set();
  return value.map((entry, index) => {
    requirePlainObject(entry, `mcpBundles[${index}]`);
    for (const key of Object.keys(entry)) {
      if (FORBIDDEN_MCP_FIELDS.has(key.toLowerCase())) fail('FORBIDDEN_MCP_FIELD', `mcpBundles[${index}].${key} is forbidden`);
    }
    assertOnlyKeys(entry, new Set(['bundleKey', 'transport', 'toolKeys', 'capabilities', 'url']), `mcpBundles[${index}]`);
    const bundleKey = normalizeIdentifier(entry.bundleKey, `mcpBundles[${index}].bundleKey`);
    if (seen.has(bundleKey)) fail('DUPLICATE_KEY', `mcpBundles contains duplicate bundleKey ${bundleKey}`);
    seen.add(bundleKey);
    if (entry.transport !== 'remote' && entry.transport !== 'stdio') fail('INVALID_MCP_TRANSPORT', `mcpBundles[${index}].transport must be remote or stdio`);
    const bundle = { bundleKey, transport: entry.transport, toolKeys: normalizeIdentifierList(entry.toolKeys, `mcpBundles[${index}].toolKeys`) };
    if (entry.capabilities !== undefined) bundle.capabilities = normalizeMcpCapabilities(entry.capabilities, `mcpBundles[${index}].capabilities`);
    if (entry.url !== undefined) {
      if (entry.transport !== 'remote' || typeof entry.url !== 'string') fail('INVALID_MCP_URL', `mcpBundles[${index}].url is only allowed for remote transport`);
      let url;
      try { url = new URL(entry.url); } catch { fail('INVALID_MCP_URL', `mcpBundles[${index}].url must be a valid URL`); }
      if (url.protocol !== 'https:' || url.username || url.password) fail('UNSAFE_MCP_URL', `mcpBundles[${index}].url must be HTTPS without credentials`);
      if (url.search || url.hash) fail('UNSAFE_MCP_URL', `mcpBundles[${index}].url must not contain a query or fragment`);
      bundle.url = url.toString();
    }
    return bundle;
  });
}

const METADATA_LIMITS = Object.freeze({
  maxStringLength: 4096,
  maxObjectKeys: 100,
  maxArrayItems: 100,
  maxNodes: 1000,
  maxDepth: 8,
});

function normalizeMetadata(value, path = 'metadata', depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > METADATA_LIMITS.maxNodes) fail('METADATA_LIMIT_EXCEEDED', `${path} exceeds maximum node count`);
  if (depth > METADATA_LIMITS.maxDepth) fail('METADATA_LIMIT_EXCEEDED', `${path} exceeds maximum nesting`);
  if (typeof value === 'string') {
    if (value.length > METADATA_LIMITS.maxStringLength) fail('METADATA_LIMIT_EXCEEDED', `${path} exceeds maximum string length`);
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_METADATA', `${path} must contain JSON values`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > METADATA_LIMITS.maxArrayItems) fail('METADATA_LIMIT_EXCEEDED', `${path} exceeds maximum array items`);
    return value.map((item, index) => normalizeMetadata(item, `${path}[${index}]`, depth + 1, state));
  }
  if (!isPlainObject(value)) fail('INVALID_METADATA', `${path} must contain JSON values`);
  const entries = Object.entries(value);
  if (entries.length > METADATA_LIMITS.maxObjectKeys) fail('METADATA_LIMIT_EXCEEDED', `${path} exceeds maximum object keys`);
  const result = {};
  for (const [key, item] of entries) {
    if (IMPORTED_ARTIFACTS_KEY.test(key)) fail('RAW_SKILL_CONTENT', `${path}.${key} cannot contain imported artifacts`);
    if (RAW_CONTENT_KEYS.test(key)) fail('RAW_SKILL_CONTENT', `${path}.${key} cannot contain raw skill or block content`);
    result[key] = normalizeMetadata(item, `${path}.${key}`, depth + 1, state);
  }
  return result;
}

function canonicalJson(value, stack = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_MANIFEST_JSON', 'manifest must contain finite JSON numbers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') fail('INVALID_MANIFEST_JSON', 'manifest must contain JSON values');
  if (stack.has(value)) fail('INVALID_MANIFEST_JSON', 'manifest must not contain cycles');
  stack.add(value);
  let result;
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === 'symbol' || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/.test(key)))) {
      fail('INVALID_MANIFEST_JSON', 'manifest arrays must not have non-index properties');
    }
    const values = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !('value' in descriptor)) fail('INVALID_MANIFEST_JSON', 'manifest must not contain sparse arrays or accessors');
      values.push(canonicalJson(descriptor.value, stack));
    }
    result = `[${values.join(',')}]`;
  } else {
    if (!isPlainObject(value)) fail('INVALID_MANIFEST_JSON', 'manifest objects must be plain JSON objects');
    for (const key in value) {
      if (!Object.hasOwn(value, key)) fail('INVALID_MANIFEST_JSON', 'manifest must not contain inherited values');
    }
    const keys = Reflect.ownKeys(value);
    const enumerableKeys = [];
    for (const key of keys) {
      if (typeof key === 'symbol') fail('INVALID_MANIFEST_JSON', 'manifest must not contain symbol keys');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        fail('INVALID_MANIFEST_JSON', 'manifest must not contain accessors');
      }
      // Non-enumerable data properties are validated but omitted, matching JSON serialization.
      if (descriptor.enumerable) enumerableKeys.push(key);
    }
    const entries = enumerableKeys.sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, stack)}`;
    });
    result = `{${entries.join(',')}}`;
  }
  stack.delete(value);
  return result;
}

function hashManifestWithoutContentHash(manifest) {
  const { contentHash: _contentHash, ...sourceWithoutContentHash } = manifest.source;
  const withoutContentHash = { ...manifest, source: sourceWithoutContentHash };
  return createHash('sha256').update(canonicalJson(withoutContentHash), 'utf8').digest('hex');
}

function normalizeManifest(input, context = {}, requireContentHash = true) {
  canonicalJson(input);
  canonicalJson(context);
  requirePlainObject(input, 'manifest');
  requirePlainObject(context, 'context');
  assertOnlyKeys(input, new Set(['schemaVersion', 'source', 'capabilities', 'skills', 'blocks', 'mcpBundles', 'metadata']), 'manifest');
  if (input.schemaVersion !== PROMPT_PACKAGE_MANIFEST_SCHEMA_VERSION) {
    fail('UNSUPPORTED_SCHEMA_VERSION', `schemaVersion must be ${PROMPT_PACKAGE_MANIFEST_SCHEMA_VERSION}`);
  }
  assertOnlyKeys(context, new Set(['source']), 'context');
  const manifest = {
    schemaVersion: PROMPT_PACKAGE_MANIFEST_SCHEMA_VERSION,
    source: normalizeSource(input.source, context, requireContentHash),
    capabilities: normalizeIdentifierList(input.capabilities, 'capabilities'),
    skills: normalizeDeclarations(input.skills, 'skills'),
    blocks: normalizeDeclarations(input.blocks, 'blocks'),
    mcpBundles: normalizeMcpBundles(input.mcpBundles),
  };
  if (input.metadata !== undefined) manifest.metadata = normalizeMetadata(input.metadata);
  return manifest;
}

/**
 * Returns the SHA-256 of the canonical manifest JSON excluding source.contentHash.
 */
export function computePromptPackageManifestContentHash(input) {
  const manifest = normalizeManifest(input, {}, false);
  return hashManifestWithoutContentHash(manifest);
}

/**
 * Validates and returns an inert, normalized prompt-package technical manifest.
 * Context may supply only source compatibility values through context.source.
 */
export function normalizePromptPackageManifest(input, context = {}) {
  const manifest = normalizeManifest(input, context, true);
  const expectedHash = hashManifestWithoutContentHash(manifest);
  if (manifest.source.contentHash !== expectedHash) {
    fail('SOURCE_CONTENT_HASH_MISMATCH', 'source.contentHash does not match manifest content');
  }
  return manifest;
}
