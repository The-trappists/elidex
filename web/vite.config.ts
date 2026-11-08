declare const process: { env: Record<string, string | undefined> }
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: the backend runs on :8010 (`uv run ctx dashboard`), Vite proxies /api to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8010', changeOrigin: true },
    },
  },
})
