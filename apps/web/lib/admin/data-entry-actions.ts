'use server'

/**
 * Die Server Actions des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ── ⚠ ES WAREN GENAU ZWEI, JETZT SIND ES DREI ──────────────────────────────────────────────────
 * Der ursprüngliche Zuschnitt nannte die Zahl ausdrücklich und begründete sie: die fünf Stationen
 * je Zählpunkt waren Platzhalter, und eine Action ohne Wirkung wäre ein Endpunkt, den man aufrufen
 * kann und der nichts tut. Genau diese Begründung fällt für den ERSTEN der fünf mit dem
 * Lastgang-Schritt weg — er lädt eine Datei ab, liest sie und schreibt die gelesenen Metadaten an
 * den Zählpunkt. Die vier übrigen (Rechnung, Batterie, PV, Tarif) bleiben Platzhalter und haben
 * weiterhin bewusst KEINE Action; jeder bekommt seinen eigenen Auftrag.
 *
 * ── KEIN service_role, wie in jeder Admin-Action dieses Bereichs ────────────────────────────────
 * Alle drei Wrapper sind `authenticated`-only und prüfen selbst:
 *   `public.update_project_segment_industry`     über `platform.project_accessible`
 *                                                (eigenes Projekt ODER Adminrolle),
 *   `public.admin_set_metering_point_count`      über `platform.is_admin()` (WIRFT 42501),
 *   `public.set_metering_point_load_profile`     über `platform.project_accessible`.
 * Die Autorisierung hängt damit nicht an dieser Datei. Die `no-restricted-imports`-Erlaubnisliste
 * wurde für diesen Pfad NICHT erweitert — auch nicht für den Lastgang-Upload: der Byte-Transport
 * (`lib/project-documents/storage.ts`) trägt den `service_role`-Schlüssel, wird hier aber nur
 * MITTELBAR über `uploadProjectDocument` erreicht, und das fragt die Eigentumsfrage vorher an die
 * Datenbank.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ZWEI ACTIONS LEITEN IM ERFOLGSFALL UM, DIE DRITTE NICHT — und das ist der Unterschied
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bei Segment und Zählpunkt-Zahl sind „gespeichert" und „einen Schritt weiter" derselbe Vorgang:
 * die Position des Wizards steht in der URL (`lib/admin/data-entry-stations.ts`), die Weiterleitung
 * IST die Rückmeldung, und eine Erfolgsmeldung daneben bekäme ohnehin niemand zu sehen (dieselbe
 * Beobachtung wie bei der Partner-Genehmigung, B16-4a, und im Rückfragen-Bereich).
 *
 * Beim LASTGANG gibt es dagegen etwas zu SEHEN: Zeitraum, Intervall und Lücken sind das Einzige,
 * woran ein Mensch erkennt, ob die hochgeladene Datei die richtige war — eine Jahresdatei statt der
 * Monatsdatei, ein Export desselben Betriebs für den falschen Zählpunkt. Wer sofort weitergeleitet
 * würde, bekäme das gelesene Ergebnis nie zu Gesicht und trüge es ungeprüft durch den Rest des
 * Wizards. Die Station zeigt deshalb die Zusammenfassung und der Weiter-Knopf wird frei; die
 * Zusammenfassung selbst kommt aus der DATENBANK (`readMeteringPointList`) und nicht aus dem
 * Rückgabewert dieser Action — nach einem Neuladen stünde sie sonst leer da, obwohl gespeichert ist.
 *
 * ⚠ `redirect()` WIRFT. Die beiden Aufrufe stehen deshalb am ENDE und ausserhalb jedes `try` — in
 * einem `catch` gefangen sähe die Weiterleitung wie ein Fehlschlag aus, und der Wizard bliebe
 * stehen, obwohl geschrieben wurde.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { readLoadProfile } from 'extractors'
import { MAX_PROJECT_DOCUMENT_BYTES } from 'shared'

import { uploadProjectDocument } from '@/lib/project-documents/documents'
import { createClient } from '@/lib/supabase/server'
import {
  stationAfterMeteringPointCount,
  stationAfterSegment,
  stationHref,
} from './data-entry-stations'
import { PROJECT_SEGMENTS, projectDataEntryHref, type ProjectSegment } from './projects'
import type { AdminState } from './schema'

const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
const UNKNOWN_PROJECT = 'Dieses Projekt gibt es nicht (mehr). Bitte laden Sie die Seite neu.'

/** SQLSTATE 42501 = insufficient_privilege. Die Rolle wurde zwischen Aufbau und Klick entzogen. */
function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Die Projekt-Kennung kommt als verstecktes Feld aus unserer eigenen Seite — eine unbrauchbare
 * kann also nur von einem Aufruf daneben stammen. Sie trotzdem hier zu prüfen erspart einen rohen
 * `22P02 invalid input syntax for type uuid`, aus dem die Oberfläche keinen Satz bilden kann.
 */
