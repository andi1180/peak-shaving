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
    for (const key of ['netzbetreiber', 'netzebene', 'annualConsumptionKwh']) {
      expect(props[key].type).toContain('null')
    }
    for (const enumKey of ['netzbetreiber', 'netzebene', 'meteringVariant']) {
      expect(props[enumKey].enum).toContain(null)
    }

    const rateProps = (props.rates.properties ?? {}) as Record<string, { type: unknown }>
    for (const key of INVOICE_SCAN_RATE_KEYS) {
      expect(rateProps[key].type).toEqual(['number', 'null'])
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
