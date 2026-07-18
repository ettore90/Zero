import fs from 'fs';
import path from 'path';

const activeLocks = new Map();

function lockError(filePath, operation = 'write') {
  const err = new Error(`WRITE_CONFLICT: '${filePath}' changed or may have changed during this operation. For safety, the write was blocked. Re-read the latest file/state and recompute the modification before trying again.`);
  err.code = 'FILE_WRITE_CONFLICT';
  err.filePath = filePath;
  err.operation = operation;
  return err;
}

export function isFileLocked(filePath) {
  return activeLocks.has(path.resolve(filePath));
}

export function withExclusiveFileLock(filePath, operation, fn) {
  const resolved = path.resolve(filePath);
  if (activeLocks.has(resolved)) {
    const err = lockError(resolved, operation);
    console.error(`[FileLock] ${err.message}`);
    throw err;
  }

  activeLocks.set(resolved, {
    operation,
    acquiredAt: Date.now(),
  });

  try {
    return fn();
  } finally {
    activeLocks.delete(resolved);
  }
}

export function atomicWriteJson(filePath, data) {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  const tmpPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, resolved);
}
