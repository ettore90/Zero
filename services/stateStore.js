import { readJson, writeJson, ensureFile } from '../utils/fs.js';

export function createStateStore(filePath, defaultValue = {}) {
  ensureFile(filePath, JSON.stringify(defaultValue, null, 2));

  return {
    load() {
      return readJson(filePath, defaultValue);
    },

    save(data) {
      writeJson(filePath, data);
      return data;
    },

    update(updater) {
      const current = this.load();
      const next = updater(current);
      this.save(next);
      return next;
    },

    path: filePath,
  };
}