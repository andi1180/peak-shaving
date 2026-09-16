'use server'

import { revalidatePath } from 'next/cache'
import { MAX_INVOICE_FILE_BYTES, extractInvoiceData } from 'extractors'
import {
  METERING_VARIANTS,
  NETZBETREIBER_DRAFT_KEY,
  NETZEBENEN,
  hasMeteringVariant,
  mergeInvoiceExtractions,
  type InvoiceMergeFieldKey,
} from 'shared'
import { uploadProjectDocument } from '@/lib/project-documents/documents'
import { setDraftField } from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import { lookupGridTariffDefaults } from './grid-tariff-lookup'
import {
  INVOICE_SKIPPED_KEY,
  MAX_INVOICES_PER_UPLOAD,
  draftFieldFor,
  invoiceDraftValues,
  netzebeneDraftValue,
  readStoredInvoiceExtractions,
  withStoredInvoiceExtractions,
  type StoredInvoiceExtraction,
} from './invoice-extractions'
import { readMeteringPointList } from './metering-points'
import { projectDataEntryHref } from './projects'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'
import {
  AUSTRIA_TIME_ZONE,
  FORBIDDEN,
  GENERIC,
  PDF_MEDIA_TYPE,
  UNKNOWN_PROJECT,
  UUID,
  isForbidden,
  readProjectId,
  statusOf,
  writeMeteringPointDraftFields,
} from './data-entry-actions-shared'

// ── Rechnungen ───────────────────────────────────────────────────────────────────────────────────


/**
 * Warum eine einzelne Datei nicht gelesen werden konnte.
 *
 * ── ⚠ DIE FÜNF ERSTEN SIND WORTWÖRTLICH DIE ZUSTÄNDE DES ÖFFENTLICHEN RECHNUNGS-SCANS ─────────
 * `apps/website/components/flow/invoice-scan-panel.tsx` führt dieselbe Liste (`ERROR_TEXT`), und
 * sie wird hier bewusst nicht erweitert oder umbenannt: es ist derselbe Extraktor, dieselben
 * Ausgänge, und zwei Vokabulare für dieselben Zustände liefen beim nächsten Umbau auseinander.
 *
 * ⚠ `upload_failed` IST NEU, und das ist eine benannte Ausweitung. Den Zustand gibt es im
 * öffentlichen Rechner gar nicht — dort wird die Rechnung NIRGENDS abgelegt (Prinzip 4: sie geht an
 * genau einen Empfänger und kommt als Felder zurück). Hier wird sie dem Projekt hinzugefügt, und
 * dieser Schritt kann für sich scheitern. Ihn unter `unavailable` zu führen wäre die bequemere
 * Wahl und eine Falschauskunft: „wir konnten die Rechnung nicht auslesen" schickte den Admin die
 * Datei prüfen, obwohl das Auslesen gar nicht stattgefunden hat.
 */
type InvoiceFileFailure = 'no_file' | 'wrong_type' | 'too_large' | 'not_configured' | 'unreadable' | 'unavailable' | 'upload_failed'

/**
 * Der Grund je Datei, in einem Satz.
 *
 * ── ⚠ KÜRZER ALS IM ÖFFENTLICHEN RECHNER, UND ZWEIMAL AUCH ANDERS ─────────────────────────────
 * Dort steht je Zustand ein eigener Absatz unter der Dropzone — hier stehen bis zu zwölf Gründe
 * nebeneinander in EINER Zeile, und ein Absatz je Datei wäre unlesbar. Die Aussage ist dieselbe,
 * der Satzbau knapper.
 *
 * Zwei Texte weichen inhaltlich ab, und beide, weil der dortige eine Oberfläche nennt, die es hier
 * nicht gibt: `wrong_type` und `unreadable` verweisen im Rechner auf „einen der anderen beiden
 * Einstiege". Im Wizard gibt es die nicht; der Verweis wäre eine Anweisung ins Leere.
 */
const INVOICE_FAILURE_TEXT: Record<InvoiceFileFailure, string> = {
  no_file: 'Die Datei scheint leer zu sein.',
  wrong_type:
    'Nur PDF — ein Foto oder Screenshot der Rechnung lässt sich nicht auslesen.',
  too_large: `Grösser als ${Math.floor(MAX_INVOICE_FILE_BYTES / (1024 * 1024))} MB. Eine Rechnung von ein bis wenigen Seiten liegt normalerweise weit darunter.`,
  not_configured: 'Das Auslesen von Rechnungen ist auf diesem Server nicht eingerichtet.',
  unreadable:
    'Auf diesem Dokument war keine der gesuchten Angaben zu finden — das kann an der Bildqualität liegen, aber auch daran, dass es keine Strom- oder Netzrechnung ist.',
  unavailable: 'Das Auslesen ist fehlgeschlagen. Bitte später noch einmal versuchen.',
  upload_failed:
    'Die Datei liess sich nicht in der Ablage des Projekts speichern; sie wurde deshalb gar nicht erst ausgelesen.',
}

/** Das Ergebnis einer einzelnen Datei — gelesen, oder benannt gescheitert. */
type InvoiceFileResult =
  | { ok: true; entry: StoredInvoiceExtraction }
  | { ok: false; filename: string; reason: InvoiceFileFailure }
  /** Das Projekt gibt es nicht (mehr) — kein Fall EINER Datei, sondern das Ende des Vorgangs. */
  | { ok: false; filename: string; reason: 'project_gone' }

