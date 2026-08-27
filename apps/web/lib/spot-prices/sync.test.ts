/**
 * Die reine Hälfte des aWATTar-Syncs (B21-2a): Prüfung der Antwort, Einheiten-Umrechnung, Stapelung.
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Diese Datei prüft ausschliesslich, was ohne Netz und ohne Datenbank richtig oder falsch ist. Die
 * Rechtefläche, die den Schreibvorgang überhaupt zulässt, ist Sache des DB-Gates
 * (`packages/db-tests/src/spot-prices-write-access.test.ts`); die Zugangsgrenze des Endpunkts steht
 * in `app/api/cron/spot-price-sync/route.test.ts`.
 *
 * Der wichtigste Test der Datei ist die Faktor-10-Falle: `Eur/MWh → ct/kWh` ist die eine Stelle, an
 * der ein Fehler nicht als Fehler auffiele, sondern als überraschend gutes Wirtschaftlichkeits-
 * ergebnis.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  AWATTAR_PROVIDER,
  SpotPriceSyncError,
  fetchAwattarWindow,
  parseAwattarResponse,
  syncSpotPrices,
  toSpotPriceRows,
} from './sync'

/** Struktur und Werte stammen aus einer ECHTEN Antwort des Endpunkts, nicht aus der Dokumentation. */
const REAL_ENTRY = {
  start_timestamp: 1787666400000,
  end_timestamp: 1787670000000,
  marketprice: 177.97,
  unit: 'Eur/MWh',
}

function response(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload } as unknown as Response
}

function okFetch(payload: unknown): typeof fetch {
  return vi.fn().mockResolvedValue(response(payload)) as unknown as typeof fetch
}

describe('parseAwattarResponse', () => {
  it('nimmt die reale Antwortform { object, data } an', () => {
    const entries = parseAwattarResponse({ object: 'list', data: [REAL_ENTRY] })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.marketprice).toBe(177.97)
  })

  it('weist ein rohes Array ab — die Quelle liefert ein Objekt', () => {
    expect(() => parseAwattarResponse([REAL_ENTRY])).toThrow(SpotPriceSyncError)
  })

  it('bricht bei UNBEKANNTER Einheit ab, statt die Zahl zu deuten', () => {
    // Der Kern der Faktor-10-Absicherung: eine auf Ct/kWh umgestellte Quelle darf nicht
    // stillschweigend durch dieselbe Division laufen.
    expect(() => parseAwattarResponse({ data: [{ ...REAL_ENTRY, unit: 'Ct/kWh' }] })).toThrow(
      /unerwartete Einheit/,
    )
  })

  it('bricht bei einem einzelnen kaputten Eintrag ab, statt ihn zu überspringen', () => {
    // Eine übersprungene Stunde wäre eine Lücke in der Preiskurve, die niemand bemerkt.
    const payload = { data: [REAL_ENTRY, { ...REAL_ENTRY, marketprice: null }] }
    expect(() => parseAwattarResponse(payload)).toThrow(/Eintrag 1/)
  })

  it('weist ein Intervall ab, dessen Ende nicht nach dem Anfang liegt', () => {
    const payload = { data: [{ ...REAL_ENTRY, end_timestamp: REAL_ENTRY.start_timestamp }] }
    expect(() => parseAwattarResponse(payload)).toThrow(/Intervallende/)
  })
})

describe('toSpotPriceRows — die Faktor-10-Stelle', () => {
  it('rechnet 177,97 Eur/MWh in 17,797 ct/kWh um', () => {
    const [row] = toSpotPriceRows([REAL_ENTRY])
    expect(row!.ct_per_kwh).toBeCloseTo(17.797, 10)
  })

  it('behält das Vorzeichen bei negativen Marktpreisen', () => {
    // Negative Börsenpreise sind real und für die Ladeoptimierung der interessanteste Fall.
    const [row] = toSpotPriceRows([{ ...REAL_ENTRY, marketprice: -42.5 }])
    expect(row!.ct_per_kwh).toBeCloseTo(-4.25, 10)
  })

  it('setzt provider und price_basis an JEDER Zeile', () => {
    const [row] = toSpotPriceRows([REAL_ENTRY])
    expect(row!.provider).toBe(AWATTAR_PROVIDER)
    expect(row!.price_basis).toBe('net')
  })

  it('schreibt die Zeitstempel als ISO-8601-UTC', () => {
    const [row] = toSpotPriceRows([REAL_ENTRY])
    expect(row!.ts_start).toBe('2026-08-25T14:00:00.000Z')
    expect(row!.ts_end).toBe('2026-08-25T15:00:00.000Z')
  })
})

