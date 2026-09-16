import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY } from 'shared'

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))

const {
  MeteringPointAnalysisError,
  runAnalysisFromMeteringPointDraft,
} = await import('./run-from-draft')
type Ports = Parameters<typeof runAnalysisFromMeteringPointDraft>[1]

const DRAFT: Record<string, unknown> = {
  netzebene: 'NE 7',
  meteringVariant: 'mit_leistungsmessung',
  leistungspreisEurPerKwYear: 82.92,
  minBillableKw: 0,
  energyPriceCtPerKwh: 24.5,
  einspeiseverguetungCtPerKwh: 7.2,
  netzbetreiber: 'wiener_netze',
}

/** Dieselben 96 Viertelstunden als PV-Erzeugungsreihe — eine Wertspalte, Mittagsglocke. */
function pvProfileCsv(): string {
  const rows: string[] = ['Zeitstempel;Erzeugung (kW)']
  for (let i = 0; i < 96; i += 1) {
    const at = new Date(Date.UTC(2025, 2, 17, 0, 0) + i * 15 * 60_000)
    const hour = at.getUTCHours()
    const kw = hour >= 9 && hour < 16 ? 12 : hour >= 7 && hour < 19 ? 3 : 0
    rows.push(`${at.toISOString().slice(0, 16)};${String(kw).replace('.', ',')}`)
  }
  return rows.join('\n')
}

/** Ein Tag mit Morgenspitze — 96 Viertelstunden, ISO-Zeitstempel, Semikolon/Dezimalkomma. */
function loadProfileCsv(): string {
  const rows: string[] = ['Zeitstempel;Bezug (kW)']
  for (let i = 0; i < 96; i += 1) {
    const at = new Date(Date.UTC(2025, 2, 17, 0, 0) + i * 15 * 60_000)
    const hour = at.getUTCHours()
    const kw = hour >= 5 && hour < 8 ? 48 : hour >= 8 && hour < 18 ? 22 : 9
    rows.push(`${at.toISOString().slice(0, 16)};${String(kw).replace('.', ',')}`)
  }
  return rows.join('\n')
}

function file(content: string, filename: string) {
  return { bytes: new TextEncoder().encode(content).buffer as ArrayBuffer, filename }
}

function ports(overrides: Partial<Ports> = {}): Ports {
  return {
    readMeteringPoint: async () => ({ draft: DRAFT, sourceDocumentId: 'doc-1' }),
    readDocument: async (id) =>
      id === 'pv-1'
        ? file(pvProfileCsv(), 'pv-2025.csv')
        : file(loadProfileCsv(), 'lastgang-2025.csv'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('runAnalysisFromMeteringPointDraft', () => {
  it('rechnet die volle Kette vom Entwurf bis zum AnalysisResult', async () => {
    const result = await runAnalysisFromMeteringPointDraft('mp-1', ports())

    expect(result.current.billedKw).toBeCloseTo(48, 6)
    expect(result.assumptions.billingModel).toBe('monthly_max_sum')
    expect(result.assumptions.energyPriceCtPerKwh).toBe(24.5)
    expect(result.perBattery.length).toBeGreaterThan(0)
    expect(result.recommendation).toBeDefined()
    // Der Lastgang wurde tatsächlich gelesen, nicht nur der Entwurf ausgewertet.
    expect(result.dataQuality.coveredDays).toBeGreaterThan(0)
    expect(result.existingBatteryAnalysis).toBeUndefined()
  })

  it('rechnet die hochgeladene PV-Reihe und die Bestandsbatterie mit', async () => {
    const result = await runAnalysisFromMeteringPointDraft(
      'mp-1',
      ports({
        readMeteringPoint: async () => ({
          draft: {
            ...DRAFT,
            hasPv: true,
            pvProfileSource: 'upload',
            pvSourceDocumentId: 'pv-1',
            hasBattery: true,
            existingBatteryCapacityKwh: 19.2,
            existingBatteryMaxPowerKw: 10.6,
          },
          sourceDocumentId: 'doc-1',
        }),
      }),
    )

    // Der Bestandsblock entsteht nur, wenn `existingBattery` tatsächlich im Payload lag.
    const existing = result.existingBatteryAnalysis
    expect(existing).toBeDefined()
    expect(existing?.entry.battery.usableCapacityKwh).toBe(19.2)
    expect(existing?.entry.battery.roundTripEfficiency).toBe(ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY)
    /*
     * Die Brutto-PV ändert per Entwurf KEINE Ersparnis-Zahl (sie steckt bereits im Lastgang) — sie
     * erscheint im Trace. Ohne PV-Datei stünde dort die am Zähler sichtbare Einspeisung, und die ist
     * bei diesem rein positiven Lastgang durchgehend 0; ein Wert > 0 kann also nur aus der Datei kommen.
     */
    const trace = result.perBattery[0]?.dispatchTrace
    expect(trace).toBeDefined()
    const pvInTrace = (trace?.representativeDays ?? []).flatMap((day) =>
      day.intervals.map((interval) => interval.pvGenerationKw),
    )
    expect(Math.max(...pvInTrace)).toBeGreaterThan(0)
    expect(result.perBattery.length).toBeGreaterThan(0)
  })

  it('bricht bei einer GESCHÄTZTEN PV-Reihe ab — und rechnet dann gar nicht', async () => {
    const readDocument = vi.fn()
    const call = runAnalysisFromMeteringPointDraft(
      'mp-1',
      ports({
        readMeteringPoint: async () => ({
          draft: {
            ...DRAFT,
            hasPv: true,
            pvProfileSource: 'generated',
            pvEstimatedAnnualKwh: 12_000,
          },
          sourceDocumentId: 'doc-1',
        }),
        readDocument,
      }),
    )

    await expect(call).rejects.toThrow(MeteringPointAnalysisError)
    await expect(call).rejects.toThrow(/pvProfileSource, pvEstimatedAnnualKwh/)
    expect(readDocument).not.toHaveBeenCalled()
  })

  it('bricht ab, wenn es keine hochgeladene Lastgang-Datei gibt', async () => {
    await expect(
      runAnalysisFromMeteringPointDraft(
        'mp-1',
        ports({ readMeteringPoint: async () => ({ draft: DRAFT, sourceDocumentId: null }) }),
      ),
    ).rejects.toMatchObject({ reason: 'no_uploaded_load_profile' })
  })
})