/**
 * Liest beliebig viele Rechnungen ein und schreibt den zusammengeführten Stand in den Entwurf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER AUFRUF IST WIEDERHOLBAR — ER ERGÄNZT, ER ERSETZT NICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bereits gelesene Rechnungen bleiben stehen; die neuen kommen dazu, und zusammengeführt wird über
 * ALLE. Ausgelesen (und damit bezahlt) werden ausschliesslich die Dateien DIESES Vorgangs — die
 * bestehenden Extraktionen liegen fertig im Entwurf und werden von dort gelesen.
 *
 * Das ist der Unterschied zur Lastgang-Station nebenan: dort trägt ein Zählpunkt genau EINEN
 * Lastgang, und eine zweite Datei ersetzt die erste (über den ausdrücklichen Rückweg). Eine
 * Rechnung ist dagegen ein Beleg unter mehreren, und zwölf Monatsrechnungen sind zwölf gleichwertige
 * Belege desselben Anschlusses.
 *
 * ── ⚠ DIE REIHENFOLGE IST UMGEKEHRT ZUM LASTGANG: ERST ABLEGEN, DANN LESEN ────────────────────
 *   1. Typ und Grösse prüfen (rein, kein Netz, kein Geld)
 *   2. `uploadProjectDocument` — Bytes + Zeile in `platform.project_documents`
 *   3. `extractInvoiceData` — der abrechenbare Modellaufruf
 *
 * Beim Lastgang gilt ausdrücklich das Gegenteil („erst lesen, dann ablegen"), und die Abweichung
 * ist bewusst: dort ist eine unlesbare Datei WERTLOS — sie hinterliesse nur eine Zeile in der
 * Dokumentenliste, die zu keinem Zählpunkt gehört. Eine Rechnung, die der Scan nicht lesen konnte,
 * ist dagegen nicht wertlos: es ist die echte Rechnung des Kunden, ein Mensch kann sie lesen, und
 * der KI-Check (Schritt 3) sieht die Dokumente des Projekts. Sie gehört also ohnehin ins Projekt.
 * Dazu kommt der praktische Grund: der Eintrag im Entwurf trägt die Dokument-Kennung, und die gibt
 * es erst nach dem Ablegen.
 *
 * ⚠ WAS DABEI STEHEN BLEIBEN KANN, ist deshalb ein ABGELEGTES Dokument ohne Eintrag im Entwurf —
 * bei einem gescheiterten Scan, und ebenso, wenn der Schreibvorgang am Ende scheitert. Das ist die
 * harmlose Richtung: eine Rechnung zu viel in der Dokumentenliste, nicht eine Angabe im Entwurf,
 * die auf nichts zeigt.
 *
 * ── EINE GESCHEITERTE DATEI BRICHT DEN VORGANG NICHT AB ───────────────────────────────────────
 * Wer zwölf Rechnungen ablegt und bei der siebten einen Scan-Fehler bekommt, soll nicht die
 * übrigen elf noch einmal hochladen (und noch einmal bezahlen). Die lesbaren werden verarbeitet,
 * die gescheiterte wird NAMENTLICH mit ihrem Grund gemeldet.
 *
 * ── ⚠ DIE DATEIEN LAUFEN NEBENLÄUFIG ──────────────────────────────────────────────────────────
 * Nacheinander wäre die Wanduhr-Zeit die SUMME der Scans (zwölf mal rund zehn Sekunden), und der
 * Vorgang liefe in die Zeitgrenze der Plattform, bevor er fertig ist (`maxDuration` der Seite: 60 s).
 * Es gibt hier auch nichts zu serialisieren: jede Datei ist unabhängig, und der Entwurf wird
 * EINMAL am Ende geschrieben — anders als im Chat-Ausführer, wo zwei nebenläufige
 * `set_draft_field` einander überschrieben (dort ausführlich begründet).
 * Der Preis ist ein Stoss von bis zu zwölf gleichzeitigen Modellaufrufen; läuft einer davon in
 * eine Frequenzgrenze, wird er als `unavailable` gemeldet und lässt sich einzeln nachreichen.
 *
 * ⚠ ES WIRD NICHT UMGELEITET, aus demselben Grund wie beim Lastgang: die zusammengeführten Werte
 * und ein etwaiger Widerspruch sind das Einzige, woran ein Mensch erkennt, ob die richtigen
 * Rechnungen gelesen wurden.
 */
export async function uploadMeteringPointInvoicesAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) {
    // Kommt wie die Projekt-Kennung als verstecktes Feld aus unserer eigenen Seite.
    return { formError: GENERIC }
  }

  /*
   * ⚠ Ein leeres Mehrfach-Dateifeld schickt dennoch EINEN Eintrag mit leerem Namen und Grösse 0.
   * Ohne diesen Filter liefe der Vorgang mit „einer" Datei los und meldete `no_file` als
   * Teilfehlschlag, statt zu sagen, dass gar nichts ausgewählt wurde.
   */
  const files = formData
    .getAll('files')
    .filter((value): value is File => value instanceof File && value.size > 0)

  if (files.length === 0) {
    return { fieldErrors: { files: 'Bitte mindestens eine PDF-Rechnung auswählen.' } }
  }
  if (files.length > MAX_INVOICES_PER_UPLOAD) {
    return {
      fieldErrors: {
        files:
          `Höchstens ${MAX_INVOICES_PER_UPLOAD} Rechnungen pro Vorgang — ausgewählt waren ` +
          `${files.length}. Es wurde nichts hochgeladen und nichts gespeichert; die übrigen ` +
          `können Sie anschliessend in einem zweiten Vorgang hinzufügen.`,
      },
    }
  }

  const results = await Promise.all(files.map((file) => readOneInvoice(projectId, file)))

  /*
   * Das Projekt ist weg — dann kann keine der Dateien angekommen sein, und ein Teilerfolg wäre
   * eine Behauptung. Ein eigener Ausgang statt eines Datei-Grundes: es ist kein Problem DIESER
   * Datei.
   */
  if (results.some((result) => !result.ok && result.reason === 'project_gone')) {
    return { formError: UNKNOWN_PROJECT }
  }

  const read = results.filter((result): result is Extract<InvoiceFileResult, { ok: true }> => result.ok)
  const failed = results.filter((result) => !result.ok)

  const failureText =
    failed.length === 0
      ? null
      : failed
          .map((result) =>
            result.ok
              ? ''
              : `„${result.filename}": ${INVOICE_FAILURE_TEXT[result.reason as InvoiceFileFailure]}`,
          )
          .join(' · ')

  if (read.length === 0) {
    // Nichts zu speichern. Der Entwurf wird gar nicht erst gelesen — es gäbe nichts zu ändern.
    return { fieldErrors: { files: failureText ?? GENERIC } }
  }

  /*
   * ⚠ DER ENTWURF WIRD FRISCH GELESEN, NICHT AUS EINER PROP ÜBERNOMMEN — und zwar HIER, nach den
   * Scans: `update_metering_point_draft` ERSETZT ihn, und ein Stand von vor mehreren Sekunden
   * Modellaufruf machte jede Angabe rückgängig, die inzwischen dazugekommen ist (wortgleiche
   * Begründung wie beim Standardprofil-Zweig).
   */
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Rechnungen):', listRes.error)
    return { formError: GENERIC }
  }

  const points = readMeteringPointList(listRes.data)
  const point = points?.find((candidate) => candidate.id === meteringPointId)
  if (!point) {
    return {
      formError:
        'Diesen Zählpunkt gibt es nicht (mehr). Die Rechnungen sind im Projekt abgelegt, aber ' +
        'keinem Zählpunkt zugeordnet. Bitte laden Sie die Seite neu.',
    }
  }

  const stored = readStoredInvoiceExtractions(point.draft)
  const all = [...stored, ...read.map((result) => result.entry)]
  const { merged, conflicts } = mergeInvoiceExtractions(all.map((entry) => entry.extraction))

  /*
   * ⚠ EIN EINZIGER SCHREIBVORGANG. Der Seiteneintrag und die übernommenen Werte gehören zusammen:
   * die Werte sind die Auswertung genau dieser Liste. Getrennt geschrieben gäbe es einen Zustand,
   * in dem der Entwurf Werte trägt, deren Belege fehlen (oder umgekehrt) — und `update_metering_point_draft`
   * ERSETZT ohnehin, ein zweiter Aufruf müsste also den ersten mitführen.
   */
  let nextDraft = withStoredInvoiceExtractions(point.draft, all)
  const now = new Date()
  for (const { field, value } of invoiceDraftValues(merged)) {
    /*
     * `measured`: jeder dieser Werte steht auf einer Rechnung, und zwar übereinstimmend auf allen,
     * die etwas dazu sagen. Widersprüchliche Felder kommen hier gar nicht an (`mergeInvoiceExtractions`
     * setzt sie auf `null`) — s. `invoiceDraftValues`. Eine Notiz gibt es nicht: sie ist für
     * SCHÄTZUNGEN da („geschätzt aus 3 Personen"), und eine Ablesung braucht keine Begründung.
     */
    nextDraft = setDraftField(nextDraft, field, value, 'measured', undefined, now)
  }

  /*
   * ⚠ EIN ECHTER UPLOAD WIDERLEGT EIN FRÜHERES „ohne Rechnungsdaten fortgefahren" — deshalb wird
   * das Signal hier ausdrücklich auf `false` gesetzt und nicht bloss stehen gelassen.
   *
   * Ohne diese Zeile stünden ZWEI Aussagen gleichzeitig im Entwurf: „es gibt bewusst keine
   * Tarifangabe für diesen Zählpunkt" und eine gelesene Rechnung mit genau diesen Angaben. Ein
   * späterer Leser (Tarif-Station, Report) müsste raten, welche gilt — und die falsche Antwort
   * wäre die teure: eine Analyse, die den Kostenvergleich weglässt, obwohl die Werte vorliegen.
   *
   * ⚠ Es steht IM SELBEN Schreibvorgang, nicht daneben: `update_metering_point_draft` ERSETZT den
   * Entwurf; ein zweiter Aufruf gäbe es ein Fenster, in dem genau der widersprüchliche Stand von
   * oben gespeichert ist.
   *
   * ⚠ ABWEICHUNG VON DER AUFTRAGSFORMULIERUNG, offengelegt: der Auftrag nannte
   * `writeMeteringPointDraftFields`. Diese Action ruft den Helfer NICHT — sie liest den Entwurf
   * selbst, weil sie zusätzlich `withStoredInvoiceExtractions` anwenden muss (den Seiteneintrag
   * kann der Helfer nicht schreiben). Die Sache ist dieselbe: EIN Schreibvorgang, dieselbe
   * Herkunft `measured`, derselbe Zeitstempel.
   */
  nextDraft = setDraftField(nextDraft, INVOICE_SKIPPED_KEY, false, 'measured', undefined, now)

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie im Standardprofil-Zweig: zur Laufzeit dasselbe, TypeScript kann es nur nicht wissen.
    p_draft: nextDraft as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_metering_point_draft (Rechnungen):', draftRes.error)
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Rechnungen):', draftRes.data)
    return { formError: GENERIC }
  }

  // ⚠ Ohne das bliebe die Zusammenfassung unsichtbar — s. die Begründung beim Lastgang-Upload.
  revalidatePath(projectDataEntryHref(projectId))

  const gelesen =
    read.length === 1 ? 'Eine Rechnung gelesen' : `${read.length} Rechnungen gelesen`
  const gesamt =
    all.length === 1
      ? 'Es liegt jetzt eine Rechnung an diesem Zählpunkt.'
      : `Es liegen jetzt ${all.length} Rechnungen an diesem Zählpunkt.`
  const widerspruch =
    conflicts.length === 0
      ? ''
      : ' Einzelne Angaben widersprechen einander — sie stehen unten und wurden NICHT übernommen.'

  return {
    success: `${gelesen}. ${gesamt}${widerspruch}`,
    ...(failureText ? { fieldErrors: { files: failureText } } : {}),
  }
}

/**
 * Eine einzelne Datei: prüfen, ablegen, auslesen.
 *
 * Wirft nie — jeder Ausgang ist ein benanntes Ergebnis. Ein Wurf aus einer der zwölf nebenläufigen
 * Ketten liesse `Promise.all` scheitern und nähme die anderen elf mit, obwohl sie längst gelesen
 * (und bezahlt) sind.
 */
async function readOneInvoice(projectId: string, file: File): Promise<InvoiceFileResult> {
  const filename = file.name.trim() === '' ? 'Unbenannte Datei' : file.name

  // ── Schritt 1: prüfen. Rein, vor jedem Netzweg und vor jedem abrechenbaren Aufruf.
  if (file.size === 0) return { ok: false, filename, reason: 'no_file' }
  /*
   * Der Medientyp kommt vom Browser und ist kein Beweis — die eigentliche Sperre ist, dass die API
   * den `document`-Block mit genau diesem Typ erwartet. Diese Prüfung fängt den ehrlichen Irrtum
   * ab, bevor er Geld kostet (wortgleich zur Begründung in `apps/website/lib/invoice-scan/actions.ts`).
   */
  if (file.type !== PDF_MEDIA_TYPE) return { ok: false, filename, reason: 'wrong_type' }
  if (file.size > MAX_INVOICE_FILE_BYTES) return { ok: false, filename, reason: 'too_large' }

  const bytes = await file.arrayBuffer()

  // ── Schritt 2: ablegen. Die Eigentumsfrage beantwortet dabei die DATENBANK (`get_project`).
  const upload = await uploadProjectDocument(projectId, {
    name: file.name,
    // Hier steht der Typ fest — die Prüfung oben lässt nur PDF durch.
    type: PDF_MEDIA_TYPE,
    bytes,
  })

  if (!upload.ok) {
    if (upload.reason === 'not_found') return { ok: false, filename, reason: 'project_gone' }
    console.error('[admin/dateneingabe] uploadProjectDocument (Rechnung):', upload.reason)
    return { ok: false, filename, reason: 'upload_failed' }
  }

  // ── Schritt 3: auslesen. Der einzige abrechenbare Aufruf dieser Kette.
  const outcome = await extractInvoiceData(Buffer.from(bytes).toString('base64'))

  if (!outcome.ok) {
    /*
     * `not_configured` und `unreadable` reisen als eigene Zustände weiter — „noch nicht
     * eingerichtet" ist kein Fehler der Datei, „darauf war nichts zu finden" keiner der Technik.
     * `api_error` wird zu `unavailable`: was genau schiefging, gehört ins Log, nicht in die
     * Oberfläche.
     */
    if (outcome.reason === 'not_configured') return { ok: false, filename, reason: 'not_configured' }
    if (outcome.reason === 'unreadable') return { ok: false, filename, reason: 'unreadable' }
    return { ok: false, filename, reason: 'unavailable' }
  }

  return {
    ok: true,
    entry: { documentId: upload.documentId, filename, extraction: outcome.extraction },
  }
}

