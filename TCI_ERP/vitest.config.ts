import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Same as vite.config.ts: the standard wording templates are .docx assets.
  assetsInclude: ['**/*.docx'],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
