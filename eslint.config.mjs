import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

// Eine Config, root-weit — konsistent über alle Packages.
// Reihenfolge: Basis (JS/TS) → Next-spezifisch für /apps → Prettier zuletzt (schaltet Format-Regeln ab).
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/coverage/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Underscore-Prefix als bewusstes „ungenutzt", Rest-Siblings zum Auslassen von Feldern.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Next.js- + React-Hooks-Regeln nur für die Apps.
    files: ['apps/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      // App Router (kein pages/-Verzeichnis) — Regel ist gegenstandslos.
      '@next/next/no-html-link-for-pages': 'off',
      // Hooks-Korrektheit hart erzwingen (Rules of Hooks + vollständige Dependencies).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  prettier,
)
