import { describe, expect, it } from 'vitest'

import { CHAT_TOOL_NAMES, buildChatTools, missingExtractionTools } from './tools'
import type { ChatExtractors } from './ports'

/**
 * B24 — DIE WERKZEUGLISTE.
 *
 * Die eine Eigenschaft, die hier trägt: ein Werkzeug ohne Rumpf wird GAR NICHT ANGEBOTEN. Die vier
 * Extraktoren liegen in `apps/website` und sind von dieser App aus nicht erreichbar (Begründung im
 * Kopf von `ports.ts`); ein angebotenes Werkzeug ohne Port wäre die Requisite, bei der das Modell
 * dem Kunden zusagt, seine Rechnung zu lesen, und dann nichts liest.
 */

const noop = (async () => ({ ok: false, reason: 'api_error' })) as unknown

function allExtractors(): Partial<ChatExtractors> {
  return {
    classifyDocument: noop as ChatExtractors['classifyDocument'],
    extractInvoiceData: noop as ChatExtractors['extractInvoiceData'],
    extractPvDesign: noop as ChatExtractors['extractPvDesign'],
    extractBatteryText: noop as ChatExtractors['extractBatteryText'],
  }
}

describe('buildChatTools', () => {
  it('⚠ ohne Extraktoren gibt es NUR die vier Zustands-Werkzeuge', () => {
    const names = buildChatTools({}).map((tool) => tool.name)
    expect(names).toEqual([
      'set_segment',
      'set_draft_field',
      'check_draft_completeness',
      'flag_open_question',
    ])
    expect(missingExtractionTools({})).toEqual([
      'classify_upload',
      'extract_invoice',
      'extract_pv_design',
      'extract_battery_description',
    ])
  })

  it('mit allen Ports gibt es alle acht — und in FESTER Reihenfolge', () => {
    const names = buildChatTools(allExtractors()).map((tool) => tool.name)
    expect(names).toEqual([...CHAT_TOOL_NAMES])
    expect(missingExtractionTools(allExtractors())).toEqual([])
  })

  it('schaltet einzeln — ein Port, ein Werkzeug', () => {
    const only = { extractInvoiceData: noop as ChatExtractors['extractInvoiceData'] }
    const names = buildChatTools(only).map((tool) => tool.name)
    expect(names).toContain('extract_invoice')
    expect(names).not.toContain('extract_pv_design')
  })

  it('jedes Werkzeug hat eine Beschreibung und ein Objekt-Schema', () => {
    for (const tool of buildChatTools(allExtractors())) {
      expect(tool.description, tool.name).toBeTruthy()
      expect(tool.input_schema.type, tool.name).toBe('object')
      // ⚠ Kein `strict` in dieser Fassung — die Prüfung liegt im Ausführer (Kopf von tools.ts).
      expect(tool.strict, tool.name).toBeUndefined()
    }
  })

  it('⚠ set_draft_field verlangt source — sonst wäre §3.2 eine Bitte statt einer Regel', () => {
    const tool = buildChatTools({}).find((entry) => entry.name === 'set_draft_field')
    expect(tool?.input_schema.required).toEqual(['field', 'value', 'source'])
    expect(tool?.description).toMatch(/Im Zweifel "assumed"/)
  })

  it('⚠ flag_open_question sagt im Werkzeugtext, dass Weg (b) die Frage NICHT schliesst', () => {
    const tool = buildChatTools({}).find((entry) => entry.name === 'flag_open_question')
    expect(tool?.description).toMatch(/LÖSCHT DIE FRAGE NICHT/)
  })
})
