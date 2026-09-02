import { describe, expect, it } from 'vitest'

import { METERING_VARIANTS } from './tariff-pricing'
import { NETZBETREIBER_IDS, NETZEBENEN } from './tariff-catalog'
import {
  INVOICE_SCAN_JSON_SCHEMA,
  INVOICE_SCAN_METERING_VARIANTS,
  INVOICE_SCAN_NETZEBENEN,
  INVOICE_SCAN_OPERATORS,
  INVOICE_SCAN_RATE_KEYS,
  emptyInvoiceExtraction,
  invoiceExtractionIsEmpty,
  parseInvoiceExtraction,
} from './invoice-scan'

/**
 * Delta 9b-2a — der prüfbare Teil des Rechnungs-Scans.
 *
 * ⚠ WAS HIER NICHT GEPRÜFT WIRD, UND WARUM: die QUALITÄT der Extraktion. Ob ein Sprachmodell den
 * Leistungspreis auf einem Wiener-Netze-Blatt findet, entscheidet kein Unit-Test — das entscheidet
 * ein Aufruf gegen eine echte Rechnung. Was hier steht, ist die andere Hälfte und die härtere: dass
 * eine schlechte, halbe oder feindliche Antwort NICHT als Tarifsatz durchläuft.
 */

/** Ein vollständig ausgefülltes Roh-Objekt, wie das Modell es unter dem Schema liefern soll. */
function completeRaw() {
  return {
    netzbetreiber: 'wiener_netze',
    netzebene: 3,
    meteringVariant: 'mit_leistungsmessung',
    rates: {
      leistungspreisEurPerKwYear: 38.52,
      minBillableKw: 0,
      arbeitspreisNetzCtPerKwh: 1.23,
      energyPriceCtPerKwh: 25,
      energyPriceNightCtPerKwh: 12,
      einspeiseverguetungCtPerKwh: 8,
      supplierBaseFeeEurPerMonth: 3.5,
    },
    annualConsumptionKwh: 88426.4,
  }
}

describe('Wertebereiche spiegeln die Bestandslisten', () => {
  /*
   * Der Grund für diese drei Tests steht im Kopf von `invoice-scan.ts`: die Listen sind bewusst
   * ausgeschrieben statt importiert, damit das JSON-Schema sie als Literale führen kann. Ohne
   * diesen Abgleich wüchse eine der beiden Seiten irgendwann allein — und der Scan böte einen
   * Netzbetreiber an, den der Rechner nicht kennt, oder umgekehrt.
   */
  it('führt exakt die Netzbetreiber aus NETZBETREIBER_IDS', () => {
    expect([...INVOICE_SCAN_OPERATORS]).toEqual([...NETZBETREIBER_IDS])
  })

  it('führt exakt die Netzebenen aus NETZEBENEN', () => {
    expect([...INVOICE_SCAN_NETZEBENEN]).toEqual([...NETZEBENEN])
  })

  it('führt exakt die Messvarianten aus METERING_VARIANTS', () => {
    expect([...INVOICE_SCAN_METERING_VARIANTS]).toEqual([...METERING_VARIANTS])
  })
})

