# Baseline Tests — Green

Testes fixos do staging Green. Devem rodar em toda build/deploy.

## Cobertura atual
- preflight de configuração
- validação do artefato local `dist`
- validação do artefato real do container
- validação de logs do container
- smoke de runtime no app servido

## Comandos
- `npm run test:preflight`
- `npm run test:dist`
- `npm run test:image-dist`
- `npm run test:logs`
- `npm run test:runtime`
- `npm run test:baseline`
