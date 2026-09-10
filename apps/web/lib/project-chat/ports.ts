import type Anthropic from '@anthropic-ai/sdk'
import type {
  BatteryTextExtraction,
  InvoiceExtraction,
  PvDesignExtraction,
  UploadDocumentType,
} from 'shared'

/**
 * B24 — DER VERTRAG, DEN DIE CHAT-SCHLEIFE VON AUSSEN BEKOMMT.
 *
 * ── WARUM DAS EIN VERTRAG IST UND KEIN IMPORT ───────────────────────────────────────────────────
 * `agent.ts` und `executor.ts` sollen ohne Datenbank, ohne Netz und ohne Schlüssel prüfbar sein —
 * die Schleife und die Werkzeug-Zuordnung sind die Stellen, an denen dieser Schritt richtig oder
 * falsch ist, und beides lässt sich nur messen, wenn die Aussenwelt ersetzbar ist. Deshalb nimmt
 * die Schleife ihre Aussenwelt als Parameter. `supabase-ports.ts` liefert die echte Fassung.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE VIER EXTRAKTOREN SIND PORTS UND KEINE IMPORTE — und der Grund ist gemessen
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die vier kundenrelevanten Extraktoren liegen in der ANDEREN App:
 *
 *   apps/website/lib/invoice-scan/extract.ts          → extractInvoiceData(pdfBase64)
 *   apps/website/lib/pv-design-scan/extract.ts        → extractPvDesign(pdfBase64)
 *   apps/website/lib/battery-text/extract.ts          → extractBatteryText(text)
 *   apps/website/lib/upload-classification/extract.ts → classifyDocument(pdfBase64, label)
 *
 * Der Chat kann sie nicht importieren, und das ist keine Bequemlichkeitsfrage:
 *
 *   (a) Der Chat MUSS in `apps/web` liegen. Der gesamte Zugriffsschutz der zwölf Wrapper hängt an
 *       `auth.uid()` (`platform.project_accessible`), und eine angemeldete Sitzung gibt es nur
 *       hier — `apps/website` führt kein `@supabase/ssr`, keine Middleware und keinen Cookie-Client
 *       (gemessen). Der eingeloggte Teil liegt seit B10-3 ausdrücklich in dieser App.
 *   (b) Die zwei Apps importieren einander NIE. Es gibt keinen Pfad-Alias, keine
 *       Workspace-Abhängigkeit und keinen einzigen Import über die Grenze (gemessen); die
 *       Rechner-Seite schreibt es sogar in Prosa hin („hier wird NICHTS von ihm nachgebaut,
 *       importiert oder …", `app/(site)/[locale]/peak-shaving/kalkulator/rechner/page.tsx`).
 *   (c) Verschieben ist ausgeschlossen. Nach `packages/shared` können sie nicht: `shared` wird in
 *       das CLIENT-Bündel des Rechners hineingebaut, und `import 'server-only'` bräche diesen Build
 *       hart. Ein eigenes server-only-Paket wäre der richtige Zug — es ist ein UMBAU an sechs
 *       bestehenden Modulen und an fünf ESLint-Blöcken und damit ein eigener Schritt.
 *
 * Die Prompts hier ein zweites Mal auszuschreiben ist die einzige Möglichkeit, die AUSSCHEIDET:
 * zwei Fassungen derselben Ableseregel laufen beim nächsten Umbau auseinander, und dann liest
 * derselbe Kunde je nach Einstieg eine andere Zahl von derselben Rechnung. Genau diese Doppelung
 * verbietet der Auftrag.
 *
 * ⚠ FOLGE, DIE SICHTBAR BLEIBEN MUSS: ein Werkzeug ohne Port wird dem Modell GAR NICHT ANGEBOTEN
 * (`buildChatTools`), und der System-Prompt sagt in dem Fall im Klartext, dass Dokumente noch nicht
 * gelesen werden können. Kein leerer Werkzeugrumpf, keine Requisite, keine stille Fehlanzeige.
 */

/** Die vier Rollen aus `platform.project_messages` (CHECK der Migration 20260910090000). */
export const CHAT_MESSAGE_ROLES = ['user', 'assistant', 'tool_call', 'tool_result'] as const
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number]

/**
 * Eine Zeile des Verlaufs. `content` ist IMMER ein Array von Blöcken — die Migration erzwingt das
 * per CHECK, damit jeder Leser genau eine Form behandelt statt der zwei, die die Messages-API
 * zulässt.
 */
export interface StoredChatMessage {
  role: ChatMessageRole
  content: Anthropic.ContentBlockParam[]
}

