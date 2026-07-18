# Codex Release Gate Template

Este template documenta como reutilizar a estratégia do Green no momento da promoção Green -> Codex.

## Objetivo
No Codex, o gate deve validar a **release implantada**, não revalidar todo o código da mudança.

## Gate recomendado para Codex

### 1. Artefato real do container
Validar no container do Codex:
- `index.html` presente
- assets presentes
- base path correto (`/codex/assets/`)
- ausência de referências erradas do Green

### 2. Logs do container
Validar:
- `BASE_PATH: /codex`
- `assetsPath exists: true`
- `indexPath exists: true`
- porta esperada do Codex

### 3. Runtime smoke da release
Validar no app servido:
- `/codex/` responde `200`
- HTML servido referencia `/codex/assets/`
- endpoint de login responde `200`
- payload básico válido

## Reuso esperado
Os scripts do Green devem ser copiados/adaptados para o Codex com parametrização por:
- nome do container
- base path
- porta
- título esperado

## Diferença de foco
- **Green**: staging gate + validação de mudança
- **Codex**: release gate simplificado + validação da implantação final

## Sugestão de comandos no Codex
- `npm run test:release:image-dist`
- `npm run test:release:logs`
- `npm run test:release:runtime`
- `npm run test:release`

## Variáveis esperadas
Exemplo para o Codex:

```bash
RELEASE_APP_NAME=Codex
RELEASE_CONTAINER_NAME=codex
RELEASE_TEST_HOST=codex
RELEASE_TEST_PORT=3010
RELEASE_BASE_PATH=/codex
RELEASE_EXPECTED_TITLE=Codex
RELEASE_EXPECTED_LOG_PORT=3010
```

Os mesmos scripts compartilhados do Green podem ser reutilizados no Codex com essa parametrização.
