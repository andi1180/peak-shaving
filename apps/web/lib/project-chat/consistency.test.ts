import { describe, expect, it } from 'vitest'

import {
  COVERAGE_GAP_TOLERANCE_DAYS,
  INVOICE_PERIOD_FROM_KEY,
  INVOICE_PERIOD_TO_KEY,
  checkMeteringPointConsistency,
  readInvoicePeriod,
  readLoadProfilePeriod,
  type ConsistencyIssue,
} from './consistency'
import { fakeMeteringPoint } from './fixtures'
import type { MeteringPointGap, MeteringPointRow } from './ports'

/**
 * B24 — DER ZEITRAUM-ABGLEICH.
 *
 * Was hier geprüft wird, ist nicht „die Funktion läuft", sondern die Handvoll Eigenschaften, an
 * denen dieser Schritt richtig oder falsch ist:
 *
 *   (1) DER REFERENZFALL FÄLLT AUF. Rechnung aus einem Abrechnungsjahr 2024/2025, Lastgang ab
 *       Februar 2026 — jede Quelle für sich einwandfrei, zusammen eine Rechnung, die niemand so
 *       aufstellen würde.
 *   (2) KEIN FALSCH-POSITIV. Ein normaler Zyklus-Versatz ist kein Befund; sonst stünde die Meldung
 *       im Regelbetrieb dauernd da und wäre bald ein Möbelstück.
 *   (3) FEHLT EINE SEITE, GIBT ES KEINEN BEFUND. „Ich kenne den Rechnungszeitraum nicht" ist
 *       Unvollständigkeit, nicht Diskrepanz.
 *   (4) DIE LÜCKEN-GRENZEN WERDEN DURCHGEREICHT, nicht neu gebildet.
 */

/** Ein Zählpunkt mit Lastgang-Zeitraum und/oder Rechnungszeitraum im Entwurf. */
function point(options: {
  coveredFrom?: string | null
  coveredTo?: string | null
  invoiceFrom?: unknown
  invoiceTo?: unknown
  gaps?: MeteringPointGap[]
}): MeteringPointRow {
  const draft: Record<string, unknown> = {}
  if (options.invoiceFrom !== undefined) draft[INVOICE_PERIOD_FROM_KEY] = options.invoiceFrom
  if (options.invoiceTo !== undefined) draft[INVOICE_PERIOD_TO_KEY] = options.invoiceTo

  return fakeMeteringPoint('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', {
    interval_minutes: options.coveredFrom === undefined ? null : 15,
    covered_from: options.coveredFrom ?? null,
    covered_to: options.coveredTo ?? null,
    gaps: options.gaps ?? [],
    draft,
  })
}

function coverageGaps(issues: ConsistencyIssue[]) {
  return issues.filter((issue) => issue.kind === 'coverage_gap')
}

