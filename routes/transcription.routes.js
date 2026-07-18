import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { transcribeAudio } from '../services/sttService.server.js';

const router = Router();

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

router.post('/transcribe', checkLocalAccess, async (req, res) => {
  try {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.toLowerCase().includes('audio/')) {
      return res.status(415).json({ error: 'unsupported_media_type' });
    }

    const chunks = [];
    let totalBytes = 0;

    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_AUDIO_BYTES) {
          reject(Object.assign(new Error('audio_too_large'), { statusCode: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', resolve);
      req.on('error', reject);
    });

    const audioBuffer = Buffer.concat(chunks);
    if (!audioBuffer.length) {
      return res.status(400).json({ error: 'audio_required' });
    }

    const extension = contentType.split('/')[1]?.split(';')[0]?.trim() || 'webm';
    const filename = `recording.${extension.replace(/[^a-z0-9]/gi, '') || 'webm'}`;
    const result = await transcribeAudio({ audioBuffer, filename, mimeType: contentType.split(';')[0].trim() || 'audio/webm' });
    return res.status(result.status).json(result.data);
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const code = error?.message === 'audio_too_large' ? 'audio_too_large' : 'transcription_failed';
    const detailSource = error?.detail ?? error?.details ?? ((error?.message && error.message !== 'audio_too_large') ? error.message : undefined);
    const payload = detailSource ? { error: code, detail: detailSource } : { error: code };
    return res.status(status).json(payload);
  }
});

export default router;
