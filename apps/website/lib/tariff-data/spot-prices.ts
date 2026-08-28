/**
 * Historische Marktpreise für einen Analyse-Zeitraum lesen — samt Lückenprüfung (B21-3a, Delta 7).
 *
 * Diese Funktion liefert die Datengrundlage für **Delta 15, Regel C**: Fehlen für einen Teil des
 * Zeitraums Preise, wird der aWATTar-Vergleich als NICHT BERECHENBAR gekennzeichnet — nicht
 * interpoliert und nicht übersprungen. Die Kennzeichnung selbst ist Sache der Engine/Oberfläche
 * (B21-3b); hier entsteht die belastbare Aussage, auf die sie sich stützt.
 */
import {
  NOT_CONFIGURED,
  createTariffDataClient,
  requestFailed,
  type TariffDataFailure,
} from './client'

/**
 * Heute die einzige Quelle. Der Filter ist trotzdem gesetzt und nicht weggelassen: Käme eine zweite
 * Quelle dazu (die `provider`-Spalte existiert seit B21-1 genau dafür), lieferte eine ungefilterte
 * Abfrage jede Stunde doppelt — die Preiskurve wäre still verfälscht und die Lückenprüfung
 * gleichzeitig zufrieden.
 */
export const SPOT_PRICE_PROVIDER = 'awattar_at'

/**
 * Die Preisreihe ist stündlich (aWATTar AT). Die Tabelle könnte feiner tragen (der Kommentar in
 * B21-1 nennt „je Viertelstunde/Stunde"); die Lückenprüfung geht deshalb NICHT von einem festen
 * Raster aus, sondern misst den tatsächlichen Abstand zwischen aufeinanderfolgenden Einträgen —
 * s. `findMissingRanges`.
 */
const HOUR_MS = 60 * 60 * 1000

/** PostgREST liefert ohne `range()` höchstens 1.000 Zeilen — s. den Warnblock in `fetchSpotPrices`. */
const PAGE_SIZE = 1000

export type SpotPrice = {
  tsStart: string
  tsEnd: string
  ctPerKwh: number
  priceBasis: string
}

/** Ein zusammenhängender Bereich ohne Preise. Beide Grenzen als ISO-Zeitstempel, `from` inklusiv. */
export type MissingRange = { fromIso: string; toIso: string }

export type SpotPriceFetchResult =
  | {
      ok: true
      prices: SpotPrice[]
      /**
       * Deckt die Reihe den angefragten Zeitraum lückenlos ab?
       *
       * Steht bewusst INNERHALB des Erfolgsfalls: „gelesen, aber unvollständig" (Regel C, unser
       * Betriebszustand, morgen behoben) ist etwas anderes als „nicht lesbar" (`ok: false`). In
       * einen gemeinsamen Fehlerpfad gelegt, sähe niemand mehr, dass ein Cron stehengeblieben ist —
       * genau die Vermischung, die Delta 15 ausschliesst.
       */
      complete: boolean
      /** Leer, wenn `complete` — sonst jeder fehlende Bereich einzeln, nicht nur ihre Anzahl. */
      missingRanges: MissingRange[]
    }
  | TariffDataFailure

/**
 * Alle Preise im Bereich `[periodStart, periodEnd)`, aufsteigend, samt Lückenbefund.
 *
 * ── ⚠ SEITENWEISE LESEN IST PFLICHT, NICHT VORSORGE — gemessen ─────────────────────────────────
 * PostgREST begrenzt eine Antwort ohne ausdrücklichen Bereich auf **1.000 Zeilen**. Ein Jahres-
 * Lastgang braucht 8.760 Stundenpreise; die Cloud führt heute 14.503. Eine einzelne Abfrage lieferte
 * also die ersten 1.000 und meldete den Rest als LÜCKE — der Vergleich wäre „nicht berechenbar",
 * und der Grund stünde nirgends. Deshalb wird in Seiten zu 1.000 gelesen, bis eine Seite nicht mehr
 * voll ist.
 *
 * @param periodStart ISO-Zeitstempel, inklusiv (Beginn des Lastgangs, Delta 15 Regel A).
 * @param periodEnd   ISO-Zeitstempel, EXKLUSIV. Ein Lastgang endet mit dem BEGINN seiner letzten
 *                    Viertelstunde; der zugehörige Preis ist der der Stunde, in der sie liegt.
 *                    Ein exklusives Ende verlangt deshalb, dass der Aufrufer die Dauer des letzten
 *                    Intervalls aufschlägt — `analysisWindowToPriceRange` tut genau das.
 */
