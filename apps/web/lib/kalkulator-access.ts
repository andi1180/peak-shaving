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
 *
 * DER CODE WIRD BEI JEDEM SEITENAUFRUF NEU VERLANGT (Prompt 28): Es gibt keinen
 * gespeicherten „entsperrt"-Zustand mehr. Jeder Reload, jeder neue Besuch —
 * auch im selben Browser, der den Code eben noch richtig eingegeben hat —
 * startet wieder gesperrt. Das ist Absicht und keine Verschärfung der
 * Sicherheit (die gibt es hier weiterhin nicht, s. o.): Solange der Rechner in
 * Demos gezeigt wird, soll sichtbar bleiben, dass er hinter einem Code liegt,
 * und ein einmal auf einem fremden Gerät eingegebener Code soll dieses Gerät
 * nicht dauerhaft freischalten. Der Zugang gilt genau so lange, wie der Nutzer
 * auf der Seite bleibt.
 */

/** Der Code. EINE Stelle — hier ändern, nicht suchen. */
export const KALKULATOR_ACCESS_CODE = 'coolin2026'

/**
 * ALTLAST aus Prompt 25/26, wird nur noch GELÖSCHT, nie gelesen oder gesetzt.
 *
 * Damals persistierte das Gate hier ein „entsperrt"-Flag. Nur nicht mehr
 * hinzusehen würde nicht reichen: In den Browsern aller, die den Code vor
 * Prompt 28 schon einmal eingegeben haben, liegt der Eintrag weiterhin — er
 * gehört aktiv weggeräumt, damit er nicht als toter Zustand überdauert und ein
 * späteres Feature ihn versehentlich wieder für bare Münze nimmt.
 *
 * Der Wert muss exakt der alte bleiben, sonst läuft die Bereinigung ins Leere.
 * Entfernbar, sobald die Alt-Einträge realistisch aus dem Feld verschwunden
 * sind (spätestens mit der echten Auth in Phase 2, §8.1).
 */
export const KALKULATOR_ACCESS_LEGACY_STORAGE_KEY = 'coolin.kalkulator.access'

/** Vergleich ohne Groß-/Kleinschreibung und ohne Rand-Leerzeichen — ein
 *  kopierter Code mit anhängendem Leerzeichen ist kein falscher Code. */
export function isValidAccessCode(input: string): boolean {
  return input.trim().toLowerCase() === KALKULATOR_ACCESS_CODE
}
