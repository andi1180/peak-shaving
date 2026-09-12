import { describe, expect, it } from 'vitest'

import {
  INVOICE_MERGE_FIELD_KEYS,
  INVOICE_MERGE_FIELD_LABELS,
  NETZBETREIBER_LABELS,
  emptyInvoiceExtraction,
  mergeInvoiceExtractions,
  tariffParamsSchema,
  type InvoiceExtraction,
} from 'shared'

import {
  DRAFT_INVOICE_EXTRACTIONS_KEY,
  INVOICE_DRAFT_FIELD_KEYS,
  invoiceConflictLabels,
  invoiceDraftValues,
  invoiceExtractionsKeyCollidesWithContract,
  invoiceMergeDisplayRows,
  readStoredInvoiceExtractions,
  withStoredInvoiceExtractions,
  type StoredInvoiceExtraction,
} from './invoice-extractions'
import { ANNUAL_CONSUMPTION_KWH_KEY } from './standard-profile'

/**
 * B24, Teil 1 — die Übersetzung zwischen gelesener Rechnung und Entwurf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS HIER „FUNKTIONIERT", AUCH WENN ES FALSCH IST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Diese Datei entscheidet, WELCHE gelesenen Angaben in den Entwurf wandern und in welcher FORM.
 * Jeder der vier Fehler darunter erzeugt einen Zustand, der in keinem Build und in keiner
 * Oberfläche auffällt — der Entwurf sieht gefüllt aus, nur steht etwas anderes darin als gemeint:
 *
 *   1. DIE NETZEBENE ALS ZAHL. Der Scan liefert `5`, `tariffParamsSchema.netzebene` ist ein
 *      String. Eingetragen bliebe der Entwurf für diesen Zählpunkt DAUERHAFT unvollständig
 *      (`checkDraftCompleteness` meldete das Feld unter `invalid`), und zwar wegen eines Feldes,
 *      das an keiner Rechnung beteiligt ist. Gespeichert würde die Zahl trotzdem.
 *
 *   2. `netzbetreiber` IM ENTWURF. Es ist kein Contract-Feld; dort stünde es unter `unknown` und
 *      behauptete eine Angabe, die der Contract gar nicht kennt.
 *
 *   3. DER JAHRESVERBRAUCH UNTER EINEM ZWEITEN SCHLÜSSEL. Der Standardprofil-Zweig schreibt ihn
 *      unter `ANNUAL_CONSUMPTION_KWH_KEY`. Liefen die beiden auseinander, zeigte die Station
 *      dauerhaft „kein Jahresverbrauch hinterlegt", während der Wert daneben im Entwurf steht.
 *
 *   4. EIN WIDERSPRUCH, DER TROTZDEM EINGETRAGEN WIRD. `mergeInvoiceExtractions` setzt so ein Feld
 *      auf `null`; käme es hier als Wert an, überschriebe ein Widerspruch genau die Angabe, die er
 *      gerade bestreitet.
 *
 * Reine Funktionen: kein React, kein Request, keine Datenbank.
 */

const OPERATOR = 'wiener_netze'

/** Eine gelesene Rechnung mit Werten in allen vier Kopffeldern und zwei Sätzen. */
function extraction(overrides: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  const base = emptyInvoiceExtraction()
  return {
    ...base,
    netzbetreiber: OPERATOR,
    netzebene: 5,
    meteringVariant: 'mit_leistungsmessung',
    annualConsumptionKwh: 88_426,
    ...overrides,
    rates: { ...base.rates, leistungspreisEurPerKwYear: 38.52, ...(overrides.rates ?? {}) },
  }
}

function stored(overrides: Partial<StoredInvoiceExtraction> = {}): StoredInvoiceExtraction {
  return {
    documentId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    filename: 'Jahresabrechnung 2025.pdf',
    extraction: extraction(),
    ...overrides,
  }
}

