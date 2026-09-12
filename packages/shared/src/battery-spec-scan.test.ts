import { describe, expect, it } from 'vitest'

import { BATTERY_TEXT_NUMBER_KEYS } from './battery-text'
import {
  BATTERY_SPEC_LABEL_KEYS,
  BATTERY_SPEC_NUMBER_KEYS,
  BATTERY_SPEC_SCAN_JSON_SCHEMA,
  MAX_BATTERY_SPEC_LABEL_CHARS,
  batterySpecExtractionIsEmpty,
  emptyBatterySpecExtraction,
  parseBatterySpecExtraction,
} from './battery-spec-scan'

describe('⚠ die Bindung an den Freitext-Weg', () => {
  it('trägt GENAU dieselben vier Zahlenfelder wie `BatteryTextExtraction`', () => {
    /*
     * ⚠ DER WICHTIGSTE TEST DIESER DATEI. Die `satisfies`-Schranke im Modul verhindert eine
     * UMBENENNUNG (ein fremder Name wäre ein Compile-Fehler), sie liesse aber eine Teilmenge zu —
     * und ein hier fehlender Schlüssel bedeutete: das Datenblatt liefert einen Wert, für den es
     * in `BATTERY_VALUE_FIELDS` ein Formularfeld gibt, und der Scan füllt es nie. Die Gleichheit
     * in BEIDE Richtungen ist das, was den zweiten Weg mit dem ersten zusammenhält.
     */
    expect([...BATTERY_SPEC_NUMBER_KEYS]).toEqual([...BATTERY_TEXT_NUMBER_KEYS])
  })

  it('⚠ führt KEIN `hasExistingBattery` — ein Datenblatt sagt nichts über den Besitz', () => {
    // Es beschreibt ein Produkt. Ob der Kunde es besitzt, ist die Weiche über der Wizard-Station.
    expect(Object.keys(emptyBatterySpecExtraction())).not.toContain('hasExistingBattery')
    expect(JSON.stringify(BATTERY_SPEC_SCAN_JSON_SCHEMA)).not.toContain('hasExistingBattery')
  })
})