/**
 * Nimmt EINE gelesene Rechnung von einem Zählpunkt zurück und führt die verbliebenen neu zusammen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ES WIRD WEDER DIE DATEI NOCH IHRE ZEILE GELÖSCHT — nur der Bezug im Entwurf entfällt
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das ist der Unterschied zum Lastgang-Rückweg nebenan, und er ist bewusst: dort trägt der
 * ZÄHLPUNKT die Quelle (`source_document_id`), ein zurückgesetzter Zählpunkt liesse das Dokument
 * also an nichts mehr hängen — deshalb räumt er Bytes und Zeile mit ab. Eine Rechnung dagegen
 * gehört dem PROJEKT: sie ist die echte Rechnung des Kunden, ein Mensch kann sie lesen, und der
 * KI-Check (Station 6) sieht die Dokumente des Projekts. Was hier zurückgenommen wird, ist
 * ausschliesslich die Aussage „aus diesem Beleg wurde für diesen Zählpunkt gelesen".
 *
 * Folge, die der Klickende erfahren muss und die deshalb in der Erfolgsmeldung steht: die Datei
 * bleibt in der Dokumentenliste des Projekts stehen. Ein Löschweg für Projekt-Dokumente ist ein
 * eigener Auftrag — der bestehende (`admin_delete_metering_point_document`) ist an den ZÄHLPUNKT
 * gebunden und verlangt, dass keiner mehr auf das Dokument zeigt.
 *
 * ── ⚠ ES WIRD NICHTS AUFGERÄUMT, WAS AUF DER ENTFERNTEN RECHNUNG BERUHTE ──────────────────────
 * Ein Entwurfsfeld, dessen einzige Stütze dieser Beleg war, bleibt STEHEN. Das ist exakt dieselbe
 * Richtung wie bei einem Widerspruch (s. `invoiceDraftValues`) und aus demselben Grund: der Wert
 * kann inzwischen von Hand geprüft oder korrigiert worden sein, und ihn beim Entfernen eines
 * Belegs still zu leeren nähme eine Angabe weg, die niemand weggenommen haben wollte. Die
 * schonendere Richtung ist, ihn stehen zu lassen — sichtbar in der Zusammenfassung, überschreibbar
 * im Tarif-Schritt.
 *
 * ⚠ WAS SICH SEHR WOHL ÄNDERN KANN, ist ein Feld, das VORHER WIDERSPRÜCHLICH war: fällt der
 * abweichende Beleg weg, sind sich die verbliebenen einig, und der Wert wird jetzt übernommen.
 * Genau dafür läuft die Zusammenführung überhaupt erneut — ohne sie bliebe ein aufgelöster
 * Widerspruch für immer ungelöst.
 *
 * ── DER ABLAUF, und er ist absichtlich kürzer als der des Uploads ─────────────────────────────
 *   1. Entwurf FRISCH lesen (`list_metering_points`) — `update_metering_point_draft` ERSETZT ihn
 *   2. den Eintrag mit dieser Dokument-Kennung herausfiltern
 *   3. `mergeInvoiceExtractions` über die VERBLIEBENEN
 *   4. EIN `update_metering_point_draft` mit der gekürzten Liste UND den neu gefalteten Werten
 *
 * Es gibt hier keinen Netzweg und keinen Modellaufruf: die verbliebenen Extraktionen liegen fertig
 * im Entwurf. Der eine Schreibvorgang trägt beides zusammen, aus demselben Grund wie beim Upload —
 * getrennt geschrieben gäbe es einen Zustand, in dem die Werte zu einer anderen Belegliste gehören
 * als die, die danebensteht.
 */
export async function removeMeteringPointInvoiceAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) {
    // Kommt wie die Projekt-Kennung als verstecktes Feld aus unserer eigenen Seite.
    return { formError: GENERIC }
  }

  /*
   * ⚠ ABSICHTLICH KEINE UUID-PRÜFUNG. Die Kennung wird nicht an die Datenbank gereicht, sondern
   * ausschliesslich gegen die gespeicherte Liste gehalten — sie kommt aus genau dieser Liste, in
   * die die Oberfläche sie gerendert hat. Ein Format-Filter wäre hier keine zusätzliche Sicherheit,
   * sondern eine Sperre: ein von Hand verändertes `jsonb` mit einer unbrauchbaren Kennung liesse
   * sich dann gar nicht mehr aufräumen. Das Tor ist der Abgleich unten, nicht die Form.
   */
  const documentId = String(formData.get('documentId') ?? '').trim()
  if (documentId === '') return { formError: GENERIC }

  /*
   * ⚠ FRISCH GELESEN, nicht aus einer Prop übernommen — wortgleiche Begründung wie beim Upload und
   * beim Standardprofil-Zweig: der Wrapper ERSETZT den Entwurf, und ein Stand aus der Zeit des
   * Seitenaufbaus machte jede Angabe rückgängig, die inzwischen dazugekommen ist. Hier trifft das
   * besonders wahrscheinlich zu: zwischen dem Rendern der Liste und dem Klick kann in einem zweiten
   * Tab eine weitere Rechnung hochgeladen worden sein.
   */
  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Rechnung entfernen):', listRes.error)
    return { formError: GENERIC }
  }

  const points = readMeteringPointList(listRes.data)
  const point = points?.find((candidate) => candidate.id === meteringPointId)
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }

  const stored = readStoredInvoiceExtractions(point.draft)
  const removed = stored.find((entry) => entry.documentId === documentId)
  if (!removed) {
    /*
     * Der Eintrag ist bereits weg — zweiter Klick, zweiter Tab. Es wird NICHTS geschrieben: das
     * Ziel ist hergestellt, und ein Schreibvorgang über eine unveränderte Liste wäre eine
     * Änderung, die keine ist.
     *
     * ⚠ Die Station wird trotzdem NEU GERENDERT, und das weicht bewusst vom `not_found`-Zweig des
     * Lastgang-Rückwegs ab: dort ist der ganze Zählpunkt weg und die Station ohnehin hinfällig.
     * Hier ist allein die angezeigte LISTE veraltet — sie zeigt einen Beleg, den es nicht mehr
     * gibt. Ohne das Neurendern bliebe sie stehen, und derselbe Klick liefe beliebig oft in
     * dieselbe Meldung. Behauptet wird damit nichts: gerendert wird der Stand der Datenbank.
     */
    revalidatePath(projectDataEntryHref(projectId))
    return {
      formError:
        'Diese Rechnung liegt nicht (mehr) an diesem Zählpunkt — möglicherweise wurde sie bereits ' +
        'entfernt. Die Liste ist jetzt auf dem aktuellen Stand.',
    }
  }

  const remaining = stored.filter((entry) => entry.documentId !== documentId)
  const { merged, conflicts } = mergeInvoiceExtractions(remaining.map((entry) => entry.extraction))

  /*
   * ⚠ Die Werte werden NEU GEFALTET, nicht bloss die Liste gekürzt. Für ein unverändertes Feld ist
   * das ein Schreibvorgang mit demselben Wert (nur der Herkunftsvermerk trägt einen neuen
   * Zeitstempel — er sagt „zuletzt so gesetzt", und das stimmt dann auch); für ein zuvor
   * widersprüchliches Feld ist es die eigentliche Wirkung dieses Aufrufs.
   *
   * `measured` und ohne Notiz, wortgleich zum Upload: jeder dieser Werte steht übereinstimmend auf
   * den verbliebenen Rechnungen, und eine Ablesung braucht keine Begründung.
   */
  let nextDraft = withStoredInvoiceExtractions(point.draft, remaining)
  const now = new Date()
  for (const { field, value } of invoiceDraftValues(merged)) {
    nextDraft = setDraftField(nextDraft, field, value, 'measured', undefined, now)
  }

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie im Upload-Zweig: zur Laufzeit dasselbe, TypeScript kann es nur nicht wissen.
    p_draft: nextDraft as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error(
      '[admin/dateneingabe] update_metering_point_draft (Rechnung entfernen):',
      draftRes.error,
    )
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Rechnung entfernen):', draftRes.data)
    return { formError: GENERIC }
  }

  // ⚠ Ohne das bliebe die entfernte Rechnung in der Liste stehen — s. Begründung beim Upload.
  revalidatePath(projectDataEntryHref(projectId))

  const rest =
    remaining.length === 0
      ? 'An diesem Zählpunkt liegt jetzt keine gelesene Rechnung mehr.'
      : remaining.length === 1
        ? 'Es liegt jetzt eine Rechnung an diesem Zählpunkt.'
        : `Es liegen jetzt ${remaining.length} Rechnungen an diesem Zählpunkt.`
  const widerspruch =
    conflicts.length === 0
      ? ''
      : ' Einzelne Angaben widersprechen einander weiterhin — sie stehen unten.'

  return {
    success:
      `„${removed.filename}" wird für diesen Zählpunkt nicht mehr ausgewertet. ${rest}` +
      `${widerspruch} Bereits übernommene Angaben bleiben stehen, und die Datei bleibt in der ` +
      'Dokumentenliste des Projekts.',
  }
}

// ── Rechnung: bewusst ohne ─────────────────────────────────────────────────────────────────────
/**
 * „Ohne Rechnung fortfahren" — der DRITTE Weg der Station, neben Upload und Eintippen.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM ES DAFÜR EINE EIGENE ACTION BRAUCHT, OBWOHL SIE NICHTS ERFASST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie schreibt genau EIN Feld, und der Wert dieses Feldes ist eine ENTSCHEIDUNG, keine Angabe:
 * „für diesen Zählpunkt gibt es bewusst keine Tarifdaten". Ohne sie ist dieser Fall von „die
 * Station wurde noch nicht besucht" nicht zu unterscheiden — beide sähen im Entwurf identisch aus
 * (kein `_invoiceExtractions`, keine Tarifwerte), und der Wizard stellte dieselbe Frage bei jedem
 * Aufruf erneut. Die ausführliche Begründung samt Gegenüberstellung steht bei `INVOICE_SKIPPED_KEY`
 * (`invoice-extractions.ts`); hier steht nur, was daraus für den Schreibweg folgt.
 *
 * Der Rahmen ist der der Nachbar-Actions (`saveMeteringPointTariffComparisonAction`,
 * `saveMeteringPointBatteryAction`): Kennungen prüfen, `writeMeteringPointDraftFields`, fertig.
 * Ein eigener `list_metering_points` → `setDraftField` → `update_metering_point_draft`-Rahmen wie
 * oben wäre hier ein Nachbau ohne Anlass — der Helfer deckt genau diesen Fall ab (ein Feld, keine
 * Seiteneinträge), und sein Rahmen ist derselbe: frisch lesen, EINMAL schreiben, neu rendern.
 */
export async function skipMeteringPointInvoiceAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  /*
   * `true`, nicht das Fehlen des Feldes: die Aussage ist positiv gemeint. `writeMeteringPointDraftFields`
   * vermerkt sie als `measured` — dieselbe Herkunft wie jede andere Angabe des Kunden, denn „es gibt
   * keine Rechnung" ist eine Auskunft und keine Schätzung von uns.
   */
  const failure = await writeMeteringPointDraftFields(
    projectId,
    meteringPointId,
    [{ field: INVOICE_SKIPPED_KEY, value: true }],
    'Rechnung übersprungen',
  )
  if (failure) return failure

  return {
    success:
      'Vermerkt: ohne Rechnungsdaten fortgefahren. Die Analyse rechnet auf Basis des Lastgangs ' +
      'und ohne Kostenvergleich.',
  }
}

