import { describe, expect, it, vi } from 'vitest'
import { emptyInvoiceExtraction } from 'shared'

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung. Ersetzt wird nur dieser
// Wächter — er schützt vor einem Import aus einer Client-Komponente, und das ist eine Eigenschaft
// des BUILDS, keine des Moduls (Muster lib/project-documents/documents.test.ts). Er hängt hier an
// `ai-client.ts`, aus dem die Schleife ihre Obergrenze zieht.
vi.mock('server-only', () => ({}))

import { runProjectChatTurn } from './agent'
import { MAX_TOOL_CALLS_PER_TURN } from './ai-client'
import { readDraftProvenance } from './draft'
import {
  assistantSays,
  createMemoryPorts,
  fakeMeteringPoint,
  fakePdf,
  scriptedModel,
  toolUse,
  type MemoryPorts,
} from './fixtures'
import { PROJECT_CHAT_SYSTEM_PROMPT } from './system-prompt'

/**
 * B24 — DER MEHRFACH-TURN-DIALOG, END-TO-END GEGEN EINEN SPEICHER-BESTAND.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WAS DIESER TEST BEWEIST — UND WAS AUSDRÜCKLICH NICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das Modell läuft hier nach DREHBUCH. Geprüft wird deshalb die MECHANIK: dass ein Widerspruch
 * zwischen zwei Rechnungen überhaupt entsteht und benannt wird, dass beide Wege dem Modell
 * angeboten und in der Anweisung verlangt werden, dass eine Annahme die Rückfrage OFFEN lässt, und
 * dass der Verlauf in einer Form gespeichert wird, die sich wieder einspielen lässt.
 *
 * NICHT geprüft — und mit einem Drehbuch auch nicht prüfbar — ist, ob das Modell die beiden Wege
 * tatsächlich anbietet, statt selbst zu entscheiden. Das ist eine Aussage über sein Verhalten, und
 * eine Behauptung darüber wäre hier zirkulär: der Antworttext stammt aus diesem Test. Sie gehört in
 * den Abstimmungs-Schritt, gemessen an einem echten Dialog gegen die echte API.
 *
 * Was dieser Test dagegen sehr wohl misst, ist die Voraussetzung dafür: der Widerspruch wird dem
 * Modell mit der ausdrücklichen Weisung vorgelegt, ihn nicht allein zu entscheiden — und diese
 * Weisung entsteht im Ausführer, nicht im Drehbuch.
 */

const PROJECT = '11111111-2222-4333-8444-555555555555'
/** Der Zählpunkt, an dem der Entwurf dieses Projekts hängt (Migration 20260911150000). */
const MP = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'

function invoiceWith(energyPriceCtPerKwh: number) {
  const base = emptyInvoiceExtraction()
  return { ...base, rates: { ...base.rates, energyPriceCtPerKwh } }
}

/** Zwei Rechnungen desselben Anschlusses, die sich beim Arbeitspreis WIDERSPRECHEN. */
function portsWithTwoInvoices(): MemoryPorts {
  let call = 0
  return createMemoryPorts({
    projectId: PROJECT,
    /*
     * ⚠ EIN ZÄHLPUNKT IST SEIT DER MIGRATION 20260911150000 VORAUSSETZUNG DIESES DIALOGS: der
     * Entwurf hängt an ihm, und `set_draft_field` verlangt seine Kennung. Ohne ihn führte das
     * Drehbuch unten ins Leere — nicht weil die Schleife falsch liefe, sondern weil es nichts gäbe,
     * worin ein Wert stehen könnte.
     */
    meteringPoints: [fakeMeteringPoint(MP)],
    documents: [
      { id: 'doc-a', original_filename: 'rechnung-2024.pdf', content_type: 'application/pdf' },
      { id: 'doc-b', original_filename: 'rechnung-2025.pdf', content_type: 'application/pdf' },
    ],
    documentBytes: { 'doc-a': fakePdf('rechnung-2024.pdf'), 'doc-b': fakePdf('rechnung-2025.pdf') },
    extractors: {
      extractInvoiceData: async () => {
        call += 1
        return { ok: true as const, extraction: invoiceWith(call === 1 ? 24.4 : 26.1) }
      },
    },
  })
}