describe('Zeitraum-Abgleich Rechnung gegen Lastgang', () => {
  /*
   * ⚠ DER REFERENZFALL, mit den echten Konventionen beider Quellen:
   *
   *   Rechnung   2024-08-01 … 2025-07-31  (letzter abgerechneter TAG, einschliessend)
   *   Lastgang   ab 2026-01-31T23:00Z     (die Wiener Mitternacht des 1. Februar — so kommt ein
   *                                        österreichischer Export wirklich an)
   *
   * Abstand: 2025-08-01T00:00Z bis 2026-02-01T00:00Z sind Aug 31 + Sep 30 + Okt 31 + Nov 30 +
   * Dez 31 + Jän 31 = 184 Tage; abzüglich der einen Stunde 183,96 — gerundet 184.
   */
  it('⚠ meldet den Referenzfall: Rechnung 2024/2025 gegen Lastgang ab Februar 2026', () => {
    const issues = checkMeteringPointConsistency(
      point({
        invoiceFrom: '2024-08-01',
        invoiceTo: '2025-07-31',
        coveredFrom: '2026-01-31T23:00:00.000Z',
        coveredTo: '2026-08-31T22:00:00.000Z',
      }),
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]).toEqual({
      kind: 'coverage_gap',
      // ⚠ Die GESPEICHERTEN Werte, nicht die intern normalisierten — das Modell soll dem Kunden
      // das Datum nennen, das in seinem Entwurf steht.
      invoiceFrom: '2024-08-01',
      invoiceTo: '2025-07-31',
      loadProfileFrom: '2026-01-31T23:00:00.000Z',
      loadProfileTo: '2026-08-31T22:00:00.000Z',
      gapDays: 184,
    })
  })

  it('meldet auch die umgekehrte Richtung: Lastgang alt, Rechnung neu', () => {
    const issues = coverageGaps(
      checkMeteringPointConsistency(
        point({
          coveredFrom: '2024-01-01T00:00:00.000Z',
          coveredTo: '2025-01-01T00:00:00.000Z',
          invoiceFrom: '2026-01-01',
          invoiceTo: '2026-12-31',
        }),
      ),
    )

    expect(issues).toHaveLength(1)
    // 2025-01-01 bis 2026-01-01 = 365 Tage.
    expect(issues[0]).toMatchObject({ gapDays: 365 })
  })

  /*
   * ⚠ DIE GEGENPROBE GEGEN FALSCH-POSITIVE. Zwischen dem Ende einer Abrechnungsperiode und dem
   * Beginn eines später angeforderten Lastgangs liegen regelmässig Wochen — das ist der Regelfall
   * und kein Befund.
   */
  it('⚠ meldet einen normalen Zyklus-Versatz NICHT', () => {
    const issues = checkMeteringPointConsistency(
      point({
        invoiceFrom: '2025-01-01',
        invoiceTo: '2025-12-31',
        coveredFrom: '2026-02-01T00:00:00.000Z',
        coveredTo: '2026-09-01T00:00:00.000Z',
      }),
    )

    expect(issues).toEqual([])
  })

  /*
   * Die Schwelle selbst, von beiden Seiten. Ohne die obere Probe liesse sich `>` still zu `>=`
   * verschieben, ohne dass ein Test es merkte.
   */
  it('⚠ die Schwelle gilt STRIKT: genau 60 Tage sind kein Befund, 61 schon', () => {
    const invoice = { invoiceFrom: '2025-01-01', invoiceTo: '2025-12-31' }
    // Rechnungsende (ausschliessend) ist 2026-01-01. Jän 31 + Feb 28 = 59 Tage bis 1. März.
    const exactlyAtThreshold = checkMeteringPointConsistency(
      point({ ...invoice, coveredFrom: '2026-03-02T00:00:00.000Z', coveredTo: '2026-09-01T00:00:00.000Z' }),
    )
    const oneDayBeyond = checkMeteringPointConsistency(
      point({ ...invoice, coveredFrom: '2026-03-03T00:00:00.000Z', coveredTo: '2026-09-01T00:00:00.000Z' }),
    )

    expect(COVERAGE_GAP_TOLERANCE_DAYS).toBe(60)
    expect(exactlyAtThreshold).toEqual([])
    expect(coverageGaps(oneDayBeyond)[0]).toMatchObject({ gapDays: 61 })
  })

  it('meldet nichts, wenn sich die Zeiträume überlappen', () => {
    const issues = checkMeteringPointConsistency(
      point({
        invoiceFrom: '2025-01-01',
        invoiceTo: '2025-12-31',
        coveredFrom: '2025-06-01T00:00:00.000Z',
        coveredTo: '2026-06-01T00:00:00.000Z',
      }),
    )

    expect(issues).toEqual([])
  })

  /*
   * ⚠ „Der Lastgang beginnt am Tag NACH dem Rechnungsende" ist eine nahtlose Übergabe und muss 0
   * Tage ergeben. Ohne die Umrechnung des einschliessenden Rechnungsendes auf die obere, aus-
   * schliessende Kante stünde hier ein Tag Abstand, wo keiner ist.
   */
  it('⚠ eine nahtlose Übergabe ergibt keinen Abstand — das Rechnungsende ist EINSCHLIESSEND', () => {
    const invoice = readInvoicePeriod({
      [INVOICE_PERIOD_FROM_KEY]: '2025-01-01',
      [INVOICE_PERIOD_TO_KEY]: '2025-12-31',
    })
    const load = readLoadProfilePeriod(
      point({ coveredFrom: '2026-01-01T00:00:00.000Z', coveredTo: '2026-06-01T00:00:00.000Z' }),
    )

    expect(invoice?.endMs).toBe(load?.startMs)
    expect(
      checkMeteringPointConsistency(
        point({
          invoiceFrom: '2025-01-01',
          invoiceTo: '2025-12-31',
          coveredFrom: '2026-01-01T00:00:00.000Z',
          coveredTo: '2026-06-01T00:00:00.000Z',
        }),
      ),
    ).toEqual([])
  })
})

