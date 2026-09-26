import { describe, expect, it, vi } from 'vitest'

/*
 * Vorbereitung Drei-Wege-Vergleich — die drei Eigenschaften, die NUR hier falsch werden können.
 *
 * Was der Supabase-Client aus einer Abfrage macht, ist im DB-Gate gemessen (B21-1). Geprüft wird
 * hier, was dieses Modul entscheidet und was ohne Meldung schiefginge:
 *
 *   1. Ein Lastgang über einen Tarifwechsel bekommt ALLE überschneidenden Zeilen — nicht die erste.
 *      Nur eine gelesen, rechnete der Rest des Jahres mit den Preisen des Vorjahres: keine
 *      Fehlermeldung, nur ein falsches Ergebnis.
 *   2. Über 1.000 Preise werden SEITENWEISE gelesen. Ohne Seitenschleife käme der Rest als LÜCKE
 *      zurück — der Vergleich wäre „nicht berechenbar", und der Grund (fehlende Pagination) stünde
 *      nirgends; es sähe aus wie ein stehengebliebener Cron.
 *   3. Eine ECHTE Lücke wird trotzdem als solche gemeldet — sonst wäre (2) durch „meldet nie eine
 *      Lücke" trivial erfüllbar.
 */

vi.mock('server-only', () => ({}))

const { readGridTariffRowsForAnalysis, readSpotPricesForAnalysis, readTariffPricingForAnalysis } =
  await import('./analysis-tariff-inputs')

type Call = { method: string; args: unknown[] }

/**
 * Ein Abfragebau, der GENAU die Kette bedient, die das Modul fährt, und die Aufrufe mitschreibt.
 * `results` ist eine Warteschlange: jede aufgelöste Abfrage nimmt den nächsten Eintrag — nur so
 * lässt sich eine Seitenschleife überhaupt beobachten.
 */
function stubClient(results: { data: unknown[] | null; error: { message: string } | null }[]) {
  const calls: Call[] = []
  let next = 0

  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(results[Math.min(next++, results.length - 1)]).then(resolve),
  }
  for (const method of ['select', 'eq', 'is', 'or', 'lte', 'gte', 'gt', 'lt', 'order', 'range'] as const) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args })
      return builder
    }
  }

  const supabase = {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] })
      return builder
    },
  }

  // Zur Laufzeit derselbe Weg; der echte Client trägt nur deutlich mehr Methoden.
  return { supabase: supabase as never, calls }
}

const WINDOW = { startIso: '2025-06-01T00:00:00.000Z', endIso: '2026-05-31T23:45:00.000Z' }

