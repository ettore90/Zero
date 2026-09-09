import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { env } from '../config/env.js';
import { containerToHost, hostToContainer, normalizeSlashes } from '../utils/pathTransforms.js';
import { escapeShellArg } from '../utils/ssh.js';
import { BASH_BIN } from '../utils/shell.js';

const router = Router();
const execAsync = promisify(execCb);
const cwdByAgent = new Map();

function getPublicDefaultCwd() {
  return env.HOST_HOME || env.CONTAINER_HOME || '/';
}

function getAgentCwd(agentId = 'terminal') {
  return cwdByAgent.get(String(agentId || 'terminal')) || getPublicDefaultCwd();
}

function setAgentCwd(agentId = 'terminal', cwd) {
  cwdByAgent.set(String(agentId || 'terminal'), cwd);
}

function isAbsolutePath(value) {
  return String(value || '').startsWith('/');
}

function buildPathCandidates(inputPath, agentId = 'terminal') {
  const hostHome = normalizeSlashes(env.HOST_HOME || '/home/ettore');
  const containerHome = normalizeSlashes(env.CONTAINER_HOME || '/host_system');
  const publicBase = normalizeSlashes(getAgentCwd(agentId));
  const rawInput = String(inputPath || publicBase).trim() || publicBase;

  const publicPath = isAbsolutePath(rawInput)
    ? normalizeSlashes(rawInput)
    : normalizeSlashes(path.posix.join(publicBase, rawInput));

  const candidates = [];
  const push = (value) => {
    const normalized = normalizeSlashes(value);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  if (publicPath.startsWith(hostHome)) {
    push(hostToContainer(publicPath, env));
    push(publicPath);
  } else if (publicPath.startsWith(containerHome)) {
    push(publicPath);
    push(containerToHost(publicPath, env));
  } else {
    push(publicPath);

    const relativeToHost = normalizeSlashes(path.posix.join(hostHome, publicPath.replace(/^\/+/, '')));
    const relativeToContainer = normalizeSlashes(path.posix.join(containerHome, publicPath.replace(/^\/+/, '')));
    push(relativeToHost);
    push(relativeToContainer);
  }

  return { publicPath, candidates };
}

function resolveExistingPath(inputPath, agentId = 'terminal') {
  const { publicPath, candidates } = buildPathCandidates(inputPath, agentId);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { realPath: candidate, publicPath };
    }
  }
  const err = new Error(`Path not found: ${publicPath}`);
  err.code = 'ENOENT';
  err.candidates = candidates;
  throw err;
}

function resolveWritablePath(inputPath, agentId = 'terminal') {
  const { publicPath, candidates } = buildPathCandidates(inputPath, agentId);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { realPath: candidate, publicPath };
    }
  }

  const hostHome = normalizeSlashes(env.HOST_HOME || '/home/ettore');
  const containerHome = normalizeSlashes(env.CONTAINER_HOME || '/host_system');

  if (publicPath.startsWith(hostHome)) {
    return { realPath: hostToContainer(publicPath, env), publicPath };
  }

  if (publicPath.startsWith(containerHome)) {
    return { realPath: publicPath, publicPath: containerToHost(publicPath, env) };
  }

  return { realPath: publicPath, publicPath };
}

function resolveCommandCwd(inputPath, agentId = 'terminal') {
  const { publicPath, candidates } = buildPathCandidates(inputPath || getAgentCwd(agentId), agentId);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return { realPath: candidate, publicPath };
      }
    } catch {}
  }
  return { realPath: candidates[0] || publicPath, publicPath };
}

async function runLocal(command, options = {}) {
  const cwd = options.cwd || resolveCommandCwd(getPublicDefaultCwd()).realPath || process.cwd();
  const timeoutMs = Math.max(1000, Math.min((Number(options.timeout) || 60) * 1000, 600000));
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      shell: BASH_BIN,
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) },
    });
    return { output: stdout || '', error: stderr || '', exitCode: 0 };
  } catch (err) {
    return {
      output: err?.stdout || '',
      error: err?.stderr || err?.message || 'Command failed',
      exitCode: typeof err?.code === 'number' ? err.code : 1,
    };
  }
}

router.get('/health', (req, res) => res.json({ ok: true }));