describe('Mehrfach-Turn-Dialog: Rechnung, Widerspruch, Annahme', () => {
  it('führt den vollen Ablauf und hinterlässt (open, assumed)', async () => {
    const ports = portsWithTwoInvoices()

    // ── TURN 1: Segment setzen und beide Rechnungen auslesen ────────────────────────────────────
    const turn1 = scriptedModel([
      [
        assistantSays('Alles klar, ich sehe mir die beiden Rechnungen an.'),
        toolUse('tu_seg', 'set_segment', { segment: 'betrieb' }),
        toolUse('tu_inv', 'extract_invoice', { document_ids: ['doc-a', 'doc-b'] }),
      ],
      [assistantSays('Die beiden Rechnungen nennen verschiedene Arbeitspreise. Wie möchten Sie vorgehen?')],
    ])

    const result1 = await runProjectChatTurn(
      PROJECT,
      'Wir sind eine Bäckerei. Ich habe zwei Rechnungen hochgeladen.',
      { ports, callModel: turn1.call },
    )

    expect(result1).toMatchObject({ status: 'ok', toolCalls: 2 })
    expect(ports.project.segment).toBe('betrieb')

    // ⚠ Der Widerspruch entsteht wirklich und wird BENANNT — der Ausführer schreibt das, nicht das
    // Drehbuch. Das ist die Voraussetzung dafür, dass das Modell überhaupt beide Wege anbieten kann.
    const invoiceResult = ports.messages
      .filter((row) => row.role === 'tool_result')
      .flatMap((row) => row.content)
      .map((block) => JSON.parse(String((block as { content: string }).content)) as Record<string, unknown>)
      .find((body) => Array.isArray(body.conflicts) && body.conflicts.length > 0)

    expect(invoiceResult).toBeDefined()
    expect(invoiceResult?.conflicts).toEqual([
      { field: 'energyPriceCtPerKwh', label: 'Arbeitspreis' },
    ])
    expect(String(invoiceResult?.hinweis)).toMatch(/beiden Wege/i)

    // ── TURN 2: Der Kunde wählt die Annahme ─────────────────────────────────────────────────────
    const turn2 = scriptedModel([
      [
        toolUse('tu_q', 'flag_open_question', {
          question: 'Welcher Arbeitspreis gilt: 24,4 oder 26,1 ct/kWh?',
          field_key: 'energyPriceCtPerKwh',
          resolution_kind: 'assumed',
          assumption_note: 'Die jüngere Rechnung (2025) sollte den heute gültigen Satz tragen.',
        }),
        toolUse('tu_set', 'set_draft_field', {
          metering_point_id: MP,
          field: 'energyPriceCtPerKwh',
          value: 26.1,
          source: 'assumed',
          note: 'Aus der jüngeren Rechnung; Martin prüft das noch.',
        }),
      ],
      [assistantSays('Ich rechne vorerst mit 26,1 ct/kWh. Die Frage liegt weiterhin bei Martin.')],
    ])

    const result2 = await runProjectChatTurn(
      PROJECT,
      'Nimm bitte eine Annahme, ich will nicht warten.',
      { ports, callModel: turn2.call },
    )

    expect(result2).toMatchObject({ status: 'ok', toolCalls: 2 })

    // ⚠ DER KERN VON DELTA §3.3: die Frage ist OFFEN und trägt trotzdem eine Annahme.
    expect(ports.openQuestions).toHaveLength(1)
    expect(ports.openQuestions[0]).toMatchObject({
      status: 'open',
      resolution_kind: 'assumed',
      field_key: 'energyPriceCtPerKwh',
      assumption_note: 'Die jüngere Rechnung (2025) sollte den heute gültigen Satz tragen.',
    })

    // Und die Annahme steht als solche gekennzeichnet im Entwurf DES ZÄHLPUNKTS (§3.2).
    const draft = ports.meteringPoints[0]!.draft
    expect(draft.energyPriceCtPerKwh).toBe(26.1)
    expect(readDraftProvenance(draft).energyPriceCtPerKwh?.source).toBe('assumed')

    // ── TURN 3: Der Zustand reist mit ───────────────────────────────────────────────────────────
    const turn3 = scriptedModel([[assistantSays('Weiter geht es mit dem Leistungspreis.')]])
    await runProjectChatTurn(PROJECT, 'Und weiter?', { ports, callModel: turn3.call })

    const state = turn3.seen[0]?.system[1] ?? ''
    // Der offene Punkt steht im Zustandsblock, und zwar im Klartext als „offen, mit Annahme".
    expect(state).toMatch(/offen bei Martin, ihr rechnet mit einer Annahme weiter/)
    expect(state).toMatch(/energyPriceCtPerKwh = 26\.1/)
    expect(state).toMatch(/\[assumed/)
    expect(state).toMatch(/Segment: betrieb/)
    // Die hochgeladenen Dokumente stehen mit ihrer Kennung darin — sonst könnte das Modell sie
    // gar nicht benennen.
    expect(state).toMatch(/doc-a · rechnung-2024\.pdf/)

    // ── Der Verlauf ist in einer wieder einspielbaren Form gespeichert ─────────────────────────
    expect(ports.messages.map((row) => row.role)).toEqual([
      'user', 'assistant', 'tool_call', 'tool_result', 'assistant',
      'user', 'tool_call', 'tool_result', 'assistant',
      'user', 'assistant',
    ])
  })

  it('⚠ die Anweisung verlangt beide Wege und die Herkunfts-Kennzeichnung', () => {
    /*
     * Ob das MODELL sich daran hält, kann dieser Test nicht sagen (s. Kopf). Dass die vier
     * Verhaltensanforderungen des Deltas überhaupt in der Anweisung STEHEN, sehr wohl — und ohne
     * sie wäre jede Abstimmung am falschen Text.
     */
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/Führe ein Gespräch, kein Formular/)   // §3.1
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/Im Zweifel "assumed"/)                // §3.2
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/BEIDE Wege vor und lass ihn wählen/)  // §3.3
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/Entscheide das NIE selbst/)           // §3.3
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/Kläre früh, ob du mit einem Privathaushalt/) // §3.4
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/für die dieses System nicht gebaut ist/)     // §3.5
    /*
     * ⚠ Die Anweisung MUSS beide Hälften tragen: WANN geprüft wird (sobald beides vorliegt, und vor
     * „fertig") und WAS aus einem Befund folgt (Fachfrage, nicht selbst entscheiden). Ohne die
     * zweite Hälfte ruft das Modell das Werkzeug und trifft die Entscheidung anschliessend allein.
     */
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/check_data_consistency/)
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/nicht dasselbe wie ein stimmiger/)
    expect(PROJECT_CHAT_SYSTEM_PROMPT).toMatch(/wie jede andere\n?Fachfrage/)
  })
})