describe('Fehlende Seiten', () => {
  /*
   * ⚠ DIE WICHTIGSTE GEGENPROBE DIESER DATEI. Ein Befund aus einer halben Datenlage träfe jeden
   * Kunden in dem Moment, in dem er seinen Lastgang hochgeladen und seine Rechnung noch nicht — also
   * im ersten Moment jedes Gesprächs.
   */
  it('⚠ meldet KEINEN Zeitraum-Befund, wenn die Rechnung fehlt', () => {
    const issues = checkMeteringPointConsistency(
      point({ coveredFrom: '2026-02-01T00:00:00.000Z', coveredTo: '2026-09-01T00:00:00.000Z' }),
    )

    expect(issues).toEqual([])
  })

  it('⚠ meldet KEINEN Zeitraum-Befund, wenn der Lastgang fehlt', () => {
    const issues = checkMeteringPointConsistency(
      point({ invoiceFrom: '2020-01-01', invoiceTo: '2020-12-31' }),
    )

    expect(issues).toEqual([])
  })

  it('meldet nichts an einem frischen Zählpunkt', () => {
    expect(checkMeteringPointConsistency(point({}))).toEqual([])
  })

  it('eine halb angegebene Rechnung zählt als keine', () => {
    const issues = checkMeteringPointConsistency(
      point({
        invoiceFrom: '2020-01-01',
        coveredFrom: '2026-02-01T00:00:00.000Z',
        coveredTo: '2026-09-01T00:00:00.000Z',
      }),
    )

    expect(readInvoicePeriod(point({ invoiceFrom: '2020-01-01' }).draft)).toBeNull()
    expect(issues).toEqual([])
  })
})

describe('Rechnungszeitraum lesen', () => {
  it('liest ein reines Datum', () => {
    const bounds = readInvoicePeriod({
      [INVOICE_PERIOD_FROM_KEY]: '2025-01-01',
      [INVOICE_PERIOD_TO_KEY]: '2025-12-31',
    })

    expect(bounds).toMatchObject({ from: '2025-01-01', to: '2025-12-31' })
    expect(bounds?.startMs).toBe(Date.UTC(2025, 0, 1))
    // Die obere Kante ist der Beginn des Folgetags — halboffen wie `covered_to`.
    expect(bounds?.endMs).toBe(Date.UTC(2026, 0, 1))
  })

  it('duldet einen angehängten Zeitanteil', () => {
    const bounds = readInvoicePeriod({
      [INVOICE_PERIOD_FROM_KEY]: '2025-01-01T00:00:00Z',
      [INVOICE_PERIOD_TO_KEY]: '2025-12-31T23:59:59Z',
    })

    expect(bounds?.startMs).toBe(Date.UTC(2025, 0, 1))
    expect(bounds?.endMs).toBe(Date.UTC(2026, 0, 1))
  })

  /*
   * ⚠ `2026-02-31` passt auf das Muster und ist kein Tag; `Date` rollt es still auf den 3. März
   * weiter, und der Abstand daraus sähe plausibel aus.
   */
  it('⚠ weist einen Kalendertag ab, den es nicht gibt', () => {
    expect(
      readInvoicePeriod({
        [INVOICE_PERIOD_FROM_KEY]: '2026-01-01',
        [INVOICE_PERIOD_TO_KEY]: '2026-02-31',
      }),
    ).toBeNull()
  })

  it('weist unbrauchbare Werte ab, statt sie zu deuten', () => {
    const cases: unknown[] = ['', '   ', 'Jänner 2025', 20250101, null, { from: '2025-01-01' }, ['2025-01-01']]

    for (const value of cases) {
      expect(
        readInvoicePeriod({
          [INVOICE_PERIOD_FROM_KEY]: '2025-01-01',
          [INVOICE_PERIOD_TO_KEY]: value,
        }),
        String(value),
      ).toBeNull()
    }
  })

  it('weist einen Zeitraum ab, dessen Ende vor seinem Beginn liegt', () => {
    expect(
      readInvoicePeriod({
        [INVOICE_PERIOD_FROM_KEY]: '2025-12-31',
        [INVOICE_PERIOD_TO_KEY]: '2025-01-01',
      }),
    ).toBeNull()
  })

  it('ein einzelner Tag ist ein gültiger Zeitraum', () => {
    const bounds = readInvoicePeriod({
      [INVOICE_PERIOD_FROM_KEY]: '2025-03-15',
      [INVOICE_PERIOD_TO_KEY]: '2025-03-15',
    })

    expect(bounds?.endMs).toBe(Date.UTC(2025, 2, 16))
  })
})

