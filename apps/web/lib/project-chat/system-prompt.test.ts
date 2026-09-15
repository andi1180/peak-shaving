import { describe, expect, it } from 'vitest'

import { ENERGY_ADVISOR_SYSTEM_PROMPT, buildProjectStateBlock } from './system-prompt'
import type { ChatExtractors, MeteringPointRow, ProjectSnapshot } from './ports'

/**
 * B24, Station 6 — DER ZUSTANDSBLOCK IN SEINEN ZWEI ROLLEN.
 *
 * Die eine Eigenschaft, die hier trägt: der Absatz über fehlende Extraktions-Werkzeuge ist eine
 * Aussage über DIESEN Lauf. Für den Energieberater wäre er eine Aussage über eine Fähigkeit, die
 * seiner Rolle nie zugedacht war — also erfunden, nicht eingeschränkt. Der Kunden-Chat behält ihn
 * unverändert, und genau das misst der Gegentest: „weggelassen" heisst hier eine Rolle, nicht
 * insgesamt.
 */

const MISSING_NOTE = 'Nicht verfügbar in diesem Lauf'

function project(): ProjectSnapshot {
  return { segment: 'betrieb', industry: 'hotel' }
}

function meteringPoint(): MeteringPointRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    interval_minutes: 15,
    covered_from: '2025-01-01T00:00:00Z',
    covered_to: '2026-01-01T00:00:00Z',
    gaps: [],
    source_document_id: null,
    draft: { energyPriceCtPerKwh: 24.5 },
  }
}

function block(overrides: { extractors?: Partial<ChatExtractors>; includeMissingToolsNote?: boolean }) {
  return buildProjectStateBlock({
    project: project(),
    meteringPoints: [meteringPoint()],
    documents: [],
    openQuestions: [],
    extractors: overrides.extractors ?? {},
    ...(overrides.includeMissingToolsNote === undefined
      ? {}
      : { includeMissingToolsNote: overrides.includeMissingToolsNote }),
  })
}

describe('buildProjectStateBlock — includeMissingToolsNote', () => {
  it('⚠ POSITIV-KONTROLLE: ohne den Parameter steht der Absatz da (Kunden-Chat unverändert)', () => {
    const text = block({})
    expect(text).toContain(MISSING_NOTE)
    // Ohne diese Gegenprobe wäre der Test darunter auch dann grün, wenn der Absatz NIE erschiene.
    expect(text).toContain('classify_upload')
  })

  it('⚠ mit false fehlt der Absatz VOLLSTÄNDIG — auch bei leeren extractors', () => {
    const text = block({ extractors: {}, includeMissingToolsNote: false })
    expect(text).not.toContain(MISSING_NOTE)
    for (const leser of [
      'classify_upload',
      'extract_invoice',
      'extract_pv_design',
      'extract_battery_description',
      'extract_load_profile',
    ]) {
      expect(text).not.toContain(leser)
    }
  })

  it('mit true verhält es sich wie ohne den Parameter', () => {
    expect(block({ includeMissingToolsNote: true })).toBe(block({}))
  })

  it('der übrige Zustand bleibt in beiden Fällen gleich', () => {
    const mit = block({})
    const ohne = block({ includeMissingToolsNote: false })
    // Der Unterschied ist AUSSCHLIESSLICH der eine Absatz: alles vor ihm ist byte-gleich.
    expect(mit.startsWith(ohne)).toBe(true)
    for (const teil of ['Segment: betrieb', 'Branche: hotel', 'Zählpunkte und ihre Entwürfe:']) {
      expect(ohne).toContain(teil)
    }
  })
})

describe('ENERGY_ADVISOR_SYSTEM_PROMPT', () => {
  it('⚠ nennt die drei Werkzeuge, die der Energieberater hat', () => {
    for (const name of ['check_data_consistency', 'flag_open_question', 'set_draft_field']) {
      expect(ENERGY_ADVISOR_SYSTEM_PROMPT).toContain(name)
    }
  })

  it('⚠ nennt KEINES der drei Ersterfassungs-Werkzeuge', () => {
    // Ein genanntes Werkzeug ohne Angebot ist eine Zusage, die das Modell nicht einlösen kann.
    for (const name of ['set_segment', 'set_industry', 'check_draft_completeness']) {
      expect(ENERGY_ADVISOR_SYSTEM_PROMPT).not.toContain(name)
    }
  })

  it('⚠ hält die Entscheidungsregel fest: zwei Wege, nie selbst entscheiden', () => {
    expect(ENERGY_ADVISOR_SYSTEM_PROMPT).toMatch(/nie entscheidest du selbst/)
    expect(ENERGY_ADVISOR_SYSTEM_PROMPT).toMatch(/"assumed"/)
  })

  it('weist auf kundenfreundliche Sprache statt interner Bezeichner hin', () => {
    expect(ENERGY_ADVISOR_SYSTEM_PROMPT).toMatch(/nicht wie ein Entwickler/)
  })

  it('siezt, nennt nie den Namen aus flag_open_question, speichert Bestätigungen und meidet Doppelfragen', () => {
    expect(ENERGY_ADVISOR_SYSTEM_PROMPT).toMatch(/"Sie" \(Höflichkeitsform\)/)
    expect(ENERGY_ADVISOR_SYSTEM_PROMPT).toMatch(/Nenne nie einen Namen/)
    expect(ENERGY_ADVISOR_SYSTEM_PROMPT).toMatch(/auch das IMMER über flag_open_question mit/)
    expect(ENERGY_ADVISOR_SYSTEM_PROMPT).toMatch(/bereits vorhandenen Rückfragen im Systemzustand/)
  })
})
