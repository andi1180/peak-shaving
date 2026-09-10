import {
  INVOICE_MERGE_FIELD_LABELS,
  type InvoiceMergeFieldKey,
  mergeInvoiceExtractions,
} from 'shared'

import { checkDraftCompleteness, setDraftField, type DraftValue } from './draft'
import {
  DRAFT_VALUE_SOURCES,
  type ChatToolName,
  type DraftValueSource,
  isChatToolName,
} from './tools'
import { PROJECT_SEGMENTS, type ProjectChatPorts, type ProjectSegment } from './ports'

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
 * `update_project_draft` ERSETZT den Entwurf (die Migration begründet das: eine flache
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
    case 'set_draft_field':
      return setDraft(ports, projectId, args, now)
    case 'check_draft_completeness':
      return completeness(ports, projectId)
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
  }
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
   * Der Wrapper nimmt Entwurf UND Segment gemeinsam entgegen und ERSETZT den Entwurf — der
   * aktuelle muss also mitgeschickt werden. Ohne das Lesen davor löschte ein Segmentwechsel
   * stillschweigend alles, was bisher gesammelt wurde.
   */
  const project = await ports.loadProject(projectId)
  if (project === null) return fail('Projekt nicht gefunden.')

  const result = await ports.saveProject(projectId, project.draft, segment as ProjectSegment)
  if (result.status !== 'ok') return fail(`Segment konnte nicht gesetzt werden: ${result.status}.`)

  return ok({ segment })
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

  const project = await ports.loadProject(projectId)
  if (project === null) return fail('Projekt nicht gefunden.')

  const nextDraft = setDraftField(
    project.draft,
    field,
    rawValue as DraftValue,
    source as DraftValueSource,
    note,
    now,
  )

  const result = await ports.saveProject(projectId, nextDraft)
  if (result.status !== 'ok') return fail(`Entwurf konnte nicht geschrieben werden: ${result.status}.`)

  const state = checkDraftCompleteness(nextDraft)

  /*
   * ⚠ EIN UNBEKANNTER FELDNAME WIRD ANGENOMMEN UND BENANNT, NICHT ABGEWIESEN. Der Entwurf ist
   * bewusst offen (der Betrieb-Zuschnitt ist offener Punkt 1 des Deltas), aber ein Wert unter einem
   * erfundenen Namen fällt aus der Vollständigkeitsprüfung heraus und wäre danach unsichtbar. Das
   * Modell erfährt es hier und kann korrigieren.
   */
  return ok({
    field,
    value: rawValue,
    source,
    known_contract_field: !state.unknown.includes(field),
    ...(state.unknown.includes(field)
      ? {
          hinweis:
            'Dieses Feld gehört nicht zum Eingabe-Contract. Es wird gespeichert, aber die ' +
            'Vollständigkeitsprüfung kennt es nicht.',
        }
      : {}),
    still_missing: state.missing,
  })
}

async function completeness(
  ports: ProjectChatPorts,
  projectId: string,
): Promise<ToolExecution> {
  const project = await ports.loadProject(projectId)
  if (project === null) return fail('Projekt nicht gefunden.')

  const state = checkDraftCompleteness(project.draft)
  return ok({
    complete: state.complete,
    segment: project.segment,
    missing: state.missing,
    invalid: state.invalid,
    unknown_fields: state.unknown,
    without_source: state.withoutSource,
    assumed_fields: state.assumed,
    ...(project.segment === null
      ? { hinweis: 'Das Segment ist noch nicht bestimmt (set_segment).' }
      : {}),
  })
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
