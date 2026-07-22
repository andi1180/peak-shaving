/**
 * POST /api/kontakt — die serverseitige Wahrheit des Kontaktformulars (§5.5/§8.6).
 *
 * Ersetzt Netlify Forms, das auf Vercel/Next nicht existiert (§8.6). Der Bestand
 * (`reference/coolin-legacy.html`) postete an `/danke.html` mit
 * `data-netlify="true"` — auf Vercel wäre das ein 404 und ein still verlorener
 * Lead.
 *
 * WARUM EINE ROUTE UND KEINE SERVER ACTION: Der Endpunkt ist Trage der Secrets
 * (Resend, Turnstile) und muss unabhängig vom Formular-Rendering prüfbar sein —
 * ein `curl` gegen diese Route ist Teil der Verifikation. Server Actions sind an
 * ihren Client gebunden und lassen sich nicht so gerade heraus nachmessen.
 *
 * Die Route liegt AUSSERHALB der `(site)/[locale]`-Struktur: Die
 * next-intl-Middleware schließt `/api` explizit aus (`middleware.ts`), es gibt
 * also kein Locale-Präfix und keinen Rewrite. Die Locale kommt deshalb aus dem
 * Body (und wird geprüft), nicht aus der URL.
 *
 * ── SEIT B16-2 IST DER ABLAUF SELBST AUSGELAGERT ─────────────────────────────
 * Er steht in `lib/kontakt/submit.ts` und wird von einem ZWEITEN Endpunkt geteilt
 * (`/api/partner/[slug]/kontakt`, die Partner-Landingpage). Diese Datei ist damit
 * die Adresse, nicht die Logik — der Unterschied zwischen den beiden Endpunkten
 * ist genau ein Argument.
 *
 * OHNE Pfad-Slug: Ein `partner` im Rumpf (aus `?partner=` auf `/kontakt`) wird
 * hier ausgewertet, aber serverseitig gegen die AKTIVEN Fachbetriebe geprüft —
 * ein unbekannter, stillgelegter oder erfundener Wert wird stillschweigend
 * verworfen, und der Lead entsteht trotzdem.
 */

import { handleKontaktSubmission } from '@/lib/kontakt/submit'

export async function POST(request: Request) {
  return handleKontaktSubmission(request)
}
