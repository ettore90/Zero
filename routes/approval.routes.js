import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { pendingApprovals } from '../services/runtime.js';

const router = Router();

router.post('/approval/respond', checkLocalAccess, (req, res) => {
  const { requestId, approved } = req.body;

  if (!requestId) {
    return res.status(400).json({ error: 'requestId required' });
  }

  const pending = pendingApprovals.get(requestId);
  if (!pending) {
    return res.status(404).json({ error: 'No pending approval with this requestId' });
  }

  if (requestId.startsWith('dryrun-')) {
    pending.resolve(approved === true);
  } else {
    if (approved) pending.resolve({ approved: true });
    else pending.reject(new Error('User rejected the plan'));
  }

  pendingApprovals.delete(requestId);
  return res.json({ success: true });
});

export default router;