import { createRecorder, getReleaseConfig, readContainerLogs } from './shared/release-test-lib.mjs';

const cfg = getReleaseConfig();
const r = createRecorder();
const logs = readContainerLogs(cfg.container);

if (logs.includes(`[static] BASE_PATH: ${cfg.basePath}`)) r.ok('logs-base-path', `Logs confirmam BASE_PATH ${cfg.basePath}`);
else r.ko('logs-base-path', `Logs não confirmam BASE_PATH ${cfg.basePath}`);

if (logs.includes('[static] assetsPath exists: true')) r.ok('logs-assets-exist', 'Logs confirmam assetsPath');
else r.ko('logs-assets-exist', 'Logs não confirmam assetsPath');

if (logs.includes('[static] indexPath exists: true')) r.ok('logs-index-exist', 'Logs confirmam indexPath');
else r.ko('logs-index-exist', 'Logs não confirmam indexPath');

if (logs.includes(`Server listening on ${cfg.expectedLogPort}`)) r.ok('logs-port', `Logs confirmam porta ${cfg.expectedLogPort}`);
else r.ko('logs-port', `Logs não confirmam porta ${cfg.expectedLogPort}`);

r.flush('Validação de logs OK', 'Validação de logs falhou');
