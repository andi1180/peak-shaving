import { describe, expect, it } from 'vitest'

import { GRUNDPREIS_UNITS, METERING_VARIANTS, NETZEBENEN, PRICE_BASES } from './grid-tariffs'
import {
  TARIFF_SHEET_CANDIDATE_KEYS,
  TARIFF_SHEET_SCAN_JSON_SCHEMA,
  TARIFF_SHEET_WINDOW_KEYS,
  candidateIdentityKey,
  emptyTariffSheetExtraction,
  parseTariffSheetExtraction,
  tariffSheetExtractionIsEmpty,
  tariffSheetFormPrefill,
} from './tariff-sheet-scan'

/**
 * Der prüfbare Teil des Tarifblatt-Scans.
 *
 * ⚠ WAS HIER NICHT GEPRÜFT WIRD, UND WARUM: die QUALITÄT der Extraktion. Ob ein Sprachmodell alle
 * sieben Tarifzeilen eines Wiener-Netze-Preisblatts findet, entscheidet kein Unit-Test, sondern ein
 * Aufruf gegen ein echtes Blatt. Was hier steht, ist die andere Hälfte und die härtere: dass eine
 * schlechte, halbe oder feindliche Antwort NICHT als Tarifstand durchläuft — und der ist hier
 * nachträglich nicht mehr korrigierbar.
 */

/** Ein vollständiger Kandidat, wie das Modell ihn unter dem Schema liefern soll. */
function candidateRaw(patch: Record<string, unknown> = {}) {
  return {
    netzebene: 7,
    meteringVariant: 'mit_leistungsmessung',
    grundpreisAmount: 38.52,
    grundpreisUnit: 'eur_per_kw_year',
    netzverlustCtPerKwh: 1.23,
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
    ...patch,
  }
}

/** Eine vollständige Roh-Antwort: blattweite Angaben plus ein Kandidat. */
function completeRaw(patch: Record<string, unknown> = {}) {
  return {
    operatorName: 'Wiener Netze GmbH',
    priceBasis: 'net',
    validFrom: '2026-01-01',
    candidates: [candidateRaw()],
    ...patch,
  }
}

