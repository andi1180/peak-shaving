import 'server-only'

import { createClient } from '@supabase/supabase-js'

import type { Database } from '@/db-types'

/**
 * Delta 16b — SERVER-ONLY Supabase-Client mit dem SERVICE-ROLE-Schlüssel. Umgeht RLS.
 *
 * ── DIES IST DER ERSTE SERVERSEITIGE DATENBANK-ZUGRIFF DIESER APP ÜBERHAUPT ─────────────────────
 * `apps/website` hatte bis hierher genau EINE Anbindung: den anon-Lesezugang aus B21-3a
 * (`lib/tariff-data/client.ts`, browser-tauglich, nur `select` auf veröffentlichte Preisdaten). Das
 * hier ist etwas kategorisch anderes — ein Schlüssel, der jede RLS umgeht und mit dem sich der
 * gesamte Bestand lesen und schreiben liesse. Er existiert aus genau einem Grund: `platform.leads`
 * und `platform.consents` haben für `anon` und `authenticated` BEWUSST kein Grant (ein Lead ist
 * Betriebs-, kein Nutzerdatum — B1-1), und die Erfassungs-Wrapper sind service_role-only. Es gibt
 * keine zweite Tür.
 *
 * ── DREI SPERREN GEGEN VERSEHENTLICHEN GEBRAUCH — dieselben wie in `apps/web` ───────────────────
 *   1. `import 'server-only'` — ein Import aus einer Client-Komponente bricht den Build HART. Das
 *      ist die Sperre, die verhindert, dass der Schlüssel je ins Browser-Bündel gerät.
 *   2. ESLint `no-restricted-imports` (root `eslint.config.mjs`) erlaubt den Import dieses Moduls
 *      in GENAU EINER Datei: `apps/website/lib/report-gate/store.ts`. Eine Server Component ist
 *      ebenfalls server-seitig — `server-only` allein fängt sie also nicht.
 *   3. Zugriff auf die Env erst BEI GEBRAUCH (unten), mit klarer Meldung. Ohne den Schlüssel läuft
 *      der Rechner unverändert weiter; er wird ausschliesslich am Report-Gate gebraucht.
 *
 * ── ⚠ DIE ENV HEISST `SUPABASE_SERVICE_ROLE_KEY` UND IST NICHT `NEXT_PUBLIC_` ───────────────────
 * Das ist keine Stilfrage. `NEXT_PUBLIC_`-präfixte Werte werden von Next zur Bauzeit TEXTUELL ins
 * Client-Bündel eingesetzt; ein service_role-Schlüssel unter diesem Präfix stünde im ausgelieferten
 * JavaScript und wäre damit öffentlich — jede RLS des gesamten Projekts wäre aufgehoben. Die URL
 * dagegen darf beides sein und wird deshalb aus `SUPABASE_URL` gelesen, ersatzweise aus dem bereits
 * gesetzten `NEXT_PUBLIC_SUPABASE_URL` (B21-3a) — sie ist ohnehin öffentlich.
 *
 * Der dynamische Zugriff (`process.env.X` in einer Funktion statt als Modul-Konstante) ist hier
 * ausdrücklich richtig — anders als in `lib/tariff-data/client.ts`, wo LITERALE Referenzen Pflicht
 * sind, weil der Wert im Browser gebraucht wird. Hier ist das Gegenteil der Fall: nichts davon soll
 * je in ein Bündel eingesetzt werden.
 */

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} fehlt. Das Name/Firma-Gate vor dem Report-Download (Delta 16b) braucht den ` +
        `serverseitigen Supabase-Zugang; s. DEPLOYMENT.md §1-Website-b.`,
    )
  }
  return value
}

function supabaseUrl(): string {
  return process.env.SUPABASE_URL || requireEnv('NEXT_PUBLIC_SUPABASE_URL')
}

/**
 * Frischer Client je Aufruf (kein Modul-Singleton — wortgleich zur Begründung in
 * `apps/web/lib/supabase/service-role.ts`: ein über Requests geteilter Client-Zustand ist in einer
 * Server-Umgebung unnötig).
 *
 * Ruft ausschliesslich `public`-RPC-Wrapper. `platform` ist über die Data API gar nicht exponiert
 * (`DEPLOYMENT.md` §2a) — ein direkter `.from('platform.…')` ginge nicht durch.
 */
export function createReportGateServiceClient() {
  return createClient<Database>(supabaseUrl(), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Ist der serverseitige Zugang eingerichtet? Für die Anzeige, ohne einen Client zu bauen. */
export function isReportGateConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
      (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL),
  )
}
