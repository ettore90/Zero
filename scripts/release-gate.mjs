import { spawnSync } from 'child_process';

const commands = [
  ['node', ['scripts/release-image-dist.mjs']],
  ['node', ['scripts/release-container-logs.mjs']],
  ['node', ['scripts/release-runtime-smoke.mjs']]
];

for (const [cmd, args] of commands) {
  console.log(`\n>>> Executando: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) {
    console.error(`\nRelease gate falhou em: ${cmd} ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
}

console.log('\nRelease gate OK: artefato + logs + runtime aprovados.');
