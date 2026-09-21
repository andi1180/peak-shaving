import { describe, expect, it } from 'vitest'

import { buildReportAgenda, LOAD_INTRO, LOAD_SECTION } from './content'
import { loadChartCaption } from './derive'

/**
 * Kapitel „Ihr Lastgang" — die reine Messseite zwischen „Voraussetzungen" und „Empfehlung".
 */
describe('Lastgang-Kapitel', () => {
  /*
   * ⚠ Der eigentliche Prüfgegenstand ist die ABWESENHEIT: das Zielbild trug unter dem Bild einen
   * gedeuteten Verlauf („der Rückgang ab Mai, sobald keine Heizlast mehr anfällt"), und es gibt
   * keine Muster- oder Trenderkennung, die so etwas für einen beliebigen Fall belegen könnte.
   */
  it('Bildunterschrift nennt Einheit und Zeitraum und deutet nichts', () => {
    expect(loadChartCaption('30.01.2026 – 26.08.2026')).toBe(
      'Netzbezug in kW, 30.01.2026 – 26.08.2026.',
    )
    /* Leerer Lastgang: `period` ist `null` — dann steht die Einheit ohne Zeitraum da. */
    expect(loadChartCaption(null)).toBe('Netzbezug in kW.')
  })

  /*
   * Die Kapitel-Reihenfolge ist doppelt geführt (Agenda und JSX-Seitenbaum, s. `content.ts`).
   * Hier hängt die Agenda-Hälfte; die andere misst der Seitenbaum selbst.
   */
  it('steht in der Agenda zwischen Voraussetzungen und Empfehlung', () => {
    const titles = buildReportAgenda({
      monthly: false,
      insight: false,
      comparison: false,
    }).map((s) => s.title)

    expect(titles.indexOf(LOAD_SECTION.title)).toBe(titles.indexOf('Voraussetzungen') + 1)
    expect(titles.indexOf('Empfehlung und Lastverlauf')).toBe(
      titles.indexOf(LOAD_SECTION.title) + 1,
    )
    expect(LOAD_INTRO).toContain('Grundlage für alle Zahlen')
  })
})