// ── Rechnung: Tarifwerte von Hand ────────────────────────────────────────────────────────────────
/**
 * ⚠ DIE ZWEI FOLGENDEN ACTIONS GEHÖREN DEMSELBEN FORMULAR.
 *
 * (Hier stand eine Gesamtzahl der Actions. Sie war beim Schreiben richtig und ist es seit dem
 * dritten weiteren Bauschritt nicht mehr — eine Zahl, die bei jeder neuen Station nachzuziehen
 * wäre, sagt weniger als das, worauf es ankommt: welche Actions zusammengehören.)
 *
 * Die Rechnung-Station beantwortet bislang genau eine Frage: „PDF da? Dann lese ich sie aus." Der
 * reale Fall daneben ist der Kunde, der am Telefon vorliest — dann gibt es nichts hochzuladen, und
 * die Station endete bisher in einer Sackgasse. Die zwei Actions schliessen sie:
 *
 *   `lookupGridTariffDefaultsAction`      SCHLÄGT VOR  — liest das Preisblatt, schreibt NICHTS
 *   `saveMeteringPointManualTariffAction` SPEICHERT    — faltet die eingetippten Werte in den Entwurf
 *
 * ⚠ DIE TRENNUNG IST DER ENTWURF, NICHT SEINE ZERLEGUNG. Ein Vorschlag, der selbst schriebe, wäre
 * im Entwurf von einer abgelesenen Angabe nicht mehr zu unterscheiden — er trüge dieselbe Herkunft
 * (`measured`) und denselben Zeitstempel. Der Leistungspreis aus unserer Tabelle ist aber kein
 * Messwert des Kunden, sondern der gepflegte Satz seines Netzbetreibers; er landet deshalb als
 * FELDINHALT im Formular, und ob er in den Entwurf geht, entscheidet derselbe Klick wie bei jedem
 * anderen Feld. Prinzip 1 bleibt damit unangetastet: die Rechnung schlägt die Tabelle.
 */

/** Der Kalendertag in Ortszeit als 'YYYY-MM-DD' — `en-CA` liefert genau dieses Format. */
function austriaCalendarDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AUSTRIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

/**
 * Der Stichtag, gegen den die effektiv datierte Preisblatt-Zeile ausgewählt wird.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ORTSZEIT, NICHT UTC — sonst trifft der Lookup am Jahreswechsel das falsche Preisblatt
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `coveredFrom` ist ein ISO/UTC-Zeitstempel, und ein österreichischer Kalenderjahr-Lastgang beginnt
 * bei `2024-12-31T23:00:00Z` — das ist der 1. Jänner 2025 in Wien. Als UTC-Datum gelesen ergäbe das
 * `2024-12-31`, also den letzten Tag des VORJAHRES: `findGridTariffRow` wählte die alte Tarifzeile,
 * und der vorgeschlagene Leistungspreis wäre der des Vorjahrs. Nichts daran sähe nach einem Fehler
 * aus — es stünde eine plausible Zahl im Feld. Dieselbe Fehlerklasse, die `analysis-window.ts`
 * (Regel B) für den Rechner beschreibt.
 *
 * Ohne Lastgang-Zeitraum gilt HEUTE. Das ist die ehrlichere Annahme als ein erfundenes Datum: wer
 * ohne Verbrauchsgrundlage Tarifwerte einträgt, meint den heute gültigen Stand.
 */
function tariffStichtag(coveredFrom: string | null, now: Date): string {
  if (coveredFrom !== null) {
    const parsed = new Date(coveredFrom)
    if (!Number.isNaN(parsed.getTime())) return austriaCalendarDate(parsed)
  }
  return austriaCalendarDate(now)
}

/**
 * Liest den Netzebenen-Wert eines Auswahlfelds — `null`, wenn er keine geführte Netzebene ist.
 * Der Wert kommt aus einem `<select>` mit genau diesen Optionen; die Prüfung fängt den Aufruf
 * daneben ab, damit die Datenbank nicht mit einer erfundenen Zahl befragt wird.
 */
function readNetzebene(formData: FormData, field: string): number | null {
  const raw = String(formData.get(field) ?? '').trim()
  if (raw === '') return null
  const value = Number(raw)
  return (NETZEBENEN as readonly number[]).includes(value) ? value : null
}

/**
 * Liest die Messvariante — `null` heisst „keine angegeben", was auf NE 3–6 der RICHTIGE Wert ist
 * (`unique nulls not distinct`, B21-1). Ein unbekannter Wert wird ebenfalls zu `null`; er kann nur
 * von einem Aufruf neben dem Auswahlfeld stammen, und geraten wird nicht.
 */
function readMeteringVariant(formData: FormData, field: string): string | null {
  const raw = String(formData.get(field) ?? '').trim()
  if (raw === '') return null
  return (METERING_VARIANTS as readonly string[]).includes(raw) ? raw : null
}

const MANUAL_TARIFF_NOT_FOUND =
  'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.'

/**
 * Schlägt Leistungspreis und Mindest-kW aus dem gepflegten Preisblatt vor.
 *
 * ⚠ SCHREIBT NICHTS. Die Antwort geht als `values` an das Formular zurück — derselbe Slot, über den
 * jede Admin-Action ihre „zur Wiederanzeige mitgeführten Eingabewerte" zurückgibt (`AdminState`).
 * Ein eigener Rückgabetyp wäre ein zweites Zustandsformat für denselben Zweck.
 *
 * `values.lookup` trägt den Ausgang (`ok` / `none`), damit das Formular „noch nicht gefragt" von
 * „gefragt, nichts hinterlegt" unterscheiden kann. Ohne diesen Marker wären beide Zustände ein
 * leeres `values` — und die Oberfläche müsste schweigen, wo sie eine Auskunft schuldet.
 *
 * ⚠ EIN LEERES ERGEBNIS IST KEIN FEHLER. „Für diese Kombination ist kein Preisblatt hinterlegt" ist
 * eine zulässige Antwort (B21-1: der Bestand ist gepflegt, nicht vollständig); als `formError`
 * gemeldet sähe ein Pflegestand wie ein Defekt aus, und der Admin suchte den Fehler bei sich.
 */
export async function lookupGridTariffDefaultsAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  /*
   * ⚠ KEINE Prüfung gegen eine feste Betreiberliste. `grid_tariffs.operator_id` ist bewusst ohne
   * Fremdschlüssel und ohne CHECK gebaut (B21-1), und die gepflegten Kennungen wachsen mit dem
   * Bestand — eine hier ausgeschriebene Liste wäre ein zweiter Ort, an dem ein neuer Netzbetreiber
   * nachzutragen wäre, und ihn zu vergessen sähe aus wie ein fehlendes Preisblatt. Eine unbekannte
   * Kennung liefert schlicht keine Zeile, also dieselbe ehrliche Antwort wie eine ungepflegte.
   */
  const operatorId = String(formData.get('operatorId') ?? '').trim()
  if (operatorId === '') {
    return { fieldErrors: { operatorId: 'Bitte den Netzbetreiber wählen.' } }
  }

  const netzebene = readNetzebene(formData, 'netzebene')
  if (netzebene === null) {
    return { fieldErrors: { netzebene: 'Bitte die Netzebene wählen.' } }
  }

  /*
   * ⚠ Auf Netzebene 7 ist die Variante PFLICHT, sonst gibt es sie gar nicht. Das Preisblatt führt
   * dort DREI Zeilen (mit Leistungsmessung · ohne · unterbrechbar) mit sehr verschiedenen Sätzen —
   * ohne Angabe kämen alle drei zurück, und welcher Wert vorgeschlagen wird, entschiede die
   * Sortierreihenfolge der Abfrage. Auf NE 3–6 wird eine mitgeschickte Variante dagegen VERWORFEN:
   * dort gehört `null` in die Spalte, und ein Wert daneben fände die gepflegte Zeile nie.
   */
  const variantApplies = hasMeteringVariant(netzebene)
  const meteringVariant = variantApplies ? readMeteringVariant(formData, 'meteringVariant') : null
  if (variantApplies && meteringVariant === null) {
    return {
      fieldErrors: {
        meteringVariant: 'Auf Netzebene 7 hängt der Leistungspreis an der Messvariante.',
      },
    }
  }

  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Tarif-Lookup):', listRes.error)
    return { formError: GENERIC }
  }

  const point = readMeteringPointList(listRes.data)?.find(
    (candidate) => candidate.id === meteringPointId,
  )
  if (!point) return { formError: MANUAL_TARIFF_NOT_FOUND }

  const stichtag = tariffStichtag(point.coveredFrom, new Date())

  let defaults
  try {
    defaults = await lookupGridTariffDefaults(supabase, {
      operatorId,
      netzebene,
      meteringVariant,
      stichtag,
    })
  } catch (error) {
    /*
     * `lookupGridTariffDefaults` wirft ausschliesslich bei einem Datenbankfehler — „wir konnten
     * nicht nachsehen" ist eine andere Aussage als „es ist nichts hinterlegt" und wird deshalb
     * auch anders gemeldet. Als leeres Ergebnis durchgereicht behauptete ein Ausfall eine
     * Fehlanzeige im Preisblatt, und jemand trüge Werte von Hand nach, die längst gepflegt sind.
     */
    if (isForbidden(error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] grid_tariffs (Tarif-Lookup):', error)
    return { formError: GENERIC }
  }

  if (defaults === null) {
    return { values: { lookup: 'none', stichtag } }
  }

  return {
    values: {
      lookup: 'ok',
      stichtag,
      leistungspreisEurPerKwYear: String(defaults.leistungspreisEurPerKwYear),
      minBillableKw: String(defaults.minBillableKw),
    },
  }
}

/** Die Felder, die als nicht-negative Zahl in den Entwurf gehen — Reihenfolge = Anzeigereihenfolge. */
const MANUAL_TARIFF_NUMBER_FIELDS = [
  'energyPriceCtPerKwh',
  'energyPriceNightCtPerKwh',
  'einspeiseverguetungCtPerKwh',
  'supplierBaseFeeEurPerMonth',
  'leistungspreisEurPerKwYear',
  'minBillableKw',
  'annualConsumptionKwh',
] as const satisfies readonly InvoiceMergeFieldKey[]

/**
 * Liest eine eingetippte Zahl.
 *
 * `undefined` = Feld leer (keine Angabe, kein Fehler) · `null` = eingetippt, aber unbrauchbar.
 * Das DEZIMALKOMMA wird angenommen: das Formular ist deutschsprachig, und „24,5" abzuweisen wäre
 * eine Hürde ohne Gegenwert. Eine Zahl mit Tausenderpunkt wird dagegen NICHT geraten — „1.234"
 * ist als 1234 oder als 1,234 lesbar, und eine der beiden Lesarten wäre um den Faktor 1000 falsch.
 */
