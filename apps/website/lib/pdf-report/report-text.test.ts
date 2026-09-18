import { describe, expect, it } from 'vitest'
import type { BatteryRoiEntry, MonthlyTariffComparison } from 'shared'

import { buildAssumptions, TARIFF_COMPONENTS_TABLE_ID } from './basis'
import { buildComparisonChapter, CANDIDATE_TABLE_ID } from './comparison'
import { buildDetailChapter, buildMonthlyChapter } from './detail'
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
} from './report-text'
import type { ReportStatement } from './statement'
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
    supplierBaseFeeEur: 0,
    awattarBaseFeeEur: 4.79,
    supplierFeeEurPerMonth: 0,
    awattarFeeEurPerMonth: 4.79,
    coveredDays: 31,
  },
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
    recommendation: { batteryId: BATTERY.id, rationale: '' },
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

function summaryPlacements(summary: ReportSummary): ReportPlacement[] {
  return summary.statements.map((s) => placementOf(s, SECTION_ID.results))
}

function bodyOf(summary: ReportSummary, id: string, layout: ReportLayout): string {
  const statement = summary.statements.find((s) => s.id === id)
  return resolveReportText(statement?.body ?? '', layout, id)
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 1 — Position + Feld-Referenz: `peak_shaving` → Kopfzahl von `savings`
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('peak_shaving — Verweis auf die Kopfzahl von savings', () => {
  it('sagt in der Kassen-Fassung wortgleich, was vor Stufe D dastand', () => {
    const summary = buildReportSummary(analysisFor(true), { source: 'net_signed' })
    const body = bodyOf(summary, 'peak_shaving', reportLayoutOf(summaryPlacements(summary)))

    expect(body).toBe(
      'Der Leistungspreis hängt an Ihrem Netzbetreiber und nicht an Ihrem Stromvertrag — dieser ' +
        'Anteil bleibt auch dann bestehen, wenn Sie den Lieferanten wechseln. ' +
        'Dieser Betrag steckt NICHT in der Zahl oben: der Monatsvergleich führt nur Arbeits- und ' +
        'Netz-Arbeitspreis samt Grundgebühren. Er kommt hinzu — addieren lässt er sich trotzdem ' +
        'nicht, weil er eine Jahresgrösse ist und die Zahl oben ein Zeitraumbetrag.',
    )
  })

  it('sagt in der §3.7-Fassung wortgleich, was vor Stufe D dastand', () => {
    const summary = buildReportSummary(analysisFor(false), { source: 'net_signed' })
    const body = bodyOf(summary, 'peak_shaving', reportLayoutOf(summaryPlacements(summary)))

    expect(body).toContain(
      'Dieser Betrag ist in der Gesamtersparnis oben bereits als erste Zeile enthalten und kommt ' +
        'nicht zusätzlich obendrauf.',
    )
  })

  /**
   * ⚠ DER NACHWEIS, DASS DER ORT NICHT MEHR IM TEXT STECKT: dieselbe Aussage, `savings` einmal
   * NACH `peak_shaving` gelesen. Vor Stufe D stand „oben" als Literal im Satz und wäre falsch
   * geblieben.
   */
  it('dreht die Ortsangabe mit der Leseordnung', () => {
    const summary = buildReportSummary(analysisFor(true), { source: 'net_signed' })
    const umsortiert = [...summaryPlacements(summary)].reverse()
    const body = bodyOf(summary, 'peak_shaving', reportLayoutOf(umsortiert))

    expect(body).toContain('steckt NICHT in der Zahl weiter unten')
    expect(body).not.toContain('der Zahl oben')
  })
})

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * 2 — Zeilen-Referenz: `load_shift` → eine Zeile von `savings`
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

describe('load_shift — Verweis auf eine Zeile von savings', () => {
  it('nennt die Zeile mit ihrer echten Beschriftung, in beiden Fassungen wortgleich', () => {
    const kasse = buildReportSummary(analysisFor(true), { source: 'net_signed' })
    expect(bodyOf(kasse, 'load_shift', reportLayoutOf(summaryPlacements(kasse)))).toContain(
      'was Ihre PV-Erzeugung über den Speicher zusätzlich einspart, steckt in der Zeile „Wert der ' +
        'Ladesteuerung" in der Aufschlüsselung oben mit drin.',
    )

    const attribution = buildReportSummary(analysisFor(false), { source: 'net_signed' })
    expect(
      bodyOf(attribution, 'load_shift', reportLayoutOf(summaryPlacements(attribution))),
    ).toContain(
      'was Ihre PV-Erzeugung über den Speicher zusätzlich einspart, steht als eigener Anteil ' +
        '(„Eigenverbrauch") daneben.',
    )
  })

  /** Die Zeile gibt es nur in EINER Fassung — fehlt sie, greift die Ersatzformulierung. */
  it('fällt auf die Ersatzformulierung zurück, wenn die Zeile nicht im Dokument steht', () => {
    const summary = buildReportSummary(analysisFor(true), { source: 'net_signed' })
    const ohneZeilen = summaryPlacements(summary).map((p) =>
      p.id === 'savings' ? { ...p, rows: {} } : p,
    )

    expect(bodyOf(summary, 'load_shift', reportLayoutOf(ohneZeilen))).toContain(
      'zusätzlich einspart, steckt in der Gesamtersparnis mit drin.',
    )
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
        'die Kurve darüber und wie die Empfehlung im Kapitel „Empfehlung und Lastverlauf". Das ' +
        'empfohlene Gerät steht deshalb hier nicht noch einmal: es ist dort vollständig ' +
        'aufgeschlüsselt. Diese Tabelle sagt, was die Alternativen dagegen leisten — und um ' +
        'welchen Betrag die Empfehlung besser ist. Die §3.8-Hinweise eines Geräts (Betonsockel, ' +
        'separater Wechselrichter, zu geringe Leistung für alle Spitzen) sind in der Investition ' +
        'bereits enthalten, stehen hier aber nicht je Zeile — sie stehen beim empfohlenen Gerät.',
    )
  })

  /**
   * ⚠ DER KERN-NACHWEIS DIESES SCHRITTS: die Empfehlung wandert in DASSELBE Kapitel, und der Satz
   * sagt von selbst „oben" statt den Kapitelnamen zu nennen. Vor Stufe D stand
   * „im Kapitel „Empfehlung und Lastverlauf"" als Literal im Text (die einzige Stelle im ganzen
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
      id: 'savings',
      section: SECTION_ID.results,
      title: 'Was Sie sparen',
      amount: 'pro Jahr',
      rows: { peak: 'Spitzenkappung (Leistungspreis)' },
    },
    {
      id: 'peak_shaving',
      section: SECTION_ID.results,
      title: 'Ihre Lastspitze wird gekappt',
      amount: 'pro Jahr',
      rows: {},
    },
  ])

  it('setzt beide Platzhalter ein', () => {
    const text = t`Die Zeile ${ref(row('savings', 'peak'), `„${REF_LABEL}" ${REF_PLACE}`, 'x')}.`
    expect(resolveReportText(text, LAYOUT, 'peak_shaving')).toBe(
      'Die Zeile „Spitzenkappung (Leistungspreis)" oben.',
    )
  })

  it('lässt den GANZEN Text entfallen, wenn `absent` null ist', () => {
    const text = t`Etwas über ${ref(block('load_shift'), REF_PLACE, null)} und noch mehr.`
    expect(resolveReportText(text, LAYOUT, 'peak_shaving')).toBe('')
  })

  it('lässt eine blosse Zeichenkette unverändert', () => {
    expect(resolveReportText('Ein fertiger Satz.', LAYOUT, 'peak_shaving')).toBe(
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
    const summary = buildReportSummary(analysis, { source: 'net_signed' })

    const mit = resolveReportText(
      chapter.recommendation!.body,
      reportLayoutOf(summaryPlacements(summary)),
      'recommendation',
    )
    expect(mit).toContain('steht auf der Kernergebnis-Seite')

    const ohne = resolveReportText(
      chapter.recommendation!.body,
      reportLayoutOf(summaryPlacements(summary).filter((p) => p.id !== 'addon')),
      'recommendation',
    )
    expect(ohne).not.toContain('Kernergebnis-Seite')
    expect(ohne).toContain('wenn ich Ihre Anlage durch ein neues Gerät ersetzte?".')
  })

  it('`table_candidates` abgewählt: der Klarsatz nennt keine Spalten mehr', () => {
    const analysis = analysisFor(true)
    const chapter = buildComparisonChapter(analysis)
    const eintrag = placementOf(chapter.statement, SECTION_ID.comparison)

    const mit = resolveReportText(
      chapter.statement.body,
      reportLayoutOf([
        eintrag,
        {
          id: CANDIDATE_TABLE_ID,
          section: SECTION_ID.comparison,
          title: '',
          amount: null,
          rows: {},
          columns: Object.fromEntries(
            chapter.table!.columns.flatMap((c) => (c.key ? [[c.key, c.label] as const] : [])),
          ),
        },
      ]),
      'addon_table',
    )
    expect(mit).toContain('die Spalten „Ersparnis/Jahr" und „Netto" sind also Differenzen')

    const ohne = resolveReportText(chapter.statement.body, reportLayoutOf([eintrag]), 'addon_table')
    expect(ohne).toContain('die ausgewiesenen Beträge sind also Differenzen')
    expect(ohne).not.toContain('Spalten')
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
    expect(REPORT_SECTIONS[SECTION_ID.results].reference).toBe('Kernergebnis-Seite')

    for (const key of [SECTION_ID.monthly, SECTION_ID.insight, SECTION_ID.comparison]) {
      expect(REPORT_SECTIONS[key].reference).toBeUndefined()
    }
  })

  const analysis = analysisFor(true)
  const chapter = buildRecommendationChapter(analysis)

  /* Die Hochrechnungs-Aussage entsteht nur bei einem Teilzeitraum — sonst fehlt der Satz ganz. */
  const teiljahr: PdfReportAnalysis = {
    ...analysis,
    perBattery: [{ ...ENTRY, annualizationFactor: 2, coveredDays: 180 }, ZWEITES],
    existingBatteryAnalysis: {
      entry: { ...ENTRY, annualizationFactor: 2, coveredDays: 180 },
      addonScenarios: [],
    },
  }

  /** Die fünf migrierten Sätze, je mit dem Baustein, der sie trägt, und seinem Ziel. */
  const SAETZE = [
    {
      name: 'recommendation → addon',
      body: chapter.recommendation!.body,
      from: 'recommendation',
      ziel: 'addon' as const,
      mit: 'steht auf der Kernergebnis-Seite',
      ohne: 'ersetzte?".',
    },
    {
      name: 'load_control → load_shift (Hochrechnung)',
      body: buildRecommendationChapter(teiljahr).loadControl!.body,
      from: 'load_control',
      ziel: 'load_shift' as const,
      mit: 'die Zahl auf der Kernergebnis-Seite ist',
      ohne: 'der ausgewiesene Wert ist',
    },
    {
      name: 'load_control → Zeile von savings',
      body: chapter.loadControl!.body,
      from: 'load_control',
      ziel: 'savings' as const,
      mit: 'in der Aufschlüsselung der Kernergebnis-Seite',
      ohne: 'Er steckt in der Gesamtersparnis bereits mit drin',
    },
    {
      name: 'monthly_comparison → savings',
      body: buildDetailChapter(analysis).cost!.statement!.body,
      from: 'monthly_comparison',
      ziel: 'savings' as const,
      mit: 'Die Kernergebnis-Seite zeigt die DIFFERENZEN',
      ohne: 'Hier stehen die drei Summen absolut.',
    },
    {
      name: 'monthly_comparison → load_shift',
      body: buildMonthlyChapter(analysisFor(false))!.statement.body,
      from: 'monthly_comparison',
      ziel: 'load_shift' as const,
      mit: 'auf der Kernergebnis-Seite ist NICHT aus diesen drei Summen',
      ohne: 'Die drei Summen stehen hier absolut.',
    },
  ]

  /*
   * Die Zusammenstellung, die das Dokument heute hat. Beide Fassungen von `savings` sind vertreten,
   * damit jeder der fünf Sätze sein Ziel findet — sie schliessen einander im Dokument aus, hier
   * geht es allein um die Kapitelzuordnung.
   */
  const inKapitel1 = summaryPlacements(
    buildReportSummary(analysisFor(false), { source: 'net_signed' }),
  ).concat(summaryPlacements(buildReportSummary(analysis, { source: 'net_signed' })))

  it.each(SAETZE)('$name: nennt Kapitel 1 beim Namen, solange das Ziel dort steht', (satz) => {
    expect(resolveReportText(satz.body, reportLayoutOf(inKapitel1), satz.from)).toContain(satz.mit)
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
    const text = resolveReportText(satz.body, reportLayoutOf(verschoben), satz.from)

    expect(text).not.toContain(satz.mit)
    /* ⚠ Und ausdrücklich AUCH NICHT generisch ersetzt — das ergäbe „auf der Kapitel „…"". */
    expect(text).not.toContain('Kapitel „')
    expect(text).toContain(satz.ohne)
  })
})