/** Das Segment eines Projekts (CHECK `projects_segment_check`). `null` = noch nicht bestimmt. */
export const PROJECT_SEGMENTS = ['privat', 'betrieb'] as const
export type ProjectSegment = (typeof PROJECT_SEGMENTS)[number]

/**
 * Das Format eines Branchen-Schlüssels — Spiegel des CHECK `projects_industry_format`.
 *
 * ⚠ Es ist eine OFFENE Liste (Delta §4.1: neue Branchen-Pools sollen ohne Schema-Änderung
 * entstehen), aber KEINE offene Schreibweise: `industry` entscheidet, welcher Fragen-Pool geladen
 * wird, und ein Identitätsfeld ohne Format hat die Falle, die B21-2b für `operator_id`
 * ausschreibt — ein Tippfehler erzeugt keine Ablehnung, sondern eine ZWEITE Identität, die erst
 * auffällt, wenn ein Kunde den falschen Pool bekommt. `hotel` und `Hotel` wären zwei Pools.
 *
 * Die Prüfung steht hier ZUSÄTZLICH und nicht STATT der Datenbank: dort ist sie die wirksame
 * (CHECK + `invalid_industry` im Wrapper), hier erzeugt sie einen lesbaren Satz, den das Modell
 * korrigieren kann — dieselbe Aufteilung, aus der die Werkzeuge ohne `strict: true` auskommen.
 */
export const INDUSTRY_KEY_PATTERN = /^[a-z0-9][a-z0-9_]*$/

export interface ProjectSnapshot {
  segment: ProjectSegment | null
  /**
   * Die Branche eines Betriebs-Projekts (`platform.projects.industry`), `null` = nicht bestimmt.
   *
   * ⚠ NICHT das Enum `platform.industry` von `platform.leads` — gleicher Name, anderer Typ, andere
   * Wertemenge, anderer Zweck (Spaltenkommentar der Migration 20260910120000).
   */
  industry: string | null
  /** Der laufende Entwurf (`platform.projects.draft`). Immer ein Objekt, nie `null`. */
  draft: Record<string, unknown>
}

/**
 * Der heute geltende Stand der admin-gepflegten System-Prompt-Erweiterung (Delta §4.3).
 *
 * `id` und `validFrom` werden mitgeführt, obwohl sie den Modellaufruf nicht beeinflussen: der
 * Wrapper liefert sie ausdrücklich, „damit festhaltbar ist, welche Fassung ein Gespräch bestimmt
 * hat". Einen Ort, an dem sich das festhalten liesse, gibt es in dieser Fassung noch NICHT — das
 * wäre der denormalisiert am Projekt mitgeführte Stand aus Delta §4.2, und der gehört zum Schritt,
 * der auch den Fragenkatalog verdrahtet. Die zwei Felder hier zu führen kostet nichts und erspart
 * jenem Schritt, den Weg ein zweites Mal zu legen.
 */
export interface SystemPromptExtension {
  id: string
  text: string
  validFrom: string
}

/** Eine Zeile aus `platform.project_open_questions`, so wie `list_open_questions` sie liefert. */
export interface OpenQuestionRow {
  id: string
  field_key: string | null
  question: string
  status: 'open' | 'answered' | 'dismissed'
  resolution_kind: 'answered' | 'assumed' | null
  resolution_value: string | null
  assumption_note: string | null
}

/** Eine Zeile aus `platform.project_documents` — Metadaten, nie Bytes. */
export interface ProjectDocumentRow {
  id: string
  original_filename: string
  content_type: string
}

/** Die Bytes eines Dokuments, nachdem die DATENBANK dem Zugriff zugestimmt hat. */
export interface ProjectDocumentContent {
  bytes: ArrayBuffer
  filename: string
  contentType: string
}

/**
 * Die Ausgänge der vier Extraktoren — STRUKTURGLEICH zu den Originalen in `apps/website`.
 *
 * Es ist eine Typdeklaration und keine zweite Umsetzung: der Rumpf bleibt drüben, hier steht nur
 * die Form, in der er antwortet. Die Nutzlast-Typen (`InvoiceExtraction` und die drei anderen)
 * kommen aus `packages/shared` und sind damit für BEIDE Seiten dieselben — es gibt keine zweite
 * Beschreibung derselben Felder.
 */
export type ExtractorOutcome<T> =
  | { ok: true; extraction: T }
  | { ok: false; reason: 'not_configured' | 'api_error' | 'unreadable' }

