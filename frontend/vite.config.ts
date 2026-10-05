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
  // MUI core is the bulk of the main chunk; pages are lazy-loaded. Each MUI X library gets its
  // own chunk so a page only downloads the grid, charts or pickers it actually uses.
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/@mui/x-data-grid')) return 'mui-x-grid';
          if (id.includes('node_modules/@mui/x-charts')) return 'mui-x-charts';
          if (id.includes('node_modules/@mui/x-date-pickers') || id.includes('node_modules/dayjs')) return 'mui-x-pickers';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    globals: true,
    // MUI X grids, pickers and dialogs render slowly in jsdom, more so when files run in parallel.
    testTimeout: 30_000,
  },
});
