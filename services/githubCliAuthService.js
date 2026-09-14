import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config/paths.js';

const execFileAsync = promisify(execFile);
const sessions = new Map();
const MAX_OUTPUT = 8192;
const expiresAt = () => Date.now() + 15 * 60_000;
function configDir() { const dir = process.env.GITHUB_CLI_CONFIG_DIR || path.join(paths.storageRoot, 'gh'); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; }
function publicState(owner) { const item = sessions.get(owner); if (!item) return { active: false }; if (item.expiresAt < Date.now() && item.active) { item.child.kill(); item.active = false; item.error = 'expired'; } return { active: item.active, verificationUri: item.verificationUri || 'https://github.com/login/device', userCode: item.userCode || null, expiresAt: Math.floor(item.expiresAt / 1000), error: item.error || null }; }
export async function githubCliAuthenticated() { try { await execFileAsync(process.env.GITHUB_CLI_PATH || 'gh', ['auth', 'token'], { timeout: 3000, maxBuffer: 4096, env: { ...process.env, GH_CONFIG_DIR: configDir() } }); return true; } catch { return false; } }
export async function startGithubCliDeviceFlow(owner) {
  if (await githubCliAuthenticated()) return { active: false, connected: true };
  const prior = sessions.get(owner); if (prior?.active) return publicState(owner);
  let child;
  try { child = spawn(process.env.GITHUB_CLI_PATH || 'gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], { env: { ...process.env, GH_CONFIG_DIR: configDir(), GH_PROMPT_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { throw new Error('GitHub CLI unavailable'); }
  const item = { child, active: true, expiresAt: expiresAt(), verificationUri: 'https://github.com/login/device', userCode: null, error: null, output: '' }; sessions.set(owner, item);
  const capture = (chunk) => { item.output = (item.output + String(chunk)).slice(-MAX_OUTPUT); const url = /(https:\/\/[^\s]+)/.exec(item.output); if (url) item.verificationUri = url[1].replace(/[).,]+$/, ''); const code = /(?:one-time code|code)[:\s]+([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(item.output); if (code) item.userCode = code[1]; };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.on('error', () => { item.active = false; item.error = 'GitHub CLI failed to start'; });
  child.on('close', async (code) => { item.active = false; item.error = code === 0 && await githubCliAuthenticated() ? null : (item.error || 'GitHub authorization was not completed'); });
  return publicState(owner);
}
export function githubCliDeviceFlowStatus(owner) { return { ...publicState(owner), connected: false }; }
export async function disconnectGithubCli() { try { await execFileAsync(process.env.GITHUB_CLI_PATH || 'gh', ['auth', 'logout', '--hostname', 'github.com', '--user', ''], { timeout: 5000, maxBuffer: 4096, env: { ...process.env, GH_CONFIG_DIR: configDir(), GH_PROMPT_DISABLED: '1' } }); } catch { /* no configured CLI account */ } return true; }
