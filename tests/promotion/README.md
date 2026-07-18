# Promotion Gate — Green -> Codex

O promotion gate é a validação mínima antes de promover mudanças do Green para o Codex.

## Gate atual
- preflight aprovado
- artefato real do container aprovado
- logs do container aprovados
- runtime smoke aprovado

## Observação
A validação de promoção usa o artefato real servido/deployado, não o `dist` local do workspace.
Isso evita falso negativo quando o workspace está com artefato stale, mas o container foi rebuildado corretamente.

## Comando
- `npm run test:promotion`

## Evolução esperada
Adicionar nesta etapa:
- testes por feature obrigatórios para mudanças de maior risco
- smoke E2E curto
- checklist manual quando a alteração for sensível
