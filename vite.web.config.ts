import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': process.env.VITE_API_TARGET || 'http://127.0.0.1:3001',
      '/phone-vnc/': {
        target: process.env.VITE_VNC_HTTP_TARGET || 'http://192.168.0.58:25801',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/phone-vnc/, '')
      },
      '/phone-vnc-ws': {
        target: process.env.VITE_VNC_WS_TARGET || 'http://192.168.0.58:25902',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: { outDir: '../web-dist', emptyOutDir: true }
})
