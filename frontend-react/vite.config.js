import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// Dev server proxies API calls to the existing FastAPI backend (unchanged -
// only the frontend is being rewritten) so the app can be developed against
// real data without CORS juggling. In production the built dist/ is served
// by FastAPI itself (see src/api/main.py), so no proxy is needed there.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/assess': 'http://localhost:8500',
      '/assessments': 'http://localhost:8500',
      '/auth': 'http://localhost:8500',
      '/predict': 'http://localhost:8500',
      '/model': 'http://localhost:8500',
      '/psych-assess': 'http://localhost:8500',
      '/pregnancy-guide': 'http://localhost:8500',
      '/postpartum-guide': 'http://localhost:8500',
      '/nutrition': 'http://localhost:8500',
      '/nutrition-assess': 'http://localhost:8500',
      '/nutrition-checks': 'http://localhost:8500',
      '/chat': 'http://localhost:8500',
      '/documents': 'http://localhost:8500',
      '/helplines': 'http://localhost:8500',
      '/provider': 'http://localhost:8500',
    },
  },
})
