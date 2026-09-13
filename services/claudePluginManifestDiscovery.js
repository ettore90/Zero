import { createHash } from 'node:crypto';
import { computePromptPackageManifestContentHash, normalizePromptPackageManifest } from './promptPackageManifest.js';
import { normalizePromptPackageSourcePin } from './promptPackageSourcePolicy.js';

const INPUT_KEYS = new Set(['sourcePin', 'files']);
const FILE_KEYS = new Set(['path', 'content', 'contentHash']);
const DESCRIPTOR_KEYS = new Set(['name', 'description', 'version', 'author', 'homepage', 'repository', 'license', 'keywords']);
const MAX_DESCRIPTOR_DESCRIPTION_LENGTH = 8192;
const MAX_FILES = 256;
const MAX_PATH_LENGTH = 512;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_FOLDED_DESCRIPTION_LENGTH = 8192;
const SHA256 = /^[a-f0-9]{64}$/;

export class ClaudePluginManifestDiscoveryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ClaudePluginManifestDiscoveryError';
    this.code = code;
  }
}

function fail(code, message) { throw new ClaudePluginManifestDiscoveryError(code, message); }
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function ownData(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}
function assertPlainDataObject(value, keys, field) {
  if (!isPlainObject(value)) fail('INVALID_INPUT', `${field} must be a plain object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.has(key)) fail('UNSUPPORTED_FIELD', `${field}.${String(key)} is not supported`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('INVALID_INPUT', `${field}.${key} must be data`);
  }
}
function path(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH_LENGTH || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) fail('INVALID_PATH', `${field} must be a safe relative POSIX path`);
  if (value.split('/').some((part) => part === '' || part === '.' || part === '..')) fail('INVALID_PATH', `${field} contains an unsafe segment`);
  return value;
}
function sha(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function text(value, field) {
  if (typeof value !== 'string') fail('INVALID_CONTENT', `${field} must be UTF-8 text`);
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > MAX_FILE_BYTES) fail('FILE_TOO_LARGE', `${field} exceeds maximum size`);
  return bytes;
}
function parseJson(content, field) {
  if (Buffer.byteLength(content, 'utf8') > MAX_JSON_BYTES) fail('JSON_TOO_LARGE', `${field} exceeds maximum size`);
  try { return JSON.parse(content); } catch { fail('INVALID_JSON', `${field} is malformed JSON`); }
}
function safeString(value, field, required = false, maxLength = 512) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.trim() === '' || value.length > maxLength) fail('INVALID_DESCRIPTOR', `${field} must be a non-empty bounded string`);
  return value.trim();
}
function safeAuthor(value, field) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return safeString(value, field);
  if (!isPlainObject(value) || Reflect.ownKeys(value).some((key) => key !== 'name')) fail('INVALID_DESCRIPTOR', `${field} must be a bounded author name`);
  return { name: safeString(value.name, `${field}.name`, true) };
}
function validateDescriptor(content, sourcePath) {
  const value = parseJson(content, sourcePath);
  if (!isPlainObject(value)) fail('INVALID_DESCRIPTOR', `${sourcePath} must be an object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !DESCRIPTOR_KEYS.has(key)) fail('UNSAFE_DESCRIPTOR', `${sourcePath}.${String(key)} is unsupported`);
  }
  const name = safeString(value.name, `${sourcePath}.name`, true);
  const descriptor = { name };
  for (const key of ['description', 'version', 'homepage', 'repository', 'license']) {
    const normalized = safeString(value[key], `${sourcePath}.${key}`, false, key === 'description' ? MAX_DESCRIPTOR_DESCRIPTION_LENGTH : 512);
    if (normalized !== undefined) descriptor[key] = normalized;
  }
  const author = safeAuthor(value.author, `${sourcePath}.author`);
  if (author !== undefined) descriptor.author = author;
  if (value.keywords !== undefined) {
    if (!Array.isArray(value.keywords) || value.keywords.length > 32 || value.keywords.some((item) => typeof item !== 'string' || item.trim() === '' || item.length > 128)) fail('INVALID_DESCRIPTOR', `${sourcePath}.keywords must be bounded strings`);
    descriptor.keywords = [...new Set(value.keywords.map((item) => item.trim()))].sort();
  }
  return descriptor;
}
function normalizedSkillContent(value) { return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n*$/, '') + '\n'; }
function parseSkill(content, sourcePath) {
  const lines = normalizedSkillContent(content).split('\n');
  if (lines[0] !== '---') fail('INVALID_SKILL', `${sourcePath} must begin with frontmatter`);
  const end = lines.indexOf('---', 1);
  if (end < 0) fail('INVALID_SKILL', `${sourcePath} frontmatter is not closed`);
  const metadata = {};
  for (let index = 1; index < end; index += 1) {
    const match = /^(name|description|disallowed-tools):[ \t]*(.*)$/.exec(lines[index]);
    if (!match || Object.hasOwn(metadata, match[1])) fail('INVALID_SKILL', `${sourcePath} has malformed frontmatter`);
    const [, key, rawValue] = match;
    if (key === 'description' && rawValue.trim() === '>') {
      const folded = [];
      while (index + 1 < end && /^[ \t]+\S/.test(lines[index + 1])) folded.push(lines[++index].trim());
      const normalized = folded.join(' ');
      if (!folded.length || normalized.length > MAX_FOLDED_DESCRIPTION_LENGTH || /[#:{}\[\],&*!|>@`]/.test(normalized) || normalized.includes('\"') || normalized.includes("'")) fail('INVALID_SKILL', `${sourcePath} has unsafe folded frontmatter`);
      metadata[key] = normalized;
      continue;
    }
    const raw = rawValue.trim();
    if (!raw) fail('INVALID_SKILL', `${sourcePath} has empty frontmatter`);
    if (key === 'disallowed-tools') {
      if (raw.length > 4096 || raw.split(',').some((item) => !/^[A-Za-z0-9_.-]+$/.test(item.trim()))) fail('INVALID_SKILL', `${sourcePath} has invalid frontmatter`);
    } else if (/[#:{}\[\],&*!|>@`]/.test(raw) || raw.includes('"') || raw.includes("'")) fail('INVALID_SKILL', `${sourcePath} has non-plain frontmatter`);
    metadata[key] = raw;
  }
  if (!metadata.name || !metadata.description || !lines.slice(end + 1).join('\n').trim()) fail('INVALID_SKILL', `${sourcePath} requires name, description, and body`);
  return { name: metadata.name, description: metadata.description };
}
function skillKey(name) {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(key)) fail('INVALID_SKILL_NAME', 'skill name cannot produce a safe key');
  return key;
}
function inventoryMcp(content, sourcePath) {
  const value = parseJson(content, sourcePath);
  if (!isPlainObject(value)) fail('INVALID_MCP', `${sourcePath} must be an object`);
  const servers = value.mcpServers;
  if (servers === undefined) return { serverKeys: [] };
  if (!isPlainObject(servers)) fail('INVALID_MCP', `${sourcePath}.mcpServers must be an object`);
  const serverKeys = Object.keys(servers);
  if (serverKeys.length > 64 || serverKeys.some((key) => !/^[A-Za-z][A-Za-z0-9._-]{0,127}$/.test(key))) fail('INVALID_MCP', `${sourcePath} has invalid server keys`);
  return { serverKeys: serverKeys.map((key) => key.toLowerCase()).sort() };
}

/**
 * Purely discovers inert Claude plugin manifests from caller-provided pinned file records.
 * It neither fetches nor activates any plugin feature.
 */
export function discoverClaudePluginManifests(input) {
  assertPlainDataObject(input, INPUT_KEYS, 'input');
  if (!Object.hasOwn(input, 'sourcePin') || !Object.hasOwn(input, 'files') || !Array.isArray(input.files) || input.files.length === 0 || input.files.length > MAX_FILES) fail('INVALID_INPUT', 'input requires a bounded files array');
  let sourcePin;
  try { sourcePin = normalizePromptPackageSourcePin(ownData(input, 'sourcePin')); } catch { fail('INVALID_SOURCE_PIN', 'sourcePin must be immutable and normalized'); }
  const records = new Map();
  let totalBytes = 0;
  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index];
    assertPlainDataObject(file, FILE_KEYS, `files[${index}]`);
    if (!Object.hasOwn(file, 'path') || !Object.hasOwn(file, 'content') || !Object.hasOwn(file, 'contentHash')) fail('INVALID_INPUT', `files[${index}] requires path, content, and contentHash`);
    const sourcePath = path(ownData(file, 'path'), `files[${index}].path`);
    const fileContent = ownData(file, 'content');
    totalBytes += text(fileContent, `files[${index}].content`);
    if (totalBytes > MAX_TOTAL_BYTES) fail('TOTAL_TOO_LARGE', 'input files exceed maximum total size');
    const contentHash = ownData(file, 'contentHash');
    if (typeof contentHash !== 'string' || !SHA256.test(contentHash) || sha(fileContent) !== contentHash) fail('CONTENT_HASH_MISMATCH', `files[${index}] contentHash does not match content`);
    if (records.has(sourcePath)) fail('DUPLICATE_PATH', `duplicate path ${sourcePath}`);
    records.set(sourcePath, { path: sourcePath, content: fileContent });
  }
  const descriptors = [...records.values()].filter((file) => file.path === '.claude-plugin/plugin.json' || file.path.endsWith('/.claude-plugin/plugin.json')).sort((a, b) => a.path.localeCompare(b.path));
  const descriptorRoots = descriptors.map((file) => file.path === '.claude-plugin/plugin.json' ? '' : file.path.slice(0, -'/.claude-plugin/plugin.json'.length));
  const ownsPath = (root, filePath) => {
    const prefix = root === '' ? '' : `${root}/`;
    if (!(filePath === `${prefix}SKILL.md` || (filePath.startsWith(prefix) && filePath.endsWith('/SKILL.md')))) return false;
    return !descriptorRoots.some((nestedRoot) => nestedRoot !== root && nestedRoot !== '' && nestedRoot.startsWith(prefix) && filePath.startsWith(`${nestedRoot}/`));
  };
  const manifests = descriptors.map((descriptorFile) => {
    const root = descriptorFile.path === '.claude-plugin/plugin.json' ? '' : descriptorFile.path.slice(0, -'/.claude-plugin/plugin.json'.length);
    const descriptor = validateDescriptor(descriptorFile.content, descriptorFile.path);
    const prefix = root === '' ? '' : `${root}/`;
    const skills = [...records.values()].filter((file) => ownsPath(root, file.path)).map((file) => ({ file, metadata: parseSkill(file.content, file.path) }));
    const keys = new Set();
    const entries = skills.map(({ file, metadata }) => {
      const key = skillKey(metadata.name);
      if (keys.has(key)) fail('DUPLICATE_SKILL_KEY', `duplicate skill name ${metadata.name}`);
      keys.add(key);
      return { key, path: file.path };
    }).sort((a, b) => a.key.localeCompare(b.key) || a.path.localeCompare(b.path));
    const mcpFile = records.get(`${prefix}.mcp.json`);
    const metadata = { claudePlugin: { ...descriptor, root } };
    if (mcpFile) metadata.mcpInventory = inventoryMcp(mcpFile.content, mcpFile.path);
    const bareManifest = { schemaVersion: 1, source: { repository: sourcePin.repository, ref: sourcePin.ref, commit: sourcePin.commit }, capabilities: [], skills: entries, blocks: [], mcpBundles: [], metadata };
    const manifest = { ...bareManifest, source: { ...bareManifest.source, contentHash: computePromptPackageManifestContentHash(bareManifest) } };
    return normalizePromptPackageManifest(manifest);
  });
  return Object.freeze({ sourcePin: Object.freeze({ ...sourcePin }), manifests: Object.freeze(manifests) });
}