export interface ChatExtractors {
  /** `apps/website/lib/upload-classification/extract.ts` — antwortet ohne `unreadable`. */
  classifyDocument(
    pdfBase64: string,
    label: string,
  ): Promise<{ ok: true; type: UploadDocumentType } | { ok: false; reason: 'not_configured' | 'api_error' }>
  /** `apps/website/lib/invoice-scan/extract.ts` */
  extractInvoiceData(pdfBase64: string): Promise<ExtractorOutcome<InvoiceExtraction>>
  /** `apps/website/lib/pv-design-scan/extract.ts` */
  extractPvDesign(pdfBase64: string): Promise<ExtractorOutcome<PvDesignExtraction>>
  /** `apps/website/lib/battery-text/extract.ts` */
  extractBatteryText(text: string): Promise<ExtractorOutcome<BatteryTextExtraction>>
}

/** Der Rückgabewert der schreibenden Wrapper: sie antworten durchgängig mit einem `status`. */
export type WrapperStatus = { status: string; [key: string]: unknown }

/**
 * Alles, was die Schleife von aussen braucht.
 *
 * Jede Methode bildet GENAU EINEN Wrapper der Migration ab und trifft selbst keine
 * Zugriffsentscheidung — die fällt in der Datenbank gegen `auth.uid()`. `null` bzw. `not_found`
 * heisst hier deshalb wie dort: „gibt es nicht ODER gehört jemand anderem", und die zwei sind
 * bewusst nicht unterscheidbar.
 */
export interface ProjectChatPorts {
  /** `public.get_project` — `null`, wenn das Projekt fehlt oder fremd ist. */
  loadProject(projectId: string): Promise<ProjectSnapshot | null>
  /** `public.list_project_messages` — ÄLTESTE ZUERST, so wie der Wrapper sortiert. */
  loadMessages(projectId: string): Promise<StoredChatMessage[]>
  /** `public.append_project_message` — der einzige Schreibweg auf den Verlauf. */
  appendMessage(
    projectId: string,
    role: ChatMessageRole,
    content: Anthropic.ContentBlockParam[],
  ): Promise<WrapperStatus>
  /**
   * `public.update_project_draft` — ERSETZT den Entwurf.
   *
   * `segment` und `industry` weggelassen heissen UNVERÄNDERT, nicht „löschen" (Lesart
   * `capture_lead`, im Wrapper begründet). Eine Branche nimmt der Wrapper nur an, wenn das nach
   * dem Aufruf geltende Segment `betrieb` ist — sonst `industry_requires_betrieb`.
   */
  saveProject(
    projectId: string,
    draft: Record<string, unknown>,
    segment?: ProjectSegment,
    industry?: string,
  ): Promise<WrapperStatus>
  /** `public.list_open_questions` ohne Filter — alle Status, damit „bereits beantwortet" sichtbar ist. */
  listOpenQuestions(projectId: string): Promise<OpenQuestionRow[]>
  /** `public.append_open_question` */
  appendOpenQuestion(
    projectId: string,
    question: string,
    fieldKey: string | null,
  ): Promise<WrapperStatus>
  /** `public.resolve_open_question` */
  resolveOpenQuestion(
    questionId: string,
    kind: 'assumed' | 'answered' | 'dismissed',
    value: string | null,
    assumptionNote: string | null,
  ): Promise<WrapperStatus>
  /** `public.list_project_documents` */
  listDocuments(projectId: string): Promise<ProjectDocumentRow[]>
  /** `get_project_document` + Bytes aus dem Bucket. `null` bei fremd/unbekannt. */
  readDocument(documentId: string): Promise<ProjectDocumentContent | null>
  /**
   * `public.get_system_prompt_extension` — der heute geltende Stand, oder `null`.
   *
   * ⚠ `null` heisst hier ZWEIERLEI und bewusst ununterscheidbar: „es ist keine Erweiterung
   * gepflegt" (der Normalzustand) ODER „der Lesevorgang ist gescheitert". Für den Aufrufer ist
   * beides dasselbe — er läuft mit dem Kern-Prompt weiter, der das Verhalten allein trägt
   * (Funktionskommentar des Wrappers). Ein gescheiterter Lesevorgang eines admin-gepflegten Textes
   * darf das Gespräch eines Kunden nicht abbrechen; er wird stattdessen protokolliert.
   */
  loadSystemPromptExtension(): Promise<SystemPromptExtension | null>
  /**
   * Die vier Extraktoren, EINZELN optional — s. der ⚠-Block oben. Fehlt einer, gibt es das
   * zugehörige Werkzeug nicht; es entsteht kein Rumpf, der so tut, als könnte er etwas.
   */
  extractors: Partial<ChatExtractors>
}