router.get('/system/info', checkLocalAccess, (req, res) => res.json({
  status: 'ok',
  message: 'system routes online',
  allowLocalAccess: env.ALLOW_LOCAL_ACCESS,
  containerHome: env.CONTAINER_HOME,
  hostHome: env.HOST_HOME,
}));

router.post('/system/exec', checkLocalAccess, async (req, res) => {
  const { command, agentId = 'terminal', cwd, env: extraEnv = {}, timeout } = req.body || {};
  const trimmedCmd = String(command || '').trim();
  if (!trimmedCmd) return res.status(400).json({ error: 'command required' });

  if (trimmedCmd === 'cd' || trimmedCmd.startsWith('cd ')) {
    const currentPublicCwd = cwd || getAgentCwd(agentId);
    const currentResolved = resolveCommandCwd(currentPublicCwd, agentId);
    const target = trimmedCmd === 'cd' ? '~' : trimmedCmd.slice(3).trim();
    const result = await runLocal(
      `cd ${escapeShellArg(currentResolved.realPath)} && cd ${escapeShellArg(target)} && pwd`,
      { cwd: currentResolved.realPath }
    );

    if (result.exitCode !== 0) {
      return res.json({
        output: '',
        error: `bash: cd: ${target}: ${result.error}`,
        cwd: currentPublicCwd,
        exitCode: result.exitCode,
      });
    }

    const resolvedCwd = normalizeSlashes(result.output.trim());
    const nextPublicCwd = resolvedCwd.startsWith(normalizeSlashes(env.CONTAINER_HOME || '/host_system'))
      ? containerToHost(resolvedCwd, env)
      : resolvedCwd;

    setAgentCwd(agentId, nextPublicCwd);
    return res.json({ output: '', error: '', cwd: nextPublicCwd, exitCode: 0 });
  }

  const interactivePattern = /(^|\s)(vi|vim|nvim|nano|less|more|top|htop|watch|man|ssh|sftp|scp|ftp|telnet|tmux|screen)(\s|$)/i;
  if (interactivePattern.test(trimmedCmd)) {
    return res.status(400).json({
      error: 'Interactive command blocked. Use non-interactive shell commands only.',
      exitCode: 126,
    });
  }

  const resolvedCwd = resolveCommandCwd(cwd || getAgentCwd(agentId), agentId);
  const result = await runLocal(trimmedCmd, {
    cwd: resolvedCwd.realPath,
    env: extraEnv,
    timeout,
  });

  return res.json({ ...result, cwd: resolvedCwd.publicPath });
});

router.post('/system/python', checkLocalAccess, async (req, res) => {
  const { code, agentId = 'terminal', cwd, timeout } = req.body || {};
  if (typeof code !== 'string') return res.status(400).json({ error: 'code required' });

  const resolvedCwd = resolveCommandCwd(cwd || getAgentCwd(agentId), agentId);
  const pythonCmd = process.env.PYTHON_CMD || 'python3';
  const b64Code = Buffer.from(code, 'utf8').toString('base64');
  const result = await runLocal(
    `printf "%s" ${escapeShellArg(b64Code)} | base64 -d | ${pythonCmd}`,
    { cwd: resolvedCwd.realPath, timeout: timeout || 120 }
  );

  return res.json({ ...result, cwd: resolvedCwd.publicPath });
});

router.post('/system/fs/read', checkLocalAccess, (req, res) => {
  const { path: filePath, agentId = 'terminal', start_line, end_line } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'path required' });

  try {
    const resolved = resolveExistingPath(filePath, agentId);
    const raw = fs.readFileSync(resolved.realPath, 'utf8');

    if (start_line !== undefined || end_line !== undefined) {
      const lines = raw.split('\n');
      const total = lines.length;
      const start = Math.max(0, (Number(start_line) || 1) - 1);
      const endInclusive = Math.max(start + 1, Number(end_line) || total);
      const end = Math.min(total, endInclusive);

      return res.json({
        content: lines.slice(start, end).join('\n'),
        path: resolved.publicPath,
        start_line: start + 1,
        end_line: end,
        total_lines: total,
        partial: true,
      });
    }

    return res.json({ content: raw, path: resolved.publicPath });
  } catch (err) {
    const status = err?.code === 'ENOENT' ? 404 : 500;
    return res.status(status).json({
      error: err.message,
      path: filePath,
      candidates: err.candidates || undefined,
    });
  }
});

