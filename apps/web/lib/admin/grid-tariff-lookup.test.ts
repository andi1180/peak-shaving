import { describe, expect, it, vi } from 'vitest'

/*
 * B24, Teil 1 — die KERNREGEL des Preisblatt-Vorschlags.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DIESE DREI FÄLLE UND NICHT DIE ABFRAGE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Was der Supabase-Client aus einer Abfrage macht, ist Sache von B21-1 und im DB-Gate gemessen.
 * Hier steht die eine Übersetzung, die NUR in diesem Modul lebt und deren Fehler NICHT auffällt:
 *
 *   `eur_per_kw_year` → der Grundpreis IST der Leistungspreis
 *   `eur_per_year`    → eine JAHRESPAUSCHALE ⇒ Leistungspreis 0 (Delta 3)
 *
 * Die zweite Zeile ist die teuerste Stelle des Moduls. Die reale NE-7-Zeile „ohne Leistungsmessung"
 * trägt 54,00 EUR/Jahr; als Leistungspreis übernommen ginge sie mit dem abgerechneten kW-Wert
 * MULTIPLIZIERT in die Spitzenkappungs-Ersparnis ein — heraus käme eine dreistellige Zahl, die
 * völlig plausibel aussieht und frei erfunden ist. Kein Typfehler, kein Datenbankfehler, keine
 * Meldung: sichtbar allein an einer Wirtschaftlichkeitsrechnung, die zu gut ausfällt.
 *
 * Der dritte Fall prüft die Gegenrichtung: „für diese Kombination ist nichts hinterlegt" ist eine
 * ZULÄSSIGE Antwort (B21-1 — der Bestand ist gepflegt, nicht vollständig) und darf deshalb kein
 * Fehler sein. Als Wurf gemeldet sähe ein Pflegestand wie ein Defekt aus.
 */

vi.mock('server-only', () => ({}))

const { lookupGridTariffDefaults } = await import('./grid-tariff-lookup')

type Row = {
  grundpreis_amount: number | null
  grundpreis_unit: string | null
  valid_from: string
  valid_until: string | null
}

/**
 * Ein Supabase-Abfragebau, der GENAU die Kette bedient, die das Modul fährt — und die Aufrufe
 * mitschreibt. Absichtlich kein `any`-Platzhalter: an `.is()` gegen `.eq()` hängt, ob eine
 * NE-3-Zeile überhaupt gefunden wird (SQL vergleicht NULL nie per `=`), und ein Bau, der jede
 * Methode stumm schluckt, könnte diesen Unterschied nicht sichtbar machen.
 */
