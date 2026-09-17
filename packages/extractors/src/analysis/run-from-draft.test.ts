import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY } from 'shared'

import { buildGeneratedPvSeriesFile } from '../pv-reference/generated-series'

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

/**
 * Die abgelegte Schätzreihe zu GENAU diesen Zeitstempeln — gebaut mit derselben Funktion, die sie
 * ablegt. Eine von Hand geschriebene Datei prüfte den Leser gegen eine zweite Wahrheit.
 */
function generatedSeriesJson(timestamps: readonly string[]): string {
  return buildGeneratedPvSeriesFile({
    // Mittagsglocke über das ganze Referenzjahr — 9 bis 16 Uhr 12 kW, sonst nichts.
    hourlySeries: [Array.from({ length: 8760 }, (_, i) => (i % 24 >= 9 && i % 24 < 16 ? 12 : 0))],
    timestamps,
    weatherYears: { from: 2014, to: 2023 },
    smoothingOptimismPercent: 4.9,
  }).text
}

const GENERATED_DRAFT: Record<string, unknown> = {
  ...DRAFT,
  hasPv: true,
  pvProfileSource: 'generated',
  pvGeneratedDocumentId: 'pv-gen-1',
  // Die Kennzahlen daneben sperren nicht mehr, sobald die Reihe selbst benannt ist.
  pvEstimatedAnnualKwh: 12_000,
  pvEstimatedWeatherYearFrom: 2014,
  pvEstimatedWeatherYearTo: 2023,
}

