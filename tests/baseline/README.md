# Baseline Tests — Green

Testes fixos do staging Green. Devem rodar em toda build/deploy.

## Status do caminho oficial atual

O smoke backend oficial atual é:
- `npm run validate:api`
- `npm run validate`

Cobertura atual do smoke backend oficial:
- login/sessão do usuário `ettore`
- validação de modelos via `GET /api/state/ettore`
- resposta SSE em `/api/chat` para `gpt-5.4-LAB` e `gpt-5.4-mini-qa`
- validação da tool `run_terminal_command` via `/api/chat`

## Cobertura legada ainda existente
- validação do artefato local `dist`
- validação do artefato real do container
- validação de logs do container
- smoke de runtime no app servido

## Comandos
### Oficiais atuais
- `npm run validate:api`
- `npm run validate`

### Legado ainda disponível
- `npm run test:dist`
- `npm run test:image-dist`
- `npm run test:logs`
- `npm run test:runtime`
- `npm run test:baseline`

## Observações
- `npm run test:preflight` não existe no `package.json` atual e não é o gate oficial atual.
- O legado ainda não foi removido; o caminho canônico atual para smoke backend é `validate:api`.
