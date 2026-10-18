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
  /** Verwendete Leistungsgrenze je Viertelstunde (kW): `exportCapKw` oder der Fallback. */
  capKwUsed: number
  /** Einspeisung, die Nullbezug-Viertelstunden zugeordnet wurde. */
  assignedExportKwh: number
  /** Einspeisung ohne Viertelstunde mit Bezug = 0 in ihrer Stunde (oder ganz ohne Bezugsslots). */
  droppedExportKwh: number
  droppedExportHours: number
  /** Davon Stunden ganz ohne Bezugsslots (z. B. die fehlende Winterzeit-Doppelstunde). */
  exportHoursWithoutImport: number
  /** Einspeisung über der Leistungsgrenze der Nullbezug-Viertelstunden — verworfen. */
  cappedExportKwh: number
  cappedExportHours: number
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
 * Die Einspeisung einer Stunde geht gleichmäßig auf deren Viertelstunden mit Bezug = 0, je
 * Viertelstunde höchstens `exportCapKw`. Slots mit Bezug > 0 bleiben immer bitgleich — gemessener,
 * abgerechneter Bezug wird nie wegsaldiert. Was über der Grenze liegt oder keinen Nullslot findet,
 * wird verworfen und gemeldet. Geschnitten wird auf die gemeinsamen vollen Stunden beider Reihen.
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

  // Fallback: die größte Stunden-Einspeisung, als gleichmäßige Leistung über die Stunde (kWh / 1 h).
  let capKw = input.exportCapKw ?? 0
  if (!(capKw > 0)) for (const kwh of exportByHour.values()) capKw = Math.max(capKw, kwh)

  const empty: CombineImportWithHourlyExportResult = {
    netSigned15: [],
    diagnostics: {
      range: null,
      slots: 0,
      capKwUsed: capKw,
      assignedExportKwh: 0,
      droppedExportKwh: 0,
      droppedExportHours: 0,
      exportHoursWithoutImport: 0,
      cappedExportKwh: 0,
      cappedExportHours: 0,
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

  let assignedExportKwh = 0
  let droppedExportKwh = 0
  let droppedExportHours = 0
  let exportHoursWithoutImport = 0
  let cappedExportKwh = 0
  let cappedExportHours = 0
  let missingExportHours = 0

  for (const [hour, indices] of slotsByHour) {
    const kwh = exportByHour.get(hour)
    if (kwh === undefined) {
      missingExportHours++
      continue
    }
    if (kwh === 0) continue
    const zeroSlots = indices.filter((i) => inRange[i]!.kw === 0)
    if (zeroSlots.length === 0) {
      droppedExportKwh += kwh
      droppedExportHours++
      continue
    }
    const uncapped = kwh / (zeroSlots.length * SLOT_HOURS)
    if (uncapped <= capKw) {
      // Ungedeckelt exakt die bisherige Formel.
      for (const i of zeroSlots) values[i] = -uncapped
      assignedExportKwh += kwh
      continue
    }
    for (const i of zeroSlots) values[i] = -capKw
    const assigned = zeroSlots.length * SLOT_HOURS * capKw
    assignedExportKwh += assigned
    cappedExportKwh += kwh - assigned
    cappedExportHours++
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
    capKwUsed: capKw,
    assignedExportKwh,
    droppedExportKwh,
    droppedExportHours,
    exportHoursWithoutImport,
    cappedExportKwh,
    cappedExportHours,
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
