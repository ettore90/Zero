import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from './config/env.js';
import { paths } from './config/paths.js';
import { attachUserContext } from './middlewares/userContext.js';

import systemRoutes from './routes/system.routes.js';
import gitRoutes from './routes/git.routes.js';
import memoryRoutes from './routes/memory.routes.js';
import llmRoutes from './routes/llm.routes.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import agentsRoutes from './routes/agents.routes.js';
import sessionsRoutes from './routes/sessions.routes.js';
import configRoutes from './routes/config.routes.js';
import stateRoutes from './routes/state.routes.js';
import alertsRoutes from './routes/alerts.routes.js';
import adminRoutes from './routes/admin.routes.js';
import chatRoutes from './routes/chat.routes.js';
import proxyRoutes from './routes/proxy.routes.js';
import migrateRoutes from './routes/migrate.routes.js';
import approvalRoutes from './routes/approval.routes.js';
import streamRoutes from './routes/stream.routes.js';
import ollamaRoutes from './routes/ollama.routes.js';
import nebulaRoutes from './routes/nebula.routes.js';
import workflowRunsRoutes from './routes/workflow-runs.routes.js';
import perfProbeRoutes from './routes/perf-probe.routes.js';
import usageRoutes from './routes/usage.routes.js';
import jiraRoutes from './routes/jira.routes.js';
import transcriptionRoutes from './routes/transcription.routes.js';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(attachUserContext);

  // API
  const apiPrefixes = ['/api'];
  if (env.BASE_PATH) {
    apiPrefixes.push(`${env.BASE_PATH}/api`);
  }

  for (const prefix of apiPrefixes) {
    app.use(prefix, systemRoutes);
    app.use(prefix, perfProbeRoutes);
    app.use(prefix, gitRoutes);
    app.use(prefix, memoryRoutes);
    app.use(prefix, llmRoutes);
    app.use(prefix, authRoutes);
    app.use(prefix, usersRoutes);
    app.use(prefix, agentsRoutes);
    app.use(prefix, sessionsRoutes);
    app.use(prefix, configRoutes);
    app.use(prefix, stateRoutes);
    app.use(prefix, alertsRoutes);
    app.use(prefix, adminRoutes);
    app.use(prefix, chatRoutes);
    app.use(prefix, proxyRoutes);
    app.use(prefix, migrateRoutes);
    app.use(prefix, approvalRoutes);
    app.use(prefix, streamRoutes);
    app.use(prefix, workflowRunsRoutes);
    app.use(prefix, usageRoutes);
    app.use(prefix, jiraRoutes);
    app.use(prefix, transcriptionRoutes);
  }

  const ollamaPrefixes = ['/ollama'];
  if (env.BASE_PATH) {
    ollamaPrefixes.push(`${env.BASE_PATH}/ollama`);
  }
  for (const prefix of ollamaPrefixes) {
    app.use(prefix, ollamaRoutes);
  }

  const nebulaPrefixes = ['/nebula'];
  if (env.BASE_PATH) {
    nebulaPrefixes.push(`${env.BASE_PATH}/nebula`);
  }
  for (const prefix of nebulaPrefixes) {
    app.use(prefix, nebulaRoutes);
  }

  // SPA + static presentation files
  const basePath = env.BASE_PATH;
  const buildPath = path.resolve(env.BUILD_PATH);
  const indexPath = path.join(buildPath, 'index.html');
  const assetsPath = path.join(buildPath, 'assets');
  const { presentationsPath } = paths;
  const sharedAssetsDir = env.SHARED_ASSETS_DIR?.trim();
  const sharedAssetsPublicPath = (env.SHARED_ASSETS_PUBLIC_PATH || '/shared-assets').trim();
  const normalizedSharedAssetsPublicPath = (() => {
    const candidate = (sharedAssetsPublicPath.startsWith('/') ? sharedAssetsPublicPath : `/${sharedAssetsPublicPath}`).replace(/\/+$/, '');
    if (!candidate || candidate === '/' || ['/api', '/assets', '/presentations', '/ollama', '/nebula'].includes(candidate)) {
      throw new Error(`Invalid SHARED_ASSETS_PUBLIC_PATH: ${sharedAssetsPublicPath}`);
    }
    return candidate;
  })();
  const resolvedSharedAssetsDir = sharedAssetsDir ? path.resolve(sharedAssetsDir) : '';

  console.log('[static] buildPath:', buildPath);
  console.log('[static] assetsPath exists:', fs.existsSync(assetsPath));
  console.log('[static] indexPath exists:', fs.existsSync(indexPath));
  console.log('[static] presentationsPath exists:', fs.existsSync(presentationsPath));
  console.log('[static] BASE_PATH:', basePath);
  console.log('[static] sharedAssetsDir:', resolvedSharedAssetsDir || '(disabled)');
  console.log('[static] sharedAssetsPublicPath:', normalizedSharedAssetsPublicPath);

  app.use(
    `${basePath}/assets`,
    express.static(assetsPath, {
      maxAge: '1y',
      immutable: true,
      fallthrough: false,
    })
  );

  app.use(
    `${basePath}/presentations`,
    express.static(presentationsPath, {
      extensions: ['html'],
      fallthrough: false,
    })
  );

  if (resolvedSharedAssetsDir && fs.existsSync(resolvedSharedAssetsDir)) {
    app.use(
      `${basePath}${normalizedSharedAssetsPublicPath}`,
      express.static(resolvedSharedAssetsDir, {
        fallthrough: false,
      })
    );
  }

  app.use(
    basePath,
    express.static(buildPath, {
      fallthrough: true,
    })
  );

  app.get(`${basePath}/*`, (req, res) => {
    const reqPath = req.path || '';
    if (reqPath.includes('/api/') || reqPath.includes('/ollama/') || reqPath.includes('/nebula/')) {
      return res.status(404).json({ error: 'Not found' });
    }

    const accept = req.headers.accept || '';

    if (!accept.includes('text/html')) {
      return res.status(404).send('Not found');
    }

    if (!fs.existsSync(indexPath)) {
      return res.status(404).send('Build not found');
    }

    return res.sendFile(indexPath);
  });

  return app;
}