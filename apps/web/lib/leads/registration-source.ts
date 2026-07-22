/**
 * Welche HERKUNFT bekommt ein Lead, der aus einer Registrierung entsteht? (B10-5)
 *
 * REIN — kein `server-only`, kein `next/*`, kein Supabase-Client. Die Ableitung ist eine
 * Zeichenketten-Entscheidung und wird genau so geprüft: ohne Datenbank, ohne Sitzung, ohne Formular.
 *
 * ── WARUM DIE FRAGE ÜBERHAUPT ENTSTEHT ───────────────────────────────────────────────────────────
 * Es gibt genau EIN Registrierungsformular, und es ist produktübergreifend (B10-5-Entscheidung:
 * Felder plattformweit Pflicht, kein kalkulator-eigenes Formular). Derselbe Screen trägt damit zwei
 * Trichter: den Monitor-Gratis-Check und den Zugangsweg zum Pro-Kalkulator. Ohne Unterscheidung
 * wäre die Frage „hat der Kalkulator-Zugang Registrierungen erzeugt?" unbeantwortbar — und zwar
 * unbemerkt, denn die Leads wären ja da.
 *
 * ── DIE UNTERSCHEIDUNG HÄNGT AM RÜCKSPRUNGZIEL, NICHT AN EINEM EIGENEN PARAMETER ─────────────────
 * `?next=` existiert seit B10-2 und trägt bereits die Information, WOHIN jemand wollte, bevor ihn
 * die Zugangsprüfung angehalten hat. Ein zweiter Parameter („?quelle=kalkulator") wäre eine zweite
 * Angabe über denselben Sachverhalt — beide frei setzbar, und bei Widerspruch müsste jemand
 * entscheiden, welche gilt. Es gibt nur einen Wert, und er ist ohnehin schon vorhanden.
 *
 * ── DER ÜBERGEBENE WERT MUSS BEREITS SANIERT SEIN ────────────────────────────────────────────────
 * Diese Funktion prüft NICHT auf Open Redirect — das tut `sanitizeNext` (`lib/auth/config.ts`), und
 * zwar VOR dem Aufruf hier. Beides zu vermischen hiesse, die Sicherheitsprüfung an einer Stelle zu
 * wiederholen, an der sie niemand vermutet; und ein hier durchgewinkter fremder Wert wäre auch dann
 * kein Angriff, sondern nur eine falsche Herkunft. Fällt die Sanierung auf „kein Ziel", kommt hier
 * ein leerer Wert an — und der ist der Normalfall, nicht der Fehlerfall.
 */

import { CALCULATOR_RUN_HREF } from '@/lib/nav'
import type { LeadSourceWithoutFormKey } from './registry'

/**
 * Der Pfad-Präfix des Kalkulator-Bereichs. Bewusst der BEREICH und nicht die eine Rechner-Route:
 * die Produktseite und die Rechner-Route gehören demselben Trichter an, und eine künftige dritte
 * Seite darunter soll nicht stillschweigend als „allgemeine Registrierung" gezählt werden.
 */
export const CALCULATOR_AREA_PREFIX = '/peak-shaving/kalkulator'

/**
 * BEWEIS BEIM TYPECHECK, dass die geschützte Route tatsächlich unter diesem Präfix liegt.
 *
 * Ohne diese Zeile könnte die Rechner-Route umziehen (`lib/nav.ts`), der Präfix stehen bleiben — und
 * die Herkunftsableitung liefe still ins Leere: jede Registrierung aus dem Kalkulator-Trichter
 * landete als 'registrierung' im Bestand, ohne dass irgendetwas fehlschlägt. Die Prüfung steht im
 * MODUL und nicht in der Testdatei, weil eine Typ-Invariante dort geprüft wird, wo sie gilt.
 */
type CalculatorRouteIsInsideArea =
  typeof CALCULATOR_RUN_HREF extends `${typeof CALCULATOR_AREA_PREFIX}${string}`
    ? true
    : 'CALCULATOR_RUN_HREF liegt nicht unter CALCULATOR_AREA_PREFIX'
const _calculatorRouteIsInsideArea: CalculatorRouteIsInsideArea = true
void _calculatorRouteIsInsideArea

/** Die beiden Herkünfte, die eine Registrierung erzeugen kann (`platform.lead_sources`, B10-5). */
export const LEAD_SOURCE_REGISTRIERUNG = 'registrierung' satisfies LeadSourceWithoutFormKey
export const LEAD_SOURCE_KALKULATOR_REGISTRIERUNG =
  'kalkulator-registrierung' satisfies LeadSourceWithoutFormKey

export type RegistrationLeadSourceKey =
  typeof LEAD_SOURCE_REGISTRIERUNG | typeof LEAD_SOURCE_KALKULATOR_REGISTRIERUNG

/**
 * Herkunft aus dem bereits sanierten Rücksprungziel.
 *
 * Der Vergleich läuft gegen den PFAD ohne Query und Fragment: `?next=/peak-shaving/kalkulator/
 * rechner?von=mail` soll dieselbe Herkunft ergeben wie der nackte Pfad. Und er verlangt entweder
 * Gleichheit oder einen Schrägstrich dahinter — sonst zählte ein erfundenes
 * `/peak-shaving/kalkulator-fremd` als Kalkulator-Registrierung, obwohl es eine andere Route ist.
 */
export function leadSourceForRegistration(
  sanitizedNext: string | null | undefined,
): RegistrationLeadSourceKey {
  if (!sanitizedNext) return LEAD_SOURCE_REGISTRIERUNG

  const path = sanitizedNext.split(/[?#]/, 1)[0] ?? ''
  const isCalculatorArea =
    path === CALCULATOR_AREA_PREFIX || path.startsWith(`${CALCULATOR_AREA_PREFIX}/`)

  return isCalculatorArea ? LEAD_SOURCE_KALKULATOR_REGISTRIERUNG : LEAD_SOURCE_REGISTRIERUNG
}
