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
import { lineCount, textWidthPt } from '@/test/pdf-text-lines'
import { dailyPeaksOf } from './daily-peaks'
import { buildExecutiveSummary, type ExecutiveSummary } from './executive-summary'
import {
  EXECUTIVE_SUMMARY_FOOTER,
  executiveSummaryCopy,
  type ExecutiveSummaryCopy,
} from './executive-summary-copy'
import { fitFontSize } from './executive-summary-charts'
import { execDonutOf } from './executive-summary-donut'
import { EXEC_HERO, EXEC_SLOTS, EXEC_STORAGE, EXEC_TEXT_PT } from './executive-summary-layout'
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

  it('linke Box: Ersparnis mit „bis zu"/„rund", Unterzeile je Variante; Basis unter den Boxen', () => {
    const box = (name: string) => executiveSummaryCopy(summaries[name]!).savingBox
    expect(box('jahr (Müldür)')).toEqual({
      label: 'Ersparnis pro Jahr',
      qualifier: 'bis zu',
      amount: formatEur(10150),
      sub: 'Tarifwechsel plus Speicher',
    })
    expect(box('ohne Spitzenersparnis')).toMatchObject({
      qualifier: 'rund',
      amount: formatEur(8990),
    })
    for (const name of ['nur-tarif (Katalog leer)', 'speicher-lohnt-nicht']) {
      expect(box(name).sub, name).toBe('durch den Wechsel zu aWATTar, ohne Anschaffung')
    }
    expect(box('tarif-unbekannt (konstruiert)').sub).toBe(
      'durch einen Speicher gegenüber aWATTar ohne Speicher',
    )
    expect(executiveSummaryCopy(summaries['volles Jahr (konstruiert)']!).basisLine).toMatch(
      /^gerechnet mit Ihren Messwerten von \d+ Tagen$/,
    )
  })

  it('Basiszeile bei Hochrechnung: Monate aus dem ersten und letzten Messtag, auch über den Jahreswechsel', () => {
    expect(executiveSummaryCopy(summaries['jahr (Müldür)']!).basisLine).toBe(
      'geschätzt, hochgerechnet aus 157 gemessenen Tagen (März bis August)',
    )
    const winter = structuredClone(summaries['jahr (Müldür)']!)
    winter.load.dailyPeaks = [
      { day: '2025-11-03', peakKw: 30 },
      { day: '2026-02-27', peakKw: 30 },
    ]
    expect(executiveSummaryCopy(winter).basisLine).toBe(
      'geschätzt, hochgerechnet aus 157 gemessenen Tagen (November bis Februar)',
    )
    for (const [name, , copy] of copies) {
      expect(lineCount(copy.basisLine, 9, EXEC_SLOTS.load.width), name).toBeLessThanOrEqual(2)
    }
  })

  it('rechte Box nur mit Speicherblock: Rückzahlzeit wie im Text, „frühestens" nur mit Höchstwert', () => {
    const box = (name: string) => executiveSummaryCopy(summaries[name]!).paybackBox
    expect(box('jahr (Müldür)')).toEqual({
      label: 'Rückzahlzeit des Speichers',
      prefix: 'frühestens',
      value: 'ca. 4 Jahre',
      sub: `bei ${formatEur(8550)} Investition`,
    })
    expect(box('ohne Spitzenersparnis')).toMatchObject({ prefix: null, value: 'ca. 8,9 Jahre' })
    expect(box('mit Förderung')!.sub).toBe(`bei ${formatEur(6550)} Investition nach Förderung`)
    expect(box('Worst Case')).toMatchObject({
      value: 'ca. 7,1 Jahre',
      sub: `bei ${formatEur(15000)} Investition nach Förderung`,
    })
    expect(box('nur-tarif (Katalog leer)')).toBeNull()
    expect(box('speicher-lohnt-nicht')).toBeNull()
  })

  it('jede Boxzeile bleibt einzeilig, sonst liesse react-pdf in der festen Box Text weg', () => {
    for (const [name, summary, copy] of copies) {
      const inner = copy.paybackBox
        ? EXEC_HERO.innerWidth
        : EXEC_SLOTS.load.width - 2 * EXEC_HERO.padding - EXEC_HERO.edge
      const lines = [
        [copy.savingBox.amount, EXEC_HERO.valueMaxPt, true],
        [copy.savingBox.sub, EXEC_HERO.subMaxPt, false],
        [copy.paybackBox?.value ?? null, EXEC_HERO.valueMaxPt, true],
        [copy.paybackBox?.sub ?? null, EXEC_HERO.subMaxPt, false],
      ] as const
      for (const [text, max, bold] of lines) {
        if (!text || !summary.header.savingPerYearEur) continue
        const size = fitFontSize(text, inner, max, bold)
        expect(textWidthPt(text, size, bold), `${name}: ${text}`).toBeLessThanOrEqual(inner)
      }
    }
  })

  it('Hero-Box: Zahl passt in ihre Zeile, alle Zeilen in die feste Höhe, auch bei langen Werten', () => {
    const rows =
      9.5 * 1.1 + EXEC_HERO.prefixRowPt + EXEC_HERO.valueRowPt + EXEC_HERO.subMaxPt * 1.15
    expect(rows).toBeLessThanOrEqual(EXEC_HERO.height - 2 * EXEC_HERO.paddingVertical)
    const values = copies.flatMap(([, , c]) => [c.savingBox.amount, c.paybackBox?.value])
    for (const value of [...values, `bis zu ${formatEur(123_456)}`]) {
      if (!value) continue
      const size = fitFontSize(value, EXEC_HERO.innerWidth, EXEC_HERO.valueMaxPt, true)
      expect(size * 1.15, value).toBeLessThanOrEqual(EXEC_HERO.valueRowPt)
      expect(textWidthPt(value, size, true), value).toBeLessThanOrEqual(EXEC_HERO.innerWidth)
    }
  })

  it('Zeile „Ersparnis durch den Speicher" nur mit Speicherblock und nicht bei unbekanntem Tarif', () => {
    const line = (name: string) => executiveSummaryCopy(summaries[name]!).storageSaving
    expect(line('jahr (Müldür)')).toBe(
      `Ersparnis durch den Speicher: bis zu ${formatEur(2125)} pro Jahr.`,
    )
    expect(line('ohne Spitzenersparnis')).toBe(
      `Ersparnis durch den Speicher: rund ${formatEur(965)} pro Jahr.`,
    )
    for (const name of [
      'nur-tarif (Katalog leer)',
      'speicher-lohnt-nicht',
      'tarif-unbekannt (konstruiert)',
    ]) {
      expect(line(name), name).toBeNull()
    }
  })

  it('Teilzahlen sind entfallen (Positivkontrolle: das Muster trifft ohne Speicherblock)', () => {
    const müldür = textOf(executiveSummaryCopy(summaries['jahr (Müldür)']!))
    expect(müldür).not.toContain('Wechsel zu aWATTar, ohne Anschaffung')
    expect(müldür).not.toContain('mit einem Speicher dazu')
    expect(textOf(executiveSummaryCopy(summaries['nur-tarif (Katalog leer)']!))).toContain(
      'Wechsel zu aWATTar, ohne Anschaffung',
    )
  })

  it('Lastgang-Satz je Spitzengebühr und Spitzenersparnis', () => {
    const base = 'Die Balken zeigen Ihre höchste Leistung pro Tag.'
    const fee = `${base} Der höchste Balken im Monat bestimmt die Spitzengebühr`
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

  it('Speicher-Sätze: Gerät und Investition, Betrag nach dem Horizont; Rückzahlzeit nur „rechnet sich nicht"', () => {
    const müldür = executiveSummaryCopy(summaries['jahr (Müldür)']!)
    expect(storageText(müldür)).toBe(
      `Kostal & Dyness Retrofit S, 29,2 kWh nutzbar, Investition rund ${formatEur(8550)} netto. ` +
        `Nach 10 Jahren bleiben unterm Strich bis zu ${formatEur(12700)}.`,
    )
    expect(müldür.storage!.filter((r) => r.bold).map((r) => r.text)).toEqual([
      formatEur(8550),
      formatEur(12700),
    ])
    expect(storageText(executiveSummaryCopy(summaries['ohne Spitzenersparnis']!))).toContain(
      'netto. Nach 10 Jahren bleiben unterm Strich rund',
    )
    expect(storageText(executiveSummaryCopy(summaries['mit Förderung']!))).toContain(
      `netto, nach Förderung rund ${formatEur(6550)}. Nach 10 Jahren`,
    )
    // Satz 3 nur jenseits des Horizonts.
    expect(storageText(executiveSummaryCopy(summaries['Worst Case']!))).toMatch(
      / Allein durch günstiges Laden rechnet sich der Speicher innerhalb von 10 Jahren nicht\.$/,
    )
    for (const [name, s, copy] of copies) {
      if (!copy.storage) continue
      expect(storageText(copy), name).not.toContain('Rückzahlzeit')
      if (!s.storage!.paybackWithoutPeaksBeyondHorizon) {
        expect(storageText(copy), name).not.toContain('Allein durch')
      }
    }
  })

  it('Sätze und Boxzeilen des Speicherblocks: jede höchstens zwei Zeilen', () => {
    for (const [name, s, copy] of copies) {
      if (!copy.storage) continue
      // Jeder Satz unter den Boxen einzeln, volle Breite.
      for (const sentence of storageText(copy).split(/(?<=\.) (?=[A-ZÄÖÜ])/)) {
        expect(
          lineCount(sentence, EXEC_TEXT_PT, EXEC_SLOTS.load.width),
          `${name}: ${sentence}`,
        ).toBeLessThanOrEqual(2)
      }
      if (copy.storageSaving) {
        const width = execDonutOf(s) ? EXEC_SLOTS.breakEvenHalf.width : EXEC_SLOTS.breakEven.width
        expect(lineCount(copy.storageSaving, EXEC_STORAGE.linePt, width), name).toBeLessThanOrEqual(
          2,
        )
      }
    }
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
  })

  it('Texte: Bezug aWATTar, Tarif unbekannt genau einmal, kein Heute-Tarif, kein Tarifwechsel-Wert', () => {
    const copy = executiveSummaryCopy(s)
    expect(copy.savingBox).toMatchObject({
      qualifier: 'bis zu',
      amount: formatEur(s.header.savingPerYearEur),
    })
    expect(copy.basisLine).toBe(
      'gerechnet mit Ihren Messwerten von 365 Tagen · Ihren aktuellen Tarif kennen wir nicht; ein Tarifwechsel ist deshalb nicht bewertet.',
    )
    expect(copy.waysSentence).toBe(
      `Mit einem Speicher, der günstig lädt, sinken Ihre Kosten bei aWATTar von rund ${formatEur(s.ways[0]!.costPerYearEur)} ` +
        `auf rund ${formatEur(s.ways[1]!.costPerYearEur)} — ohne Spitzengebühr; deren Einsparung (bis zu ${formatEur(1160)}) kommt hinzu.`,
    )
    const text = copyText(s)
    expect(text.split('Ihren aktuellen Tarif kennen wir nicht').length - 1).toBe(1)
    // Positivkontrolle: dieselben Muster treffen in einer Variante mit bekanntem Tarif.
    for (const absent of ['Ihr Tarif heute', 'Wechsel zu aWATTar, ohne Anschaffung']) {
      expect(text, absent).not.toContain(absent)
      expect(copyText(summaries['nur-tarif (Katalog leer)']!), absent).toContain(absent)
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