function readProjectId(formData: FormData): string | null {
  const value = String(formData.get('projectId') ?? '')
  return UUID.test(value) ? value : null
}

function statusOf(data: unknown): unknown {
  return (data as { status?: unknown } | null)?.status
}

// ── Segment ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Setzt das Segment eines Projekts und geht zur nächsten Station.
 *
 * ⚠ ES WIRD AUSSCHLIESSLICH `p_segment` ÜBERGEBEN, NIE `p_industry`. Der Wrapper deutet `null` als
 * „unverändert" (Lesart `capture_lead`, ausdrücklich nicht die von `admin_update_lead`) — eine
 * bereits im Gespräch bestimmte Branche überlebt damit einen Segmentwechsel hier. Die Branche ist
 * in diesem Bauschritt gar kein Schritt des Wizards; sie hier mitzuschicken hiesse, sie beim
 * blossen Durchklicken zu leeren.
 */
export async function setProjectSegmentAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const segment = String(formData.get('segment') ?? '')
  if (!(PROJECT_SEGMENTS as readonly string[]).includes(segment)) {
    // Erreichbar nur an den zwei Knöpfen vorbei — die schicken feste Werte.
    return { formError: GENERIC }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('update_project_segment_industry', {
    p_id: projectId,
    p_segment: segment as ProjectSegment,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] update_project_segment_industry:', error)
    return { formError: GENERIC }
  }

  const status = statusOf(data)
  if (status === 'not_found') return { formError: UNKNOWN_PROJECT }
  if (status !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Segment):', data)
    return { formError: GENERIC }
  }

  redirect(stationHref(projectId, stationAfterSegment()))
}

// ── Zählpunkte ───────────────────────────────────────────────────────────────────────────────────
/**
 * Obergrenze aus `public.admin_set_metering_point_count` (`c_max_count`).
 *
 * Doppelt geprüft, aber nicht redundant — dieselbe Aufteilung wie bei jedem Admin-Formular dieses
 * Repos: die Datenbank bleibt die harte Grenze (sie sieht auch Aufrufe an diesem Formular vorbei),
 * die Prüfung hier liefert die Meldung AM FELD statt eines Status nach dem Roundtrip. Der Wrapper
 * nennt die Zahl in seiner Antwort mit (`max`), damit ein Auseinanderlaufen sichtbar wird.
 */
const MAX_METERING_POINTS = 100

/**
 * Setzt die Zahl der Zählpunkte und geht zum ersten Schritt des ersten Zählpunkts.
 *
 * ⚠ DIESES FORMULAR KANN VERKLEINERN — und damit Zeilen entfernen. Der Wrapper schützt den einzigen
 * Fall, in dem dabei etwas Gemessenes verloren ginge (`has_load_profile`: trägt eine der betroffenen
 * Zeilen bereits einen Lastgang, fällt der GESAMTE Aufruf aus und nichts ist geändert). Genau
 * dieser Status bekommt hier eine Meldung mit den konkreten Zahlen: „abgewiesen" ohne zu sagen,
 * wie viele Zählpunkte es gibt und wie viele einen Lastgang tragen, wäre eine Sackgasse.
 */
