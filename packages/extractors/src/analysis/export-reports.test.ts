import { describe, expect, it, vi } from 'vitest'
import { IMPORT_ONLY_WITHOUT_PV_WARNING, parseLoadProfile, utcMsToLocalFields } from 'engine'
import { DEMO_BATTERY_CATALOG } from 'shared/fixtures'

import {
  combineLoadWithExportReports,
  EXPORT_REPORTS_COMBINED_WARNING_PREFIX,
  EXPORT_REPORTS_UNUSED_WARNING_PREFIX,
} from './export-reports'

vi.mock('server-only', () => ({}))
const { runAnalysisFromMeteringPointDraft } = await import('./run-from-draft')

const DAYS = ['2025-03-31', '2025-04-01']

/** Bezug je Viertelstunde (kW): 10–13 Uhr 0, 14 Uhr zur Hälfte 0, sonst 10 + Stunde. */
function bezugKw(hour: number, quarter: number): number {
  if (hour >= 10 && hour < 14) return 0
  if (hour === 14) return quarter < 2 ? 0 : 6
  return 10 + hour
}

/** Zwei Tage synthetischer 15-min-Lastgang (Ortszeit); `signed` legt Einspeisung über Mittag. */
function loadCsv(signed = false): string {
  const rows = ['Zeitstempel;Bezug (kW)']
  for (const date of DAYS) {
    for (let h = 0; h < 24; h++) {
      for (let q = 0; q < 4; q++) {
        const kw = signed && h === 12 ? -5 : bezugKw(h, q)
        rows.push(`${date}T${String(h).padStart(2, '0')}:${String(q * 15).padStart(2, '0')};${kw}`)
      }
    }
  }
  return rows.join('\n')
}

/** Einspeisung je Stunde (kWh): Mittag 4, 14 Uhr 2, 8 Uhr 1 (ohne Nullbezug → gegen Bezug saldiert). */
function einspeisungKwh(hour: number): number {
  if (hour >= 10 && hour < 14) return 4
  if (hour === 14) return 2
  if (hour === 8) return 1
  return 0
}

/** Stündlicher Anlagenbericht; `shiftHours` verschiebt die Zeitspalte gegen den Lastgang. */
function reportCsv(date: string, hours: number[], shiftHours = 0): string {
  const rows = ['Statistischer Zeitraum,Netzeinspeisung (kWh),Netzbezug (kWh)']
  for (const h of hours) {
    const bezug = [0, 1, 2, 3].reduce((sum, q) => sum + bezugKw(h, q) * 0.25, 0)
    const at = `${date} ${String(h + shiftHours).padStart(2, '0')}:00:00`
    rows.push(`${at},${einspeisungKwh(h)},${bezug}`)
  }
  return rows.join('\n')
}

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i)

function file(content: string, filename: string) {
  return { bytes: new TextEncoder().encode(content).buffer as ArrayBuffer, filename }
}

const STORED = {
  _exportReports: {
    documents: [
      { documentId: 'rep-03', filename: 'bericht-2025-03.csv' },
      { documentId: 'rep-04', filename: 'bericht-2025-04.csv' },
    ],
    summary: {
      from: '2025-03-30T22:00:00.000Z',
      to: '2025-04-01T10:00:00.000Z',
      hours: 36,
      missingHours: 0,
      duplicateHours: 0,
      ambiguousHours: 0,
      skippedRows: 0,
      exportKwh: 0,
      importKwh: 0,
    },
  },
}

function parsed(signed = false) {
  const outcome = parseLoadProfile({ content: loadCsv(signed), fileName: 'lastgang.csv' })
  if (!outcome.ok) throw new Error('Fixture nicht lesbar')
  return outcome
}

function reader(shiftHours = 0) {
  return async (id: string) =>
    id === 'rep-03'
      ? file(reportCsv('2025-03-31', range(0, 24), shiftHours), 'bericht-2025-03.csv')
      : id === 'rep-04'
        ? file(reportCsv('2025-04-01', range(0, 12), shiftHours), 'bericht-2025-04.csv')
        : null
}

