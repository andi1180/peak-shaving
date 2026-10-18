import type { LoadProfile, LoadReading } from 'shared'

import { toIsoUtc, utcMsToLocalFields } from './datetime'

const SLOT_MS = 15 * 60 * 1000
const MS_PER_HOUR = 60 * 60 * 1000
const SLOT_HOURS = 0.25

/** Ein Stundenwert in kWh; `ts` = Beginn der Ortszeit-Stunde als UTC-Instant (ISO). */
export type HourlyEnergyReading = { ts: string; kwh: number }

export type CombineImportWithHourlyExportInput = {
  /** Gemessener Netzbezug, 15 min, kW ≥ 0 (aufbereitet wie aus `parseLoadProfile`). */
  import15: Pick<LoadProfile, 'readings' | 'timezoneMeta'>
  /** Netzeinspeisung je Stunde, kWh ≥ 0. */
  exportHourly: readonly HourlyEnergyReading[]
  /** Netzbezug je Stunde aus derselben Quelle wie die Einspeisung — nur Gegenprobe. */
  importHourly?: readonly HourlyEnergyReading[]
  /** Größte Einspeiseleistung je Viertelstunde (kW), z. B. die Nennleistung der Anlage. Fehlt sie
   *  oder ist sie ≤ 0, gilt die größte Stunden-Einspeisung der Reihe (kWh / 1 h). */
  exportCapKw?: number
}

export type HourOffset = -1 | 0 | 1

export type ImportCheck = {
  /** Verglichene Stunden: volle vier Bezugsslots und ein Bezugswert bei allen drei Versätzen. */
  hours: number
  /** Größte Abweichung je Stunde ohne Versatz. */
  maxAbsDeviationKwh: number
  bestOffsetHours: HourOffset
  /** Summe der absoluten Abweichungen je Versatz. */
  deviationAtOffsetKwh: Record<HourOffset, number>
}

export type CombineDiagnostics = {
  /** Überlappung beider Reihen, auf volle Stunden geschnitten; `null` ohne Überlappung. */
  range: { from: string; to: string } | null
  slots: number
  /** Einspeisung, die einer Viertelstunde zugeordnet wurde (auch saldiert gegen Bezug). */
  assignedExportKwh: number
  /** Einspeisung in Stunden ganz ohne Bezugsslots — verworfen. */
  droppedExportKwh: number
  droppedExportHours: number
  /** Stunden ganz ohne Bezugsslots (z. B. die fehlende Winterzeit-Doppelstunde). */
  exportHoursWithoutImport: number
  /** Einspeisung, die selbst saldiert die Leistungsgrenze überschritt und ohne Grenze verteilt wurde. */
  overCapExportKwh: number
  overCapExportHours: number
  /** Stunden mit Bezug, aber ohne Einspeisungswert — dort ist die Einspeisung 0. */
  missingExportHours: number
  importCheck?: ImportCheck
}

export type CombineImportWithHourlyExportResult = {
  /** Signierte Netzlast, 15 min, kW: Bezug positiv, Einspeisung negativ. */
  netSigned15: LoadReading[]
  diagnostics: CombineDiagnostics
}

/** Beginn der Ortszeit-Stunde eines Instants, als UTC-ms (eindeutig auch in der Doppelstunde). */
function localHourStartMs(ms: number, timeZone: string): number {
  const { minute } = utcMsToLocalFields(ms, timeZone)
  const withinMinute = ((ms % 60_000) + 60_000) % 60_000
  return ms - minute * 60_000 - withinMinute
}

function hourlyMap(readings: readonly HourlyEnergyReading[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const r of readings) {
    const ms = Date.parse(r.ts)
    if (Number.isFinite(ms) && Number.isFinite(r.kwh) && r.kwh >= 0 && !map.has(ms))
      map.set(ms, r.kwh)
  }
  return map
}

