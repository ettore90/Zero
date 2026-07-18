import { createRecorder, getReleaseConfig, httpRequest } from './shared/release-test-lib.mjs';

const cfg = getReleaseConfig();
const r = createRecorder();

try {
  const html = await httpRequest({ host: cfg.host, port: cfg.port, path: `${cfg.basePath}/`, method: 'GET', headers: { Accept: 'text/html' } });
  if (html.status === 200) r.ok('runtime-html-200', `${cfg.basePath}/ respondeu 200`);
  else r.ko('runtime-html-200', `${cfg.basePath}/ respondeu ${html.status}`);

  if (html.body.includes(cfg.expectedAssetsPath)) r.ok('runtime-html-assets', `HTML servido referencia ${cfg.expectedAssetsPath}`);
  else r.ko('runtime-html-assets', `HTML servido não referencia ${cfg.expectedAssetsPath}`);

  const loginPayload = JSON.stringify({ username: 'release-smoke', password: 'release-smoke' });
  const login = await httpRequest({
    host: cfg.host,
    port: cfg.port,
    path: `${cfg.basePath}/api/auth/login`,
    method: 'POST',
    body: loginPayload,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginPayload),
      Accept: 'application/json'
    }
  });

  if (login.status === 200) r.ok('runtime-login-200', 'POST /api/auth/login respondeu 200');
  else r.ko('runtime-login-200', `POST /api/auth/login respondeu ${login.status}`);

  let parsed = null;
  try { parsed = JSON.parse(login.body); } catch {}
  if (parsed?.ok === true && parsed?.token) r.ok('runtime-login-payload', 'Payload de login válido');
  else r.ko('runtime-login-payload', 'Payload de login inválido');
} catch (error) {
  r.ko('runtime-connection', `Falha de conexão com ${cfg.host}:${cfg.port} - ${error.message}`);
}

r.flush('Smoke de runtime OK', 'Smoke de runtime falhou');