describe('combineLoadWithExportReports', () => {
  it('import_only + zwei Monatsberichte → signierte Netzlast auf der Überlappung', async () => {
    const input = parsed()
    expect(input.profile.source).toBe('import_only')
    const out = await combineLoadWithExportReports(STORED, input, reader())

    expect(out.profile.source).toBe('net_signed')
    // Überlappung 31.03. 00:00 bis 01.04. 12:00 Ortszeit = 36 Stunden.
    expect(out.profile.readings).toHaveLength(144)
    expect(out.profile.readings[0]!.ts).toBe('2025-03-30T22:00:00.000Z')
    expect(out.profile.readings.at(-1)!.ts).toBe('2025-04-01T09:45:00.000Z')

    // 8 Uhr hat keinen Nullbezug: 1 kWh wird gegen den Bezug (18 kW) saldiert, sonst bitgleich.
    const byTs = new Map(input.profile.readings.map((r) => [r.ts, r.gridPowerKw]))
    for (const r of out.profile.readings) {
      const hour = utcMsToLocalFields(Date.parse(r.ts), 'Europe/Vienna').hour
      if (r.gridPowerKw > 0) expect(r.gridPowerKw).toBe(byTs.get(r.ts)! - (hour === 8 ? 1 : 0))
    }

    // Exportiert im Überlappungsfenster: 31.03. 19 kWh + 01.04. bis 12 Uhr (8 und 10–11 Uhr) 9 kWh.
    const deltaKwh = out.profile.readings.reduce((s, r) => s + byTs.get(r.ts)! - r.gridPowerKw, 0)
    expect(deltaKwh * 0.25).toBeCloseTo(28, 9)

    const w = out.dataQuality.warnings
    expect(w).not.toContain(IMPORT_ONLY_WITHOUT_PV_WARNING)
    expect(w).toContain(
      `${EXPORT_REPORTS_COMBINED_WARNING_PREFIX} 28 kWh, Zeitraum 31.03.2025–01.04.2025 (Überlappung mit dem Lastgang).`,
    )
    expect(w.some((x) => x.includes('nicht zugeordnet'))).toBe(false)
    expect(w.some((x) => x.startsWith('Zeitabgleich'))).toBe(false)
    expect(out.dataQuality.coveredMonths).toBe(2)
  })

  it('Leistungsgrenze aus den Modulflächen: zu klein → Überlauf ohne Grenze verteilt und gemeldet', async () => {
    const input = parsed()
    const draft = { ...STORED, _pvArrays: [{ peakPowerKwp: 2 }, { peakPowerKwp: 1 }] }
    const out = await combineLoadWithExportReports(draft, input, reader())

    // Mittag 4 kWh auf vier Nullslots bei 3 kW: 1 kWh je Stunde darüber, 10–13 Uhr 31.03. und 10–11 Uhr 01.04.
    expect(Math.min(...out.profile.readings.map((r) => r.gridPowerKw))).toBe(-4)
    expect(out.dataQuality.warnings).toContain(
      '6 kWh Einspeisung in 6 Stunden über der Leistungsgrenze verteilt – bitte prüfen.',
    )
  })

  it('ignoriert die Berichte bei einem Lastgang mit Einspeisung — Profil bitgleich', async () => {
    const input = parsed(true)
    expect(input.profile.source).not.toBe('import_only')
    const out = await combineLoadWithExportReports(STORED, input, reader())

    expect(out.profile).toBe(input.profile)
    expect(out.dataQuality.warnings).toContain(
      `${EXPORT_REPORTS_UNUSED_WARNING_PREFIX} Lastgang enthält bereits Einspeisung.`,
    )
  })

  it('warnt bei Versatz +1 h, verschiebt aber nichts', async () => {
    const input = parsed()
    const out = await combineLoadWithExportReports(STORED, input, reader(1))

    expect(
      out.dataQuality.warnings.some((w) =>
        w.startsWith('Zeitabgleich Anlagenbericht/Lastgang auffällig (bester Versatz'),
      ),
    ).toBe(true)
    const inputTs = new Set(input.profile.readings.map((r) => r.ts))
    expect(out.profile.readings.every((r) => inputTs.has(r.ts))).toBe(true)
  })

  it('rechnet bei unlesbarem Bericht ohne Kombination weiter und nennt die Datei', async () => {
    const input = parsed()
    const out = await combineLoadWithExportReports(STORED, input, async (id) =>
      id === 'rep-03' ? file('kein Bericht', 'bericht-2025-03.csv') : reader()(id),
    )

    expect(out.profile).toBe(input.profile)
    expect(out.dataQuality.warnings.some((w) => w.includes('„bericht-2025-03.csv“'))).toBe(true)
  })
})

describe('runAnalysisFromMeteringPointDraft — Anlagenberichte', () => {
  it('rechnet den kombinierten, signierten Lastgang', async () => {
    const draft = {
      netzebene: 'NE 7',
      meteringVariant: 'mit_leistungsmessung',
      leistungspreisEurPerKwYear: 82.92,
      minBillableKw: 0,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 7.2,
      netzbetreiber: 'wiener_netze',
      ...STORED,
    }
    const read = reader()
    const run = await runAnalysisFromMeteringPointDraft('mp-1', {
      batteryCatalog: DEMO_BATTERY_CATALOG,
      readMeteringPoint: async () => ({ draft, sourceDocumentId: 'doc-1' }),
      readDocument: async (id) => (id === 'doc-1' ? file(loadCsv(), 'lastgang.csv') : read(id)),
    })

    expect(run.loadProfile.source).toBe('net_signed')
    expect(run.loadProfile.readings).toHaveLength(144)
    expect(
      run.result.dataQuality.warnings.some((w) =>
        w.startsWith(EXPORT_REPORTS_COMBINED_WARNING_PREFIX),
      ),
    ).toBe(true)
  })
})