describe('readGridTariffRowsForAnalysis', () => {
  it('liefert ALLE überschneidenden Zeilen in Rechenkern-Form, nicht nur die erste', async () => {
    const { supabase, calls } = stubClient([
      {
        data: [
          {
            netzverlust_ct_per_kwh: '0.91',
            grundpreis_amount: '38.52',
            grundpreis_unit: 'eur_per_kw_year',
            price_basis: 'net',
            valid_from: '2025-01-01',
            // INKLUSIV letzter Gültigkeitstag — die Kette schliesst lückenlos an die nächste Zeile an.
            valid_until: '2025-12-31',
            grid_tariff_rate_windows: [
              {
                label: 'normal',
                month_day_from: null,
                month_day_to: null,
                time_from: '00:00:00',
                time_to: '24:00:00',
                ct_per_kwh: '1.23',
              },
            ],
          },
          {
            netzverlust_ct_per_kwh: '0.95',
            grundpreis_amount: '40.00',
            grundpreis_unit: 'eur_per_kw_year',
            price_basis: 'net',
            valid_from: '2026-01-01',
            valid_until: null,
            grid_tariff_rate_windows: [],
          },
        ],
        error: null,
      },
    ])

    const rows = await readGridTariffRowsForAnalysis(supabase, {
      operatorId: 'wiener_netze',
      netzebene: 3,
      meteringVariant: null,
      window: WINDOW,
    })

    expect(rows).toEqual([
      {
        validFrom: '2025-01-01',
        validUntil: '2025-12-31',
        netzverlustCtPerKwh: 0.91,
        grundpreisAmount: 38.52,
        grundpreisUnit: 'eur_per_kw_year',
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
      {
        validFrom: '2026-01-01',
        validUntil: null,
        netzverlustCtPerKwh: 0.95,
        grundpreisAmount: 40,
        grundpreisUnit: 'eur_per_kw_year',
        priceBasis: 'net',
        windows: [],
      },
    ])

    // ⚠ `>=` auf `valid_until`: halboffen gelesen fiele der letzte Gültigkeitstag jedes Stands
    // heraus — bei einem Lastgang, der am 31.12. endet, wäre das der ganze Treffer.
    expect(calls).toContainEqual({
      method: 'or',
      args: ['valid_until.is.null,valid_until.gte.2025-06-01'],
    })
    expect(calls).toContainEqual({ method: 'lte', args: ['valid_from', '2026-05-31'] })
    // Auf NE 3 steht `null` in der Spalte; `.eq(..., null)` fände dort NIE eine Zeile.
    expect(calls).toContainEqual({ method: 'is', args: ['metering_variant', null] })
  })

  it('wirft bei einem Datenbankfehler, statt eine Fehlanzeige im Preisblatt zu behaupten', async () => {
    const { supabase } = stubClient([{ data: null, error: { message: 'connection reset' } }])

    await expect(
      readGridTariffRowsForAnalysis(supabase, {
        operatorId: 'wiener_netze',
        netzebene: 7,
        meteringVariant: 'mit_leistungsmessung',
        window: WINDOW,
      }),
    ).rejects.toThrow('connection reset')
  })
})

/** Stundenpreise ab `startIso`, lückenlos — die Form, in der `spot_prices` sie führt. */
function hourlyRows(startIso: string, count: number) {
  const startMs = Date.parse(startIso)
  return Array.from({ length: count }, (_, i) => ({
    ts_start: new Date(startMs + i * 3_600_000).toISOString(),
    ts_end: new Date(startMs + (i + 1) * 3_600_000).toISOString(),
    ct_per_kwh: '9.5',
    price_basis: 'net',
  }))
}

describe('readSpotPricesForAnalysis', () => {
  it('⚠ liest über die 1.000-Zeilen-Deckelung hinaus weiter, statt still zu kürzen', async () => {
    // 1.100 Stunden ≈ 46 Tage — PostgREST lieferte davon ohne `range()` die ersten 1.000.
    const all = hourlyRows('2026-01-01T00:00:00.000Z', 1100)
    const { supabase, calls } = stubClient([
      { data: all.slice(0, 1000), error: null },
      { data: all.slice(1000), error: null },
    ])

    const series = await readSpotPricesForAnalysis(
      supabase,
      { startIso: '2026-01-01T00:00:00.000Z', endIso: '2026-02-15T19:45:00.000Z' },
      15,
    )

    // Reihenfolge UND Vollständigkeit in einer Zusage: eine blosse Länge liesse offen, ob die
    // zweite Seite an der richtigen Stelle anschliesst.
    expect(series.prices.map((price) => price.tsStart)).toEqual(all.map((row) => row.ts_start))
    // Ohne Seitenschleife wäre der Rest eine LÜCKE — und der wahre Grund stünde nirgends.
    expect(series.complete).toBe(true)
    expect(series.missingRanges).toEqual([])

    const ranges = calls.filter((call) => call.method === 'range').map((call) => call.args)
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('meldet eine echte Lücke, statt sie zu überbrücken', async () => {
    // Sechs Stunden, in der Mitte fehlen zwei (04:00–06:00).
    const rows = [...hourlyRows('2026-01-01T00:00:00.000Z', 4), ...hourlyRows('2026-01-01T06:00:00.000Z', 2)]
    const { supabase } = stubClient([{ data: rows, error: null }])

    const series = await readSpotPricesForAnalysis(
      supabase,
      // Das Fenster endet mit dem BEGINN der letzten Viertelstunde; 15 Minuten kommen hinzu.
      { startIso: '2026-01-01T00:00:00.000Z', endIso: '2026-01-01T07:45:00.000Z' },
      15,
    )

    expect(series.complete).toBe(false)
    expect(series.missingRanges).toEqual([
      { fromIso: '2026-01-01T04:00:00.000Z', toIso: '2026-01-01T06:00:00.000Z' },
    ])
    // Der Aufschlag der Intervalldauer: ohne ihn endete die Abfrage um 07:45 und die letzte Stunde
    // (07:00–08:00) gälte als nicht abgedeckt — für JEDEN vollständigen Lastgang eine Lücke.
    expect(series.prices).toHaveLength(6)
  })
})

/**
 * Ein Stub, der die Filter WIRKLICH anwendet — der obige gibt jede Zeile zurück und könnte eine
 * zu enge Abfrage nie zeigen. Stundenpreise 2025-12-31 22:00 bis 2026-01-01 06:00 UTC.
 */
function spotTable(skipHourIso?: string) {
  const rows = hourlyRows('2025-12-31T22:00:00.000Z', 8)
    .filter((row) => row.ts_start !== skipHourIso)
    .map((row) => ({ ...row, provider: 'awattar_at' }))
  const time = (value: unknown) => Date.parse(String(value))
  const client = {
    from: () => {
      const filters: ((row: Record<string, unknown>) => boolean)[] = []
      let range: [number, number] = [0, Infinity]
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: () => builder,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
        gt: (c: string, v: unknown) => (filters.push((r) => time(r[c]) > time(v)), builder),
        gte: (c: string, v: unknown) => (filters.push((r) => time(r[c]) >= time(v)), builder),
        lt: (c: string, v: unknown) => (filters.push((r) => time(r[c]) < time(v)), builder),
        range: (from: number, to: number) => ((range = [from, to]), builder),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data: rows.filter((r) => filters.every((f) => f(r))).slice(range[0], range[1] + 1),
            error: null,
          }).then(resolve),
      }
      return builder
    },
  }
  return client as never
}

