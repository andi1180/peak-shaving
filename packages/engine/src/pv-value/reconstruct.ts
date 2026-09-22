import type { LoadProfile, PvProfile, PvValueMonth } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'

/**
 * DIE REKONSTRUKTION „OHNE PV" — `Bruttoverbrauch(t) = Netzbezug(t) + Erzeugung(t)`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE GEGENRICHTUNG ZU `applyEstimatedPv`, UND SIE IST VON DESSEN SPERRE NICHT BETROFFEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `pvGeneratorEligibility` verbietet den ABZUG einer geschätzten Erzeugung, wenn die Anlage bereits
 * im Lastgang steckt (`pv_already_in_grid_profile`) — sonst zählte man dieselbe Energie zweimal
 * ab. Hier wird ADDIERT, und genau dafür ist der Fall gemacht: was im gesenkten Bezug steckt, wird
 * zurückgelegt, um den Zustand ohne Anlage zu bilden. Die Sperre dort und dieses Modul beschreiben
 * dieselbe Tatsache aus zwei Richtungen; keines von beiden darf das andere aufheben.
 *
 * ── ⚠ DIE GESAMTE ERZEUGUNG GILT ALS EIGENVERBRAUCH ───────────────────────────────────────────
 * Bewusst KEIN `min(Erzeugung, Last)`: ohne Exportdaten wäre die Aufteilung eine zweite Schätzung
 * über der ersten, und ihr Ergebnis sähe genauer aus, als die Datenlage hergibt. Die Richtung des
 * Fehlers ist bekannt und wird im Report ausgeschrieben — tatsächliche Netzeinspeisung korrigierte
 * die Differenz leicht nach unten. S. Kopf von `shared/src/pv-value.ts`.
 *
 * ── ⚠ DIESES MODUL RECHNET KEINE KOSTEN ───────────────────────────────────────────────────────
 * Es baut eine EINGABE. Bewertet werden beide Lastgänge anschliessend mit derselben
 * Tarifkosten-Funktion, mit der auch „Ihr Tarif heute" entsteht (`buildMonthlyTariffComparison`).
 * Eine eigene Kostenformel hier liefe beim nächsten Abgaben-Ausbau von ihr weg, und die
 * ausgewiesene Differenz enthielte einen Anteil, der gar nichts mit der PV-Anlage zu tun hat.
 */

/** Ein Kalendermonat in Ortszeit — die Form, in der `detectPvOutageMonths` seine Treffer meldet. */
export type PvMonthRef = { year: number; month: number }

const monthKey = (year: number, month: number): string => `${year}-${month}`

/**
 * Die Erzeugung in den AUSFALLMONATEN auf 0 setzen.
 *
 * ⚠ ES IST DER ERSTE SCHRITT UND NICHT EINE KORREKTUR HINTERHER. Alles Weitere — die Addition, die
 * Monatssummen, die Verlängerung ins synthetische Jahr — liest ausschliesslich die so bereinigte
 * Reihe. Wäre die Nullung eine Sonderbehandlung an jeder einzelnen dieser Stellen, genügte ein
 * vergessener Ort, damit die Rekonstruktion in genau den Monaten einen Ertrag unterstellt, in
 * denen der Lastgang beweist, dass keiner stattfand.
 *
 * ⚠ Die Zeitstempel bleiben VERBATIM erhalten (dieselben Zeichenketten): sie sind der Schlüssel,
 * über den die Zuordnung zum Lastgang läuft — dieselbe Zusage wie in `applyEstimatedPv`.
 */
export function zeroPvOutageMonths(
  pv: PvProfile,
  outageMonths: readonly PvMonthRef[],
  timeZone: string,
): PvProfile {
  if (outageMonths.length === 0) return pv

  const blocked = new Set(outageMonths.map((m) => monthKey(m.year, m.month)))
  return {
    readings: pv.readings.map((reading) => {
      const { year, month } = utcMsToLocalFields(Date.parse(reading.ts), timeZone)
      return blocked.has(monthKey(year, month))
        ? { ts: reading.ts, pvGenerationKw: 0 }
        : reading
    }),
  }
}