describe('Lastgang-Zeitraum lesen', () => {
  it('liest die gespeicherten Grenzen unverändert', () => {
    const bounds = readLoadProfilePeriod(
      point({ coveredFrom: '2026-01-31T23:00:00.000Z', coveredTo: '2026-08-31T22:00:00.000Z' }),
    )

    expect(bounds).toMatchObject({
      from: '2026-01-31T23:00:00.000Z',
      to: '2026-08-31T22:00:00.000Z',
    })
  })

  it('liefert null, wenn nur eine Grenze dasteht oder keine', () => {
    expect(readLoadProfilePeriod(point({ coveredFrom: '2026-01-01T00:00:00.000Z' }))).toBeNull()
    expect(readLoadProfilePeriod(point({}))).toBeNull()
  })
})

describe('Lücken im Lastgang', () => {
  const GAPS: MeteringPointGap[] = [
    { from: '2026-03-01T00:00:00.000Z', to: '2026-03-01T01:00:00.000Z' },
    { from: '2026-05-17T08:00:00.000Z', to: '2026-05-17T09:30:00.000Z' },
  ]

  /*
   * ⚠ DIE GRENZEN WERDEN DURCHGEREICHT. Ein hier umgerechnetes oder umbenanntes Format wäre eine
   * zweite Beschreibung derselben Lücke, und der Kunde bekäme je nach Werkzeug andere Grenzen für
   * dasselbe Loch genannt.
   */
  it('⚠ meldet je Lücke einen Befund mit den GESPEICHERTEN Grenzen', () => {
    const issues = checkMeteringPointConsistency(
      point({
        coveredFrom: '2026-01-01T00:00:00.000Z',
        coveredTo: '2026-09-01T00:00:00.000Z',
        gaps: GAPS,
      }),
    )

    expect(issues).toEqual([
      { kind: 'internal_gap', from: GAPS[0]!.from, to: GAPS[0]!.to },
      { kind: 'internal_gap', from: GAPS[1]!.from, to: GAPS[1]!.to },
    ])
  })

  it('meldet Lücken auch ohne jeden Rechnungszeitraum', () => {
    const issues = checkMeteringPointConsistency(
      point({
        coveredFrom: '2026-01-01T00:00:00.000Z',
        coveredTo: '2026-09-01T00:00:00.000Z',
        gaps: [GAPS[0]!],
      }),
    )

    expect(issues).toHaveLength(1)
    expect(issues[0]!.kind).toBe('internal_gap')
  })

  /*
   * ⚠ DIE REIHENFOLGE IST ABSICHT: es gibt höchstens EINEN `coverage_gap`, und er ist der Befund,
   * der eine Entscheidung des Kunden verlangt. Die internen Lücken werden in der Antwort an das
   * Modell gekürzt — stünde er hinter ihnen, könnte ausgerechnet er der Kürzung zum Opfer fallen.
   */
  it('⚠ stellt den Zeitraum-Befund VOR die Lücken', () => {
    const issues = checkMeteringPointConsistency(
      point({
        invoiceFrom: '2024-08-01',
        invoiceTo: '2025-07-31',
        coveredFrom: '2026-01-31T23:00:00.000Z',
        coveredTo: '2026-08-31T22:00:00.000Z',
        gaps: GAPS,
      }),
    )

    expect(issues.map((issue) => issue.kind)).toEqual([
      'coverage_gap',
      'internal_gap',
      'internal_gap',
    ])
  })
})
