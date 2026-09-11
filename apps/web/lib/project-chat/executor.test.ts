import { describe, expect, it } from 'vitest'
import { emptyInvoiceExtraction } from 'shared'

import { readDraftProvenance } from './draft'
import { executeChatTool } from './executor'
import { createMemoryPorts, fakeLoadProfileFile, fakePdf } from './fixtures'
import type { ChatExtractors } from './ports'

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
    // ⚠ NACHGEZOGEN: `still_missing` trägt Einträge statt blosser Namen (Fragenkatalog).
    expect(payload(result.content).still_missing).toContainEqual({ field: 'billingModel' })
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
    // ⚠ UMBENANNT: `known_field` statt `known_contract_field` — bekannt ist ein Schlüssel ab
    // jetzt aus zwei Quellen (Contract ODER Fragenkatalog).
    expect(payload(result.content).known_field).toBe(false)
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

describe('Fragenkatalog in der Vollständigkeitsprüfung', () => {
  const BASELINE = {
    id: 'q-baseline',
    segment: 'betrieb' as const,
    industry: null,
    question_key: 'industry',
    question_text: 'In welcher Branche sind Sie tätig?',
    required: true,
    valid_from: '2026-09-01',
  }
  const HOTEL = {
    id: 'q-hotel',
    segment: 'betrieb' as const,
    industry: 'hotel',
    question_key: 'pool_vorhanden',
    question_text: 'Gibt es einen beheizten Pool?',
    required: true,
    valid_from: '2026-09-01',
  }

  /**
   * Die Lücken-Schlüssel aus `check_draft_completeness` (`missing`) bzw. `set_draft_field`
   * (`still_missing`) — zwei Werkzeuge, zwei Feldnamen, dieselbe Liste.
   */
  function missingKeys(content: string, key: 'missing' | 'still_missing' = 'missing'): string[] {
    const body = payload(content) as {
      missing?: { field: string }[]
      still_missing?: { field: string }[]
    }
    const gaps = body[key]
    if (gaps === undefined) throw new Error(`Das Ergebnis trägt kein "${key}": ${content}`)
    return gaps.map((gap) => gap.field)
  }

  it('⚠ eine Baseline-Pflichtfrage verschwindet aus „missing", sobald sie beantwortet ist', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb' },
      questionCatalog: [BASELINE],
    })

    const before = await executeChatTool(ports, PROJECT, 'check_draft_completeness', {}, NOW)
    expect(missingKeys(before.content)).toContain('industry')
    // Der Wortlaut reist mit — das Modell soll die Frage stellen können, nicht den Schlüssel zeigen.
    expect(before.content).toContain('In welcher Branche sind Sie tätig?')

    await executeChatTool(ports, PROJECT, 'set_industry', { industry: 'hotel' }, NOW)

    const after = await executeChatTool(ports, PROJECT, 'check_draft_completeness', {}, NOW)
    expect(missingKeys(after.content)).not.toContain('industry')
    // ⚠ Und zwar OHNE dass etwas im Entwurf steht — `set_industry` schreibt eine Projektspalte.
    expect(ports.project.draft).toEqual({})
  })

  it('⚠ eine Branchenfrage erscheint NUR bei passender Branche', async () => {
    const withoutIndustry = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb' },
      questionCatalog: [BASELINE, HOTEL],
    })
    const a = await executeChatTool(withoutIndustry, PROJECT, 'check_draft_completeness', {}, NOW)
    expect(missingKeys(a.content)).not.toContain('pool_vorhanden')

    const otherIndustry = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb', industry: 'tischlerei' },
      questionCatalog: [BASELINE, HOTEL],
    })
    const b = await executeChatTool(otherIndustry, PROJECT, 'check_draft_completeness', {}, NOW)
    expect(missingKeys(b.content)).not.toContain('pool_vorhanden')

    const hotel = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb', industry: 'hotel' },
      questionCatalog: [BASELINE, HOTEL],
    })
    const c = await executeChatTool(hotel, PROJECT, 'check_draft_completeness', {}, NOW)
    expect(missingKeys(c.content)).toContain('pool_vorhanden')
  })

  it('⚠ fragt den Katalog mit Segment UND Branche des Projekts — und ohne Segment gar nicht', async () => {
    const ready = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb', industry: 'hotel' },
      questionCatalog: [HOTEL],
    })
    await executeChatTool(ready, PROJECT, 'check_draft_completeness', {}, NOW)
    expect(ready.questionCatalogCalls).toEqual([{ segment: 'betrieb', industry: 'hotel' }])

    // Ohne Segment könnte der Wrapper nur `invalid_segment` antworten — also wird nicht gefragt.
    const unknownSegment = createMemoryPorts({ projectId: PROJECT, questionCatalog: [HOTEL] })
    await executeChatTool(unknownSegment, PROJECT, 'check_draft_completeness', {}, NOW)
    expect(unknownSegment.questionCatalogCalls).toEqual([])
    expect(unknownSegment.calls.listQuestionCatalog).toBeUndefined()
  })

  it('⚠ ein Wert unter einem reinen Katalog-Schlüssel gilt NICHT als vertragsfremd', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb', industry: 'hotel' },
      questionCatalog: [HOTEL],
    })

    const result = await executeChatTool(
      ports, PROJECT, 'set_draft_field',
      { field: 'pool_vorhanden', value: true, source: 'measured' }, NOW,
    )

    const body = payload(result.content)
    expect(body.known_field).toBe(true)
    expect(body.hinweis).toBeUndefined()
    expect(missingKeys(result.content, 'still_missing')).not.toContain('pool_vorhanden')

    // Gegenprobe: derselbe Aufruf OHNE Katalog meldet ihn als ungeprüft.
    const noCatalog = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb', industry: 'hotel' },
    })
    const plain = await executeChatTool(
      noCatalog, PROJECT, 'set_draft_field',
      { field: 'pool_vorhanden', value: true, source: 'measured' }, NOW,
    )
    expect(payload(plain.content).known_field).toBe(false)
    expect(String(payload(plain.content).hinweis)).toMatch(/Fragenkatalog/)
  })
})