describe('fetchAwattarWindow', () => {
  it('hängt start und end als Epoch-Millisekunden an', async () => {
    const spy = okFetch({ data: [REAL_ENTRY] })
    await fetchAwattarWindow(1000, 2000, spy)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('?start=1000&end=2000'), expect.anything())
  })

  it('weist ein Fenster ab, dessen Ende nicht nach dem Anfang liegt — ohne Netzabruf', async () => {
    const spy = okFetch({ data: [] })
    await expect(fetchAwattarWindow(2000, 1000, spy)).rejects.toThrow(SpotPriceSyncError)
    expect(spy).not.toHaveBeenCalled()
  })

  it('macht aus einem HTTP-Fehler einen Abbruch, keine leere Liste', async () => {
    const failing = vi.fn().mockResolvedValue(response(null, false, 503)) as unknown as typeof fetch
    await expect(fetchAwattarWindow(1000, 2000, failing)).rejects.toThrow(/HTTP 503/)
  })
})

describe('syncSpotPrices', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      ...REAL_ENTRY,
      start_timestamp: REAL_ENTRY.start_timestamp + i * 3_600_000,
      end_timestamp: REAL_ENTRY.end_timestamp + i * 3_600_000,
    }))

  it('schreibt alle Zeilen und meldet die Spanne', async () => {
    const write = vi.fn().mockResolvedValue({ error: null })
    const result = await syncSpotPrices({
      write,
      startMs: 1000,
      endMs: 2000,
      fetchImpl: okFetch({ data: many(3) }),
    })
    expect(result.fetched).toBe(3)
    expect(result.written).toBe(3)
    expect(result.firstTsStart).toBe('2026-08-25T14:00:00.000Z')
    expect(result.lastTsStart).toBe('2026-08-25T16:00:00.000Z')
  })

  it('stapelt einen Jahres-Backfill, statt alles in EINEN Schreibvorgang zu legen', async () => {
    const write = vi.fn().mockResolvedValue({ error: null })
    const result = await syncSpotPrices({
      write,
      startMs: 1000,
      endMs: 2000,
      fetchImpl: okFetch({ data: many(1200) }),
    })
    expect(result.written).toBe(1200)
    expect(write).toHaveBeenCalledTimes(3) // 500 + 500 + 200
    expect(write.mock.calls[0]![0]).toHaveLength(500)
    expect(write.mock.calls[2]![0]).toHaveLength(200)
  })

  it('ein leeres Fenster ist kein Fehler', async () => {
    // Der tägliche Lauf fragt den übernächsten Tag ab, bevor er veröffentlicht ist.
    const write = vi.fn().mockResolvedValue({ error: null })
    const result = await syncSpotPrices({ write, startMs: 1000, endMs: 2000, fetchImpl: okFetch({ data: [] }) })
    expect(result).toMatchObject({ fetched: 0, written: 0, firstTsStart: null, lastTsStart: null })
    expect(write).not.toHaveBeenCalled()
  })

  it('bricht bei einem Schreibfehler ab und nennt, wie weit er gekommen ist', async () => {
    const write = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'permission denied for table spot_prices' } })
    await expect(
      syncSpotPrices({ write, startMs: 1000, endMs: 2000, fetchImpl: okFetch({ data: many(600) }) }),
    ).rejects.toThrow(/nach 500 von 600 Zeilen/)
  })

  it('schreibt NICHTS, wenn die Antwort eine unbekannte Einheit trägt', async () => {
    const write = vi.fn().mockResolvedValue({ error: null })
    await expect(
      syncSpotPrices({
        write,
        startMs: 1000,
        endMs: 2000,
        fetchImpl: okFetch({ data: [{ ...REAL_ENTRY, unit: 'Eur/kWh' }] }),
      }),
    ).rejects.toThrow(/unerwartete Einheit/)
    expect(write).not.toHaveBeenCalled()
  })
})