export async function setMeteringPointCountAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const raw = String(formData.get('count') ?? '').trim()
  const values = { count: raw }
  const count = Number(raw)

  if (raw === '' || !Number.isInteger(count) || count < 1 || count > MAX_METERING_POINTS) {
    return {
      fieldErrors: {
        count: `Bitte eine ganze Zahl zwischen 1 und ${MAX_METERING_POINTS} angeben.`,
      },
      values,
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('admin_set_metering_point_count', {
    p_project_id: projectId,
    p_count: count,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] admin_set_metering_point_count:', error)
    return { formError: GENERIC, values }
  }

  const result = (data ?? {}) as Record<string, unknown>
  switch (result.status) {
    case 'ok':
      break
    case 'not_found':
      return { formError: UNKNOWN_PROJECT, values }
    case 'invalid_count': {
      const max = typeof result.max === 'number' ? result.max : MAX_METERING_POINTS
      return {
        fieldErrors: { count: `Bitte eine ganze Zahl zwischen 1 und ${max} angeben.` },
        values,
      }
    }
    case 'has_load_profile': {
      const current = typeof result.count === 'number' ? result.count : null
      const blocked = typeof result.blocked === 'number' ? result.blocked : null
      return {
        fieldErrors: {
          count:
            `Verkleinern nicht möglich: ${blocked ?? 'einer'} der Zählpunkte, die dabei wegfielen, ` +
            `trägt bereits einen eingelesenen Lastgang. Es ist nichts geändert worden — das ` +
            `Projekt hat weiterhin ${current ?? 'dieselbe Zahl'} Zählpunkte.`,
        },
        values,
      }
    }
    default:
      console.error('[admin/dateneingabe] unerwartete Antwort (Zählpunkte):', data)
      return { formError: GENERIC, values }
  }

  redirect(stationHref(projectId, stationAfterMeteringPointCount()))
}

// ── Lastgang ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Die WIRKSAME Grössengrenze für eine Lastgang-Datei in diesem Wizard.
 *
 * ⚠ ES SIND ZWEI ZAHLEN IM SPIEL, UND DIE KLEINERE GEWINNT — deshalb steht hier keine dritte.
 * `MAX_LOAD_PROFILE_FILE_BYTES` (25 MB, `packages/extractors`) begrenzt, was der LESER verarbeitet;
 * `MAX_PROJECT_DOCUMENT_BYTES` (20 MB, `packages/shared`) begrenzt, was die ABLAGE annimmt. Der
 * Wrapper `set_metering_point_load_profile` VERLANGT ein Dokument (`invalid_document`) — es gibt
 * also keinen Weg, eine Datei zu verwenden, die nicht abgelegt werden kann. Wirksam ist damit immer
 * die Ablage-Grenze, und nur die darf dem Admin genannt werden: 22 MB liefen sonst durch die
 * Prüfung, würden 22 MB lang geparst und scheiterten erst danach am Upload.
 */
const MAX_LOAD_PROFILE_BYTES = MAX_PROJECT_DOCUMENT_BYTES

/** Für die Meldung am Feld — ganze Megabyte, weil die Grenze eine ganze Zahl ist. */
const MAX_LOAD_PROFILE_MB = Math.floor(MAX_LOAD_PROFILE_BYTES / (1024 * 1024))

/**
 * Liest eine Lastgang-Datei ein und schreibt die gelesenen Metadaten an einen Zählpunkt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE REIHENFOLGE IST DIE EIGENTLICHE ENTSCHEIDUNG: ERST LESEN, DANN ABLEGEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. Grösse prüfen (rein, kein Netz)
 *   2. `readLoadProfile` — DETERMINISTISCH, kein Modellaufruf, kein Nebeneffekt
 *   3. erst jetzt `uploadProjectDocument` (Bytes + Zeile in `platform.project_documents`)
 *   4. `set_metering_point_load_profile`
 *
 * Die naheliegende Reihenfolge wäre „hochladen, dann lesen" — wie im Chat, wo das Dokument zuerst
 * abgelegt und später von einem Werkzeug gelesen wird. Hier ist sie falsch: **es gibt keinen Weg,
 * ein eingetragenes Dokument wieder zu entfernen** (kein Wrapper, kein Grant — TEIL 9 der Migration
 * `20260910090000`, und der Storage-Aufräumweg räumt ausdrücklich nur einen GESCHEITERTEN Upload
 * auf). Eine unlesbare oder uneindeutige Datei hinterliesse damit dauerhaft eine Zeile, die in
 * `list_project_documents` erscheint und zu keinem Zählpunkt gehört. Gelesen wird sie ohnehin
 * vollständig im Speicher — das Ablegen davor spart nichts.
 *
 * ⚠ WAS ZWISCHEN SCHRITT 3 UND 4 SCHIEFGEHEN KANN, BLEIBT STEHEN: ein abgelegtes Dokument ohne
 * Zuordnung. Das ist der bewusst in Kauf genommene Rest — dieselbe Klasse wie im Chat (dort legt
 * der Kunde Dokumente ab, die das Modell vielleicht nie liest). Es ist die harmlose Richtung: eine
 * Datei zu viel im Projekt, nicht eine Metadaten-Zeile, die auf nichts zeigt.
 *
 * ⚠ ES WIRD NICHT UMGELEITET — anders als die beiden Actions darüber. Begründung im Kopf dieser
 * Datei: Zeitraum, Intervall und Lücken sind das Einzige, woran ein Mensch erkennt, ob die richtige
 * Datei hochgeladen wurde.
 */
export async function uploadMeteringPointLoadProfileAction(
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

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { file: 'Bitte eine Datei auswählen.' } }
  }
  if (file.size > MAX_LOAD_PROFILE_BYTES) {
    return {
      fieldErrors: {
        file:
          `Diese Datei ist zu gross (${formatMegabytes(file.size)} MB). ` +
          `Mehr als ${MAX_LOAD_PROFILE_MB} MB nimmt der Wizard nicht an. ` +
          `Es wurde nichts hochgeladen und nichts gespeichert.`,
      },
    }
  }

  const bytes = await file.arrayBuffer()

  // ── Schritt 2: lesen. Rein, deterministisch, ohne Nebeneffekt — s. Kopf.
  const outcome = readLoadProfile(bytes, file.name)

  if (!outcome.ok) {
    /*
     * Unerreichbar, solange `MAX_LOAD_PROFILE_BYTES <= MAX_LOAD_PROFILE_FILE_BYTES` gilt (die
     * Prüfung oben greift vorher). Trotzdem behandelt statt ignoriert: die zwei Konstanten liegen
     * in zwei Paketen, und wer die eine hebt, soll hier keine unbeantwortete Antwort vorfinden.
     */
    return {
      fieldErrors: {
        file:
          `Diese Datei ist zu gross. Mehr als ${MAX_LOAD_PROFILE_MB} MB nimmt der Wizard nicht an. ` +
          `Es wurde nichts hochgeladen und nichts gespeichert.`,
      },
    }
  }

  const scan = outcome.scan

  if (scan.ok && scan.needsMapping) {
    /*
     * ⚠ HIER WIRD NICHTS GERATEN. Ein Netzbetreiber-Export führt regelmässig MEHRERE Zählpunkte in
     * einer Datei (OP#4, Format A); welche Spalte zu welchem Zählpunkt gehört, entscheidet ein
     * Mensch. Eine Spalten-Zuordnungs-UI gibt es in diesem Schritt bewusst nicht — sie kommt erst,
     * falls sich der Fall als häufig erweist. Die Zahl der Spalten wird trotzdem genannt: ohne sie
     * liest sich die Meldung wie „die Datei ist kaputt", und sie ist es nicht.
     */
    return {
      fieldErrors: {
        file:
          `Format nicht eindeutig erkennbar — bitte Datei prüfen oder eine andere Version ` +
          `hochladen. Die Datei führt ${scan.ambiguousColumns.length} Wert-Spalten, und welche ` +
          `zu diesem Zählpunkt gehört, lässt sich daraus nicht ableiten. Es wurde nichts ` +
          `hochgeladen und nichts gespeichert.`,
      },
    }
  }

  if (!scan.ok) {
    /*
     * Der Leser hat die Datei abgelehnt — leer, unbekanntes Format, falsches Intervall, oder ein
     * Wechselrichter-Log statt eines Netz-Lastgangs (`not_a_load_profile`). Seine Meldung ist
     * deutsch und fertig formuliert; sie hier durch einen eigenen Satz zu ersetzen nähme dem Admin
     * genau die Auskunft, die sagt, WAS an der Datei nicht stimmt.
     */
    return {
      fieldErrors: {
        file: `${scan.error.message} Es wurde nichts hochgeladen und nichts gespeichert.`,
      },
    }
  }

  // ── Schritt 3: ablegen. Die Eigentumsfrage beantwortet dabei die DATENBANK (`get_project`).
  const upload = await uploadProjectDocument(projectId, {
    name: file.name,
    /*
     * ⚠ `content_type` ist eine ANGABE des Browsers, kein Beweis (Spaltenkommentar der Migration)
     * — und für CSV meldet er regelmässig `application/vnd.ms-excel`. Der Leser oben hat deshalb
     * am DATEINAMEN entschieden, nicht hieran. Ein leerer Typ kommt real vor und würde von
     * `uploadProjectDocument` als `invalid_file` abgewiesen; derselbe neutrale Rückfall wie im Chat.
     */
    type: file.type.trim() === '' ? 'application/octet-stream' : file.type,
    bytes,
  })

  if (!upload.ok) {
    if (upload.reason === 'not_found') return { formError: UNKNOWN_PROJECT }
    console.error('[admin/dateneingabe] uploadProjectDocument:', upload.reason)
    return { formError: GENERIC }
  }

  // ── Schritt 4: die gelesenen Metadaten an den Zählpunkt schreiben.
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('set_metering_point_load_profile', {
    p_metering_point_id: meteringPointId,
    p_source_document_id: upload.documentId,
    p_interval_minutes: scan.intervalMinutes,
    p_covered_from: scan.coveredFrom,
    p_covered_to: scan.coveredTo,
    /*
     * ⚠ `p_gaps` wird IMMER mitgeschickt, auch als leeres Array. Der Vorgabewert des Wrappers
     * (`'[]'`) ist derselbe Wert — aber weggelassen sähe „keine Lücke gemessen" wie „dazu wurde
     * nichts gesagt" aus, und der Unterschied ist der ganze Zweck des Feldes (wortgleich zur
     * Begründung im Chat-Port, `lib/project-chat/supabase-ports.ts`).
     */
    p_gaps: scan.gaps,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] set_metering_point_load_profile:', error)
    return { formError: GENERIC }
  }

  switch (statusOf(data)) {
    case 'ok':
      break
    case 'not_found':
      return {
        formError:
          'Diesen Zählpunkt gibt es nicht (mehr). Die Datei ist im Projekt abgelegt, aber keinem ' +
          'Zählpunkt zugeordnet. Bitte laden Sie die Seite neu.',
      }
    default:
      /*
       * `invalid_interval`, `invalid_range`, `invalid_gaps`, `unknown_document` — alle vier
       * beschreiben einen Widerspruch zwischen dem, was der Leser geliefert hat, und dem, was die
       * Datenbank zulässt. Für den Admin gibt es daran nichts zu tun; die Ursache gehört ins Log.
       */
      console.error('[admin/dateneingabe] unerwartete Antwort (Lastgang):', data)
      return { formError: GENERIC }
  }

  /*
   * ⚠ OHNE DAS BLEIBT DIE ZUSAMMENFASSUNG UNSICHTBAR. Die Station liest den gespeicherten Stand
   * aus der DATENBANK (`readMeteringPointList`) und bekommt ihn als Prop — eine Server Action
   * verwirft den Router-Cache aber nicht von selbst, die Seite rendert also weiter mit dem Stand
   * von vor dem Upload. Die Seite ist `force-dynamic`, der Server hat damit nichts zwischengespei-
   * chert; verworfen wird hier ausschliesslich die Fassung, die der Browser noch hält.
   */
  revalidatePath(projectDataEntryHref(projectId))

  return { success: 'Lastgang eingelesen und gespeichert.' }
}

/** Dateigrösse in MB mit einer Nachkommastelle — nur für die Meldung am Feld. */
function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',')
}