/** Ports, deren `pv-gen-1` die übergebene Reihe liefert. */
function generatedPorts(seriesJson: string, draft: Record<string, unknown> = GENERATED_DRAFT): Ports {
  return ports({
    readMeteringPoint: async () => ({ draft, sourceDocumentId: 'doc-1' }),
    readDocument: async (id) =>
      id === 'pv-gen-1'
        ? file(seriesJson, 'pv-erzeugung-geschaetzt.json')
        : file(loadProfileCsv(), 'lastgang-2025.csv'),
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('runAnalysisFromMeteringPointDraft', () => {
  it('rechnet die volle Kette vom Entwurf bis zum AnalysisResult', async () => {
    const { result, loadProfile } = await runAnalysisFromMeteringPointDraft('mp-1', ports())

    // Der Lastgang reist neben dem Ergebnis heraus — dieselbe Reihe, die gerechnet wurde.
    expect(loadProfile.readings).toHaveLength(96)
    expect(loadProfile.intervalMinutes).toBe(15)

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
    const { result } = await runAnalysisFromMeteringPointDraft(
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

  it('warnt sichtbar, wenn eine Batterie bejaht ist, aber ihre Kerndaten fehlen', async () => {
    const { result } = await runAnalysisFromMeteringPointDraft(
      'mp-1',
      ports({
        readMeteringPoint: async () => ({
          draft: { ...DRAFT, hasBattery: true },
          sourceDocumentId: 'doc-1',
        }),
      }),
    )

    // Gerechnet wird weiter — nur eben ohne den Speicher, und das steht jetzt im Ergebnis.
    expect(result.existingBatteryAnalysis).toBeUndefined()
    expect(result.perBattery.length).toBeGreaterThan(0)
    expect(
      result.dataQuality.warnings.some((warning) => warning.includes('existingBatteryCapacityKwh')),
    ).toBe(true)
  })

  it('rechnet die abgelegte GESCHÄTZTE Reihe mit — und die Spitzenkappung fällt dabei weg', async () => {
    // Erst der Lauf ohne Schätzreihe: er liefert die Zeitstempel für die Datei UND den Gegenbeweis.
    const ohne = await runAnalysisFromMeteringPointDraft('mp-1', ports())
    expect(ohne.estimatedPvMetadata).toBeUndefined()
    expect(ohne.result.perBattery.some((e) => e.leistungspreisSavingPerYear > 0)).toBe(true)

    const seriesJson = generatedSeriesJson(ohne.loadProfile.readings.map((r) => r.ts))
    const { result, loadProfile, estimatedPvMetadata } = await runAnalysisFromMeteringPointDraft(
      'mp-1',
      generatedPorts(seriesJson),
    )

    // Gerechnet wurde der GEKOPPELTE Lastgang — daran hängt der Blocker `estimated_pv`.
    expect(loadProfile.pvSource).toBe('estimated')
    expect(result.perBattery.every((e) => e.leistungspreisSavingPerYear === 0)).toBe(true)
    expect(estimatedPvMetadata).toEqual({
      smoothingOptimismPercent: 4.9,
      weatherYears: { from: 2014, to: 2023 },
    })
  })

  it('bricht ab, wenn die abgelegte Reihe zu einem anderen Lastgang gehört', async () => {
    const ohne = await runAnalysisFromMeteringPointDraft('mp-1', ports())
    // Ein um einen Tag verschobener Zeitstempel: positionsweise addiert fiele das nirgends auf.
    const verschoben = ohne.loadProfile.readings.map((r, i) =>
      i === 5 ? new Date(Date.parse(r.ts) + 86_400_000).toISOString() : r.ts,
    )

    await expect(
      runAnalysisFromMeteringPointDraft('mp-1', generatedPorts(generatedSeriesJson(verschoben))),
    ).rejects.toMatchObject({ name: 'GeneratedPvSeriesError', reason: 'timestamp_mismatch' })
  })

  it('bricht bei einer GESCHÄTZTEN PV-Reihe OHNE abgelegte Datei ab — und rechnet dann gar nicht', async () => {
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

/*
 * Der Drei-Wege-Vergleich: der dritte, OPTIONALE Port. Geprüft wird, was nur hier falsch werden
 * kann — dass die Abfrage aus DEMSELBEN Profil gebildet wird, das gerechnet wird, dass die
 * Messvariante bei NE 3–6 auf `null` gezwungen wird (sonst findet `.is(metering_variant, null)` nie
 * eine Zeile), und dass ein Aufrufer ohne diesen Port unverändert weiterläuft.
 */
describe('runAnalysisFromMeteringPointDraft — tariffPricing', () => {
  /** Eine Netzentgelt-Zeile, die den ganzen Demo-Tag abdeckt. Netto, ein ganztägiges Fenster. */
  const GRID_ROWS = [
    {
      validFrom: '2025-01-01',
      validUntil: null,
      netzverlustCtPerKwh: 0.91,
      priceBasis: 'net',
      windows: [
        {
          label: 'normal',
          monthDayFrom: null,
          monthDayTo: null,
          timeFrom: '00:00:00',
          timeTo: '24:00:00',
          ctPerKwh: 1.23,
        },
      ],
    },
  ]

  /** Lückenlose Stundenpreise über das Fenster plus die Dauer der letzten Viertelstunde. */
  function spotSeries(window: { startIso: string; endIso: string }, intervalMinutes: number) {
    const startMs = Date.parse(window.startIso)
    const endMs = Date.parse(window.endIso) + intervalMinutes * 60_000
    const prices = []
    for (let ms = startMs; ms < endMs; ms += 3_600_000) {
      prices.push({
        tsStart: new Date(ms).toISOString(),
        tsEnd: new Date(ms + 3_600_000).toISOString(),
        ctPerKwh: 8.5,
        priceBasis: 'net',
      })
    }
    return { prices, complete: true, missingRanges: [] }
  }

  it('füllt payload.tariffPricing und macht die Tarifoptimierung berechenbar', async () => {
    const fetchTariffPricing = vi.fn(async (request: { window: { startIso: string; endIso: string }; intervalMinutes: number }) => ({
      gridTariffRows: GRID_ROWS,
      spotPrices: spotSeries(request.window, request.intervalMinutes),
    }))

    const { result, loadProfile } = await runAnalysisFromMeteringPointDraft(
      'mp-1',
      ports({ fetchTariffPricing }),
    )

    expect(fetchTariffPricing).toHaveBeenCalledTimes(1)
    const request = fetchTariffPricing.mock.calls[0]![0] as {
      operatorId: string | null
      netzebene: number | null
      meteringVariant: string | null
      window: { startIso: string; endIso: string }
      intervalMinutes: number
    }
    expect(request.operatorId).toBe('wiener_netze')
    expect(request.netzebene).toBe(7)
    expect(request.meteringVariant).toBe('mit_leistungsmessung')
    expect(request.intervalMinutes).toBe(15)
    // Das Fenster stammt aus DEMSELBEN Profil, das gerechnet wurde — nicht aus einer zweiten Ableitung.
    expect(request.window.startIso).toBe(loadProfile.readings[0]!.ts)
    expect(request.window.endIso).toBe(loadProfile.readings.at(-1)!.ts)

    expect(result.tariffOptimization).toEqual({ computable: true })
  })

  it('zwingt die Messvariante bei NE 3–6 auf null, unabhängig vom Entwurfswert', async () => {
    const fetchTariffPricing = vi.fn(
      async (request: { netzebene: number | null; meteringVariant: string | null }) => {
        void request
        return { gridTariffRows: null, spotPrices: null }
      },
    )

    await runAnalysisFromMeteringPointDraft(
      'mp-1',
      ports({
        readMeteringPoint: async () => ({
          // NE 5 bietet keine Variante an — der stehengebliebene Wert darf nicht mitfahren.
          draft: { ...DRAFT, netzebene: 'NE 5', meteringVariant: 'mit_leistungsmessung' },
          sourceDocumentId: 'doc-1',
        }),
        fetchTariffPricing,
      }),
    )

    expect(fetchTariffPricing.mock.calls[0]![0]).toMatchObject({
      netzebene: 5,
      meteringVariant: null,
    })
  })

  it('lässt tariffPricing ohne den Port unangetastet — bestehende Aufrufer rechnen wie bisher', async () => {
    const { result } = await runAnalysisFromMeteringPointDraft('mp-1', ports())

    // `undefined` heisst „nicht angefordert": kein Hebel, aber auch kein Blocker-Befund.
    expect(result.tariffOptimization).toBeUndefined()
  })
})
