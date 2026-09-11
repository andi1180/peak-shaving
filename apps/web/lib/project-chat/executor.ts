import {
  INVOICE_MERGE_FIELD_LABELS,
  type InvoiceMergeFieldKey,
  mergeInvoiceExtractions,
} from 'shared'

import {
  checkDraftCompleteness,
  setDraftField,
  type DraftCompleteness,
  type DraftValue,
} from './draft'
import {
  DRAFT_VALUE_SOURCES,
  type ChatToolName,
  type DraftValueSource,
  isChatToolName,
} from './tools'
import {
  INDUSTRY_KEY_PATTERN,
  PROJECT_SEGMENTS,
  type MeteringPointRow,
  type ProjectChatPorts,
  type ProjectSegment,
  type ProjectSnapshot,
  type QuestionCatalogRow,
} from './ports'

/**
 * B24 — DER WERKZEUG-AUSFÜHRER. Die eine Stelle, an der ein Werkzeugaufruf etwas bewirkt.
 *
 * ── ⚠ JEDER AUSGANG IST EIN ERGEBNIS, AUCH DER FEHLSCHLAG (`is_error: true`) ──────────────────
 * Keine Verzweigung dieser Datei wirft. Ein geworfener Fehler brächte die Schleife um, und zurück
 * bliebe ein `tool_call` OHNE `tool_result` — der
 * Verlauf wäre damit dauerhaft kaputt: beim nächsten Turn folgte auf eine Assistenten-Nachricht mit
 * `tool_use` eine Nutzer-Nachricht ohne passendes Ergebnis, und die API lehnte JEDEN weiteren
 * Aufruf dieses Projekts ab. Die Invariante lautet deshalb: zu jeder `tool_call`-Zeile entsteht im
 * selben Turn eine `tool_result`-Zeile.
 *
 * ⚠ Was diese Datei NICHT abfangen kann, ist eine abgelehnte Zusage aus einem PORT (Datenbank weg,
 * Netz weg) — die reicht durch das `await` hindurch. Dafür steht das try/catch in `agent.ts`, wo
 * die Invariante oben wohnt.
 *
 * ── DIE EINGABEN WERDEN HIER GEPRÜFT, NICHT VOM SCHEMA ────────────────────────────────────────
 * Die Werkzeuge laufen bewusst ohne `strict: true` (Begründung im Kopf von `tools.ts`). Was fehlt
 * oder nicht passt, wird deshalb hier abgefangen und dem Modell als lesbarer Satz zurückgegeben —
 * es kann den Aufruf dann korrigieren, statt dass der Turn stirbt.
 *
 * ── LESEN, ÄNDERN, SCHREIBEN — JE AUFRUF NEU ──────────────────────────────────────────────────
 * `update_metering_point_draft` ERSETZT den Entwurf (die Migration begründet das: eine flache
 * Verschmelzung könnte einen Schlüssel nie wieder entfernen). Jeder schreibende Aufruf liest den
 * Entwurf deshalb frisch, ändert ein Feld und schreibt das Ganze zurück. Eine über den Turn
 * getragene Kopie wäre billiger und würde bei zwei parallelen Werkzeugaufrufen im selben Turn den
 * jeweils anderen Schreibvorgang verwerfen.
 */

/** Das Ergebnis EINES Werkzeugaufrufs, fertig für einen `tool_result`-Block. */
export interface ToolExecution {
  content: string
  isError: boolean
}

function ok(payload: Record<string, unknown>): ToolExecution {
  return { content: JSON.stringify(payload), isError: false }
}

function fail(message: string, extra: Record<string, unknown> = {}): ToolExecution {
  return { content: JSON.stringify({ error: message, ...extra }), isError: true }
}

function readString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const PDF_MEDIA_TYPE = 'application/pdf'

/**
 * Führt einen Werkzeugaufruf aus.
 *
 * `input` kommt als `unknown` aus der Modellantwort — ein Objekt ist es erst, wenn es geprüft ist.
 * (Die API liefert `tool_use.input` als bereits geparstes JSON; verlassen wird sich darauf hier
 * trotzdem nicht.)
 */
export async function executeChatTool(
  ports: ProjectChatPorts,
  projectId: string,
  toolName: string,
  input: unknown,
  now: Date,
): Promise<ToolExecution> {
  if (!isChatToolName(toolName)) {
    return fail(`Unbekanntes Werkzeug: ${toolName}.`)
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return fail('Die Eingabe muss ein Objekt sein.')
  }

  const args = input as Record<string, unknown>

  switch (toolName satisfies ChatToolName) {
    case 'set_segment':
      return setSegment(ports, projectId, args)
    case 'set_industry':
      return setIndustry(ports, projectId, args)
    case 'set_draft_field':
      return setDraft(ports, projectId, args, now)
    case 'check_draft_completeness':
      return completeness(ports, projectId, args)
    case 'flag_open_question':
      return flagOpenQuestion(ports, projectId, args)
    case 'classify_upload':
      return classifyUpload(ports, args)
    case 'extract_invoice':
      return extractInvoice(ports, args)
    case 'extract_pv_design':
      return extractPvDesign(ports, args)
    case 'extract_battery_description':
      return extractBattery(ports, args)
    case 'extract_load_profile':
      return extractLoadProfile(ports, projectId, args)
  }
}

