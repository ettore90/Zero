import { Router } from 'express';

const router = Router();

router.all('/nebula/*', (req, res) => {
  return res.status(501).json({ error: 'Nebula proxy ainda não migrado completamente' });
});

export default router;