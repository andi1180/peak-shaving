import { describe, expect, it } from 'vitest'

import {
  PV_ARRAYS_KEY,
  pvArraysDraftIsEmpty,
  pvArraysKeyCollidesWithContract,
  readPvArraysDraft,
  withPvArrays,
} from './pv-array-draft'

describe('der Seiteneintrag verdeckt kein Contract-Feld', () => {
  it('kollidiert nicht mit `tariffParamsSchema`', () => {
    expect(pvArraysKeyCollidesWithContract()).toBe(false)
  })
})

describe('readPvArraysDraft liest defensiv', () => {
  it('liefert die gespeicherten Flächen', () => {
    const draft = withPvArrays({}, [
      { peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 },
      { peakPowerKwp: 5.95, direction: 'SW', slopeDeg: 35 },
    ])

    expect(readPvArraysDraft(draft)).toEqual([
      { peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 },
      { peakPowerKwp: 5.95, direction: 'SW', slopeDeg: 35 },
    ])
  })

  it('liefert eine leere Liste, wenn der Schlüssel fehlt oder kein Array trägt', () => {
    // Ein jsonb-Entwurf lässt sich von Hand bearbeiten — er darf keinen Wert erfinden.
    expect(readPvArraysDraft({})).toEqual([])
    expect(readPvArraysDraft({ [PV_ARRAYS_KEY]: null })).toEqual([])
    expect(readPvArraysDraft({ [PV_ARRAYS_KEY]: 'zwei Flächen' })).toEqual([])
    expect(readPvArraysDraft({ [PV_ARRAYS_KEY]: { peakPowerKwp: 4.25 } })).toEqual([])
  })

  it('verwirft unbrauchbare Einträge und behält die übrigen', () => {
    const draft = {
      [PV_ARRAYS_KEY]: [
        null,
        'kaputt',
        ['auch kaputt'],
        { peakPowerKwp: '4,25', direction: 'Südost', slopeDeg: Number.NaN },
        { peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 },
      ],
    }

    // Eine Zahl als Zeichenkette, eine unbekannte Himmelsrichtung und NaN werden je zu null —
    // damit tragen bei dieser Zeile alle drei Felder nichts, und sie fällt unter dieselbe Regel
    // wie ein leerer Eintrag. Übrig bleibt die eine Fläche, die wirklich etwas aussagt.
    expect(readPvArraysDraft(draft)).toEqual([
      { peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 },
    ])
  })

  it('verwirft einen Eintrag, dessen drei Felder alle leer sind', () => {
    const draft = { [PV_ARRAYS_KEY]: [{ peakPowerKwp: null, direction: null, slopeDeg: null }] }

    expect(readPvArraysDraft(draft)).toEqual([])
  })
})

describe('withPvArrays schreibt nur den eigenen Schlüssel', () => {
  it('lässt die übrigen Entwurfsfelder unberührt', () => {
    const draft = { energyPriceCtPerKwh: 24.5, _provenance: { energyPriceCtPerKwh: 'measured' } }
    const next = withPvArrays(draft, [{ peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 }])

    expect(next.energyPriceCtPerKwh).toBe(24.5)
    expect(next._provenance).toEqual({ energyPriceCtPerKwh: 'measured' })
    expect(next[PV_ARRAYS_KEY]).toEqual([{ peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 }])
  })
})

describe('pvArraysDraftIsEmpty', () => {
  it('unterscheidet die leere Liste von einer belegten', () => {
    expect(pvArraysDraftIsEmpty([])).toBe(true)
    expect(pvArraysDraftIsEmpty([{ peakPowerKwp: 4.25, direction: null, slopeDeg: null }])).toBe(
      false,
    )
  })
})