describe('JSON-Schema', () => {
  it('verlangt jedes Feld und verbietet zusätzliche — „weggelassen" ist kein zweiter Weg zu null', () => {
    expect(TARIFF_SHEET_SCAN_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(TARIFF_SHEET_SCAN_JSON_SCHEMA.required).toEqual([
      'operatorName',
      'priceBasis',
      'validFrom',
      'candidates',
    ])

    const props = TARIFF_SHEET_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    const candidate = props.candidates!.items as Record<string, unknown>
    expect(candidate.additionalProperties).toBe(false)
    expect(candidate.required).toEqual([...TARIFF_SHEET_CANDIDATE_KEYS])

    const candidateProps = candidate.properties as Record<string, Record<string, unknown>>
    const window = candidateProps.windows!.items as Record<string, unknown>
    expect(window.additionalProperties).toBe(false)
    expect(window.required).toEqual([...TARIFF_SHEET_WINDOW_KEYS])
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
   *
   * ⚠ Seit der Mehr-Ebenen-Extraktion liegen die Aufzählungsfelder ZWEI Ebenen tief (in den `items`
   * der Kandidatenliste). Der Durchlauf ist rekursiv und erfasst sie deshalb weiterhin — ein Test,
   * der nur die obersten `properties` gelesen hätte, wäre mit dem Umbau still blind geworden.
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

  it('bietet für jeden nullbaren Aufzählungswert genau einen Zweig — die Werte bleiben erzwungen', () => {
    const props = TARIFF_SHEET_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    const candidateProps = (props.candidates!.items as { properties: Record<string, unknown> })
      .properties as Record<string, Record<string, unknown>>

    const expected: Record<string, { type: string; values: readonly (string | number)[] }> = {
      meteringVariant: { type: 'string', values: METERING_VARIANTS },
      grundpreisUnit: { type: 'string', values: GRUNDPREIS_UNITS },
    }

    for (const [key, { type, values }] of Object.entries(expected)) {
      const branches = candidateProps[key]!.anyOf as { type: string; enum?: unknown[] }[]
      expect(branches).toHaveLength(2)
      expect(branches[0]).toEqual({ type, enum: [...values] })
      expect(branches[1]).toEqual({ type: 'null' })
      expect(branches[0]!.enum).not.toContain(null)
    }

    const priceBasis = props.priceBasis!.anyOf as { type: string; enum?: unknown[] }[]
    expect(priceBasis[0]).toEqual({ type: 'string', enum: [...PRICE_BASES] })
    expect(priceBasis[1]).toEqual({ type: 'null' })
  })

  /*
   * ⚠ `netzebene` ist als EINZIGES Feld nicht nullbar — es ist die Identität des Eintrags. Ein
   * `anyOf` mit `{type:'null'}` hier wäre kein harmloser Überschuss, sondern die Erlaubnis, eine
   * Tarifzeile ohne Adresse zu liefern; die Auswertung wirft sie zwar weg, aber die ANWEISUNG an
   * das Modell wäre dann eine andere als die, die im System-Prompt steht.
   */
  it('lässt die Netzebene eines Kandidaten NICHT null sein', () => {
    const props = TARIFF_SHEET_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    const candidateProps = (props.candidates!.items as { properties: Record<string, unknown> })
      .properties as Record<string, Record<string, unknown>>

    const netzebene = candidateProps.netzebene!
    expect(netzebene.anyOf).toBeUndefined()
    expect(netzebene.type).toBe('integer')
    expect(netzebene.enum).toEqual([...NETZEBENEN])
  })

  it('führt Kandidaten- und Fensterfelder in derselben Reihenfolge wie die Typen', () => {
    const props = TARIFF_SHEET_SCAN_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    const candidate = props.candidates!.items as { properties: Record<string, unknown> }
    expect(Object.keys(candidate.properties)).toEqual([...TARIFF_SHEET_CANDIDATE_KEYS])

    const window = (candidate.properties as Record<string, Record<string, unknown>>).windows!
      .items as { properties: Record<string, unknown> }
    expect(Object.keys(window.properties)).toEqual([...TARIFF_SHEET_WINDOW_KEYS])
  })
})

describe('parseTariffSheetExtraction — der Gutfall', () => {
  it('übernimmt eine vollständige Antwort unverändert, inklusive beider Fenster', () => {
    const result = parseTariffSheetExtraction(completeRaw())

    expect(result.operatorName).toBe('Wiener Netze GmbH')
    expect(result.priceBasis).toBe('net')
    expect(result.validFrom).toBe('2026-01-01')
    expect(result.candidates).toHaveLength(1)

    const candidate = result.candidates[0]!
    expect(candidate.netzebene).toBe(7)
    expect(candidate.meteringVariant).toBe('mit_leistungsmessung')
    expect(candidate.grundpreisAmount).toBe(38.52)
    expect(candidate.grundpreisUnit).toBe('eur_per_kw_year')
    expect(candidate.netzverlustCtPerKwh).toBe(1.23)
    expect(candidate.windows).toHaveLength(2)
    expect(candidate.windows[1]).toEqual({
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
    expect(result.candidates[0]!.windows[0]!.timeTo).toBe('24:00')
  })
})

/**
 * ⚠ DIE TRAGENDE FESTSTELLUNG DIESES MODULS.
 *
 * Die Identität eines Kandidaten ist das PAAR (netzebene, meteringVariant), nicht die Netzebene
 * allein. Netzebene 7 mit drei Messvarianten sind DREI Tarifzeilen — dieselbe Schlüsselform, die
 * auch der `unique nulls not distinct`-Constraint aus B21-1 benutzt. Eine Auswertung, die nach
 * `netzebene` zusammenfasste, verlöre zwei Leistungspreise, und zwar unbemerkt: das Ergebnis sähe
 * vollständig aus.
 */
describe('Kandidaten-Identität', () => {
  const threeVariants = completeRaw({
    candidates: METERING_VARIANTS.map((variant) =>
      candidateRaw({ meteringVariant: variant, grundpreisAmount: 10 }),
    ),
  })

  it('hält drei Messvarianten derselben Netzebene als DREI Einträge auseinander', () => {
    const result = parseTariffSheetExtraction(threeVariants)
    expect(result.candidates).toHaveLength(3)
    expect(result.candidates.map((c) => c.netzebene)).toEqual([7, 7, 7])
    expect(result.candidates.map((c) => c.meteringVariant)).toEqual([...METERING_VARIANTS])
  })

  it('bildet je Kombination eine eigene Kennung — nie zweimal dieselbe', () => {
    const result = parseTariffSheetExtraction(threeVariants)
    const keys = result.candidates.map(candidateIdentityKey)
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('ne7-mit_leistungsmessung')
  })

  it('unterscheidet „keine Variante" von einer gesetzten', () => {
    expect(candidateIdentityKey({ netzebene: 3, meteringVariant: null })).toBe('ne3-keine')
    expect(candidateIdentityKey({ netzebene: 3, meteringVariant: 'unterbrechbar' })).toBe(
      'ne3-unterbrechbar',
    )
  })

  /*
   * Zwei Einträge derselben Kombination sind ein Widerspruch, kein zweiter Stand: sie könnten gar
   * nicht beide angelegt werden (der zweite liefe in `invalid_valid_from`, und zwar erst NACHDEM
   * der erste in der Datenbank steht). Es gewinnt der ERSTE — die Reihenfolge des Blattes.
   */
  it('verwirft eine Dublette derselben Kombination und behält den ersten Eintrag', () => {
    const result = parseTariffSheetExtraction(
      completeRaw({
        candidates: [
          candidateRaw({ grundpreisAmount: 38.52 }),
          candidateRaw({ grundpreisAmount: 99.99 }),
          candidateRaw({ netzebene: 3, meteringVariant: null }),
        ],
      }),
    )
    expect(result.candidates).toHaveLength(2)
    expect(result.candidates[0]!.grundpreisAmount).toBe(38.52)
    expect(result.candidates[1]!.netzebene).toBe(3)
  })
})

/**
 * ⚠ EIN FEHLERHAFTER KANDIDAT REISST DIE ÜBRIGEN NICHT MIT.
 *
 * Die Alternative — bei einem kaputten Eintrag das ganze Blatt zu verwerfen — machte aus einem
 * Lesefehler in EINER Zeile ein vollständig abzutippendes Preisblatt.
 */
describe('Kandidaten — fail closed je Eintrag', () => {
  /*
   * ⚠ DIE UNBRAUCHBAREN EINTRÄGE TRAGEN EINE EIGENE MESSVARIANTE, UND DAS IST ABSICHT.
   *
   * Mit `meteringVariant: null` wären sie unter einem Fehler, der die Netzebene auf einen festen
   * Wert zurückfallen liesse, zu DUBLETTEN der gültigen Zeilen geworden — der Dublettenfilter hätte
   * sie weggeräumt, und dieser Test wäre GRÜN geblieben, obwohl die Regel gebrochen ist. Gemessen:
   * genau so ist es beim ersten Wächter-Lauf passiert. Mit eigener Variante bilden sie eine eigene
   * Identität, überstehen den Dublettenfilter und tauchen im Ergebnis auf, sobald sie nicht mehr
   * verworfen werden. Ein Wächter, der nur bei Glück anschlägt, ist keiner.
   */
  it('verwirft einen Eintrag ohne brauchbare Netzebene und lässt die übrigen unberührt', () => {
    const result = parseTariffSheetExtraction(
      completeRaw({
        candidates: [
          candidateRaw({ netzebene: 3, meteringVariant: null }),
          candidateRaw({ netzebene: 4, meteringVariant: null }),
          candidateRaw({ netzebene: 2, meteringVariant: 'unterbrechbar' }), // ausserhalb des Bereichs
          candidateRaw({ netzebene: null, meteringVariant: 'mit_leistungsmessung' }),
          candidateRaw({ netzebene: 5, meteringVariant: null }),
          candidateRaw({ netzebene: 6, meteringVariant: null }),
        ],
      }),
    )
    expect(result.candidates.map((c) => c.netzebene)).toEqual([3, 4, 5, 6])
    expect(result.candidates.map((c) => c.meteringVariant)).toEqual([null, null, null, null])
  })

  it('verwirft einen Eintrag, der gar kein Objekt ist, ohne zu werfen', () => {
    const result = parseTariffSheetExtraction(
      completeRaw({ candidates: [null, 'ne7', 42, [], candidateRaw()] }),
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]!.netzebene).toBe(7)
  })

  it('setzt NUR das betroffene Feld eines Eintrags zurück, nicht den ganzen Eintrag', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, '1.23', null]) {
      const result = parseTariffSheetExtraction(
        completeRaw({ candidates: [candidateRaw({ netzverlustCtPerKwh: bad })] }),
      )
      const candidate = result.candidates[0]!
      expect(candidate.netzverlustCtPerKwh).toBeNull()
      expect(candidate.grundpreisAmount).toBe(38.52)
      expect(candidate.windows).toHaveLength(2)
    }
  })

  it('lässt einen unbekannten Aufzählungswert fallen, statt ihn durchzureichen', () => {
    const result = parseTariffSheetExtraction(
      completeRaw({
        priceBasis: 'netto',
        candidates: [candidateRaw({ meteringVariant: 'gemessen' })],
      }),
    )
    expect(result.priceBasis).toBeNull()
    expect(result.candidates[0]!.meteringVariant).toBeNull()
  })

  it('nimmt ein fehlendes oder falsch getipptes candidates-Feld als leere Liste', () => {
    for (const bad of [null, undefined, 'ne7', {}, 42]) {
      expect(parseTariffSheetExtraction(completeRaw({ candidates: bad })).candidates).toEqual([])
    }
  })
})

describe('parseTariffSheetExtraction — fail closed, blattweit', () => {
  it('macht aus einer unbrauchbaren Antwort ein leeres Ergebnis statt einer Ausnahme', () => {
    for (const raw of [null, undefined, 42, 'text', [], {}]) {
      const result = parseTariffSheetExtraction(raw)
      expect(tariffSheetExtractionIsEmpty(result)).toBe(true)
      expect(result).toEqual(emptyTariffSheetExtraction())
    }
  })

  it('weist ein Datum ab, das dem Muster entspricht und kein Tag ist', () => {
    // 2026-02-31 passt auf JJJJ-MM-TT und würde vom Formular still auf den 3. März verschoben.
    for (const bad of ['2026-02-31', '2026-13-01', '01.01.2026', '2026-1-1', '']) {
      expect(parseTariffSheetExtraction(completeRaw({ validFrom: bad })).validFrom).toBeNull()
    }
    expect(parseTariffSheetExtraction(completeRaw({ validFrom: '2026-02-28' })).validFrom).toBe(
      '2026-02-28',
    )
  })
})

describe('Betrag und Einheit gelten nur als Paar — je Kandidat', () => {
  /*
   * Die schärfste Regel dieses Moduls. Ein übernommener Betrag ohne gelesene Einheit behauptete
   * einen LEISTUNGSPREIS (die Formular-Vorbelegung), auch wenn auf dem Blatt eine Jahrespauschale
   * steht — und das ist der Unterschied zwischen „Spitzenkappung lohnt sich" und „Leistungspreis 0,
   * gar keine Spitzenkappung" (Delta 3).
   */
  function firstCandidate(patch: Record<string, unknown>) {
    return parseTariffSheetExtraction(completeRaw({ candidates: [candidateRaw(patch)] }))
      .candidates[0]!
  }

  it('verwirft den Betrag, wenn die Einheit fehlt', () => {
    const candidate = firstCandidate({ grundpreisUnit: null })
    expect(candidate.grundpreisAmount).toBeNull()
    expect(candidate.grundpreisUnit).toBeNull()
  })

  it('verwirft die Einheit, wenn der Betrag fehlt', () => {
    const candidate = firstCandidate({ grundpreisAmount: null })
    expect(candidate.grundpreisAmount).toBeNull()
    expect(candidate.grundpreisUnit).toBeNull()
  })

  it('hält beide, wenn beide dastehen — auch bei der Jahrespauschale', () => {
    const candidate = firstCandidate({ grundpreisAmount: 120, grundpreisUnit: 'eur_per_year' })
    expect(candidate.grundpreisAmount).toBe(120)
    expect(candidate.grundpreisUnit).toBe('eur_per_year')
  })

  /*
   * ⚠ Die Regel gilt JE KANDIDAT. Ein Blatt, das für Netzebene 3 beides ausweist und für Netzebene
   * 7 nur einen Betrag, behält den einen vollständig und verwirft den anderen — die Zeilen dürfen
   * einander nicht mitreissen.
   */
  it('entscheidet je Eintrag getrennt', () => {
    const result = parseTariffSheetExtraction(
      completeRaw({
        candidates: [
          candidateRaw({ netzebene: 3, meteringVariant: null }),
          candidateRaw({ netzebene: 4, meteringVariant: null, grundpreisUnit: null }),
        ],
      }),
    )
    expect(result.candidates[0]!.grundpreisAmount).toBe(38.52)
    expect(result.candidates[1]!.grundpreisAmount).toBeNull()
  })
})

describe('Zeitfenster', () => {
  function windowsOf(patch: Record<string, unknown>) {
    const base = candidateRaw()
    return parseTariffSheetExtraction(
      completeRaw({ candidates: [candidateRaw({ windows: [{ ...base.windows[1], ...patch }] })] }),
    ).candidates[0]!.windows
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
    const base = candidateRaw()
    const result = parseTariffSheetExtraction(
      completeRaw({
        candidates: [
          candidateRaw({ windows: [base.windows[0], { label: 'kaputt' }, base.windows[1]] }),
        ],
      }),
    )
    expect(result.candidates[0]!.windows.map((w) => w.label)).toEqual(['normal', 'snap'])
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
      const result = parseTariffSheetExtraction(
        completeRaw({ candidates: [candidateRaw({ windows: bad })] }),
      )
      expect(result.candidates[0]!.windows).toEqual([])
    }
  })
})

