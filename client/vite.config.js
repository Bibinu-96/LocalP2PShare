import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
    server: {
    host: "0.0.0.0",  // listens on all IPs
    port: 80,        // temporary dev port (>1024 for safety)
  },
})
