import type Anthropic from '@anthropic-ai/sdk'

import type {
  ChatExtractors,
  ChatMessageRole,
  OpenQuestionRow,
  ProjectChatPorts,
  ProjectDocumentRow,
  ProjectSegment,
  ProjectSnapshot,
  StoredChatMessage,
  WrapperStatus,
} from './ports'

/**
 * B24 — PRÜF-FIXTURE: die Aussenwelt der Chat-Schleife im Speicher.
 *
 * ⚠ REINES TESTMATERIAL. Kein Produktionsmodul importiert diese Datei; sie steht hier und nicht in
 * einer `.test.ts`, weil sie von mehreren Testdateien gebraucht wird. Vorbild und Präzedenz:
 * `packages/engine/src/recommendation/dummy-catalog.ts`, das aus demselben Grund neben dem
 * Produktionscode liegt und bewusst nicht über einen Barrel exportiert wird.
 *
 * ── ⚠ SIE BILDET DIE WRAPPER-SEMANTIK NACH, NICHT EINE BEQUEME FASSUNG DAVON ──────────────────
 * Was hier abweicht, macht jeden darauf gebauten Test wertlos. Drei Eigenschaften sind deshalb
 * ausdrücklich nachgezogen und stehen so in der Migration 20260910090000:
 *
 *   1. `saveProject` ERSETZT den Entwurf, es verschmilzt ihn nicht.
 *   2. `resolveOpenQuestion('assumed')` lässt `status` auf `open` — eine Annahme SCHLIESST DIE
 *      FRAGE NICHT (der Kern von Delta §3.3) — und verlangt eine Begründung.
 *   3. `appendMessage` weist ein leeres Blockarray ab (`empty_content`).
 */

export interface MemoryProject {
  segment: ProjectSegment | null
  draft: Record<string, unknown>
}

export interface MemoryPorts extends ProjectChatPorts {
  /** Der gespeicherte Verlauf, so wie ihn `list_project_messages` liefern würde. */
  readonly messages: StoredChatMessage[]
  readonly project: MemoryProject
  readonly openQuestions: OpenQuestionRow[]
  /** Zählt, welcher Wrapper wie oft gerufen wurde — für „das ist NICHT passiert"-Prüfungen. */
  readonly calls: Record<string, number>
}

export interface MemoryPortsOptions {
  projectId: string
  project?: Partial<MemoryProject>
  documents?: ProjectDocumentRow[]
  documentBytes?: Record<string, { bytes: ArrayBuffer; filename: string; contentType: string }>
  extractors?: Partial<ChatExtractors>
  /** Simuliert einen Schreibfehler: der genannte Wrapper antwortet mit diesem Status. */
  failWrapper?: { name: string; status: string }
}

