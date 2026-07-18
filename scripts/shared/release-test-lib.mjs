import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

export function getReleaseConfig() {
  const appName = process.env.RELEASE_APP_NAME || 'Zero';
  const container = process.env.RELEASE_CONTAINER_NAME || 'app';
  const host = process.env.RELEASE_TEST_HOST || container;
  const port = Number(process.env.RELEASE_TEST_PORT || '3000');
  const rawBasePath = process.env.RELEASE_BASE_PATH || '';
  const basePath = rawBasePath.replace(/\/$/, '');
  const expectedTitle = process.env.RELEASE_EXPECTED_TITLE || appName;
  const expectedAssetsPath = `${basePath}/assets/`;
  const expectedLogPort = process.env.RELEASE_EXPECTED_LOG_PORT || String(port);
  return { appName, container, host, port, basePath, expectedTitle, expectedAssetsPath, expectedLogPort };
}

export function createRecorder() {
  const checks = [];
  const failures = [];
  return {
    ok(name, detail) { checks.push({ status: 'PASS', name, detail }); },
    ko(name, detail) { checks.push({ status: 'FAIL', name, detail }); failures.push(name); },
    flush(successMessage, failurePrefix) {
      for (const check of checks) console.log(`[${check.status}] ${check.name} - ${check.detail}`);
      if (failures.length > 0) {
        console.error(`\n${failurePrefix}: ${failures.length} problema(s).`);
        process.exit(1);
      }
      console.log(`\n${successMessage}: ${checks.length} verificações aprovadas.`);
    }
  };
}

export function readContainerFile(container, filePath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-file-'));
  const tarPath = path.join(tmpDir, 'file.tar');

  const pyScript = `
import sys, socket, http.client
container = sys.argv[1]
file_path = sys.argv[2]
tar_path  = sys.argv[3]

class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost', timeout=60)
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')

conn = UnixHTTPConnection()
conn.request('GET', f'/containers/{container}/archive?path={file_path}')
resp = conn.getresponse()
print(resp.status)
data = resp.read()
with open(tar_path, 'wb') as f:
    f.write(data)
`;

  const raw = execFileSync('python3', ['-c', pyScript, container, filePath, tarPath], { encoding: 'utf8' }).trim();
  const statusCode = Number(raw.split('\n')[0] || '0');
  let content = '';
  if (statusCode === 200) {
    const fileName = path.basename(filePath);
    content = execSync(`tar -xOf ${tarPath} ${fileName}`, { encoding: 'utf8' });
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  return { statusCode, content };
}

export function readContainerLogs(container) {
  const inspectScript = `
import sys, socket, http.client, json
container = sys.argv[1]

class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost')
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')

conn = UnixHTTPConnection()
conn.request('GET', f'/containers/{container}/json')
resp = conn.getresponse()
data = json.loads(resp.read().decode('utf-8', 'ignore'))
started = data.get('State', {}).get('StartedAt', '')
print(started)
`;

  let since = '';
  try {
    const raw = execFileSync('python3', ['-c', inspectScript, container], { encoding: 'utf8' }).trim();
    if (raw) {
      const ts = Math.floor(new Date(raw).getTime() / 1000);
      if (!isNaN(ts)) since = String(ts);
    }
  } catch {}

  const logsScript = `
import sys, socket, http.client
container = sys.argv[1]
since     = sys.argv[2]

class UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self):
        super().__init__('localhost')
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')

conn = UnixHTTPConnection()
if since:
    until = int(since) + 10
    qs = f'/containers/{container}/logs?stdout=1&stderr=1&since={since}&until={until}'
else:
    qs = f'/containers/{container}/logs?stdout=1&stderr=1&tail=200'
conn.request('GET', qs)
resp = conn.getresponse()
sys.stdout.buffer.write(resp.read())
`;

  const raw = execFileSync('python3', ['-c', logsScript, container, since], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  return raw.replace(/[\x00-\x08\x0b-\x1F\x7F]/g, '');
}

export function httpRequest({ host, port, path, method = 'GET', body = null, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
