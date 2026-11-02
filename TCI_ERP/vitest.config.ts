import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Same as vite.config.ts: the standard wording templates are .docx assets.
  assetsInclude: ['**/*.docx'],
  test: {
    // scripts/guide: the user guide's compiler and its content checks (docs/guide).
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
})
