import { describe, expect, it } from 'vitest'
import { emptyInvoiceExtraction } from 'shared'

import { readDraftProvenance } from './draft'
import { executeChatTool } from './executor'
import { createMemoryPorts, fakePdf } from './fixtures'

/**
 * B24 — DER WERKZEUG-AUSFÜHRER.
 *
 * Was hier geprüft wird, ist nicht „das Werkzeug funktioniert", sondern die Handvoll Eigenschaften,
 * an denen dieser Schritt richtig oder falsch ist:
 *
 *   (1) Eine Annahme SCHLIESST DIE RÜCKFRAGE NICHT (Delta §3.3) — der ganze Sinn des
 *       Zwei-Wege-Modells hängt an dieser einen Zeile.
 *   (2) `source` ist Pflicht, und eine erfundene Quelle wird abgewiesen (§3.2).
 *   (3) Mehrere Rechnungen laufen durch `mergeInvoiceExtractions`, nicht durch eine hier gebaute
 *       Zusammenführung — und ein WIDERSPRUCH wird benannt statt entschieden.
 *   (4) Ein fehlender Port ergibt einen lesbaren Fehlschlag, keinen Absturz.
 *   (5) Nichts wirft: jeder Ausgang ist ein `tool_result`, sonst bräche die Verlaufs-Invariante.
 */

const PROJECT = '11111111-2222-4333-8444-555555555555'
const NOW = new Date('2026-09-10T08:00:00.000Z')

function payload(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>
}

describe('set_draft_field', () => {
  it('schreibt Wert und Herkunft und nennt, was noch fehlt', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })

    const result = await executeChatTool(
      ports,
      PROJECT,
      'set_draft_field',
      { field: 'energyPriceCtPerKwh', value: 24.4, source: 'measured', note: 'Rechnung S. 2' },
      NOW,
    )

    expect(result.isError).toBe(false)
    expect(ports.project.draft.energyPriceCtPerKwh).toBe(24.4)
    expect(readDraftProvenance(ports.project.draft).energyPriceCtPerKwh).toMatchObject({
      source: 'measured',
      note: 'Rechnung S. 2',
    })
    expect(payload(result.content).still_missing).toContain('billingModel')
  })

  it('⚠ weist eine fehlende oder erfundene Quelle ab und schreibt NICHTS (§3.2)', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })

    for (const args of [
      { field: 'minBillableKw', value: 0 },
      { field: 'minBillableKw', value: 0, source: 'geschätzt' },
    ]) {
      const result = await executeChatTool(ports, PROJECT, 'set_draft_field', args, NOW)
      expect(result.isError).toBe(true)
    }
    expect(ports.project.draft).toEqual({})
    expect(ports.calls.saveProject).toBeUndefined()
  })

  it('⚠ weist NaN ab — es ist typeof "number" und vergiftete danach jede Rechnung', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(
      ports,
      PROJECT,
      'set_draft_field',
      { field: 'minBillableKw', value: Number.NaN, source: 'measured' },
      NOW,
    )
    expect(result.isError).toBe(true)
    expect(ports.project.draft).toEqual({})
  })

  it('nimmt ein unbekanntes Feld an, benennt es aber als ungeprüft', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(
      ports,
      PROJECT,
      'set_draft_field',
      { field: 'stromkosten', value: 1200, source: 'measured' },
      NOW,
    )
    expect(result.isError).toBe(false)
    expect(payload(result.content).known_contract_field).toBe(false)
    expect(ports.project.draft.stromkosten).toBe(1200)
  })

  it('⚠ verliert bei zwei Aufrufen kein Feld — der Wrapper ERSETZT den Entwurf', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    await executeChatTool(
      ports, PROJECT, 'set_draft_field',
      { field: 'energyPriceCtPerKwh', value: 24.4, source: 'measured' }, NOW,
    )
    await executeChatTool(
      ports, PROJECT, 'set_draft_field',
      { field: 'minBillableKw', value: 0, source: 'measured' }, NOW,
    )
    expect(ports.project.draft.energyPriceCtPerKwh).toBe(24.4)
    expect(ports.project.draft.minBillableKw).toBe(0)
  })
})

describe('set_segment', () => {
  it('setzt das Segment, ohne den Entwurf zu verlieren', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      project: { draft: { energyPriceCtPerKwh: 24.4 } },
    })
    const result = await executeChatTool(ports, PROJECT, 'set_segment', { segment: 'betrieb' }, NOW)
    expect(result.isError).toBe(false)
    expect(ports.project.segment).toBe('betrieb')
    expect(ports.project.draft.energyPriceCtPerKwh).toBe(24.4)
  })

  it('weist einen erfundenen Wert ab', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(ports, PROJECT, 'set_segment', { segment: 'verein' }, NOW)
    expect(result.isError).toBe(true)
    expect(ports.project.segment).toBeNull()
  })
})