describe('readSpotPricesForAnalysis — angebrochene Randstunden', () => {
  it.each([
    ['Beginn :15 — die angebrochene erste Stunde fehlt nicht', '2026-01-01T00:15:00.000Z', '2026-01-01T02:30:00.000Z'],
    ['Ende :45 — die angebrochene letzte Stunde ist dabei', '2026-01-01T00:00:00.000Z', '2026-01-01T02:30:00.000Z'],
    ['Beginn zur vollen Stunde — die Stunde davor bleibt draussen', '2026-01-01T00:00:00.000Z', '2026-01-01T02:45:00.000Z'],
  ])('%s', async (_, startIso, endIso) => {
    const series = await readSpotPricesForAnalysis(spotTable(), { startIso, endIso }, 15)

    expect(series.prices.map((price) => price.tsStart)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
      '2026-01-01T02:00:00.000Z',
    ])
    expect(series.complete).toBe(true)
    expect(series.missingRanges).toEqual([])
  })

  it('eine echte fehlende Stunde in der Mitte bleibt eine benannte Lücke', async () => {
    const series = await readSpotPricesForAnalysis(
      spotTable('2026-01-01T01:00:00.000Z'),
      { startIso: '2026-01-01T00:15:00.000Z', endIso: '2026-01-01T02:30:00.000Z' },
      15,
    )

    expect(series.complete).toBe(false)
    expect(series.missingRanges).toEqual([
      { fromIso: '2026-01-01T01:00:00.000Z', toIso: '2026-01-01T02:00:00.000Z' },
    ])
  })
})

describe('readTariffPricingForAnalysis', () => {
  it('⚠ lässt jede Preisseite für sich scheitern, statt die ganze Analyse abzubrechen', async () => {
    // Erste Abfrage: Netzentgelte → Fehler. Danach zwei volle Spotpreis-Seiten.
    const { supabase } = stubClient([
      { data: null, error: { message: 'connection reset' } },
      { data: hourlyRows('2026-01-01T00:00:00.000Z', 24), error: null },
    ])
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const pricing = await readTariffPricingForAnalysis(supabase, {
      operatorId: 'wiener_netze',
      netzebene: 7,
      meteringVariant: 'mit_leistungsmessung',
      window: { startIso: '2026-01-01T00:00:00.000Z', endIso: '2026-01-01T23:45:00.000Z' },
      intervalMinutes: 15,
    }, { category: 'gewerbe', postalCode: null })

    // Die eine Seite fällt aus (⇒ Hebel nicht berechenbar), die andere steht — kein Wurf.
    expect(pricing.gridTariffRows).toBeNull()
    expect(pricing.spotPrices?.prices).toHaveLength(24)
    expect(pricing.spotPrices?.complete).toBe(true)
    // Ohne die Logzeile stünde nirgends, WARUM die Seite fehlt.
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
  })

  it('fragt die Netzentgelt-Seite ohne Netzbetreiber gar nicht erst an', async () => {
    const { supabase, calls } = stubClient([
      { data: hourlyRows('2026-01-01T00:00:00.000Z', 24), error: null },
    ])

    const pricing = await readTariffPricingForAnalysis(supabase, {
      operatorId: null,
      netzebene: null,
      meteringVariant: null,
      window: { startIso: '2026-01-01T00:00:00.000Z', endIso: '2026-01-01T23:45:00.000Z' },
      intervalMinutes: 15,
    }, { category: 'gewerbe', postalCode: null })

    expect(pricing.gridTariffRows).toBeNull()
    expect(pricing.spotPrices).not.toBeNull()
    expect(calls).not.toContainEqual({ method: 'from', args: ['grid_tariffs'] })
  })
})
