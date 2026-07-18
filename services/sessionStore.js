import { createStateStore } from './stateStore.js';

function normalizeSession(session) {
  return session;
}

export function createSessionStore(filePath) {
  const store = createStateStore(filePath, { sessions: [] });

  return {
    loadAll() {
      const data = store.load();
      return Array.isArray(data.sessions) ? data.sessions.map(normalizeSession) : [];
    },

    saveAll(sessions) {
      return store.save({ sessions: Array.isArray(sessions) ? sessions.map(normalizeSession) : [] });
    },

    get(id) {
      return this.loadAll().find((s) => s.id === id) || null;
    },

    upsert(session) {
      return store.update((current) => {
        const sessions = Array.isArray(current.sessions) ? current.sessions : [];
        const idx = sessions.findIndex((s) => s.id === session.id);
        const nextSession = normalizeSession(session);

        if (idx >= 0) sessions[idx] = { ...normalizeSession(sessions[idx]), ...nextSession };
        else sessions.push(nextSession);

        return { ...current, sessions };
      });
    },

    remove(id) {
      return store.update((current) => {
        const sessions = (Array.isArray(current.sessions) ? current.sessions : []).filter(
          (s) => s.id !== id
        );
        return { ...current, sessions };
      });
    },

    raw: store,
  };
}