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
    // T4-3 (Aufgabe 3): der service_role-Supabase-Client (umgeht RLS) darf NUR in eng begrenzten
    // Pfaden importiert werden. Ein versehentlicher Import in eine Server-Component/Page/Nutzer-Read
    // soll `pnpm lint` rot machen — `import 'server-only'` allein fängt das nicht (eine
    // Server-Component ist ebenfalls server-seitig). Die Allowlist steht im Folge-Block (dort
    // Regel = off).
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
                '(app/api/stripe/webhook + lib/stripe/actions.ts), den Lead-/Einwilligungspfad ' +
                '(lib/leads/**, B1-2), die Cron-Endpunkte (app/api/cron/**, B4-1), den ' +
                'Resend-Webhook (app/api/resend/**, B2-2), die Partner-Bewerbung ' +
                '(lib/partner-application/**, B16-3), die GoTrue-Admin-API ' +
                '(lib/auth/admin-api.ts, B18-2a) und den Tarif-Pflegeweg ' +
                '(lib/admin/grid-tariffs-actions.ts, B21-2b) — die letzten beiden je genau diese ' +
                'eine Datei. Für Nutzer-Reads den RLS-gebundenen lib/supabase/server.ts verwenden.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Allowlist: die zwei Stripe-Pfade und das Lead-Modul dürfen den service_role-Client importieren.
     *
     * B1-2 ERWEITERT diese Liste bewusst, statt sie zu umgehen oder einen zweiten Client anzulegen:
     * `platform.leads`/`consents` haben für `anon` und `authenticated` gar kein Grant (ein Lead ist
     * Betriebs-, kein Nutzerdatum — B1-1), die sechs Erfassungs-Wrapper sind service_role-only. Die
     * Regel bleibt damit das, was sie ist: die Bremse gegen versehentlichen Gebrauch in
     * Server-Components und Nutzer-Reads. Innerhalb von `lib/leads` importiert nur `store.ts` den
     * Client — die Seiten/Actions gehen über dieses Modul.
     *
     * B4-1 ERWEITERT die Liste ein zweites Mal, um die Cron-Endpunkte: `app/api/cron/**` ist
     * strukturell derselbe Fall wie der Stripe-Webhook — ein maschinell ausgelöster Endpunkt, der
     * sich mit einem geteilten Geheimnis ausweist und einen service_role-only-Wrapper aufruft
     * (`public.run_lead_retention_job`). Kein zweiter Client, keine deaktivierte Regel: es bleibt
     * bei EINEM `lib/supabase/service-role.ts`, und ein Import in einer Server-Component/Page ist
     * weiterhin ein Lint-Fehler.
     *
     * B2-2 ERWEITERT sie ein drittes Mal um den Resend-Webhook (`app/api/resend/**`) — derselbe
     * Fall wie der Stripe-Webhook, bis in die Einzelheit: ein maschineller Aufrufer ohne Sitzung,
     * der sich mit einer SIGNATUR über den rohen Rumpf ausweist und genau einen service_role-only
     * Wrapper aufruft (`public.record_email_event`). Ein RLS-gebundener Client hätte hier gar keine
     * Identität, an der RLS ansetzen könnte.
     *
     * B16-3 ERWEITERT sie ein viertes Mal um die Partner-Bewerbung (`lib/partner-application/**`) —
     * strukturell derselbe Fall wie der Lead-Erfassungspfad: ein ÖFFENTLICHES Formular, das in eine
     * Tabelle schreibt, die für `anon` und `authenticated` gar kein Grant hat
     * (`platform.partner_applications`, RLS ohne Policy), über einen service_role-only-Wrapper
     * (`public.submit_partner_application`). Es entsteht dabei ausdrücklich kein Nutzerdatum: eine
     * Bewerbung gehört dem Betrieb, nicht einer Sitzung — der Regelfall ist anonym. Innerhalb des
     * Moduls importiert nur `store.ts` den Client; die Action geht über dieses Modul.
     *
     * B18-2a ERWEITERT sie ein fünftes Mal — und als EINZIGE um eine DATEI statt ein Verzeichnis:
     * `lib/auth/admin-api.ts`. Der Fall ist ein anderer als die vier darüber: Dort geht es jeweils
     * um `public`-Wrapper, die für `anon`/`authenticated` kein Grant haben; hier um die
     * GoTrue-ADMIN-API (Kontoanlage ohne Bestätigungsmail, Erzeugung des Aktivierungstokens), für
     * die es schlicht KEINEN Weg über den angemeldeten Client gibt — sie verlangt den
     * service_role-Schlüssel. Genau deshalb ist die Freigabe hier so eng wie möglich: `lib/auth/**`
     * insgesamt zu öffnen hiesse, den erhöhten Zugriff dem gesamten öffentlichen
     * Registrierungsweg zu geben, der ihn nicht braucht (`lib/auth/sign-up.ts` bleibt beim
     * gewöhnlichen Client). Die Datei gibt ausserdem nie den Client zurück, sondern nur Werte —
     * sonst wäre die Beschränkung auf eine Datei Kosmetik.
     *
     * ⚠ Zur Abgrenzung: B14-2 hat diese Liste bewusst NICHT erweitert, weil die vier
     * Analyse-Wrapper `authenticated`-only sind und ein service_role-Client dort `created_by` leer
     * gelassen hätte. Diese Begründung trägt hier nicht — es gibt keine zweite Tür.
     *
     * B21-2b ERWEITERT sie ein sechstes Mal, wieder um eine DATEI: `lib/admin/grid-tariffs-actions.ts`.
     * Der Fall ist ein anderer als alle fünf darüber — dort schreiben ÖFFENTLICHE oder MASCHINELLE
     * Pfade über `public`-Wrapper, die für `anon`/`authenticated` kein Grant haben. Hier schreibt ein
     * ADMIN, und zwar in `public`-Tabellen, die B21-1 bewusst ohne Wrapper-Muster angelegt hat
     * (veröffentlichte Preisblätter, kein Personenbezug, direkter RLS-Select). `authenticated` hat
     * dort nur `select` und bekommt bewusst kein Schreibrecht: ein solches Grant gälte für JEDES
     * angemeldete Konto. Die Rollenprüfung liegt deshalb ausnahmsweise im Anwendungscode
     * (`isCurrentUserAdmin()` als erste Anweisung der Action) — ausführlich begründet im Kopf der
     * Datei und in Migration 20260828090000. Die Freigabe ist genau deshalb auf die eine Datei
     * begrenzt: `lib/admin/**` insgesamt zu öffnen gäbe den erhöhten Zugriff dem gesamten
     * Admin-Bereich, der ihn nirgends sonst braucht.
     */
    files: [
      'apps/web/app/api/stripe/**/*.ts',
      'apps/web/app/api/cron/**/*.ts',
      'apps/web/app/api/resend/**/*.ts',
      'apps/web/lib/stripe/actions.ts',
      'apps/web/lib/leads/**/*.ts',
      'apps/web/lib/partner-application/**/*.ts',
      'apps/web/lib/auth/admin-api.ts',
      'apps/web/lib/admin/grid-tariffs-actions.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    /*
     * Delta 16b: dieselbe Bremse ein zweites Mal — jetzt für `apps/website` (den Kalkulator).
     *
     * Diese App hatte bis hierher ÜBERHAUPT keinen serverseitigen Datenbank-Zugriff: nur den
     * anon-Lesezugang aus B21-3a (`lib/tariff-data/client.ts`, browser-tauglich, `select` auf
     * veröffentlichte Preisdaten). Mit dem Name/Firma-Gate kommt ein service_role-Schlüssel dazu,
     * der jede RLS umgeht — und damit derselbe Bedarf an einer strukturellen Grenze, den `apps/web`
     * seit T4-3 hat.
     *
     * Die Regel ist eine EIGENE und keine Erweiterung der Allowlist darüber: Die Modulpfade sind
     * app-lokal (`@/` zeigt in jeder App woandershin), ein gemeinsamer Eintrag würde in der
     * jeweils anderen App ins Leere zeigen und dort nichts schützen.
     *
     * ⚠ ERLAUBT IST GENAU EINE DATEI — `lib/report-gate/store.ts`, der zwei Aufrufe grosse
     * Datenbank-Rand des Gates. Nicht `lib/report-gate/**`: dort liegt auch die Server Action, und
     * die soll den Client nicht selbst bauen können. Dieselbe engste Form wie bei
     * `apps/web/lib/auth/admin-api.ts` (B18-2a) und `lib/admin/grid-tariffs-actions.ts` (B21-2b).
     */
    files: ['apps/website/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/report-gate/service-role',
              message:
                'Der service_role-Client (umgeht RLS) ist ausschließlich für den Datenbank-Rand ' +
                'des Report-Gates gedacht: apps/website/lib/report-gate/store.ts — genau diese ' +
                'eine Datei. Der Rechner liest Tarif- und Preisdaten über den anon-Client in ' +
                'lib/tariff-data/client.ts; alles andere braucht hier keine Datenbank.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/website/lib/report-gate/store.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier,
)