/**
 * Lädt den admin-gepflegten Fragenkatalog für DIESES Projekt.
 *
 * ⚠ OHNE SEGMENT WIRD GAR NICHT GEFRAGT. Der Wrapper könnte darauf nur mit `invalid_segment`
 * antworten — ein Aufruf, dessen einzige mögliche Antwort eine Ablehnung ist, ist kein Lesevorgang,
 * sondern eine vermeidbare Runde. Ein Projekt ohne bestimmtes Segment hat schlicht noch keinen
 * Katalog, und `[]` sagt genau das.
 *
 * Die Branche wird DURCHGEREICHT, nicht ausgewertet: welcher Pool zu einer Branche gehört (und dass
 * die Baseline immer dabei ist), entscheidet der Wrapper — hier ein zweites Mal zu filtern hiesse,
 * dieselbe Regel an zwei Orten auszulegen.
 */
async function loadCatalog(
  ports: ProjectChatPorts,
  project: ProjectSnapshot,
): Promise<QuestionCatalogRow[]> {
  if (project.segment === null) return []
  return ports.listQuestionCatalog(project.segment, project.industry)
}

/**
 * Welche Katalog-Schlüssel sind bereits beantwortet, ohne im Entwurf zu stehen?
 *
 * `segment` und `industry` sind eigene Spalten am Projekt und werden über `set_segment`/
 * `set_industry` gesetzt — beide fassen den Entwurf nicht an. Fragt der Katalog danach (und das
 * sieht der Spaltenkommentar von `question_key` ausdrücklich vor), ist die Frage mit dem Setzen
 * beantwortet. Ausführliche Begründung am Parameter `answeredOnProject` in `draft.ts`.
 *
 * ⚠ Die Liste nennt die tatsächlich GESETZTEN Spalten, nicht die existierenden: ein noch nicht
 * bestimmtes Segment ist eine offene Frage und soll in `missing` stehen.
 */
function answeredOnProject(project: ProjectSnapshot): string[] {
  const answered: string[] = []
  if (project.segment !== null) answered.push('segment')
  if (project.industry !== null) answered.push('industry')
  return answered
}

// ── Zustands-Werkzeuge ────────────────────────────────────────────────────────────────────────

async function setSegment(
  ports: ProjectChatPorts,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const segment = readString(args, 'segment')
  if (segment === null || !(PROJECT_SEGMENTS as readonly string[]).includes(segment)) {
    return fail(`segment muss einer von ${PROJECT_SEGMENTS.join(', ')} sein.`)
  }

  /*
   * ⚠ HIER WIRD KEIN ENTWURF MEHR MITGESCHICKT. Bis zur Migration 20260911150000 nahm der Wrapper
   * Entwurf UND Segment gemeinsam entgegen und ERSETZTE den Entwurf — ohne ein Lesen davor löschte
   * ein Segmentwechsel deshalb still alles, was bisher gesammelt war. Diese Kopplung gibt es nicht
   * mehr: der Entwurf liegt am Zählpunkt, und ein Segmentwechsel kann ihn gar nicht mehr berühren.
   *
   * Gelesen wird trotzdem — aber aus dem anderen Grund: „Projekt nicht gefunden" soll als Satz
   * ankommen und nicht als Wrapper-Status.
   */
  const project = await ports.loadProject(projectId)
  if (project === null) return fail('Projekt nicht gefunden.')

  const result = await ports.saveProject(projectId, segment as ProjectSegment)
  if (result.status !== 'ok') return fail(`Segment konnte nicht gesetzt werden: ${result.status}.`)

  return ok({ segment })
}

/*
 * ── ⚠ DIE BRANCHE HÄNGT AM SEGMENT, UND DIE PRÜFUNG STEHT AN ZWEI ORTEN ───────────────────────
 * Der Wrapper weist eine Branche ab, solange das Projekt nicht `betrieb` ist
 * (`industry_requires_betrieb`) — das ist die WIRKSAME Grenze. Hier wird dasselbe noch einmal
 * gefragt, weil das Modell einen Statuswert nicht lesen kann, wohl aber einen Satz: es soll
 * erfahren, WAS zu tun ist (erst das Segment klären / bei einem Haushalt gar nicht erst fragen),
 * statt einen abgelehnten Aufruf zu wiederholen.
 *
 * Deshalb sind es ZWEI Meldungen und nicht eine: „noch nicht bestimmt" und „ist ein Privathaushalt"
 * verlangen entgegengesetzte Handlungen — im einen Fall fehlt ein Schritt, im anderen ist die Frage
 * gegenstandslos.
 */
