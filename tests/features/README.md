# Feature Tests — Green

Cada mudança no Green deve adicionar sua própria evidência de teste nesta pasta.

## Objetivo
Garantir que a alteração foi validada no staging antes da promoção para o Codex.

## Convenção
Para cada feature/fix:
- criar uma subpasta com nome curto e estável
- incluir um README com escopo, risco e evidências
- incluir scripts/testes automatizados quando aplicável

## Estrutura sugerida

```text
tests/features/
  chat-streaming-fix/
    README.md
    smoke.mjs
  auth-ui-update/
    README.md
    assertions.mjs
```

## Template mínimo do README

```md
# Nome da mudança

## Escopo alterado
- arquivos/fluxos impactados

## Risco
- baixo | médio | alto

## Testes automáticos
- comandos executados

## Evidência para promoção
- critérios objetivos para liberar ao Codex
```
