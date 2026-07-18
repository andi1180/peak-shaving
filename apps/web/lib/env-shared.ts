/**
 * Gemeinsame Bausteine der zentralen Env-Validierung (T4-2, Aufgabe 1).
 *
 * REIN & seiteneffektfrei — kein `server-only`, kein `next/*`, keine `process.env`-Zugriffe.
 * Damit ist diese Datei aus Server- UND Client-Kontext importierbar; die eigentliche Trennung
 * server-only vs. client-exponiert erzwingen die zwei aufrufenden Module (`env.public.ts`
 * ohne, `env.server.ts` mit `import 'server-only'`).
 */
import { z } from 'zod'

/**
 * Optionale, nicht-leere Env-Variable. Ein leerer String (`FOO=`) wird zu `undefined`
 * NORMALISIERT — genau das bisherige, an vielen Fundstellen verlassene Verhalten
 * (`if (process.env.FOO)` behandelt `''` als „nicht gesetzt"). So verschärft die zentrale
 * Validierung nichts: „gesetzt, aber leer" bleibt „nicht gesetzt", statt neu hart zu scheitern.
 */
export const optionalEnv = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.string().min(1).optional(),
)

/**
 * Validiert ein rohes Env-Objekt gegen ein Schema und wirft bei einem UNGÜLTIGEN (gesetzten,
 * aber formal falschen) Wert LAUT — beim Import, also beim Start/Build, mit klarer Meldung,
 * statt später an zufälliger Stelle zur Laufzeit. Ein FEHLENDER optionaler Wert ist kein Fehler.
 */
export function parseEnv<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  raw: Record<string, unknown>,
  scope: string,
): z.infer<z.ZodObject<T>> {
  const result = schema.safeParse(raw)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    // Generische Meldung (kein Supabase-Bezug): `parseEnv` validiert auch die client-exponierte
    // Env (publicEnv) und wird damit ins Client-Bundle gezogen — ein „supabase"-Hinweis hätte dort
    // nichts zu suchen (J1). Der Supabase-spezifische Hinweis lebt in `requireValue` (server-only).
    throw new Error(
      `Ungültige ${scope}-Umgebungsvariablen (apps/web) — Build/Start abgebrochen:\n${details}\n` +
        `Vorlage/Doku: apps/web/.env.example.`,
    )
  }
  return result.data
}

/**
 * Liefert einen PFLICHT-Wert oder wirft mit klarer, handlungsleitender Meldung. Für Variablen,
 * die an der VERWENDUNGSSTELLE benötigt werden (require-on-use), aber im Schema optional bleiben,
 * damit ein Build ohne sie durchläuft (s. env.server.ts, SUPABASE_*).
 */
export function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} fehlt — apps/web/.env.local aus apps/web/.env.example anlegen ` +
        `(lokal: Werte aus \`supabase status\` nach \`supabase start\`).`,
    )
  }
  return value
}
