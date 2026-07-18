import { env } from '../config/env.js';

function resolveUrl(base, suffix) {
  return `${String(base || '').replace(/\/+$/, '')}${suffix}`;
}

export async function ollamaGetTags() {
  const res = await fetch(resolveUrl(env.OLLAMA_SERVER, '/api/tags'));
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export async function ollamaChat(payload) {
  const res = await fetch(resolveUrl(env.OLLAMA_SERVER, '/api/chat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });

  const text = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || 'application/json',
    body: text,
  };
}

export async function ollamaGenerate(payload) {
  const res = await fetch(resolveUrl(env.OLLAMA_SERVER, '/api/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });

  const text = await res.text();
  return {
    status: res.status,
    contentType: res.headers.get('content-type') || 'application/json',
    body: text,
  };
}

export async function fetchModels(host) {
  try {
    const res = await fetch(resolveUrl(host || env.OLLAMA_SERVER, '/api/tags'));
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => m.name);
  } catch (e) {
    console.error('Error fetching models', e);
    return [];
  }
}