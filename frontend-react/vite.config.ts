import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// base='/app/' → SPA زیر همین پیشوند سرو می‌شود؛ لبهٔ Go (strangler) همین
// پیشوند را به این اپ می‌دهد و بقیهٔ مسیرها تا پایان مهاجرت مال Next.js است.
export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    strictPort: true,
    // فقط API v2 به Go می‌رود؛ همه‌چیز same-origin می‌ماند (کوکی سشن مشترک)
    proxy: {
      '/api/v2': { target: process.env.AFAGH_GO_UPSTREAM || 'http://127.0.0.1:8090', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
