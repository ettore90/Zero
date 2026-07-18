import { createRecorder, getReleaseConfig, readContainerFile } from './shared/release-test-lib.mjs';

const cfg = getReleaseConfig();
const r = createRecorder();
const { statusCode, content } = readContainerFile(cfg.container, '/app/dist/index.html');

if (statusCode === 200) r.ok('image-dist-archive-200', 'Docker API retornou /app/dist/index.html');
else r.ko('image-dist-archive-200', `Docker API retornou status ${statusCode}`);

if (content) r.ok('image-dist-extract-index', 'index.html extraído do container');
else r.ko('image-dist-extract-index', 'Falha ao extrair index.html do container');

if (content) {
  if (content.includes(cfg.expectedAssetsPath)) r.ok('image-dist-assets-path', `Artefato referencia ${cfg.expectedAssetsPath}`);
  else r.ko('image-dist-assets-path', `Artefato não referencia ${cfg.expectedAssetsPath}`);

  const wrongAssetRefs = [...content.matchAll(/(?:src|href)=['\"]((?:\\/)?assets\/[^'\"]+)['\"]/g)].map(m => m[1]);
  if (wrongAssetRefs.length === 0) r.ok('image-dist-no-unscoped-assets', 'Artefato não referencia assets fora do base path esperado');
  else r.ko('image-dist-no-unscoped-assets', `Artefato referencia assets fora do base path esperado: ${wrongAssetRefs.join(', ')}`);

  const expectedTitleTag = `<title>${cfg.expectedTitle}</title>`;
  if (content.includes(expectedTitleTag)) r.ok('image-dist-title', `Artefato contém title esperado: ${cfg.expectedTitle}`);
  else r.ko('image-dist-title', `Artefato não contém title esperado: ${cfg.expectedTitle}`);
}

r.flush('Validação do artefato do container OK', 'Validação do artefato do container falhou');
