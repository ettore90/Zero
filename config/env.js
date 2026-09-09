const isServerRuntime =
  typeof process !== 'undefined' &&
  typeof process?.env !== 'undefined' &&
  typeof window === 'undefined';

const getProcessEnv = () => (isServerRuntime ? process.env : undefined);

const getEnv = (name, fallback = '') => {
  const processEnv = getProcessEnv();
  if (!processEnv) {
    return fallback;
  }

  const value = processEnv[name];
  return value === undefined ? fallback : value;
};

const getRequiredServerEnv = (name) => {
  if (!isServerRuntime) {
    return '';
  }

  const value = getEnv(name);
  if (value === '') {
    throw new Error(`config/env.js is server-only. Missing required environment variable: ${name}`);
  }
  return value;
};

export const env = {
  PORT: getEnv('PORT', '3011'),
  STORAGE_PATH: getEnv('STORAGE_PATH', '/app/storage'),
  DB_FILE_PATH: getEnv('DB_FILE_PATH', getEnv('RUNTIME_DB_PATH')),
  DB_FILE_NAME: getEnv('DB_FILE_NAME', getEnv('RUNTIME_DB_FILE')),
  RUNTIME_DB_PATH: getEnv('RUNTIME_DB_PATH'),
  RUNTIME_DB_FILE: getEnv('RUNTIME_DB_FILE'),
  BUILD_PATH: getEnv('BUILD_PATH', '/app/dist'),
  PRESENTATIONS_PATH: getEnv('PRESENTATIONS_PATH'),
  SHARED_ASSETS_DIR: getEnv('SHARED_ASSETS_DIR'),
  SHARED_ASSETS_PUBLIC_PATH: getEnv('SHARED_ASSETS_PUBLIC_PATH', '/shared-assets'),
  BASE_PATH: getRequiredServerEnv('BASE_PATH'),
  OLLAMA_SERVER: getEnv('OLLAMA_SERVER', 'http://127.0.0.1:11434'),
  NEBULA_SERVER: getEnv('NEBULA_SERVER', 'http://127.0.0.1:3001'),
  STT_SERVER: getEnv('STT_SERVER', 'http://127.0.0.1:10400'),
  STT_TRANSCRIBE_PATH: getEnv('STT_TRANSCRIBE_PATH', '/transcribe'),
  STT_REQUEST_TIMEOUT_MS: Number.parseInt(getEnv('STT_REQUEST_TIMEOUT_MS', '120000'), 10),
  ALLOW_LOCAL_ACCESS: getEnv('ALLOW_LOCAL_ACCESS', 'true') !== 'false',
  ADMIN_IPS: getEnv('ADMIN_IPS', '::1,127.0.0.1,::ffff:127.0.0.1').split(','),
  HOST_HOME: getEnv('HOST_HOME', '/home/ettore'),
  CONTAINER_HOME: getEnv('CONTAINER_HOME', '/host_system'),
  // Consumed by utils/pathTransforms.js, which until now read them off an
  // object that never declared them. HOST_WORKSPACE_ROOT is intentionally
  // empty by default: without it the /uby <-> host mapping is a no-op
  // rather than a wrong guess.
  CONTAINER_APP_ROOT: getEnv('CONTAINER_APP_ROOT', '/uby'),
  HOST_WORKSPACE_ROOT: getEnv('HOST_WORKSPACE_ROOT', ''),
  DEBUG_LLM: getEnv('DEBUG_LLM') === 'true',
  DEBUG_CONTEXT: getEnv('DEBUG_CONTEXT') === 'true',
  DEBUG_SESSION: getEnv('DEBUG_SESSION') === 'true',
};