async function setIndustry(
  ports: ProjectChatPorts,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const industry = readString(args, 'industry')
  if (industry === null) return fail('industry fehlt.')
  if (!INDUSTRY_KEY_PATTERN.test(industry)) {
    /*
     * Der abgelehnte Wert steht MIT in der Meldung: „hotel" ist aus „Hotel" ableitbar, und das
     * Modell soll die Korrektur selbst finden, statt zu raten, was gemeint war. Still
     * kleinzuschreiben ist ausgeschlossen — was eingetragen wurde und was gespeichert ist, soll
     * dasselbe sein (dieselbe Regel wie in der Migration).
     */
    return fail(
      `„${industry}" ist kein gültiger Branchen-Schlüssel. Erlaubt sind Kleinbuchstaben, Ziffern ` +
        'und Unterstrich, beginnend mit Buchstabe oder Ziffer — z. B. „hotel" statt „Hotel" oder ' +
        '„kfz_werkstatt" statt „Kfz-Werkstatt".',
    )
  }

  const project = await ports.loadProject(projectId)
  if (project === null) return fail('Projekt nicht gefunden.')

  if (project.segment === null) {
    return fail(
      'Das Segment ist noch nicht bestimmt. Kläre zuerst mit set_segment, ob es ein Privathaushalt ' +
        'oder ein Betrieb ist — eine Branche gibt es nur beim Betrieb.',
    )
  }
  if (project.segment !== 'betrieb') {
    return fail(
      'Dieses Projekt ist ein Privathaushalt. Eine Branche gibt es hier nicht — frag den Kunden ' +
        'nicht danach.',
    )
  }

  // Wie bei `setSegment`: der Entwurf ist hier nicht mehr im Spiel (s. dort).
  const result = await ports.saveProject(projectId, undefined, industry)
  if (result.status !== 'ok') return fail(`Branche konnte nicht gesetzt werden: ${result.status}.`)

  return ok({ industry })
}

async function setDraft(
  ports: ProjectChatPorts,
  projectId: string,
  args: Record<string, unknown>,
  now: Date,
): Promise<ToolExecution> {
  const field = readString(args, 'field')
  if (field === null) return fail('field fehlt.')

  const rawValue = args.value
  if (typeof rawValue !== 'number' && typeof rawValue !== 'string' && typeof rawValue !== 'boolean') {
    return fail('value muss eine Zahl, eine Zeichenkette oder ein Wahrheitswert sein.')
  }
  /*
   * ⚠ NaN und Infinity sind in JavaScript `typeof 'number'`. Ohne diese Prüfung liefe NaN als
   * gültiger Tarifsatz durch und vergiftete danach jede Rechnung lautlos — dieselbe Sperre wie in
   * den bestehenden Extraktions-Auswertungen (Delta 9b-2a).
   */
  if (typeof rawValue === 'number' && !Number.isFinite(rawValue)) {
    return fail('value ist keine endliche Zahl.')
  }

  const source = readString(args, 'source')
  if (source === null || !(DRAFT_VALUE_SOURCES as readonly string[]).includes(source)) {
    return fail(
      `source ist Pflicht und muss "measured" (abgelesen/genannt) oder "assumed" ` +
        `(erschlossen/geschätzt) sein.`,
    )
  }

  const note = readString(args, 'note') ?? undefined

  const meteringPointId = readString(args, 'metering_point_id')
  if (meteringPointId === null) return fail('metering_point_id fehlt.')

  const project = await ports.loadProject(projectId)
  if (project === null) return fail('Projekt nicht gefunden.')

  const resolved = await resolveMeteringPoint(ports, projectId, meteringPointId, 'diese Angabe')
  if ('error' in resolved) return resolved.error
  const { target } = resolved

  /*
   * Gelesen wird der Entwurf DIESES Zählpunkts, geschrieben wird er als Ganzes zurück — der Wrapper
   * ERSETZT ihn (s. `saveMeteringPointDraft` in `ports.ts`). Die Liste wurde eben frisch geholt;
   * eine über den Turn getragene Kopie würde bei zwei Werkzeugaufrufen im selben Turn den jeweils
   * anderen Schreibvorgang verwerfen.
   */
  const nextDraft = setDraftField(
    target.draft,
    field,
    rawValue as DraftValue,
    source as DraftValueSource,
    note,
    now,
  )

  const result = await ports.saveMeteringPointDraft(target.id, nextDraft)
  if (result.status !== 'ok') return fail(`Entwurf konnte nicht geschrieben werden: ${result.status}.`)

  /*
   * ⚠ DER KATALOG WIRD AUCH HIER GELADEN, NICHT NUR IN `completeness`. Ohne ihn gälte ein Wert, den
   * das Modell unter einem KATALOG-Schlüssel ablegt (also genau so, wie die admin-gepflegte Frage es
   * verlangt), als „gehört nicht zum Eingabe-Contract" — die Rückmeldung riete dem Modell also ab,
   * das Richtige zu tun. Kosten: ein Lesevorgang je Schreibvorgang.
   */
  const catalog = await loadCatalog(ports, project)
  const state = checkDraftCompleteness(nextDraft, catalog, answeredOnProject(project))

  /*
   * ⚠ EIN UNBEKANNTER FELDNAME WIRD ANGENOMMEN UND BENANNT, NICHT ABGEWIESEN. Der Entwurf ist
   * bewusst offen (der Betrieb-Zuschnitt ist offener Punkt 1 des Deltas), aber ein Wert unter einem
   * erfundenen Namen fällt aus der Vollständigkeitsprüfung heraus und wäre danach unsichtbar. Das
   * Modell erfährt es hier und kann korrigieren.
   *
   * Das Feld heisst `known_field` und nicht mehr `known_contract_field`: bekannt ist ein Schlüssel
   * ab jetzt aus ZWEI Quellen (Contract oder Katalog), und ein `known_contract_field: true` über
   * einem reinen Katalog-Schlüssel wäre eine falsche Auskunft in genau der Antwort, aus der das
   * Modell lernt.
   */
  const isUnknown = state.unknown.includes(field)
  return ok({
    metering_point_id: target.id,
    field,
    value: rawValue,
    source,
    known_field: !isUnknown,
    ...(isUnknown
      ? {
          hinweis:
            'Dieses Feld gehört weder zum Eingabe-Contract noch zum Fragenkatalog. Es wird ' +
            'gespeichert, aber die Vollständigkeitsprüfung kennt es nicht.',
        }
      : {}),
    /*
     * ⚠ Die Lücken beziehen sich auf GENAU DIESEN Zählpunkt. Bei mehreren Zählpunkten ist das eine
     * andere Liste je Zeile — deshalb steht die Kennung oben mit in der Antwort, sonst läse das
     * Modell „noch offen: energyPriceCtPerKwh" ohne zu wissen, für welchen Anschluss.
     */
    still_missing: state.missing,
  })
}

