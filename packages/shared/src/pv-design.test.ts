import { describe, expect, it } from 'vitest'

import {
  COMPASS_DIRECTIONS,
  COMPASS_SECTOR_HALF_WIDTH_DEG,
  checkPvArray,
  compassDegreeFitsDirection,
  compassToPvgisAzimuth,
  effectiveCompassDeg,
  normalizeCompassDeg,
  pvArrayAzimuthDeg,
  pvgisAzimuthToCompass,
  summarizeAnnualYields,
} from './pv-design'

/**
 * B22b — die Umrechnung mit der teuersten bekannten Fehlerwirkung des Bauabschnitts.
 *
 * Die Zahlen sind NICHT erfunden: sie stammen aus `PV_Zeitreihengenerator_Bestandsaufnahme.md` 3.3,
 * wo dieselben Konfigurationen gegen die echte PVGIS-API gerechnet wurden.
 */
describe('B22b — Kompass → PVGIS-aspect (die 56-%-Falle)', () => {
  it('⚠ der gemessene Fall: Kompass 133 (Südosten) ergibt aspect −47, NICHT 133', () => {
    expect(compassToPvgisAzimuth(133)).toBe(-47)
    /*
     * Die Gegenprobe ist der eigentliche Test: 133 ungeprüft als aspect übernommen zeigt nach
     * Nordwesten (Kompass 313) — die Gegenrichtung, und in Euro 56 % der Ersparnis.
     */
    expect(pvgisAzimuthToCompass(133)).toBe(313)
    expect(pvgisAzimuthToCompass(-47)).toBe(133)
  })

  it('trifft die drei an der Sonnenlage gemessenen Punkte (Ost/Süd/West)', () => {
    // Bestandsaufnahme 3.3: aspect −90 → Juni-Maximum 10:00 Ortszeit (Osten), 0 → Süden,
    // +90 → 16:00 Ortszeit (Westen).
    expect(compassToPvgisAzimuth(90)).toBe(-90)
    expect(compassToPvgisAzimuth(180)).toBe(0)
    expect(compassToPvgisAzimuth(270)).toBe(90)
  })

  it('Norden ergibt −180 (nicht +180) und bleibt im von PVGIS zugelassenen Bereich', () => {
    expect(compassToPvgisAzimuth(0)).toBe(-180)
    expect(compassToPvgisAzimuth(360)).toBe(-180)
    for (const d of COMPASS_DIRECTIONS) {
      const aspect = compassToPvgisAzimuth(d.compassDeg)
      expect(aspect).toBeGreaterThanOrEqual(-180)
      expect(aspect).toBeLessThanOrEqual(180)
    }
  })

  it('normalisiert beliebige Gradzahlen, auch negative und über 360', () => {
    expect(normalizeCompassDeg(-90)).toBe(270)
    expect(normalizeCompassDeg(450)).toBe(90)
    expect(compassToPvgisAzimuth(-90)).toBe(90)
  })

  it('alle acht Auswahl-Richtungen sind vorhanden und liegen 45° auseinander', () => {
    expect(COMPASS_DIRECTIONS).toHaveLength(8)
    const degs = COMPASS_DIRECTIONS.map((d) => d.compassDeg).sort((a, b) => a - b)
    expect(degs).toEqual([0, 45, 90, 135, 180, 225, 270, 315])
    expect(COMPASS_SECTOR_HALF_WIDTH_DEG).toBe(22.5)
  })
})

describe('B22b — der strukturelle Fang: Gradzahl gegen Himmelsrichtung', () => {
  it('⚠ „Südosten + 133" ist gültig, „Nordwesten + 133" wird abgewiesen', () => {
    expect(compassDegreeFitsDirection('SO', 133)).toBe(true)
    expect(compassDegreeFitsDirection('NW', 133)).toBe(false)
  })

  it('akzeptiert genau den Sektor (Rand inklusive) und nichts darüber hinaus', () => {
    // Südosten = 135°, halbe Sektorbreite 22,5° ⇒ 112,5 … 157,5.
    expect(compassDegreeFitsDirection('SO', 112.5)).toBe(true)
    expect(compassDegreeFitsDirection('SO', 157.5)).toBe(true)
    expect(compassDegreeFitsDirection('SO', 112.4)).toBe(false)
    expect(compassDegreeFitsDirection('SO', 157.6)).toBe(false)
  })

  it('rechnet über den Nordsprung hinweg richtig (350 gehört zu Norden)', () => {
    expect(compassDegreeFitsDirection('N', 350)).toBe(true)
    expect(compassDegreeFitsDirection('N', 10)).toBe(true)
    expect(compassDegreeFitsDirection('N', 180)).toBe(false)
  })

  it('weist NaN ab, statt es durchzulassen', () => {
    expect(compassDegreeFitsDirection('S', Number.NaN)).toBe(false)
  })
})

