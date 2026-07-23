# Promotion Gate — Green -> Codex

O promotion gate é a validação mínima antes de promover mudanças do Green para o Codex.

## Gate atual
- gate de promoção separado do smoke oficial
- artefato real do container aprovado
- logs do container aprovados
- runtime smoke aprovado

## Observação
A validação de promoção usa o artefato real servido/deployado, não o `dist` local do workspace.
Isso evita falso negativo quando o workspace está com artefato stale, mas o container foi rebuildado corretamente.

## Comando
- `npm run test:promotion`

## Relação com o smoke oficial
- O smoke oficial atual é `npm run validate:api` / `npm run validate`.
- O smoke E2E browser atual é `npm run test:e2e`.
- `test:promotion` não é o smoke oficial; é um gate separado de promoção.
- `test:dist`, `test:image-dist`, `test:logs`, `test:runtime` e `test:baseline` são caminhos legados/compatibilidade.

## Evolução esperada
Adicionar nesta etapa:
- testes por feature obrigatórios para mudanças de maior risco
- smoke E2E curto
- checklist manual quando a alteração for sensível