function readManualNumber(formData: FormData, field: string): number | null | undefined {
  const raw = String(formData.get(field) ?? '').trim()
  if (raw === '') return undefined
  const value = Number(raw.replace(',', '.'))
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

/**
 * Trägt die von Hand eingegebenen Tarifwerte in den Entwurf des Zählpunkts ein.
 *
 * ── DIE REIHENFOLGE ────────────────────────────────────────────────────────────────────────────
 *   1. alle gefüllten Felder prüfen (ein Fehler bricht VOR jedem Schreibvorgang ab)
 *   2. Entwurf FRISCH lesen (`update_metering_point_draft` ERSETZT ihn — ein Stand aus der Zeit des
 *      Seitenaufbaus machte jede Angabe rückgängig, die inzwischen dazugekommen ist, etwa eine in
 *      einem zweiten Tab hochgeladene Rechnung)
 *   3. die Werte hineinfalten
 *   4. EIN `update_metering_point_draft`
 *
 * ── ⚠ `netzbetreiber` WIRD SEIT D3 (16.09.2026) GESCHRIEBEN ───────────────────────────────────
 * Hier stand bis dahin die Begründung, warum nicht: er sei kein `tariffParamsSchema`-Feld und
 * würde beim nächsten Auswerten stillschweigend entfernt. Das galt, solange der Entwurf nur als
 * GANZES gegen den Contract geprüft wurde; seit D3 liest ihn eine benannte Abbildung unter einem
 * benannten Schlüssel (`NETZBETREIBER_DRAFT_KEY`, `shared`). Die Zuständigkeit stünde sonst
 * ausschliesslich im Formularzustand eines Bildschirms, der beim Neuladen weg ist.
 *
 * ⚠ ER BLEIBT DER AUSLÖSER DES VORSCHLAGS — und wird trotzdem hier und nicht dort geschrieben:
 * `lookupGridTariffDefaultsAction` schreibt weiterhin NICHTS (s. Kopf des Abschnitts). Was in den
 * Entwurf geht, entscheidet derselbe Klick wie bei jedem anderen Feld.
 *
 * ── EIN LEERES FELD IST KEINE ANGABE ──────────────────────────────────────────────────────────
 * Es wird übersprungen, nicht als `null` geschrieben. Der Entwurf ist eine Sammlung von Angaben;
 * ein bereits übernommener Wert (etwa aus einer zuvor gelesenen Rechnung) bleibt dadurch stehen,
 * statt von einem leeren Formularfeld gelöscht zu werden. Dieselbe schonende Richtung wie beim
 * Widerspruch zweier Rechnungen (`invoiceDraftValues`).
 */
export async function saveMeteringPointManualTariffAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const fieldErrors: Record<string, string> = {}
  const values: { field: string; value: string | number }[] = []

  for (const key of MANUAL_TARIFF_NUMBER_FIELDS) {
    const value = readManualNumber(formData, key)
    if (value === undefined) continue
    if (value === null) {
      fieldErrors[key] = 'Bitte eine Zahl ab 0 eintragen, z. B. 24,5.'
      continue
    }
    // ⚠ Über `draftFieldFor`, nicht über den rohen Schlüssel: der Jahresverbrauch heisst im Entwurf
    // anders, und der Standardprofil-Zweig schreibt ihn unter genau diesem Namen.
    values.push({ field: draftFieldFor(key), value })
  }

  /*
   * ⚠ Die Netzebene wird UMGEFORMT. `tariffParamsSchema.netzebene` ist `z.string()`; eine Zahl dort
   * ist ein Schema-Verstoss, den `checkDraftCompleteness` dauerhaft als `invalid` meldet, während
   * der Wert gespeichert aussieht. `netzebeneDraftValue` ist der eine Ort dieser Regel.
   */
  const netzebeneRaw = String(formData.get('netzebene') ?? '').trim()
  if (netzebeneRaw !== '') {
    const netzebene = readNetzebene(formData, 'netzebene')
    if (netzebene === null) {
      fieldErrors.netzebene = 'Diese Netzebene kennen wir nicht.'
    } else {
      values.push({ field: 'netzebene', value: netzebeneDraftValue(netzebene) })
    }
  }

  /*
   * ⚠ KEINE Prüfung gegen eine feste Betreiberliste — wortgleich zu `lookupGridTariffDefaultsAction`
   * und aus demselben Grund: `grid_tariffs.operator_id` ist ohne Fremdschlüssel und ohne CHECK
   * gebaut (B21-1), und die gepflegten Kennungen wachsen mit dem Bestand. Eine Liste, die der
   * Vorschlag NICHT anlegt, die Speicherung aber verlangte, liesse einen neu gepflegten
   * Netzbetreiber vorschlagen und nicht speichern — und das sähe wie ein Defekt aus.
   */
  const operatorRaw = String(formData.get('operatorId') ?? '').trim()
  if (operatorRaw !== '') {
    values.push({ field: NETZBETREIBER_DRAFT_KEY, value: operatorRaw })
  }

  const variantRaw = String(formData.get('meteringVariant') ?? '').trim()
  if (variantRaw !== '') {
    const meteringVariant = readMeteringVariant(formData, 'meteringVariant')
    if (meteringVariant === null) {
      fieldErrors.meteringVariant = 'Diese Messvariante kennen wir nicht.'
    } else {
      values.push({ field: 'meteringVariant', value: meteringVariant })
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  if (values.length === 0) {
    return {
      formError:
        'Bitte mindestens einen Wert eintragen — leere Felder lassen den bisherigen Stand unberührt.',
    }
  }

  const supabase = await createClient()
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] list_metering_points (Tarif von Hand):', listRes.error)
    return { formError: GENERIC }
  }

  const point = readMeteringPointList(listRes.data)?.find(
    (candidate) => candidate.id === meteringPointId,
  )
  if (!point) return { formError: MANUAL_TARIFF_NOT_FOUND }

  /*
   * `measured`, nicht `assumed`: der Admin tippt ab, was auf der Rechnung des Kunden steht — die
   * Erfassungsform ist eine andere, die Herkunft der Zahl ist dieselbe wie beim Rechnungs-Scan.
   * Als Annahme gekennzeichnet trüge eine abgelesene Angabe dauerhaft den Vorbehalt einer
   * Schätzung, und der Report wiese sie bis zum Schluss als unsicher aus (Delta §3.2).
   */
  let nextDraft = point.draft
  const now = new Date()
  for (const { field, value } of values) {
    nextDraft = setDraftField(nextDraft, field, value, 'measured', undefined, now)
  }

  /*
   * ⚠ WIE BEIM UPLOAD: eine von Hand eingetragene Tarifangabe widerlegt ein früheres „ohne
   * Rechnungsdaten fortgefahren". Ohne diese Zeile stünden beide Aussagen zugleich im Entwurf,
   * und ein späterer Leser müsste raten, welche gilt — die vollständige Begründung steht in
   * `uploadMeteringPointInvoicesAction`.
   *
   * ⚠ Es geht BEWUSST NICHT über `values`: dort zählt jeder Eintrag als „Angabe des Kunden" (die
   * Erfolgsmeldung nennt die Zahl, und `values.length === 0` weist ein leeres Formular ab). Das
   * Signal ist eine Eigenschaft der Station, keine abgetippte Tarifzahl — mitgezählt meldete das
   * Formular bei einem einzigen eingetippten Wert „2 Angaben wurden übernommen".
   */
  nextDraft = setDraftField(nextDraft, INVOICE_SKIPPED_KEY, false, 'measured', undefined, now)

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie in den übrigen Entwurf-Schreibwegen: zur Laufzeit dasselbe.
    p_draft: nextDraft as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_metering_point_draft (Tarif von Hand):', draftRes.error)
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Tarif von Hand):', draftRes.data)
    return { formError: GENERIC }
  }

  // Die Station zeigt den übernommenen Stand aus der DATENBANK — s. Kopf dieser Datei.
  revalidatePath(projectDataEntryHref(projectId))

  const count =
    values.length === 1 ? 'Eine Angabe wurde' : `${values.length} Angaben wurden`
  return {
    success:
      `${count} übernommen. Leer gelassene Felder bleiben unverändert — ein bereits ` +
      'eingetragener Wert wird dadurch nicht gelöscht.',
  }
}

