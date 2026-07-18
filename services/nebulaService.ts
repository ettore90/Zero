import { NEBULA_API_BASE } from '../constants';
import { AuthResponse, AppConfig } from '../types';

// This service communicates with our local server.js (port 3003),
// which now acts as a proxy to the actual Nebula Server (port 3001).

export const login = async (username: string, password: string): Promise<AuthResponse> => {
  try {
    const response = await fetch(`${NEBULA_API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
        throw new Error('Login failed. Check credentials.');
    }

    return response.json();
  } catch (error) {
      console.error("Auth Error:", error);
      throw error;
  }
};

export const fetchConfig = async (token: string, username: string): Promise<AppConfig | null> => {
  try {
    // We append username so the server knows which storage key to access
    const response = await fetch(`${NEBULA_API_BASE}/state/${encodeURIComponent(username)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) throw new Error('Failed to fetch state');

    // The server now returns null (JSON) if no config exists, instead of 404
    const config = await response.json();
    return config || null;
  } catch (e) {
      console.error("Fetch Config Error", e);
      return null;
  }
};

export const saveConfig = async (token: string, username: string, config: AppConfig): Promise<void> => {
  try {
    const response = await fetch(`${NEBULA_API_BASE}/state/${encodeURIComponent(username)}`, {
        method: 'POST',
        headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify(config),
    });

    if (!response.ok) throw new Error('Failed to save state');
  } catch (e) {
      console.error("Save Config Error", e);
      throw e;
  }
};

// Router namespace for project operations
export const router = {
  fs: {
    list: async (path: string): Promise<any[]> => {
      const response = await fetch(`${NEBULA_API_BASE}/fs/list?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error('Failed to list directory');
      const data = await response.json();
      return Array.isArray(data) ? data : (data.files ?? data.entries ?? data.items ?? []);
    },
    read: async (path: string): Promise<string> => {
      const response = await fetch(`${NEBULA_API_BASE}/fs/read?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error('Failed to read file');
      const data = await response.json();
      return data.content || data;
    }
  },
  git: {
    getInfo: async (path: string): Promise<any> => {
      const response = await fetch(`${NEBULA_API_BASE}/git/info?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error('Failed to get git info');
      return response.json();
    }
  }
};