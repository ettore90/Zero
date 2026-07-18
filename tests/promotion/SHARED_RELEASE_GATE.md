# Shared Release Gate

O projeto agora possui uma camada compartilhada de release gate em `scripts/release-*.mjs`.

## Scripts compartilhados
- `scripts/release-image-dist.mjs`
- `scripts/release-container-logs.mjs`
- `scripts/release-runtime-smoke.mjs`
- `scripts/release-gate.mjs`
- `scripts/shared/release-test-lib.mjs`

## Uso no Green
Os wrappers existentes do Green continuam funcionando:
- `test-green-image-dist.mjs`
- `test-green-container-logs.mjs`
- `test-green-runtime-smoke.mjs`

Eles apenas carregam os scripts compartilhados com defaults do Green.

## Uso no Codex
No Codex, basta copiar essa mesma estrutura e executar os scripts compartilhados com variáveis de ambiente do release.

## Benefício
- evita duplicação
- reduz drift entre Green e Codex
- mantém o Green como staging gate
- mantém o Codex como release gate simplificado