describe('Deadlock-Schutz', () => {
  it('⚠ bricht bei einer endlosen Werkzeug-Schleife SAUBER ab', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })

    // Ein Modell, das immer dasselbe Werkzeug ruft und nie zu einer Antwort kommt.
    let calls = 0
    const endless = async () => {
      calls += 1
      return {
        ok: true as const,
        content: [toolUse(`tu_${calls}`, 'check_draft_completeness', {})],
      }
    }

    const result = await runProjectChatTurn(PROJECT, 'Los geht es.', {
      ports,
      callModel: endless,
    })

    expect(result).toEqual({ status: 'tool_limit', toolCalls: MAX_TOOL_CALLS_PER_TURN })
    expect(calls).toBe(MAX_TOOL_CALLS_PER_TURN)

    // ⚠ Der Verlauf ist trotz Abbruch GÜLTIG: zu jedem Aufruf gibt es ein Ergebnis. Sonst wäre das
    // Projekt dauerhaft unbenutzbar — es gibt kein update und kein delete auf dieser Ablage.
    const callRows = ports.messages.filter((row) => row.role === 'tool_call').length
    const resultRows = ports.messages.filter((row) => row.role === 'tool_result').length
    expect(callRows).toBe(MAX_TOOL_CALLS_PER_TURN)
    expect(resultRows).toBe(MAX_TOOL_CALLS_PER_TURN)

    // Und der nächste Turn läuft normal weiter.
    const next = scriptedModel([[assistantSays('Entschuldigung, ich fange neu an.')]])
    const after = await runProjectChatTurn(PROJECT, 'Bitte von vorn.', {
      ports,
      callModel: next.call,
    })
    expect(after.status).toBe('ok')
  })
})

