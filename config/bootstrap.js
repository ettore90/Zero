import fs from 'fs';
import path from 'path';
import { paths } from './paths.js';

function ensureFile(filePath, defaultContent) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent, 'utf8');
  }
}

export function bootstrapStorage() {
  if (!fs.existsSync(paths.storageRoot)) {
    fs.mkdirSync(paths.storageRoot, { recursive: true });
  }


  const databaseParent = paths.databasePath ? path.dirname(paths.databasePath) : null;
  if (databaseParent && !fs.existsSync(databaseParent)) {
    fs.mkdirSync(databaseParent, { recursive: true });
  }

  ensureFile(
    paths.sessions,
    JSON.stringify({ version: 1, sessions: {} }, null, 2)
  );
  ensureFile(
    paths.vectorMemory,
    JSON.stringify({ memories: [] }, null, 2)
  );
}