import { describe, expect, it } from 'vitest'
import type { BatteryRoiEntry, MonthlyTariffComparison, PvValueScenario } from 'shared'

import { buildAssumptions, TARIFF_COMPONENTS_TABLE_ID } from './basis'
import { buildComparisonChapter, CANDIDATE_TABLE_ID } from './comparison'
import { REPORT_SECTIONS, SECTION_ID } from './content'
import { reportLayoutOf, type ReportPlacement } from './layout'
import { buildRecommendationChapter } from './recommendation'
import {
  block,
  REF_LABEL,
  REF_PLACE,
  ref,
  resolveReportText,
  row,
  t,
  type ReportLayout,
  type ReportText,
} from './report-text'
import { statementTexts, type ReportStatement, type ReportTable } from './statement'
import { buildReportSummary, type ReportSummary } from './summary'
import type { PdfReportAnalysis } from './types'

/**
 * Stufe D — die migrierten Querverweise, Wortlaut für Wortlaut gegen den Stand VOR der Umstellung
 * (`a00759d`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE ERWARTUNGEN SIND DIE ALTEN SÄTZE, ZEICHEN FÜR ZEICHEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Stufe D ändert den ERZEUGUNGSWEG und nicht den Text. Ein Prüflauf, der nur „enthält irgendeinen
 * Verweis" misst, liesse eine stille Umformulierung durch — und genau die wäre hier der Fehler:
 * niemand liest einen Report Zeichen für Zeichen gegen seinen Vorgänger.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Fixture
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const BATTERY = {
  id: 'kat-1',
  name: 'Katalog 1',
  manufacturer: 'Fixture',
  class: 'commercial' as const,
  usableCapacityKwh: 60,
  maxPowerKw: 20,
  roundTripEfficiency: 0.9,
  pricePerKwh: 350,
  inverterIncluded: true,
  requiresFoundation: false,
  controlType: 'dynamic' as const,
}

const ENTRY: BatteryRoiEntry = {
  battery: BATTERY,
  newBilledKw: 40,
  leistungspreisSavingPerYear: 800,
  selfConsumptionSavingPerYear: 300,
  loadShiftSavingPerYear: 100,
  selfConsumptionSavingOverCoveredPeriod: 300,
  loadShiftSavingOverCoveredPeriod: 100,
  annualizationFactor: 1,
  coveredDays: 365,
  totalSavingPerYear: 1200,
  warnings: [],
  notices: [],
  totalInvestment: 21000,
  subsidyAmount: 0,
  taxBenefit: 0,
  taxEffectsIncluded: false,
  netInvestment: 21000,
  amortizationYears: 17.5,
  netSavingOverHorizon: -9000,
}

const ZWEITES: BatteryRoiEntry = {
  ...ENTRY,
  battery: { ...BATTERY, id: 'kat-2', name: 'Katalog 2', usableCapacityKwh: 90 },
}

const COMPARISON: MonthlyTariffComparison = {
  currentTariffEur: [120, ...Array<null>(11).fill(null)],
  spotWithoutControlEur: [110, ...Array<null>(11).fill(null)],
  spotWithBatteryEur: [95, ...Array<null>(11).fill(null)],
  coveredMonths: 1,
  fixedCosts: {
    networkBaseFeeEur: 0,
    meteringFeeEur: 0,
    eagFlatFeeEur: 0,
    usageChargeOnFixedEur: 0,
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 4.79,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 31,
  },
}

/** Ein PV-Kapitel, das es gibt — gelesen wird davon hier nur, DASS es da ist. */
const PV_VALUE: PvValueScenario = {
  coveredDays: 209,
  measured: { withPvEur: 1000, withoutPvEur: 1654, valueEur: 654 },
  annual: null,
  months: [{ year: 2026, month: 2, selfConsumptionKwh: null, outage: true }],
  estimatedGenerationKwh: 5212.67,
}

