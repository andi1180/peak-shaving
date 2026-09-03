import { describe, expect, it } from 'vitest'
import {
  STALE_OPEN_STAND_MONTHS,
  backfillRangeText,
  previousDay,
  staleOpenStandMonths,
} from './grid-tariffs'

/**
 * B21-2e — die reinen Helfer des Nachtrag-Wegs.
 *
 * Sie rechnen NICHTS, was die Datenbank entscheidet: `public.backfill_grid_tariff` bildet das
 * `valid_until` selbst (`valid_from - 1`) und prüft den Guard unter einer Sperre. Was hier steht,
 * ist die ANZEIGE davor — und die muss dasselbe sagen wie der Wrapper gleich darauf tut, sonst
 * behauptet der Bestätigungstext einen anderen Zeitraum als der, der entsteht.
 */

describe('previousDay — der Tag vor dem ältesten Stand', () => {
  it('rechnet über den Monats- und Jahreswechsel', () => {
    expect(previousDay('2026-01-01')).toBe('2025-12-31')
    expect(previousDay('2026-03-01')).toBe('2026-02-28')
    expect(previousDay('2026-07-15')).toBe('2026-07-14')
  })

  it('kennt den Schalttag', () => {
    // Ein naiver „Monat minus eins"-Ansatz träfe hier den 28.; die Kette wäre um einen Tag lückig.
    expect(previousDay('2028-03-01')).toBe('2028-02-29')
  })

  it('⚠ rechnet in UTC — sonst läge ein Monatserster in Wien einen Tag zu früh', () => {
    /*
     * `new Date('2026-01-01')` ist Mitternacht UTC; ein anschliessendes `setDate` liefe in der
     * Zeitzone des Servers und ergäbe in UTC+1 den 30.12. statt des 31.12. Der Bestätigungstext
     * behauptete dann eine Lücke von einem Tag, während der Wrapper korrekt anschliesst.
     */
    const before = process.env.TZ
    try {
      process.env.TZ = 'Europe/Vienna'
      expect(previousDay('2026-01-01')).toBe('2025-12-31')
      process.env.TZ = 'Pacific/Auckland'
      expect(previousDay('2026-01-01')).toBe('2025-12-31')
    } finally {
      process.env.TZ = before
    }
  })

  it('gibt bei unvollständigem oder unbrauchbarem Datum null zurück', () => {
    // Ein halb getipptes Datum darf keinen Satz über einen Stand erzeugen, den niemand abschickt.
    for (const value of ['', '2026', '2026-01', '01.01.2026', 'quatsch', '2026-1-1']) {
      expect(previousDay(value)).toBeNull()
    }
  })
})

describe('backfillRangeText — der Satz vor dem Absenden', () => {
  it('nennt BEIDE Enden und sagt, dass der Stand nicht der aktuelle wird', () => {
    const text = backfillRangeText('2025-01-01', '2026-01-01')
    expect(text).toContain('01.01.2025')
    expect(text).toContain('31.12.2025')
    expect(text).toContain('01.01.2026')
    expect(text).toMatch(/NICHT zum aktuellen Stand/)
  })

  it('bleibt still, solange der Beginn unvollständig ist', () => {
    expect(backfillRangeText('2025-0', '2026-01-01')).toBeNull()
  })
})

describe('staleOpenStandMonths — reine Anzeige, kein Blocker', () => {
  const created = '2026-01-15T10:00:00Z'

  it('schweigt unterhalb der Schwelle', () => {
    // 14 Monate später: ein normal gepflegter Jahreszyklus, kein Hinweis.
    expect(staleOpenStandMonths(created, new Date('2027-03-15T10:00:00Z'))).toBeNull()
  })

  it('meldet ab der Schwelle die Zahl der vollen Monate', () => {
    expect(staleOpenStandMonths(created, new Date('2027-04-15T10:00:00Z'))).toBe(
      STALE_OPEN_STAND_MONTHS,
    )
    expect(staleOpenStandMonths(created, new Date('2027-06-20T10:00:00Z'))).toBe(17)
  })

  it('zählt einen angebrochenen Monat NICHT mit', () => {
    // Einen Tag vor dem Monatstag sind es 14 volle Monate, nicht 15 — sonst spränge der Hinweis
    // einen Tag zu früh an und die genannte Zahl wäre um eins zu hoch.
    expect(staleOpenStandMonths(created, new Date('2027-04-14T10:00:00Z'))).toBeNull()
  })

  it('gibt bei unbrauchbarem Zeitstempel null zurück statt zu werfen', () => {
    // Ein kaputter Wert darf die Liste nicht herunterreissen — der Hinweis ist Beiwerk.
    expect(staleOpenStandMonths('nicht-ein-datum', new Date('2027-06-01T00:00:00Z'))).toBeNull()
  })
})
