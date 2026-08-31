import { describe, expect, it } from 'vitest'

import { GRUNDPREIS_UNITS, METERING_VARIANTS, NETZEBENEN, PRICE_BASES } from './grid-tariffs'
import {
  TARIFF_SHEET_SCAN_JSON_SCHEMA,
  TARIFF_SHEET_WINDOW_KEYS,
  emptyTariffSheetExtraction,
  parseTariffSheetExtraction,
  tariffSheetExtractionIsEmpty,
} from './tariff-sheet-scan'

/**
 * Der prüfbare Teil des Tarifblatt-Scans.
 *
 * ⚠ WAS HIER NICHT GEPRÜFT WIRD, UND WARUM: die QUALITÄT der Extraktion. Ob ein Sprachmodell das
 * SNAP-Fenster auf einem Wiener-Netze-Preisblatt findet, entscheidet kein Unit-Test, sondern ein
 * Aufruf gegen ein echtes Blatt. Was hier steht, ist die andere Hälfte und die härtere: dass eine
 * schlechte, halbe oder feindliche Antwort NICHT als Tarifstand durchläuft — und der ist hier
 * nachträglich nicht mehr korrigierbar.
 */

/** Eine vollständige Roh-Antwort, wie das Modell sie unter dem Schema liefern soll. */
function completeRaw() {
  return {
    operatorName: 'Wiener Netze GmbH',
    netzebene: 7,
    meteringVariant: 'mit_leistungsmessung',
    grundpreisAmount: 38.52,
    grundpreisUnit: 'eur_per_kw_year',
    netzverlustCtPerKwh: 1.23,
    priceBasis: 'net',
    validFrom: '2026-01-01',
    windows: [
      {
        label: 'normal',
        monthDayFrom: null,
        monthDayTo: null,
        timeFrom: '00:00',
        timeTo: '24:00',
        ctPerKwh: 4.14,
      },
      {
        label: 'snap',
        monthDayFrom: '10-01',
        monthDayTo: '03-31',
        timeFrom: '17:00',
        timeTo: '20:00',
        ctPerKwh: 9.9,
      },
    ],
  }
}

