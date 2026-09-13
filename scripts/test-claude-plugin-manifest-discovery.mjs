import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { discoverClaudePluginManifests } from '../services/claudePluginManifestDiscovery.js';

const hash = (content) => createHash('sha256').update(content, 'utf8').digest('hex');
const pin = { provider: 'github', repository: 'acme/sams', ref: 'main', commit: 'a'.repeat(40) };
const files = (items) => items.map(([path, content]) => ({ path, content, contentHash: hash(content) }));
const skill = (name) => `---\nname: ${name}\ndescription: Safe description\n---\n\nUse the documented process.\n`;
const plugin = JSON.stringify({ name: 'sams', description: 'SAMS plugin', version: '1.0.0' });
const base = [
  ['plugins/sams/.claude-plugin/plugin.json', plugin],
  ['plugins/sams/SKILL.md', skill('SAMS Core')],
  ['plugins/sams/skills/release/SKILL.md', skill('Release Guide')],
];

const first = discoverClaudePluginManifests({ sourcePin: pin, files: files(base) });
assert.equal(first.manifests.length, 1);
assert.deepEqual(first.manifests[0].skills, [
  { key: 'release-guide', path: 'plugins/sams/skills/release/SKILL.md' },
  { key: 'sams-core', path: 'plugins/sams/SKILL.md' },
]);
assert.deepEqual(first.manifests[0].blocks, []);
assert.deepEqual(first.manifests[0].capabilities, []);
assert.deepEqual(first.manifests[0].mcpBundles, []);
assert.equal(first.manifests[0].metadata.claudePlugin.name, 'sams');
console.log('PASS sams-shaped-root');

assert.throws(() => discoverClaudePluginManifests({ sourcePin: pin, files: files([...base.slice(0, 2), ['plugins/sams/skills/bad/SKILL.md', 'not frontmatter']]) }), (error) => error.code === 'INVALID_SKILL');
console.log('PASS malformed-skill-fail-closed');

assert.throws(() => discoverClaudePluginManifests({ sourcePin: pin, files: files([...base, ['plugins/sams/skills/duplicate/SKILL.md', skill('SAMS Core')]]) }), (error) => error.code === 'DUPLICATE_SKILL_KEY');
console.log('PASS duplicate-names-fail-closed');

const mcp = JSON.stringify({ mcpServers: { dangerous: { command: 'rm', args: ['-rf', '/'], env: { TOKEN: 'secret' }, credentials: { password: 'secret' } } } });
const withMcp = discoverClaudePluginManifests({ sourcePin: pin, files: files([...base, ['plugins/sams/.mcp.json', mcp]]) }).manifests[0];
assert.deepEqual(withMcp.metadata.mcpInventory, { serverKeys: ['dangerous'] });
assert.equal(JSON.stringify(withMcp.metadata).includes('command'), false);
assert.equal(JSON.stringify(withMcp.metadata).includes('secret'), false);
assert.deepEqual(withMcp.mcpBundles, []);
console.log('PASS unsafe-mcp-redacted-inert');

const reversed = discoverClaudePluginManifests({ sourcePin: pin, files: files([...base].reverse()) });
assert.deepEqual(reversed.manifests, first.manifests);
assert.equal(reversed.manifests[0].source.contentHash, first.manifests[0].source.contentHash);
console.log('PASS deterministic-hash-order');

const nestedFiles = [
  ['plugins/parent/.claude-plugin/plugin.json', JSON.stringify({ name: 'parent' })],
  ['plugins/parent/skills/parent/SKILL.md', skill('Core')],
  ['plugins/parent/child/.claude-plugin/plugin.json', JSON.stringify({ name: 'child' })],
  ['plugins/parent/child/skills/child/SKILL.md', skill('Child')],
].map(([path, content]) => ({ path, content, contentHash: hash(content) }));
const nested = discoverClaudePluginManifests({ sourcePin: pin, files: nestedFiles }).manifests;
assert.deepEqual(nested.find(manifest => manifest.metadata.claudePlugin.root === 'plugins/parent').skills.map(item => item.key), ['core']);
assert.deepEqual(nested.find(manifest => manifest.metadata.claudePlugin.root === 'plugins/parent/child').skills.map(item => item.key), ['child']);
assert.throws(() => discoverClaudePluginManifests({ sourcePin: pin, files: [{ path: '.claude-plugin/plugin.json', content: JSON.stringify({ name: 'x' }), contentHash: hash(JSON.stringify({ name: 'x' })) }, { path: 'SKILL.md', content: `---\nname: x\ndescription: >\n  ${'a'.repeat(8193)}\n---\n\nbody`, contentHash: hash(`---\nname: x\ndescription: >\n  ${'a'.repeat(8193)}\n---\n\nbody`) }] }));
console.log('PASS nested-roots-isolated-and-folded-description-bounded');
