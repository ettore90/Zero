import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { initDb, getDb, closeDb } from '../db.js';
import { upsertPromptPackageSyncSource } from '../services/promptPackageSyncConfigStore.js';
import { previewClaudePluginImport, importClaudePluginFromPreview } from '../services/claudePluginImportService.js';

const pin = { provider: 'github', repository: 'acme/sams', ref: 'main', commit: 'd'.repeat(40) };
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
const skill = `---\nname: SAMS Copilot\ndescription: >\n  A folded safe description\n  for a deterministic test\ndisallowed-tools: mcp__private, mcp__other\n---\n\n# Skill\n`;
const rootFiles = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'root-plugin', version: '1.0.0' }),
  'SKILL.md': skill,
};
const files = {
  'plugins/sams-copilot/.claude-plugin/plugin.json': JSON.stringify({ name: 'sams-copilot', version: '0.12.0', author: { name: 'Ettore' } }),
  'plugins/sams-copilot/skills/sams-copilot/SKILL.md': skill,
  'plugins/sams-copilot/child/.claude-plugin/plugin.json': JSON.stringify({ name: 'child', version: '1.0.0' }),
  'plugins/sams-copilot/child/skills/child/SKILL.md': skill.replace('name: SAMS Copilot', 'name: Child Skill'),
  'plugins/sams-copilot/.mcp.json': JSON.stringify({ mcpServers: { private: { command: 'secret', args: ['--token=x'], env: { SECRET: 'x' } } } }),
};
const makeFetch = (fileSet) => async url => {
  const parsed = new URL(url);
  if (parsed.pathname.includes('/git/trees/')) return { status: 200, json: async () => ({ truncated: false, tree: Object.keys(fileSet).map(p => ({ path: p, type: 'blob' })) }) };
  const filePath = decodeURIComponent(parsed.pathname.split('/contents/')[1]);
  assert.ok(fileSet[filePath]);
  return { status: 200, json: async () => ({ type: 'file', path: filePath, encoding: 'base64', content: Buffer.from(fileSet[filePath]).toString('base64'), sha: 'a'.repeat(40) }) };
};
const fetchImpl = makeFetch(files);
let root;
try {
 root=await mkdtemp(path.join(os.tmpdir(),'zero-claude-import-')); const log=console.log; console.log=()=>{}; initDb(path.join(root,'db.sqlite')); console.log=log;
 getDb().prepare('INSERT INTO prompt_documents (id, key, title, metadata) VALUES (?, ?, ?, ?)').run('doc','claude-doc','Claude','{}');
 upsertPromptPackageSyncSource({sourcePin:pin,enabled:true});
 const preview=await previewClaudePluginImport({sourcePin:pin,pluginRoot:'plugins/sams-copilot',fetchImpl});
 assert.equal(preview.candidates.length,1); const manifest=preview.candidates[0].manifest; assert.deepEqual(manifest.skills.map(item => item.key), ['sams-copilot']);
 assert.deepEqual(manifest.mcpBundles,[]); assert.equal(manifest.metadata.mcpInventory.serverKeys[0],'private'); assert.equal(JSON.stringify(manifest).includes('secret'),false);
 const result=await importClaudePluginFromPreview({sourcePin:pin,pluginRoot:'plugins/sams-copilot',package:{packageKey:'sams-copilot',metadata:{}},version:{version:'0.12.0'},documentKey:'claude-doc',artifactMappings:[{artifactKey:'plugins-sams-copilot-skills-sams-copilot-skill',blockKey:'sams-copilot-skill',blockType:'text',included:true,position:0,metadata:{}}],fetchImpl,actor:'ettore'});
 assert.equal(result.changed,true); assert.equal(result.version.manifest.source.commit,pin.commit); assert.equal(result.event.details.origin,'claude_plugin_discovery');
 const repeated=await importClaudePluginFromPreview({sourcePin:pin,pluginRoot:'plugins/sams-copilot',package:{packageKey:'sams-copilot',metadata:{}},version:{version:'0.12.0'},documentKey:'claude-doc',artifactMappings:[{artifactKey:'plugins-sams-copilot-skills-sams-copilot-skill',blockKey:'sams-copilot-skill',blockType:'text',included:true,position:0,metadata:{}}],fetchImpl,actor:'ettore'});
 assert.equal(repeated.changed,false);
 const rootPin={...pin,repository:'acme/root'}; upsertPromptPackageSyncSource({sourcePin:rootPin,enabled:true});
 const rootPreview=await previewClaudePluginImport({sourcePin:rootPin,pluginRoot:'',fetchImpl:makeFetch(rootFiles)}); assert.equal(rootPreview.candidates[0].pluginRoot,'');
 const rootResult=await importClaudePluginFromPreview({sourcePin:rootPin,pluginRoot:'',package:{packageKey:'root-plugin',metadata:{}},version:{version:'1.0.0'},documentKey:'claude-doc',artifactMappings:[{artifactKey:'skill-skill',blockKey:'root-skill',blockType:'text',included:true,position:0,metadata:{}}],fetchImpl:makeFetch(rootFiles),actor:'ettore'}); assert.equal(rootResult.changed,true);
 upsertPromptPackageSyncSource({sourcePin:pin,enabled:false});
 await assert.rejects(()=>previewClaudePluginImport({sourcePin:pin,fetchImpl}), error=>error.code === 'SOURCE_DISABLED');
 upsertPromptPackageSyncSource({sourcePin:pin,enabled:true});
 await assert.rejects(()=>previewClaudePluginImport({sourcePin:{...pin,commit:'e'.repeat(40)},fetchImpl}), error=>error.code === 'SOURCE_MISMATCH');
 console.log('PASS claude-plugin-preview-import');
} finally { closeDb(); if(root) await rm(root,{recursive:true,force:true}); }