export async function fetchSpotPrices(
  periodStart: string,
  periodEnd: string,
): Promise<SpotPriceFetchResult> {
  const client = createTariffDataClient()
  if (!client) return NOT_CONFIGURED

  const prices: SpotPrice[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from('spot_prices')
      .select('ts_start, ts_end, ct_per_kwh, price_basis')
      .eq('provider', SPOT_PRICE_PROVIDER)
      .gte('ts_start', periodStart)
      .lt('ts_start', periodEnd)
      .order('ts_start', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) return requestFailed(`Marktpreise konnten nicht gelesen werden: ${error.message}`)

    const page = data ?? []
    for (const row of page) {
      prices.push({
        tsStart: row.ts_start,
        tsEnd: row.ts_end,
        ctPerKwh: Number(row.ct_per_kwh),
        priceBasis: row.price_basis,
      })
    }
    if (page.length < PAGE_SIZE) break
  }

  const missingRanges = findMissingRanges(prices, periodStart, periodEnd)
  return { ok: true, prices, complete: missingRanges.length === 0, missingRanges }
}

/**
 * Wo fehlen Preise? Drei Arten von Lücke, alle drei zählen gleich:
 *   1. am Anfang  — der erste Preis beginnt nach `periodStart`
 *   2. in der Mitte — zwischen zwei Einträgen klafft mehr als die Dauer des ersten
 *   3. am Ende    — der letzte Preis endet vor `periodEnd`
 *
 * Die Prüfung misst gegen `ts_end` des jeweils vorigen Eintrags statt gegen ein angenommenes
 * Stundenraster. Damit bleibt sie richtig, wenn eine Quelle einmal viertelstündlich liefert — und
 * sie bleibt richtig über die Zeitumstellung hinweg, weil `timestamptz` in UTC verglichen wird und
 * eine UTC-Stunde immer eine Stunde ist (dieselbe Überlegung, aus der der Cron auf einer festen
 * UTC-Uhrzeit läuft, B21-2a).
 *
 * Exportiert, damit die Regel eine benannte Stelle hat und nicht in der Abfrage verschwindet.
 */
export function findMissingRanges(
  prices: SpotPrice[],
  periodStart: string,
  periodEnd: string,
): MissingRange[] {
  const startMs = Date.parse(periodStart)
  const endMs = Date.parse(periodEnd)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return []

  const gaps: MissingRange[] = []
  let coveredUntil = startMs

  for (const p of prices) {
    const from = Date.parse(p.tsStart)
    const to = Date.parse(p.tsEnd)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    if (from > coveredUntil) gaps.push({ fromIso: iso(coveredUntil), toIso: iso(from) })
    // `Math.max`, weil sich Einträge überlappen dürfen (eine feinere Quelle neben einer gröberen).
    // Ein Rückschritt würde sonst eine Lücke erfinden, die es nicht gibt.
    if (to > coveredUntil) coveredUntil = to
  }

  if (coveredUntil < endMs) gaps.push({ fromIso: iso(coveredUntil), toIso: iso(endMs) })
  return gaps
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * Das Analysefenster (Delta 15 Regel A, beide Grenzen inklusiv und auf den BEGINN einer
 * Viertelstunde bezogen) in den Preis-Abfragebereich übersetzen.
 *
 * Der Aufschlag um die Intervalldauer ist kein Detail: ohne ihn endete die Abfrage mit dem Beginn
 * der letzten Viertelstunde, und die Stunde, in der sie liegt, gälte als nicht abgedeckt — der
 * Vergleich wäre für jeden vollständigen Lastgang „nicht berechenbar".
 */
export function analysisWindowToPriceRange(
  window: { startIso: string; endIso: string },
  intervalMinutes: number,
): { from: string; to: string } {
  const to = Date.parse(window.endIso) + intervalMinutes * 60 * 1000
  return { from: window.startIso, to: iso(to) }
}

export { HOUR_MS }
