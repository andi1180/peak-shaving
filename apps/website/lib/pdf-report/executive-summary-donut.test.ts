import { describe, expect, it } from 'vitest'

import { formatEur } from '@/lib/format'
import { EXECUTIVE_SUMMARY_CASES as CASES } from '@/test/executive-summary-cases'
import { lineCount, textWidthPt } from '@/test/pdf-text-lines'
import { buildExecutiveSummary, type ExecutiveSummary } from './executive-summary'
import { executiveSummaryCopy } from './executive-summary-copy'
import { EXEC_DONUT_LEGEND_LABEL_WIDTH, execDonutOf } from './executive-summary-donut'
import { EXEC_SLOTS } from './executive-summary-layout'

const summary = (name: string) => buildExecutiveSummary(CASES[name]!)!

/** Die Segmente, wie das Modell sie vorgibt: Tarifwechsel, günstig laden, Spitzen (ohne 0). */
function modelSegments(s: ExecutiveSummary): [string, number][] {
  const st = s.storage!
  return (
    [
      ['switch', s.stages.find((stage) => stage.id === 'ohne-anschaffung')!.savingPerYearEur],
      ['control', st.loadShiftEur],
      ['peak', st.peakEur],
    ] as [string, number][]
  ).filter(([, eur]) => eur > 0)
}

describe('execDonutOf', () => {
  it('Müldür-Jahr: drei Segmente aus dem Modell, Summe = Hauptzahl', () => {
    const s = summary('jahr (Müldür)')
    const donut = execDonutOf(s)!
    expect(donut.segments.map((seg) => [seg.key, seg.eur])).toEqual(modelSegments(s))
    expect(donut.segments.map((seg) => seg.label)).toEqual([
      'Wechsel zu aWATTar',
      'Speicher lädt günstig',
      'Weniger Spitzen (Höchstwert)',
    ])
    const sum = donut.segments.reduce((total, seg) => total + seg.eur, 0)
    expect(sum).toBe(donut.totalEur)
    expect(donut.totalEur).toBe(s.header.savingPerYearEur)
    expect(donut.total).toBe(formatEur(10150))
    expect(donut.total).toBe(executiveSummaryCopy(s).savingBox.amount)
    expect(donut.qualifier).toBe('bis zu')
    // Tarifwechsel = Balken 1 − 2, günstig laden = Balken 2 − 3.
    const [today, spot, storage] = s.ways.map((w) => w.costPerYearEur)
    expect(Math.round(today! - spot!)).toBe(8025)
    expect(donut.segments[0]!.eur).toBe(8025)
    expect(Math.round(spot! - storage!)).toBe(Math.round(donut.segments[1]!.eur))
    expect(Math.round(donut.segments[1]!.eur)).toBe(965)
  })

  it('Winkel proportional, ab 12 Uhr im Uhrzeigersinn, kleinstes Segment sichtbar', () => {
    const donut = execDonutOf(summary('jahr (Müldür)'))!
    expect(donut.segments[0]!.startDeg).toBe(0)
    expect(donut.segments.at(-1)!.endDeg).toBeCloseTo(360, 9)
    for (const seg of donut.segments) {
      expect((seg.endDeg - seg.startDeg) / 360).toBeCloseTo(seg.eur / donut.totalEur, 9)
      expect(seg.endDeg - seg.startDeg).toBeGreaterThanOrEqual(4)
    }
  })

  it('ohne Spitzenersparnis: zwei Segmente, „rund"', () => {
    const donut = execDonutOf(summary('ohne Spitzenersparnis'))!
    expect(donut.segments.map((seg) => seg.key)).toEqual(['switch', 'control'])
    expect(donut.qualifier).toBe('rund')
  })

  it('kein Ring ohne Speicherblock oder ohne Tarifwechsel-Anteil', () => {
    for (const name of [
      'nur-tarif (Katalog leer)',
      'speicher-lohnt-nicht',
      'tarif-unbekannt (konstruiert)',
      'tarif-unbekannt Worst Case',
    ]) {
      expect(execDonutOf(summary(name)), name).toBeNull()
    }
    expect(execDonutOf(summary('Worst Case'))).not.toBeNull()
  })

  it('Positivkontrolle: 1 € Abweichung eines Segments fällt auf', () => {
    const s = summary('jahr (Müldür)')
    const segments = execDonutOf(s)!.segments.map((seg) => [seg.key, seg.eur])
    segments[1]![1] = (segments[1]![1] as number) + 1
    expect(segments).not.toEqual(modelSegments(s))
  })

  it('Legende: Label höchstens zwei Zeilen, Betrag einzeilig, Mitte passt ins Loch', () => {
    const width = EXEC_DONUT_LEGEND_LABEL_WIDTH(EXEC_SLOTS.donut.width)
    for (const [name] of Object.entries(CASES)) {
      const donut = execDonutOf(summary(name))
      if (!donut) continue
      for (const seg of donut.segments) {
        expect(lineCount(seg.label, 8, width), `${name}: ${seg.label}`).toBeLessThanOrEqual(2)
        expect(lineCount(seg.amount, 8.5, width), `${name}: ${seg.amount}`).toBe(1)
      }
      expect(textWidthPt(donut.total, 13, true), name).toBeLessThanOrEqual(88 - 2 * 15 - 4)
    }
  })
})
