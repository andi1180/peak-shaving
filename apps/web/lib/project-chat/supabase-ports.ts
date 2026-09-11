import 'server-only'

import type Anthropic from '@anthropic-ai/sdk'

import type { Json } from '@/db-types'
import { readProjectDocument } from '@/lib/project-documents/documents'
import { createClient } from '@/lib/supabase/server'
import type {
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
import type { ChatExtractors } from './ports'

/**
 * B24 — DIE ECHTE AUSSENWELT DER CHAT-SCHLEIFE.
 *
 * ── ⚠ JEDER AUFRUF LÄUFT ALS DAS ANGEMELDETE KONTO ────────────────────────────────────────────
 * Der Client kommt aus `@/lib/supabase/server`, also mit der Sitzung des Nutzers. Die zwölf
 * Wrapper sind `authenticated`-only und beantworten die Eigentumsfrage selbst
 * (`platform.project_accessible` gegen `auth.uid()`). Es gibt hier bewusst KEINEN
 * service_role-Client: die naheliegende Abkürzung wäre, eine Konto-Kennung entgegenzunehmen und ihr
 * zu glauben — genau die eine Stelle, an der ein Fehler im Anwendungscode zu einem Leck über
 * Kundengrenzen würde (wortgleiche Auflage wie in `lib/project-documents/storage.ts`).
 *
 * ── DIE BYTES LAUFEN ÜBER `lib/project-documents/documents.ts` ────────────────────────────────
 * Das ist der Weg aus dem vorigen Schritt: `get_project_document` als angemeldetes Konto liefert
 * den Pfad NUR, wenn das Projekt dem Aufrufer gehört, danach holt der service_role-Weg die Bytes.
 * Hier wird davon nichts nachgebaut — der Kopf jener Datei nennt den Chat ausdrücklich als einen
 * ihrer zwei Konsumenten.
 *
 * ── ⚠ DIE VIER EXTRAKTOREN KOMMEN VON AUSSEN ──────────────────────────────────────────────────
 * `createProjectChatPorts` nimmt sie als Parameter und hat KEINEN Vorgabewert. Sie liegen in
 * `apps/website` und sind von hier aus nicht erreichbar (die drei gemessenen Gründe stehen im Kopf
 * von `ports.ts`); ein leerer Rumpf, der so tut, als könnte er lesen, wäre die Requisite, die
 * dieses Repo sonst überall vermeidet. Ohne sie fehlen die vier Werkzeuge — sichtbar, benannt, und
 * der Rest des Gesprächs läuft.
 */

/**
 * Die Wrapper antworten durchgängig mit einem jsonb-Objekt, das ein `status`-Feld trägt.
 *
 * ⚠ Es gibt hier bewusst KEINEN generischen `rpc(name, args)`-Helfer: die erzeugten Typen
 * (`supabase/database.types.ts`) binden die Argumentform an den Funktionsnamen, und ein generischer
 * Helfer nähme genau diese Bindung weg — ein Tippfehler in `p_project_id` wäre dann erst zur
 * Laufzeit sichtbar, als leeres Ergebnis. Jeder Port ruft deshalb seinen Wrapper selbst auf.
 */
function asWrapperStatus(data: unknown, error: unknown): WrapperStatus {
  if (error) return { status: 'rpc_error' }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return { status: 'rpc_error' }
  const record = data as Record<string, unknown>
  return { ...record, status: typeof record.status === 'string' ? record.status : 'rpc_error' }
}

/**
 * Der Verlauf eines Projekts, roh — Zeilen mit Rolle und Blöcken, wie sie gespeichert sind.
 *
 * ⚠ Steht seit dem achten Bauschritt als EIGENE Funktion und nicht mehr nur als Port-Rumpf: die
 * Chat-Oberfläche braucht denselben Verlauf, ohne dafür ein vollständiges Port-Objekt samt
 * Extraktoren zu bauen. Der Port DELEGIERT hierher — ein zweiter `list_project_messages`-Aufruf
 * daneben wäre eine zweite Auslegung derselben Antwort (die Obergrenze unten, die Rollen-Prüfung,
 * die Behandlung kaputter Zeilen), und die Abweichung fiele erst auf, wenn die Oberfläche einen
 * anderen Verlauf zeigt als das Modell gelesen hat.
 *
 * ⚠ Die Obergrenze des Wrappers liegt bei 500 Zeilen je Aufruf; hier wird EINE Seite geholt.
 * Ein Gespräch, das darüber hinauswächst, verliert damit seinen Anfang — sichtbar dadurch,
 * dass `total` grösser wäre als die gelieferte Liste. Das ist kein Blattwerk, das man
 * nachrüstet: WELCHE Turns ein langes Gespräch behält, ist eine fachliche Frage (Verdichtung,
 * §6.3-Nachbarschaft) und gehört in den Abstimmungs-Schritt, nicht in eine stille Schleife
 * über weitere Seiten.
 */
export async function loadProjectMessages(projectId: string): Promise<StoredChatMessage[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_project_messages', {
    p_project_id: projectId,
    p_limit: 500,
    p_offset: 0,
  })
  const result = asWrapperStatus(data, error)
  if (result.status !== 'ok' || !Array.isArray(result.messages)) return []

  return (result.messages as Record<string, unknown>[])
    .map((row): StoredChatMessage | null => {
      const role = row.role
      const content = row.content
      if (typeof role !== 'string') return null
      if (!Array.isArray(content)) return null
      return {
        role: role as ChatMessageRole,
        content: content as Anthropic.ContentBlockParam[],
      }
    })
    .filter((row): row is StoredChatMessage => row !== null)
}

