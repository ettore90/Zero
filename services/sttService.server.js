import { env } from '../config/env.js';

function resolveUrl(base, suffix) {
  return `${String(base || '').replace(/\/+$/, '')}${suffix}`;
}

function normalizeErrorPayload(payload, fallback = 'transcription_failed') {
  if (!payload || typeof payload !== 'object') {
    return { error: fallback };
  }
  const error = typeof payload.error === 'string' && payload.error.trim() ? payload.error.trim() : fallback;
  const detailsValue = typeof payload.details === 'string' && payload.details.trim()
    ? payload.details.trim()
    : (typeof payload.detail === 'string' && payload.detail.trim() ? payload.detail.trim() : undefined);
  return detailsValue ? { error, details: detailsValue, detail: detailsValue } : { error };
}

export async function transcribeAudio({ audioBuffer, filename = 'recording.webm', mimeType = 'audio/webm' }) {
  if (!audioBuffer || !audioBuffer.length) {
    return { status: 400, data: { error: 'audio_required' } };
  }

  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType || 'audio/webm' });
  form.append('file', blob, filename);

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(env.STT_REQUEST_TIMEOUT_MS) ? env.STT_REQUEST_TIMEOUT_MS : 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(resolveUrl(env.STT_SERVER, env.STT_TRANSCRIBE_PATH), {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
      ? await res.json().catch(() => null)
      : { text: await res.text().catch(() => '') };

    if (!res.ok) {
      const detail = !contentType.includes('application/json') && typeof data?.text === 'string' && data.text.trim()
        ? data.text.trim()
        : undefined;
      console.warn('[sttService] upstream failure', {
        status: res.status,
        contentType,
        url: resolveUrl(env.STT_SERVER, env.STT_TRANSCRIBE_PATH),
      });
      return { status: res.status, data: { ...normalizeErrorPayload(data), ...(detail ? { details: detail, detail } : {}) } };
    }

    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) {
      return { status: 502, data: { error: 'transcription_empty' } };
    }

    return { status: 200, data: { text } };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        status: 504,
        data: {
          error: 'transcription_timeout',
          ...(typeof error?.message === 'string' && error.message.trim() ? { detail: error.message.trim() } : {}),
        },
      };
    }
    console.error('[sttService] fetch failed', {
      url: resolveUrl(env.STT_SERVER, env.STT_TRANSCRIBE_PATH),
      detail: typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : undefined,
    });
    return {
      status: 502,
      data: {
        error: 'transcription_failed',
        ...(typeof error?.message === 'string' && error.message.trim() ? { detail: error.message.trim() } : {}),
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
