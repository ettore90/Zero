import { createHash } from 'node:crypto';
import { normalizePromptPackageManifest } from './promptPackageManifest.js';
import { assertPromptPackageSourcePinMatches, normalizePromptPackageSourceContext, normalizePromptPackageSourcePin } from './promptPackageSourcePolicy.js';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = (message) => { throw new Error(`Invalid prompt package import: ${message}`); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function string(value, field, required = true) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} must be a non-empty string${required ? '' : ' when provided'}`);
  return value.trim();
}
function cloneObject(value, field) {
  if (!isObject(value)) fail(`${field} must be a JSON-serializable object`);
  try {
    const result = JSON.parse(JSON.stringify(value));
    if (!isObject(result)) fail(`${field} must remain an object after JSON serialization`);
    return result;
  } catch { fail(`${field} must be JSON-serializable`); }
}
function path(value, field) {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const result = value.replace(/\\/g, '/');
  if (result.includes('\0') || result.startsWith('/') || /^[A-Za-z]:/.test(result)) fail(`${field} must be a relative POSIX path`);
  if (result === '' || result.split('/').some((part) => part === '' || part === '.' || part === '..')) fail(`${field} contains an invalid path segment`);
  return result;
}
function content(value, field) {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\n*$/, '') + '\n';
}
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const isSkill = (value) => value.split('/').at(-1) === 'SKILL.md';
const MAX_FOLDED_DESCRIPTION_LENGTH = 8192;

function derivedKey(value, suffix, root = false) {
  const source = root ? 'skill' : value;
  const key = source.split('/').map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('-');
  if (!key) fail(`path cannot produce an artifact key: ${value}`);
  return `${key}-${suffix}`;
}
function frontmatter(value, sourcePath) {
  const lines = value.split('\n');
  if (lines[0] !== '---') fail(`skill ${sourcePath} must begin with frontmatter`);
  const end = lines.indexOf('---', 1);
  if (end < 0) fail(`skill ${sourcePath} frontmatter is not closed`);
  const metadata = {};
  for (let i = 1; i < end; i += 1) {
    const match = /^(name|description|disallowed-tools):[ \t]*(.*)$/.exec(lines[i]);
    if (!match || own(metadata, match[1])) fail(`skill ${sourcePath} has malformed frontmatter`);
    const [, key, rawValue] = match;
    if (key === 'description' && rawValue.trim() === '>') {
      const folded = [];
      while (i + 1 < end && /^[ \t]+\S/.test(lines[i + 1])) folded.push(lines[++i].trim());
      const normalized = folded.join(' ');
      if (!folded.length || normalized.length > MAX_FOLDED_DESCRIPTION_LENGTH || /[#:{}\[\],&*!|>@`]/.test(normalized) || normalized.includes('\"') || normalized.includes("'")) fail(`skill ${sourcePath} has unsafe folded ${key} frontmatter`);
      metadata[key] = normalized;
      continue;
    }
    const trimmed = rawValue.trim();
    if (!trimmed) fail(`skill ${sourcePath} has empty ${key} frontmatter`);
    if (key === 'disallowed-tools') {
      if (trimmed.length > 4096 || trimmed.split(',').some((item) => !/^[A-Za-z0-9_.-]+$/.test(item.trim()))) fail(`skill ${sourcePath} has invalid ${key} frontmatter`);
      metadata[key] = trimmed;
    } else {
      if (/[#:{}\[\],&*!|>@`]/.test(trimmed) || trimmed.includes('"') || trimmed.includes("'")) fail(`skill ${sourcePath} has non-plain ${key} frontmatter`);
      metadata[key] = trimmed;
    }
  }
  if (!own(metadata, 'name') || !own(metadata, 'description')) fail(`skill ${sourcePath} frontmatter requires name and description`);
  if (!lines.slice(end + 1).join('\n').trim()) fail(`skill ${sourcePath} must have a non-empty Markdown body`);
  return { name: metadata.name, description: metadata.description };
}