router.post('/system/fs/write', checkLocalAccess, (req, res) => {
  const { path: filePath, content = '', agentId = 'terminal' } = req.body || {};
  if (!filePath) return res.status(400).json({ error: 'path required' });

  try {
    const resolved = resolveWritablePath(filePath, agentId);
    fs.mkdirSync(path.dirname(resolved.realPath), { recursive: true });
    fs.writeFileSync(resolved.realPath, String(content), 'utf8');
    return res.json({ success: true, path: resolved.publicPath });
  } catch (err) {
    return res.status(500).json({ error: err.message, path: filePath });
  }
});

router.post('/system/fs/list', checkLocalAccess, (req, res) => {
  const { path: targetPath, agentId = 'terminal' } = req.body || {};
  try {
    const resolved = resolveExistingPath(targetPath || getAgentCwd(agentId), agentId);
    const files = fs.readdirSync(resolved.realPath, { withFileTypes: true })
      .map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

    return res.json({ path: resolved.publicPath, files });
  } catch (err) {
    const status = err?.code === 'ENOENT' ? 404 : 500;
    return res.status(status).json({
      error: err.message,
      path: targetPath || getAgentCwd(agentId),
      candidates: err.candidates || undefined,
    });
  }
});

router.post('/system/fs/find', checkLocalAccess, (req, res) => {
  const {
    pattern = '*',
    cwd,
    path: targetPath,
    maxDepth = 8,
    agentId = 'terminal',
    relative = false,
    exclude = [],
    type = '',
  } = req.body || {};

  try {
    const resolved = resolveExistingPath(targetPath || cwd || getAgentCwd(agentId), agentId);
    const regex = new RegExp(
      '^' + String(pattern)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$',
      'i'
    );

    const excludes = Array.isArray(exclude) ? exclude : [exclude];
    const typeFilter = String(type || '').toLowerCase();
    const results = [];

    function walk(dir, depth) {
      if (depth > Number(maxDepth) || results.length >= 200) return;

      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= 200) break;

        const full = path.join(dir, entry.name);
        const normalized = normalizeSlashes(full);

        if (excludes.some((item) => item && normalized.includes(`/${item}/`))) continue;

        const isDir = entry.isDirectory();
        const typeMatches =
          !typeFilter ||
          typeFilter === '' ||
          (typeFilter === 'file' && !isDir) ||
          (typeFilter === 'dir' && isDir);

        if (typeMatches && regex.test(entry.name)) {
          results.push(relative ? path.relative(resolved.realPath, full) : normalizeSlashes(path.join(resolved.publicPath, path.relative(resolved.realPath, full))));
        }

        if (isDir) walk(full, depth + 1);
      }
    }

    walk(resolved.realPath, 0);
    return res.json({ files: results, path: resolved.publicPath });
  } catch (err) {
    const status = err?.code === 'ENOENT' ? 404 : 500;
    return res.status(status).json({
      error: err.message,
      path: targetPath || cwd || getAgentCwd(agentId),
      candidates: err.candidates || undefined,
    });
  }
});

router.post('/system/fs/patch', checkLocalAccess, (req, res) => {
  const {
    path: filePath,
    oldStr,
    newStr,
    old_str,
    new_str,
    replaceAll = false,
    replace_all = false,
    agentId = 'terminal',
  } = req.body || {};

  if (!filePath) return res.status(400).json({ error: 'path required' });

  try {
    const resolved = resolveExistingPath(filePath, agentId);
    const current = fs.readFileSync(resolved.realPath, 'utf8');
    const from = oldStr ?? old_str;
    const to = newStr ?? new_str ?? '';

    if (typeof from !== 'string' || !current.includes(from)) {
      return res.status(400).json({ error: 'Target string not found in file' });
    }

    const updated = (replaceAll || replace_all)
      ? current.split(from).join(to)
      : current.replace(from, to);

    fs.writeFileSync(resolved.realPath, updated, 'utf8');
    return res.json({ success: true, path: resolved.publicPath });
  } catch (err) {
    const status = err?.code === 'ENOENT' ? 404 : 500;
    return res.status(status).json({
      error: err.message,
      path: filePath,
      candidates: err.candidates || undefined,
    });
  }
});

export default router;