describe('JSON-Schema', () => {
  it('verlangt jedes Feld und verbietet zusätzliche', () => {
    expect(BATTERY_SPEC_SCAN_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(BATTERY_SPEC_SCAN_JSON_SCHEMA.required).toEqual([
      ...BATTERY_SPEC_LABEL_KEYS,
      ...BATTERY_SPEC_NUMBER_KEYS,
    ])
    expect(Object.keys(BATTERY_SPEC_SCAN_JSON_SCHEMA.properties as object)).toEqual([
      ...BATTERY_SPEC_LABEL_KEYS,
      ...BATTERY_SPEC_NUMBER_KEYS,
    ])
  })

  it('lässt für jedes Feld ausdrücklich null zu — „nicht erkennbar" muss ausdrückbar sein', () => {
    const props = BATTERY_SPEC_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    for (const key of BATTERY_SPEC_LABEL_KEYS) {
      expect(props[key].type).toEqual(['string', 'null'])
      expect(props[key].description).toBeTruthy()
    }
    for (const key of BATTERY_SPEC_NUMBER_KEYS) {
      expect(props[key].type).toEqual(['number', 'null'])
      expect(props[key].description).toBeTruthy()
    }
  })

  it('⚠ nennt die vier Datenblatt-Verwechslungen in den Beschreibungen — sie gehen an das Modell', () => {
    /*
     * Die Beschreibungen sind kein Kommentar: sie reisen im Schema an die API und tun dort die
     * Arbeit. Wer sie beim nächsten Umformulieren verliert, bekommt eine Zahl, die plausibel
     * aussieht und die falsche ist — genau der Fall, gegen den dieser Scan gebaut ist.
     */
    const props = BATTERY_SPEC_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    expect(String(props.capacityKwh.description)).toContain('NUTZBARE')
    expect(String(props.capacityKwh.description)).toContain('NICHT die Brutto-')
    expect(String(props.maxPowerKw.description)).toContain('DAUERHAFTE')
    expect(String(props.maxPowerKw.description)).toContain('KLEINERE')
    expect(String(props.roundTripEfficiencyPercent.description)).toContain('ROUND-TRIP')
    expect(String(props.roundTripEfficiencyPercent.description)).toContain('Wechselrichters')
    expect(String(props.pricePerKwh.description)).toContain('Gesamtpreis')
  })

  it('kombiniert nirgends eine Typ-Union mit einer enum-Liste (die API weist das mit 400 ab)', () => {
    /*
     * Derselbe rekursive Wächter wie in `invoice-scan.test.ts` und `battery-text.test.ts`: er
     * prüft die URSACHE des Totalausfalls vom 31.08.2026, nicht die heutige Form — dadurch ist
     * auch ein Feld abgesichert, das es in diesem Schema noch gar nicht gibt.
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
    walk(BATTERY_SPEC_SCAN_JSON_SCHEMA, '$')
    expect(offenders).toEqual([])
  })
})

describe('parseBatterySpecExtraction — fail closed', () => {
  it('übernimmt eine vollständige Antwort unverändert', () => {
    expect(
      parseBatterySpecExtraction({
        manufacturer: 'Sungrow',
        model: 'SBR128',
        capacityKwh: 12.8,
        maxPowerKw: 6.4,
        roundTripEfficiencyPercent: 95,
        pricePerKwh: 480,
      }),
    ).toEqual({
      manufacturer: 'Sungrow',
      model: 'SBR128',
      capacityKwh: 12.8,
      maxPowerKw: 6.4,
      roundTripEfficiencyPercent: 95,
      pricePerKwh: 480,
    })
  })

  it('macht aus einer unbrauchbaren Antwort ein leeres Ergebnis statt einer Ausnahme', () => {
    for (const raw of [null, undefined, 'nein', 42, [], { egal: true }]) {
      expect(parseBatterySpecExtraction(raw)).toEqual(emptyBatterySpecExtraction())
    }
  })

  it('⚠ verwirft NaN und Infinity — beide sind typeof "number"', () => {
    const parsed = parseBatterySpecExtraction({
      capacityKwh: Number.NaN,
      maxPowerKw: Number.POSITIVE_INFINITY,
      roundTripEfficiencyPercent: Number.NaN,
      pricePerKwh: Number.POSITIVE_INFINITY,
    })
    for (const key of BATTERY_SPEC_NUMBER_KEYS) expect(parsed[key]).toBeNull()
  })

  it('verwirft eine Zahl, die als Zeichenkette kommt — es wird nicht umgedeutet', () => {
    // „12,8" zu parsen hiesse, zwischen 12,8 und 128 zu entscheiden.
    expect(parseBatterySpecExtraction({ capacityKwh: '12.8' }).capacityKwh).toBeNull()
  })

  it('verwirft nicht-positive Angaben — 0 kWh ist keine Batterie', () => {
    expect(parseBatterySpecExtraction({ capacityKwh: 0 }).capacityKwh).toBeNull()
    expect(parseBatterySpecExtraction({ maxPowerKw: -5 }).maxPowerKw).toBeNull()
  })

  it('⚠ verwirft einen Wirkungsgrad über 100 % — physikalisch unmöglich', () => {
    expect(
      parseBatterySpecExtraction({ roundTripEfficiencyPercent: 110 }).roundTripEfficiencyPercent,
    ).toBeNull()
    expect(
      parseBatterySpecExtraction({ roundTripEfficiencyPercent: 100 }).roundTripEfficiencyPercent,
    ).toBe(100)
  })

  it('normalisiert Hersteller und Modell auf eine Zeile, verwirft Leeres und Nicht-Text', () => {
    const parsed = parseBatterySpecExtraction({
      manufacturer: '  BYD \n Battery-Box  ',
      model: '   ',
    })
    expect(parsed.manufacturer).toBe('BYD Battery-Box')
    expect(parsed.model).toBeNull()
    expect(parseBatterySpecExtraction({ manufacturer: 42 }).manufacturer).toBeNull()
  })

  it('⚠ VERWIRFT eine zu lange Beschriftung, statt sie zu kürzen', () => {
    // Eine halbierte Typbezeichnung wäre ein Wert, der so nirgends im Dokument steht.
    const gerade = 'x'.repeat(MAX_BATTERY_SPEC_LABEL_CHARS)
    const zuLang = 'x'.repeat(MAX_BATTERY_SPEC_LABEL_CHARS + 1)
    expect(parseBatterySpecExtraction({ model: gerade }).model).toBe(gerade)
    expect(parseBatterySpecExtraction({ model: zuLang }).model).toBeNull()
  })

  it('lässt keine zusätzlichen Felder durch', () => {
    const parsed = parseBatterySpecExtraction({
      manufacturer: 'Sungrow',
      bruttoKapazitaetKwh: 12.8,
      begruendung: 'Ich habe das aus der Tabelle auf Seite 3 gelesen.',
    })
    expect(Object.keys(parsed).sort()).toEqual(
      [...BATTERY_SPEC_LABEL_KEYS, ...BATTERY_SPEC_NUMBER_KEYS].sort(),
    )
  })

  it('⚠ batterySpecExtractionIsEmpty zählt Hersteller und Modell MIT', () => {
    /*
     * Die Frage ist „hat der Aufruf etwas gelesen?", nicht „ist das Ergebnis brauchbar?". Ein
     * Datenblatt mit Typbezeichnung und ohne eine einzige Kennzahl ist gelesen worden — es ist
     * nur ein schlechtes Datenblatt. Dass die vier Felder trotzdem leer bleiben, meldet die
     * Server Action mit eigenem Satz.
     */
    expect(batterySpecExtractionIsEmpty(emptyBatterySpecExtraction())).toBe(true)
    expect(
      batterySpecExtractionIsEmpty({ ...emptyBatterySpecExtraction(), manufacturer: 'Sungrow' }),
    ).toBe(false)
    expect(
      batterySpecExtractionIsEmpty({ ...emptyBatterySpecExtraction(), capacityKwh: 12.8 }),
    ).toBe(false)
  })
})