/**
 * ── ⚠ `metering_point_id` IST HIER OPTIONAL, BEI `set_draft_field` DAGEGEN PFLICHT ────────────
 *
 * Der Unterschied ist nicht Bequemlichkeit, sondern die Richtung des Fehlers. SCHREIBEN an den
 * falschen Zählpunkt legt eine Zahl an einer Zeile ab, an die sie nicht gehört — sichtbar wird das
 * erst in einer Rechnung, die vollständig aussieht. LESEN über alle Zählpunkte kann nichts kaputt
 * machen; es ist genau die Frage, die ein Modell vor „sind wir fertig?" stellen will, und sie ohne
 * Kennung stellen zu dürfen erspart ihm, erst die Liste zu holen.
 *
 * Ohne Kennung wird deshalb über ALLE Zählpunkte iteriert und je einer ein eigener Status geliefert.
 * `complete` ist dann die Aussage über den BETRIEB: alle Zählpunkte fertig. Ein einzelner fertiger
 * Zählpunkt neben einem leeren ergibt `false` — und genau das ist die Wahrheit, die eine über alle
 * Zeilen gemittelte oder „mindestens einer"-Antwort verschwiege.
 */
async function completeness(
  ports: ProjectChatPorts,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const project = await ports.loadProject(projectId)
  if (project === null) return fail('Projekt nicht gefunden.')

  const catalog = await loadCatalog(ports, project)
  const answered = answeredOnProject(project)
  const segmentHint =
    project.segment === null
      ? { hinweis: 'Das Segment ist noch nicht bestimmt (set_segment).' }
      : {}

  const meteringPointId = readString(args, 'metering_point_id')

  // ── EIN benannter Zählpunkt ───────────────────────────────────────────────────────────────────
  if (meteringPointId !== null) {
    const resolved = await resolveMeteringPoint(ports, projectId, meteringPointId, 'diese Frage')
    if ('error' in resolved) return resolved.error
    const { target } = resolved

    const state = checkDraftCompleteness(target.draft, catalog, answered)
    return ok({
      complete: state.complete,
      segment: project.segment,
      metering_point_id: target.id,
      ...describeCompleteness(state),
      ...segmentHint,
    })
  }

  // ── ALLE Zählpunkte ───────────────────────────────────────────────────────────────────────────
  const meteringPoints = await ports.listMeteringPoints(projectId)
  if (meteringPoints.length === 0) {
    /*
     * ⚠ `complete: false` UND KEIN FEHLSCHLAG. Ein Projekt ohne Zählpunkt ist nicht falsch bedient
     * — es ist noch nicht eingerichtet, und das kann das Modell nicht beheben (es gibt keinen Port,
     * der einen Zählpunkt anlegt; die Zahl der Zählpunkte entscheidet ein Mensch). `complete: true`
     * wäre hier die teure Falschaussage: „nichts fehlt", weil es nichts gibt, worin etwas fehlen
     * könnte.
     */
    return ok({
      complete: false,
      segment: project.segment,
      metering_points: [],
      hinweis:
        'Für dieses Projekt sind noch keine Zählpunkte angelegt — ohne Zählpunkt gibt es keinen ' +
        'Entwurf, den man füllen könnte. Du kannst das nicht selbst nachholen: sag dem Kunden, ' +
        'dass wir das intern einrichten müssen, und halte es mit flag_open_question fest.',
    })
  }

  const perPoint = meteringPoints.map((row, index) => {
    const state = checkDraftCompleteness(row.draft, catalog, answered)
    return {
      nummer: index + 1,
      metering_point_id: row.id,
      lastgang_vorhanden: row.source_document_id !== null,
      complete: state.complete,
      ...describeCompleteness(state),
    }
  })

  return ok({
    // Alle fertig — nicht „mindestens einer". Ein Betrieb ist erst vollständig erhoben, wenn es
    // jeder seiner Anschlüsse ist.
    complete: perPoint.every((entry) => entry.complete),
    segment: project.segment,
    metering_points: perPoint,
    ...segmentHint,
  })
}

