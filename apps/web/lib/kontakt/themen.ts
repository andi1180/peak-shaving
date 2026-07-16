/**
 * Die Themen des Kontaktformulars (Pflichtenheft §5.5) — DATENGETRIEBEN.
 *
 * §5.5 verlangt, das Dropdown „auf die finale Angebots-Taxonomie" zu mappen. Die
 * Taxonomie ist bereits definiert: `LEISTUNGEN` (aus `lib/leistungen.ts`, das
 * seinerseits aus `lib/nav.ts` fällt). Eine getippte Options-Liste wäre eine
 * zweite Taxonomie neben der IA — sie würde beim ersten Leistungs-Rename still
 * abdriften, und zwar an der Stelle, an der es niemandem auffällt: der Kunde
 * wählt weiter das alte Thema, die interne Mail nennt einen Namen, den es nicht
 * mehr gibt.
 *
 * Der Bestand (`reference/coolin-legacy.html`) führte 7 handgetippte Optionen,
 * darunter „Gewerbespeicher" (keine eigene Leistung, steckt in „PV, Speicher &
 * Eigenverbrauch") und ein separates „Peak Shaving / Lastmanagement". Genau diese
 * Drift ist der Grund für dieses Modul.
 *
 * ZWEI Zusätze über die 6 Leistungen hinaus, beide bewusst:
 * - `peakShaving` — das Flaggschiff ist KEINE Leistung (§4.2), hat aber den
 *   lautesten CTA der Seite. Ohne eigenes Thema landete die häufigste Anfrage
 *   unter „Sonstiges".
 * - `sonstiges` — Auffangbecken. Ohne das erzwingt das Pflichtfeld eine falsche
 *   Zuordnung, und die Statistik dahinter wäre wertlos.
 *
 * „Smart Heating" ist bereits eine der 6 (`lib/nav.ts`) und steht deshalb NICHT
 * zusätzlich hier — §5.5 zählt es separat auf, das ist eine Ungenauigkeit des
 * Pflichtenhefts gegenüber der später gebauten IA.
 */

import { LEISTUNGEN } from '@/lib/leistungen'
import { KONTAKT_HREF } from '@/lib/nav'

/**
 * Ein Thema. `key` ist der Wert im Formular, im API-Contract UND in der internen
 * E-Mail — nie das Label. Ein Label ist übersetzbar und darf sich ändern; der
 * Schlüssel darf es nicht.
 */
export type Thema = {
  key: string
  /** Message-Key des sichtbaren Labels, gültig innerhalb von `labelNamespace`. */
  labelKey: string
  /**
   * Zwei Namespaces, mit Grund: Die 6 Leistungen tragen GENAU das Label ihres
   * Nav-Eintrags (`Nav.<key>`) — ein zweiter, abweichender Name für dieselbe
   * Leistung im Dropdown wäre für den Absender verwirrend („heißt das jetzt
   * anders?"). Die beiden Zusätze existieren nur hier und stehen deshalb im
   * `Kontakt`-Namespace.
   */
  labelNamespace: 'Nav' | 'Kontakt'
}

const LEISTUNGS_THEMEN: Thema[] = LEISTUNGEN.map((leistung) => ({
  key: leistung.key,
  labelKey: leistung.key,
  labelNamespace: 'Nav',
}))

/**
 * Reihenfolge = Menü-Reihenfolge der Leistungen, dann das Flaggschiff, dann das
 * Auffangbecken. „Sonstiges" steht zuletzt, weil eine Auffang-Option zwischen den
 * echten Themen die Auswahl verwässert.
 */
export const THEMEN: Thema[] = [
  ...LEISTUNGS_THEMEN,
  { key: 'peakShaving', labelKey: 'themen.peakShaving', labelNamespace: 'Kontakt' },
  { key: 'sonstiges', labelKey: 'themen.sonstiges', labelNamespace: 'Kontakt' },
]

/**
 * Die gültigen Werte als Tupel — genau die Form, die `z.enum()` braucht.
 * Damit validiert der Server gegen DIESELBE Liste, die das Dropdown rendert;
 * ein Thema kann nicht existieren, ohne akzeptiert zu werden (und umgekehrt).
 */
export const THEMA_KEYS = THEMEN.map((thema) => thema.key) as [string, ...string[]]

/** Key → Thema. Wirft laut, statt ein unbeschriftetes Thema zu liefern. */
export function findThema(key: string): Thema {
  const thema = THEMEN.find((t) => t.key === key)
  if (!thema) throw new Error(`Thema "${key}" ist in THEMEN nicht bekannt`)
  return thema
}

/** Ist `key` ein gültiges Thema? Für den Deep-Link, der NICHT werfen darf. */
export function isThemaKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && THEMEN.some((thema) => thema.key === key)
}

/**
 * Der Query-Parameter des Deep-Links (`/kontakt?thema=esg`).
 *
 * Steht hier und nicht als String im JSX: Sender (`components/leistung/`) und
 * Empfänger (`components/kontakt/kontakt-form.tsx`) müssen sich auf denselben
 * Namen einigen — ein Tippfehler auf einer Seite wäre ein Deep-Link, der still
 * nichts tut.
 */
export const THEMA_PARAM = 'thema'

/**
 * `/kontakt` mit vorgewähltem Thema. Wirft bei unbekanntem Key (wie
 * `resolveCrossLink` in `lib/leistungen.ts`): ein Deep-Link, der auf ein nicht
 * existierendes Thema zeigt, wäre am gerenderten Formular unsichtbar — das
 * Dropdown stünde einfach auf „Bitte wählen".
 */
export function kontaktHrefFor(themaKey: string): string {
  findThema(themaKey)
  return `${KONTAKT_HREF}?${THEMA_PARAM}=${encodeURIComponent(themaKey)}`
}
