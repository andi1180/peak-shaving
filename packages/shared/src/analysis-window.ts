/**
 * Das Zeitfenster einer Analyse — und seine Untergrenze (Delta 15, Regeln A und B).
 *
 * ── WARUM EIN EIGENES MODUL, UND WARUM IN `shared` ──────────────────────────────────────────────
 * Zwei Regeln aus Delta 15 hängen an derselben einen Zahlenreihe (frühester/spätester Zeitstempel
 * des hochgeladenen Lastgangs):
 *
 *   Regel A — der aWATTar-Vergleich benutzt EXAKT diesen Zeitraum, kein Kalenderjahr und keine
 *             „letzten 12 Monate". Beide Seiten der Analyse liegen damit auf derselben echten
 *             Zeitscheibe (Prinzip 1, auf die Vergleichsseite erweitert).
 *   Regel B — beginnt der Lastgang VOR dem Anker, wird er beim Upload abgelehnt.
 *
 * Zweimal abgeleitet liefen sie auseinander: der Upload wiese anhand des einen Beginns ab, die
 * Preisabfrage fragte anhand eines anderen. Deshalb EINE Ableitung, die beide bedienen.
 *
 * Ablage in `shared` und nicht in `engine`: Der Rechenkern rechnet mit dem Profil, das er bekommt —
 * WELCHES Profil er bekommen darf, ist eine Frage der Ränder (dieselbe Aufteilung wie beim
 * Batteriekatalog und bei der B11-Tarifschicht). Und der Upload-Schritt in `apps/website` braucht
 * die Regel, bevor irgendetwas gerechnet wird.
 */
import type { LoadProfile } from './load-profile'

/**
 * Der früheste Zeitpunkt, für den `public.spot_prices` geführt wird — und damit zugleich die
 * Untergrenze dessen, was der Kalkulator als Lastgang annimmt (Delta 15, Regel B).
 *
 * ⚠ DIESE ZAHL EXISTIERT EIN ZWEITES MAL: als `BACKFILL_ANCHOR_ISO` in
 * `apps/web/scripts/backfill-spot-prices.mjs`. Die beiden sind DIESELBE Zahl und dürfen nicht
 * auseinanderlaufen — liefe der Anker des Backfills nach vorn, ohne dass diese Konstante folgt,
 * nähme der Rechner Lastgänge an, für die es keine Preise gibt (und Regel C machte aus einer
 * dauerhaften Ablehnung eine vorübergehende Lücke). Ein Import ist nicht möglich: das Backfill ist
 * ein `.mjs`-Skript ausserhalb jedes Bundlers, in einer ANDEREN App. Gegen das Auseinanderlaufen
 * steht deshalb ein Wächter, der die Skriptdatei liest — `analysis-window.test.ts`.
 */
export const SPOT_PRICE_ANCHOR_ISO = '2025-01-01T00:00:00Z'

/**
 * Derselbe Anker als KALENDERTAG — und der ist es, gegen den Regel B prüft.
 *
 * ── ⚠ WARUM NICHT GEGEN DEN ZEITPUNKT, GEMESSEN STATT ABGELEITET ───────────────────────────────
 * Ein österreichischer Netzbetreiber-Export für das Kalenderjahr 2025 beginnt mit der Zeile
 * `01.01.2025 00:00` — ORTSZEIT. In UTC ist das `2024-12-31T23:00:00Z`, also **eine Stunde VOR**
 * dem Anker. Gegen den Zeitpunkt geprüft würde ausgerechnet der Regelfall abgelehnt, für den die
 * Regel gemacht ist, und die Meldung lautete „bitte einen Lastgang ab 01.01.2025 hochladen" für
 * eine Datei, die genau das ist. Am eigenen Demo-Lastgang nachgemessen (Fenster
 * `2024-12-31T23:00:00.000Z … 2025-12-31T22:45:00.000Z`).
 *
 * Delta 15 nennt die Grenze als DATUM („Beginn vor dem 1.1.2025"), nicht als Zeitpunkt. Geprüft
 * wird deshalb der Kalendertag des ersten Messwerts in der Zeitzone des Lastgangs.
 *
 * ── ⚠ WAS DAMIT OFFEN BLEIBT — für B21-3b, hier bewusst nicht gelöst ───────────────────────────
 * Die erste Stunde eines solchen Lastgangs (Ortszeit 00:00–01:00 am 1.1.) liegt vor dem Anker und
 * hat deshalb KEINEN Spotpreis. Das ist keine betriebliche Lücke (Regel C, „ein Cron ist
 * stehengeblieben"), sondern eine systematische Kante des Ankers: sie trifft JEDEN
 * Kalenderjahr-2025-Lastgang und schliesst sich nicht von selbst. Wer den Preisbereich in B21-3b
 * verdrahtet, muss sie ausdrücklich behandeln — entweder durch Vorziehen des Backfill-Ankers um
 * einen Tag (dann wandern BEIDE Zahlen, s. u.) oder durch bewusstes Kappen des Abfragebereichs auf
 * den Anker. Sie als gewöhnliche Regel-C-Lücke durchlaufen zu lassen hiesse, für jeden solchen
 * Lastgang den ganzen Vergleich als nicht berechenbar auszuweisen.
 */
