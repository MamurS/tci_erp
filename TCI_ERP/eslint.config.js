import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['dist', 'supabase'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, prettier],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // The two rules react-hooks 5's preset had. Version 7's preset adds the
      // React Compiler rules (set-state-in-effect, refs, purity, …); adopting
      // them is a code change of its own, not part of a dependency update.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // An HTML string reaches the screen in ONE place: the commercial offer's
    // sandboxed frame (src/features/offers/OfferFrame.tsx, DESIGN.md).
    files: ['src/**/*.tsx'],
    ignores: ['src/features/offers/OfferFrame.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No HTML strings in the DOM: render the offer document through OfferFrame (DESIGN.md).',
        },
        {
          selector: "JSXAttribute[name.name='srcDoc']",
          message: 'A srcDoc frame is OfferFrame’s alone (sandboxed, no scripts) — use it (DESIGN.md).',
        },
      ],
    },
  },
)
