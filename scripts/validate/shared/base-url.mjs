export function getBaseUrl() {
  const raw = process.env.VALIDATE_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:3010';
  return raw.replace(/\/$/, '');
}
