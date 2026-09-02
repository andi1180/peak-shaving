import { describe, expect, it } from 'vitest'

import { COMPASS_DIRECTIONS, compassDirectionInfo } from './pv-design'
import {
  MAX_PV_DESIGN_ARRAYS,
  MAX_PV_DESIGN_LOCATION_CHARS,
  PV_DESIGN_ARRAY_KEYS,
  PV_DESIGN_SCAN_CONVENTIONS,
  PV_DESIGN_SCAN_DIRECTIONS,
  PV_DESIGN_SCAN_JSON_SCHEMA,
  PV_DESIGN_STEEP_SLOPE_DEG,
  emptyPvDesignExtraction,
  parsePvDesignExtraction,
  pvDesignArrayPrefill,
  pvDesignExtractionIsEmpty,
  pvDesignPrefill,
  type PvDesignArrayExtraction,
} from './pv-design-scan'

/**
 * B22c — die prüfbare Hälfte des PV-Auslegungs-Scans.
 *
 * Was hier NICHT geprüft werden kann, ist die Ablesequalität des Modells: dafür braucht es echte
 * Dokumente und einen echten Aufruf (Pflichtenheft §4, offener Punkt „Testmaterial", n = 1).
 * Geprüft wird alles davor und danach: dass das Schema die Form hat, die die API annimmt, dass die
 * Auswertung fail closed arbeitet, und dass die Konventions-Falle strukturell gefangen ist.
 */

function array(patch: Partial<PvDesignArrayExtraction> = {}): PvDesignArrayExtraction {
  return {
    peakPowerKwp: null,
    slopeDeg: null,
    direction: null,
    azimuthDeg: null,
    moduleCount: null,
    ...patch,
  }
}

