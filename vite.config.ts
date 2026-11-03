import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// VITE_BASE is set when building for GitHub Pages, which serves the app from /argument_map/.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
})