/** Die fünf Befunde einer Prüfung, in der Form, in der sie an das Modell gehen. */
function describeCompleteness(state: DraftCompleteness): Record<string, unknown> {
  return {
    missing: state.missing,
    invalid: state.invalid,
    unknown_fields: state.unknown,
    without_source: state.withoutSource,
    assumed_fields: state.assumed,
  }
}

async function flagOpenQuestion(
  ports: ProjectChatPorts,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const question = readString(args, 'question')
  if (question === null) return fail('question fehlt.')

  const fieldKey = readString(args, 'field_key')
  const kind = readString(args, 'resolution_kind')
  const assumptionNote = readString(args, 'assumption_note')

  if (kind !== null && kind !== 'assumed') {
    return fail('resolution_kind kennt nur "assumed" (Weg b). Für Weg (a) weglassen.')
  }
  /*
   * Delta §3.3 verlangt eine BEGRÜNDETE Annahme, und `resolve_open_question` weist Weg (b) ohne
   * Begründung mit `assumption_note_required` ab. Hier steht die Prüfung ein zweites Mal, damit
   * die Frage gar nicht erst ohne ihre Begründung entsteht — sonst stünde nach dem abgelehnten
   * zweiten Schritt eine Rückfrage im Bestand, für die niemand eine Annahme sieht.
   */
  if (kind === 'assumed' && assumptionNote === null) {
    return fail('Für Weg (b) ist assumption_note Pflicht: eine Annahme ohne Begründung ist später nicht prüfbar.')
  }

  const created = await ports.appendOpenQuestion(projectId, question, fieldKey)
  if (created.status !== 'ok' || typeof created.question_id !== 'string') {
    return fail(`Rückfrage konnte nicht angelegt werden: ${created.status}.`)
  }
  const questionId = created.question_id

  if (kind === null) {
    return ok({
      question_id: questionId,
      status: 'open',
      resolution_kind: null,
      weg: 'a',
      hinweis: 'Die Frage liegt jetzt bei Martin. Ihr könnt mit dem Rest weitermachen.',
    })
  }

  const resolved = await ports.resolveOpenQuestion(questionId, 'assumed', null, assumptionNote)
  if (resolved.status !== 'ok') {
    /*
     * Die Frage STEHT bereits — sie geht durch diesen Fehlschlag nicht verloren, sie steht nur ohne
     * Annahme da. Das Modell erfährt beides, damit es dem Kunden nicht „ich rechne mit X weiter"
     * sagt, wo nichts vermerkt ist.
     */
    return fail(`Annahme konnte nicht vermerkt werden: ${resolved.status}.`, {
      question_id: questionId,
      question_status: 'open',
    })
  }

  return ok({
    question_id: questionId,
    status: 'open',
    resolution_kind: 'assumed',
    weg: 'b',
    still_open_for_review: true,
    hinweis:
      'Die Annahme ist vermerkt UND die Frage bleibt bei Martin offen. Sag dem Kunden beides. ' +
      'Trag die Annahme zusätzlich mit set_draft_field und source "assumed" in den Entwurf ein.',
  })
}

// ── Extraktions-Werkzeuge ─────────────────────────────────────────────────────────────────────

/** Holt ein Dokument und stellt sicher, dass es eine PDF ist. */
async function loadPdf(
  ports: ProjectChatPorts,
  documentId: string,
): Promise<{ ok: true; base64: string; filename: string } | { ok: false; execution: ToolExecution }> {
  const document = await ports.readDocument(documentId)
  if (document === null) {
    return { ok: false, execution: fail(`Dokument ${documentId} nicht gefunden.`) }
  }
  /*
   * ⚠ Der Bucket nimmt bewusst JEDEN Dokumenttyp an (Delta §3.2), die drei PDF-Extraktoren nehmen
   * ausschliesslich PDF. Ohne diese Prüfung ginge eine CSV als `application/pdf`-Block an die API
   * und käme als unbrauchbares Ergebnis zurück — abrechenbar und ohne erkennbaren Grund.
   */
  if (document.contentType !== PDF_MEDIA_TYPE) {
    return {
      ok: false,
      execution: fail(
        `${document.filename} ist keine PDF (${document.contentType}). Dieses Werkzeug liest nur PDF.`,
      ),
    }
  }
  return {
    ok: true,
    base64: Buffer.from(document.bytes).toString('base64'),
    filename: document.filename,
  }
}

async function classifyUpload(
  ports: ProjectChatPorts,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const classify = ports.extractors.classifyDocument
  if (classify === undefined) return fail('Die Dokument-Zuordnung ist in diesem Lauf nicht verfügbar.')

  const documentId = readString(args, 'document_id')
  if (documentId === null) return fail('document_id fehlt.')

  const pdf = await loadPdf(ports, documentId)
  if (!pdf.ok) return pdf.execution

  // Die Bezeichnung ist der Dateiname — das Einzige, was der Kunde dem Dokument mitgegeben hat.
  const outcome = await classify(pdf.base64, pdf.filename)
  if (!outcome.ok) return fail(`Zuordnung fehlgeschlagen: ${outcome.reason}.`)

  return ok({
    document_id: documentId,
    type: outcome.type,
    ...(outcome.type === 'unbekannt'
      ? { hinweis: 'Nicht eindeutig zuzuordnen — frag den Kunden, worum es sich handelt.' }
      : {}),
  })
}

