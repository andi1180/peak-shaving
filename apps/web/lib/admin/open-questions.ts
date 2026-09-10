/**
 * Vokabular und Antwort-Leser des Admin-Abschnitts „Rückfragen" (B24, zehnter Bauschritt).
 *
 * REIN: kein `server-only`, kein `next/*` — die Seiten lesen die Typen, das Client-Formular die
 * Beschriftungen, die Server Action die Pfade. Gleiche Aufteilung wie `lib/admin/leads.ts` (B1-3),
 * `lib/admin/analyses.ts` (B14-2) und `lib/admin/partner-applications.ts` (B16-3).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES ENTSTEHT KEINE MIGRATION — die zwei Wrapper liegen seit dem zweiten Bauschritt bereit
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `public.admin_list_open_questions` (Martins Posteingang über ALLE Projekte) und
 * `public.admin_answer_open_question` (seine Antwort) sind in
 * `20260910090000_create_project_chat_state.sql` angelegt, `authenticated`-only, `is_admin()`-
 * geprüft und im DB-Gate mit echten Aufrufen abgedeckt. Was bis heute fehlte, war ausschliesslich
 * die Oberfläche: die Fragen standen in der Datenbank und sonst nirgends.
 *
 * Ebenfalls schon da und deshalb NICHT nachgebaut: den GESPRÄCHSVERLAUF und die Fragen EINES
 * Projekts liest ein Admin über `public.list_project_messages` bzw. `public.list_open_questions` —
 * beide entscheiden über `platform.project_accessible`, und die Funktion trägt `or
 * platform.is_admin()`. Ein eigener `admin_*`-Zwilling wäre eine zweite Definition desselben
 * Zugriffs.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DIE DETAILSEITE AM PROJEKT HÄNGT UND NICHT AN DER EINZELNEN FRAGE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Warteschlange ist nach FRAGEN sortiert, die Detailseite ist nach PROJEKT geschlüsselt. Das
 * ist kein Bruch, sondern folgt aus zwei Dingen:
 *
 *   (1) Es gibt keinen Wrapper, der EINE Frage liest. Ihn über `admin_list_open_questions`
 *       nachzustellen hiesse, bis zu 200 Zeilen zu holen und die gesuchte herauszufiltern — eine
 *       Ansicht, die ab der 201. Frage still ins Leere liefe.
 *   (2) Der KONTEXT, den Martin zum Beantworten braucht, ist ohnehin das Projekt: derselbe
 *       Verlauf, dieselben Dokumente, oft mehrere Fragen aus demselben Gespräch. Eine Seite je
 *       Frage zeigte denselben Verlauf mehrfach und verschwiege dabei die Geschwisterfragen —
 *       ausgerechnet die, die man beim Lesen des Verlaufs gleich mitbeantworten kann.
 *
 * Die Warteschlange verlinkt deshalb auf das Projekt und springt per Anker an die Frage.
 */

/** Basispfad des Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const OPEN_QUESTIONS_HREF = '/admin/rueckfragen'

/**
 * Die Detailseite EINES PROJEKTS, optional mit Sprungmarke auf eine bestimmte Frage.
 *
 * Der Anker ist der Grund, warum die Warteschlange trotz projekt-geschlüsselter Detailseite auf
 * die einzelne Frage zeigen kann: geklickt wird eine Frage, geöffnet wird ihr Projekt, und die
 * Seite steht an der richtigen Stelle.
 */
export function OPEN_QUESTIONS_PROJECT_HREF(projectId: string, questionId?: string): string {
  const base = `${OPEN_QUESTIONS_HREF}/${projectId}`
  return questionId ? `${base}#${QUESTION_ANCHOR(questionId)}` : base
}

/** Die Sprungmarke einer Frage auf der Projektseite — an EINER Stelle definiert. */
export function QUESTION_ANCHOR(questionId: string): string {
  return `frage-${questionId}`
}

export type OpenQuestionStatus = 'open' | 'answered' | 'dismissed'

/** Wie eine Frage aus dem Zustand `open` herausgekommen ist — bzw. womit weitergerechnet wurde. */
export type OpenQuestionResolutionKind = 'answered' | 'assumed' | null

export const OPEN_QUESTION_STATUSES: readonly OpenQuestionStatus[] = [
  'open',
  'answered',
  'dismissed',
] as const

export function isOpenQuestionStatus(value: unknown): value is OpenQuestionStatus {
  return typeof value === 'string' && (OPEN_QUESTION_STATUSES as readonly string[]).includes(value)
}

/**
 * Beschriftungen des Status. Deutsch im Code, nicht in `messages/de.json` — der Admin-Bereich liegt
 * ausserhalb der next-intl-Struktur (begründet in `lib/admin/schema.ts`, T4-4).
 *
 * ⚠ „Offen" heisst NICHT „unbearbeitet". Eine Frage, mit deren Annahme der Chat bereits
 * weiterrechnet (Weg b), steht ebenfalls auf `open` — genau das ist die Zusage aus Delta §3.3.
 * Sichtbar gemacht wird der Unterschied über `resolution_kind`, nicht über den Status.
 */
