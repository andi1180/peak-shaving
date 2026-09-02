import 'server-only'

import {
  PVGIS_WEATHER_YEARS,
  buildPvReferenceProfile,
  checkPvgisRequest,
  parsePvgisSeries,
  pvgisSeriesCalcParams,
  type PvReferenceProfile,
  type PvgisArrayDesign,
  type PvgisRequestRejection,
} from 'engine'

/**
 * B22a — der PVGIS-Proxy. Die SECHSTE Server-Anbindung in `apps/website` und die erste ohne
 * Schlüssel.
 *
 * ── ⚠ EIN PROXY IST ZWINGEND, KEINE GESCHMACKSFRAGE ────────────────────────────────────────────
 * Gemessen am 02.09.2026: PVGIS liefert **0 Treffer** auf `Access-Control-*` — weder auf die
 * eigentliche Antwort noch auf den Preflight (der antwortet mit einem nackten `HTTP/1.0 200 OK`,
 * Content-Length 26). `curl` bekommt die Antwort, weil es CORS ignoriert; ein Browser würde sie
 * verwerfen. Nebenbefund: der Dienst setzt zwei Cookies — ein Browser-Aufruf brächte damit
 * zusätzlich eine Drittanbieter-Cookie-Frage mit sich, die über einen Proxy gar nicht erst entsteht
 * (§165 TKG, s. `lib/tariff-data/client.ts`).
 *
 * ── ⚠ WAS DIESER PROXY NICHT TUT: DEN LASTGANG ENTGEGENNEHMEN ─────────────────────────────────
 * Er liefert ein REFERENZPROFIL (8.760 Stundenwerte in kW) zurück und rechnet nichts mit dem
 * Verbrauch. Die Kopplung „Verbrauch − Erzeugung" geschieht im Browser (`applyEstimatedPv`), und
 * damit bleibt Prinzip 4 für den Lastgang unangetastet: hinaus gehen Koordinate, Neigung,
 * Ausrichtung, kWp und der Wetterjahr-Zeitraum, sonst nichts.
 *
 * Es ist die ZWEITE benannte Ausnahme von Prinzip 4 (die erste ist der Rechnungs-Scan, Delta 9b-2;
 * die dritte, kleinere ist B21-3a). Entschärft ist sie gemessen und nicht argumentiert: innerhalb
 * einer Stadt (≤ 13 km) liegt der Ertragsunterschied unter 1 % — die Anwendung muss also **nie**
 * eine hausgenaue Koordinate erheben, und der Datenschutz-Satz kann das im Klartext sagen (B22b).
 *
 * ── ES GIBT KEINEN SCHLÜSSEL, ALSO AUCH KEINE ESLINT-ALLOWLIST ────────────────────────────────
 * Der Mechanismus in `eslint.config.mjs` schützt einen ABRECHENBAREN Schlüssel (Anthropic) bzw.
 * einen RLS-umgehenden Zugang (service_role). PVGIS ist offen und kostenlos; hier gäbe es nichts zu
 * schützen, und eine Regel ohne Schutzgut wäre Zeremonie. Was bleibt, ist die Missbrauchsfrage —
 * dagegen stehen die Prüfkette und die Frequenzgrenze unten.
 */

const PVGIS_ENDPOINT = 'https://re.jrc.ec.europa.eu/api/v5_3/seriescalc'

/**
 * Zeitgrenze des externen Aufrufs.
 *
 * Gemessen: ein Jahr 1,41 s, alle zehn Wetterjahre in EINEM Aufruf 7,80 s (8,2 MB) — von einem
 * Wohnanschluss aus. 25 s lässt einem langsamen, aber funktionierenden Lauf ehrlich Raum und
 * verhindert zugleich, dass eine hängende Verbindung die Server Action bis zur Plattformgrenze
 * blockiert.
 *
 * ⚠ Die Route, die diese Action später auslöst (B22b), braucht ein passendes `maxDuration` — die
 * Vorgabe liegt darunter, und ein an der Plattformgrenze abgeschnittener Aufruf sähe für den
 * Kunden aus wie ein Ausfall von PVGIS.
 */
const PVGIS_TIMEOUT_MS = 25_000

/**
 * Frequenzgrenze: höchstens so viele Aufrufe je Zeitfenster.
 *
 * ⚠ Sie ist eine SPERRE, keine Bedienhilfe — eine Server Action ist über ihre ID aufrufbar, und der
 * Aufruf kostet einen fremden, kostenlosen Dienst je Anfrage 8 MB und rund acht Sekunden Rechenzeit.
 * Dasselbe Muster wie `MAX_INVOICE_FILE_BYTES` beim Rechnungs-Scan: die Grenze steht VOR dem
 * externen Kontakt, nicht danach.
 *
 * ⚠ OFFENGELEGTE GRENZE: der Zähler ist PROZESSLOKAL. In einer serverlosen Umgebung mit mehreren
 * Instanzen begrenzt er deshalb je Instanz und nicht global — er ist eine Bremse gegen den
 * offensichtlichen Missbrauch (eine Schleife gegen eine Instanz), keine Quote. Eine echte,
 * instanzübergreifende Quote bräuchte einen geteilten Speicher; das wäre eine eigene Entscheidung
 * mit eigener Infrastruktur und ist hier bewusst nicht getroffen.
 */
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_CALLS = 20

