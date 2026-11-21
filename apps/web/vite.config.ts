import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } } },
  build: { sourcemap: false, target: 'es2020' },
});
