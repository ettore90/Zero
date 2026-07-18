import { Router } from 'express';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';

const router = Router();

const buildPath = path.resolve(env.BUILD_PATH || '/app/dist');
const indexPath = path.join(buildPath, 'index.html');
const assetsPath = path.join(buildPath, 'assets');

if (fs.existsSync(assetsPath)) {
  router.use(
    '/assets',
    express.static(assetsPath, {
      maxAge: '1y',
      immutable: true,
      fallthrough: false,
    })
  );
}

router.use(
  express.static(buildPath, {
    fallthrough: false,
  })
);

router.get('*', (req, res) => {
  const accept = req.headers.accept || '';

  if (!accept.includes('text/html')) {
    return res.status(404).send('Not found');
  }

  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('Build not found');
  }

  return res.sendFile(indexPath);
});

export default router;