function analysisFor(withExisting: boolean): PdfReportAnalysis {
  return {
    current: {
      annualPeakKw: 48,
      monthlyPeaksKw: Array<number>(12).fill(48),
      billedKw: 48,
      leistungspreisCostPerYear: 3980.16,
    },
    perBattery: [ENTRY, ZWEITES],
    recommendation: { batteryId: BATTERY.id, rationale: { code: 'best_net_saving', totalSavingPerYear: 0, amortizationYears: 0, netSavingOverHorizon: 0, horizonYears: 10 } },
    assumptions: {
      roundTripEfficiency: 0.9,
      horizonYears: 10,
      energyPriceCtPerKwh: 24.5,
      einspeiseverguetungCtPerKwh: 7.2,
      billingModel: 'monthly_max_sum',
    },
    dataQuality: {
      coveredDays: 365,
      coveredMonths: 12,
      gapsInterpolated: 0,
      largestGapSlots: 0,
      warnings: [],
    },
    tariffOptimization: { computable: true, monthlyComparison: COMPARISON },
    ...(withExisting
      ? {
          existingBatteryAnalysis: {
            entry: ENTRY,
            /* Ein Zusatzgerät, das sich rechnet — sonst steht statt der Tabelle der Klarsatz. */
            addonScenarios: [
              {
                ...ZWEITES,
                netSavingOverHorizon: 4200,
                combined: { ...BATTERY, usableCapacityKwh: 120, maxPowerKw: 40 },
              },
            ],
          },
        }
      : {}),
  }
}

/** Eine Beschreibung aus einem tatsächlich gebauten Baustein — nichts von Hand behauptet. */
function placementOf(
  statement: ReportStatement,
  section: ReportPlacement['section'],
): ReportPlacement {
  return {
    id: statement.id as ReportPlacement['id'],
    section,
    title: statement.title,
    amount: statement.amount ? statement.amount.caption : null,
    rows: Object.fromEntries(
      statement.rows.flatMap((r) => (r.key ? [[r.key, r.label] as const] : [])),
    ),
  }
}

/** Die Kandidatentabelle als Beschreibung: sie trägt keinen Titel, nur Spalten (`ReportTable`). */
function tablePlacementOf(table: ReportTable): ReportPlacement {
  return {
    id: CANDIDATE_TABLE_ID,
    section: SECTION_ID.comparison,
    title: '',
    amount: null,
    rows: {},
    columns: Object.fromEntries(
      table.columns.flatMap((c) => (c.key ? [[c.key, c.label] as const] : [])),
    ),
  }
}

function summaryPlacements(summary: ReportSummary): ReportPlacement[] {
  return summary.statements.map((s) => placementOf(s, SECTION_ID.results))
}

/**
 * Der ganze Fliesstext einer Aussage, aufgelöst — Körper ODER Listenpunkte (B3-3). Die Punkte
 * werden mit einem Leerzeichen verbunden: genau so hingen die Sätze im Absatz aneinander, bevor
 * `recommendation` auf die Listenform wechselte.
 */
