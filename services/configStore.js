import { createStateStore } from './stateStore.js';

export function createConfigStore(filePath) {
  const store = createStateStore(filePath, {});

  return {
    load() {
      return store.load();
    },

    save(data) {
      return store.save(data || {});
    },

    patch(partial) {
      return store.update((current) => ({
        ...(current || {}),
        ...(partial || {}),
      }));
    },

    raw: store,
  };
}