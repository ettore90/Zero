import { request } from 'http';
import { request as httpsRequest } from 'https';

export function httpJson(url, { method = 'GET', headers = {}, body = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? httpsRequest : request;
    const req = client(target, { method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const text = data.trim();
        let json = null;
        if (text) {
          try { json = JSON.parse(text); } catch {}
        }
        resolve({ status: res.statusCode || 0, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}
