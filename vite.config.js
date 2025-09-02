// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // remove if not using React

export default defineConfig({
  server: {
    https: false,          // ⟵ force HTTP
    host: 'localhost',
    port: 5173,
    strictPort: true
  },
  preview: {
    https: false           // also keep preview on HTTP
  },
  plugins: [react()]       // remove this line if not using React
})