async function extractInvoice(
  ports: ProjectChatPorts,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const extract = ports.extractors.extractInvoiceData
  if (extract === undefined) return fail('Der Rechnungs-Scan ist in diesem Lauf nicht verfügbar.')

  const raw = args.document_ids
  if (!Array.isArray(raw) || raw.length === 0) {
    return fail('document_ids muss mindestens eine Dokumentkennung enthalten.')
  }
  const documentIds = raw.filter((id): id is string => typeof id === 'string' && id.trim() !== '')
  if (documentIds.length !== raw.length) return fail('document_ids enthält ungültige Einträge.')

  const extractions = []
  for (const documentId of documentIds) {
    const pdf = await loadPdf(ports, documentId)
    if (!pdf.ok) return pdf.execution

    const outcome = await extract(pdf.base64)
    if (!outcome.ok) {
      return fail(`Rechnung ${pdf.filename} konnte nicht ausgelesen werden: ${outcome.reason}.`)
    }
    extractions.push(outcome.extraction)
  }

  if (extractions.length === 1) {
    return ok({ documents: documentIds.length, extraction: extractions[0], conflicts: [] })
  }

  /*
   * ⚠ MEHRERE RECHNUNGEN LAUFEN DURCH `mergeInvoiceExtractions` — nicht durch eine hier gebaute
   * Zusammenführung. Die Regel („Einigkeit übernimmt, Widerspruch bleibt leer und wird benannt")
   * steht seit Delta 17 in `packages/shared` und ist dort geprüft; ein zweiter Reducer hier ergäbe
   * zwei Antworten auf dieselbe Frage. Insbesondere gibt es KEINE „die neueste gewinnt"-Regel:
   * `InvoiceExtraction` trägt gar kein Datum (dort gemessen).
   */
  const merged = mergeInvoiceExtractions(extractions)

  return ok({
    documents: documentIds.length,
    extraction: merged.merged,
    conflicts: merged.conflicts.map((key: InvoiceMergeFieldKey) => ({
      field: key,
      label: INVOICE_MERGE_FIELD_LABELS[key],
    })),
    ...(merged.conflicts.length > 0
      ? {
          hinweis:
            'Die Rechnungen widersprechen sich in den genannten Feldern; sie sind deshalb leer ' +
            'geblieben. Entscheide das NICHT selbst — leg dem Kunden die beiden Wege vor ' +
            '(warten auf Martin oder begründete Annahme) und frag ihn.',
        }
      : {}),
  })
}

async function extractPvDesign(
  ports: ProjectChatPorts,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const extract = ports.extractors.extractPvDesign
  if (extract === undefined) return fail('Der PV-Auslegungs-Scan ist in diesem Lauf nicht verfügbar.')

  const documentId = readString(args, 'document_id')
  if (documentId === null) return fail('document_id fehlt.')

  const pdf = await loadPdf(ports, documentId)
  if (!pdf.ok) return pdf.execution

  const outcome = await extract(pdf.base64)
  if (!outcome.ok) return fail(`PV-Auslegung konnte nicht ausgelesen werden: ${outcome.reason}.`)

  return ok({ document_id: documentId, extraction: outcome.extraction })
}

async function extractBattery(
  ports: ProjectChatPorts,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const extract = ports.extractors.extractBatteryText
  if (extract === undefined) {
    return fail('Die Batterie-Freitexterfassung ist in diesem Lauf nicht verfügbar.')
  }

  const text = readString(args, 'text')
  if (text === null) return fail('text fehlt.')

  const outcome = await extract(text)
  if (!outcome.ok) return fail(`Angabe konnte nicht ausgewertet werden: ${outcome.reason}.`)

  return ok({ extraction: outcome.extraction })
}

/**
 * Wie viele Lücken die ANTWORT an das Modell höchstens aufzählt.
 *
 * ⚠ Das begrenzt AUSSCHLIESSLICH die Antwort, NICHT den Schreibvorgang: an den Zählpunkt gehen
 * IMMER alle Lücken (`platform.metering_points.gaps` ist der Datensatz, und ein gekürzter Datensatz
 * behauptete eine Abdeckung, die es nicht gibt). Ein Export mit hunderten Einzelausfällen erzeugte
 * sonst ein `tool_result`, das den halben Turn füllt und dem Modell nichts sagt, was die ersten
 * zehn plus die Gesamtzahl nicht schon sagen.
 */
const MAX_REPORTED_GAPS = 10

/**
 * Beschreibt einen Zählpunkt so, wie ihn ein Mensch im Gespräch wiedererkennt.
 *
 * ⚠ Es gibt bewusst KEINE Zählpunktnummer und keine Bezeichnung (Migration 20260911120000, TEIL 6:
 * sie stehen nicht in einer Lastgang-Datei, und eine Spalte dafür entschiede den offenen Punkt 1
 * des Deltas still mit). Was bleibt, ist die REIHENFOLGE der Anlage — `list_metering_points`
 * sortiert ÄLTESTE ZUERST, und „der erste, den wir angelegt haben" ist genau die Ordnung, die ein
 * Mensch wiedererkennt. Die Kennung fährt trotzdem mit: das Modell braucht sie für den nächsten
 * Aufruf, der Kunde liest sie nie.
 */