/**
 * Gemessener 15-min-Netzbezug + stündliche Einspeisung → signierte 15-min-Netzlast.
 *
 * Die Einspeisung einer Stunde geht bevorzugt gleichmäßig auf deren Viertelstunden mit Bezug = 0
 * (saldiert gegen gemessenen Bezug senkte sie Spitzen und Leistungspreis), je Viertelstunde aber
 * höchstens bis `exportCapKw`; der Überlauf wird gegen die übrigen Viertelstunden der Stunde
 * saldiert. Die Energie je Stunde bleibt erhalten; ohne Überlauf bleiben Slots mit Bezug > 0
 * bitgleich. Geschnitten wird auf die gemeinsamen vollen Stunden beider Reihen.
 */
export function combineImportWithHourlyExport(
  input: CombineImportWithHourlyExportInput,
): CombineImportWithHourlyExportResult {
  const timeZone = input.import15.timezoneMeta
  const exportByHour = hourlyMap(input.exportHourly)
  const slots = input.import15.readings
    .map((r) => ({ ms: Date.parse(r.ts), kw: r.gridPowerKw }))
    .sort((a, b) => a.ms - b.ms)
  for (const s of slots) {
    if (!Number.isFinite(s.ms) || !Number.isFinite(s.kw) || s.kw < 0) {
      throw new RangeError(
        'combineImportWithHourlyExport: import15 erwartet endliche Bezugswerte ≥ 0.',
      )
    }
  }

  const empty: CombineImportWithHourlyExportResult = {
    netSigned15: [],
    diagnostics: {
      range: null,
      slots: 0,
      assignedExportKwh: 0,
      droppedExportKwh: 0,
      droppedExportHours: 0,
      exportHoursWithoutImport: 0,
      overCapExportKwh: 0,
      overCapExportHours: 0,
      missingExportHours: 0,
    },
  }
  const exportHours = [...exportByHour.keys()].sort((a, b) => a - b)
  if (slots.length === 0 || exportHours.length === 0) return empty

  const rawFrom = Math.max(slots[0]!.ms, exportHours[0]!)
  const rawTo = Math.min(
    slots[slots.length - 1]!.ms + SLOT_MS,
    exportHours[exportHours.length - 1]! + MS_PER_HOUR,
  )
  const fromHour = localHourStartMs(rawFrom, timeZone)
  const from = fromHour === rawFrom ? rawFrom : fromHour + MS_PER_HOUR
  const to = localHourStartMs(rawTo, timeZone)
  if (to <= from) return empty

  const inRange = slots.filter((s) => s.ms >= from && s.ms + SLOT_MS <= to)
  const values = inRange.map((s) => s.kw)
  const slotsByHour = new Map<number, number[]>()
  inRange.forEach((s, i) => {
    const hour = localHourStartMs(s.ms, timeZone)
    const list = slotsByHour.get(hour)
    if (list) list.push(i)
    else slotsByHour.set(hour, [i])
  })

  // Fallback: die größte Stunden-Einspeisung, als gleichmäßige Leistung über die Stunde (kWh / 1 h).
  let capKw = input.exportCapKw ?? 0
  if (!(capKw > 0)) for (const kwh of exportByHour.values()) capKw = Math.max(capKw, kwh)
  let assignedExportKwh = 0
  let droppedExportKwh = 0
  let droppedExportHours = 0
  let exportHoursWithoutImport = 0
  let overCapExportKwh = 0
  let overCapExportHours = 0
  let missingExportHours = 0

  for (const [hour, indices] of slotsByHour) {
    const kwh = exportByHour.get(hour)
    if (kwh === undefined) {
      missingExportHours++
      continue
    }
    if (kwh === 0) continue
    assignedExportKwh += kwh
    const rest = distributeHour(kwh, indices, values, capKw)
    if (rest > 0) {
      overCapExportKwh += rest
      overCapExportHours++
    }
  }
  for (const hour of exportHours) {
    if (hour < from || hour >= to || slotsByHour.has(hour)) continue
    const kwh = exportByHour.get(hour)!
    if (kwh > 0) {
      droppedExportKwh += kwh
      droppedExportHours++
      exportHoursWithoutImport++
    }
  }

  const diagnostics: CombineDiagnostics = {
    range: { from: toIsoUtc(from), to: toIsoUtc(to) },
    slots: inRange.length,
    assignedExportKwh,
    droppedExportKwh,
    droppedExportHours,
    exportHoursWithoutImport,
    overCapExportKwh,
    overCapExportHours,
    missingExportHours,
  }
  if (input.importHourly) {
    diagnostics.importCheck = checkImport(inRange, slotsByHour, hourlyMap(input.importHourly))
  }

  return {
    netSigned15: inRange.map((s, i) => ({ ts: toIsoUtc(s.ms), gridPowerKw: values[i]! })),
    diagnostics,
  }
}