describe('PV_DESIGN_SCAN_JSON_SCHEMA', () => {
  it('spiegelt die Himmelsrichtungen VOLLSTÄNDIG — sonst kann der Scan eine nicht benennen', () => {
    /*
     * `satisfies` im Modul fängt einen FALSCHEN Wert schon beim Übersetzen; dass die Liste
     * vollständig bleibt, kann nur ein Test sagen. Ohne ihn liesse sich `pv-design.ts` um eine
     * Richtung erweitern, und der Scan könnte sie stillschweigend nie ausgeben.
     */
    expect([...PV_DESIGN_SCAN_DIRECTIONS].sort()).toEqual(
      COMPASS_DIRECTIONS.map((d) => d.key).sort(),
    )
  })

  it('erzwingt jedes Feld und verbietet zusätzliche', () => {
    expect(PV_DESIGN_SCAN_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(PV_DESIGN_SCAN_JSON_SCHEMA.required).toEqual([
      'arrays',
      'azimuthConvention',
      'locationText',
    ])

    const props = PV_DESIGN_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    const items = props.arrays.items as Record<string, unknown>
    expect(items.additionalProperties).toBe(false)
    expect(items.required).toEqual([...PV_DESIGN_ARRAY_KEYS])
    expect(Object.keys(items.properties as Record<string, unknown>)).toEqual([
      ...PV_DESIGN_ARRAY_KEYS,
    ])
  })

  it('lässt für jedes Feld ausdrücklich null zu — „nicht erkennbar" muss ausdrückbar sein', () => {
    const props = PV_DESIGN_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    expect(props.locationText.type).toEqual(['string', 'null'])

    const itemProps = ((props.arrays.items as Record<string, unknown>).properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >
    for (const key of ['peakPowerKwp', 'slopeDeg', 'azimuthDeg', 'moduleCount']) {
      expect(itemProps[key].type).toEqual(['number', 'null'])
    }
    for (const branches of [
      itemProps.direction.anyOf as { type: string }[],
      props.azimuthConvention.anyOf as { type: string }[],
    ]) {
      expect(branches.map((b) => b.type)).toContain('null')
    }
  })

  /*
   * ⚠ DER WÄCHTER GEGEN DEN AUSFALL VOM 31.08.2026, aus `invoice-scan.test.ts` mitgezogen.
   *
   * Die Aufzählungsfelder des Rechnungs-Scans standen als `type: ['string','null']` mit `null` in
   * der `enum`-Liste da. Das ist nach JSON Schema gültig, wird von der API aber mit HTTP 400
   * abgewiesen — BEVOR das Modell das Dokument sieht. Wirkung war ein Totalausfall: jeder Scan
   * endete in `api_error`. Gefunden hat es erst der erste Aufruf gegen die ECHTE API; ein Stub
   * validiert das Schema nicht.
   *
   * Er prüft deshalb nicht „sieht plausibel aus", sondern die eine Kombination, die den Ausfall
   * erzeugt — im GANZEN Baum, auch in einem Feld, das es heute noch gar nicht gibt.
   */
  it('kombiniert nirgends eine Typ-Union mit einer enum-Liste (die API weist das mit 400 ab)', () => {
    const offenders: string[] = []
    const walk = (node: unknown, path: string): void => {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      const obj = node as Record<string, unknown>
      if (Array.isArray(obj.type) && obj.enum !== undefined) offenders.push(path)
      for (const [key, value] of Object.entries(obj)) walk(value, `${path}.${key}`)
    }
    walk(PV_DESIGN_SCAN_JSON_SCHEMA, '$')
    expect(offenders).toEqual([])
  })

  it('bietet für jeden Aufzählungswert genau einen Zweig — die Werte selbst bleiben erzwungen', () => {
    const props = PV_DESIGN_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    const itemProps = ((props.arrays.items as Record<string, unknown>).properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >
    const cases: [Record<string, unknown>, readonly string[]][] = [
      [itemProps.direction, PV_DESIGN_SCAN_DIRECTIONS],
      [props.azimuthConvention, PV_DESIGN_SCAN_CONVENTIONS],
    ]
    for (const [field, values] of cases) {
      const branches = field.anyOf as { type: string; enum?: unknown[] }[]
      expect(branches).toHaveLength(2)
      expect(branches[0]).toEqual({ type: 'string', enum: [...values] })
      expect(branches[1]).toEqual({ type: 'null' })
      expect(branches[0].enum).not.toContain(null)
    }
  })

  it('verlangt vom Modell ausdrücklich die GEDRUCKTE Gradzahl, nicht eine umgerechnete', () => {
    /*
     * Diese Beschreibung geht an das Modell und tut dort die eigentliche Arbeit. Wer sie beim
     * nächsten Umformulieren verliert, öffnet genau die 56-%-Falle: ein Extraktor, der selbst
     * umrechnet, liefert eine Zahl, die zur Himmelsrichtung passt und trotzdem falsch ist.
     */
    const props = PV_DESIGN_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    const itemProps = ((props.arrays.items as Record<string, unknown>).properties ?? {}) as Record<
      string,
      { description: string }
    >
    expect(itemProps.azimuthDeg.description).toContain('GEDRUCKTE')
    expect(itemProps.azimuthDeg.description).toContain('NICHT um')
    // Die Himmelsrichtung darf nicht aus der Zahl erschlossen werden — sonst ist sie kein Kreuzcheck.
    expect(itemProps.direction.description).toContain('NICHT aus der Gradzahl')
  })
})

describe('parsePvDesignExtraction', () => {
  it('liest eine vollständige Antwort mit zwei Modulflächen', () => {
    const result = parsePvDesignExtraction({
      arrays: [
        { peakPowerKwp: 4.25, slopeDeg: 90, direction: 'SO', azimuthDeg: 133, moduleCount: 10 },
        { peakPowerKwp: 5.95, slopeDeg: 90, direction: 'SO', azimuthDeg: 133, moduleCount: 14 },
      ],
      azimuthConvention: 'from_north',
      locationText: 'Wien 11, AUT (1996 - 2015)',
    })

    expect(result.arrays).toHaveLength(2)
    expect(result.arrays[0]).toEqual({
      peakPowerKwp: 4.25,
      slopeDeg: 90,
      direction: 'SO',
      azimuthDeg: 133,
      moduleCount: 10,
    })
    expect(result.azimuthConvention).toBe('from_north')
    expect(result.locationText).toBe('Wien 11, AUT (1996 - 2015)')
  })

  it('ergibt bei einer unbrauchbaren Antwort ein leeres Ergebnis statt einer Ausnahme', () => {
    for (const raw of [null, undefined, 'nein', 42, [], { arrays: 'keine' }]) {
      expect(parsePvDesignExtraction(raw)).toEqual(emptyPvDesignExtraction())
    }
  })

  it('weist NaN, Infinity und Zahlen als Zeichenkette ab — sie sind keine Angabe', () => {
    const result = parsePvDesignExtraction({
      arrays: [
        {
          peakPowerKwp: Number.NaN,
          slopeDeg: Number.POSITIVE_INFINITY,
          direction: 'S',
          azimuthDeg: '133',
          moduleCount: '10',
        },
      ],
      azimuthConvention: null,
      locationText: null,
    })
    expect(result.arrays[0]).toEqual({
      peakPowerKwp: null,
      slopeDeg: null,
      direction: 'S',
      azimuthDeg: null,
      moduleCount: null,
    })
  })

  it('weist eine Neigung ausserhalb 0–90° und eine unsinnige Nennleistung ab', () => {
    const result = parsePvDesignExtraction({
      arrays: [
        { peakPowerKwp: -5, slopeDeg: 120, direction: 'S', azimuthDeg: null, moduleCount: null },
      ],
      azimuthConvention: null,
      locationText: null,
    })
    expect(result.arrays[0]?.peakPowerKwp).toBeNull()
    expect(result.arrays[0]?.slopeDeg).toBeNull()
  })

  it('verwirft eine durchweg leere Modulfläche — sie ist Rauschen, kein Ergebnis', () => {
    const result = parsePvDesignExtraction({
      arrays: [
        { peakPowerKwp: null, slopeDeg: null, direction: null, azimuthDeg: null, moduleCount: null },
        { peakPowerKwp: 4.25, slopeDeg: null, direction: null, azimuthDeg: null, moduleCount: null },
      ],
      azimuthConvention: null,
      locationText: null,
    })
    expect(result.arrays).toHaveLength(1)
    expect(result.arrays[0]?.peakPowerKwp).toBe(4.25)
  })

  it('kappt eine ausufernde Liste VOR der Auswertung', () => {
    const many = Array.from({ length: MAX_PV_DESIGN_ARRAYS + 5 }, () => ({
      peakPowerKwp: 1,
      slopeDeg: 30,
      direction: 'S',
      azimuthDeg: null,
      moduleCount: null,
    }))
    expect(parsePvDesignExtraction({ arrays: many }).arrays).toHaveLength(MAX_PV_DESIGN_ARRAYS)
  })

  it('nimmt eine Ortsbeschriftung wörtlich, verwirft aber Prosa statt sie zu kürzen', () => {
    expect(parsePvDesignExtraction({ locationText: '  Wien 11,\n AUT  ' }).locationText).toBe(
      'Wien 11, AUT',
    )
    expect(parsePvDesignExtraction({ locationText: '   ' }).locationText).toBeNull()
    /*
     * Eine gekürzte Beschriftung wäre ein Wert, der so nirgends im Dokument steht — und dieselbe
     * Angabe halb dargestellt ist irreführender als gar keine. Ausserdem ist ein langer Text keine
     * Ortsangabe mehr, sondern genau die Modell-Prosa, die in dieser Rückgabe nichts verloren hat.
     */
    const prosa = 'x'.repeat(MAX_PV_DESIGN_LOCATION_CHARS + 1)
    expect(parsePvDesignExtraction({ locationText: prosa }).locationText).toBeNull()
  })

  it('weist unbekannte Aufzählungswerte ab', () => {
    const result = parsePvDesignExtraction({
      arrays: [{ direction: 'SSO' }],
      azimuthConvention: 'from_east',
    })
    expect(result.arrays).toHaveLength(0)
    expect(result.azimuthConvention).toBeNull()
  })

  it('nennt „nichts vorbelegbar" nur an den Modulflächen, nicht am Standort', () => {
    // Nur der Standort gelesen: es gibt kein Formularfeld, das davon etwas hätte (die PLZ wird
    // ausdrücklich NICHT abgeleitet) — das ist `unreadable`, kein Teilerfolg.
    expect(
      pvDesignExtractionIsEmpty(parsePvDesignExtraction({ locationText: 'Wien 11, AUT' })),
    ).toBe(true)
    expect(
      pvDesignExtractionIsEmpty(parsePvDesignExtraction({ arrays: [{ peakPowerKwp: 4.25 }] })),
    ).toBe(false)
  })
})

describe('pvDesignArrayPrefill — der Fang der Azimut-Konventions-Falle', () => {
  it('übernimmt Gradzahl UND Richtung, wenn beide zusammenpassen (der reale Urbanz-Fall)', () => {
    // „Ausrichtung Südosten 133 °" — Südost liegt bei 135°, Abstand 2°, also stimmig.
    const p = pvDesignArrayPrefill(array({ direction: 'SO', azimuthDeg: 133 }), 'from_north')
    expect(p.direction).toBe('SO')
    expect(p.compassDeg).toBe(133)
    expect(p.degreeConflict).toBeNull()
    expect(p.unverifiedDeg).toBeNull()
  })

  it('übernimmt die Gradzahl NICHT, wenn sie der Himmelsrichtung widerspricht', () => {
    /*
     * ⚠ DAS IST DER TEURE FALL. „Nordwesten" mit einer 133 daneben heisst: die Zahl ist in einer
     * anderen Zählweise gedruckt, als das Feld sie erwartet. Übernommen zeigte die Anlage in die
     * Gegenrichtung und die Ersparnis fiele gemessen um 56 % — bei einer Zahl, die plausibel
     * aussieht. Vorbelegt wird deshalb NUR die Richtung (ein Wort ist über Zählweisen hinweg
     * eindeutig), und der Widerspruch wird benannt.
     */
    const p = pvDesignArrayPrefill(array({ direction: 'NW', azimuthDeg: 133 }), 'from_north')
    expect(p.direction).toBe('NW')
    expect(p.compassDeg).toBeNull()
    expect(p.degreeConflict).toEqual({ printedDeg: 133, candidateCompassDeg: 133, direction: 'NW' })
  })

  it('rechnet eine „from_south"-Zahl um — und prüft das Ergebnis trotzdem gegen die Richtung', () => {
    // PVGIS-Zählung: −47 ist Kompass 133 und damit Südosten. Die Umrechnung kommt aus
    // `pvgisAzimuthToCompass` (pv-design.ts), nicht aus einer zweiten Formel hier.
    const ok = pvDesignArrayPrefill(array({ direction: 'SO', azimuthDeg: -47 }), 'from_south')
    expect(ok.compassDeg).toBe(133)
    expect(ok.degreeConflict).toBeNull()

    // Dieselbe Zahl gegen eine unpassende Richtung bleibt abgewiesen — die Umrechnung ersetzt den
    // Kreuzcheck nicht, sie geht ihm voraus.
    const bad = pvDesignArrayPrefill(array({ direction: 'NW', azimuthDeg: -47 }), 'from_south')
    expect(bad.compassDeg).toBeNull()
    expect(bad.degreeConflict?.candidateCompassDeg).toBe(133)
  })

  it('fängt die Zählweise auch dann ab, wenn sie NICHT gelesen wurde', () => {
    /*
     * Ohne Angabe gilt die Kompass-Zählung (die bei Planungswerkzeugen weitaus häufigere). Liegt
     * das Dokument tatsächlich in der PVGIS-Zählung, passt der Kandidat nicht zur Richtung und das
     * Feld bleibt leer — statt um 180° verdreht vorbelegt zu werden. Genau deshalb ist die Annahme
     * ungefährlich: sie steht IMMER unter dem Kreuzcheck.
     */
    const p = pvDesignArrayPrefill(array({ direction: 'SO', azimuthDeg: -47 }), null)
    expect(p.compassDeg).toBeNull()
    expect(p.degreeConflict).not.toBeNull()
  })

  it('zeigt eine Gradzahl ohne Himmelsrichtung an, übernimmt sie aber nicht', () => {
    // Ohne Richtung fehlt der Kreuzcheck vollständig: 133 könnte Südost oder Nordwest heissen.
    const p = pvDesignArrayPrefill(array({ azimuthDeg: 133 }), 'from_north')
    expect(p.compassDeg).toBeNull()
    expect(p.degreeConflict).toBeNull()
    expect(p.unverifiedDeg).toBe(133)
  })

  it('lässt eine Richtung ohne Gradzahl unbeanstandet — dann gilt die Sektormitte', () => {
    const p = pvDesignArrayPrefill(array({ direction: 'S' }), 'from_north')
    expect(p.direction).toBe('S')
    expect(p.compassDeg).toBeNull()
    expect(p.degreeConflict).toBeNull()
    expect(p.unverifiedDeg).toBeNull()
    expect(compassDirectionInfo('S').compassDeg).toBe(180)
  })

  it('markiert eine ungewöhnlich steile Neigung, sperrt sie aber nicht', () => {
    /*
     * Das vorliegende Dokument nennt 90° bei gleichzeitig „Einbausituation: Dachparallel". Der
     * Widerspruch ist aus dem Dokument nicht auflösbar (Pflichtenheft §4) — deshalb wird der Wert
     * übernommen UND sichtbar markiert, nicht stillschweigend genommen und nicht abgewiesen.
     */
    expect(pvDesignArrayPrefill(array({ slopeDeg: 90 }), null).steepSlope).toBe(true)
    expect(pvDesignArrayPrefill(array({ slopeDeg: 90 }), null).slopeDeg).toBe(90)
    expect(
      pvDesignArrayPrefill(array({ slopeDeg: PV_DESIGN_STEEP_SLOPE_DEG }), null).steepSlope,
    ).toBe(true)
    expect(pvDesignArrayPrefill(array({ slopeDeg: 30 }), null).steepSlope).toBe(false)
    expect(pvDesignArrayPrefill(array({ slopeDeg: null }), null).steepSlope).toBe(false)
  })

  it('reicht die Modulzahl durch, ohne dass sie ein Formularfeld belegt', () => {
    const p = pvDesignArrayPrefill(array({ moduleCount: 10, peakPowerKwp: 4.25 }), null)
    expect(p.moduleCount).toBe(10)
    expect(p.peakPowerKwp).toBe(4.25)
  })

  it('wendet dieselbe Zählweise auf ALLE Flächen an', () => {
    const prefills = pvDesignPrefill({
      arrays: [
        array({ direction: 'SO', azimuthDeg: -47 }),
        array({ direction: 'SW', azimuthDeg: 45 }),
      ],
      azimuthConvention: 'from_south',
      locationText: null,
    })
    expect(prefills.map((p) => p.compassDeg)).toEqual([133, 225])
  })
})
