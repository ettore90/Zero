import { Router } from 'express';
import { checkLocalAccess } from '../middlewares/localAccess.js';
import { createUser, deleteUser, listUsers, updateUser } from '../services/userSessionService.js';

const router = Router();

router.get('/users', checkLocalAccess, (_req, res) => {
  return res.json({ users: listUsers() });
});

router.post('/users', checkLocalAccess, (req, res) => {
  try {
    const user = createUser(req.body || {});
    return res.json({ success: true, user, users: listUsers() });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'failed to create user' });
  }
});

router.put('/users/:id', checkLocalAccess, (req, res) => {
  const user = updateUser(req.params.id, req.body || {});
  if (!user) return res.status(404).json({ error: 'User not found' });
  return res.json({ success: true, user, users: listUsers() });
});

router.delete('/users/:id', checkLocalAccess, (req, res) => {
  const success = deleteUser(req.params.id);
  if (!success) return res.status(404).json({ error: 'User not found' });
  return res.json({ success: true, users: listUsers() });
});

export default router;
