import fs from 'fs';
import path from 'path';
import { withExclusiveFileLock, atomicWriteJson } from './fileLock.js';

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function ensureFile(filePath, defaultContent = '') {
  ensureDir(path.dirname(filePath));

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent, 'utf8');
  }
}

export function readJson(filePath, fallback = null) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  return withExclusiveFileLock(filePath, 'writeJson', () => {
    atomicWriteJson(filePath, data);
  });
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function readFileSafe(filePath, encoding = 'utf8') {
  return fs.readFileSync(filePath, encoding);
}

export function writeFileSafe(filePath, content, encoding = 'utf8') {
  ensureDir(path.dirname(filePath));
  return withExclusiveFileLock(filePath, 'writeFile', () => {
    const resolved = path.resolve(filePath);
    const dir = path.dirname(resolved);
    const tmpPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmpPath, String(content ?? ''), encoding);
      fs.renameSync(tmpPath, resolved);
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {}
      throw err;
    }
  });
}
