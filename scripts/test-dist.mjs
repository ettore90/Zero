import fs from 'fs';
import path from 'path';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const indexPath = path.join(distDir, 'index.html');
const assetsDir = path.join(distDir, 'assets');
const failures = [];
const checks = [];
const basePath = (process.env.RELEASE_BASE_PATH || '').replace(/\/$/, '');
const normalizedBasePath = basePath || '';
const assetsPrefix = `${normalizedBasePath}/assets/`;

function ok(name, detail) { checks.push({ status: 'PASS', name, detail }); }
function ko(name, detail) { checks.push({ status: 'FAIL', name, detail }); failures.push(name); }

if (fs.existsSync(distDir)) ok('dist-exists', 'dist existe');
else ko('dist-exists', 'dist não existe');

if (fs.existsSync(indexPath)) ok('dist-index-exists', 'dist/index.html existe');
else ko('dist-index-exists', 'dist/index.html não existe');

if (fs.existsSync(assetsDir)) ok('dist-assets-dir-exists', 'dist/assets existe');
else ko('dist-assets-dir-exists', 'dist/assets não existe');

if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  if (html.includes(assetsPrefix)) ok('dist-html-assets-prefix', `HTML referencia ${assetsPrefix}`);
  else ko('dist-html-assets-prefix', `HTML não referencia ${assetsPrefix}`);

  const wrongAssetRefs = [...html.matchAll(/(?:src|href)=['"]((?:\/)?assets\/[^'"]+)['"]/g)].map(m => m[1]);
  if (wrongAssetRefs.length === 0) ok('dist-html-no-unscoped-assets', 'HTML não referencia assets fora do base path esperado');
  else ko('dist-html-no-unscoped-assets', `HTML referencia assets fora do base path esperado: ${wrongAssetRefs.join(', ')}`);

  const assetRegex = new RegExp(`${assetsPrefix.replace(/[.*+?^${}()|[\]\]/g, '\\$&')}([^"']+)`, 'g');
  const assetMatches = [...html.matchAll(assetRegex)].map(m => m[1]);
  if (assetMatches.length > 0) ok('dist-html-asset-tags', `HTML referencia ${assetMatches.length} asset(s)`);
  else ko('dist-html-asset-tags', 'HTML não referencia assets');

  const missing = assetMatches.filter(name => !fs.existsSync(path.join(assetsDir, name)));
  if (missing.length === 0) ok('dist-assets-present', 'Todos os assets referenciados existem');
  else ko('dist-assets-present', `Assets ausentes: ${missing.join(', ')}`);
}

for (const check of checks) {
  console.log(`[${check.status}] ${check.name} - ${check.detail}`);
}

if (failures.length > 0) {
  console.error(`\nValidação de dist falhou: ${failures.length} problema(s).`);
  process.exit(1);
}

console.log(`\nValidação de dist OK: ${checks.length} verificações aprovadas.`);
