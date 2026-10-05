import { EXISTING_BATTERY_ID } from 'shared'
import { describe, expect, it } from 'vitest'

import { formatEur } from '@/lib/format'

import {
  EXECUTIVE_SUMMARY_CASES as CASES,
  editRecommended,
  muster,
  unknownTariffYear,
  variant,
} from '@/test/executive-summary-cases'
import { lineCount } from '@/test/pdf-text-lines'
import { dailyPeaksOf } from './daily-peaks'
import { buildExecutiveSummary, type ExecutiveSummary } from './executive-summary'
import {
  EXECUTIVE_SUMMARY_FOOTER,
  executiveSummaryCopy,
  type ExecutiveSummaryCopy,
} from './executive-summary-copy'
import { EXEC_SLOTS, EXEC_TEXT_PT } from './executive-summary-layout'
import { headlineStorageOf } from './headline-storage'
import { recommendedEntryOf, unknownTariffWaysOf } from './summary'

const FORBIDDEN =
  /Kappung|Amortisation|Ladesteuerung|Leistungspreis|Dispatch|Hindsight|Lastspitzenkappung/i

const summaries = Object.fromEntries(
  Object.entries(CASES).map(([name, input]) => [name, buildExecutiveSummary(input)!]),
) as Record<string, ExecutiveSummary>

/** Tarif ohne Spitzengebühr (und damit ohne Spitzenersparnis). */
const noFee = buildExecutiveSummary(
  variant(({ analysis }) => {
    analysis.current.leistungspreisCostPerYear = 0
    analysis.annualScenario!.ways.peakShavingSavingEur = 0
  }),
)!

describe('buildExecutiveSummary', () => {
  it('Müldür-Jahr: Stufen, Rückzahlzeit und Netto aus den bestehenden Zahlen', () => {
    const s = summaries['jahr (Müldür)']!
    expect(s.variant).toBe('tarif-und-speicher')
    expect(s.header.basis).toBe('projected')
    expect(s.stages.map((stage) => stage.savingPerYearEur)).toEqual([8025, 2125])
    expect(s.header.savingPerYearEur).toBe(10150)
    expect(s.header.savingPercent).toBeUndefined()
    expect(s.header.customerName).toBe('Muster Gastro GmbH')
    expect(s.storage).toMatchObject({
      loadShiftEur: 965,
      peakEur: 1160,
      netSavingOverHorizonEur: 12700,
    })
    expect(s.storage!.amortizationYears.toFixed(1)).toBe('4.0')
    expect(s.storage!.breakEven).toHaveLength(11)
    expect(s.ways.map((w) => [w.id, w.isRecommended])).toEqual([
      ['today', false],
      ['spot', false],
      ['spot-storage', true],
    ])
    expect(s.load.capSegments!.length).toBeGreaterThan(0)
  })

  it.each(Object.keys(CASES))('%s: Stufen summieren sich, Speicher = Hauptzahl', (name) => {
    const s = summaries[name]!
    const input = CASES[name]!
    expect(s.header.savingPerYearEur).toBe(
      s.stages.reduce((sum, st) => sum + st.savingPerYearEur, 0),
    )
    if (s.storage) {
      const headline = headlineStorageOf(input.analysis, recommendedEntryOf(input.analysis)!, input)
      expect(s.storage.savingPerYearEur).toBe(headline.savingPerYearEur)
      expect(s.stages.at(-1)!.savingPerYearEur).toBe(headline.savingPerYearEur)
    }
  })

  it('Varianten: Stufen und Speicherblock je Fall', () => {
    expect(summaries['nur-tarif (Katalog leer)']).toMatchObject({
      variant: 'nur-tarif',
      storage: null,
    })
    expect(summaries['nur-tarif (Katalog leer)']!.stages).toEqual([
      { id: 'ohne-anschaffung', savingPerYearEur: 8025 },
    ])
    const noPay = summaries['speicher-lohnt-nicht']!
    expect(noPay).toMatchObject({ variant: 'speicher-lohnt-nicht', storage: null })
    expect(noPay.storageVerdict!.judgement).toContain('rechnet er sich damit nicht')
    const subsidy = summaries['mit Förderung']!.storage!
    expect(subsidy.hasSubsidy).toBe(true)
    expect(subsidy.amortizationYears).toBeCloseTo(subsidy.investment.netEur / 2125, 6)
    const noPeak = summaries['ohne Spitzenersparnis']!
    expect(noPeak.storage).toMatchObject({ peakEur: 0, upperBound: false, savingPerYearEur: 965 })
    expect(noPeak.load.capSegments).toBeNull()
    expect(summaries['volles Jahr (konstruiert)']!.header.basis).toBe('annual')
  })

  it('gibt es nicht mit Bestandsspeicher: wohin dessen Spitzenersparnis gehört, ist offen', () => {
    const existing = variant(({ analysis }) => {
      const primary = analysis.perBattery[0]!
      analysis.existingBatteryAnalysis = {
        entry: { ...primary, battery: { ...primary.battery, id: EXISTING_BATTERY_ID } },
      } as never
      analysis.annualScenario!.device = { batteryId: EXISTING_BATTERY_ID, name: 'Bestand' }
    })
    expect(buildExecutiveSummary(existing)).toBeNull()
  })

  it('gibt es nicht ohne Jahresbasis, ohne bekannten Tarif und für Privat', () => {
    expect(buildExecutiveSummary(muster(false))).toBeNull()
    expect(buildExecutiveSummary({ ...muster(true), priceDisplay: 'gross' })).toBeNull()
    const unknown = variant(({ analysis: a }) => {
      if (a.tariffOptimization?.computable === true)
        a.tariffOptimization.monthlyComparison!.currentTariffEur = null
    })
    expect(buildExecutiveSummary(unknown)).toBeNull()
  })
})

