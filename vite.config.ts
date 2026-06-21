import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export function resolveDevProxyTargets(env: NodeJS.ProcessEnv = process.env): { api: string; ws: string } {
  const api = env.VIRTUALHOME_API_ORIGIN ?? 'http://127.0.0.1:4317';
  const ws = env.VIRTUALHOME_WS_ORIGIN ?? api.replace(/^http/, 'ws');
  return { api, ws };
}

const devProxyTargets = resolveDevProxyTargets();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': devProxyTargets.api,
      '/ws': {
        target: devProxyTargets.ws,
        ws: true
      }
    }
  }
});
