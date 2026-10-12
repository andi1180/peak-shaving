import { utcMsToLocalFields } from '../parser/datetime'
import { isAustrianPublicHoliday } from './holidays'

/**
 * Lastspanne bei Bestands-PV ohne Einspeise- und Erzeugungsdaten.
 *
 * Ein reiner Bezugs-Lastgang zeigt bei einer Anlage, die bereits eigenverbraucht wird, nicht die
 * Last, sondern Last minus PV-Eigenverbrauch: Bezug = max(0, Last − PV). Ist der Bezug ≈ 0, ist
 * die Last darin grundsätzlich unsichtbar. Das Modul schätzt sie deshalb nicht, sondern liefert je
 * Intervall eine Spanne:
 *  - Untergrenze = Bezug (die Last ist nie kleiner).
 *  - Obergrenze = Basisprofil der Last je Tagestyp (Werktag, Samstag, Sonn-/Feiertag) und
 *    15-min-Slot aus den Intervallen ohne PV-Einfluss, geklemmt auf [Bezug, Bezug + PV-Obergrenze];
 *    ein Slot ohne PV-freie Beobachtung hat kein Basisprofil, dort gilt Bezug + PV-Obergrenze.
 *  - PV-Obergrenze = kWp-Maximum × Hüllprofil je Fläche: je Intervall das Maximum über
 *    Ausrichtungskandidaten und Wetterjahre, vom Aufrufer geliefert. Gemessen gegen das
 *    Zehn-Jahres-Mittelprofil: s. `upperYieldKwhPerKwp`.
 *
 * Rein & deterministisch, kein I/O, nicht verdrahtet.
 */

export type DayType = 'workday' | 'saturday' | 'sunday_holiday'

export type PvArrayInput = {
  /** Angegebene Nennleistung (kWp) — nur für die Diagnose gegen einen Referenzertrag. */
  kwp: number
  /** Obergrenze der wirksamen Leistung (kWp). 0 heisst: keine Anlage. */
  kwpMax: number
  /**
   * Hüllprofil auf 1 kWp (kWh je Intervall, Zeitstempel wie der Bezug): je Intervall das Maximum
   * über die Ausrichtungskandidaten und die Wetterjahre 2014–2023. Mit dem Zehn-Jahres-Mittel der
   * angegebenen Ausrichtung lag die wahre Jahreslast in der Messung nicht sicher unter der
   * Obergrenze (Bericht zum PR).
   */
  upperYieldKwhPerKwp: readonly number[]
  /** Mittelprofil der angegebenen Ausrichtung auf 1 kWp — optional, nur für `referenceMonthlyYield`. */
  statedYieldKwhPerKwp?: readonly number[]
}

export type ReferenceMonthlyYield = {
  kwh: readonly number[]
  kwp: number
  sameOrientation: boolean
}

export type ReconstructionInput = {
  /** Bezug je 15 min (kWh), lückenlos; `null` markiert eine Lücke. */
  intervals: readonly { ts: string; kwh: number | null }[]
  timeZone: string
  /** Leer heisst: keine Anlage deklariert — dann ist die Spanne der Bezug selbst. */
  pvArrays: readonly PvArrayInput[]
  /** Nur Diagnose: Massstab gegen einen Referenzertrag, beeinflusst keine Zahl. */
  referenceMonthlyYield?: ReferenceMonthlyYield
}

export type ReconstructionStatus = 'ok' | 'insufficient_data'

export type ReconstructionReason =
  'data_gaps' | 'too_short' | 'invalid_pv_parameters' | 'yield_length_mismatch'

export type LoadSpan = {
  low: number
  high: number
  /** Mitte der Spanne, KEINE Schätzung der Last. */
  mid: number
}

export type ReconstructionSeries = {
  /** = Bezug. */
  loadLow: number[]
  loadHigh: number[]
  /** Mitte der Spanne je Intervall, KEINE Schätzung der Last. */
  loadMid: number[]
  /** PV-Obergrenze je Intervall (kWh). */
  pvUpper: number[]
}