describe('JSON-Schema', () => {
  it('verlangt jedes Feld und verbietet zusätzliche — „weggelassen" ist kein zweiter Weg zu null', () => {
    expect(INVOICE_SCAN_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(INVOICE_SCAN_JSON_SCHEMA.required).toEqual([
      'netzbetreiber',
      'netzebene',
      'meteringVariant',
      'rates',
      'annualConsumptionKwh',
    ])

    const props = INVOICE_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    expect(props.rates.additionalProperties).toBe(false)
    expect(props.rates.required).toEqual([...INVOICE_SCAN_RATE_KEYS])
  })

  it('lässt für jedes Feld ausdrücklich null zu — „nicht erkennbar" muss ausdrückbar sein', () => {
    const props = INVOICE_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>

    // Die Zahlenfelder: Typ-Union ohne `enum` — von der API akzeptiert (31.08.2026 gemessen).
    expect(props.annualConsumptionKwh.type).toContain('null')
    const rateProps = (props.rates.properties ?? {}) as Record<string, { type: unknown }>
    for (const key of INVOICE_SCAN_RATE_KEYS) {
      expect(rateProps[key].type).toEqual(['number', 'null'])
    }

    // Die Aufzählungsfelder: `anyOf` mit einem ausdrücklichen null-Zweig, s. Test darunter.
    for (const enumKey of ['netzbetreiber', 'netzebene', 'meteringVariant']) {
      const branches = props[enumKey].anyOf as { type: string; enum?: unknown[] }[]
      expect(branches.map((branch) => branch.type)).toContain('null')
    }
  })

  /*
   * ⚠ DER WÄCHTER GEGEN DEN AUSFALL VOM 31.08.2026.
   *
   * Die Aufzählungsfelder standen als `type: ['string', 'null']` mit `null` in der `enum`-Liste da.
   * Das ist nach JSON Schema gültig, wird von der API aber mit HTTP 400 abgewiesen — und zwar
   * BEVOR das Modell die Rechnung sieht. Wirkung: JEDER Scan endete in `api_error`, das Modul war
   * in Produktion vollständig funktionslos. Gefunden hat es erst der erste Aufruf gegen die ECHTE
   * API; der Stub aus dem Bau-Schritt validiert das Schema NICHT und liess es anstandslos durch.
   *
   * Deshalb prüft dieser Test nicht „sieht plausibel aus", sondern die eine Kombination, die den
   * Ausfall erzeugt hat: Typ-Union UND `enum` an derselben Stelle. Sie darf im ganzen Schema
   * nirgends vorkommen — auch nicht in einem Feld, das es heute noch gar nicht gibt.
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

    walk(INVOICE_SCAN_JSON_SCHEMA, '$')
    expect(offenders).toEqual([])
  })

  it('bietet für jeden Aufzählungswert genau einen Zweig — die Werte selbst bleiben erzwungen', () => {
    const props = INVOICE_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    const expected: Record<string, { type: string; values: readonly (string | number)[] }> = {
      netzbetreiber: { type: 'string', values: INVOICE_SCAN_OPERATORS },
      netzebene: { type: 'integer', values: INVOICE_SCAN_NETZEBENEN },
      meteringVariant: { type: 'string', values: INVOICE_SCAN_METERING_VARIANTS },
    }

    for (const [key, { type, values }] of Object.entries(expected)) {
      const branches = props[key].anyOf as { type: string; enum?: unknown[] }[]
      expect(branches).toHaveLength(2)
      expect(branches[0]).toEqual({ type, enum: [...values] })
      expect(branches[1]).toEqual({ type: 'null' })
      // Kein null in der Werteliste — der null-Zweig ist der einzige Weg dorthin.
      expect(branches[0].enum).not.toContain(null)
    }
  })

  it('führt die Zahlenfelder in derselben Reihenfolge wie der Typ', () => {
    const props = INVOICE_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    const rateProps = (props.rates.properties ?? {}) as Record<string, unknown>
    expect(Object.keys(rateProps)).toEqual([...INVOICE_SCAN_RATE_KEYS])
  })
})

describe('parseInvoiceExtraction — der Gutfall', () => {
  it('übernimmt eine vollständige Antwort unverändert', () => {
    expect(parseInvoiceExtraction(completeRaw())).toEqual({
      netzbetreiber: 'wiener_netze',
      netzebene: 3,
      meteringVariant: 'mit_leistungsmessung',
      rates: {
        leistungspreisEurPerKwYear: 38.52,
        minBillableKw: 0,
        arbeitspreisNetzCtPerKwh: 1.23,
        energyPriceCtPerKwh: 25,
        energyPriceNightCtPerKwh: 12,
        einspeiseverguetungCtPerKwh: 8,
        supplierBaseFeeEurPerMonth: 3.5,
      },
      annualConsumptionKwh: 88426.4,
    })
  })

  it('unterscheidet die echte 0 von „nicht erkennbar"', () => {
    /*
     * `minBillableKw: 0` ist eine ANGABE (kein Sockel vereinbart, §3.5) und darf nicht mit `null`
     * zusammenfallen. Fiele sie auf `null`, sähe die Oberfläche später „nicht erkennbar" und
     * verlangte eine Eingabe für etwas, das auf der Rechnung ausdrücklich dasteht.
     */
    const parsed = parseInvoiceExtraction({
      ...completeRaw(),
      rates: { ...completeRaw().rates, minBillableKw: 0 },
    })
    expect(parsed.rates.minBillableKw).toBe(0)
    expect(parsed.rates.minBillableKw).not.toBeNull()
  })
})

