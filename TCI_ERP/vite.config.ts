import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The standard wording templates ship as .docx assets (src/features/wording/defaults).
  assetsInclude: ['**/*.docx'],
})
