/**
 * Client-EXPONIERTE Umgebungsvariablen — ausschließlich `NEXT_PUBLIC_*` (T4-2, Aufgabe 1).
 *
 * BEWUSST OHNE `server-only`: diese Werte sind öffentlich und werden auch serverseitig gelesen
 * (z. B. `lib/site.ts` für die Canonicals). Importierbar aus JEDEM Kontext. Die andere Hälfte —
 * server-only-Geheimnisse — liegt in `env.server.ts` (mit `import 'server-only'`); ein
 * nicht-präfixter Wert kann so STRUKTURELL nie in diesem öffentlichen Objekt landen.
 *
 * LITERALE `process.env.NEXT_PUBLIC_*`-Referenzen sind PFLICHT: Next.js ersetzt nur exakt diese
 * Ausdrücke zur Build-Zeit textuell durch den Wert. Ein dynamischer Zugriff (`process.env[name]`)
 * bliebe im Browser `undefined`. Deshalb hier je Variable eine eigene, statische Zeile.
 */
import { z } from 'zod'
import { optionalEnv, parseEnv } from './env-shared'

const publicSchema = z.object({
  // Basis-URL der Seite. Bewusst NUR „optionaler, nicht-leerer String" — die eigentliche
  // Origin-Prüfung (Schema/kein Pfad) macht `lib/site.ts` mit besserer Meldung; hier zu
  // verschärfen würde das dortige, bewusst gewählte Fehlerverhalten verdoppeln.
  NEXT_PUBLIC_SITE_URL: optionalEnv,
  // Von Vercel automatisch gesetzt (URL DIESES Deployments). Fallback in lib/site.ts.
  NEXT_PUBLIC_VERCEL_URL: optionalEnv,
  // Cloudflare-Turnstile-Widget-Key (im Browser sichtbar — bei Turnstile Absicht).
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalEnv,
})

export const publicEnv = parseEnv(
  publicSchema,
  {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  },
  'öffentliche (NEXT_PUBLIC_*)',
)