describe('flag_open_question', () => {
  it('Weg (a): die Frage geht an Martin, ohne Annahme', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(
      ports, PROJECT, 'flag_open_question',
      { question: 'Gilt hier Netzebene 6 oder 7?', field_key: 'netzebene' }, NOW,
    )
    expect(result.isError).toBe(false)
    expect(payload(result.content).weg).toBe('a')
    expect(ports.openQuestions[0]).toMatchObject({ status: 'open', resolution_kind: null })
  })

  it('⚠ Weg (b): die Annahme wird vermerkt UND die Frage bleibt OFFEN (§3.3)', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(
      ports, PROJECT, 'flag_open_question',
      {
        question: 'Welcher Arbeitspreis gilt ab Juli?',
        field_key: 'energyPriceCtPerKwh',
        resolution_kind: 'assumed',
        assumption_note: 'Der jüngere der beiden Sätze auf der Rechnung.',
      },
      NOW,
    )

    expect(result.isError).toBe(false)
    expect(payload(result.content).still_open_for_review).toBe(true)
    // Der Zustand, um den es §3.3 geht: (open, assumed).
    expect(ports.openQuestions[0]).toMatchObject({
      status: 'open',
      resolution_kind: 'assumed',
      assumption_note: 'Der jüngere der beiden Sätze auf der Rechnung.',
    })
  })

  it('⚠ weist Weg (b) OHNE Begründung ab, bevor eine Frage entsteht', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(
      ports, PROJECT, 'flag_open_question',
      { question: 'Welcher Satz gilt?', resolution_kind: 'assumed' }, NOW,
    )
    expect(result.isError).toBe(true)
    // Und es steht KEINE halb fertige Rückfrage im Bestand.
    expect(ports.openQuestions).toHaveLength(0)
    expect(ports.calls.appendOpenQuestion).toBeUndefined()
  })
})

describe('check_draft_completeness', () => {
  it('ändert nichts und meldet das fehlende Segment mit', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(ports, PROJECT, 'check_draft_completeness', {}, NOW)
    const body = payload(result.content)
    expect(body.complete).toBe(false)
    expect(body.segment).toBeNull()
    expect(ports.calls.saveProject).toBeUndefined()
  })
})

describe('extract_invoice', () => {
  const rates = (energy: number) => ({
    ...emptyInvoiceExtraction(),
    rates: { ...emptyInvoiceExtraction().rates, energyPriceCtPerKwh: energy },
  })

  it('⚠ führt mehrere Rechnungen über mergeInvoiceExtractions zusammen und BENENNT den Widerspruch', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      documentBytes: { a: fakePdf('rechnung-a.pdf'), b: fakePdf('rechnung-b.pdf') },
      extractors: {
        extractInvoiceData: async () => ({ ok: true, extraction: rates(seen++ === 0 ? 24.4 : 26.1) }),
      },
    })
    let seen = 0

    const result = await executeChatTool(
      ports, PROJECT, 'extract_invoice', { document_ids: ['a', 'b'] }, NOW,
    )

    const body = payload(result.content) as {
      extraction: { rates: Record<string, unknown> }
      conflicts: { field: string; label: string }[]
      hinweis?: string
    }
    // Widerspruch: das Feld bleibt LEER, statt dass eine der beiden Zahlen gewinnt.
    expect(body.extraction.rates.energyPriceCtPerKwh).toBeNull()
    expect(body.conflicts).toEqual([{ field: 'energyPriceCtPerKwh', label: 'Arbeitspreis' }])
    // Und das Modell wird ausdrücklich angewiesen, das NICHT selbst zu entscheiden.
    expect(body.hinweis).toMatch(/nicht selbst/i)
  })

  it('⚠ weist eine Datei ab, die keine PDF ist — ohne den Extraktor zu rufen', async () => {
    let called = 0
    const ports = createMemoryPorts({
      projectId: PROJECT,
      documentBytes: {
        csv: { bytes: new ArrayBuffer(8), filename: 'lastgang.csv', contentType: 'text/csv' },
      },
      extractors: {
        extractInvoiceData: async () => {
          called += 1
          return { ok: true, extraction: rates(24.4) }
        },
      },
    })

    const result = await executeChatTool(
      ports, PROJECT, 'extract_invoice', { document_ids: ['csv'] }, NOW,
    )
    expect(result.isError).toBe(true)
    expect(called).toBe(0)
  })

  it('⚠ ohne Port gibt es einen lesbaren Fehlschlag, keinen Absturz', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(
      ports, PROJECT, 'extract_invoice', { document_ids: ['a'] }, NOW,
    )
    expect(result.isError).toBe(true)
    expect(String(payload(result.content).error)).toMatch(/nicht verfügbar/i)
  })
})

describe('Randfälle des Ausführers', () => {
  it('antwortet auf ein unbekanntes Werkzeug mit einem Ergebnis, nicht mit einem Wurf', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(ports, PROJECT, 'raketenstart', {}, NOW)
    expect(result.isError).toBe(true)
  })

  it('antwortet auf eine kaputte Eingabe mit einem Ergebnis', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(ports, PROJECT, 'set_segment', 'betrieb', NOW)
    expect(result.isError).toBe(true)
  })

  it('⚠ ein fremdes Projekt schreibt nichts', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await executeChatTool(
      ports, 'fremd', 'set_draft_field',
      { field: 'minBillableKw', value: 0, source: 'measured' }, NOW,
    )
    expect(result.isError).toBe(true)
    expect(ports.calls.saveProject).toBeUndefined()
  })
})
