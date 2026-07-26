# Shared Release Gate

O projeto possui uma camada compartilhada de release gate em `scripts/release-*.mjs`.

## Scripts compartilhados
- `scripts/release-image-dist.mjs`
- `scripts/release-container-logs.mjs`
- `scripts/release-runtime-smoke.mjs`
- `scripts/release-gate.mjs`
- `scripts/shared/release-test-lib.mjs`

## Uso no main
A camada compartilhada continua sendo usada pelo fluxo do `main`.

## Esclarecimento de escopo
- a branch Git `green` deixa de existir;
- o runtime/ambiente Green continua existindo;
- o alinhamento é da branch Git para `main`;
- não há wrappers `test-main-*` neste repositório.

## Benefício
- evita duplicação
- reduz drift entre o fluxo do `main` e a camada compartilhada
- mantém o runtime Green sem alterar o contrato de release gate
