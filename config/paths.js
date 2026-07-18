import path from 'path';
import { env } from './env.js';

const storageRoot = path.resolve(env.STORAGE_PATH);
const configuredDatabasePath = env.DB_FILE_PATH || env.RUNTIME_DB_PATH || '';
const configuredDatabaseFile = env.DB_FILE_NAME || env.RUNTIME_DB_FILE || '';
const databaseFile = configuredDatabaseFile || (configuredDatabasePath ? path.basename(configuredDatabasePath) : '');
const databasePath = configuredDatabasePath
  ? path.resolve(configuredDatabasePath)
  : databaseFile
    ? path.join(storageRoot, databaseFile)
    : '';

if (!databasePath || !path.isAbsolute(databasePath) || path.basename(databasePath) === '') {
  throw new Error(
    'Invalid database path configuration: set DB_FILE_PATH or RUNTIME_DB_PATH, or provide DB_FILE_NAME or RUNTIME_DB_FILE with a valid STORAGE_PATH.'
  );
}

const presentationsPath = env.PRESENTATIONS_PATH
  ? path.resolve(env.PRESENTATIONS_PATH)
  : path.join(storageRoot, 'presentations');

export const paths = {
  storageRoot,
  databaseFile,
  databasePath,
  runtimeDbFile: databaseFile,
  runtimeDbPath: databasePath,
  presentationsPath,
  sessions: path.join(storageRoot, 'sessions.json'),
  vectorMemory: path.join(storageRoot, 'vector_memory.json'),
  userConfig: path.join(storageRoot, 'user.json'),
};