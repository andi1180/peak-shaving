import { describe, expect, it } from 'vitest'

import { parseNetzebeneDraftValue } from './metering-point-draft'

/*
 * Die Rückumformung „NE 5" → 5 ist die Brücke zwischen dem Entwurf (Text, Contract-Feld) und der
 * Netzentgelt-Abfrage (`grid_tariffs.netzebene` ist `integer`). Geprüft wird beides: dass der reale
 * Schreibweg ankommt, und dass ein von Hand veränderter `jsonb` keinen Analyse-Lauf mit einem
 * Ausnahmefehler abbricht.
 */
describe('parseNetzebeneDraftValue', () => {
  it('liest die Schreibweisen, die real im Entwurf stehen', () => {
    expect(parseNetzebeneDraftValue('NE 5')).toBe(5)
    expect(parseNetzebeneDraftValue('NE7')).toBe(7)
    expect(parseNetzebeneDraftValue('ne 3')).toBe(3)
    expect(parseNetzebeneDraftValue('  NE 6  ')).toBe(6)
    // Ohne Präfix: so schreibt das Chat-Werkzeug, und so stehen alte Entwürfe da.
    expect(parseNetzebeneDraftValue('4')).toBe(4)
    expect(parseNetzebeneDraftValue(5)).toBe(5)
  })

  it('liefert für unerwartete oder fehlende Werte null und wirft nie', () => {
    for (const raw of [
      undefined,
      null,
      '',
      'NE',
      'NE 2', // ausserhalb des CHECK 3..7 — in der Datenbank nicht auffindbar
      'NE 8',
      'Netzebene 5',
      '5 NE',
      {},
      [],
      Number.NaN,
    ]) {
      expect(() => parseNetzebeneDraftValue(raw)).not.toThrow()
      expect(parseNetzebeneDraftValue(raw)).toBeNull()
    }
  })
})
