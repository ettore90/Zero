import { exec, spawn } from 'child_process';

export function sanitizeSSHOutput(output = '') {
  return String(output)
    .replace(/\r\n/g, '\n')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/Permanently added .* to the list of known hosts\.\n?/g, '');
}

export function escapeShellArg(str) {
  return `'${String(str).replace(/'/g, `'"'"'`)}'`;
}

export function splitCommand(cmd = '') {
  return String(cmd).trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
}

export function executeDirectCommand(command, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(command, opts, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stderr }));
      resolve({ stdout, stderr });
    });
  });
}

export function executeSSHCommand(sshArgs, command) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...sshArgs, command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => code === 0 ? resolve({ stdout: sanitizeSSHOutput(stdout), stderr: sanitizeSSHOutput(stderr) }) : reject(new Error(stderr || `ssh exited ${code}`)));
  });
}
