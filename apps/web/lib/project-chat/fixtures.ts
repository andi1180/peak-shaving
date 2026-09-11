import type Anthropic from '@anthropic-ai/sdk'

import type {
  ChatExtractors,
  ChatMessageRole,
  ChatRateLimitDecision,
  MeteringPointGap,
  MeteringPointRow,
  OpenQuestionRow,
  ProjectChatPorts,
  ProjectDocumentRow,
  ProjectSegment,
  ProjectSnapshot,
  QuestionCatalogRow,
  StoredChatMessage,
  SystemPromptExtension,
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
 * Was hier abweicht, macht jeden darauf gebauten Test wertlos. Fünf Eigenschaften sind deshalb
 * ausdrücklich nachgezogen und stehen so in der Migration 20260910090000:
 *
 *   1. `saveMeteringPointDraft` ERSETZT den Entwurf, es verschmilzt ihn nicht — und er hängt am
 *      ZÄHLPUNKT, nicht am Projekt (Migration 20260911150000). `saveProject` fasst ihn gar nicht
 *      mehr an; es setzt Segment und Branche, auch wenn der Wrapper weiterhin
 *      `update_project_draft` heisst.
 *   2. `resolveOpenQuestion('assumed')` lässt `status` auf `open` — eine Annahme SCHLIESST DIE
 *      FRAGE NICHT (der Kern von Delta §3.3) — und verlangt eine Begründung.
 *   3. `appendMessage` weist ein leeres Blockarray ab (`empty_content`).
 *   4. `saveProject` nimmt eine Branche NUR an, wenn das nach dem Aufruf geltende Segment
 *      `betrieb` ist (`industry_requires_betrieb`), und schreibt sie NICHT klein
 *      (`invalid_industry`) — Migration 20260910150000.
 *   5. `listQuestionCatalog` liefert die Baseline des Segments IMMER und die Zusatzfragen NUR zur
 *      übergebenen Branche (`q.industry is null or q.industry = v_industry`) — Migration
 *      20260910120000. Gäbe die Attrappe schlicht alles zurück, prüfte jeder darauf gebaute Test
 *      das Gegenteil dessen, was er behauptet.
 *   6. `checkRateLimit` ZÄHLT wirklich — es gibt keinen Schalter, der einfach `limit_reached`
 *      zurückgibt. Ein solcher bewiese nur, dass die Schleife einen Status durchreicht; dass die
 *      Bremse tatsächlich an gespeicherten Nachrichten hängt, bewiese er nicht (Migration
 *      20260910180000). ⚠ Die Attrappe kennt allerdings nur EIN Projekt — dass der Wrapper über
 *      ALLE Projekte eines Kontos zählt, kann hier nicht nachgebildet werden und wird deshalb im
 *      DB-Gate gemessen (`packages/db-tests/src/chat-rate-limit.test.ts`).
 */

export interface MemoryProject {
  segment: ProjectSegment | null
  industry: string | null
}

export interface MemoryPorts extends ProjectChatPorts {
  /** Der gespeicherte Verlauf, so wie ihn `list_project_messages` liefern würde. */
  readonly messages: StoredChatMessage[]
  readonly project: MemoryProject
  /**
   * Die Zählpunkte samt ihrem Entwurf — der Bestand, gegen den ein Test prüft, was GESCHRIEBEN
   * wurde. Bewusst der lebende Bestand und keine Kopie: `listMeteringPoints` gibt Kopien heraus,
   * damit ein Aufrufer nichts versehentlich zum Bestand macht, ein Test soll aber genau ihn sehen.
   */
  readonly meteringPoints: MeteringPointRow[]
  readonly openQuestions: OpenQuestionRow[]
  /** Zählt, welcher Wrapper wie oft gerufen wurde — für „das ist NICHT passiert"-Prüfungen. */
  readonly calls: Record<string, number>
  /**
   * Womit der Fragenkatalog abgefragt wurde. Die FILTERUNG bildet die Attrappe nach; womit der
   * Ausführer FRAGT, ist dagegen seine eigene Entscheidung — und nur die lässt sich hier messen.
   */
  readonly questionCatalogCalls: { segment: ProjectSegment; industry: string | null }[]
}

export interface MemoryPortsOptions {
  projectId: string
  project?: Partial<MemoryProject>
  documents?: ProjectDocumentRow[]
  documentBytes?: Record<string, { bytes: ArrayBuffer; filename: string; contentType: string }>
  /**
   * Die Zählpunkte des Projekts. Weggelassen = KEINE — und das ist der Regelfall, nicht die
   * Ausnahme: sie entstehen ausschliesslich über `admin_set_metering_point_count`, also durch
   * einen Menschen. Ein Test, der den Schreibweg messen will, muss sie ausdrücklich stellen.
   */
  meteringPoints?: MeteringPointRow[]
  extractors?: Partial<ChatExtractors>
  /**
   * Der geltende Stand der System-Prompt-Erweiterung. Weggelassen = keiner gepflegt (`null`) —
   * der Normalzustand, und damit zugleich der Regressionsfall „Prompt exakt wie vorher".
   */
  systemPromptExtension?: SystemPromptExtension | null
  /**
   * Der gepflegte Fragenkatalog. Weggelassen = keiner gepflegt (`[]`) — der heutige Normalzustand
   * (die Kataloge sind bewusst leer, Delta §4.4) und damit zugleich der Regressionsfall
   * „Vollständigkeitsprüfung genau wie vorher".
   */
  questionCatalog?: QuestionCatalogRow[]
  /**
   * Die Kostenbremse: so viele `user`-Nachrichten darf der Bestand tragen, bevor abgelehnt wird.
   * Weggelassen = die Bremse antwortet immer `ok` (sie ist dann nicht der Gegenstand des Tests).
   *
   * ⚠ Das ist NICHT die Aussage „in Produktion gibt es kein Limit" — dort ist ein Stand gesetzt,
   * und ein fehlender wäre fail closed. Hier heisst es schlicht „diese Prüfung steht diesem Test
   * nicht im Weg".
   */
  rateLimitMax?: number
  /** Erzwingt „nicht ermittelbar" — der FAIL-CLOSED-Fall. */
  rateLimitUnavailable?: boolean
  /** Simuliert einen Schreibfehler: der genannte Wrapper antwortet mit diesem Status. */
  failWrapper?: { name: string; status: string }
}

export function createMemoryPorts(options: MemoryPortsOptions): MemoryPorts {
  const project: MemoryProject = {
    segment: options.project?.segment ?? null,
    industry: options.project?.industry ?? null,
  }
  const messages: StoredChatMessage[] = []
  const openQuestions: OpenQuestionRow[] = []
  const documents = options.documents ?? []
  const bytes = options.documentBytes ?? {}
  const meteringPoints: MeteringPointRow[] = (options.meteringPoints ?? []).map((row) => ({
    ...row,
    gaps: [...row.gaps],
    draft: { ...row.draft },
  }))
  const calls: Record<string, number> = {}
  const questionCatalog = options.questionCatalog ?? []
  const questionCatalogCalls: { segment: ProjectSegment; industry: string | null }[] = []
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
    meteringPoints,
    openQuestions,
    calls,
    questionCatalogCalls,
    extractors: options.extractors ?? {},

    async checkRateLimit(projectId: string): Promise<ChatRateLimitDecision> {
      track('checkRateLimit')
      if (options.rateLimitUnavailable === true) return { status: 'unavailable' }
      if (projectId !== options.projectId) return { status: 'not_found' }
      const max = options.rateLimitMax
      if (max === undefined) return { status: 'ok' }
      // Gezählt wird, was der Wrapper zählt: ausschliesslich `user`-Zeilen.
      const used = messages.filter((row) => row.role === 'user').length
      if (used >= max) return { status: 'limit_reached', used, max }
      return { status: 'ok', used, max }
    },

    async loadProject(projectId: string): Promise<ProjectSnapshot | null> {
      track('loadProject')
      if (projectId !== options.projectId) return null
      // Eine Kopie — der Aufrufer soll den Bestand nicht versehentlich an Ort und Stelle ändern.
      return {
        segment: project.segment,
        industry: project.industry,
      }
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
      segment?: ProjectSegment,
      industry?: string,
    ): Promise<WrapperStatus> {
      track('saveProject')
      const fail = forced('saveProject')
      if (fail) return fail
      if (projectId !== options.projectId) return { status: 'not_found' }

      /*
       * ⚠ DIE PRÜFUNGEN LAUFEN VOR JEDEM SCHREIBVORGANG, wie im Wrapper: dort kehrt der Rumpf mit
       * einem Status zurück, BEVOR das UPDATE läuft. Würde die Attrappe erst den Entwurf schreiben
       * und dann ablehnen, bliebe ein halb übernommener Zustand zurück, den es real nicht gibt —
       * und ein Test darauf wäre wertlos.
       */
      if (industry !== undefined) {
        if (!/^[a-z0-9][a-z0-9_]*$/.test(industry)) return { status: 'invalid_industry' }
        // Das Segment, das NACH diesem Aufruf gilt — nicht das bestehende allein.
        const effective = segment ?? project.segment
        if (effective !== 'betrieb') {
          return { status: 'industry_requires_betrieb', segment: effective }
        }
      }

      // `p_segment`/`p_industry` weggelassen heisst UNVERÄNDERT (Lesart `capture_lead`).
      if (segment !== undefined) project.segment = segment
      if (industry !== undefined) project.industry = industry
      return { status: 'ok' }
    },

    async saveMeteringPointDraft(
      meteringPointId: string,
      draft: Record<string, unknown>,
    ): Promise<WrapperStatus> {
      track('saveMeteringPointDraft')
      const fail = forced('saveMeteringPointDraft')
      if (fail) return fail

      /*
       * ⚠ WIE DER WRAPPER: ein fremder oder unbekannter Zählpunkt antwortet `not_found`. Eine
       * Attrappe, die alles annimmt, bewiese über den Ausführer nichts — genau derselbe Grund wie
       * bei `setMeteringPointLoadProfile` weiter unten.
       */
      const row = meteringPoints.find((entry) => entry.id === meteringPointId)
      if (row === undefined) return { status: 'not_found' }

      // ERSETZEN, nicht verschmelzen — wie `update_metering_point_draft`.
      row.draft = { ...draft }
      return { status: 'ok', metering_point_id: meteringPointId }
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

    async listMeteringPoints(projectId: string): Promise<MeteringPointRow[]> {
      track('listMeteringPoints')
      if (projectId !== options.projectId) return []
      // Kopien, damit ein Test eine zurückgegebene Zeile nicht versehentlich zum Bestand macht.
      return meteringPoints.map((row) => ({ ...row, gaps: [...row.gaps], draft: { ...row.draft } }))
    },

    async setMeteringPointLoadProfile(
      meteringPointId: string,
      documentId: string,
      intervalMinutes: number,
      coveredFrom: string,
      coveredTo: string,
      gaps: MeteringPointGap[],
    ): Promise<WrapperStatus> {
      track('setMeteringPointLoadProfile')
      const forcedStatus = forced('setMeteringPointLoadProfile')
      if (forcedStatus) return forcedStatus

      /*
       * ⚠ DIE ATTRAPPE BILDET DIE ZUGRIFFSPRÜFUNG DES WRAPPERS NACH, statt blind zu schreiben:
       * `set_metering_point_load_profile` antwortet auf einen fremden Zählpunkt mit `not_found`,
       * und ein Test, dessen Attrappe alles annimmt, bewiese über den Ausführer nichts.
       */
      const row = meteringPoints.find((entry) => entry.id === meteringPointId)
      if (row === undefined) return { status: 'not_found' }

      // ERSETZT alle vier Angaben gemeinsam — wortgleich zum Wrapper.
      row.source_document_id = documentId
      row.interval_minutes = intervalMinutes
      row.covered_from = coveredFrom
      row.covered_to = coveredTo
      row.gaps = [...gaps]
      return { status: 'ok', metering_point_id: meteringPointId }
    },

    async loadSystemPromptExtension(): Promise<SystemPromptExtension | null> {
      track('loadSystemPromptExtension')
      return options.systemPromptExtension ?? null
    },

    async listQuestionCatalog(
      segment: ProjectSegment,
      industry: string | null,
    ): Promise<QuestionCatalogRow[]> {
      track('listQuestionCatalog')
      questionCatalogCalls.push({ segment, industry })
      // Baseline IMMER, Zusatzfragen nur zur übergebenen Branche — wortgleich zum Wrapper-Rumpf.
      return questionCatalog
        .filter((entry) => entry.segment === segment)
        .filter(
          (entry) =>
            entry.industry === null || (industry !== null && entry.industry === industry),
        )
        .map((entry) => ({ ...entry }))
    },
  }

  return ports
}

/** Eine PDF-Attrappe: der Inhalt spielt keine Rolle, der Medientyp schon. */
export function fakePdf(filename = 'Jahresrechnung 2025.pdf') {
  return { bytes: new ArrayBuffer(16), filename, contentType: 'application/pdf' }
}

/**
 * Ein Lastgang-Dokument, wie es im Bucket liegt.
 *
 * ⚠ `text/csv` ist eine ANGABE des Kunden (Spaltenkommentar `project_documents.content_type`) —
 * der Browser meldet für CSV regelmässig `application/vnd.ms-excel`. Der Ausführer verzweigt
 * daran deshalb NICHT; er weist allein PDF ab. Die Bytes sind hier bedeutungslos: gelesen wird
 * über den Port, und das ECHTE Lesen ist in `packages/engine` gegen echte Exporte geprüft.
 */
export function fakeLoadProfileFile(filename = 'lastgang-2025.csv', contentType = 'text/csv') {
  return { bytes: new ArrayBuffer(32), filename, contentType }
}

/**
 * Ein Zählpunkt, wie `list_metering_points` ihn liefert — mit leerem Entwurf und ohne Lastgang.
 *
 * Zählpunkte entstehen real ausschliesslich durch einen Menschen (`admin_set_metering_point_count`);
 * ein Test, der einen Schreibweg messen will, muss sie deshalb ausdrücklich stellen. Dieser Helfer
 * steht hier und nicht in einer Testdatei, weil ihn inzwischen mehrere brauchen — und weil eine
 * zweite, um ein Feld ärmere Fassung beim nächsten Spaltenzuwachs still auseinanderliefe.
 */
export function fakeMeteringPoint(
  id: string,
  overrides: Partial<Omit<MeteringPointRow, 'id'>> = {},
): MeteringPointRow {
  return {
    id,
    interval_minutes: null,
    covered_from: null,
    covered_to: null,
    gaps: [],
    source_document_id: null,
    draft: {},
    ...overrides,
  }
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