function statementText(statement: ReportStatement, layout: ReportLayout, from: string): string {
  return statementTexts(statement)
    .map((text) => resolveReportText(text, layout, from))
    .filter((part) => part !== '')
    .join(' ')
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 1+2 — Die zwei Textblöcke der Zusammenfassung
 *
 * ⚠ Sie stehen NICHT in der Registry (`ReportBaukastenId`) und lösen deshalb über einen
 * UNBEKANNTEN Ursprung auf. Genau das ist hier zu messen: der Resolver darf daraus keine Richtung
 * behaupten („oben"), sondern muss das Zielkapitel beim Namen nennen — und ohne Ziel auf die
 * Ersatzfassung fallen, statt einen halben Satz stehenzulassen.
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('Zusammenfassung — Fliesstext und PV-Satz', () => {
  const BASIS_PLACEMENTS: ReportPlacement[] = [
    {
      id: 'tariff_blocker',
      section: SECTION_ID.basis,
      title: 'Der Tarifvergleich konnte nicht gerechnet werden',
      amount: null,
      rows: {},
    },
    {
      id: 'pv_outage',
      section: SECTION_ID.basis,
      title: 'Monate ohne erkennbaren PV-Beitrag',
      amount: null,
      rows: {},
    },
  ]

  /** Ohne rechenbaren Hebel zeigt der Absatz auf den Blocker-Befund im Schlusskapitel. */
  const ohneHebel = buildReportSummary({
    analysis: { ...analysisFor(true), tariffOptimization: undefined },
    loadProfile: { source: 'net_signed' },
  })

  it('nennt das Zielkapitel statt einer Richtung', () => {
    const text = resolveReportText(
      ohneHebel.overview,
      reportLayoutOf(BASIS_PLACEMENTS),
      'overview',
    )

    expect(text).toContain(
      'nicht berechnen — woran das liegt, steht im Kapitel „Annahmen und Datengrundlage".',
    )
  })

  it('lässt den Halbsatz fallen, wenn der Befund nicht im Dokument steht', () => {
    const text = resolveReportText(ohneHebel.overview, reportLayoutOf([]), 'overview')

    expect(text).toContain('liess sich für diesen Zeitraum nicht berechnen.')
    expect(text).not.toContain('woran das liegt')
  })

  it('PV-Satz: der Befund-Halbsatz hängt am Hinweis, der Satz selbst an der Angabe', () => {
    const mitPv = buildReportSummary({
      analysis: analysisFor(true),
      loadProfile: { source: 'net_signed' },
      hasPv: true,
      pvPeakPowerKwp: 10.2,
    })

    expect(
      resolveReportText(mitPv.pvPointer ?? '', reportLayoutOf(BASIS_PLACEMENTS), 'pv_pointer'),
    ).toContain('er steht im Kapitel „Annahmen und Datengrundlage".')
    expect(resolveReportText(mitPv.pvPointer ?? '', reportLayoutOf([]), 'pv_pointer')).not.toContain(
      'Befund',
    )

    /* Ohne Angabe gibt es den Satz gar nicht — auch dann nicht, wenn ein Befund vorläge. */
    expect(
      buildReportSummary({ analysis: analysisFor(true), loadProfile: { source: 'net_signed' } })
        .pvPointer,
    ).toBeNull()
  })

  /**
   * ⚠ DERSELBE SATZ, ZWEI ZIELE — und der Unterschied ist das einzige, was hier gemessen wird.
   *
   * Gibt es das Kapitel „Ihre PV-Anlage", steht der Befund dort (samt Zahl und Einordnung); sonst
   * bleibt der Hinweis im Schlusskapitel die einzige Stelle. Beide Fassungen müssen ihr Ziel beim
   * NAMEN nennen — eine Richtungsangabe („weiter unten") wäre hier falsch, weil Ursprung und Ziel
   * in verschiedenen Kapiteln liegen.
   */
  it('PV-Satz: mit PV-Kapitel zeigt er dorthin, ohne es auf das Schlusskapitel', () => {
    const PLACEMENTS: ReportPlacement[] = [
      ...BASIS_PLACEMENTS,
      {
        id: 'pv_value_finding',
        section: SECTION_ID.pvValue,
        title: 'Was Ihr Lastgang über Ihre Anlage zeigt',
        amount: null,
        rows: {},
      },
    ]

    const mitKapitel = buildReportSummary({
      analysis: { ...analysisFor(true), pvValue: PV_VALUE },
      loadProfile: { source: 'net_signed' },
      hasPv: true,
    })
    const ohneKapitel = buildReportSummary({
      analysis: analysisFor(true),
      loadProfile: { source: 'net_signed' },
      hasPv: true,
    })

    const textOf = (summary: { pvPointer: ReportText | null }) =>
      resolveReportText(summary.pvPointer ?? '', reportLayoutOf(PLACEMENTS), 'pv_pointer')

    expect(textOf(mitKapitel)).toContain('er steht im Kapitel „Ihre PV-Anlage".')
    expect(textOf(ohneKapitel)).toContain('er steht im Kapitel „Annahmen und Datengrundlage".')

    /*
     * ⚠ Und der Halbsatz hängt weiterhin am BEFUND, nicht am Kapitel: steht der Absatz nicht im
     * Dokument (kein auffälliger Monat), fällt er samt Verweis weg — sonst kündigte die
     * Zusammenfassung einen Befund an, den niemand findet.
     */
    const ohneBefund = resolveReportText(
      mitKapitel.pvPointer ?? '',
      reportLayoutOf([]),
      'pv_pointer',
    )
    expect(ohneBefund).not.toContain('Befund')
  })
})

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 3 — Kapitel-Referenz: `catalog_alternatives` → `recommendation`
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('catalog_alternatives — Verweis auf das Empfehlungs-Kapitel', () => {
  const analysis = analysisFor(false)

  function placements(): ReportPlacement[] {
    const recommendation = buildRecommendationChapter(analysis).recommendation
    const comparison = buildComparisonChapter(analysis)
    return [
      placementOf(recommendation!, SECTION_ID.recommendation),
      placementOf(comparison.statement, SECTION_ID.comparison),
      tablePlacementOf(comparison.table!),
    ]
  }

  function body(layout: ReportLayout): string {
    return resolveReportText(
      buildComparisonChapter(analysis).statement.body,
      layout,
      'catalog_alternatives',
    )
  }

  it('nennt den Kapiteltitel wortgleich — und zieht ihn aus `content.ts`, nicht aus einem Literal', () => {
    expect(body(reportLayoutOf(placements()))).toBe(
      'Gereiht ist nach der Netto-Ersparnis über den Betrachtungszeitraum — derselben Grösse wie ' +
        'die Kurve darüber und wie die Empfehlung im Kapitel „Empfehlung und Wirtschaftlichkeit". ' +
        'Das ' +
        'empfohlene Gerät steht deshalb hier nicht noch einmal: es ist dort vollständig ' +
        'aufgeschlüsselt. Diese Tabelle sagt, was die Alternativen dagegen leisten — und um ' +
        'welchen Betrag die Empfehlung besser ist. Die Hinweise zu einem Gerät (Betonsockel, ' +
        'separater Wechselrichter, zu geringe Leistung für alle Spitzen) sind in der Investition ' +
        'bereits enthalten, werden hier aber nicht je Gerät wiederholt — sie stehen beim empfohlenen Gerät.',
    )
  })

  /**
   * ⚠ DER KERN-NACHWEIS DIESES SCHRITTS: die Empfehlung wandert in DASSELBE Kapitel, und der Satz
   * sagt von selbst „oben" statt den Kapitelnamen zu nennen. Vor Stufe D stand
   * „im Kapitel „…"" als Literal im Text (die einzige Stelle im ganzen
   * Katalog, die einen fremden Kapiteltitel ausschrieb).
   */
  it('wird zur Richtungsangabe, sobald die Empfehlung im selben Kapitel steht', () => {
    const umsortiert = placements().map((p) =>
      p.id === 'recommendation' ? { ...p, section: SECTION_ID.comparison } : p,
    )
    const text = body(reportLayoutOf(umsortiert))

    expect(text).toContain('wie die Empfehlung oben.')
    expect(text).not.toContain('im Kapitel')
  })

  /** Ohne Empfehlung im Dokument zeigt kein Satz mehr auf sie. */
  it('fällt auf die Ersatzformulierung zurück, wenn die Empfehlung fehlt', () => {
    const ohne = placements().filter((p) => p.id !== 'recommendation')
    const text = body(reportLayoutOf(ohne))

    expect(text).toContain('wie die Empfehlung dieses Reports.')
    expect(text).toContain('es ist beim empfohlenen Gerät vollständig aufgeschlüsselt.')
  })
})

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 4 — Der Mechanismus selbst
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('resolveReportText', () => {
  const LAYOUT = reportLayoutOf([
    {
      id: 'recommendation',
      section: SECTION_ID.recommendation,
      title: 'Das empfohlene Gerät',
      amount: 'Amortisation',
      rows: { saving: 'Ersparnis pro Jahr' },
    },
    {
      id: 'load_control',
      section: SECTION_ID.recommendation,
      title: 'Wert der Ladesteuerung unter aWATTar',
      amount: 'pro Jahr',
      rows: {},
    },
  ])

  it('setzt beide Platzhalter ein', () => {
    const text = t`Die Zeile ${ref(row('recommendation', 'saving'), `„${REF_LABEL}" ${REF_PLACE}`, 'x')}.`
    expect(resolveReportText(text, LAYOUT, 'load_control')).toBe(
      'Die Zeile „Ersparnis pro Jahr" oben.',
    )
  })

  it('lässt den GANZEN Text entfallen, wenn `absent` null ist', () => {
    const text = t`Etwas über ${ref(block('addon'), REF_PLACE, null)} und noch mehr.`
    expect(resolveReportText(text, LAYOUT, 'load_control')).toBe('')
  })

  it('lässt eine blosse Zeichenkette unverändert', () => {
    expect(resolveReportText('Ein fertiger Satz.', LAYOUT, 'load_control')).toBe(
      'Ein fertiger Satz.',
    )
  })
})

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 5 — Kante L: dieselbe Aussage in zwei Leseordnungen
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('assumptions — Verweis auf die Tarifkomponenten-Tabelle (Kante L)', () => {
  const statement = buildAssumptions(analysisFor(false))
  const tabelle: ReportPlacement = {
    id: TARIFF_COMPONENTS_TABLE_ID,
    section: SECTION_ID.basis,
    title: '',
    amount: null,
    rows: {},
  }
  const annahmen: ReportPlacement = {
    id: 'assumptions',
    section: SECTION_ID.basis,
    title: statement.title,
    amount: null,
    rows: {},
  }
  const body = (composition: ReportPlacement[]) =>
    resolveReportText(statement.body, reportLayoutOf(composition), 'assumptions')

  /**
   * ⚠ DAS IST DIE STELLE, AN DER BLOCK 3 Nr. 21 ANSETZT: die Voraussetzungs-Seite zieht die
   * Anlagedaten nach VORNE, und dann steht die Tarifkomponenten-Tabelle nicht mehr „weiter unten".
   * Vor Stufe D war die Richtung ein Literal und hätte den Umzug stumm überlebt.
   */
  it('liest „weiter unten", solange die Annahmen vor der Tabelle stehen', () => {
    expect(body([annahmen, tabelle])).toContain(
      'stehen weiter unten in der Tabelle „Tarifkomponenten"',
    )
  })

  it('liest „oben", sobald die Tabelle vor den Annahmen steht', () => {
    const text = body([tabelle, annahmen])
    expect(text).toContain('stehen oben in der Tabelle „Tarifkomponenten"')
    expect(text).not.toContain('weiter unten')
  })

  it('nennt ohne Tabelle gar keine Richtung mehr', () => {
    const text = body([annahmen])
    expect(text).toContain('stehen in der Tabelle „Tarifkomponenten"')
    expect(text).not.toContain('weiter unten')
    expect(text).not.toContain('oben')
  })
})

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 6 — Die zwei Bausteine, die Stufe C ausdrücklich NICHT freigeben konnte
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('Stufe-C-Sperren: `addon` und `table_candidates`', () => {
  /**
   * `Report_Baukasten_Auswahlschicht_Verifikation.md` §2.2: beide waren gesperrt, weil ein Satz
   * anderswo auf sie zeigt. Nach der Migration verschwindet der Satz mit seinem Ziel.
   */
  it('`addon` abgewählt: der Satz im Empfehlungs-Kapitel verschwindet mit', () => {
    const analysis = analysisFor(true)
    const chapter = buildRecommendationChapter(analysis)
    const summary = buildReportSummary({ analysis, loadProfile: { source: 'net_signed' } })

    const mit = statementText(
      chapter.recommendation!,
      reportLayoutOf(summaryPlacements(summary)),
      'recommendation',
    )
    expect(mit).toContain('steht auf der Zusammenfassung')

    const ohne = statementText(
      chapter.recommendation!,
      reportLayoutOf(summaryPlacements(summary).filter((p) => p.id !== 'addon')),
      'recommendation',
    )
    expect(ohne).not.toContain('Zusammenfassung')
    expect(ohne).toContain('wenn ich Ihre Anlage durch ein neues Gerät ersetzte?".')
  })

  it('`table_candidates` abgewählt: der Klarsatz nennt keine Spalten mehr', () => {
    const analysis = analysisFor(true)
    const chapter = buildComparisonChapter(analysis)
    const eintrag = placementOf(chapter.statement, SECTION_ID.comparison)

    const mit = resolveReportText(
      chapter.statement.body,
      reportLayoutOf([eintrag, tablePlacementOf(chapter.table!)]),
      'addon_table',
    )
    expect(mit).toContain('die Spalten „Ersparnis/Jahr" und „Netto" sind also Differenzen')

    const ohne = resolveReportText(chapter.statement.body, reportLayoutOf([eintrag]), 'addon_table')
    expect(ohne).toContain('die ausgewiesenen Beträge sind also Differenzen')
    expect(ohne).not.toContain('Spalten')
  })

  /**
   * B3-1 — der Spaltenverweis war nur EINER der Sätze über die Tabelle. „je Zeile" und „Gezeigt
   * sind die Geräte …" nennen sie ebenso und trugen bis B3-1 keinen Verweis; der bestehende
   * Prüflauf darüber bliebe grün (`Report_Baukasten_Block3_Plan.md` §1.5).
   */
  it('`table_candidates` abgewählt: der Zusatz-Klarsatz redet nicht mehr von Zeilen', () => {
    const chapter = buildComparisonChapter(analysisFor(true))
    const eintrag = placementOf(chapter.statement, SECTION_ID.comparison)

    const mit = resolveReportText(
      chapter.statement.body,
      reportLayoutOf([eintrag, tablePlacementOf(chapter.table!)]),
      'addon_table',
    )
    expect(mit).toContain('Gerechnet ist je Zeile EIN gemeinsamer Speicher')
    expect(mit).toContain(
      'Gezeigt sind die Geräte, die ihre Anschaffung im Betrachtungszeitraum wieder einspielen; ' +
        'die übrigen stehen als Punkte in der Kurve darüber.',
    )

    const ohne = resolveReportText(chapter.statement.body, reportLayoutOf([eintrag]), 'addon_table')
    expect(ohne).toContain('Gerechnet ist je Gerät EIN gemeinsamer Speicher')
    expect(ohne).toContain('Alle betrachteten Geräte stehen als Punkte in der Kurve darüber.')
    expect(ohne).not.toContain('Zeile')
    expect(ohne).not.toContain('Gezeigt sind')
  })

  it('`table_candidates` abgewählt: der Katalog-Klarsatz nennt keine Tabelle mehr', () => {
    const chapter = buildComparisonChapter(analysisFor(false))
    const eintrag = placementOf(chapter.statement, SECTION_ID.comparison)
    const empfehlung = placementOf(
      buildRecommendationChapter(analysisFor(false)).recommendation!,
      SECTION_ID.recommendation,
    )

    const ohne = resolveReportText(
      chapter.statement.body,
      reportLayoutOf([empfehlung, eintrag]),
      'catalog_alternatives',
    )
    expect(ohne).toBe(
      'Verglichen wird nach der Netto-Ersparnis über den Betrachtungszeitraum — derselben Grösse ' +
        'wie die Kurve darüber und wie die Empfehlung im Kapitel „Empfehlung und ' +
        'Wirtschaftlichkeit". ' +
        'Das empfohlene Gerät selbst ist dort vollständig aufgeschlüsselt. Die Hinweise zu einem ' +
        'Gerät (Betonsockel, separater Wechselrichter, zu geringe Leistung für alle ' +
        'Spitzen) sind in der Investition bereits enthalten — sie stehen beim empfohlenen Gerät.',
    )
    expect(ohne).not.toContain('Tabelle')
    expect(ohne).not.toContain('je Zeile')
  })
})

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 7 — Die Kapitel-1-Sonderform
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('Verweisname eines Kapitels (`REF_SECTION`)', () => {
  /**
   * ⚠ NUR KAPITEL 1 TRÄGT EINEN NAMEN, und das ist die ganze Begründung der Sonderform: es steht in
   * jedem Report und immer als Erstes. Ein bedingtes Kapitel beim Namen zu nennen hiesse, in den
   * Fällen ohne es auf nichts zu zeigen.
   */
  it('haben nur unbedingte Kapitel — die drei bedingten ausdrücklich nicht', () => {
    expect(REPORT_SECTIONS[SECTION_ID.results].reference).toBe('Zusammenfassung')

    for (const key of [SECTION_ID.monthly, SECTION_ID.insight, SECTION_ID.comparison]) {
      expect(REPORT_SECTIONS[key].reference).toBeUndefined()
    }
  })

  const analysis = analysisFor(true)
  const chapter = buildRecommendationChapter(analysis)

  /**
   * ⚠ NACH DEM ZUSAMMENFASSUNGS-UMBAU BLEIBT GENAU EIN SATZ ÜBRIG, der Kapitel 1 beim Namen nennt.
   * Die vier übrigen zeigten auf `savings`/`load_shift`; beide Bausteine gibt es nicht mehr
   * (Ein-Spanne-Regel D8), und ihre Sätze tragen seither ihre Ersatzfassung ausgeschrieben.
   */
  const SAETZE = [
    {
      name: 'recommendation → addon',
      statement: chapter.recommendation!,
      from: 'recommendation',
      ziel: 'addon' as const,
      mit: 'steht auf der Zusammenfassung',
      ohne: 'ersetzte?".',
    },
  ]

  const inKapitel1 = summaryPlacements(
    buildReportSummary({ analysis, loadProfile: { source: 'net_signed' } }),
  )

  it.each(SAETZE)('$name: nennt Kapitel 1 beim Namen, solange das Ziel dort steht', (satz) => {
    expect(statementText(satz.statement, reportLayoutOf(inKapitel1), satz.from)).toContain(satz.mit)
  })

  /**
   * ⚠ DIE ZWEITE REIHENFOLGE: dasselbe Ziel, aber in einem Kapitel OHNE Verweisnamen — genau das
   * tut Block 3 Nr. 18 mit `addon`. Der Name darf dann nicht generisch ersetzt werden („auf der
   * Kapitel „Ladeverhalten"" wäre grammatisch falsch und als Verweisfehler unkenntlich); der Satz
   * weicht auf seine Ersatzfassung aus.
   */
  it.each(SAETZE)('$name: weicht aus, sobald das Ziel ein anderes Kapitel bezieht', (satz) => {
    const verschoben = inKapitel1.map((p) =>
      p.id === satz.ziel ? { ...p, section: SECTION_ID.insight } : p,
    )
    const text = statementText(satz.statement, reportLayoutOf(verschoben), satz.from)

    expect(text).not.toContain(satz.mit)
    /* ⚠ Und ausdrücklich AUCH NICHT generisch ersetzt — das ergäbe „auf der Kapitel „…"". */
    expect(text).not.toContain('Kapitel „')
    expect(text).toContain(satz.ohne)
  })
})