export const OPEN_QUESTION_STATUS_LABEL: Record<OpenQuestionStatus, string> = {
  open: 'Offen',
  answered: 'Beantwortet',
  dismissed: 'Verworfen',
}

/**
 * ⚠ DER FILTERWERT FÜR „ALLE" IST DER LEERE STRING, NICHT „weglassen" — gemessen am Wrapper.
 *
 * `admin_list_open_questions(p_status text default 'open', …)` hat die Vorgabe `'open'`. Ein
 * weggelassener Parameter heisst dort also „nur offene", NICHT „alle"; leer übergeben wird er im
 * Rumpf über `nullif(btrim(…), '')` zu `null` und damit zum fehlenden Filter.
 *
 * Die Seite übergibt den Wert deshalb IMMER ausdrücklich (auch den Vorgabefall). Sonst hinge die
 * Voreinstellung der Oberfläche stillschweigend daran, dass die Vorgabe der Datenbank dieselbe
 * bleibt — und eine spätere Änderung dort verschöbe, was die Liste zeigt, ohne dass hier eine
 * Zeile anders aussähe.
 */
export const OPEN_QUESTION_FILTER_ALL = ''

/** Eine Zeile aus `public.admin_list_open_questions` — quer über alle Projekte. */
export type OpenQuestionQueueRow = {
  id: string
  project_id: string
  /**
   * Die Bezeichnung des Projekts. Sie steht DENORMALISIERT an `platform.projects` (B14-1-Muster)
   * und überlebt damit das Konto — Martin muss sehen, WESSEN Frage er beantwortet, auch wenn der
   * Account längst weg ist.
   */
  customer_label: string
  segment: 'privat' | 'betrieb' | null
  field_key: string | null
  question: string
  status: OpenQuestionStatus
  created_at: string
  resolution_kind: OpenQuestionResolutionKind
  resolution_value: string | null
  assumption_note: string | null
  impact_note: string | null
  answered_at: string | null
}

/** Eine Zeile aus `public.list_open_questions` — die Fragen EINES Projekts. Ohne Projektangaben. */
export type ProjectQuestionRow = Omit<
  OpenQuestionQueueRow,
  'customer_label' | 'segment' | 'project_id'
> & { project_id: string }

export type OpenQuestionQueue = {
  total: number
  questions: OpenQuestionQueueRow[]
}

export type ProjectQuestionList = {
  total: number
  questions: ProjectQuestionRow[]
}

/** Der Projektkopf aus `public.admin_get_project`. */
export type AdminProjectHead = {
  id: string
  account_id: string | null
  customer_label: string
  created_by_email: string | null
  created_at: string
  updated_at: string
}

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/**
 * `null` = der Wrapper hat NICHT `ok` gemeldet (nicht: „es gibt keine Fragen").
 * `'invalid_filter'` = der Statusfilter wurde abgewiesen; die Seite sagt das, statt eine
 * ungefilterte Liste als gefilterte auszugeben.
 *
 * Der Unterschied ist hier nicht theoretisch: eine LEERE Warteschlange ist der erwünschte
 * Normalzustand — sie heisst „nichts liegt an". „Konnte nicht geladen werden" heisst das Gegenteil,
 * und beides gleich darzustellen wäre die teuerste Verwechslung dieser Seite.
 *
 * ⚠ Die Reihenfolge wird NICHT nachsortiert. `admin_list_open_questions` liefert ÄLTESTE ZUERST —
 * entgegen der Gewohnheit jedes anderen `admin_list_*` dieses Repos, und mit Absicht: ein
 * Posteingang wird von vorne abgearbeitet, bei `desc` läge der am längsten wartende Kunde am Ende
 * der letzten Seite. Ein `sort()` hier nähme genau diese Entscheidung zurück.
 */
export function readOpenQuestionQueue(data: unknown): OpenQuestionQueue | 'invalid_filter' | null {
  const obj = asObject(data)
  if (!obj) return null
  if (obj.status === 'invalid_filter') return 'invalid_filter'
  if (obj.status !== 'ok') return null

  return {
    total: typeof obj.total === 'number' ? obj.total : 0,
    questions: Array.isArray(obj.questions) ? (obj.questions as OpenQuestionQueueRow[]) : [],
  }
}

/** `null` = nicht gelesen; `'not_found'` = das Projekt gibt es nicht. Zwei verschiedene Aussagen. */
export function readProjectQuestions(
  data: unknown,
): ProjectQuestionList | 'not_found' | null {
  const obj = asObject(data)
  if (!obj) return null
  if (obj.status === 'not_found') return 'not_found'
  if (obj.status !== 'ok') return null

  return {
    total: typeof obj.total === 'number' ? obj.total : 0,
    questions: Array.isArray(obj.questions) ? (obj.questions as ProjectQuestionRow[]) : [],
  }
}