describe('Eigentum', () => {
  it('⚠ ein fremdes Projekt löst KEINEN Modellaufruf aus', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    let modelCalls = 0
    const model = async () => {
      modelCalls += 1
      return { ok: true as const, content: [assistantSays('sollte nie passieren')] }
    }

    const result = await runProjectChatTurn('99999999-8888-4777-8666-555555555555', 'Hallo?', {
      ports,
      callModel: model,
    })

    expect(result).toEqual({ status: 'not_found' })
    // Kein Aufruf, keine Kosten — und keine Zeile im fremden Verlauf.
    expect(modelCalls).toBe(0)
    expect(ports.messages).toHaveLength(0)
    expect(ports.calls.appendMessage).toBeUndefined()
  })

  it('leere Nachrichten werden abgewiesen, bevor irgendetwas geschieht', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await runProjectChatTurn(PROJECT, '   ', {
      ports,
      callModel: async () => {
        throw new Error('darf nicht gerufen werden')
      },
    })
    expect(result).toEqual({ status: 'empty_message' })
    expect(ports.calls.loadProject).toBeUndefined()
  })
})

describe('Kostenbremse (Delta §6.3)', () => {
  /** Ein Modell, das mitzählt — und dessen Aufruf in diesem Block ausdrücklich NICHT passieren soll. */
  function zaehlendesModell() {
    let calls = 0
    return {
      get calls() {
        return calls
      },
      call: async () => {
        calls += 1
        return { ok: true as const, content: [assistantSays('Alles klar.')] }
      },
    }
  }

  it('⚠ POSITIVKONTROLLE: der Zähler der Attrappe zählt wirklich — drei Turns bei max 3', async () => {
    // Ohne diesen Test bewiese der nächste nur, dass die Schleife einen Status durchreicht. Hier
    // wird der Zählstand an ECHTEN gespeicherten Nachrichten aufgebaut, genau wie in der Datenbank.
    const ports = createMemoryPorts({ projectId: PROJECT, rateLimitMax: 3 })
    const modell = zaehlendesModell()

    for (const nachricht of ['Erste', 'Zweite', 'Dritte']) {
      const result = await runProjectChatTurn(PROJECT, nachricht, {
        ports,
        callModel: modell.call,
      })
      expect(result.status, `Turn „${nachricht}"`).toBe('ok')
    }

    expect(modell.calls).toBe(3)
    expect(ports.messages.filter((row) => row.role === 'user')).toHaveLength(3)
  })

  it('⚠ der VIERTE Turn wird abgewiesen — 0 Modellaufrufe, und die Nachricht wird NICHT gespeichert', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT, rateLimitMax: 3 })
    const modell = zaehlendesModell()

    for (const nachricht of ['Erste', 'Zweite', 'Dritte']) {
      await runProjectChatTurn(PROJECT, nachricht, { ports, callModel: modell.call })
    }
    const aufrufeVorher = modell.calls
    const zeilenVorher = ports.messages.length

    const result = await runProjectChatTurn(PROJECT, 'Vierte', {
      ports,
      callModel: modell.call,
    })

    expect(result).toEqual({ status: 'limit_reached', used: 3, max: 3 })
    // Kein Aufruf, keine Kosten.
    expect(modell.calls).toBe(aufrufeVorher)
    /*
     * ⚠ UND KEINE ZEILE. Das ist die eigentliche Zusage: eine gespeicherte Ablehnung zählte im
     * nächsten Fenster mit und schöbe die Sperre bei jedem Wiederholungsversuch weiter nach hinten
     * — das Limit zöge sich selbst zu, obwohl der abgewiesene Turn nachweislich nichts gekostet hat.
     */
    expect(ports.messages).toHaveLength(zeilenVorher)
    expect(ports.messages.some((row) => row.content.some((b) => JSON.stringify(b).includes('Vierte')))).toBe(false)
  })

  it('⚠ die Prüfung läuft NACH der Eigentumsfrage — ein fremdes Projekt erfährt nichts über ein Budget', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT, rateLimitMax: 1 })
    const result = await runProjectChatTurn('99999999-8888-4777-8666-555555555555', 'Hallo?', {
      ports,
      callModel: async () => {
        throw new Error('darf nicht gerufen werden')
      },
    })
    expect(result).toEqual({ status: 'not_found' })
  })

  it('⚠ die Prüfung läuft VOR den drei Ladevorgängen — im abgewiesenen Fall bleiben sie ungerufen', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT, rateLimitMax: 0 })
    // `rateLimitMax: 0` heisst „schon erschöpft" — die Attrappe zählt 0 gespeicherte Nachrichten
    // gegen 0 und lehnt damit ab, ohne dass zuvor ein Turn gelaufen sein muss.
    const result = await runProjectChatTurn(PROJECT, 'Hallo', {
      ports,
      callModel: async () => {
        throw new Error('darf nicht gerufen werden')
      },
    })

    expect(result.status).toBe('limit_reached')
    expect(ports.calls.checkRateLimit).toBe(1)
    expect(ports.calls.listDocuments).toBeUndefined()
    expect(ports.calls.listOpenQuestions).toBeUndefined()
    expect(ports.calls.loadSystemPromptExtension).toBeUndefined()
    expect(ports.calls.appendMessage).toBeUndefined()
  })

  it('⚠ FAIL CLOSED: eine nicht ermittelbare Bremse löst KEINEN Modellaufruf aus …', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT, rateLimitUnavailable: true })
    const result = await runProjectChatTurn(PROJECT, 'Hallo', {
      ports,
      callModel: async () => {
        throw new Error('darf nicht gerufen werden')
      },
    })
    expect(result).toEqual({ status: 'limit_unavailable' })
    expect(ports.messages).toHaveLength(0)
  })

  it('⚠ … und sagt dabei ausdrücklich NICHT „Limit erreicht"', async () => {
    /*
     * Der Unterschied ist keine Feinheit: „Ihr Tageslimit ist erreicht" wäre bei einem
     * Datenbankausfall eine Falschauskunft, und der Nutzer suchte den Fehler bei sich, statt es
     * gleich noch einmal zu versuchen. Genau die Sorte Meldung, die dieses Repo an anderer Stelle
     * als „ein Fehler, der wie ein Ergebnis aussieht" verwirft.
     */
    const ports = createMemoryPorts({ projectId: PROJECT, rateLimitUnavailable: true })
    const result = await runProjectChatTurn(PROJECT, 'Hallo', {
      ports,
      callModel: async () => ({ ok: true as const, content: [assistantSays('x')] }),
    })
    expect(result.status).not.toBe('limit_reached')
  })

  it('ohne gesetztes Limit läuft die Schleife unverändert (der Regressionsfall)', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const modell = zaehlendesModell()
    for (let i = 0; i < 5; i += 1) {
      const result = await runProjectChatTurn(PROJECT, `Nachricht ${i}`, {
        ports,
        callModel: modell.call,
      })
      expect(result.status).toBe('ok')
    }
    expect(modell.calls).toBe(5)
  })
})