describe('executiveSummaryCopy', () => {
  const copies = Object.entries(summaries).map(
    ([name, s]) => [name, s, executiveSummaryCopy(s)] as const,
  )
  const textOf = (copy: ExecutiveSummaryCopy) => JSON.stringify(copy)
  const storageText = (copy: ExecutiveSummaryCopy) => copy.storage!.map((r) => r.text).join('')

  it('kein Fachbegriff in den Kundentexten (Positivkontrolle: der Test schlägt an)', () => {
    expect(FORBIDDEN.test('Der Speicher übernimmt die Ladesteuerung.')).toBe(true)
    for (const [name, , copy] of copies) expect(textOf(copy).match(FORBIDDEN), name).toBeNull()
  })

  it('Hero: „bis zu" mit Spitzenersparnis, sonst „rund"; Basis je Hochrechnung', () => {
    const müldür = executiveSummaryCopy(summaries['jahr (Müldür)']!)
    expect(müldür.hero).toEqual({ amount: `bis zu ${formatEur(10150)}`, text: 'pro Jahr' })
    expect(müldür.basis).toBe('geschätzt, hochgerechnet aus 157 gemessenen Tagen')
    expect(executiveSummaryCopy(summaries['ohne Spitzenersparnis']!).hero.amount).toBe(
      `rund ${formatEur(8990)}`,
    )
    expect(executiveSummaryCopy(summaries['volles Jahr (konstruiert)']!).basis).toMatch(
      /^gerechnet mit Ihren Messwerten von \d+ Tagen$/,
    )
  })

  it('Teilzahlen: Tarifwechsel links, Speicher rechts — ohne Speicher stattdessen eine Zeile unter der Zahl', () => {
    expect(executiveSummaryCopy(summaries['jahr (Müldür)']!).stages).toEqual([
      { amount: formatEur(8025), label: 'Wechsel zu aWATTar, ohne Anschaffung' },
      { amount: `bis zu ${formatEur(2125)}`, label: 'mit einem Speicher dazu' },
    ])
    expect(executiveSummaryCopy(summaries['ohne Spitzenersparnis']!).stages[1]!.amount).toBe(
      formatEur(965),
    )
    for (const name of ['nur-tarif (Katalog leer)', 'speicher-lohnt-nicht']) {
      const copy = executiveSummaryCopy(summaries[name]!)
      expect(copy.stages, name).toEqual([])
      expect(copy.heroDetail, name).toEqual(['durch den Wechsel zu aWATTar, ohne Anschaffung'])
      expect(textOf(copy).split('ohne Anschaffung').length - 1, name).toBe(1)
    }
    expect(executiveSummaryCopy(summaries['jahr (Müldür)']!).heroDetail).toEqual([])
  })

  it('Lastgang-Satz je Spitzengebühr und Spitzenersparnis', () => {
    const base = 'Die Balken zeigen Ihre höchste Leistung pro Tag.'
    const fee = `${base} Sie bestimmen die Spitzengebühr (für die höchste Spitze im Monat)`
    expect(executiveSummaryCopy(summaries['jahr (Müldür)']!).loadSentence).toBe(
      `${fee}; ein Speicher kann Spitzen über der Linie abfangen (Höchstwert).`,
    )
    expect(executiveSummaryCopy(summaries['ohne Spitzenersparnis']!).loadSentence).toBe(`${fee}.`)
    expect(executiveSummaryCopy(noFee).loadSentence).toBe(base)
  })

  it('Wege-Satz: empfohlener Weg, Spitzengebühr, deren Einsparung', () => {
    expect(executiveSummaryCopy(summaries['jahr (Müldür)']!).waysSentence).toBe(
      `Mit aWATTar und einem Speicher, der günstig lädt, sinken Ihre Kosten von rund ${formatEur(34794)} ` +
        `auf rund ${formatEur(25804)} — ohne Spitzengebühr; deren Einsparung (bis zu ${formatEur(1160)}) kommt hinzu.`,
    )
    expect(executiveSummaryCopy(summaries['nur-tarif (Katalog leer)']!).waysSentence).toBe(
      `Mit dem Wechsel zu aWATTar sinken Ihre Kosten von rund ${formatEur(34794)} ` +
        `auf rund ${formatEur(26769)} — ohne Spitzengebühr.`,
    )
    expect(executiveSummaryCopy(noFee).waysSentence).not.toContain('Spitzengebühr')
  })

  it('Speicher-Sätze: Rückzahlzeit-Varianten, Förderung im ersten Satz, Zahlen fett', () => {
    const müldür = executiveSummaryCopy(summaries['jahr (Müldür)']!)
    expect(storageText(müldür)).toBe(
      `Kostal & Dyness Retrofit S, 29,2 kWh nutzbar, Investition rund ${formatEur(8550)} netto. ` +
        'Rückzahlzeit: frühestens nach ca. 4 Jahren; allein durch günstiges Laden nach ca. 8,9 Jahren. ' +
        `Nach 10 Jahren bleiben unterm Strich bis zu ${formatEur(12700)}.`,
    )
    expect(müldür.storage!.filter((r) => r.bold).map((r) => r.text)).toEqual([
      formatEur(8550),
      'ca. 4 Jahren',
      'ca. 8,9 Jahren',
      formatEur(12700),
    ])
    expect(storageText(executiveSummaryCopy(summaries['ohne Spitzenersparnis']!))).toContain(
      'Rückzahlzeit: nach ca. 8,9 Jahren. Nach 10 Jahren bleiben unterm Strich rund',
    )
    expect(storageText(executiveSummaryCopy(summaries['mit Förderung']!))).toContain(
      `netto, nach Förderung rund ${formatEur(6550)}. Rückzahlzeit: frühestens nach ca. 3,1 Jahren`,
    )
    expect(storageText(executiveSummaryCopy(summaries['Worst Case']!))).toContain(
      'allein durch günstiges Laden rechnet sich der Speicher innerhalb von 10 Jahren nicht.',
    )
  })

  it('ohne Speicherempfehlung: keine Speicher-Sätze; lohnt nicht: nur das Urteil', () => {
    expect(executiveSummaryCopy(summaries['nur-tarif (Katalog leer)']!)).toMatchObject({
      storage: null,
      storageVerdict: null,
    })
    const notWorth = executiveSummaryCopy(summaries['speicher-lohnt-nicht']!)
    expect(notWorth.storage).toBeNull()
    expect(notWorth.storageVerdict).toMatch(/^Ein neuer Speicher \(/)
  })

  it('Lastgang- und Wege-Satz höchstens zwei Zeilen bei 10,5 pt (Positivkontrolle)', () => {
    expect(
      lineCount(
        `${copies[0]![2].loadSentence} Sie wird zusätzlich erklärt.`,
        EXEC_TEXT_PT,
        EXEC_SLOTS.load.width,
      ),
    ).toBe(3)
    for (const [name, , copy] of [
      ...copies,
      ['ohne Spitzengebühr', noFee, executiveSummaryCopy(noFee)] as const,
    ]) {
      for (const sentence of [copy.loadSentence, copy.waysSentence]) {
        expect(
          lineCount(sentence, EXEC_TEXT_PT, EXEC_SLOTS.load.width),
          `${name}: ${sentence}`,
        ).toBeLessThanOrEqual(2)
      }
    }
  })

  it('Fusszeile ohne Seitenverweis', () => {
    expect(EXECUTIVE_SUMMARY_FOOTER).toBe(
      'Schätzung, keine Zusage. Annahmen und Risiken, u. a. beim Börsenpreis, im weiteren Bericht.',
    )
    expect(EXECUTIVE_SUMMARY_FOOTER).not.toMatch(/Seite|\d/)
  })
})

describe('Variante „tarif-unbekannt"', () => {
  const name = 'tarif-unbekannt (konstruiert)'
  const s = summaries[name]!
  const copyText = (summary: ExecutiveSummary) => JSON.stringify(executiveSummaryCopy(summary))

  it('Hauptzahl = günstiges Laden + Stromspitzen, zwei Balken aus dem Modell, keine Teilzahlen', () => {
    const input = CASES[name]!
    const headline = headlineStorageOf(input.analysis, recommendedEntryOf(input.analysis)!, input)
    expect(s.variant).toBe('tarif-unbekannt')
    expect(s.header.savingPerYearEur).toBe(headline.ladesteuerungEur + headline.spitzenEur)
    const unknown = unknownTariffWaysOf(input.analysis)!
    expect(s.ways.map((w) => [w.id, w.costPerYearEur, w.isRecommended])).toEqual([
      ['spot', unknown.uncontrolledEur, false],
      ['spot-storage', unknown.controlledEur, true],
    ])
    expect(s.todayCostPerYearEur).toBeNull()
    expect(executiveSummaryCopy(s).stages).toEqual([])
  })

  it('Texte: Bezug aWATTar, Tarif unbekannt genau einmal, kein Heute-Tarif, kein Tarifwechsel-Wert', () => {
    const copy = executiveSummaryCopy(s)
    expect(copy.hero.amount).toBe(`bis zu ${formatEur(s.header.savingPerYearEur)}`)
    expect(copy.heroDetail).toEqual([
      'Ersparnis durch einen Speicher gegenüber aWATTar ohne Speicher',
      'Ihren aktuellen Tarif kennen wir nicht; ein Tarifwechsel ist deshalb nicht bewertet.',
    ])
    expect(copy.basis).toBe('gerechnet mit Ihren Messwerten von 365 Tagen')
    expect(copy.waysSentence).toBe(
      `Mit einem Speicher, der günstig lädt, sinken Ihre Kosten bei aWATTar von rund ${formatEur(s.ways[0]!.costPerYearEur)} ` +
        `auf rund ${formatEur(s.ways[1]!.costPerYearEur)} — ohne Spitzengebühr; deren Einsparung (bis zu ${formatEur(1160)}) kommt hinzu.`,
    )
    const text = copyText(s)
    expect(text.split('Ihren aktuellen Tarif kennen wir nicht').length - 1).toBe(1)
    // Positivkontrolle: dieselben Muster treffen im Müldür-Text.
    for (const absent of ['Ihr Tarif heute', 'Wechsel zu aWATTar, ohne Anschaffung']) {
      expect(text, absent).not.toContain(absent)
      expect(copyText(summaries['jahr (Müldür)']!), absent).toContain(absent)
    }
  })

  it('keine Vorderseite bei Teiljahr oder ohne Speicher, der sich rechnet', () => {
    const partYear = (withAnnualScenario: boolean) => {
      const input = structuredClone(muster(withAnnualScenario))
      const optimization = input.analysis.tariffOptimization
      if (optimization?.computable !== true) throw new Error('Fixture ohne Tarifvergleich')
      optimization.monthlyComparison!.currentTariffEur = null
      return input
    }
    expect(buildExecutiveSummary(partYear(false))).toBeNull()
    expect(buildExecutiveSummary(partYear(true))).toBeNull()
    const noCatalog = unknownTariffYear(({ analysis }) => {
      analysis.recommendation = null
      analysis.perBattery = []
    })
    expect(buildExecutiveSummary(noCatalog)).toBeNull()
    const notWorth = unknownTariffYear((input) =>
      editRecommended(input, (e) => {
        e.netSavingOverHorizon = -1
      }),
    )
    expect(buildExecutiveSummary(notWorth)).toBeNull()
  })
})

describe('dailyPeaksOf', () => {
  it('nimmt das Maximum je lokalem Kalendertag', () => {
    const peaks = dailyPeaksOf({
      timezoneMeta: 'Europe/Vienna',
      readings: [
        { ts: '2026-03-27T22:45:00Z', gridPowerKw: 9 }, // 27.03. 23:45 lokal
        { ts: '2026-03-27T23:00:00Z', gridPowerKw: 4 }, // 28.03. 00:00 lokal
        { ts: '2026-03-28T11:00:00Z', gridPowerKw: 7 },
      ],
    } as never)
    expect(peaks).toEqual([
      { day: '2026-03-27', peakKw: 9 },
      { day: '2026-03-28', peakKw: 7 },
    ])
  })

  it('deckt im Müldür-Lastgang jeden Tag ab und trifft die Gesamtspitze', () => {
    const { loadProfile } = muster(false)
    const peaks = dailyPeaksOf(loadProfile)
    expect(Math.max(...peaks.map((p) => p.peakKw))).toBe(
      Math.max(...loadProfile.readings.map((r) => r.gridPowerKw)),
    )
    expect(peaks.length).toBeGreaterThanOrEqual(157)
  })
})