let windowStartedAt = 0
let callsInWindow = 0

function takeRateLimitSlot(now: number): boolean {
  if (now - windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    windowStartedAt = now
    callsInWindow = 0
  }
  if (callsInWindow >= RATE_LIMIT_MAX_CALLS) return false
  callsInWindow++
  return true
}

/** Nur für Tests/Diagnose: setzt das Zeitfenster zurück. Kein Aufrufer im Produktionspfad. */
export function resetPvgisRateLimit(): void {
  windowStartedAt = 0
  callsInWindow = 0
}

export type PvgisFetchResult =
  | { ok: true; profile: PvReferenceProfile }
  /**
   * `invalid_input` — die Anfrage ist gar nicht erst hinausgegangen (Parameter ausserhalb des
   * zulässigen Bereichs). `rate_limited` — ebenfalls nicht hinausgegangen, weil zu viele Aufrufe in
   * kurzer Folge kamen.
   *
   * `pvgis_error` — der externe Aufruf ist fehlgeschlagen: Netzwerk, Zeitüberschreitung, Non-200,
   * unlesbarer Rumpf, unerwartetes Antwortschema, unvollständige Reihe. **Alle Aussenfehler
   * münden hier**, weil dem Kunden gegenüber kein Unterschied besteht und die Einzelheit ihn nichts
   * angeht (dieselbe Regel wie `unavailable` beim Rechnungs-Scan).
   *
   * ⚠ Es gibt AUSDRÜCKLICH KEINEN stillen Rückfall auf eine Ersatzkurve. Eine erfundene
   * Erzeugungsreihe wäre eine plausibel aussehende Zahl ohne Grundlage — genau der Fehler, den
   * B11 bei einem fehlenden Tarifsatz vermeidet.
   *
   * Es gibt auch keinen `not_configured`-Zustand: es ist nichts einzurichten und kein Schlüssel zu
   * setzen. Ein solcher Zustand liesse einen Betriebsfehler vermuten, den es hier nicht geben kann.
   */
  | { ok: false; error: 'invalid_input'; reason: PvgisRequestRejection }
  | { ok: false; error: 'rate_limited' }
  | { ok: false; error: 'pvgis_error' }

/**
 * Holt die zehn Wetterjahre in EINEM Aufruf und mittelt sie zum Referenzprofil.
 *
 * ⚠ EIN Aufruf und nicht zehn — s. `pvgisSeriesCalcParams`. Neben der Fairness gegenüber dem Dienst
 * hat das eine fachliche Seite: bei zehn Einzelaufrufen könnte einer scheitern, und aus dem
 * Zehn-Jahres-Mittel würde still ein Neun-Jahres-Mittel. Hier ist es alles oder nichts, und
 * `buildPvReferenceProfile` prüft den gelieferten Jahressatz zusätzlich nach.
 */
export async function fetchPvReferenceProfile(
  design: PvgisArrayDesign,
): Promise<PvgisFetchResult> {
  /*
   * DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Scheitert sie, entsteht kein Aufruf — nicht
   * „PVGIS lehnt ab", sondern der Dienst wird gar nicht erst befragt. Dieselbe Haltung wie in
   * `lib/invoice-scan/actions.ts` und `lib/report-gate/actions.ts`.
   */
  const check = checkPvgisRequest(design)
  if (!check.ok) return { ok: false, error: 'invalid_input', reason: check.reason }
  if (!takeRateLimitSlot(Date.now())) return { ok: false, error: 'rate_limited' }

  const url = `${PVGIS_ENDPOINT}?${new URLSearchParams(pvgisSeriesCalcParams(design)).toString()}`

  let raw: unknown
  try {
    const response = await fetch(url, {
      // Der Dienst antwortet für dieselben Parameter deterministisch; ein Zwischenspeicher der
      // Plattform wäre unschädlich, aber die Antwort ist 8 MB gross — dafür ist er nicht gedacht.
      cache: 'no-store',
      signal: AbortSignal.timeout(PVGIS_TIMEOUT_MS),
    })
    if (!response.ok) return { ok: false, error: 'pvgis_error' }
    raw = await response.json()
  } catch {
    // Netzwerk, Zeitüberschreitung, unlesbarer Rumpf — nach aussen dasselbe.
    return { ok: false, error: 'pvgis_error' }
  }

  const parsed = parsePvgisSeries(raw)
  if (!parsed.ok) return { ok: false, error: 'pvgis_error' }

  const profile = buildPvReferenceProfile(parsed.samples, parsed.inputs, PVGIS_WEATHER_YEARS)
  if (!profile.ok) return { ok: false, error: 'pvgis_error' }

  return { ok: true, profile: profile.profile }
}