describe('JSON-Schema', () => {
  it('verlangt jedes Feld und verbietet zusätzliche — „weggelassen" ist kein zweiter Weg zu null', () => {
    expect(TARIFF_SHEET_SCAN_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(TARIFF_SHEET_SCAN_JSON_SCHEMA.required).toEqual([
      'operatorName',
      'netzebene',
      'meteringVariant',
      'grundpreisAmount',
      'grundpreisUnit',
      'netzverlustCtPerKwh',
      'priceBasis',
      'validFrom',
      'windows',
    ])

    const props = TARIFF_SHEET_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    const items = props.windows!.items as Record<string, unknown>
    expect(items.additionalProperties).toBe(false)
    expect(items.required).toEqual([...TARIFF_SHEET_WINDOW_KEYS])
  })

  /*
   * ⚠ DER WÄCHTER GEGEN DEN AUSFALL VOM 31.08.2026.
   *
   * Im Rechnungs-Scan standen die Aufzählungsfelder als `type: ['string', 'null']` mit `null` in
   * der `enum`-Liste. Das ist nach JSON Schema gültig, wird von der API aber mit HTTP 400
   * abgewiesen — BEVOR das Modell das Dokument sieht. Wirkung dort: JEDER Scan endete in
   * `api_error`, das Modul war in Produktion vollständig funktionslos, und gefunden hat es erst
   * der erste Aufruf gegen die ECHTE API (ein Stub validiert das Schema nicht).
   *
   * Dieses Schema schreibt die Fassung erneut aus, statt sie zu importieren (der Rechnungs-Scan
   * bleibt unangetastet). Genau deshalb steht der Wächter auch hier — und er prüft nicht „sieht
   * plausibel aus", sondern die eine Kombination, die den Ausfall erzeugt: Typ-Union UND `enum`
   * an derselben Stelle, irgendwo im ganzen Baum, auch in einem Feld, das es heute nicht gibt.
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

    walk(TARIFF_SHEET_SCAN_JSON_SCHEMA, '$')
    expect(offenders).toEqual([])
  })

  it('bietet für jeden Aufzählungswert genau einen Zweig — die Werte selbst bleiben erzwungen', () => {
    const props = TARIFF_SHEET_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    const expected: Record<string, { type: string; values: readonly (string | number)[] }> = {
      netzebene: { type: 'integer', values: NETZEBENEN },
      meteringVariant: { type: 'string', values: METERING_VARIANTS },
      grundpreisUnit: { type: 'string', values: GRUNDPREIS_UNITS },
      priceBasis: { type: 'string', values: PRICE_BASES },
    }

    for (const [key, { type, values }] of Object.entries(expected)) {
      const branches = props[key]!.anyOf as { type: string; enum?: unknown[] }[]
      expect(branches).toHaveLength(2)
      expect(branches[0]).toEqual({ type, enum: [...values] })
      expect(branches[1]).toEqual({ type: 'null' })
      expect(branches[0]!.enum).not.toContain(null)
    }
  })

  it('führt die Fensterfelder in derselben Reihenfolge wie der Typ', () => {
    const props = TARIFF_SHEET_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    const items = props.windows!.items as { properties: Record<string, unknown> }
    expect(Object.keys(items.properties)).toEqual([...TARIFF_SHEET_WINDOW_KEYS])
  })
})

describe('parseTariffSheetExtraction — der Gutfall', () => {
  it('übernimmt eine vollständige Antwort unverändert, inklusive beider Fenster', () => {
    const result = parseTariffSheetExtraction(completeRaw())

    expect(result.operatorName).toBe('Wiener Netze GmbH')
    expect(result.netzebene).toBe(7)
    expect(result.meteringVariant).toBe('mit_leistungsmessung')
    expect(result.grundpreisAmount).toBe(38.52)
    expect(result.grundpreisUnit).toBe('eur_per_kw_year')
    expect(result.netzverlustCtPerKwh).toBe(1.23)
    expect(result.priceBasis).toBe('net')
    expect(result.validFrom).toBe('2026-01-01')
    expect(result.windows).toHaveLength(2)
    expect(result.windows[1]).toEqual({
      label: 'snap',
      monthDayFrom: '10-01',
      monthDayTo: '03-31',
      timeFrom: '17:00',
      timeTo: '20:00',
      ctPerKwh: 9.9,
    })
  })

  it('nimmt 24:00 als Tagesende an — das Formular kennt es, der Zeitwähler des Browsers nicht', () => {
    const result = parseTariffSheetExtraction(completeRaw())
    expect(result.windows[0]!.timeTo).toBe('24:00')
  })
})

describe('parseTariffSheetExtraction — fail closed', () => {
  it('macht aus einer unbrauchbaren Antwort ein leeres Ergebnis statt einer Ausnahme', () => {
    for (const raw of [null, undefined, 42, 'text', [], {}]) {
      const result = parseTariffSheetExtraction(raw)
      expect(tariffSheetExtractionIsEmpty(result)).toBe(true)
      expect(result).toEqual(emptyTariffSheetExtraction())
    }
  })

  it('weist NaN, Infinity, negative Beträge und Zahlen als Zeichenkette ab', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, '1.23', null]) {
      const result = parseTariffSheetExtraction({
        ...completeRaw(),
        netzverlustCtPerKwh: bad,
      })
      expect(result.netzverlustCtPerKwh).toBeNull()
      // Der Rest der Antwort bleibt unberührt — es wird Feld für Feld zurückgesetzt.
      expect(result.grundpreisAmount).toBe(38.52)
    }
  })

  it('lässt einen unbekannten Aufzählungswert fallen, statt ihn durchzureichen', () => {
    const result = parseTariffSheetExtraction({
      ...completeRaw(),
      netzebene: 2,
      meteringVariant: 'gemessen',
      priceBasis: 'netto',
    })
    expect(result.netzebene).toBeNull()
    expect(result.meteringVariant).toBeNull()
    expect(result.priceBasis).toBeNull()
  })

  it('weist ein Datum ab, das dem Muster entspricht und kein Tag ist', () => {
    // 2026-02-31 passt auf JJJJ-MM-TT und würde vom Formular still auf den 3. März verschoben.
    for (const bad of ['2026-02-31', '2026-13-01', '01.01.2026', '2026-1-1', '']) {
      expect(parseTariffSheetExtraction({ ...completeRaw(), validFrom: bad }).validFrom).toBeNull()
    }
    expect(
      parseTariffSheetExtraction({ ...completeRaw(), validFrom: '2026-02-28' }).validFrom,
    ).toBe('2026-02-28')
  })
})

describe('Betrag und Einheit gelten nur als Paar', () => {
  /*
   * Die schärfste Regel dieses Moduls. Ein übernommener Betrag ohne gelesene Einheit behauptete
   * einen LEISTUNGSPREIS (die Formular-Vorbelegung), auch wenn auf dem Blatt eine Jahrespauschale
   * steht — und das ist der Unterschied zwischen „Spitzenkappung lohnt sich" und „Leistungspreis 0,
   * gar keine Spitzenkappung" (Delta 3).
   */
  it('verwirft den Betrag, wenn die Einheit fehlt', () => {
    const result = parseTariffSheetExtraction({ ...completeRaw(), grundpreisUnit: null })
    expect(result.grundpreisAmount).toBeNull()
    expect(result.grundpreisUnit).toBeNull()
  })

  it('verwirft die Einheit, wenn der Betrag fehlt', () => {
    const result = parseTariffSheetExtraction({ ...completeRaw(), grundpreisAmount: null })
    expect(result.grundpreisAmount).toBeNull()
    expect(result.grundpreisUnit).toBeNull()
  })

  it('hält beide, wenn beide dastehen — auch bei der Jahrespauschale', () => {
    const result = parseTariffSheetExtraction({
      ...completeRaw(),
      grundpreisAmount: 120,
      grundpreisUnit: 'eur_per_year',
    })
    expect(result.grundpreisAmount).toBe(120)
    expect(result.grundpreisUnit).toBe('eur_per_year')
  })
})

describe('Zeitfenster', () => {
  const base = completeRaw()

  function windowsOf(patch: Record<string, unknown>) {
    return parseTariffSheetExtraction({
      ...base,
      windows: [{ ...base.windows[1], ...patch }],
    }).windows
  }

  it.each([
    ['ohne Bezeichnung', { label: null }],
    ['ohne Beginn', { timeFrom: null }],
    ['ohne Ende', { timeTo: null }],
    ['ohne Arbeitspreis', { ctPerKwh: null }],
    ['mit unbrauchbarer Uhrzeit', { timeTo: '25:00' }],
    ['mit negativem Arbeitspreis', { ctPerKwh: -1 }],
  ])('verwirft ein Fenster %s vollständig, statt es zu ergänzen', (_label, patch) => {
    expect(windowsOf(patch)).toEqual([])
  })

  it('behält die vollständigen Fenster, wenn eines dazwischen unbrauchbar ist', () => {
    const result = parseTariffSheetExtraction({
      ...base,
      windows: [base.windows[0], { label: 'kaputt' }, base.windows[1]],
    })
    expect(result.windows.map((w) => w.label)).toEqual(['normal', 'snap'])
  })

  it('macht aus einer halb gelesenen Saison ganzjährig — beide Grenzen gelten nur gemeinsam', () => {
    expect(windowsOf({ monthDayTo: null })[0]!).toMatchObject({
      monthDayFrom: null,
      monthDayTo: null,
      label: 'snap',
    })
    expect(windowsOf({ monthDayFrom: '13-01' })[0]!).toMatchObject({
      monthDayFrom: null,
      monthDayTo: null,
    })
  })

  it('nimmt ein fehlendes oder falsch getipptes windows-Feld als leere Liste', () => {
    for (const bad of [null, undefined, 'normal', {}]) {
      expect(parseTariffSheetExtraction({ ...base, windows: bad }).windows).toEqual([])
    }
  })
})

describe('tariffSheetExtractionIsEmpty', () => {
  it('erkennt ein Ergebnis, in dem NUR Fenster stehen, als nicht leer', () => {
    const result = parseTariffSheetExtraction({ windows: completeRaw().windows })
    expect(result.windows).toHaveLength(2)
    expect(tariffSheetExtractionIsEmpty(result)).toBe(false)
  })

  it('erkennt ein Ergebnis, in dem NUR der Name steht, als nicht leer', () => {
    const result = parseTariffSheetExtraction({ operatorName: 'Netz Oberösterreich GmbH' })
    expect(tariffSheetExtractionIsEmpty(result)).toBe(false)
  })
})
