export function getEnv(name, fallback = '') {
  const value = process.env[name];
  return value == null || value === '' ? fallback : value;
}

export function getBoolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
