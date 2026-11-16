import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Allow all external hosts (needed for sandbox proxy access)
    allowedHosts: 'all',
    fs: {
      // Allow Vite to serve files from anywhere in the monorepo
      strict: false,
    },
  },
  resolve: {
    alias: {
      // Map @static3d/types directly to its TypeScript source
      '@static3d/types': resolve(__dirname, 'packages/types/src/index.ts'),
    },
  },
});