export function createMemoryPorts(options: MemoryPortsOptions): MemoryPorts {
  const project: MemoryProject = {
    segment: options.project?.segment ?? null,
    draft: options.project?.draft ?? {},
  }
  const messages: StoredChatMessage[] = []
  const openQuestions: OpenQuestionRow[] = []
  const documents = options.documents ?? []
  const bytes = options.documentBytes ?? {}
  const calls: Record<string, number> = {}
  let questionCounter = 0

  function track(name: string): void {
    calls[name] = (calls[name] ?? 0) + 1
  }

  function forced(name: string): WrapperStatus | null {
    return options.failWrapper?.name === name ? { status: options.failWrapper.status } : null
  }

  const ports: MemoryPorts = {
    messages,
    project,
    openQuestions,
    calls,
    extractors: options.extractors ?? {},

    async loadProject(projectId: string): Promise<ProjectSnapshot | null> {
      track('loadProject')
      if (projectId !== options.projectId) return null
      // Eine Kopie — der Aufrufer soll den Bestand nicht versehentlich an Ort und Stelle ändern.
      return { segment: project.segment, draft: { ...project.draft } }
    },

    async loadMessages(projectId: string): Promise<StoredChatMessage[]> {
      track('loadMessages')
      if (projectId !== options.projectId) return []
      return messages.map((row) => ({ role: row.role, content: [...row.content] }))
    },

    async appendMessage(
      projectId: string,
      role: ChatMessageRole,
      content: Anthropic.ContentBlockParam[],
    ): Promise<WrapperStatus> {
      track('appendMessage')
      const fail = forced('appendMessage')
      if (fail) return fail
      if (projectId !== options.projectId) return { status: 'not_found' }
      if (content.length === 0) return { status: 'empty_content' }
      messages.push({ role, content: [...content] })
      return { status: 'ok', message_id: `msg_${messages.length}` }
    },

    async saveProject(
      projectId: string,
      draft: Record<string, unknown>,
      segment?: ProjectSegment,
    ): Promise<WrapperStatus> {
      track('saveProject')
      const fail = forced('saveProject')
      if (fail) return fail
      if (projectId !== options.projectId) return { status: 'not_found' }
      // ERSETZEN, nicht verschmelzen — wie `update_project_draft`.
      project.draft = { ...draft }
      // `p_segment` weggelassen heisst UNVERÄNDERT (Lesart `capture_lead`).
      if (segment !== undefined) project.segment = segment
      return { status: 'ok' }
    },

    async listOpenQuestions(projectId: string): Promise<OpenQuestionRow[]> {
      track('listOpenQuestions')
      if (projectId !== options.projectId) return []
      return openQuestions.map((question) => ({ ...question }))
    },

    async appendOpenQuestion(
      projectId: string,
      question: string,
      fieldKey: string | null,
    ): Promise<WrapperStatus> {
      track('appendOpenQuestion')
      const fail = forced('appendOpenQuestion')
      if (fail) return fail
      if (projectId !== options.projectId) return { status: 'not_found' }
      questionCounter += 1
      const id = `q_${questionCounter}`
      openQuestions.push({
        id,
        field_key: fieldKey,
        question,
        status: 'open',
        resolution_kind: null,
        resolution_value: null,
        assumption_note: null,
      })
      return { status: 'ok', question_id: id }
    },

    async resolveOpenQuestion(
      questionId: string,
      kind: 'assumed' | 'answered' | 'dismissed',
      value: string | null,
      assumptionNote: string | null,
    ): Promise<WrapperStatus> {
      track('resolveOpenQuestion')
      const fail = forced('resolveOpenQuestion')
      if (fail) return fail
      const row = openQuestions.find((question) => question.id === questionId)
      if (row === undefined) return { status: 'not_found' }

      if (kind === 'assumed') {
        if (assumptionNote === null) return { status: 'assumption_note_required' }
        row.resolution_kind = 'assumed'
        row.assumption_note = assumptionNote
        if (value !== null) row.resolution_value = value
        // ⚠ `status` bleibt `open` — die Frage liegt weiterhin bei Martin (Delta §3.3).
        return { status: 'ok', question_status: 'open', still_open_for_review: true }
      }
      if (kind === 'answered') {
        if (value === null) return { status: 'resolution_value_required' }
        row.status = 'answered'
        row.resolution_kind = 'answered'
        row.resolution_value = value
        return { status: 'ok', question_status: 'answered', still_open_for_review: false }
      }
      row.status = 'dismissed'
      return { status: 'ok', question_status: 'dismissed', still_open_for_review: false }
    },

    async listDocuments(projectId: string): Promise<ProjectDocumentRow[]> {
      track('listDocuments')
      if (projectId !== options.projectId) return []
      return documents.map((document) => ({ ...document }))
    },

    async readDocument(documentId: string) {
      track('readDocument')
      return bytes[documentId] ?? null
    },
  }

  return ports
}

/** Eine PDF-Attrappe: der Inhalt spielt keine Rolle, der Medientyp schon. */
export function fakePdf(filename = 'Jahresrechnung 2025.pdf') {
  return { bytes: new ArrayBuffer(16), filename, contentType: 'application/pdf' }
}

/**
 * Ein Modell nach Drehbuch: die Antworten stehen fest, in dieser Reihenfolge.
 *
 * Bewusst KEIN echter Modellaufruf — was hier geprüft wird, ist die Schleife, nicht das Urteil des
 * Modells. Ein Test gegen die echte API prüfte beides zugleich und wäre bei jedem Lauf ein anderer.
 */
export function scriptedModel(turns: Anthropic.ContentBlock[][]) {
  const seen: { system: string[]; messageCount: number }[] = []
  let index = 0

  const call = async (input: {
    system: Anthropic.TextBlockParam[]
    tools: Anthropic.Tool[]
    messages: Anthropic.MessageParam[]
  }) => {
    seen.push({
      system: input.system.map((block) => block.text),
      messageCount: input.messages.length,
    })
    const turn = turns[index]
    index += 1
    if (turn === undefined) throw new Error('Das Drehbuch ist zu Ende — die Schleife lief zu oft.')
    return { ok: true as const, content: turn }
  }

  return { call, seen, get callCount() { return index } }
}

/** Ein `tool_use`-Block, wie ihn die API liefert. */
export function toolUse(id: string, name: string, input: unknown): Anthropic.ContentBlock {
  return { type: 'tool_use', id, name, input } as unknown as Anthropic.ContentBlock
}

/** Ein reiner Text-Block, wie ihn die API liefert. */
export function assistantSays(text: string): Anthropic.ContentBlock {
  return { type: 'text', text, citations: null } as unknown as Anthropic.ContentBlock
}