describe('readStoredInvoiceExtractions — defensiv wie jeder jsonb-Leser', () => {
  it('gibt für einen Entwurf ohne Seiteneintrag eine leere Liste zurück', () => {
    expect(readStoredInvoiceExtractions({})).toEqual([])
    expect(readStoredInvoiceExtractions({ energyPriceCtPerKwh: 24.5 })).toEqual([])
  })

  it('gibt für einen kaputten Seiteneintrag eine leere Liste zurück', () => {
    /*
     * Die Spalte ist `jsonb` und nimmt alles an; der Typ ist eine Behauptung über das, was die
     * Action einmal geschrieben hat. Ein Wurf hier machte die ganze Station unbenutzbar — für
     * einen Eintrag, den niemand mehr braucht.
     */
    for (const raw of [null, 'zwei Rechnungen', 42, { length: 2 }, true]) {
      expect(readStoredInvoiceExtractions({ [DRAFT_INVOICE_EXTRACTIONS_KEY]: raw })).toEqual([])
    }
  })

  it('⚠ ÜBERSPRINGT eine Zeile ohne Kennung oder Namen, statt sie mit einem Platzhalter zu füllen', () => {
    // „Rechnung —" in der Liste sähe aus wie ein gelesenes Dokument und wäre keines.
    const rows = readStoredInvoiceExtractions({
      [DRAFT_INVOICE_EXTRACTIONS_KEY]: [
        { documentId: '', filename: 'ohne Kennung.pdf', extraction: {} },
        { documentId: 'abc', filename: '   ', extraction: {} },
        { documentId: 'abc', extraction: {} },
        'gar kein Objekt',
        { documentId: 'def', filename: 'gut.pdf', extraction: {} },
      ],
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.filename).toBe('gut.pdf')
  })

  it('⚠ erfindet keinen Wert, wenn die gespeicherte Extraktion von Hand verändert wurde', () => {
    /*
     * `parseInvoiceExtraction` ist dieselbe fail-closed-Auswertung, die auch die Modellantwort
     * nimmt: was nicht als sauberer Wert ankommt, ist `null`.
     */
    const rows = readStoredInvoiceExtractions({
      [DRAFT_INVOICE_EXTRACTIONS_KEY]: [
        {
          documentId: 'abc',
          filename: 'verändert.pdf',
          extraction: { netzebene: 99, rates: { energyPriceCtPerKwh: 'zwanzig' } },
        },
      ],
    })

    expect(rows[0]?.extraction.netzebene).toBeNull()
    expect(rows[0]?.extraction.rates.energyPriceCtPerKwh).toBeNull()
  })
})

describe('withStoredInvoiceExtractions — der Rundweg', () => {
  it('schreibt und liest denselben Inhalt zurück', () => {
    const entries = [stored(), stored({ documentId: 'zweite', filename: 'Teilbetrag.pdf' })]

    const draft = withStoredInvoiceExtractions({}, entries)
    const back = readStoredInvoiceExtractions(draft)

    expect(back).toEqual(entries)
  })

  it('lässt die übrigen Felder des Entwurfs unangetastet', () => {
    // Der Wrapper ERSETZT den Entwurf — was hier verloren ginge, wäre danach weg.
    const draft = withStoredInvoiceExtractions(
      { energyPriceCtPerKwh: 24.5, _provenance: { energyPriceCtPerKwh: { source: 'measured' } } },
      [stored()],
    )

    expect(draft.energyPriceCtPerKwh).toBe(24.5)
    expect(draft._provenance).toEqual({ energyPriceCtPerKwh: { source: 'measured' } })
  })
})

describe('invoiceDraftValues — was in den Entwurf geht und in welcher Form', () => {
  it('⚠ schreibt die Netzebene als „NE X", nicht als Zahl', () => {
    const values = invoiceDraftValues(extraction())
    const netzebene = values.find((value) => value.field === 'netzebene')

    expect(netzebene?.value).toBe('NE 5')
    expect(netzebene?.value).not.toBe(5)

    // Und zwar in genau der Form, die der Contract annimmt — sonst stünde das Feld dauerhaft
    // unter `invalid`, obwohl es gelesen wurde.
    const feld = tariffParamsSchema.shape.netzebene
    expect(feld.safeParse(netzebene?.value).success).toBe(true)
    expect(feld.safeParse(5).success).toBe(false)
  })

  it('⚠ trägt `netzbetreiber` NICHT ein — es ist kein Contract-Feld', () => {
    const values = invoiceDraftValues(extraction())

    expect(values.some((value) => value.field === 'netzbetreiber')).toBe(false)
    expect(INVOICE_DRAFT_FIELD_KEYS).not.toContain('netzbetreiber')
    // Gegenprobe: es ist das EINZIGE ausgelassene Feld, nicht eines von vielen.
    expect(INVOICE_DRAFT_FIELD_KEYS).toHaveLength(INVOICE_MERGE_FIELD_KEYS.length - 1)
    expect('netzbetreiber' in tariffParamsSchema.shape).toBe(false)
  })

  it('⚠ legt den Jahresverbrauch unter denselben Schlüssel wie der Standardprofil-Zweig', () => {
    const values = invoiceDraftValues(extraction())
    const verbrauch = values.find((value) => value.value === 88_426)

    expect(verbrauch?.field).toBe(ANNUAL_CONSUMPTION_KWH_KEY)
  })

  it('lässt ein Feld weg, zu dem keine Rechnung etwas sagt', () => {
    // Weder als `null` noch als Platzhalter: „dazu sagt keine Rechnung etwas" ist keine Angabe.
    const values = invoiceDraftValues(emptyInvoiceExtraction())
    expect(values).toEqual([])
  })

  it('⚠ trägt ein widersprüchliches Feld GAR NICHT ein', () => {
    /*
     * Der Widerspruch entsteht hier echt über `mergeInvoiceExtractions` statt über ein von Hand
     * auf `null` gesetztes Feld — sonst prüfte der Test nur die eigene Fixture.
     */
    const { merged, conflicts } = mergeInvoiceExtractions([
      extraction({ rates: { ...emptyInvoiceExtraction().rates, energyPriceCtPerKwh: 24.5 } }),
      extraction({ rates: { ...emptyInvoiceExtraction().rates, energyPriceCtPerKwh: 26.9 } }),
    ])

    expect(conflicts).toContain('energyPriceCtPerKwh')

    const values = invoiceDraftValues(merged)
    expect(values.some((value) => value.field === 'energyPriceCtPerKwh')).toBe(false)
    // Die übereinstimmenden Felder kommen trotzdem durch — ein Widerspruch verwirft nicht alles.
    expect(values.some((value) => value.field === 'netzebene')).toBe(true)
  })
})

describe('invoiceMergeDisplayRows — was die Station zeigt', () => {
  it('⚠ ZEIGT `netzbetreiber`, mit dem Anzeigenamen aus der geteilten Liste', () => {
    /*
     * Anders als beim Schreiben: er wurde gelesen, und ihn zu verschweigen nur weil der Contract
     * ihn nicht kennt, machte die Anzeige zu einer Aussage über unseren Datentyp statt über die
     * Rechnung.
     */
    const rows = invoiceMergeDisplayRows(extraction())
    const betreiber = rows.find((row) => row.key === 'netzbetreiber')

    expect(betreiber?.text).toBe(NETZBETREIBER_LABELS[OPERATOR])
    expect(betreiber?.text).toBe('Wiener Netze')
    expect(betreiber?.label).toBe(INVOICE_MERGE_FIELD_LABELS.netzbetreiber)
  })

  it('nennt die Einheit hinter jedem Betrag', () => {
    // „Leistungspreis 38,52" und „Arbeitspreis 38,52" wären sonst dieselbe Zeile.
    const rows = invoiceMergeDisplayRows(extraction())
    const leistungspreis = rows.find((row) => row.key === 'leistungspreisEurPerKwYear')

    expect(leistungspreis?.text).toContain('38,52')
    expect(leistungspreis?.text).toContain('€ / kW und Jahr')
  })

  it('lässt Felder ohne Wert weg', () => {
    // Eine Liste mit zehn „—" sähe aus, als wäre der Scan gescheitert.
    expect(invoiceMergeDisplayRows(emptyInvoiceExtraction())).toEqual([])
  })
})

describe('invoiceConflictLabels — dieselben Bezeichnungen, dieselbe Reihenfolge', () => {
  it('übersetzt die Schlüssel in die geteilten Anzeigenamen', () => {
    expect(invoiceConflictLabels(['energyPriceCtPerKwh', 'netzebene'])).toEqual([
      INVOICE_MERGE_FIELD_LABELS.energyPriceCtPerKwh,
      INVOICE_MERGE_FIELD_LABELS.netzebene,
    ])
  })

  it('⚠ behält die Reihenfolge von INVOICE_MERGE_FIELD_KEYS', () => {
    /*
     * Sie ist stabil und hängt NICHT an der Reihenfolge der hochgeladenen Dateien — derselbe
     * Widerspruch muss bei zwei Vorgängen denselben Satz ergeben.
     */
    const conflicts = mergeInvoiceExtractions([
      extraction({
        netzebene: 3,
        rates: { ...emptyInvoiceExtraction().rates, energyPriceCtPerKwh: 24.5 },
      }),
      extraction({
        netzebene: 7,
        rates: { ...emptyInvoiceExtraction().rates, energyPriceCtPerKwh: 26.9 },
      }),
    ]).conflicts

    const labels = invoiceConflictLabels(conflicts)
    const expected = INVOICE_MERGE_FIELD_KEYS.filter((key) => conflicts.includes(key)).map(
      (key) => INVOICE_MERGE_FIELD_LABELS[key],
    )

    expect(labels).toEqual(expected)
    // Positivkontrolle: die Probe wäre wertlos, wenn es nur einen Widerspruch gäbe.
    expect(labels.length).toBeGreaterThan(1)
  })
})

describe('der Seiteneintrag verdeckt kein Contract-Feld', () => {
  it('kollidiert nicht mit `tariffParamsSchema`', () => {
    expect(invoiceExtractionsKeyCollidesWithContract()).toBe(false)
  })
})