export type ReconstructionDiagnostics = {
  /** Anteil der PV-Obergrenze in Intervallen mit Bezug ≈ 0 (dort ist die Last unsichtbar). */
  hiddenPvShare: number
  /** (Hoch − Tief) / Tief der Jahreslast. */
  relativeSpanWidth: number
  /** Referenzertrag / Modellertrag je kWp, je Monat (null ohne Ertrag) und Jahr. */
  referenceYieldRatio?: {
    byMonth: (number | null)[]
    year: number | null
    sameOrientation: boolean
  }
}

export type ReconstructionResult =
  | {
      status: 'ok'
      series: ReconstructionSeries
      /** Jahressummen der Last (kWh). */
      annualLoadKwh: LoadSpan
      annualBezugKwh: number
      /** PV-Eigenverbrauch Jahr (kWh) = Last − Bezug, als Spanne. */
      annualSelfConsumptionKwh: LoadSpan
      diagnostics: ReconstructionDiagnostics
    }
  | { status: 'insufficient_data'; reasons: ReconstructionReason[] }

/** Intervall ohne PV-Einfluss: PV-Obergrenze ≤ dieser Anteil ihres Jahresmaximums. */
export const PV_FREE_SHARE = 0.01
/** Mindestanzahl PV-freier Beobachtungen, damit ein Slot ein Basisprofil bekommt. */
export const MIN_BASE_SAMPLES = 8
/** Bezug „≈ 0“ (kWh je 15 min) — nur für die Diagnose `hiddenPvShare`. */
export const BEZUG_ZERO_KWH = 0.01
/** Mindestlänge: ein Kalenderjahr bis auf die Sommerzeit-Stunde. */
export const MIN_INTERVALS = 364 * 96

const INTERVAL_MS = 15 * 60 * 1000

export function dayTypeOf(f: {
  year: number
  month: number
  day: number
  weekday: number
}): DayType {
  if (f.weekday === 6 || isAustrianPublicHoliday(f.year, f.month, f.day)) return 'sunday_holiday'
  return f.weekday === 5 ? 'saturday' : 'workday'
}

const DAY_TYPE_INDEX: Record<DayType, number> = { workday: 0, saturday: 1, sunday_holiday: 2 }

type Prepared = { bezug: number[]; group: Int32Array; month: Int8Array }

function prepare(input: ReconstructionInput): Prepared | ReconstructionReason {
  const n = input.intervals.length
  if (n < MIN_INTERVALS) return 'too_short'
  const bezug = new Array<number>(n)
  const group = new Int32Array(n)
  const month = new Int8Array(n)
  let prevMs = Number.NaN
  for (let i = 0; i < n; i++) {
    const { ts, kwh } = input.intervals[i]!
    const ms = Date.parse(ts)
    if (kwh === null || !Number.isFinite(kwh) || kwh < 0 || !Number.isFinite(ms)) return 'data_gaps'
    if (i > 0 && ms - prevMs !== INTERVAL_MS) return 'data_gaps'
    prevMs = ms
    const f = utcMsToLocalFields(ms, input.timeZone)
    bezug[i] = kwh
    group[i] = DAY_TYPE_INDEX[dayTypeOf(f)] * 96 + f.hour * 4 + Math.floor(f.minute / 15)
    month[i] = f.month - 1
  }
  return { bezug, group, month }
}

const sumOf = (values: ArrayLike<number>): number => {
  let s = 0
  for (let i = 0; i < values.length; i++) s += values[i]!
  return s
}

/** Basisprofil je Tagestyp × Slot aus PV-freien Intervallen; `NaN`, wo es keins gibt. */
function baseProfile(p: Prepared, pvFree: readonly boolean[]): Float64Array {
  const sum = new Float64Array(3 * 96)
  const count = new Int32Array(3 * 96)
  for (let i = 0; i < p.bezug.length; i++) {
    if (!pvFree[i]) continue
    sum[p.group[i]!]! += p.bezug[i]!
    count[p.group[i]!]! += 1
  }
  const base = new Float64Array(3 * 96)
  for (let g = 0; g < base.length; g++) {
    base[g] = count[g]! >= MIN_BASE_SAMPLES ? sum[g]! / count[g]! : Number.NaN
  }
  return base
}

