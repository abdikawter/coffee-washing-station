/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the API runs on :4000; proxying keeps the refresh cookie same-origin.
    proxy: { '/api': 'http://localhost:4000' },
  },
  // MUI core is the bulk of the main chunk; admin pages are lazy-loaded.
  build: { sourcemap: true, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    globals: true,
    // MUI X grids, pickers and dialogs render slowly in jsdom, more so when files run in parallel.
    testTimeout: 30_000,
  },
});
