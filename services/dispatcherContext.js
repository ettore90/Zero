import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { env } from '../config/env.js';
import { readState, writeState } from './userStateService.js';
import { listAgents, replaceAgents } from './agentStore.js';
import { containerToHost, hostToContainer } from '../utils/pathTransforms.js';
import { escapeShellArg, splitCommand, sanitizeSSHOutput } from '../utils/ssh.js';

const execAsync = promisify(exec);

const agentCwd = new Map();
const SSH_DEFAULT_CWD = process.env.SSH_DEFAULT_CWD || '/';
const PYTHON_CMD = process.env.PYTHON_CMD || 'python3';
const STORAGE_PATH = typeof env.STORAGE_PATH === 'string' ? env.STORAGE_PATH.trim() : '';
const DEFAULT_SHELL = '/bin/sh';

function getCwd(agentId = 'default') {
  return agentCwd.get(String(agentId)) || SSH_DEFAULT_CWD;
}

function setCwd(agentId = 'default', cwd = SSH_DEFAULT_CWD) {
  agentCwd.set(String(agentId), cwd || SSH_DEFAULT_CWD);
  return getCwd(agentId);
}

function resolveSafePath(p) {
  return path.resolve(String(p || '/'));
}

async function executeLocalCommand(command, cwd = '/') {
  const safeCwd = resolveSafePath(cwd || '/');

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: safeCwd,
      shell: DEFAULT_SHELL,
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    });

    return {
      output: sanitizeSSHOutput(stdout || ''),
      error: sanitizeSSHOutput(stderr || ''),
      exitCode: 0,
      stdout: sanitizeSSHOutput(stdout || ''),
      stderr: sanitizeSSHOutput(stderr || ''),
      timedOut: false,
    };
  } catch (err) {
    return {
      output: sanitizeSSHOutput(err?.stdout || ''),
      error: sanitizeSSHOutput(err?.stderr || err?.message || 'Command failed'),
      exitCode: typeof err?.code === 'number' ? err.code : 1,
      stdout: sanitizeSSHOutput(err?.stdout || ''),
      stderr: sanitizeSSHOutput(err?.stderr || err?.message || ''),
      timedOut: false,
    };
  }
}

function executeSSHCommand(command, cwd = '/', callback) {
  executeLocalCommand(command, cwd)
    .then(callback)
    .catch((err) => {
      callback({
        output: '',
        error: err?.message || String(err),
        exitCode: -1,
        stdout: '',
        stderr: err?.message || String(err),
        timedOut: false,
      });
    });
}

function executeSSHWrite(hostPath, fileContent = '', callback) {
  const safePath = resolveSafePath(hostPath);
  fs.writeFile(safePath, String(fileContent || ''), 'utf8', (err) => {
    if (err) {
      callback({
        output: '',
        error: err.message,
        exitCode: -1,
        stdout: '',
        stderr: err.message,
        timedOut: false,
      });
      return;
    }
    callback({
      output: '',
      error: '',
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
    });
  });
}

function executeGit(command, cwd) {
  return new Promise((resolve, reject) => {
    executeSSHCommand(command, containerToHost(cwd || getCwd('default')) || '/', (result) => {
      if ((result.exitCode ?? 0) !== 0) {
        reject({
          error: result.error || result.stderr || 'git command failed',
          exitCode: result.exitCode ?? 1,
        });
      } else {
        resolve({
          output: result.output || result.stdout || '',
          error: result.error || '',
        });
      }
    });
  });
}

async function fetchWithRetry(url, options = {}, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 300 * (i + 1)));
      }
    }
  }
  throw lastErr;
}

export function buildDispatcherCtx(username, extra = {}) {
  if (!STORAGE_PATH) {
    throw new Error('STORAGE_PATH environment variable is required and cannot be empty');
  }

  if (!fs.existsSync(STORAGE_PATH)) {
    fs.mkdirSync(STORAGE_PATH, { recursive: true });
  }

  return {
    ...extra,
    executeSSHCommand,
    executeSSHWrite,
    executeGit,
    getCwd,
    setCwd,
    containerToHost: (p) => containerToHost(p, env),
    hostToContainer: (p) => hostToContainer(p, env),
    escapeShellArg,
    splitCommand,
    resolveSafePath,
    readState,
    writeState,
    getAgents: listAgents,
    saveAgents: replaceAgents,
    PYTHON_CMD,
    STORAGE_PATH,
    fetchWithRetry: typeof extra?.fetchWithRetry === 'function' ? extra.fetchWithRetry : fetchWithRetry,
    OLLAMA_SERVER: env.OLLAMA_SERVER,
    runAgentLoop: null,
    broadcastToUser: extra.broadcastToUser,
    TOOL_NAMES: [],
  };
}