describe('B22b — die wirksame Ausrichtung einer Modulfläche', () => {
  it('ohne Feinangabe gilt die Sektormitte', () => {
    expect(effectiveCompassDeg({ peakPowerKwp: 5, slopeDeg: 30, direction: 'SO' })).toBe(135)
    expect(pvArrayAzimuthDeg({ peakPowerKwp: 5, slopeDeg: 30, direction: 'SO' })).toBe(-45)
  })

  it('mit Feinangabe gilt genau diese — und ergibt den gemessenen aspect −47', () => {
    const array = { peakPowerKwp: 10.2, slopeDeg: 90, direction: 'SO' as const, compassDeg: 133 }
    expect(effectiveCompassDeg(array)).toBe(133)
    expect(pvArrayAzimuthDeg(array)).toBe(-47)
  })
})

describe('B22b — checkPvArray (fail closed, je Grund ein eigener Wert)', () => {
  const base = { peakPowerKwp: 10.2, slopeDeg: 90, direction: 'SO' as const }

  it('nimmt eine vollständige Fläche an', () => {
    expect(checkPvArray(base)).toEqual({ ok: true })
    expect(checkPvArray({ ...base, compassDeg: 133 })).toEqual({ ok: true })
  })

  it('weist eine Gradzahl ab, die nicht zur Richtung passt — mit eigenem Grund', () => {
    expect(checkPvArray({ ...base, direction: 'NW', compassDeg: 133 })).toEqual({
      ok: false,
      reason: 'compass_direction_mismatch',
    })
  })

  it('weist unbrauchbare Leistung und Neigung getrennt ab', () => {
    expect(checkPvArray({ ...base, peakPowerKwp: 0 })).toEqual({
      ok: false,
      reason: 'peak_power_invalid',
    })
    expect(checkPvArray({ ...base, peakPowerKwp: Number.NaN })).toEqual({
      ok: false,
      reason: 'peak_power_invalid',
    })
    expect(checkPvArray({ ...base, slopeDeg: 91 })).toEqual({ ok: false, reason: 'slope_invalid' })
    expect(checkPvArray({ ...base, slopeDeg: -1 })).toEqual({ ok: false, reason: 'slope_invalid' })
  })

  it('lässt eine Fassadenanlage (90°) und eine Flachdachanlage (0°) zu', () => {
    expect(checkPvArray({ ...base, slopeDeg: 90 })).toEqual({ ok: true })
    expect(checkPvArray({ ...base, slopeDeg: 0 })).toEqual({ ok: true })
  })
})

describe('B22b — Jahresertrags-Streuung (die ehrliche Genauigkeitsgrenze)', () => {
  it('⚠ reproduziert die dokumentierte Messung: 711,4 … 800,0 bei Mittel 759,0 ⇒ ± 5,8 %', () => {
    /*
     * Die zehn Wetterjahre der Bestandsaufnahme (kWh/kWp, Wien 90°/−47). Der Test prüft, dass die
     * Formel die im Pflichtenheft zitierte Zahl liefert — sonst stünde im Report eine andere
     * Streuung als in der Begründung, aus der die Regel stammt.
     */
    const yields = [711.4, 800.0, 759.0, 745.0, 770.0, 752.0, 780.0, 733.0, 765.0, 775.0]
    const s = summarizeAnnualYields(yields)
    expect(s).not.toBeNull()
    expect(s!.minKwh).toBe(711.4)
    expect(s!.maxKwh).toBe(800.0)
    expect(s!.spreadPercent).toBeCloseTo(5.8, 1)
  })

  it('rechnet die HALBE Spannweite, nicht die volle — „±" heisst in beide Richtungen', () => {
    const s = summarizeAnnualYields([90, 110])
    expect(s!.meanKwh).toBe(100)
    // volle Spannweite wären 20 %, die Angabe im Report ist ± 10 %.
    expect(s!.spreadPercent).toBeCloseTo(10, 6)
  })

  it('leere Eingabe ergibt null — „keine Angabe" ist nicht „Streuung 0"', () => {
    expect(summarizeAnnualYields([])).toBeNull()
    expect(summarizeAnnualYields([Number.NaN])).toBeNull()
  })

  it('ein einzelnes Jahr ergibt Streuung 0 (und das ist dann wahr)', () => {
    const s = summarizeAnnualYields([759])
    expect(s!.spreadPercent).toBe(0)
    expect(s!.meanKwh).toBe(759)
  })
})