/** `null` = nicht gelesen; `'not_found'` = es gibt das Projekt nicht. */
export function readAdminProject(data: unknown): AdminProjectHead | 'not_found' | null {
  const obj = asObject(data)
  if (!obj) return null
  if (obj.status === 'not_found') return 'not_found'
  if (obj.status !== 'ok') return null
  const project = asObject(obj.project)
  return project ? (project as AdminProjectHead) : null
}

/**
 * Ist mit dieser Frage bereits eine ANNAHME getroffen worden (Weg b aus Delta §3.3)?
 *
 * ⚠ Das ist der Zustand, den diese Oberfläche erstmals sichtbar macht — und der einzige, den man
 * beim Lesen des Status falsch versteht: `resolve_open_question('assumed')` lässt `status` auf
 * `open` STEHEN. Der Chat rechnet mit der Annahme weiter UND die Frage wartet trotzdem auf Martin.
 * Eine Ansicht, die nur den Status zeigt, verschwiege, dass der Kunde bereits eine Zahl gesehen
 * hat, die auf einer Vermutung beruht.
 */
export function hasStandingAssumption(row: {
  status: OpenQuestionStatus
  resolution_kind: OpenQuestionResolutionKind
}): boolean {
  return row.status === 'open' && row.resolution_kind === 'assumed'
}

/**
 * Wie alt ist eine Frage, in ganzen Tagen? Grundlage der Dringlichkeits-Markierung.
 *
 * `now` ist ein PFLICHTPARAMETER und kein `Date.now()` im Rumpf: eine Funktion, die selbst auf die
 * Uhr sieht, lässt sich nicht gegen einen Stichtag prüfen (dieselbe Regel wie bei
 * `standardProfileYear` und dem 15-Monats-Hinweis der Tarifpflege). Ein unlesbarer Zeitstempel
 * liefert `null` — nicht 0, das hiesse „heute eingegangen".
 */
export function questionAgeInDays(createdAt: string, now: Date): number | null {
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return null
  const ms = now.getTime() - created.getTime()
  if (ms < 0) return 0
  return Math.floor(ms / 86_400_000)
}

/**
 * Ab wann eine offene Rückfrage als liegengeblieben gilt.
 *
 * ⚠ EINE GESETZTE ZAHL OHNE FACHLICHE QUELLE — als solche gekennzeichnet, wie die Lücken-Schwelle
 * des Reports und der 15-Monats-Hinweis der Tarifpflege. Sie SPERRT nichts und ändert keine
 * Rechnung; sie färbt eine Markierung. Drei Werktage sind die Spanne, nach der ein Kunde, der auf
 * eine Auskunft wartet, sie anmahnt — kleiner gesetzt stünde die Markierung im Normalbetrieb
 * dauernd da und wäre binnen einer Woche ein Möbelstück.
 */
export const QUESTION_STALE_DAYS = 3

/**
 * Der Verlauf eines Projekts, wie `public.list_project_messages` ihn liefert.
 *
 * `total` fährt mit, und das ist hier nicht Zierrat: der Wrapper deckelt bei 500 Zeilen je Seite
 * und liefert die ÄLTESTEN zuerst. Ein Gespräch, das darüber hinauswächst, verlöre also sein ENDE —
 * ausgerechnet die Turns, aus denen die Rückfrage entstanden ist. Die Seite blättert bewusst nicht
 * (ein Verlauf dieser Länge ist heute weit entfernt), aber sie muss es SAGEN können; still gekürzt
 * wäre der Kontext lückenhaft, ohne dass es jemandem auffiele.
 */
export type ProjectTranscript = {
  total: number
  messages: { role: string; content: unknown }[]
}

/** `null` = nicht gelesen; `'not_found'` = es gibt das Projekt nicht. */
export function readProjectMessages(data: unknown): ProjectTranscript | 'not_found' | null {
  const obj = asObject(data)
  if (!obj) return null
  if (obj.status === 'not_found') return 'not_found'
  if (obj.status !== 'ok') return null

  const rows = Array.isArray(obj.messages) ? obj.messages : []
  return {
    total: typeof obj.total === 'number' ? obj.total : rows.length,
    /*
     * Nur Rolle und Inhalt werden übernommen — `id`, `project_id` und `created_at` bleiben liegen.
     * Die Auswahl der sichtbaren Zeilen trifft `visibleTranscript` (`lib/project-chat/transcript.ts`),
     * und die braucht genau diese zwei Felder; alles Weitere durchzureichen hiesse, einer Ansicht
     * Daten zu geben, die sie nicht anzeigt.
     */
    messages: rows
      .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
      .map((row) => ({ role: String(row.role ?? ''), content: row.content })),
  }
}
