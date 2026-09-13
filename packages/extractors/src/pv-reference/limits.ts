/**
 * B24, Teil 1 — GRENZEN UND FREQUENZBREMSE DES PVGIS-ABRUFS IM ADMIN-WIZARD (Phase A).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EINE EIGENE, UNABHÄNGIGE BREMSE — KEIN GETEILTER ZUSTAND MIT DEM ÖFFENTLICHEN RECHNER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `apps/website/lib/pvgis/client.ts` führt seit B22a dieselbe Mechanik mit denselben Zahlen. Sie
 * hier zu importieren ginge nicht (die zwei Apps importieren einander nie) — und sie hierher zu
 * ZIEHEN wäre falsch, nicht bloss unmöglich:
 *
 *   Der Zähler ist PROZESSLOKAL, und die zwei Wege laufen in zwei getrennten Vercel-Projekten
 *   (`peak-shaving-website` gegen `peak-shaving-web`). Ein „geteilter" Zustand liesse sich gar
 *   nicht herstellen, wohl aber BEHAUPTEN — und eine Bremse, die zu greifen scheint und nicht
 *   greift, ist schlechter als zwei ehrliche.
 *
 * Die Zahlen sind deshalb bewusst DUPLIZIERT und nicht geteilt. Sie dürfen sich unabhängig
 * bewegen: der öffentliche Rechner bedient anonyme Besucher, dieser Weg einen angemeldeten Admin,
 * der eine bestehende Anlage erfasst. Wer die eine ändert, muss die andere nicht mitziehen.
 *
 * ── ⚠ SIE IST EINE SPERRE, KEINE BEDIENHILFE ──────────────────────────────────────────────────
 * Die Server Action, die diesen Weg später auslöst (Phase B), ist über ihre Kennung aufrufbar, und
 * jeder Aufruf kostet einen fremden, KOSTENLOSEN Dienst rund 8 MB und mehrere Sekunden Rechenzeit.
 * Dasselbe Muster wie `MAX_INVOICE_FILE_BYTES` beim Rechnungs-Scan: die Grenze steht VOR dem
 * externen Kontakt, nicht danach.
 *
 * ⚠ OFFENGELEGTE GRENZE, wortgleich zur Website: der Zähler ist PROZESSLOKAL. In einer serverlosen
 * Umgebung mit mehreren Instanzen begrenzt er je Instanz und nicht global — er ist eine Bremse
 * gegen den offensichtlichen Missbrauch (eine Schleife gegen eine Instanz), keine Quote. Eine
 * echte, instanzübergreifende Quote bräuchte geteilten Speicher; das wäre eine eigene Entscheidung
 * mit eigener Infrastruktur und ist hier bewusst nicht getroffen.
 *
 * ── ⚠ WARUM DIESE DATEI `limits.ts` HEISST, OBWOHL ES HIER KEINEN SCHLÜSSEL GIBT ──────────────
 * In den sechs KI-Anbindungen dieses Pakets trennt `limits.ts` die Grenzen vom `ai-client.ts`,
 * damit Barrel und Server Action keinen Grund haben, das schlüsselführende Modul anzufassen
 * (ESLint setzt das durch). Dieses Verzeichnis hat keinen `ai-client` — PVGIS ist offen und
 * kostenlos, es gibt hier nichts zu schützen. Der Name bleibt trotzdem: eine Server Action, die
 * nur die Obergrenze nennen will, soll sie an der gewohnten Stelle finden.
 */

/** Der `seriescalc`-Endpunkt. Fassung 5.3 — dieselbe wie im öffentlichen Rechner. */
export const PVGIS_ENDPOINT = 'https://re.jrc.ec.europa.eu/api/v5_3/seriescalc'

/**
 * Zeitgrenze des externen Aufrufs.
 *
 * Gemessen (B22a, 02.09.2026, von einem Wohnanschluss): ein Wetterjahr 1,41 s, alle zehn in EINEM
 * Aufruf 7,80 s bei 8,2 MB. 25 s lässt einem langsamen, aber funktionierenden Lauf ehrlich Raum und
 * verhindert zugleich, dass eine hängende Verbindung die Server Action bis zur Plattformgrenze
 * blockiert.
 *
 * ⚠ DIE ROUTE, DIE DIESEN WEG AUSLÖST, BRAUCHT EIN PASSENDES `maxDuration` (Phase B) — die Vorgabe
 * von Vercel liegt darunter, und ein an der Plattformgrenze abgeschnittener Aufruf sähe für den
 * Admin aus wie ein Ausfall von PVGIS. Und `maxDuration` wirkt NUR in einer `page`-/`route`-Datei;
 * in einem `'use server'`-Modul wird der Export still ignoriert, bei grünem Build (in B22c
 * gemessen).
 *
 * ⚠ MEHRERE MODULFLÄCHEN SIND MEHRERE AUFRUFE (Phase B): ein Zählpunkt mit drei Flächen braucht
 * drei mal bis zu 25 s. Das Zeitbudget der Route ist damit NICHT diese Zahl, sondern ihr Vielfaches
 * — wer die Orchestrierung baut, rechnet das aus, statt es zu hoffen.
 */
export const PVGIS_TIMEOUT_MS = 25_000

/** Länge des Zeitfensters der Frequenzbremse. */
export const PV_REFERENCE_RATE_LIMIT_WINDOW_MS = 60_000

/**
 * Aufrufe je Zeitfenster.
 *
 * 20 ist dieselbe Zahl wie im öffentlichen Rechner und aus demselben Grund: ein Zählpunkt mit
 * mehreren Modulflächen löst mehrere Aufrufe in kurzer Folge aus (das vorliegende Planungsdokument
 * führt zwei, drei sind realistisch), und eine Grenze, die den Regelfall trifft, wäre keine Bremse,
 * sondern ein Fehler.
 */
export const PV_REFERENCE_RATE_LIMIT_MAX_CALLS = 20

let windowStartedAt = 0
let callsInWindow = 0

/**
 * Nimmt einen Platz im laufenden Zeitfenster — `false` heisst: es geht NICHTS hinaus.
 *
 * Die Uhr kommt als Parameter herein und wird nicht selbst gelesen: eine Funktion, die auf die Uhr
 * sieht, lässt sich nicht gegen einen Stichtag prüfen (dieselbe Regel wie bei
 * `standardProfileYear`).
 */
export function takePvReferenceRateLimitSlot(now: number): boolean {
  if (now - windowStartedAt >= PV_REFERENCE_RATE_LIMIT_WINDOW_MS) {
    windowStartedAt = now
    callsInWindow = 0
  }
  if (callsInWindow >= PV_REFERENCE_RATE_LIMIT_MAX_CALLS) return false
  callsInWindow++
  return true
}

/**
 * Setzt das Zeitfenster zurück. **Nur für Tests und Diagnose — kein Aufrufer im Produktionspfad.**
 *
 * Sie steht im Barrel, weil das Paket keinen eigenen Testlauf hat: was hier zu prüfen ist, wird in
 * `apps/web` gemessen, und ein Deep-Import in dieses Verzeichnis löst von dort gar nicht auf
 * (`exports` gibt ausschliesslich `.` frei). Dasselbe Muster wie `resetPvgisRateLimit` im
 * öffentlichen Rechner.
 */
export function resetPvReferenceRateLimit(): void {
  windowStartedAt = 0
  callsInWindow = 0
}
