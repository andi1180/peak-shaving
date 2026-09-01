import { describe, expect, it } from 'vitest'

import { billingModelSchema } from './tariff'
import {
  REPORT_REQUEST_BILLING_MODELS,
  REPORT_REQUEST_FIELDS,
  REPORT_REQUEST_JSON_SCHEMA,
  REPORT_REQUEST_UNSUPPORTED,
  buildRecomputeProposal,
  emptyReportRequestExtraction,
  parseReportRequestExtraction,
  reportRequestExtractionIsEmpty,
  type ReportRequestCurrent,
  type ReportRequestExtraction,
} from './report-request'

/** Ein realistischer „aktueller Stand": Erstlauf-Vorgaben plus die angezeigte Batterie. */
const CURRENT: ReportRequestCurrent = {
  billingModel: 'monthly_max_average',
  horizonYears: 10,
  subsidyPercent: null,
  fixedSubsidyEur: null,
  depreciationYears: null,
  taxRatePercent: null,
  roundTripEfficiencyPercent: 91,
  pricePerKwh: 270,
}

function extraction(over: Partial<ReportRequestExtraction> = {}): ReportRequestExtraction {
  return { ...emptyReportRequestExtraction(), ...over }
}

describe('Delta 18 — das Zielschema der Report-Anfrage', () => {
  /**
   * ⚠ DER WÄCHTER GEGEN DEN AUSFALL VOM 31.08.2026.
   *
   * `type: [..., 'null']` ZUSAMMEN mit `enum` ist nach JSON Schema gültig und wird von der API mit
   * HTTP 400 abgewiesen, VOR dem Modellaufruf — genau das hat den Rechnungs-Scan in Produktion
   * vollständig funktionslos gemacht. Die Kombination darf im GANZEN Baum nirgends vorkommen,
   * auch nicht in einem Feld, das es heute noch gar nicht gibt.
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

    walk(REPORT_REQUEST_JSON_SCHEMA, '$')
    expect(offenders).toEqual([])
  })

  it('führt das Abrechnungsmodell als anyOf-Zweig — der Wertebereich bleibt erzwungen', () => {
    const props = REPORT_REQUEST_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    expect(props.billingModel.anyOf).toEqual([
      { type: 'string', enum: [...REPORT_REQUEST_BILLING_MODELS] },
      { type: 'null' },
    ])
  })

  /**
   * Die Liste ist eine SPIEGELUNG von `billingModelSchema` (das JSON-Schema braucht Literale).
   * Statt die Regel aufzuweichen, misst dieser Test die Gleichheit — wächst das Enum, wird er rot.
   */
  it('spiegelt die Abrechnungsmodelle vollständig aus billingModelSchema', () => {
    expect([...REPORT_REQUEST_BILLING_MODELS].sort()).toEqual([...billingModelSchema.options].sort())
  })

  it('verlangt jedes Feld und lässt nichts Zusätzliches zu', () => {
    expect(REPORT_REQUEST_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(REPORT_REQUEST_JSON_SCHEMA.required).toEqual([...REPORT_REQUEST_FIELDS, 'unsupported'])
  })

  /**
   * ⚠ Die Ablehnungsgründe sind eine GESCHLOSSENE Liste. Gäbe es dort einen freien String, könnte
   * das Modell einen Satz zurückschicken — und der stünde ungeprüft im Report.
   */
  it('lässt als Ablehnungsgrund nur die geschlossene Liste zu, kein Freitextfeld', () => {
    const props = REPORT_REQUEST_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    expect(props.unsupported.type).toBe('array')
    expect((props.unsupported.items as Record<string, unknown>).enum).toEqual([
      ...REPORT_REQUEST_UNSUPPORTED,
    ])
    // Kein einziges Feld des Schemas nimmt freien Text entgegen.
    const freeText = Object.entries(props).filter(([, def]) => def.type === 'string' && !def.enum)
    expect(freeText).toEqual([])
  })
})

describe('Delta 18 — parseReportRequestExtraction (fail closed)', () => {
  it('liest die acht Grössen und die Ablehnungsgründe', () => {
    const parsed = parseReportRequestExtraction({
      billingModel: 'annual_max',
      horizonYears: 15,
      subsidyPercent: 5,
      fixedSubsidyEur: 2000,
      depreciationYears: 8,
      taxRatePercent: 25,
      roundTripEfficiencyPercent: 90,
      pricePerKwh: 300,
      unsupported: ['zeitraum'],
    })
    expect(parsed).toEqual({
      billingModel: 'annual_max',
      horizonYears: 15,
      subsidyPercent: 5,
      fixedSubsidyEur: 2000,
      depreciationYears: 8,
      taxRatePercent: 25,
      roundTripEfficiencyPercent: 90,
      pricePerKwh: 300,
      unsupported: ['zeitraum'],
    })
  })

  it('ergibt bei völlig unbrauchbarer Antwort ein leeres, gültiges Ergebnis statt eines Wurfs', () => {
    for (const raw of [null, undefined, 42, 'nein', [], { unsinn: true }]) {
      const parsed = parseReportRequestExtraction(raw)
      expect(reportRequestExtractionIsEmpty(parsed)).toBe(true)
      expect(parsed.unsupported).toEqual([])
    }
  })

  /**
   * ⚠ `NaN` und `Infinity` sind `typeof 'number'` — ohne die ausdrückliche Prüfung liefen sie als
   * gültige Angabe durch, und `NaN` vergiftet danach jede Rechnung lautlos.
   */
  it('verwirft NaN und Infinity, obwohl beide typeof "number" sind', () => {
    const parsed = parseReportRequestExtraction({
      horizonYears: Number.NaN,
      pricePerKwh: Number.POSITIVE_INFINITY,
      subsidyPercent: Number.NEGATIVE_INFINITY,
    })
    expect(parsed.horizonYears).toBeNull()
    expect(parsed.pricePerKwh).toBeNull()
    expect(parsed.subsidyPercent).toBeNull()
  })

  it('rettet eine Zahl als Zeichenkette ausdrücklich NICHT', () => {
    const parsed = parseReportRequestExtraction({ horizonYears: '15', pricePerKwh: '270,5' })
    expect(parsed.horizonYears).toBeNull()
    expect(parsed.pricePerKwh).toBeNull()
  })

  it('hält dieselben Grenzen wie financialParamsSchema (0–100 Prozent, positiv)', () => {
    const parsed = parseReportRequestExtraction({
      subsidyPercent: 120,
      taxRatePercent: -1,
      depreciationYears: 0,
      fixedSubsidyEur: -500,
    })
    expect(parsed.subsidyPercent).toBeNull()
    expect(parsed.taxRatePercent).toBeNull()
    expect(parsed.depreciationYears).toBeNull()
    expect(parsed.fixedSubsidyEur).toBeNull()
  })

  /**
   * „keine Förderung" und „steuerfrei" sind ANGABEN und eine sinnvolle Frage — sie dürfen nicht
   * als „nicht genannt" verschwinden. Bei Wirkungsgrad und Preis wäre 0 dagegen keine Angabe,
   * sondern ein kaputtes Gerät.
   */
  it('lässt die echte 0 bei Förderung und Steuersatz zu, nicht aber bei Wirkungsgrad und Preis', () => {
    const parsed = parseReportRequestExtraction({
      subsidyPercent: 0,
      fixedSubsidyEur: 0,
      taxRatePercent: 0,
      roundTripEfficiencyPercent: 0,
      pricePerKwh: 0,
    })
    expect(parsed.subsidyPercent).toBe(0)
    expect(parsed.fixedSubsidyEur).toBe(0)
    expect(parsed.taxRatePercent).toBe(0)
    expect(parsed.roundTripEfficiencyPercent).toBeNull()
    expect(parsed.pricePerKwh).toBeNull()
  })

  it('verwirft einen Wirkungsgrad über 100 % — physikalisch unmöglich', () => {
    expect(parseReportRequestExtraction({ roundTripEfficiencyPercent: 105 })
      .roundTripEfficiencyPercent).toBeNull()
  })

  it('verwirft ein unbekanntes Abrechnungsmodell und unbekannte Ablehnungsgründe', () => {
    const parsed = parseReportRequestExtraction({
      billingModel: 'quartals_max',
      unsupported: ['zeitraum', 'erfunden', 42, null, 'lastgang'],
    })
    expect(parsed.billingModel).toBeNull()
    expect(parsed.unsupported).toEqual(['zeitraum', 'lastgang'])
  })

  it('entfernt Dubletten in den Ablehnungsgründen', () => {
    const parsed = parseReportRequestExtraction({
      unsupported: ['zeitraum', 'zeitraum', 'sonstiges', 'zeitraum'],
    })
    expect(parsed.unsupported).toEqual(['zeitraum', 'sonstiges'])
  })
})

describe('Delta 18 — buildRecomputeProposal', () => {
  it('schlägt genau die Felder vor, die sich tatsächlich ändern', () => {
    const proposal = buildRecomputeProposal(
      extraction({ horizonYears: 15, subsidyPercent: 5 }),
      CURRENT,
    )
    expect(proposal.changes).toEqual([
      { field: 'horizonYears', from: 10, to: 15 },
      { field: 'subsidyPercent', from: null, to: 5 },
    ])
    expect(proposal.unsupported).toEqual([])
  })

  /**
   * ⚠ Ein Feld, das schon so eingestellt ist, ist KEINE Änderung. Erschiene es in der Vorschau,
   * bestätigte der Nutzer einen Lauf, der nichts tut („15 Jahre → 15 Jahre").
   */
  it('lässt Felder weg, deren gewünschter Wert dem aktuellen entspricht', () => {
    const proposal = buildRecomputeProposal(
      extraction({ horizonYears: 10, billingModel: 'monthly_max_average', pricePerKwh: 270 }),
      CURRENT,
    )
    expect(proposal.changes).toEqual([])
  })

  it('vergleicht ohne Toleranz — 270 und 270,01 sind zwei Preise', () => {
    const proposal = buildRecomputeProposal(extraction({ pricePerKwh: 270.01 }), CURRENT)
    expect(proposal.changes).toEqual([{ field: 'pricePerKwh', from: 270, to: 270.01 }])
  })

  it('unterscheidet „nicht angegeben" von einer ausdrücklichen 0', () => {
    const proposal = buildRecomputeProposal(extraction({ subsidyPercent: 0 }), CURRENT)
    expect(proposal.changes).toEqual([{ field: 'subsidyPercent', from: null, to: 0 }])

    const schonNull = buildRecomputeProposal(extraction({ subsidyPercent: 0 }), {
      ...CURRENT,
      subsidyPercent: 0,
    })
    expect(schonNull.changes).toEqual([])
  })

  /**
   * Die Reihenfolge stammt aus `REPORT_REQUEST_FIELDS`, nicht aus der Antwort des Modells —
   * sonst ergäbe dieselbe Frage bei zwei Läufen zwei verschieden sortierte Vorschauen.
   */
  it('sortiert die Vorschau nach der Schema-Reihenfolge, nicht nach der Antwort', () => {
    const proposal = buildRecomputeProposal(
      extraction({ pricePerKwh: 300, horizonYears: 20, billingModel: 'annual_max' }),
      CURRENT,
    )
    expect(proposal.changes.map((c) => c.field)).toEqual([
      'billingModel',
      'horizonYears',
      'pricePerKwh',
    ])
  })

  it('reicht die Ablehnungsgründe unverändert durch — auch ohne jede Änderung', () => {
    const proposal = buildRecomputeProposal(
      extraction({ unsupported: ['zeitraum', 'boersenpreis_hebel'] }),
      CURRENT,
    )
    expect(proposal.changes).toEqual([])
    expect(proposal.unsupported).toEqual(['zeitraum', 'boersenpreis_hebel'])
  })

  it('kann Änderung und Ablehnung nebeneinander tragen', () => {
    const proposal = buildRecomputeProposal(
      extraction({ horizonYears: 15, unsupported: ['batteriekapazitaet'] }),
      CURRENT,
    )
    expect(proposal.changes).toEqual([{ field: 'horizonYears', from: 10, to: 15 }])
    expect(proposal.unsupported).toEqual(['batteriekapazitaet'])
  })
})