function referenceRatio(
  ref: ReferenceMonthlyYield,
  p: Prepared,
  arrays: readonly PvArrayInput[],
): ReconstructionDiagnostics['referenceYieldRatio'] {
  const statedKwp = arrays.reduce((s, a) => s + a.kwp, 0)
  if (statedKwp <= 0 || arrays.some((a) => !a.statedYieldKwhPerKwp)) return undefined
  const model = new Array<number>(12).fill(0)
  for (const a of arrays) {
    const y = a.statedYieldKwhPerKwp!
    for (let i = 0; i < p.bezug.length; i++) model[p.month[i]!]! += (a.kwp * y[i]!) / statedKwp
  }
  const refPerKwp = ref.kwh.map((k) => k / ref.kwp)
  const modelYear = sumOf(model)
  return {
    byMonth: model.map((m, k) => (m > 0 ? refPerKwp[k]! / m : null)),
    year: modelYear > 0 ? sumOf(refPerKwp) / modelYear : null,
    sameOrientation: ref.sameOrientation,
  }
}

const insufficient = (reason: ReconstructionReason): ReconstructionResult => ({
  status: 'insufficient_data',
  reasons: [reason],
})

export function reconstructLoad(input: ReconstructionInput): ReconstructionResult {
  const arrays = input.pvArrays
  const n = input.intervals.length
  const valid = (a: PvArrayInput) => a.kwp >= 0 && a.kwpMax >= 0 && Number.isFinite(a.kwpMax)
  if (!arrays.every(valid)) return insufficient('invalid_pv_parameters')
  const lengthsOk = arrays.every(
    (a) =>
      a.upperYieldKwhPerKwp.length === n &&
      (a.statedYieldKwhPerKwp === undefined || a.statedYieldKwhPerKwp.length === n),
  )
  if (!lengthsOk) return insufficient('yield_length_mismatch')
  const prepared = prepare(input)
  if (typeof prepared === 'string') return insufficient(prepared)
  const p = prepared
  const annualBezug = sumOf(p.bezug)

  const pvUpper = new Array<number>(n).fill(0)
  for (const a of arrays) {
    if (a.kwpMax === 0) continue
    for (let i = 0; i < n; i++) pvUpper[i]! += a.kwpMax * a.upperYieldKwhPerKwp[i]!
  }

  let loadHigh: number[]
  if (arrays.every((a) => a.kwpMax === 0)) {
    // Keine Anlage deklariert: die Spanne ist der Bezug selbst.
    loadHigh = [...p.bezug]
  } else {
    let pvMax = 0
    for (const v of pvUpper) pvMax = Math.max(pvMax, v)
    const base = baseProfile(
      p,
      pvUpper.map((v) => v <= PV_FREE_SHARE * pvMax),
    )
    loadHigh = p.bezug.map((b, i) => {
      const upper = b + pvUpper[i]!
      const value = base[p.group[i]!]!
      return Number.isNaN(value) ? upper : Math.min(upper, Math.max(b, value))
    })
  }
  const loadLow = [...p.bezug]
  const loadMid = loadLow.map((low, i) => (low + loadHigh[i]!) / 2)

  const high = sumOf(loadHigh)
  let pvTotal = 0
  let pvHidden = 0
  for (let i = 0; i < n; i++) {
    pvTotal += pvUpper[i]!
    if (p.bezug[i]! <= BEZUG_ZERO_KWH) pvHidden += pvUpper[i]!
  }
  const reference = input.referenceMonthlyYield
    ? referenceRatio(input.referenceMonthlyYield, p, arrays)
    : undefined

  return {
    status: 'ok',
    series: { loadLow, loadHigh, loadMid, pvUpper },
    annualLoadKwh: { low: annualBezug, high, mid: (annualBezug + high) / 2 },
    annualBezugKwh: annualBezug,
    annualSelfConsumptionKwh: { low: 0, high: high - annualBezug, mid: (high - annualBezug) / 2 },
    diagnostics: {
      hiddenPvShare: pvTotal > 0 ? pvHidden / pvTotal : 0,
      relativeSpanWidth: annualBezug > 0 ? (high - annualBezug) / annualBezug : 0,
      ...(reference ? { referenceYieldRatio: reference } : {}),
    },
  }
}