describe('parseInvoiceExtraction — fail closed, Feld für Feld', () => {
  it('macht aus einer unbrauchbaren Antwort ein leeres Ergebnis statt einer Ausnahme', () => {
    for (const junk of [null, undefined, 'nein', 42, [], {}]) {
      const parsed = parseInvoiceExtraction(junk)
      expect(parsed).toEqual(emptyInvoiceExtraction())
      expect(invoiceExtractionIsEmpty(parsed)).toBe(true)
    }
  })

  it('verwirft einen unbekannten Netzbetreiber, statt ihn durchzulassen', () => {
    const parsed = parseInvoiceExtraction({ ...completeRaw(), netzbetreiber: 'energie_burgenland' })
    expect(parsed.netzbetreiber).toBeNull()
    // Der Rest der Antwort bleibt erhalten — ein Feld fällt aus, nicht das Ergebnis.
    expect(parsed.rates.leistungspreisEurPerKwYear).toBe(38.52)
  })

  it('verwirft eine Netzebene ausserhalb 3–7', () => {
    for (const bad of [2, 8, '3', 3.5, null]) {
      expect(parseInvoiceExtraction({ ...completeRaw(), netzebene: bad }).netzebene).toBeNull()
    }
  })

  it('verwirft eine unbekannte Messvariante', () => {
    expect(
      parseInvoiceExtraction({ ...completeRaw(), meteringVariant: 'pauschal' }).meteringVariant,
    ).toBeNull()
  })

  it('⚠ verwirft NaN und Infinity — beide sind typeof "number" und vergifteten sonst jede Rechnung', () => {
    for (const poison of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const parsed = parseInvoiceExtraction({
        ...completeRaw(),
        rates: { ...completeRaw().rates, leistungspreisEurPerKwYear: poison },
        annualConsumptionKwh: poison,
      })
      expect(parsed.rates.leistungspreisEurPerKwYear).toBeNull()
      expect(parsed.annualConsumptionKwh).toBeNull()
    }
  })

  it('verwirft negative Beträge (tariffParamsSchema lässt sie ohnehin nicht zu)', () => {
    const parsed = parseInvoiceExtraction({
      ...completeRaw(),
      rates: { ...completeRaw().rates, energyPriceCtPerKwh: -25 },
    })
    expect(parsed.rates.energyPriceCtPerKwh).toBeNull()
  })

  it('verwirft eine Zahl, die als Zeichenkette kommt — es wird nicht umgedeutet', () => {
    /*
     * „38,52" oder "38.52" wäre die naheliegende Rettung. Sie ist genau die Stelle, an der aus
     * einem Lesefehler ein Tarifsatz würde: das Dezimalzeichen ist auf einem österreichischen
     * Rechnungsblatt das Komma, und wer hier parst, entscheidet zwischen 38,52 und 3852.
     */
    const parsed = parseInvoiceExtraction({
      ...completeRaw(),
      rates: { ...completeRaw().rates, leistungspreisEurPerKwYear: '38,52' },
    })
    expect(parsed.rates.leistungspreisEurPerKwYear).toBeNull()
  })

  it('überlebt ein fehlendes rates-Objekt', () => {
    const parsed = parseInvoiceExtraction({ netzbetreiber: 'netz_noe' })
    expect(parsed.netzbetreiber).toBe('netz_noe')
    expect(parsed.rates).toEqual(emptyInvoiceExtraction().rates)
    expect(invoiceExtractionIsEmpty(parsed)).toBe(false)
  })

  it('lässt keine zusätzlichen Felder in das Ergebnis durch', () => {
    const parsed = parseInvoiceExtraction({
      ...completeRaw(),
      kundennummer: '12345',
      rates: { ...completeRaw().rates, kundenrabattCtPerKwh: 3 },
    })
    expect(Object.keys(parsed).sort()).toEqual([
      'annualConsumptionKwh',
      'meteringVariant',
      'netzbetreiber',
      'netzebene',
      'rates',
    ])
    expect(Object.keys(parsed.rates)).toEqual([...INVOICE_SCAN_RATE_KEYS])
  })
})

