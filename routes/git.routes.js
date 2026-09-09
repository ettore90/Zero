
import { Router } from 'express';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { env } from '../config/env.js';
import { containerToHost } from '../utils/pathTransforms.js';
import { escapeShellArg } from '../utils/ssh.js';
import { BASH_BIN } from '../utils/shell.js';

const router = Router();
const execAsync = promisify(execCb);

async function runGit(command, cwd) {
  const hostCwd = containerToHost(cwd || env.CONTAINER_HOME || '/', env);
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: hostCwd, shell: BASH_BIN, timeout: 180000, maxBuffer: 20 * 1024 * 1024, env: process.env });
    return { output: stdout || '', error: stderr || '', exitCode: 0, cwd };
  } catch (err) {
    return { output: err?.stdout || '', error: err?.stderr || err?.message || 'Git command failed', exitCode: typeof err?.code === 'number' ? err.code : 1, cwd };
  }
}

router.get('/git/status', checkLocalAccess, async (req, res) => {
  const cwd = String(req.query.cwd || env.CONTAINER_HOME || '/');
  const status = await runGit('git status --porcelain', cwd);
  if (status.exitCode !== 0) return res.status(500).json({ error: status.error, cwd });
  const branch = await runGit('git branch --show-current', cwd);
  const changes = status.output.split('\n').filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3) }));
  return res.json({ branch: branch.output.trim(), changes, clean: changes.length === 0, count: changes.length, cwd });
});

router.get('/git/diff', checkLocalAccess, async (req, res) => {
  const cwd = String(req.query.cwd || env.CONTAINER_HOME || '/');
  const staged = String(req.query.staged || '') === 'true';
  // `files` reaches a shell string, so every path is escaped individually and
  // fenced behind `--`; without the fence a path like `--upload-pack=...` would
  // still be read by git as an option.
  const rawFiles = req.query.files;
  const files = (Array.isArray(rawFiles) ? rawFiles : String(rawFiles || '').split(/\s+/))
    .map((item) => String(item).trim())
    .filter(Boolean);
  const pathspec = files.length > 0 ? ` -- ${files.map((item) => escapeShellArg(item)).join(' ')}` : '';
  const result = await runGit(`git diff${staged ? ' --staged' : ''}${pathspec}`, cwd);
  if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
  const lines = result.output.split('\n');
  return res.json({ diff: result.output, added: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length, removed: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length, empty: !result.output.trim(), cwd });
});

router.post('/git/add', checkLocalAccess, async (req, res) => {
  const { cwd = env.CONTAINER_HOME || '/', files = [] } = req.body || {};
  const filesArg = Array.isArray(files) && files.length > 0 ? files.map((item) => escapeShellArg(item)).join(' ') : '-A';
  const result = await runGit(`git add ${filesArg}`, cwd);
  if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
  return res.json({ success: true, output: result.output, cwd });
});

router.post('/git/commit', checkLocalAccess, async (req, res) => {
  const { cwd = env.CONTAINER_HOME || '/', message, no_add = false } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });
  if (!no_add) {
    const addResult = await runGit('git add -A', cwd);
    if (addResult.exitCode !== 0) return res.status(500).json({ error: addResult.error, cwd });
  }
  const result = await runGit(`git commit -m ${escapeShellArg(message)}`, cwd);
  if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
  const hash = await runGit('git rev-parse --short HEAD', cwd);
  return res.json({ success: true, message, hash: hash.output.trim(), output: result.output, cwd });
});

router.get('/git/log', checkLocalAccess, async (req, res) => {
  const cwd = String(req.query.cwd || env.CONTAINER_HOME || '/');
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 100));
  const result = await runGit(`git log --oneline -${limit}`, cwd);
  if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
  const commits = result.output.split('\n').filter(Boolean);
  return res.json({ commits, count: commits.length, cwd });
});

router.post('/git/checkout', checkLocalAccess, async (req, res) => {
  const { cwd = env.CONTAINER_HOME || '/', branch, create = false } = req.body || {};
  if (!branch) return res.status(400).json({ error: 'branch required' });
  const result = await runGit(`git checkout ${create ? '-b ' : ''}${escapeShellArg(branch)}`, cwd);
  if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
  return res.json({ success: true, output: result.output, cwd });
});

router.post('/git/pull', checkLocalAccess, async (req, res) => {
  const { cwd = env.CONTAINER_HOME || '/', remote = 'origin', branch = '' } = req.body || {};
  const result = await runGit(`git pull ${escapeShellArg(remote)} ${branch ? escapeShellArg(branch) : ''}`.trim(), cwd);
  if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
  return res.json({ success: true, output: result.output, cwd });
});

router.post('/git/push', checkLocalAccess, async (req, res) => {
  const { cwd = env.CONTAINER_HOME || '/', remote = 'origin', branch = '', force = false } = req.body || {};
  const result = await runGit(`git push ${force ? '--force ' : ''}${escapeShellArg(remote)} ${branch ? escapeShellArg(branch) : ''}`.trim(), cwd);
  if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
  return res.json({ success: true, output: result.output, cwd });
});

router.post('/git/tag', checkLocalAccess, async (req, res) => {
  const { cwd = env.CONTAINER_HOME || '/', action = 'list', tag, message } = req.body || {};
  if (action === 'list') {
    const result = await runGit('git tag --list', cwd);
    if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
    return res.json({ tags: result.output.split('\n').filter(Boolean), cwd });
  }
  if (!tag) return res.status(400).json({ error: 'tag required' });
  const cmd = action === 'delete' ? `git tag -d ${escapeShellArg(tag)}` : `git tag ${message ? '-a ' : ''}${escapeShellArg(tag)}${message ? ` -m ${escapeShellArg(message)}` : ''}`;
  const result = await runGit(cmd, cwd);
  if (result.exitCode !== 0) return res.status(500).json({ error: result.error, cwd });
  return res.json({ success: true, output: result.output, cwd });
});

export default router;