/**
 * B24, Teil 1 — `extract_load_profile`.
 *
 * Das einzige Werkzeug, das SELBST schreibt, und das einzige, das an den ZÄHLPUNKT schreibt statt
 * in den Entwurf. Geprüft werden genau die Eigenschaften, an denen dieser Schritt richtig oder
 * falsch ist:
 *
 *   (1) Das Ergebnis landet am Zählpunkt und NICHT im Entwurf — im Entwurf gälte es fürs ganze
 *       Projekt, und der zweite Zählpunkt überschriebe die Aussage des ersten.
 *   (2) Es wird NICHT geraten, welcher Zählpunkt gemeint ist — auch dann nicht, wenn es nur einen
 *       gibt. Bei zwei Zählpunkten fiele genau dieser Griff niemandem auf.
 *   (3) Eine Datei mit mehreren Messreihen speichert NICHTS und fragt zurück.
 *   (4) Gespeichert werden ALLE Lücken, aufgezählt nur die ersten — ein gekürzter Datensatz
 *       behauptete eine Abdeckung, die es nicht gibt.
 *
 * ⚠ Das ECHTE Lesen einer Datei wird hier NICHT geprüft, und das ist Absicht: es liegt in
 * `packages/engine/src/parser/metadata.ts` und ist dort gegen echte Exporte gemessen (Lücken,
 * 60-min-Intervall, Mehrspalten-Erkennung). `extractors` ist `server-only` und in dieser App als
 * WERT gar nicht ladbar; was hier zu prüfen ist, ist die Orchestrierung darüber.
 */