function stubClient(result: { data: Row[] | null; error: { message: string } | null }) {
  const calls: { method: string; args: unknown[] }[] = []

  const builder: Record<string, unknown> = {
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  for (const method of ['select', 'eq', 'is'] as const) {
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

const NE3 = {
  operatorId: 'wiener_netze',
  netzebene: 3,
  meteringVariant: null,
  country: 'AT' as const,
  stichtag: '2026-03-15',
}
const NE7_OHNE = {
  operatorId: 'wiener_netze',
  netzebene: 7,
  meteringVariant: 'ohne_leistungsmessung',
  country: 'AT' as const,
  stichtag: '2026-03-15',
}

describe('lookupGridTariffDefaults — die Einheit entscheidet über den Leistungspreis', () => {
  it('übernimmt den Grundpreis, wenn das Preisblatt ihn je kW und Jahr führt', async () => {
    // Die echte Wiener-Netze-Zeile NE 3 (Preisblatt WN-EX0105, 38,52 EUR/kW·a).
    const { supabase, calls } = stubClient({
      data: [
        {
          grundpreis_amount: 38.52,
          grundpreis_unit: 'eur_per_kw_year',
          valid_from: '2026-01-01',
          valid_until: null,
        },
      ],
      error: null,
    })

    await expect(lookupGridTariffDefaults(supabase, NE3)).resolves.toEqual({
      leistungspreisEurPerKwYear: 38.52,
      // Der einzige Wert, der nichts behauptet — der Sockel kann nur ANHEBEN (§3.5).
      minBillableKw: 0,
    })

    // ⚠ `.is('metering_variant', null)`, nicht `.eq(...)`: ein `.eq` fände auf NE 3–6 NIE eine
    // Zeile, und das sähe nach fehlenden Daten aus statt nach einem Abfragefehler.
    expect(calls).toContainEqual({ method: 'is', args: ['metering_variant', null] })
    expect(calls.some((call) => call.method === 'eq' && call.args[0] === 'metering_variant')).toBe(
      false,
    )
  })

  it('⚠ setzt den Leistungspreis auf 0, wenn das Preisblatt eine JAHRESPAUSCHALE führt', async () => {
    // Die echte NE-7-Zeile „ohne Leistungsmessung": 54,00 EUR/JAHR, kein Leistungspreis (Delta 3).
    const { supabase, calls } = stubClient({
      data: [
        {
          grundpreis_amount: 54,
          grundpreis_unit: 'eur_per_year',
          valid_from: '2026-01-01',
          valid_until: null,
        },
      ],
      error: null,
    })

    const defaults = await lookupGridTariffDefaults(supabase, NE7_OHNE)

    expect(defaults).toEqual({ leistungspreisEurPerKwYear: 0, minBillableKw: 0 })
    // Die Zahl darf an KEINER Stelle des Ergebnisses auftauchen — s. Kopf.
    expect(Object.values(defaults ?? {})).not.toContain(54)

    // Auf NE 7 führt das Preisblatt drei Zeilen; ohne Variante entschiede die Sortierreihenfolge.
    expect(calls).toContainEqual({
      method: 'eq',
      args: ['metering_variant', 'ohne_leistungsmessung'],
    })
  })

  it('behandelt eine unbekannte Einheit wie eine Pauschale, statt zu raten', async () => {
    const { supabase } = stubClient({
      data: [
        {
          grundpreis_amount: 99,
          grundpreis_unit: 'eur_per_month',
          valid_from: '2026-01-01',
          valid_until: null,
        },
      ],
      error: null,
    })

    await expect(lookupGridTariffDefaults(supabase, NE3)).resolves.toEqual({
      leistungspreisEurPerKwYear: 0,
      minBillableKw: 0,
    })
  })
})

describe('lookupGridTariffDefaults — keine passende Zeile ist eine Antwort, kein Fehler', () => {
  it('liefert null, wenn für die Kombination nichts hinterlegt ist', async () => {
    const { supabase } = stubClient({ data: [], error: null })

    // Kein Wurf: das Formular soll „nichts hinterlegt" sagen können, ohne einen Defekt zu melden.
    await expect(lookupGridTariffDefaults(supabase, NE3)).resolves.toBeNull()
  })

  it('liefert null, wenn keine Zeile den Stichtag abdeckt', async () => {
    // Gepflegt, aber erst ab 2027 gültig — `valid_until` ist INKLUSIV (B21-2b).
    const { supabase } = stubClient({
      data: [
        {
          grundpreis_amount: 38.52,
          grundpreis_unit: 'eur_per_kw_year',
          valid_from: '2027-01-01',
          valid_until: null,
        },
      ],
      error: null,
    })

    await expect(lookupGridTariffDefaults(supabase, NE3)).resolves.toBeNull()
  })

  it('⚠ WIRFT dagegen bei einem Datenbankfehler — „konnten nicht nachsehen" ≠ „nichts da"', async () => {
    const { supabase } = stubClient({ data: null, error: { message: 'connection reset' } })

    // Als `null` durchgereicht behauptete ein Ausfall eine Fehlanzeige im Preisblatt, und jemand
    // trüge Werte von Hand nach, die längst gepflegt sind.
    await expect(lookupGridTariffDefaults(supabase, NE3)).rejects.toThrow('connection reset')
  })
})

describe('lookupGridTariffDefaults — Projektland', () => {
  /** Ein Bau, der `.eq`/`.is` wirklich auf die Zeilen anwendet — so wird der Länderfilter wirksam statt nur mitgeschrieben. */
  function filteringClient(rows: (Row & Record<string, unknown>)[]) {
    const filters: [string, unknown][] = []
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      is: (column: string, value: unknown) => (filters.push([column, value]), builder),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: rows.filter((row) => filters.every(([column, value]) => (row[column] ?? null) === value)),
          error: null,
        }).then(resolve),
    }
    return { from: () => builder } as never
  }

  const ROWS = [
    { operator_id: 'netze_bw', netzebene: 7, metering_variant: 'mit_leistungsmessung', country: 'DE',
      grundpreis_amount: 61.4, grundpreis_unit: 'eur_per_kw_year', valid_from: '2026-01-01', valid_until: null },
    { operator_id: 'wiener_netze', netzebene: 7, metering_variant: 'mit_leistungsmessung', country: 'AT',
      grundpreis_amount: 38.52, grundpreis_unit: 'eur_per_kw_year', valid_from: '2026-01-01', valid_until: null },
  ]
  const DE_NE7 = { netzebene: 7, meteringVariant: 'mit_leistungsmessung', country: 'DE' as const, stichtag: '2026-03-15' }

  it('DE-Projekt mit DE-Zeile: Stufe-1-Leistungspreis übernommen, Mindestleistung 0', async () => {
    await expect(
      lookupGridTariffDefaults(filteringClient(ROWS), { ...DE_NE7, operatorId: 'netze_bw' }),
    ).resolves.toEqual({ leistungspreisEurPerKwYear: 61.4, minBillableKw: 0 })
  })

  it('DE-Projekt mit AT-Betreiber: keine Zeile, statt den österreichischen Satz vorzuschlagen', async () => {
    await expect(
      lookupGridTariffDefaults(filteringClient(ROWS), { ...DE_NE7, operatorId: 'wiener_netze' }),
    ).resolves.toBeNull()
  })
})