function describeMeteringPoint(row: MeteringPointRow, index: number): Record<string, unknown> {
  return {
    nummer: index + 1,
    metering_point_id: row.id,
    lastgang_vorhanden: row.source_document_id !== null,
    ...(row.interval_minutes === null
      ? {}
      : {
          intervall_minuten: row.interval_minutes,
          zeitraum_von: row.covered_from,
          zeitraum_bis: row.covered_to,
          luecken: row.gaps.length,
        }),
  }
}

/**
 * Löst eine `metering_point_id` gegen die Zählpunkte des Projekts auf — oder liefert das
 * `tool_result`, das dem Modell sagt, was stattdessen zu tun ist.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES WIRD NICHT GERATEN, WELCHER ZÄHLPUNKT GEMEINT IST — AUCH NICHT BEI GENAU EINEM
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sich „den einen" auszusuchen wäre die bequeme Abkürzung und genau der Fehler, der bei zwei
 * Zählpunkten niemandem auffällt: der Wert stünde an der falschen Zeile, und die Rechnung daraus
 * sähe vollständig aus. Passt die Kennung nicht, bekommt das Modell die vorhandenen Zählpunkte
 * AUFGEZÄHLT und muss den Kunden fragen.
 *
 * EINE Stelle für beide Aufrufer (`set_draft_field`, `extract_load_profile`): zweimal ausgeschrieben
 * liefen die zwei Ablehnungen beim nächsten Umbau auseinander, und derselbe Fehlgriff bekäme je
 * nach Werkzeug eine andere Anweisung.
 *
 * `subject` benennt, WORUM es geht („die Datei" / „diese Angabe") — die Frage an den Kunden lautet
 * sonst nach einem Gegenstand, den es im gerade laufenden Schritt gar nicht gibt.
 */
async function resolveMeteringPoint(
  ports: ProjectChatPorts,
  projectId: string,
  meteringPointId: string,
  subject: string,
): Promise<{ target: MeteringPointRow } | { error: ToolExecution }> {
  const meteringPoints = await ports.listMeteringPoints(projectId)
  if (meteringPoints.length === 0) {
    return {
      error: fail(
        'Für dieses Projekt sind noch keine Zählpunkte angelegt. Du kannst das nicht selbst ' +
          'nachholen — sag dem Kunden, dass wir das intern einrichten müssen, und halte es mit ' +
          'flag_open_question fest.',
        { metering_points: [] },
      ),
    }
  }

  const target = meteringPoints.find((row) => row.id === meteringPointId)
  if (target === undefined) {
    return {
      error: fail(
        'Diesen Zählpunkt gibt es in diesem Projekt nicht. Such dir keinen aus — frag den Kunden, ' +
          `zu welchem Zählpunkt ${subject} gehört.`,
        { metering_points: meteringPoints.map(describeMeteringPoint) },
      ),
    }
  }

  return { target }
}

/**
 * ── ⚠ DAS EINZIGE WERKZEUG, DAS SELBST SCHREIBT — und zwar an den ZÄHLPUNKT, nicht in den Entwurf.
 *
 * Der Grund ist die Ebene: ein Betrieb kann mehrere Zählpunkte tragen (Delta §2.3), und „der
 * Lastgang deckt 2025 ab" ist eine Aussage über GENAU EINEN davon. Im Entwurf abgelegt gälte sie
 * für das ganze Projekt, und der zweite Zählpunkt überschriebe die Aussage des ersten — ohne dass
 * irgendetwas fehlschlüge.
 *
 * ── ⚠ ES WIRD NICHT GERATEN, WELCHER ZÄHLPUNKT GEMEINT IST ────────────────────────────────────
 * `metering_point_id` ist Pflicht. Passt sie nicht, bekommt das Modell die vorhandenen Zählpunkte
 * AUFGEZÄHLT und muss den Kunden fragen. Sich bei genau einem Zählpunkt „den einen" auszusuchen
 * wäre die bequeme Abkürzung und genau der Fehler, der bei zwei Zählpunkten niemandem auffällt:
 * der Zeitraum stünde dann an der falschen Zeile, und die Rechnung daraus sähe vollständig aus.
 *
 * ── ES ENTSTEHT KEIN ZÄHLPUNKT ────────────────────────────────────────────────────────────────
 * Gibt es für das Projekt keinen, wird das benannt und NICHT behoben. Wie viele Zählpunkte ein
 * Betrieb hat, ist eine fachliche Frage, die der Fragenkatalog stellen soll (Delta §4); bis dahin
 * legt ein Mensch sie über `admin_set_metering_point_count` an. Ein Port dafür machte das Modell
 * zum Entscheider über die Struktur eines Betriebs, bevor jemand entschieden hat, wie danach
 * gefragt wird.
 */