describe('extract_load_profile', () => {
  const MP_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  const MP_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

  function meteringPoint(id: string, withProfile = false) {
    return {
      id,
      interval_minutes: withProfile ? 15 : null,
      covered_from: withProfile ? '2024-01-01T00:00:00.000Z' : null,
      covered_to: withProfile ? '2024-12-31T23:00:00.000Z' : null,
      gaps: [],
      source_document_id: withProfile ? 'alt' : null,
    }
  }

  function scanOk(gaps: { from: string; to: string }[] = []) {
    return {
      ok: true as const,
      needsMapping: false as const,
      intervalMinutes: 15,
      coveredFrom: '2025-01-01T00:00:00.000Z',
      coveredTo: '2026-01-01T00:00:00.000Z',
      gaps,
      rowCount: 35_040 - gaps.length,
      coveredMonths: 12,
    }
  }

  function readingPorts(
    outcome: unknown,
    options: { meteringPoints?: ReturnType<typeof meteringPoint>[]; failWrapper?: boolean } = {},
  ) {
    return createMemoryPorts({
      projectId: PROJECT,
      meteringPoints: options.meteringPoints ?? [meteringPoint(MP_A)],
      documentBytes: { doc: fakeLoadProfileFile() },
      extractors: {
        readLoadProfile: (() => outcome) as unknown as ChatExtractors['readLoadProfile'],
      },
      ...(options.failWrapper === true
        ? { failWrapper: { name: 'setMeteringPointLoadProfile', status: 'not_found' } }
        : {}),
    })
  }

  it('⚠ schreibt an den ZÄHLPUNKT und NICHT in den Entwurf', async () => {
    const ports = readingPorts({ ok: true, scan: scanOk() })

    const result = await executeChatTool(
      ports,
      PROJECT,
      'extract_load_profile',
      { document_id: 'doc', metering_point_id: MP_A },
      NOW,
    )

    expect(result.isError).toBe(false)
    const row = (await ports.listMeteringPoints(PROJECT))[0]!
    expect(row).toMatchObject({
      interval_minutes: 15,
      covered_from: '2025-01-01T00:00:00.000Z',
      covered_to: '2026-01-01T00:00:00.000Z',
      source_document_id: 'doc',
    })
    // Der Entwurf bleibt unberührt — kein Feld, keine Herkunft, nichts.
    expect(ports.project.draft).toEqual({})
    expect(payload(result.content)).toMatchObject({
      metering_point_id: MP_A,
      intervall_minuten: 15,
      belegte_monate: 12,
      luecken_gesamt: 0,
    })
  })

  it('⚠ rät NICHT, welcher Zählpunkt gemeint ist — auch nicht bei genau einem', async () => {
    const ports = readingPorts({ ok: true, scan: scanOk() })

    for (const args of [
      { document_id: 'doc' },
      { document_id: 'doc', metering_point_id: '   ' },
      { document_id: 'doc', metering_point_id: MP_B },
    ]) {
      const result = await executeChatTool(ports, PROJECT, 'extract_load_profile', args, NOW)
      expect(result.isError, JSON.stringify(args)).toBe(true)
    }

    // Nichts geschrieben — und die Datei wurde für den fremden Zählpunkt gar nicht erst gelesen.
    expect((await ports.listMeteringPoints(PROJECT))[0]!.source_document_id).toBeNull()
    expect(ports.calls.setMeteringPointLoadProfile).toBeUndefined()
    expect(ports.calls.readDocument).toBeUndefined()
  })

  it('nennt bei falscher Kennung die vorhandenen Zählpunkte, damit das Modell fragen kann', async () => {
    const ports = readingPorts({ ok: true, scan: scanOk() }, {
      meteringPoints: [meteringPoint(MP_A, true), meteringPoint(MP_B)],
    })

    const result = await executeChatTool(
      ports,
      PROJECT,
      'extract_load_profile',
      { document_id: 'doc', metering_point_id: 'cccccccc-3333-4333-8333-cccccccccccc' },
      NOW,
    )

    const body = payload(result.content) as {
      metering_points: { nummer: number; metering_point_id: string; lastgang_vorhanden: boolean }[]
    }
    expect(result.isError).toBe(true)
    // ÄLTESTE ZUERST, durchnummeriert — die einzige Ordnung, die ein Mensch wiedererkennt
    // (es gibt bewusst keine Zählpunktnummer, s. Migration TEIL 6).
    expect(body.metering_points).toEqual([
      expect.objectContaining({ nummer: 1, metering_point_id: MP_A, lastgang_vorhanden: true }),
      expect.objectContaining({ nummer: 2, metering_point_id: MP_B, lastgang_vorhanden: false }),
    ])
  })

  it('⚠ legt KEINEN Zählpunkt an, wenn es keinen gibt — es gibt dafür gar keinen Port', async () => {
    const ports = readingPorts({ ok: true, scan: scanOk() }, { meteringPoints: [] })

    const result = await executeChatTool(
      ports,
      PROJECT,
      'extract_load_profile',
      { document_id: 'doc', metering_point_id: MP_A },
      NOW,
    )

    expect(result.isError).toBe(true)
    expect(payload(result.content).metering_points).toEqual([])
    expect(await ports.listMeteringPoints(PROJECT)).toEqual([])
    expect(ports.calls.readDocument).toBeUndefined()
  })

  it('⚠ speichert NICHTS, wenn die Datei mehrere Messreihen enthält — und fragt zurück', async () => {
    const ports = readingPorts({
      ok: true,
      scan: {
        ok: true,
        needsMapping: true,
        ambiguousColumns: [
          {
            index: 1,
            header: 'AT0010000000000000000000000010111 Verbrauch',
            meteringPointId: 'AT0010000000000000000000000010111',
            unit: 'kWh',
            suggestedRole: 'consumption',
            eegAccounting: false,
          },
          {
            index: 2,
            header: 'Restüberschuss EEG',
            meteringPointId: null,
            unit: 'kWh',
            suggestedRole: 'ignore',
            eegAccounting: true,
          },
        ],
      },
    })

    const result = await executeChatTool(
      ports,
      PROJECT,
      'extract_load_profile',
      { document_id: 'doc', metering_point_id: MP_A },
      NOW,
    )

    // Kein Fehlschlag: das LESEN ist gelungen, offen ist die ZUORDNUNG (Muster classify_upload).
    expect(result.isError).toBe(false)
    const body = payload(result.content) as {
      gespeichert: boolean
      spalten: { eeg_verrechnung: boolean }[]
    }
    expect(body.gespeichert).toBe(false)
    expect(body.spalten).toHaveLength(2)
    // Die EEG-Kennzeichnung reist mit — ohne sie fragte das Modell nach einer Zuordnung für eine
    // Verrechnungsspalte, zu der es gar keinen zweiten Zählpunkt gibt.
    expect(body.spalten[1]!.eeg_verrechnung).toBe(true)
    expect(ports.calls.setMeteringPointLoadProfile).toBeUndefined()
    expect((await ports.listMeteringPoints(PROJECT))[0]!.source_document_id).toBeNull()
  })

  it('⚠ speichert ALLE Lücken, zählt aber nur die ersten auf', async () => {
    const gaps = Array.from({ length: 14 }, (_, index) => ({
      from: `2025-0${(index % 9) + 1}-01T00:00:00.000Z`,
      to: `2025-0${(index % 9) + 1}-02T00:00:00.000Z`,
    }))
    const ports = readingPorts({ ok: true, scan: scanOk(gaps) })

    const result = await executeChatTool(
      ports,
      PROJECT,
      'extract_load_profile',
      { document_id: 'doc', metering_point_id: MP_A },
      NOW,
    )

    const body = payload(result.content) as {
      luecken_gesamt: number
      luecken: unknown[]
      luecken_hinweis?: string
    }
    expect(body.luecken_gesamt).toBe(14)
    expect(body.luecken).toHaveLength(10)
    expect(body.luecken_hinweis).toContain('14')
    // ⚠ Der Datensatz ist VOLLSTÄNDIG — gekürzt gespeichert behauptete er eine Abdeckung,
    // die es nicht gibt.
    expect((await ports.listMeteringPoints(PROJECT))[0]!.gaps).toHaveLength(14)
  })

  it('weist eine PDF benannt ab, statt sie dem Parser zu überlassen', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      meteringPoints: [meteringPoint(MP_A)],
      documentBytes: { doc: fakePdf() },
      extractors: {
        readLoadProfile: (() => {
          throw new Error('darf nicht gerufen werden')
        }) as unknown as ChatExtractors['readLoadProfile'],
      },
    })

    const result = await executeChatTool(
      ports,
      PROJECT,
      'extract_load_profile',
      { document_id: 'doc', metering_point_id: MP_A },
      NOW,
    )

    expect(result.isError).toBe(true)
    expect(payload(result.content).error).toContain('extract_invoice')
  })

  it('reicht einen Lesefehler und eine abgelehnte Zusage der Datenbank lesbar durch', async () => {
    const unreadable = readingPorts({
      ok: true,
      scan: {
        ok: false,
        needsMapping: false,
        error: { code: 'not_a_load_profile', message: 'Kein Netz-Lastgang.' },
      },
    })
    const first = await executeChatTool(
      unreadable, PROJECT, 'extract_load_profile',
      { document_id: 'doc', metering_point_id: MP_A }, NOW,
    )
    expect(first.isError).toBe(true)
    expect(payload(first.content).code).toBe('not_a_load_profile')
    expect(unreadable.calls.setMeteringPointLoadProfile).toBeUndefined()

    const refused = readingPorts({ ok: true, scan: scanOk() }, { failWrapper: true })
    const second = await executeChatTool(
      refused, PROJECT, 'extract_load_profile',
      { document_id: 'doc', metering_point_id: MP_A }, NOW,
    )
    expect(second.isError).toBe(true)
    expect(payload(second.content).error).toContain('not_found')

    const missingPort = createMemoryPorts({ projectId: PROJECT, meteringPoints: [meteringPoint(MP_A)] })
    const third = await executeChatTool(
      missingPort, PROJECT, 'extract_load_profile',
      { document_id: 'doc', metering_point_id: MP_A }, NOW,
    )
    expect(third.isError).toBe(true)
  })
})