/**
 * Die Zusammenführung blattweiter Angaben mit EINEM Kandidaten — die Vorbelegung eines Formulars.
 *
 * Sie ist eine eigene, geprüfte Funktion und keine `{...a, ...b}`-Zeile in der Oberfläche: Läge sie
 * an der Verwendungsstelle, gäbe es sie beim nächsten zweiten Aufrufer zweimal, und zwei Fassungen,
 * die auseinanderlaufen, ergäben zwei verschiedene Vorbelegungen für dasselbe Blatt.
 */
describe('tariffSheetFormPrefill', () => {
  it('führt die blattweiten Angaben mit dem Kandidaten zusammen', () => {
    const extraction = parseTariffSheetExtraction(completeRaw())
    const prefill = tariffSheetFormPrefill(extraction, extraction.candidates[0]!)

    expect(prefill).toEqual({
      operatorName: 'Wiener Netze GmbH',
      priceBasis: 'net',
      validFrom: '2026-01-01',
      netzebene: 7,
      meteringVariant: 'mit_leistungsmessung',
      grundpreisAmount: 38.52,
      grundpreisUnit: 'eur_per_kw_year',
      netzverlustCtPerKwh: 1.23,
      windows: extraction.candidates[0]!.windows,
    })
  })

  it('gibt jedem Kandidaten dieselben blattweiten Angaben und seine EIGENEN Preise', () => {
    const extraction = parseTariffSheetExtraction(
      completeRaw({
        candidates: [
          candidateRaw({ netzebene: 3, meteringVariant: null, grundpreisAmount: 38.52 }),
          candidateRaw({ netzebene: 4, meteringVariant: null, grundpreisAmount: 25.1 }),
        ],
      }),
    )
    const [first, second] = extraction.candidates.map((c) => tariffSheetFormPrefill(extraction, c))

    expect(first!.validFrom).toBe(second!.validFrom)
    expect(first!.operatorName).toBe(second!.operatorName)
    expect(first!.grundpreisAmount).toBe(38.52)
    expect(second!.grundpreisAmount).toBe(25.1)
  })

  /*
   * ⚠ Ohne Kandidaten trägt die Vorbelegung nur die blattweiten Angaben, und `netzebene` ist null.
   * Genau dieser Zustand lässt das Formular „— bitte wählen —" zeigen und den Grund darunter
   * nennen — aus einem KANDIDATEN entsteht er nie.
   */
  it('lässt die Netzebene offen, wenn keine Tarifzeile zuordenbar war', () => {
    const extraction = parseTariffSheetExtraction(completeRaw({ candidates: [] }))
    const prefill = tariffSheetFormPrefill(extraction, null)

    expect(prefill.netzebene).toBeNull()
    expect(prefill.meteringVariant).toBeNull()
    expect(prefill.grundpreisAmount).toBeNull()
    expect(prefill.windows).toEqual([])
    expect(prefill.operatorName).toBe('Wiener Netze GmbH')
    expect(prefill.validFrom).toBe('2026-01-01')
  })
})

describe('tariffSheetExtractionIsEmpty', () => {
  it('erkennt ein Ergebnis, in dem NUR Tarifzeilen stehen, als nicht leer', () => {
    const result = parseTariffSheetExtraction({ candidates: [candidateRaw()] })
    expect(result.candidates).toHaveLength(1)
    expect(result.operatorName).toBeNull()
    expect(tariffSheetExtractionIsEmpty(result)).toBe(false)
  })

  it('erkennt ein Ergebnis, in dem NUR der Name steht, als nicht leer', () => {
    const result = parseTariffSheetExtraction({ operatorName: 'Netz Oberösterreich GmbH' })
    expect(result.candidates).toEqual([])
    expect(tariffSheetExtractionIsEmpty(result)).toBe(false)
  })

  it('ist leer, wenn weder eine Tarifzeile noch eine blattweite Angabe ankam', () => {
    const result = parseTariffSheetExtraction({ candidates: [{ netzebene: 99 }] })
    expect(tariffSheetExtractionIsEmpty(result)).toBe(true)
  })
})
