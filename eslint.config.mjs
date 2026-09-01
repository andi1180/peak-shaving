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
    /*
     * T4-3 (Aufgabe 3): der service_role-Supabase-Client (umgeht RLS) darf NUR in eng begrenzten
     * Pfaden importiert werden. Ein versehentlicher Import in eine Server-Component/Page/Nutzer-Read
     * soll `pnpm lint` rot machen — `import 'server-only'` allein fängt das nicht (eine
     * Server-Component ist ebenfalls server-seitig).
     *
     * Der Tarifblatt-Scan nimmt den KI-Client als ZWEITES eingeschränktes Modul dazu. Er ist kein
     * geringeres Geheimnis als der service_role-Schlüssel: er ist auf die Rechnung des Kontos
     * abrechenbar und hat kein Kontingent, das ihn begrenzte — ein Leck merkt man an der
     * Abrechnung, nicht an einem Fehler.
     *
     * ⚠ DIE ALLOWLISTS IM FOLGE-BLOCK SCHALTEN DIE REGEL NICHT AB, SIE TAUSCHEN SIE. Solange es
     * genau EIN eingeschränktes Modul gab, war ein schlichtes `off` folgenlos; mit dem zweiten ist
     * es das nicht mehr — die acht service_role-Pfade dürften ab sofort auch den KI-Client ziehen.
     * Dieselbe Korrektur, die Delta 9b-2a in `apps/website` nötig gemacht hat.
     */
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
            {
              name: '@/lib/admin/tariff-scan/ai-client',
              message:
                'Der KI-Client ist ausschließlich für die Extraktion des Tarifblatt-Scans ' +
                'gedacht: apps/web/lib/admin/tariff-scan/extract.ts — genau diese eine Datei, ' +
                'nicht das Verzeichnis (dort liegt auch die Server Action, und die soll sich ' +
                'ihren Zugang nicht selbst bauen können). Der Schlüssel ist abrechenbar und hat ' +
                'kein Kontingent, das ihn begrenzte.',
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
    /*
     * ⚠ NICHT `'no-restricted-imports': 'off'` — s. die Begründung im Block darüber. Diese acht
     * Pfade dürfen den service_role-Client ziehen und den KI-Client ausdrücklich NICHT: keiner von
     * ihnen befragt ein Sprachmodell, und ein abrechenbarer Schlüssel hat im Stripe-Webhook oder im
     * Lead-Pfad nichts zu suchen.
     */
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/admin/tariff-scan/ai-client',
              message:
                'Der KI-Client ist ausschließlich für die Extraktion des Tarifblatt-Scans ' +
                'gedacht: apps/web/lib/admin/tariff-scan/extract.ts — genau diese eine Datei, ' +
                'nicht das Verzeichnis (dort liegt auch die Server Action, und die soll sich ' +
                'ihren Zugang nicht selbst bauen können). Der Schlüssel ist abrechenbar und hat ' +
                'kein Kontingent, das ihn begrenzte.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Allowlist des KI-Clients: GENAU EINE Datei, nicht das Verzeichnis. `tariff-scan/actions.ts`
     * liegt daneben und soll sich seinen Zugang nicht selbst bauen können — dieselbe engste Form
     * wie bei `lib/auth/admin-api.ts` (B18-2a), `lib/admin/grid-tariffs-actions.ts` (B21-2b) und
     * `apps/website/lib/invoice-scan/extract.ts` (Delta 9b-2a).
     *
     * Der service_role-Client bleibt hier gesperrt, und das ist keine Förmlichkeit: Der
     * Tarifblatt-Scan LIEST ein Preisblatt und schreibt keine Zeile. Der Weg in die Datenbank
     * bleibt allein `createGridTariffAction` — angestossen von einem Menschen, der die gelesenen
     * Werte vorher bestätigt hat. Könnte diese Datei selbst schreiben, wäre genau die
     * Bestätigungsstufe umgehbar, für die es diesen Aufbau gibt.
     */
    files: ['apps/web/lib/admin/tariff-scan/extract.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/supabase/service-role',
              message:
                'Der Tarifblatt-Scan liest nur — er legt keinen Tarifstand an. Der Schreibweg ist ' +
                'lib/admin/grid-tariffs-actions.ts, und er beginnt bei einem Menschen, der die ' +
                'gelesenen Werte bestätigt hat.',
            },
          ],
        },
      ],
    },
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
     * ⚠ ERLAUBT IST JE MODUL GENAU EINE DATEI — `lib/report-gate/store.ts` für den service_role-
     * Client, `lib/invoice-scan/extract.ts` für den KI-Client. Nicht die Verzeichnisse: dort liegt
     * je auch eine Server Action, und die soll sich ihren Zugang nicht selbst bauen können.
     * Dieselbe engste Form wie bei `apps/web/lib/auth/admin-api.ts` (B18-2a) und
     * `lib/admin/grid-tariffs-actions.ts` (B21-2b).
     *
     * Delta 9b-2a: der KI-Client (`lib/invoice-scan/ai-client.ts`) kommt als ZWEITER Eintrag dazu.
     * Er ist kein geringeres Geheimnis als der service_role-Schlüssel — er ist auf die Rechnung
     * des Kontos abrechenbar und hat kein Kontingent, das ihn begrenzte.
     *
     * Delta 17: der KI-Client der Dokument-Zuordnung (`lib/upload-classification/ai-client.ts`) ist
     * der DRITTE Eintrag — mit `lib/upload-classification/extract.ts` als einziger erlaubter Datei.
     * Er ist bewusst nicht derselbe Client wie der des Rechnungs-Scans: eine geteilte Datei hätte
     * zwei erlaubte Orte und damit keine Bremse mehr, und die beiden Anbindungen sollen sich
     * unabhängig voneinander abschalten lassen.
     *
     * Delta 17 Teil 2: der KI-Client der Batterie-Freitexterfassung (`lib/battery-text/ai-client.ts`)
     * ist der VIERTE Eintrag — mit `lib/battery-text/extract.ts` als einziger erlaubter Datei.
         *
     * Delta 18: der KI-Client der Report-Anfrage-Übersetzung (`lib/report-request/ai-client.ts`)
     * ist der FÜNFTE Eintrag — mit `lib/report-request/extract.ts` als einziger erlaubter Datei.
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
            {
              name: '@/lib/invoice-scan/ai-client',
              message:
                'Der KI-Client (abrechenbarer Anthropic-Schlüssel) ist ausschließlich für den ' +
                'einen externen Aufruf des Rechnungs-Scans gedacht: ' +
                'apps/website/lib/invoice-scan/extract.ts — genau diese eine Datei. Es gibt hier ' +
                'bewusst keine allgemeine, wiederverwendbare KI-Hilfsfunktion.',
            },
            {
              name: '@/lib/upload-classification/ai-client',
              message:
                'Der KI-Client der Dokument-Zuordnung (abrechenbarer Anthropic-Schlüssel) ist ' +
                'ausschließlich für den einen externen Aufruf der Zuordnung gedacht: ' +
                'apps/website/lib/upload-classification/extract.ts — genau diese eine Datei.',
            },
            {
              name: '@/lib/battery-text/ai-client',
              message:
                'Der KI-Client der Batterie-Erfassung (abrechenbarer Anthropic-Schlüssel) ist ' +
                'ausschließlich für den einen externen Aufruf der Erfassung gedacht: ' +
                'apps/website/lib/battery-text/extract.ts — genau diese eine Datei.',
            },
            {
              name: '@/lib/report-request/ai-client',
              message:
                'Der KI-Client der Report-Anfrage (abrechenbarer Anthropic-Schlüssel) ist ' +
                'ausschließlich für den einen externen Aufruf der Übersetzung gedacht: ' +
                'apps/website/lib/report-request/extract.ts — genau diese eine Datei.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Die beiden Ausnahmen — und sie schalten die Regel NICHT ab, sondern tauschen sie.
     *
     * Ein blosses `'no-restricted-imports': 'off'` (die Fassung bis Delta 16b) erlaubte der
     * ausgenommenen Datei ab sofort JEDEN eingeschränkten Import. Solange es nur einen gab, war
     * das folgenlos. Mit dem zweiten ist es das nicht mehr: der Datenbank-Rand des Report-Gates
     * hat im KI-Client nichts verloren und umgekehrt. Jede Datei behält deshalb die Sperre auf das
     * jeweils ANDERE Modul.
     */
    files: ['apps/website/lib/report-gate/store.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/invoice-scan/ai-client',
              message:
                'Der Datenbank-Rand des Report-Gates braucht keinen KI-Client. Der eine erlaubte ' +
                'Ort ist apps/website/lib/invoice-scan/extract.ts.',
            },
            {
              name: '@/lib/upload-classification/ai-client',
              message:
                'Der Datenbank-Rand des Report-Gates braucht keinen KI-Client. Der eine erlaubte ' +
                'Ort ist apps/website/lib/upload-classification/extract.ts.',
            },
            {
              name: '@/lib/battery-text/ai-client',
              message:
                'Der Datenbank-Rand des Report-Gates braucht keinen KI-Client. Der eine erlaubte ' +
                'Ort ist apps/website/lib/battery-text/extract.ts.',
            },
            {
              name: '@/lib/report-request/ai-client',
              message:
                'Der Datenbank-Rand des Report-Gates braucht keinen KI-Client. Der eine erlaubte ' +
                'Ort ist apps/website/lib/report-request/extract.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/website/lib/invoice-scan/extract.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/report-gate/service-role',
              message:
                'Der Rechnungs-Scan braucht keine Datenbank — er schreibt und liest bewusst ' +
                'nichts. Der eine erlaubte Ort ist apps/website/lib/report-gate/store.ts.',
            },
            {
              name: '@/lib/upload-classification/ai-client',
              message:
                'Der Rechnungs-Scan hat seinen eigenen KI-Client. Der Client der Dokument-' +
                'Zuordnung gehört ausschließlich nach ' +
                'apps/website/lib/upload-classification/extract.ts — die beiden sollen sich ' +
                'unabhängig voneinander abschalten lassen.',
            },
            {
              name: '@/lib/battery-text/ai-client',
              message:
                'Der Rechnungs-Scan hat seinen eigenen KI-Client. Der Client der ' +
                'Batterie-Erfassung gehört ausschließlich nach ' +
                'apps/website/lib/battery-text/extract.ts.',
            },
            {
              name: '@/lib/report-request/ai-client',
              message:
                'Der Rechnungs-Scan hat seinen eigenen KI-Client. Der Client der Report-Anfrage ' +
                'gehört ausschließlich nach apps/website/lib/report-request/extract.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * ⚠ Delta 17, GEMESSENER BEFUND: Die Pfad-Sperre oben greift NUR für die Alias-Schreibweise
     * (`@/lib/…`). Ein Nachbar im selben Verzeichnis erreicht den Client aber auch RELATIV
     * (`./ai-client`) — und dieser Import wird von `paths` nicht erfasst. Beim Bau dieses
     * Abschnitts als Probe nachgewiesen: `actions.ts` mit `from './ai-client'` lief durch, während
     * dieselbe Zeile in der Alias-Schreibweise sauber abgewiesen wurde.
     *
     * Für die Zuordnung wird die Lücke hier geschlossen: das GANZE Verzeichnis — ausser der einen
     * erlaubten Datei — bekommt zusätzlich ein Muster auf die relative Schreibweise. Die `paths`
     * von oben stehen mit dabei, weil eine spätere Regelangabe die frühere für dieselben Dateien
     * ersetzt und die Sperren sonst still verschwänden.
     *
     * ⚠ Die beiden BESTEHENDEN Anbindungen (`lib/invoice-scan`, `apps/web/lib/admin/tariff-scan`)
     * haben dieselbe Lücke und sind in diesem Bauabschnitt bewusst NICHT angefasst: dort zieht die
     * Server Action ihre Grössen-Konstante real aus `./ai-client`, ein Muster hier machte den
     * Bestand rot. Das gehört in einen eigenen Schritt (Konstanten aus dem Client-Modul lösen,
     * dann dasselbe Muster nachziehen) — s. CLAUDE.md, Delta 17.
     */
    files: ['apps/website/lib/upload-classification/**/*.ts'],
    ignores: ['apps/website/lib/upload-classification/extract.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/report-gate/service-role',
              message:
                'Die Dokument-Zuordnung braucht keine Datenbank. Der eine erlaubte Ort für den ' +
                'service_role-Client ist apps/website/lib/report-gate/store.ts.',
            },
            {
              name: '@/lib/invoice-scan/ai-client',
              message:
                'Der KI-Client des Rechnungs-Scans gehört ausschließlich nach ' +
                'apps/website/lib/invoice-scan/extract.ts.',
            },
            {
              name: '@/lib/upload-classification/ai-client',
              message:
                'Der KI-Client der Dokument-Zuordnung gehört ausschließlich nach ' +
                'apps/website/lib/upload-classification/extract.ts — auch die Server Action ' +
                'daneben soll sich ihren Zugang nicht selbst bauen können.',
            },
            {
              name: '@/lib/battery-text/ai-client',
              message:
                'Der KI-Client der Batterie-Erfassung gehört ausschließlich nach ' +
                'apps/website/lib/battery-text/extract.ts.',
            },
            {
              name: '@/lib/report-request/ai-client',
              message:
                'Der KI-Client der Report-Anfrage gehört ausschließlich nach ' +
                'apps/website/lib/report-request/extract.ts.',
            },
          ],
          patterns: [
            {
              group: ['./ai-client', '../upload-classification/ai-client'],
              message:
                'Auch relativ nicht: der KI-Client der Dokument-Zuordnung gehört ausschließlich ' +
                'nach apps/website/lib/upload-classification/extract.ts. Konstanten, die die ' +
                'Server Action braucht, gehören in ein eigenes Modul ohne Schlüsselzugriff.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Delta 17: die dritte Ausnahmedatei — und sie tauscht die Regel ebenfalls, statt sie
     * abzuschalten. Die Zuordnung darf ihren EIGENEN KI-Client ziehen und weder den
     * service_role-Client noch den KI-Client des Rechnungs-Scans.
     */
    files: ['apps/website/lib/upload-classification/extract.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/report-gate/service-role',
              message:
                'Die Dokument-Zuordnung braucht keine Datenbank — sie schreibt und liest bewusst ' +
                'nichts. Der eine erlaubte Ort ist apps/website/lib/report-gate/store.ts.',
            },
            {
              name: '@/lib/invoice-scan/ai-client',
              message:
                'Die Dokument-Zuordnung hat ihren eigenen KI-Client. Der Client des ' +
                'Rechnungs-Scans gehört ausschließlich nach ' +
                'apps/website/lib/invoice-scan/extract.ts.',
            },
            {
              name: '@/lib/battery-text/ai-client',
              message:
                'Die Dokument-Zuordnung hat ihren eigenen KI-Client. Der Client der ' +
                'Batterie-Erfassung gehört ausschließlich nach ' +
                'apps/website/lib/battery-text/extract.ts.',
            },
            {
              name: '@/lib/report-request/ai-client',
              message:
                'Die Dokument-Zuordnung hat ihren eigenen KI-Client. Der Client der ' +
                'Report-Anfrage gehört ausschließlich nach ' +
                'apps/website/lib/report-request/extract.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Delta 17 Teil 2 — dasselbe Paar für die Batterie-Freitexterfassung, und das
     * Verzeichnis-Muster gegen die RELATIVE Schreibweise ist hier von Anfang an gesetzt: In Teil 1
     * wurde gemessen, dass `paths` nur die Alias-Form (`@/lib/…`) erfasst und ein Nachbar im
     * selben Verzeichnis den Client über `./ai-client` trotzdem erreicht. Damit die Sperre nichts
     * kostet, liegt die Längengrenze in `limits.ts` — die Server Action hat dadurch keinen Grund,
     * das Client-Modul überhaupt anzufassen.
     */
    files: ['apps/website/lib/battery-text/**/*.ts'],
    ignores: ['apps/website/lib/battery-text/extract.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/report-gate/service-role',
              message:
                'Die Batterie-Erfassung braucht keine Datenbank. Der eine erlaubte Ort für den ' +
                'service_role-Client ist apps/website/lib/report-gate/store.ts.',
            },
            {
              name: '@/lib/invoice-scan/ai-client',
              message:
                'Der KI-Client des Rechnungs-Scans gehört ausschließlich nach ' +
                'apps/website/lib/invoice-scan/extract.ts.',
            },
            {
              name: '@/lib/upload-classification/ai-client',
              message:
                'Der KI-Client der Dokument-Zuordnung gehört ausschließlich nach ' +
                'apps/website/lib/upload-classification/extract.ts.',
            },
            {
              name: '@/lib/battery-text/ai-client',
              message:
                'Der KI-Client der Batterie-Erfassung gehört ausschließlich nach ' +
                'apps/website/lib/battery-text/extract.ts — auch die Server Action daneben soll ' +
                'sich ihren Zugang nicht selbst bauen können.',
            },
            {
              name: '@/lib/report-request/ai-client',
              message:
                'Der KI-Client der Report-Anfrage gehört ausschließlich nach ' +
                'apps/website/lib/report-request/extract.ts.',
            },
          ],
          patterns: [
            {
              group: ['./ai-client', '../battery-text/ai-client'],
              message:
                'Auch relativ nicht: der KI-Client der Batterie-Erfassung gehört ausschließlich ' +
                'nach apps/website/lib/battery-text/extract.ts. Konstanten, die die Server Action ' +
                'braucht, stehen in limits.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Die vierte Ausnahmedatei — sie tauscht die Regel ebenfalls, statt sie abzuschalten.
     */
    files: ['apps/website/lib/battery-text/extract.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/report-gate/service-role',
              message:
                'Die Batterie-Erfassung braucht keine Datenbank — sie schreibt und liest bewusst ' +
                'nichts. Der eine erlaubte Ort ist apps/website/lib/report-gate/store.ts.',
            },
            {
              name: '@/lib/invoice-scan/ai-client',
              message:
                'Die Batterie-Erfassung hat ihren eigenen KI-Client. Der Client des ' +
                'Rechnungs-Scans gehört ausschließlich nach ' +
                'apps/website/lib/invoice-scan/extract.ts.',
            },
            {
              name: '@/lib/upload-classification/ai-client',
              message:
                'Die Batterie-Erfassung hat ihren eigenen KI-Client. Der Client der ' +
                'Dokument-Zuordnung gehört ausschließlich nach ' +
                'apps/website/lib/upload-classification/extract.ts.',
            },
            {
              name: '@/lib/report-request/ai-client',
              message:
                'Die Batterie-Erfassung hat ihren eigenen KI-Client. Der Client der ' +
                'Report-Anfrage gehört ausschließlich nach ' +
                'apps/website/lib/report-request/extract.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Delta 18 — dasselbe Paar für die Report-Anfrage-Übersetzung, und das Verzeichnis-Muster
     * gegen die RELATIVE Schreibweise ist wie in Delta 17 Teil 2 von Anfang an gesetzt: `paths`
     * erfasst nur die Alias-Form (`@/lib/…`), ein Nachbar im selben Verzeichnis erreicht den
     * Client über `./ai-client` trotzdem. Damit die Sperre nichts kostet, liegt die Längengrenze
     * in `limits.ts` — die Server Action hat dadurch keinen Grund, das Client-Modul anzufassen.
     */
    files: ['apps/website/lib/report-request/**/*.ts'],
    ignores: ['apps/website/lib/report-request/extract.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/report-gate/service-role',
              message:
                'Die Report-Anfrage braucht keine Datenbank. Der eine erlaubte Ort für den ' +
                'service_role-Client ist apps/website/lib/report-gate/store.ts.',
            },
            {
              name: '@/lib/invoice-scan/ai-client',
              message:
                'Der KI-Client des Rechnungs-Scans gehört ausschließlich nach ' +
                'apps/website/lib/invoice-scan/extract.ts.',
            },
            {
              name: '@/lib/upload-classification/ai-client',
              message:
                'Der KI-Client der Dokument-Zuordnung gehört ausschließlich nach ' +
                'apps/website/lib/upload-classification/extract.ts.',
            },
            {
              name: '@/lib/battery-text/ai-client',
              message:
                'Der KI-Client der Batterie-Erfassung gehört ausschließlich nach ' +
                'apps/website/lib/battery-text/extract.ts.',
            },
            {
              name: '@/lib/report-request/ai-client',
              message:
                'Der KI-Client der Report-Anfrage gehört ausschließlich nach ' +
                'apps/website/lib/report-request/extract.ts — auch die Server Action daneben soll ' +
                'sich ihren Zugang nicht selbst bauen können.',
            },
          ],
          patterns: [
            {
              group: ['./ai-client', '../report-request/ai-client'],
              message:
                'Auch relativ nicht: der KI-Client der Report-Anfrage gehört ausschließlich nach ' +
                'apps/website/lib/report-request/extract.ts. Konstanten, die die Server Action ' +
                'braucht, stehen in limits.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Die fünfte Ausnahmedatei — sie tauscht die Regel ebenfalls, statt sie abzuschalten.
     */
    files: ['apps/website/lib/report-request/extract.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/report-gate/service-role',
              message:
                'Die Report-Anfrage braucht keine Datenbank — sie schreibt und liest bewusst ' +
                'nichts. Der eine erlaubte Ort ist apps/website/lib/report-gate/store.ts.',
            },
            {
              name: '@/lib/invoice-scan/ai-client',
              message:
                'Die Report-Anfrage hat ihren eigenen KI-Client. Der Client des Rechnungs-Scans ' +
                'gehört ausschließlich nach apps/website/lib/invoice-scan/extract.ts.',
            },
            {
              name: '@/lib/upload-classification/ai-client',
              message:
                'Die Report-Anfrage hat ihren eigenen KI-Client. Der Client der ' +
                'Dokument-Zuordnung gehört ausschließlich nach ' +
                'apps/website/lib/upload-classification/extract.ts.',
            },
            {
              name: '@/lib/battery-text/ai-client',
              message:
                'Die Report-Anfrage hat ihren eigenen KI-Client. Der Client der ' +
                'Batterie-Erfassung gehört ausschließlich nach ' +
                'apps/website/lib/battery-text/extract.ts.',
            },
          ],
        },
      ],
    },
  },
  prettier,
)
