/**
 * POST /api/partner/<slug>/kontakt — die Absendung der Partner-Landingpage (B16-2).
 *
 * Derselbe Ablauf wie `/api/kontakt` (er steht in `lib/kontakt/submit.ts` und wird geteilt, nicht
 * kopiert) mit GENAU EINEM Unterschied: Der Fachbetrieb steht im PFAD.
 *
 * ── WARUM DER SLUG IN DER ADRESSE STEHT UND NICHT IM RUMPF ───────────────────────────────────────
 * An der Zuordnung hängt später, wer ein Montageprojekt bekommt. Ein verstecktes Formularfeld wäre
 * im Browser in fünf Sekunden geändert — ein Pfadsegment ist die Adresse, unter der die Seite
 * ausgeliefert wurde, und es steht auf derselben Seite wie der Firmenname, den die Person liest.
 * `handleKontaktSubmission` liest deshalb ein `partner` im Rumpf gar nicht erst, sobald ein
 * Pfad-Slug vorliegt.
 *
 * Dass der Endpunkt öffentlich erreichbar ist, ist keine Lücke, sondern dieselbe Eigenschaft wie
 * beim Link selbst: Wer `/partner/raymann` aufrufen kann, kann auch dorthin absenden. Ausgeschlossen
 * ist der stille Widerspruch — eine Seite, die einen Fachbetrieb nennt, und eine Absendung, die
 * einen anderen zuordnet.
 *
 * ── EIN UNBEKANNTER SLUG ANTWORTET NICHT MIT 404 ─────────────────────────────────────────────────
 * Anders als die SEITE (`/partner/<slug>` → 404 bei unbekanntem, stillgelegtem oder
 * formatverletzendem Slug). Hier steht ein ausgefülltes Formular auf dem Spiel: Wird ein Fachbetrieb
 * stillgelegt, während seine Mail noch in Postfächern liegt, soll die Anfrage ankommen — sie
 * entsteht dann unter der Herkunft des Kontaktformulars und ohne Zuordnung (begründet in
 * `lib/leads/capture.ts`). Eine tote Landingpage ist ein sichtbarer Fehler, eine verlorene
 * Kundenanfrage ein unsichtbarer.
 *
 * Liegt AUSSERHALB von `app/(site)/[locale]` — der Middleware-Matcher schliesst `/api` aus; ein
 * Locale-Redirect würde den POST zerstören (in T4-3 am Stripe-Webhook verifiziert).
 */

import { handleKontaktSubmission } from '@/lib/kontakt/submit'

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return handleKontaktSubmission(request, { pathPartnerSlug: slug })
}