/** Die Dokumente eines Projekts — Metadaten, nie Bytes. Zweiter Konsument: die Oberfläche. */
export async function loadProjectDocuments(projectId: string): Promise<ProjectDocumentRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_project_documents', {
    p_project_id: projectId,
    p_limit: 200,
    p_offset: 0,
  })
  const result = asWrapperStatus(data, error)
  if (result.status !== 'ok' || !Array.isArray(result.documents)) return []
  return (result.documents as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    original_filename: String(row.original_filename),
    content_type: String(row.content_type),
  }))
}

export function createProjectChatPorts(extractors: Partial<ChatExtractors>): ProjectChatPorts {
  return {
    async checkRateLimit(projectId: string): Promise<ChatRateLimitDecision> {
      /*
       * ⚠ FAIL CLOSED. Alles, was nicht als bekannter Status zurückkommt — Netzfehler, fehlende
       * Migration, unerwartetes jsonb —, wird zu `unavailable` und damit zu „kein Modellaufruf".
       * Die Begründung steht an der Port-Definition; kurz: ein unbekanntes Budget darf kein
       * abrechenbares Geld ausgeben. Protokolliert wird trotzdem, sonst wäre eine dauerhaft
       * unwirksame Bremse von einem stillen Ausfall nicht zu unterscheiden.
       */
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('check_chat_rate_limit', {
        p_project_id: projectId,
      })
      const result = asWrapperStatus(data, error)

      if (result.status === 'not_found') return { status: 'not_found' }

      if (result.status === 'limit_reached') {
        /*
         * `used`/`max` sind hier PFLICHT — sie sind die einzige konkrete Auskunft, die der Nutzer
         * bekommt. Fehlen sie, ist die Antwort nicht die, die dieser Zweig behauptet, und der Fall
         * gehört zu `unavailable` statt zu einer erfundenen Zahl.
         */
        const used = result.used
        const max = result.max
        if (typeof used === 'number' && typeof max === 'number') {
          return { status: 'limit_reached', used, max }
        }
        console.error('[project-chat] Kostenbremse ohne Zählstand:', result)
        return { status: 'unavailable' }
      }

      if (result.status === 'ok') {
        // Bei einer Adminrolle wird bewusst nicht gezählt — dann fehlen beide Felder, und das ist
        // kein Fehler, sondern die Aussage „ausgenommen".
        const used = typeof result.used === 'number' ? result.used : undefined
        const max = typeof result.max === 'number' ? result.max : undefined
        return { status: 'ok', used, max }
      }

      console.error('[project-chat] Kostenbremse nicht ermittelbar:', result.status, error)
      return { status: 'unavailable' }
    },

    async loadProject(projectId: string): Promise<ProjectSnapshot | null> {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('get_project', { p_id: projectId })
      const result = asWrapperStatus(data, error)
      if (result.status !== 'ok') return null

      const project = result.project as Record<string, unknown> | undefined
      if (project === undefined || project === null) return null

      const segment = project.segment
      const industry = project.industry
      /*
       * ⚠ `project.draft` wird BEWUSST NICHT MEHR GELESEN. Der Wrapper liefert die Spalte weiterhin
       * (sie ist eingefroren, nicht gedroppt — Migration 20260911150000 TEIL 4), der Entwurf liegt
       * aber seit dort am ZÄHLPUNKT. Ihn hier weiter durchzureichen hiesse, einen zweiten,
       * veralteten Entwurf neben dem echten zu führen.
       */
      return {
        segment: segment === 'privat' || segment === 'betrieb' ? (segment as ProjectSegment) : null,
        /*
         * `industry` ist eine OFFENE Liste — hier wird deshalb nichts gegen eine Werteliste
         * geprüft, nur die Form. Der CHECK an der Spalte garantiert das Format bereits; der
         * Rückfall auf `null` ist reine Vorsicht gegen ein unerwartetes jsonb.
         */
        industry: typeof industry === 'string' && industry !== '' ? industry : null,
      }
    },

    loadMessages: loadProjectMessages,

    async appendMessage(projectId, role, content) {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('append_project_message', {
        p_project_id: projectId,
        p_role: role,
        p_content: content as unknown as Json,
      })
      return asWrapperStatus(data, error)
    },

    async saveProject(projectId, segment, industry) {
      /*
       * `p_segment` und `p_industry` werden nur mitgeschickt, wenn es einen Wert gibt: `null` heisst
       * im Wrapper UNVERÄNDERT (Lesart `capture_lead`), und ein hier immer mitgesendetes `null`
       * wäre dasselbe — aber der Unterschied soll am Aufruf ablesbar sein, nicht in der Wrapper-Doku
       * nachzulesen.
       *
       * ⚠ `p_draft` gibt es hier nicht mehr (Migration 20260911150000): der Wrapper heisst weiter
       * `update_project_draft`, fasst den Entwurf aber nicht mehr an.
       */
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('update_project_draft', {
        p_id: projectId,
        ...(segment === undefined ? {} : { p_segment: segment }),
        ...(industry === undefined ? {} : { p_industry: industry }),
      })
      return asWrapperStatus(data, error)
    },

    async saveMeteringPointDraft(meteringPointId, draft) {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('update_metering_point_draft', {
        p_metering_point_id: meteringPointId,
        p_draft: draft as Json,
      })
      return asWrapperStatus(data, error)
    },

    async listOpenQuestions(projectId: string): Promise<OpenQuestionRow[]> {
      // Ohne Statusfilter: „bereits beantwortet" soll im Gespräch sichtbar bleiben.
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('list_open_questions', {
        p_project_id: projectId,
        p_limit: 200,
        p_offset: 0,
      })
      const result = asWrapperStatus(data, error)
      if (result.status !== 'ok' || !Array.isArray(result.questions)) return []
      return result.questions as OpenQuestionRow[]
    },

    async appendOpenQuestion(projectId, question, fieldKey) {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('append_open_question', {
        p_project_id: projectId,
        p_question: question,
        ...(fieldKey === null ? {} : { p_field_key: fieldKey }),
        /*
         * ⚠ `p_impact_note` wird BEWUSST NICHT GESETZT. Delta §3.3 will dort die Einschätzung
         * „ändert das Ergebnis stark/kaum", und die entsteht aus einem Sensitivitätslauf gegen
         * `recommendBattery` — nicht aus einer Vermutung des Modells. Der Lauf braucht einen
         * Lastgang, den der Chat in dieser Fassung noch gar nicht hat. Eine vom Modell erfundene
         * Einschätzung wäre die „erfundene Zahl mit seriösem Etikett", die dieses Projekt sonst
         * überall ablehnt; die Spalte bleibt deshalb leer, bis es die Rechnung dazu gibt.
         */
      })
      return asWrapperStatus(data, error)
    },

    async resolveOpenQuestion(questionId, kind, value, assumptionNote) {
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('resolve_open_question', {
        p_question_id: questionId,
        p_resolution_kind: kind,
        ...(value === null ? {} : { p_resolution_value: value }),
        ...(assumptionNote === null ? {} : { p_assumption_note: assumptionNote }),
      })
      return asWrapperStatus(data, error)
    },

    listDocuments: loadProjectDocuments,

    async readDocument(documentId: string) {
      const document = await readProjectDocument(documentId)
      if (!document.ok) return null
      return {
        bytes: document.bytes,
        filename: document.filename,
        /*
         * ⚠ Der Typ ist eine ANGABE des Kunden (Spaltenkommentar `project_documents.content_type`),
         * kein Beweis. Er entscheidet hier nur, WELCHER Extraktor gefragt wird; ausgeliefert wird
         * nichts, und die Auflage aus dem vorigen Schritt (`Content-Disposition: attachment`)
         * betrifft einen Download-Weg, den es hier nicht gibt.
         */
        contentType: document.contentType,
      }
    },

    async listMeteringPoints(projectId: string): Promise<MeteringPointRow[]> {
      /*
       * ⚠ FAIL CLOSED IM SINN DIESES WERKZEUGS: eine leere Liste heisst für den Ausführer „es gibt
       * keinen Zählpunkt, an den ich schreiben könnte" — und genau das ist bei einem Lesefehler die
       * richtige Folge. Sie deckt sich mit der Antwort des Wrappers auf ein fremdes Projekt
       * (`not_found`), der beides bewusst nicht unterscheidet. Protokolliert wird trotzdem: ein
       * dauerhaft unlesbarer Zählpunkt-Bestand ist von „noch keiner angelegt" sonst nicht zu
       * unterscheiden, und der Kunde bekäme jedes Mal denselben Satz über eine interne Einrichtung.
       */
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('list_metering_points', {
        p_project_id: projectId,
      })
      const result = asWrapperStatus(data, error)

      if (result.status !== 'ok') {
        console.error('[project-chat] Zählpunkte nicht lesbar:', result.status, error)
        return []
      }
      if (!Array.isArray(result.metering_points)) return []

      return (result.metering_points as Record<string, unknown>[])
        .map((row): MeteringPointRow | null => {
          const id = row.id
          if (typeof id !== 'string' || id === '') return null
          return {
            id,
            /*
             * ⚠ `null` und „kein Lastgang eingelesen" sind DIESELBE Aussage und müssen es bleiben.
             * Ein Rückfall auf 15 wäre die naheliegende Bequemlichkeit und behauptete ein
             * Messintervall, das niemand gemessen hat — die Spalte trägt genau deshalb keinen
             * Default (Migration 20260911120000, TEIL 1).
             */
            interval_minutes: typeof row.interval_minutes === 'number' ? row.interval_minutes : null,
            covered_from: typeof row.covered_from === 'string' ? row.covered_from : null,
            covered_to: typeof row.covered_to === 'string' ? row.covered_to : null,
            // `gaps` ist in der Datenbank NOT NULL mit Default `[]`; ein Nicht-Array kann nur aus
            // einem unerwarteten jsonb stammen und wird zur leeren Liste — „keine gemessene Lücke"
            // ist die vorsichtigere der beiden möglichen Falschaussagen.
            gaps: Array.isArray(row.gaps) ? (row.gaps as MeteringPointGap[]) : [],
            source_document_id:
              typeof row.source_document_id === 'string' ? row.source_document_id : null,
            /*
             * `draft` ist `not null default '{}'` mit CHECK auf ein Objekt — der Rückfall ist reine
             * Vorsicht gegen ein unerwartetes jsonb. ⚠ Ein leeres Objekt ist dabei die richtige
             * Notlösung und kein Informationsverlust: „noch nichts erhoben" ist genau das, was ein
             * unlesbarer Entwurf für den Aufrufer bedeuten soll — die Vollständigkeitsprüfung
             * meldet dann alles als fehlend statt eine Angabe zu behaupten.
             */
            draft:
              row.draft !== null && typeof row.draft === 'object' && !Array.isArray(row.draft)
                ? (row.draft as Record<string, unknown>)
                : {},
          }
        })
        .filter((row): row is MeteringPointRow => row !== null)
    },

    async setMeteringPointLoadProfile(
      meteringPointId,
      documentId,
      intervalMinutes,
      coveredFrom,
      coveredTo,
      gaps,
    ) {
      /*
       * Die vier Angaben gehen GEMEINSAM hinaus, weil der Wrapper sie gemeinsam ersetzt: ein
       * Zählpunkt trägt genau EINEN gelesenen Zeitraum, und ein feldweises Nachziehen erzeugte
       * Zwischenstände, in denen `gaps` zu einem anderen Dokument gehörte als `covered_from`.
       *
       * ⚠ `p_gaps` wird IMMER mitgeschickt, auch als leeres Array: der Vorgabewert des Wrappers
       * (`'[]'`) ist derselbe Wert, aber weggelassen sähe „keine Lücke gemessen" wie „dazu wurde
       * nichts gesagt" aus — und der Unterschied ist der ganze Zweck des Feldes.
       */
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('set_metering_point_load_profile', {
        p_metering_point_id: meteringPointId,
        p_source_document_id: documentId,
        p_interval_minutes: intervalMinutes,
        p_covered_from: coveredFrom,
        p_covered_to: coveredTo,
        p_gaps: gaps as unknown as Json,
      })
      return asWrapperStatus(data, error)
    },

    async loadSystemPromptExtension(): Promise<SystemPromptExtension | null> {
      /*
       * ⚠ FAIL OPEN, ABER NICHT STILL. Scheitert der Aufruf, läuft das Gespräch mit dem
       * Kern-Prompt weiter — der trägt das Verhalten allein (Funktionskommentar des Wrappers), und
       * ein gescheiterter Lesevorgang eines admin-gepflegten Textes darf einem Kunden nicht den
       * Chat nehmen. Protokolliert wird er trotzdem: sonst wäre eine dauerhaft unwirksame
       * Erweiterung von einer nie gepflegten nicht zu unterscheiden.
       *
       * `{status: 'none'}` ist dagegen KEIN Fehler und wird nicht protokolliert — es ist der
       * Normalzustand, solange niemand eine Erweiterung eingetragen hat.
       */
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('get_system_prompt_extension')
      const result = asWrapperStatus(data, error)

      if (result.status === 'none') return null
      if (result.status !== 'ok') {
        console.error('[project-chat] System-Prompt-Erweiterung nicht lesbar:', result.status, error)
        return null
      }

      const text = result.extension_text
      if (typeof text !== 'string' || text.trim() === '') return null

      return {
        id: String(result.id),
        text,
        validFrom: String(result.valid_from),
      }
    },

    async listQuestionCatalog(
      segment: ProjectSegment,
      industry: string | null,
    ): Promise<QuestionCatalogRow[]> {
      /*
       * ⚠ FAIL OPEN, ABER NICHT STILL — die Abwägung steht ausführlich an der Port-Definition.
       * Kurz: ein gescheiterter Lesevorgang eines admin-gepflegten Katalogs darf einem Kunden den
       * Chat nicht nehmen; er verschweigt dafür aber Pflichtfragen, und das muss im Log stehen.
       *
       * `p_industry` wird nur mitgeschickt, wenn es eine gibt: `null` und „weggelassen" bedeuten im
       * Wrapper dasselbe (nur die Baseline), der Unterschied soll aber am Aufruf ablesbar sein —
       * dieselbe Schreibweise wie bei `saveProject` darüber.
       */
      const supabase = await createClient()
      const { data, error } = await supabase.rpc('list_question_catalog', {
        p_segment: segment,
        ...(industry === null ? {} : { p_industry: industry }),
      })
      const result = asWrapperStatus(data, error)

      if (result.status !== 'ok') {
        console.error('[project-chat] Fragenkatalog nicht lesbar:', result.status, error)
        return []
      }
      if (!Array.isArray(result.entries)) return []

      /*
       * Eine unvollständige Zeile wird VERWORFEN, nicht gerettet. Die Tabelle lässt sie gar nicht zu
       * (`question_text` ist `not null` mit CHECK gegen den leeren String) — käme trotzdem eine an,
       * wäre sie in `missing` ein Eintrag ohne lesbaren Wortlaut, und das Modell zeigte dem Kunden
       * den technischen Schlüssel. Der Rückfall ist reine Vorsicht gegen ein unerwartetes jsonb.
       */
      return (result.entries as Record<string, unknown>[])
        .map((row): QuestionCatalogRow | null => {
          const questionKey = row.question_key
          const questionText = row.question_text
          const segmentValue = row.segment
          if (typeof questionKey !== 'string' || questionKey === '') return null
          if (typeof questionText !== 'string' || questionText.trim() === '') return null
          if (segmentValue !== 'privat' && segmentValue !== 'betrieb') return null
          return {
            id: String(row.id),
            segment: segmentValue,
            industry: typeof row.industry === 'string' && row.industry !== '' ? row.industry : null,
            question_key: questionKey,
            question_text: questionText,
            // Nur ein echtes `true` ist eine Pflichtfrage — alles andere wäre geraten.
            required: row.required === true,
            valid_from: String(row.valid_from),
          }
        })
        .filter((row): row is QuestionCatalogRow => row !== null)
    },

    extractors,
  }
}