export function buildPromptPackageImport(input) {
  if (!isObject(input) || !isObject(input.package) || !isObject(input.version)) fail('input, package, and version must be objects');
  if (!Array.isArray(input.files) || !input.files.length) fail('files must be a non-empty array');
  const packageData = { packageKey: string(input.package.packageKey, 'package.packageKey'), source: string(input.package.source, 'package.source') };
  if (own(input.package, 'repository')) packageData.repository = string(input.package.repository, 'package.repository', false);
  if (own(input.package, 'metadata')) packageData.metadata = cloneObject(input.package.metadata, 'package.metadata');
  const pinned = own(input, 'sourcePin');
  let manifest = {};
  if (pinned) {
    if (!own(input.version, 'manifest')) fail('version.manifest is required');
  } else if (own(input.version, 'manifest')) {
    if (isObject(input.version.manifest) && own(input.version.manifest, 'importedArtifacts')) fail('version.manifest.importedArtifacts is reserved');
    manifest = cloneObject(input.version.manifest, 'version.manifest');
  }
  const versionData = { version: string(input.version.version, 'version.version'), sourceCommit: string(input.version.sourceCommit, 'version.sourceCommit') };
  if (own(input.version, 'sourceRef')) versionData.sourceRef = string(input.version.sourceRef, 'version.sourceRef', false);
  let sourceContext;
  if (pinned) {
    const sourcePin = normalizePromptPackageSourcePin(input.sourcePin);
    const rawSourceContext = { repository: packageData.repository, ref: versionData.sourceRef, commit: versionData.sourceCommit };
    sourceContext = normalizePromptPackageSourceContext(rawSourceContext);
    assertPromptPackageSourcePinMatches(sourcePin, sourceContext);
    packageData.repository = sourceContext.repository;
    versionData.sourceRef = sourceContext.ref;
    versionData.sourceCommit = sourceContext.commit;
    const manifestRawSource = isObject(input.version.manifest) ? input.version.manifest.source : undefined;
    const manifestRawSourceContext = normalizePromptPackageSourceContext(manifestRawSource, 'version.manifest.source');
    assertPromptPackageSourcePinMatches(sourcePin, manifestRawSourceContext);
    const manifestForNormalization = cloneObject(input.version.manifest, 'version.manifest');
    manifestForNormalization.source = {
      ...manifestForNormalization.source,
      repository: manifestRawSourceContext.repository,
      commit: manifestRawSourceContext.commit,
    };
    manifest = normalizePromptPackageManifest(manifestForNormalization, { source: manifestRawSourceContext });
    assertPromptPackageSourcePinMatches(sourcePin, manifest.source);
  }

  const files = input.files.map((file, index) => {
    if (!isObject(file)) fail(`files[${index}] must be an object`);
    const sourcePath = path(file.path, `files[${index}].path`);
    return { sourcePath, content: content(file.content, `files[${index}].content`), skill: isSkill(sourcePath) };
  });
  const references = new Map();
  if (own(input, 'references')) {
    if (!Array.isArray(input.references)) fail('references must be an array when provided');
    input.references.forEach((reference, index) => {
      if (!isObject(reference)) fail(`references[${index}] must be an object`);
      const sourcePath = path(reference.sourcePath, `references[${index}].sourcePath`);
      if (references.has(sourcePath)) fail(`duplicate reference sourcePath: ${sourcePath}`);
      let artifactKey;
      if (own(reference, 'artifactKey')) {
        artifactKey = reference.artifactKey;
        if (typeof artifactKey !== 'string' || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(artifactKey)) fail(`references[${index}].artifactKey must match [a-z0-9][a-z0-9-]*`);
      }
      references.set(sourcePath, artifactKey);
    });
  }
  const counts = new Map();
  for (const file of files) counts.set(file.sourcePath, (counts.get(file.sourcePath) || 0) + 1);
  const artifacts = files.map((file) => {
    if (file.skill) {
      if (references.has(file.sourcePath)) fail(`reference cannot declare skill file: ${file.sourcePath}`);
      const base = file.sourcePath === 'SKILL.md' ? file.sourcePath : file.sourcePath.slice(0, -'/SKILL.md'.length);
      return { type: 'skill', artifactKey: derivedKey(base, 'skill', file.sourcePath === 'SKILL.md'), sourcePath: file.sourcePath, contentHash: hash(file.content), metadata: frontmatter(file.content, file.sourcePath), content: file.content };
    }
    if (!references.has(file.sourcePath) || counts.get(file.sourcePath) !== 1) fail(`non-skill file must be declared exactly once as a reference: ${file.sourcePath}`);
    return { type: 'reference', artifactKey: references.get(file.sourcePath) || derivedKey(file.sourcePath, 'reference'), sourcePath: file.sourcePath, contentHash: hash(file.content), metadata: {}, content: file.content };
  });
  for (const sourcePath of references.keys()) {
    const matching = files.filter((file) => file.sourcePath === sourcePath);
    if (matching.length !== 1 || matching[0].skill) fail(`reference sourcePath must match exactly one non-skill file: ${sourcePath}`);
  }
  artifacts.sort((a, b) => a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : a.artifactKey < b.artifactKey ? -1 : a.artifactKey > b.artifactKey ? 1 : 0);
  const paths = new Set(), keys = new Set();
  for (const artifact of artifacts) {
    if (paths.has(artifact.sourcePath) || keys.has(artifact.artifactKey)) fail(`duplicate artifact sourcePath or artifactKey: ${artifact.sourcePath}`);
    paths.add(artifact.sourcePath); keys.add(artifact.artifactKey);
  }
  if (pinned) {
    const declaredSkillPaths = new Set(manifest.skills.map((skill) => skill.path));
    const skillArtifactPaths = new Set(artifacts.filter((artifact) => artifact.type === 'skill').map((artifact) => artifact.sourcePath));
    for (const skillPath of declaredSkillPaths) {
      if (!skillArtifactPaths.has(skillPath)) fail(`manifest skill path must match a skill artifact: ${skillPath}`);
    }
    for (const skillPath of skillArtifactPaths) {
      if (!declaredSkillPaths.has(skillPath)) fail(`skill artifact must be declared in version.manifest.skills: ${skillPath}`);
    }
    versionData.manifest = manifest;
    versionData.validation = { valid: true, errors: [] };
    return { package: packageData, version: versionData, artifacts };
  }
  const importedArtifacts = artifacts.map(({ type, artifactKey, sourcePath, contentHash, metadata, content: normalizedContent }) => ({ type, artifactKey, sourcePath, contentHash, metadata, content: normalizedContent }));
  versionData.manifest = { ...manifest, importedArtifacts };
  versionData.validation = { valid: true, errors: [] };
  return { package: packageData, version: versionData, artifacts: artifacts.map(({ content: _content, ...artifact }) => artifact) };
}