describe('Fehlerpfade der Schleife', () => {
  it('meldet einen fehlenden KI-Zugang als eigenen Zustand', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const result = await runProjectChatTurn(PROJECT, 'Hallo', {
      ports,
      callModel: async () => ({ ok: false, reason: 'not_configured' }),
    })
    expect(result).toEqual({ status: 'not_configured' })
  })

  it('⚠ bricht ab, wenn eine Zeile nicht gespeichert werden kann — statt weiterzulaufen', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      failWrapper: { name: 'appendMessage', status: 'empty_content' },
    })
    let modelCalls = 0
    const result = await runProjectChatTurn(PROJECT, 'Hallo', {
      ports,
      callModel: async () => {
        modelCalls += 1
        return { ok: true, content: [assistantSays('...')] }
      },
    })
    expect(result).toEqual({ status: 'storage_error', step: 'user:empty_content' })
    // Der Abbruch kommt VOR dem Modellaufruf: eine Nachricht, die nicht im Verlauf steht, darf
    // auch nicht beantwortet werden.
    expect(modelCalls).toBe(0)
  })

  it('⚠ eine abgelehnte Zusage aus einem Port wird zum Werkzeug-Ergebnis, nicht zum Absturz', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      documentBytes: { 'doc-a': fakePdf() },
      extractors: {
        extractInvoiceData: async () => {
          throw new Error('Netz weg')
        },
      },
    })

    const model = scriptedModel([
      [toolUse('tu_1', 'extract_invoice', { document_ids: ['doc-a'] })],
      [assistantSays('Das hat leider nicht geklappt.')],
    ])

    const result = await runProjectChatTurn(PROJECT, 'Lies bitte die Rechnung.', {
      ports,
      callModel: model.call,
    })

    expect(result.status).toBe('ok')
    // Die Invariante hält: zu dem einen Aufruf gibt es ein Ergebnis, und es ist als Fehler markiert.
    const resultRow = ports.messages.find((row) => row.role === 'tool_result')
    expect(resultRow?.content[0]).toMatchObject({ type: 'tool_result', is_error: true })
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * DIE ADMIN-GEPFLEGTE SYSTEM-PROMPT-ERWEITERUNG (Delta §4.3)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Zwei Richtungen, und die zweite ist die wichtigere: dass eine gepflegte Erweiterung ANKOMMT, und
 * dass der Leerfall — der Normalzustand, solange niemand eine eingetragen hat — den Prompt BIT-GENAU
 * so lässt, wie er vorher war. Ohne die zweite Richtung bliebe der Test auch dann grün, wenn die
 * Verdrahtung dem Prompt beiläufig eine Zeile anhängte.
 */