/**
 * Der rekonstruierte Lastgang OHNE PV — Netzbezug plus angesetzte Erzeugung, Intervall für
 * Intervall.
 *
 * ⚠ ZUGEORDNET WIRD ÜBER DEN ZEITSTEMPEL, NICHT ÜBER DIE POSITION. Die Erzeugungsreihe kann über
 * die Verlängerung ins synthetische Jahr eine andere Länge haben als der Lastgang (`extendPv`
 * füllt einen Tag ohne Referenzwerte gar nicht); positionsweise aufaddiert ergäbe das eine um
 * Stunden verschobene Erzeugung, die nirgends auffiele.
 *
 * ⚠ `source` UND `pvSource` BLEIBEN UNVERÄNDERT — dieselbe Überlegung wie in `applyEstimatedPv`:
 * sie beschreiben, wie der Lastgang zustande kam, und daran ändert eine Rekonstruktion nichts. Ihn
 * als `estimated_pv` zu etikettieren setzte ausserdem den Spitzenkappungs-Blocker, und dieser
 * Lastgang wird ohnehin nie durch `computeAnalysis` geschickt.
 */
export function addPvToGridDraw(load: LoadProfile, pv: PvProfile): LoadProfile {
  const byTs = new Map(pv.readings.map((r) => [r.ts, r.pvGenerationKw]))
  return {
    ...load,
    readings: load.readings.map((reading) => ({
      ts: reading.ts,
      gridPowerKw: reading.gridPowerKw + (byTs.get(reading.ts) ?? 0),
    })),
  }
}

/**
 * Die angesetzte Erzeugung je Kalendermonat, chronologisch — die Balken des PV-Kapitels.
 *
 * Gezählt werden die Monate des LASTGANGS und nicht die der Erzeugungsreihe: ein Monat ohne
 * Messwerte ist kein Monat dieser Auswertung, auch wenn PVGIS für ihn eine Kurve hätte.
 *
 * ⚠ EIN AUSFALLMONAT BEKOMMT `null` UND KEINE 0. Beide sähen in einem Balkendiagramm gleich aus,
 * sagen aber Verschiedenes: `null` heisst „hier wurde bewusst nichts angesetzt, weil der Lastgang
 * keinen Einbruch zeigt", 0 hiesse „geschätzt, und es kam nichts heraus". Dieselbe Unterscheidung
 * wie zwischen leerer und auf 0 stehender Zelle im Monatsvergleich.
 */
export function monthlyPvGeneration(
  load: LoadProfile,
  pv: PvProfile,
  outageMonths: readonly PvMonthRef[],
): PvValueMonth[] {
  const tz = load.timezoneMeta
  const deltaHours = load.intervalMinutes / 60
  const blocked = new Set(outageMonths.map((m) => monthKey(m.year, m.month)))
  const byTs = new Map(pv.readings.map((r) => [r.ts, r.pvGenerationKw]))

  const tallies = new Map<string, { year: number; month: number; kwh: number }>()
  for (const reading of load.readings) {
    const ms = Date.parse(reading.ts)
    if (!Number.isFinite(ms)) continue
    const { year, month } = utcMsToLocalFields(ms, tz)
    const key = monthKey(year, month)
    const tally = tallies.get(key) ?? { year, month, kwh: 0 }
    tally.kwh += (byTs.get(reading.ts) ?? 0) * deltaHours
    tallies.set(key, tally)
  }

  return [...tallies.values()]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((tally) => {
      const outage = blocked.has(monthKey(tally.year, tally.month))
      return {
        year: tally.year,
        month: tally.month,
        selfConsumptionKwh: outage ? null : tally.kwh,
        outage,
      }
    })
}