export const SPOT_PRICE_ANCHOR_DATE = '2025-01-01'

/** Der Zeitraum, den ein Lastgang tatsächlich abdeckt (Delta 15, Regel A). Beide Grenzen inklusiv. */
export type AnalysisWindow = {
  /** Frühester Zeitstempel des Lastgangs (ISO, UTC). */
  startIso: string
  /** Spätester Zeitstempel des Lastgangs (ISO, UTC). */
  endIso: string
}

/**
 * Frühester und spätester Zeitstempel des Lastgangs.
 *
 * Bewusst ein echter Durchlauf über alle Messwerte statt `readings[0]`/`readings.at(-1)`: der Parser
 * sortiert zwar, aber ein `LoadProfile` kann auch aus einer anderen Quelle stammen (Delta 8,
 * `standard_profile`), und eine stillschweigende Sortierungs-Annahme ist genau die Art Voraussetzung,
 * die später niemand mehr prüft. Der Durchlauf kostet bei 35.040 Werten nichts.
 *
 * `null` bei leerem Profil — es gibt dann kein Fenster, und ein erfundenes wäre schlimmer als keins.
 */
export function analysisWindow(profile: LoadProfile): AnalysisWindow | null {
  let startIso: string | null = null
  let endIso: string | null = null
  for (const r of profile.readings) {
    if (startIso === null || r.ts < startIso) startIso = r.ts
    if (endIso === null || r.ts > endIso) endIso = r.ts
  }
  // ISO-8601-Zeitstempel in UTC (der Parser normalisiert darauf) sind lexikografisch vergleichbar.
  return startIso === null || endIso === null ? null : { startIso, endIso }
}

/**
 * Regel B: Beginnt das Fenster vor dem Anker, für den Marktpreise geführt werden?
 *
 * Getrennt von `analysisWindow`, damit die Ableitung des Fensters (Regel A) auch dort benutzt werden
 * kann, wo die Untergrenze keine Rolle spielt — und damit die Regel selbst genau eine Zeile ist, die
 * man lesen kann.
 *
 * `timezone` ist die des Lastgangs (`LoadProfile.timezoneMeta` bzw. `Detection.timezone`) — die
 * Begründung steht bei `SPOT_PRICE_ANCHOR_DATE`. Sie ist ein Pflichtparameter und hat bewusst keinen
 * Vorgabewert: eine stillschweigend angenommene Zeitzone wäre genau der Fehler, den diese Prüfung
 * vermeidet.
 */
export function startsBeforeSpotPriceAnchor(window: AnalysisWindow, timezone: string): boolean {
  return localDate(window.startIso, timezone) < SPOT_PRICE_ANCHOR_DATE
}

/**
 * Kalendertag eines UTC-Zeitpunkts in einer Zeitzone, als 'YYYY-MM-DD' (dadurch lexikografisch
 * vergleichbar). `en-CA` liefert genau dieses Format — dieselbe Technik wie im Parser
 * (`utcMsToLocalFields`), nur ohne dessen Feldzerlegung.
 */
function localDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}
