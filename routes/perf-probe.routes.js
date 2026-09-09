import { Router } from 'express';
import { addReport, listReports, clearReports, sanitizeReport } from '../services/perfProbeStore.js';

const router = Router();

// Deliberately NOT behind checkLocalAccess: the whole point is to receive
// measurements from another device on the network (the tablet showing the
// lag), which that middleware would reject. The payload is sanitized to a
// fixed set of numeric/short-string fields and the buffer is capped, so this
// cannot be used as general-purpose storage.
router.post('/perf-probe', (req, res) => {
  const report = sanitizeReport(req.body || {}, { userAgent: req.get('user-agent') });
  const count = addReport(report);
  return res.json({ ok: true, stored: count });
});

router.get('/perf-probe', (_req, res) => {
  const reports = listReports();
  return res.json({ count: reports.length, reports });
});

router.delete('/perf-probe', (_req, res) => {
  return res.json({ ok: true, cleared: clearReports() });
});

export default router;
