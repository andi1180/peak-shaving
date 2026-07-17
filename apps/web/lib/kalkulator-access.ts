/**
 * Zugangscode für den Pro-Kalkulator (`/peak-shaving/kalkulator/rechner`).
 *
 * SOFT-GATE, KEINE ECHTE SICHERHEIT — Ersatz durch echte Auth in Phase 2
 * vorgesehen (§8.1, Login/Entitlements). Der Code steht im Client-Bundle und
 * ist für jeden lesbar, der die Entwicklertools öffnet. Er hält Zufallsbesucher
 * und Crawler ab, keinen Entschlossenen. Genau das ist die Absicht: Solange OP#1
 * (kostenlos vs. verkauft) offen ist, soll der Rechner nicht offen im Netz
 * stehen, ohne dass dafür ein Auth-System gebaut wird, das die Geschäftsweiche
 * ohnehin wieder umwirft.
 *
 * WAS DAS GATE NICHT SCHÜTZT — und auch nicht schützen soll:
 *   – Der Rechner selbst (`apps/website`) bleibt unter seiner eigenen URL
 *     erreichbar. Das Gate sitzt vor dem iframe, nicht im iframe.
 *   – Der Schnellrechner (`components/quick-calculator.tsx`) ist ein bewusst
 *     offenes, separates Werkzeug (§5.4) und bleibt ungated.
 *   – Die Produktseite `/peak-shaving/kalkulator` beschreibt das Produkt und
 *     bleibt ungated — sie trägt den Content, der ranken soll (§6.2).
 *
 * Das Gate sitzt zentral auf der ZIELROUTE, nicht an den Links dorthin: Ein pro
 * Button versteckter Link wäre per Direkt-URL umgehbar, und die Links (Nav-CTA,
 * Hero, Cross-Links) bleiben deshalb unverändert.
 */

/** Der Code. EINE Stelle — hier ändern, nicht suchen. */
export const KALKULATOR_ACCESS_CODE = 'coolin2026'

/**
 * localStorage-Schlüssel für „Code wurde schon eingegeben".
 *
 * Bewusst mit Namensraum-Präfix: Der Schlüssel teilt sich den Origin mit allem,
 * was später unter coolin.at im Browser ablegt.
 */
export const KALKULATOR_ACCESS_STORAGE_KEY = 'coolin.kalkulator.access'

/** Vergleich ohne Groß-/Kleinschreibung und ohne Rand-Leerzeichen — ein
 *  kopierter Code mit anhängendem Leerzeichen ist kein falscher Code. */
export function isValidAccessCode(input: string): boolean {
  return input.trim().toLowerCase() === KALKULATOR_ACCESS_CODE
}
