import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // In development the browser talks to the API through this proxy (no CORS needed).
  server: { proxy: { '/api': 'http://localhost:4000' } },
})
