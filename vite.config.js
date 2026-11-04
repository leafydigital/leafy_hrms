import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// One project, two apps:
//   /        -> marketing website   (src/website, lazy-loaded)
//   /hrms/*  -> HRMS web app        (src/hrms,    lazy-loaded)
// The API is a separate Node project (leafy-hrms-api) deployed on its own host.
export default defineConfig({
  plugins: [react()],
  define: { __HRMS_BASE__: JSON.stringify('/hrms') },
  // In development the browser talks to the API through this proxy (no CORS needed).
  server: { proxy: { '/api': 'http://localhost:4000' } },
  build: {
    rollupOptions: {
      output: {
        // Only npm packages here (never an app entry file) — see the Wander Breeze note about vendor chunks.
        manualChunks: { 'vendor-react': ['react', 'react-dom', 'react-router-dom'] },
      },
    },
  },
})