async function extractLoadProfile(
  ports: ProjectChatPorts,
  projectId: string,
  args: Record<string, unknown>,
): Promise<ToolExecution> {
  const read = ports.extractors.readLoadProfile
  if (read === undefined) return fail('Das Auslesen von Lastgängen ist in diesem Lauf nicht verfügbar.')

  const documentId = readString(args, 'document_id')
  if (documentId === null) return fail('document_id fehlt.')
  const meteringPointId = readString(args, 'metering_point_id')
  if (meteringPointId === null) return fail('metering_point_id fehlt.')

  /*
   * Der Zählpunkt wird VOR dem Lesen der Datei aufgelöst: ein 25-MB-Export zu parsen, um ihn
   * anschliessend nirgends ablegen zu können, ist verschenkte Zeit — und die Ereignisschleife
   * steht währenddessen (s. die Warnung an `readLoadProfile` in `ports.ts`).
   */
  const resolved = await resolveMeteringPoint(ports, projectId, meteringPointId, 'die Datei')
  if ('error' in resolved) return resolved.error
  const { target } = resolved

  const document = await ports.readDocument(documentId)
  if (document === null) return fail(`Dokument ${documentId} nicht gefunden.`)

  /*
   * ⚠ Eine PDF wird BENANNT abgewiesen und nicht dem Parser überlassen. Der Bucket nimmt bewusst
   * jeden Dokumenttyp an (Delta §3.2); als Text dekodiert ergäbe eine PDF hier eine unverständliche
   * Formatmeldung, und das Modell suchte den Fehler bei der Datei statt beim Werkzeug. Es ist
   * ausserdem der wahrscheinlichste Griff daneben: Rechnung und Lastgang kommen im selben Turn.
   */
  if (document.contentType === PDF_MEDIA_TYPE) {
    return fail(
      `${document.filename} ist eine PDF. Dieses Werkzeug liest Lastgänge als CSV- oder ` +
        'XLSX-Datei; für eine Rechnung nimm extract_invoice.',
    )
  }

  const outcome = read(document.bytes, document.filename)
  if (!outcome.ok) {
    return fail(
      `${document.filename} ist zu gross (${outcome.sizeBytes} Bytes, erlaubt sind ${outcome.maxBytes}).`,
    )
  }

  const scan = outcome.scan
  if (!scan.ok) {
    return fail(`${document.filename} konnte nicht gelesen werden: ${scan.error.message}`, {
      code: scan.error.code,
    })
  }

  /*
   * ⚠ MEHRERE ZÄHLPUNKTE IN EINER DATEI SIND KEIN FEHLER, ABER AUCH KEIN ERGEBNIS. Ein
   * EDA-Export führt regelmässig zwei Verbrauchs-, zwei Einspeise- und vier EEG-Spalten
   * nebeneinander (OP#4). Welche Spalte zu welchem Zählpunkt gehört, entscheidet ein Mensch —
   * hier wird deshalb NICHTS gespeichert und NICHTS geraten.
   *
   * Als `ok` zurückgegeben (nicht als Fehler): das Lesen ist gelungen, die Zuordnung ist offen.
   * Dieselbe Form wie `classify_upload` mit `type: 'unbekannt'`.
   */
  if (scan.needsMapping) {
    return ok({
      document_id: documentId,
      gespeichert: false,
      grund: 'mehrere_spalten',
      hinweis:
        'Die Datei enthält mehrere Messreihen nebeneinander. Frag den Kunden, welche Spalte zu ' +
        'welchem Zählpunkt gehört — gespeichert wurde nichts.',
      spalten: scan.ambiguousColumns.map((column) => ({
        bezeichnung: column.header,
        zaehlpunkt: column.meteringPointId,
        einheit: column.unit,
        vorschlag: column.suggestedRole,
        // Überschuss-/Restüberschuss-Spalten einer Energiegemeinschaft — Verrechnungsartefakt,
        // kein zweiter Zählpunkt. Ohne die Kennzeichnung fragte das Modell den Kunden nach
        // einer Zuordnung, die es gar nicht gibt.
        eeg_verrechnung: column.eegAccounting,
      })),
    })
  }

  const result = await ports.setMeteringPointLoadProfile(
    target.id,
    documentId,
    scan.intervalMinutes,
    scan.coveredFrom,
    scan.coveredTo,
    scan.gaps,
  )
  if (result.status !== 'ok') {
    return fail(`Der Lastgang konnte nicht gespeichert werden: ${result.status}.`)
  }

  return ok({
    document_id: documentId,
    metering_point_id: target.id,
    intervall_minuten: scan.intervalMinutes,
    zeitraum_von: scan.coveredFrom,
    zeitraum_bis: scan.coveredTo,
    messwerte: scan.rowCount,
    belegte_monate: scan.coveredMonths,
    luecken_gesamt: scan.gaps.length,
    luecken: scan.gaps.slice(0, MAX_REPORTED_GAPS),
    ...(scan.gaps.length > MAX_REPORTED_GAPS
      ? {
          luecken_hinweis:
            `Nur die ersten ${MAX_REPORTED_GAPS} Lücken sind hier aufgeführt; gespeichert sind alle ` +
            `${scan.gaps.length}.`,
        }
      : {}),
    ...(target.source_document_id === null
      ? {}
      : {
          hinweis:
            'An diesem Zählpunkt war bereits ein Lastgang hinterlegt — er wurde durch diesen ersetzt.',
        }),
  })
}
