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
  {
    // T4-3 (Aufgabe 3): der service_role-Supabase-Client (umgeht RLS) darf NUR im Stripe-Pfad
    // importiert werden. Ein versehentlicher Import in eine Server-Component/Page/Nutzer-Read soll
    // `pnpm lint` rot machen — `import 'server-only'` allein fängt das nicht (eine Server-Component
    // ist ebenfalls server-seitig). Die Allowlist steht im Folge-Block (dort Regel = off).
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase/service-role',
              message:
                'Der service_role-Client (umgeht RLS) ist ausschließlich für den Stripe-Pfad ' +
                '(app/api/stripe/webhook + lib/stripe/actions.ts). Für Nutzer-Reads den ' +
                'RLS-gebundenen lib/supabase/server.ts verwenden.',
            },
          ],
        },
      ],
    },
  },
  {
    // Allowlist: genau die zwei Stripe-Pfade dürfen den service_role-Client importieren.
    files: ['apps/web/app/api/stripe/**/*.ts', 'apps/web/lib/stripe/actions.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier,
)
