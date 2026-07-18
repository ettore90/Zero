import { createStateStore } from './stateStore.js';

export function createMemoryStore(filePath) {
  const store = createStateStore(filePath, { memories: [] });

  return {
    loadAll() {
      const data = store.load();
      return Array.isArray(data.memories) ? data.memories : [];
    },

    saveAll(memories) {
      return store.save({ memories: Array.isArray(memories) ? memories : [] });
    },

    add(item) {
      return store.update((current) => {
        const memories = Array.isArray(current.memories) ? current.memories : [];
        memories.push(item);
        return { ...current, memories };
      });
    },

    clear() {
      return store.save({ memories: [] });
    },

    raw: store,
  };
}