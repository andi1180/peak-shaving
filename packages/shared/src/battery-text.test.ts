import { describe, expect, it } from 'vitest'

import {
  BATTERY_TEXT_JSON_SCHEMA,
  BATTERY_TEXT_NUMBER_KEYS,
  batteryTextExtractionIsEmpty,
  emptyBatteryTextExtraction,
  parseBatteryTextExtraction,
} from './battery-text'

describe('JSON-Schema', () => {
  it('verlangt jedes Feld und verbietet zusätzliche', () => {
    expect(BATTERY_TEXT_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(BATTERY_TEXT_JSON_SCHEMA.required).toEqual([
      'hasExistingBattery',
      ...BATTERY_TEXT_NUMBER_KEYS,
    ])
    expect(Object.keys(BATTERY_TEXT_JSON_SCHEMA.properties as object)).toEqual([
      'hasExistingBattery',
      ...BATTERY_TEXT_NUMBER_KEYS,
    ])
  })

  it('lässt für jedes Feld ausdrücklich null zu — „nicht erkennbar" muss ausdrückbar sein', () => {
    const props = BATTERY_TEXT_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    expect(props.hasExistingBattery.type).toEqual(['boolean', 'null'])
    for (const key of BATTERY_TEXT_NUMBER_KEYS) {
      expect(props[key].type).toEqual(['number', 'null'])
      expect(props[key].description).toBeTruthy()
    }
  })

  it('kombiniert nirgends eine Typ-Union mit einer enum-Liste (die API weist das mit 400 ab)', () => {
    /*
     * Derselbe rekursive Wächter wie in `invoice-scan.test.ts`: er prüft die URSACHE des
     * Totalausfalls vom 31.08.2026, nicht die heutige Form — dadurch ist auch ein Feld
     * abgesichert, das es in diesem Schema noch gar nicht gibt.
     */
    const offenders: string[] = []
    function walk(node: unknown, path: string) {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      const obj = node as Record<string, unknown>
      if (Array.isArray(obj.type) && obj.enum !== undefined) offenders.push(path)
      for (const [key, value] of Object.entries(obj)) walk(value, `${path}.${key}`)
    }
    walk(BATTERY_TEXT_JSON_SCHEMA, '$')
    expect(offenders).toEqual([])
  })
})

describe('parseBatteryTextExtraction — fail closed', () => {
  it('übernimmt eine vollständige Antwort unverändert', () => {
    expect(
      parseBatteryTextExtraction({
        hasExistingBattery: true,
        capacityKwh: 20,
        maxPowerKw: 10,
        roundTripEfficiencyPercent: 90,
        pricePerKwh: 480,
      }),
    ).toEqual({
      hasExistingBattery: true,
      capacityKwh: 20,
      maxPowerKw: 10,
      roundTripEfficiencyPercent: 90,
      pricePerKwh: 480,
    })
  })

  it('unterscheidet „keine Batterie" (false) von „sagt nichts dazu" (null)', () => {
    expect(parseBatteryTextExtraction({ hasExistingBattery: false }).hasExistingBattery).toBe(false)
    expect(parseBatteryTextExtraction({}).hasExistingBattery).toBeNull()
    // Kein Umdeuten: eine Zeichenkette ist keine Aussage.
    expect(parseBatteryTextExtraction({ hasExistingBattery: 'true' }).hasExistingBattery).toBeNull()
    expect(parseBatteryTextExtraction({ hasExistingBattery: 1 }).hasExistingBattery).toBeNull()
  })

  it('macht aus einer unbrauchbaren Antwort ein leeres Ergebnis statt einer Ausnahme', () => {
    for (const raw of [null, undefined, 'nein', 42, [], { egal: true }]) {
      expect(parseBatteryTextExtraction(raw)).toEqual(emptyBatteryTextExtraction())
    }
  })

  it('⚠ verwirft NaN und Infinity — beide sind typeof "number"', () => {
    const parsed = parseBatteryTextExtraction({
      capacityKwh: Number.NaN,
      maxPowerKw: Number.POSITIVE_INFINITY,
      roundTripEfficiencyPercent: Number.NaN,
      pricePerKwh: Number.POSITIVE_INFINITY,
    })
    for (const key of BATTERY_TEXT_NUMBER_KEYS) expect(parsed[key]).toBeNull()
  })

  it('verwirft eine Zahl, die als Zeichenkette kommt — es wird nicht umgedeutet', () => {
    // „20,5" zu parsen hiesse, zwischen 20,5 und 205 zu entscheiden.
    expect(parseBatteryTextExtraction({ capacityKwh: '20' }).capacityKwh).toBeNull()
  })

  it('verwirft nicht-positive Angaben — 0 kWh ist keine Batterie', () => {
    expect(parseBatteryTextExtraction({ capacityKwh: 0 }).capacityKwh).toBeNull()
    expect(parseBatteryTextExtraction({ pricePerKwh: -100 }).pricePerKwh).toBeNull()
  })

  it('⚠ verwirft einen Wirkungsgrad über 100 % — physikalisch unmöglich', () => {
    expect(parseBatteryTextExtraction({ roundTripEfficiencyPercent: 110 })
      .roundTripEfficiencyPercent).toBeNull()
    expect(parseBatteryTextExtraction({ roundTripEfficiencyPercent: 100 })
      .roundTripEfficiencyPercent).toBe(100)
    // Und er wird NICHT als Bruchteil umgedeutet: 0,9 wäre 0,9 % und damit unbrauchbar — aber
    // eine positive Zahl, die durchläuft. Die Oberfläche zeigt sie, der Mensch sieht den Unsinn.
    expect(parseBatteryTextExtraction({ roundTripEfficiencyPercent: 0.9 })
      .roundTripEfficiencyPercent).toBe(0.9)
  })

  it('lässt keine zusätzlichen Felder durch', () => {
    const parsed = parseBatteryTextExtraction({
      hasExistingBattery: true,
      hersteller: 'Sungrow',
      modell: 'SBR128',
    })
    expect(Object.keys(parsed).sort()).toEqual(
      ['hasExistingBattery', ...BATTERY_TEXT_NUMBER_KEYS].sort(),
    )
  })

  it('batteryTextExtractionIsEmpty erkennt „nichts gefunden"', () => {
    expect(batteryTextExtractionIsEmpty(emptyBatteryTextExtraction())).toBe(true)
    expect(
      batteryTextExtractionIsEmpty({ ...emptyBatteryTextExtraction(), hasExistingBattery: false }),
    ).toBe(false)
    expect(batteryTextExtractionIsEmpty({ ...emptyBatteryTextExtraction(), capacityKwh: 20 })).toBe(
      false,
    )
  })
})