describe('supplierBaseFeeEurPerMonth — Lieferant gegen Netzbetreiber (Delta 19 / §3.7.3)', () => {
  /**
   * ⚠ WAS DIESE DREI TESTS BEWEISEN — UND WAS NICHT.
   *
   * Sie beweisen, dass die beiden gleichnamigen Posten einer Rechnung ZWEI GETRENNTE ZIELE haben
   * und einander nicht überschreiben, und dass die Trennlinie in der Anweisung an das Modell
   * tatsächlich dasteht. Sie beweisen NICHT, dass das Modell sie auseinanderhält — das entscheidet
   * ein Aufruf gegen eine echte Rechnung, wie im Kopf dieser Datei vermerkt.
   *
   * Warum das trotzdem der richtige Prüfzweck ist: „Zahl gefunden" wäre hier nichts wert. Die
   * gefährliche Fehlleistung ist nicht eine fehlende Zahl, sondern eine PLAUSIBLE an der falschen
   * Stelle — der Netz-Grundpreis in diesem Feld sähe wie eine korrekte Ablesung aus und verschöbe
   * §3.7.3s Monatsvergleich zugunsten des Tarifwechsels (er gehört auf ALLE DREI Reihen, diese
   * Gebühr nur auf „Ihr Tarif heute").
   */

  /** Beide Posten nebeneinander, wie sie auf einer echten Rechnung stehen. Zahlen erfunden. */
  function bothFeesRaw() {
    return {
      ...completeRaw(),
      rates: {
        ...completeRaw().rates,
        // Abschnitt „Energielieferung": die Grundgebühr des Lieferanten, €/Monat.
        supplierBaseFeeEurPerMonth: 3.5,
        // Abschnitt „Netznutzung": der Grundpreis des Netzbetreibers, €/kW und Jahr.
        leistungspreisEurPerKwYear: 38.52,
      },
    }
  }

  it('führt beide Posten getrennt — der eine landet nicht im Feld des anderen', () => {
    const parsed = parseInvoiceExtraction(bothFeesRaw())
    expect(parsed.rates.supplierBaseFeeEurPerMonth).toBe(3.5)
    expect(parsed.rates.leistungspreisEurPerKwYear).toBe(38.52)
    // Und ausdrücklich nicht vertauscht — die eigentliche Aussage dieses Tests.
    expect(parsed.rates.supplierBaseFeeEurPerMonth).not.toBe(38.52)
    expect(parsed.rates.leistungspreisEurPerKwYear).not.toBe(3.5)
  })

  it('lässt die Gebühr null, wenn nur der Netz-Grundpreis dasteht — sie wird nicht ersatzweise gefüllt', () => {
    const parsed = parseInvoiceExtraction({
      ...completeRaw(),
      rates: { ...completeRaw().rates, supplierBaseFeeEurPerMonth: null },
    })
    expect(parsed.rates.supplierBaseFeeEurPerMonth).toBeNull()
    expect(parsed.rates.leistungspreisEurPerKwYear).toBe(38.52)
  })

  it('nennt die Abgrenzung in der Schema-Beschreibung, die an das Modell geht', () => {
    /*
     * Die Beschreibung ist der einzige Teil dieser Regel, der ohne API-Schlüssel prüfbar ist —
     * und der Ort, an dem sie beim nächsten Umformulieren still verschwinden könnte. Geprüft wird
     * deshalb der INHALT der Abgrenzung, nicht ihr Wortlaut.
     */
    const props = INVOICE_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    const rateProps = props.rates.properties as Record<string, { description: string }>
    const description = rateProps.supplierBaseFeeEurPerMonth.description

    expect(description).toContain('STROMLIEFERANTEN')
    expect(description).toContain('NICHT')
    expect(description).toContain('NETZBETREIBERS')
    expect(description).toContain('MONAT')
  })

  it('verwirft einen negativen Betrag, statt ihn zu retten', () => {
    const parsed = parseInvoiceExtraction({
      ...completeRaw(),
      rates: { ...completeRaw().rates, supplierBaseFeeEurPerMonth: -3.5 },
    })
    expect(parsed.rates.supplierBaseFeeEurPerMonth).toBeNull()
    // Ein Feld fällt aus, nicht das Ergebnis.
    expect(parsed.rates.leistungspreisEurPerKwYear).toBe(38.52)
  })
})

describe('invoiceExtractionIsEmpty', () => {
  it('ist true nur, wenn wirklich kein einziges Feld erkannt wurde', () => {
    expect(invoiceExtractionIsEmpty(emptyInvoiceExtraction())).toBe(true)

    for (const key of INVOICE_SCAN_RATE_KEYS) {
      const one = emptyInvoiceExtraction()
      one.rates[key] = 1
      expect(invoiceExtractionIsEmpty(one)).toBe(false)
    }

    const withZero = emptyInvoiceExtraction()
    withZero.rates.minBillableKw = 0
    expect(invoiceExtractionIsEmpty(withZero)).toBe(false)
  })
})
