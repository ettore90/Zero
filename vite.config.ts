import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const rawBasePath = env.VITE_APP_BASE_PATH?.trim();
  const devServerTarget = env.VITE_DEV_SERVER_TARGET?.trim();

  if (!rawBasePath) {
    throw new Error('Missing required environment variable VITE_APP_BASE_PATH for Vite base path configuration.');
  }

  const appBasePath = (rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`).replace(/\/$/, '');
  const viteBase = `${appBasePath}/`;

  if (!devServerTarget) {
    throw new Error('Missing required environment variable VITE_DEV_SERVER_TARGET for Vite dev server proxy configuration.');
  }

  return {
    plugins: [react()],
    base: viteBase,
    build: {
      outDir: 'dist',
      emptyOutDir: true
    },
    server: {
      port: 5173,
      proxy: {
        [`${appBasePath}/api`]: {
          target: devServerTarget,
          changeOrigin: true,
        },
        [`${appBasePath}/ollama`]: {
          target: devServerTarget,
          changeOrigin: true,
        }
      }
    }
  };
});