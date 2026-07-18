import { spawnSync } from 'child_process';

const commands = [
  ['node', ['scripts/test-dist.mjs']],
  ['node', ['scripts/test-image-dist.mjs']],
  ['node', ['scripts/test-container-logs.mjs']],
  ['node', ['scripts/test-runtime-smoke.mjs']]
];

for (const [cmd, args] of commands) {
  console.log(`
>>> Executando: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`
Promotion gate falhou em: ${cmd} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

console.log('
Promotion gate OK: dist + image + logs + runtime smoke aprovados.');