/** Unterhalb davon gilt Restenergie als verteilt (Rundungsrest). */
const REST_EPSILON_KWH = 1e-12

/**
 * Verteilt `kwh` Einspeisung auf die Slots einer Stunde (in `values`, in place): zuerst auf die
 * Nullslots bis `capKw`, dann gegen die Bezugsslots bis −`capKw`, zuletzt ohne Grenze auf alle.
 * Gibt die Energie zurück, die erst im letzten Schritt unterkam (0 im Normalfall).
 */
function distributeHour(kwh: number, indices: readonly number[], values: number[], capKw: number) {
  const zeroSlots = indices.filter((i) => values[i] === 0)
  const loadSlots = indices.filter((i) => values[i]! > 0)

  let rest = kwh
  if (zeroSlots.length > 0) {
    const uncapped = kwh / (zeroSlots.length * SLOT_HOURS)
    // Ungedeckelt exakt die bisherige Formel, und kein Rest — die Bezugsslots bleiben bitgleich.
    const kw = Math.min(uncapped, capKw)
    for (const i of zeroSlots) values[i] = -kw
    rest = uncapped <= capKw ? 0 : kwh - zeroSlots.length * SLOT_HOURS * capKw
  }

  let open = loadSlots
  while (rest > REST_EPSILON_KWH && open.length > 0) {
    const shareKw = rest / (open.length * SLOT_HOURS)
    const stillOpen: number[] = []
    for (const i of open) {
      const roomKw = values[i]! + capKw
      if (roomKw <= shareKw) {
        values[i] = -capKw
        rest -= roomKw * SLOT_HOURS
      } else {
        values[i] = values[i]! - shareKw
        stillOpen.push(i)
      }
    }
    // Keiner an der Grenze: alle haben den vollen Anteil bekommen, der Rest ist verteilt.
    if (stillOpen.length === open.length) rest = 0
    else rest -= stillOpen.length * shareKw * SLOT_HOURS
    open = stillOpen
  }

  if (rest <= REST_EPSILON_KWH) return 0
  const kw = rest / (indices.length * SLOT_HOURS)
  for (const i of indices) values[i] = values[i]! - kw
  return rest
}

/** Gegenprobe ohne Verschiebung: gemessener Bezug je Stunde gegen den Stundenbezug bei −1/0/+1 h. */
function checkImport(
  slots: readonly { ms: number; kw: number }[],
  slotsByHour: ReadonlyMap<number, number[]>,
  importByHour: ReadonlyMap<number, number>,
): ImportCheck {
  const offsets: HourOffset[] = [-1, 0, 1]
  const deviationAtOffsetKwh: Record<HourOffset, number> = { [-1]: 0, 0: 0, 1: 0 }
  let hours = 0
  let maxAbsDeviationKwh = 0
  for (const [hour, indices] of slotsByHour) {
    if (indices.length !== 4) continue
    const reported = offsets.map((o) => importByHour.get(hour + o * MS_PER_HOUR))
    if (reported.some((v) => v === undefined)) continue
    const measured = indices.reduce((sum, i) => sum + slots[i]!.kw * SLOT_HOURS, 0)
    hours++
    offsets.forEach((o, k) => {
      const deviation = Math.abs(reported[k]! - measured)
      deviationAtOffsetKwh[o] += deviation
      if (o === 0) maxAbsDeviationKwh = Math.max(maxAbsDeviationKwh, deviation)
    })
  }
  const bestOffsetHours = offsets.reduce(
    (best, o) => (deviationAtOffsetKwh[o] < deviationAtOffsetKwh[best] ? o : best),
    0 as HourOffset,
  )
  return { hours, maxAbsDeviationKwh, bestOffsetHours, deviationAtOffsetKwh }
}