describe('System-Prompt-Erweiterung', () => {
  /** Der Text, den das Modell im ERSTEN System-Block dieses Turns tatsächlich gesehen hat. */
  async function coreBlockOf(ports: MemoryPorts): Promise<string> {
    const model = scriptedModel([[assistantSays('Verstanden.')]])
    const result = await runProjectChatTurn(PROJECT, 'Hallo.', { ports, callModel: model.call })
    expect(result.status).toBe('ok')
    return model.seen[0]!.system[0]!
  }

  it('⚠ ohne gepflegten Stand ist der Prompt EXAKT der bisherige (Regression)', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })
    const core = await coreBlockOf(ports)

    // Bit-genau, nicht „enthält": eine angehängte Leerzeile wäre bereits eine Änderung an der
    // Anweisung, die niemand entschieden hat.
    expect(core).toBe(PROJECT_CHAT_SYSTEM_PROMPT)
    expect(ports.calls.loadSystemPromptExtension).toBe(1)
  })

  it('hängt einen gepflegten Stand ADDITIV an — der Kern bleibt vollständig und steht zuerst', async () => {
    const extension = 'Frag bei Hotels immer nach der Zahl der Betten.'
    const ports = createMemoryPorts({
      projectId: PROJECT,
      systemPromptExtension: { id: 'ext-1', text: extension, validFrom: '2026-09-10' },
    })
    const core = await coreBlockOf(ports)

    expect(core).toContain(extension)
    // Der Kern ist WÖRTLICH und AM ANFANG enthalten — die Erweiterung kann ihn damit weder
    // ersetzen noch ihm vorangehen, und das ist die eigentliche Zusage dieses Schritts.
    expect(core.startsWith(PROJECT_CHAT_SYSTEM_PROMPT)).toBe(true)
    expect(core.indexOf(extension)).toBeGreaterThan(PROJECT_CHAT_SYSTEM_PROMPT.length)
    // Die vier Verhaltensanforderungen stehen weiterhin drin (§3.1–§3.4).
    expect(core).toMatch(/Im Zweifel "assumed"/)
    expect(core).toMatch(/BEIDE Wege vor und lass ihn wählen/)
  })

  it('ein leerer Stand zählt als kein Stand — keine Überschrift ohne Inhalt', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      systemPromptExtension: { id: 'ext-2', text: '   \n  ', validFrom: '2026-09-10' },
    })
    expect(await coreBlockOf(ports)).toBe(PROJECT_CHAT_SYSTEM_PROMPT)
  })

  it('⚠ ein Lesefehler bricht das Gespräch NICHT ab — der Kern trägt allein', async () => {
    // `null` deckt „nicht gepflegt" UND „nicht lesbar" ab (s. ports.ts): der Aufrufer verhält sich
    // in beiden Fällen gleich, und ein Gespräch wegen eines admin-gepflegten Textes abzubrechen
    // wäre die falsche Richtung.
    const ports = createMemoryPorts({ projectId: PROJECT, systemPromptExtension: null })
    const model = scriptedModel([[assistantSays('Guten Tag.')]])
    const result = await runProjectChatTurn(PROJECT, 'Hallo.', { ports, callModel: model.call })

    expect(result.status).toBe('ok')
    expect(model.seen[0]!.system[0]).toBe(PROJECT_CHAT_SYSTEM_PROMPT)
  })

  it('wird EINMAL je Turn gelesen, nicht je Modellaufruf', async () => {
    // Zwei Durchläufe (ein Werkzeug, dann die Antwort) → zwei Modellaufrufe, aber nur EIN Lesen.
    // Sonst kostete jede Werkzeug-Runde eine Datenbankfahrt für dieselbe Auskunft.
    const ports = createMemoryPorts({ projectId: PROJECT, project: { segment: 'betrieb' } })
    const model = scriptedModel([
      [toolUse('tu_1', 'set_industry', { industry: 'hotel' })],
      [assistantSays('Notiert.')],
    ])

    const result = await runProjectChatTurn(PROJECT, 'Wir sind ein Hotel.', {
      ports,
      callModel: model.call,
    })

    expect(result.status).toBe('ok')
    expect(model.callCount).toBe(2)
    expect(ports.calls.loadSystemPromptExtension).toBe(1)
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `set_industry` — DIE BRANCHE HÄNGT AM SEGMENT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die wirksame Grenze steht in der Datenbank (`industry_requires_betrieb`, Migration
 * 20260910150000). Hier wird gemessen, dass der Ausführer sie VORHER beantwortet — mit einem Satz,
 * den das Modell umsetzen kann — und dass in den abgelehnten Fällen nachweislich NICHTS geschrieben
 * wird.
 */
describe('set_industry', () => {
  async function runIndustryTurn(ports: MemoryPorts, industry: unknown) {
    const model = scriptedModel([
      [toolUse('tu_1', 'set_industry', { industry })],
      [assistantSays('Alles klar.')],
    ])
    const result = await runProjectChatTurn(PROJECT, 'Wir sind ein Hotel.', {
      ports,
      callModel: model.call,
    })
    expect(result.status).toBe('ok')

    const row = ports.messages.find((entry) => entry.role === 'tool_result')!
    const block = row.content[0] as { content: string; is_error?: boolean }
    return { payload: JSON.parse(block.content) as Record<string, unknown>, isError: block.is_error }
  }

  it('setzt die Branche bei segment = betrieb', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb' },
      meteringPoints: [fakeMeteringPoint(MP, { draft: { energyPriceCtPerKwh: 24.4 } })],
    })

    const { payload, isError } = await runIndustryTurn(ports, 'kfz_werkstatt')

    expect(isError).toBeUndefined()
    expect(payload).toEqual({ industry: 'kfz_werkstatt' })
    expect(ports.project.industry).toBe('kfz_werkstatt')
    /*
     * ⚠ Der Entwurf überlebt — und zwar ab jetzt STRUKTURELL statt durch Sorgfalt: `set_industry`
     * schreibt eine Projektspalte, der Entwurf hängt am Zählpunkt, die beiden können einander gar
     * nicht mehr erreichen. Bis zur Migration 20260911150000 musste der Ausführer den Entwurf
     * mitschicken, weil der Wrapper ihn sonst ERSETZT hätte.
     */
    expect(ports.meteringPoints[0]!.draft).toEqual({ energyPriceCtPerKwh: 24.4 })
    expect(ports.calls.saveMeteringPointDraft).toBeUndefined()
  })

  it('⚠ bei segment = privat wird ABGELEHNT und nichts geschrieben', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT, project: { segment: 'privat' } })

    const { payload, isError } = await runIndustryTurn(ports, 'hotel')

    expect(isError).toBe(true)
    expect(String(payload.error)).toMatch(/Privathaushalt/)
    expect(ports.project.industry).toBeNull()
    expect(ports.calls.saveProject).toBeUndefined()
  })

  it('⚠ ohne bestimmtes Segment wird ABGELEHNT — mit dem Weg dorthin', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT })

    const { payload, isError } = await runIndustryTurn(ports, 'hotel')

    expect(isError).toBe(true)
    // Zwei verschiedene Meldungen, weil zwei verschiedene Handlungen folgen.
    expect(String(payload.error)).toMatch(/set_segment/)
    expect(ports.project.industry).toBeNull()
    expect(ports.calls.saveProject).toBeUndefined()
  })

  it('⚠ „Hotel" wird abgewiesen, NICHT stillschweigend kleingeschrieben', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT, project: { segment: 'betrieb' } })

    const { payload, isError } = await runIndustryTurn(ports, 'Hotel')

    expect(isError).toBe(true)
    expect(String(payload.error)).toContain('Hotel')
    expect(ports.project.industry).toBeNull()
    // Das Projekt wird gar nicht erst gelesen — die Form entscheidet sich vor jeder Fahrt.
    expect(ports.calls.saveProject).toBeUndefined()
  })

  it('eine fehlende oder leere Angabe wird abgewiesen', async () => {
    const ports = createMemoryPorts({ projectId: PROJECT, project: { segment: 'betrieb' } })
    expect((await runIndustryTurn(ports, '  ')).isError).toBe(true)
    expect(ports.project.industry).toBeNull()
  })

  it('die Branche steht im Zustandsblock des nächsten Turns', async () => {
    const ports = createMemoryPorts({
      projectId: PROJECT,
      project: { segment: 'betrieb', industry: 'hotel' },
    })
    const model = scriptedModel([[assistantSays('Verstanden.')]])
    await runProjectChatTurn(PROJECT, 'Hallo.', { ports, callModel: model.call })

    expect(model.seen[0]!.system[1]).toContain('Branche: hotel')
  })
})
