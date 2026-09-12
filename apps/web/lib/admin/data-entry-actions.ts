'use server'

/**
 * Die Server Actions des Dateneingabe-Wizards (B24, Teil 1).
 *
 * ── ⚠ ES WAREN GENAU ZWEI, JETZT SIND ES ZEHN ─────────────────────────────────────────────────
 * Der ursprüngliche Zuschnitt nannte die Zahl ausdrücklich und begründete sie: die fünf Stationen
 * je Zählpunkt waren Platzhalter, und eine Action ohne Wirkung wäre ein Endpunkt, den man aufrufen
 * kann und der nichts tut. Genau diese Begründung fällt Station für Station weg.
 *
 * Für den LASTGANG gilt sie für BEIDE Zweige seiner Frage nicht mehr: der „Ja"-Zweig lädt eine
 * Datei ab, liest sie und schreibt die gelesenen Metadaten an den Zählpunkt (die vierte Action
 * nimmt genau das wieder zurück), der „Nein"-Zweig ERZEUGT stattdessen ein Standardlastprofil aus
 * dem Jahresverbrauch und schreibt dessen Metadaten an dieselben Spalten.
 *
 * Für die RECHNUNG seit der sechsten Action: sie nimmt beliebig viele PDF-Rechnungen entgegen,
 * legt sie im Projekt ab, liest sie aus und schreibt den ZUSAMMENGEFÜHRTEN Stand in den Entwurf des
 * Zählpunkts. Sie ist die einzige der sieben, die einen abrechenbaren Modellaufruf auslöst — und die
 * einzige, die wiederholt aufgerufen werden soll (sie ergänzt, sie ersetzt nicht).
 *
 * Die SIEBTE nimmt genau EINE davon wieder zurück: sie streicht den Beleg aus dem Entwurf und führt
 * die verbliebenen erneut zusammen. Sie bringt KEINEN neuen Wrapper mit — sie kommt mit denselben
 * zwei aus wie die sechste (`list_metering_points`, `update_metering_point_draft`) und löst keinen
 * abrechenbaren Aufruf aus: die verbliebenen Extraktionen liegen fertig im Entwurf.
 *
 * ⚠ ES SIND INZWISCHEN ZEHN. Die manuelle Tarifeingabe brachte zwei dazu (Preisblatt nachschlagen,
 * Werte übernehmen), die BATTERIE-Station drei — und damit gilt die Begründung auch für sie nicht
 * mehr. Ihre dritte (`extractBatteryTextFromAction`) ist nach der Rechnungs-Action die zweite, die
 * einen abrechenbaren Modellaufruf auslöst, und die einzige, die dabei GAR NICHTS schreibt.
 *
 * Die zwei übrigen Stationen (PV, Tarif) bleiben Platzhalter und haben weiterhin bewusst KEINE
 * Action; jede bekommt ihren eigenen Auftrag.
 *
 * ── KEIN service_role, wie in jeder Admin-Action dieses Bereichs ────────────────────────────────
 * Alle NEUN Wrapper sind `authenticated`-only und prüfen selbst (die Rechnungs-Action kommt mit den
 * letzten beiden aus und bringt keinen neuen mit — es gibt für sie weder Migration noch Wrapper):
 *   `public.update_project_segment_industry`          über `platform.project_accessible`
 *                                                     (eigenes Projekt ODER Adminrolle),
 *   `public.admin_set_metering_point_count`           über `platform.is_admin()` (WIRFT 42501),
 *   `public.set_metering_point_load_profile`          über `platform.project_accessible`,
 *   `public.admin_reset_metering_point_load_profile`  über `platform.is_admin()` (WIRFT 42501),
 *   `public.admin_delete_metering_point_document`     über `platform.is_admin()` (WIRFT 42501),
 *   `public.admin_get_project`                        über `platform.is_admin()` (WIRFT 42501),
 *   `public.list_metering_points`                     über `platform.project_accessible`,
 *   `public.update_metering_point_draft`              über `platform.project_accessible`,
 *   `public.set_metering_point_standard_profile`      über `platform.project_accessible`.
 * Die letzten vier gehören dem Standardprofil-Zweig: er braucht als einziger vier Aufrufe, weil er
 * drei Dinge nacheinander tun muss, die keine gemeinsame Funktion hat (Segment lesen, Entwurf
 * lesen und ersetzen, Metadaten schreiben) — die Reihenfolge und ihre Begründung stehen im Kopf
 * von `saveMeteringPointStandardProfileAction`.
 * Die Autorisierung hängt damit nicht an dieser Datei. Die `no-restricted-imports`-Erlaubnisliste
 * wurde für diesen Pfad NICHT erweitert: der `service_role`-Schlüssel bleibt in
 * `lib/project-documents/storage.ts` eingeschlossen, und diese Datei importiert ihn nirgends.
 *
 * ⚠ EINE ABWEICHUNG IST BENANNT, NICHT ÜBERSEHEN: der Lastgang-Upload erreicht den Byte-Transport
 * MITTELBAR über `uploadProjectDocument` (das die Eigentumsfrage selbst an die Datenbank stellt),
 * sein Gegenstück dagegen UNMITTELBAR über `removeProjectDocumentBytes`. Das ist zulässig, weil der
 * Pfad, den es löscht, nicht aus dieser Datei stammt: er kommt aus der Antwort von
 * `admin_reset_metering_point_load_profile`, also aus einem Wrapper, der vorher die Adminrolle
 * geprüft und den Pfad am ZÄHLPUNKT aufgelöst hat. Die Datenbank hat auch hier zuerst entschieden —
 * nur reicht sie das Ergebnis als Wert heraus, statt den Aufruf zu kapseln.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ZWEI ACTIONS LEITEN IM ERFOLGSFALL UM, DIE FÜNF ÜBRIGEN NICHT — und das ist der Unterschied
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
 * Dasselbe gilt fürs ENTFERNEN: die Station muss danach die ursprüngliche Ja/Nein-Frage zeigen, und
 * dass sie das tut, erkennt ein Mensch nur, wenn er auf der Station bleibt. Und dasselbe für das
 * ERZEUGTE Standardprofil — dort ist es sogar die schärfere Form derselben Überlegung: an einem
 * hochgeladenen Lastgang kann ein Mensch die Datei erkennen, an einem erzeugten Profil ist der
 * ausgewiesene Zeitraum samt Jahresverbrauch das EINZIGE, was ihm überhaupt zur Prüfung bleibt.
 * Und dasselbe für die RECHNUNGEN: die zusammengeführten Werte — und vor allem ein gemeldeter
 * WIDERSPRUCH zwischen zwei Belegen — sind das, weswegen jemand die Dateien überhaupt hochgeladen
 * hat; eine Weiterleitung nähme sie ihm ungesehen weg. Und erst recht für das ENTFERNEN einer
 * einzelnen Rechnung: ob damit ein Widerspruch verschwunden ist, steht in genau der
 * Zusammenfassung, die eine Weiterleitung überspränge.
 *
 * ⚠ `redirect()` WIRFT. Die beiden Aufrufe stehen deshalb am ENDE und ausserhalb jedes `try` — in
 * einem `catch` gefangen sähe die Weiterleitung wie ein Fehlschlag aus, und der Wizard bliebe
 * stehen, obwohl geschrieben wurde.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import {
  MAX_BATTERY_TEXT_CHARS,
  MAX_INVOICE_FILE_BYTES,
  extractBatteryText,
  extractInvoiceData,
  generateStandardProfileMetadata,
  readLoadProfile,
} from 'extractors'
import {
  MAX_PROJECT_DOCUMENT_BYTES,
  METERING_VARIANTS,
  NETZEBENEN,
  hasMeteringVariant,
  mergeInvoiceExtractions,
  standardProfileYear,
  type InvoiceMergeFieldKey,
} from 'shared'

import { uploadProjectDocument } from '@/lib/project-documents/documents'
import { removeProjectDocumentBytes } from '@/lib/project-documents/storage'
import { setDraftField, type DraftValue } from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import {
  BATTERY_PRESENT_KEY,
  BATTERY_RECOMMENDATION_KEY,
  BATTERY_VALUE_FIELDS,
  formatBatteryNumber,
  parseBatteryNumber,
} from './battery-draft'
import {
  stationAfterMeteringPointCount,
  stationAfterSegment,
  stationHref,
} from './data-entry-stations'
import { formatKwh } from './format'
import { lookupGridTariffDefaults } from './grid-tariff-lookup'
import {
  MAX_INVOICES_PER_UPLOAD,
  draftFieldFor,
  invoiceDraftValues,
  netzebeneDraftValue,
  readStoredInvoiceExtractions,
  withStoredInvoiceExtractions,
  type StoredInvoiceExtraction,
} from './invoice-extractions'
import { readMeteringPointList } from './metering-points'
import {
  PROJECT_SEGMENTS,
  projectDataEntryHref,
  readAdminProject,
  type ProjectSegment,
} from './projects'
import {
  ANNUAL_CONSUMPTION_KWH_KEY,
  MAX_HOUSEHOLD_PERSONS,
  MAX_STANDARD_PROFILE_ANNUAL_KWH,
  customerClassForSegment,
  estimateHouseholdConsumptionKwh,
  householdEstimateNote,
  parseAnnualConsumptionKwh,
} from './standard-profile'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'

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

// ── Lastgang entfernen ───────────────────────────────────────────────────────────────────────────
/**
 * Nimmt den eingelesenen Lastgang eines Zählpunkts vollständig zurück: Metadaten am Zählpunkt,
 * Datei im Bucket, Zeile in `platform.project_documents`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DREI SCHRITTE, UND EINER DAVON KANN SQL NICHT — deshalb orchestriert diese Action
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. `admin_reset_metering_point_load_profile` — nullt Intervall, Zeitraum und Quelle am
 *      Zählpunkt, setzt `gaps` auf `[]` und LIEFERT DIE DOKUMENT-KENNUNG SAMT PFAD ZURÜCK, bevor
 *      sie genullt wird. Ohne diese Rückgabe wüsste hier niemand mehr, welche Datei gemeint war.
 *   2. Das Objekt im Bucket entfernen (`removeProjectDocumentBytes`) — der Schritt, den eine
 *      Datenbankfunktion nicht ausführen kann. Genau deshalb gibt es bis heute keinen allgemeinen
 *      `delete_project_document`-Wrapper (TEIL 9 der Migration `20260910090000`).
 *   3. `admin_delete_metering_point_document` — die Zeile in `platform.project_documents`.
 *
 * ⚠ DIE REIHENFOLGE IST DIE ENTSCHEIDUNG, NICHT DIE BEQUEMLICHKEIT: erst Storage, dann DB-Zeile.
 * Bricht es dazwischen ab, bleibt eine DB-Zeile ohne Datei — sichtbar in
 * `list_project_documents`, benennbar, und beim nächsten Anlauf löschbar (die Storage-API meldet
 * für einen unbekannten Pfad keinen Fehler, s. Kopf von `removeProjectDocumentBytes`). Umgekehrt
 * bliebe ein Objekt im Bucket, auf das nichts mehr zeigt: unsichtbar in jeder Liste, von niemandem
 * mehr adressierbar und nur noch über den Speicherverbrauch auffindbar. Ein sichtbarer Rest ist
 * billiger als ein unsichtbarer.
 *
 * ⚠ SCHRITT 1 IST SCHON GESCHEHEN, WENN SCHRITT 2 SCHEITERT — und das ist der Grund, warum diese
 * Action auch dann `revalidatePath` ruft und einen FEHLERTEXT liefert statt einfach abzubrechen:
 * der Zählpunkt ist bereits zurückgesetzt, die Station zeigt wieder die Ja/Nein-Frage, ein neuer
 * Upload ist also möglich. Wer nur „das hat nicht geklappt" läse, hielte den Zustand für
 * unverändert und versuchte es ein zweites Mal — mit demselben Ergebnis.
 *
 * ⚠ ES WIRD NICHT UMGELEITET, aus demselben Grund wie beim Upload (s. Kopf dieser Datei): die
 * Station muss danach die ursprüngliche Frage zeigen, und dass sie das tut, sieht nur, wer auf ihr
 * bleibt.
 */
export async function removeMeteringPointLoadProfileAction(
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

  const supabase = await createClient()

  // ── Schritt 1: zurücksetzen. Liefert die noch gültige Dokument-Kennung mit.
  const { data: reset, error: resetError } = await supabase.rpc(
    'admin_reset_metering_point_load_profile',
    { p_metering_point_id: meteringPointId },
  )

  if (resetError) {
    if (isForbidden(resetError)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] admin_reset_metering_point_load_profile:', resetError)
    return { formError: GENERIC }
  }

  const resetResult = (reset ?? {}) as Record<string, unknown>
  if (resetResult.status === 'not_found') {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }
  if (resetResult.status !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Lastgang zurücksetzen):', reset)
    return { formError: GENERIC }
  }

  /*
   * ⚠ AB HIER IST DER ZÄHLPUNKT ZURÜCKGESETZT. Jeder weitere Ausgang dieser Funktion muss die
   * Station neu rendern lassen — sonst zeigte der Browser weiter die Zusammenfassung eines
   * Lastgangs, den es nicht mehr gibt.
   */
  revalidatePath(projectDataEntryHref(projectId))

  const documentId = typeof resetResult.document_id === 'string' ? resetResult.document_id : null
  const storagePath = typeof resetResult.storage_path === 'string' ? resetResult.storage_path : null

  if (documentId === null) {
    /*
     * Der Zählpunkt trug keine Quelle. Erreichbar, wenn jemand zweimal hintereinander klickt oder
     * ein zweiter Tab schneller war — dann ist das Ziel bereits hergestellt, und genau das wird
     * gemeldet statt eines Fehlers über einen Zustand, den der Klickende wollte.
     */
    return { success: 'Es war kein Lastgang hinterlegt. Der Zählpunkt ist leer.' }
  }

  // ── Schritt 2: die Bytes. Scheitert das, bleibt die DB-Zeile ABSICHTLICH stehen — s. Kopf.
  if (storagePath !== null) {
    const removed = await removeProjectDocumentBytes(storagePath)
    if (!removed.ok) {
      console.error('[admin/dateneingabe] removeProjectDocumentBytes:', removed.message)
      return {
        formError:
          'Der Lastgang ist vom Zählpunkt entfernt — Sie können jetzt eine neue Datei hochladen. ' +
          'Die alte Datei liess sich allerdings nicht aus der Ablage löschen; ihr Eintrag bleibt ' +
          'deshalb bewusst sichtbar stehen, statt still zu verschwinden.',
      }
    }
  }

  // ── Schritt 3: die Zeile. Der Wrapper prüft, dass kein Zählpunkt mehr auf sie zeigt (`in_use`).
  const { data: deleted, error: deleteError } = await supabase.rpc(
    'admin_delete_metering_point_document',
    { p_metering_point_id: meteringPointId, p_document_id: documentId },
  )

  const leftoverRow =
    'Der Lastgang ist vom Zählpunkt entfernt — Sie können jetzt eine neue Datei hochladen. Der ' +
    'Eintrag der alten Datei liess sich allerdings nicht löschen und bleibt in der Dokumentenliste ' +
    'des Projekts stehen.'

  if (deleteError) {
    if (isForbidden(deleteError)) return { formError: FORBIDDEN }
    console.error('[admin/dateneingabe] admin_delete_metering_point_document:', deleteError)
    return { formError: leftoverRow }
  }

  if (statusOf(deleted) !== 'ok') {
    /*
     * `not_found`, `unknown_document`, `in_use` — für den Admin gibt es daran nichts zu tun, und
     * der Zählpunkt ist in allen drei Fällen bereits frei. Die Ursache gehört ins Log.
     */
    console.error('[admin/dateneingabe] unerwartete Antwort (Dokument löschen):', deleted)
    return { formError: leftoverRow }
  }

  return { success: 'Lastgang entfernt. Sie können eine neue Datei hochladen.' }
}

/** Dateigrösse in MB mit einer Nachkommastelle — nur für die Meldung am Feld. */
function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',')
}

// ── Standardprofil ───────────────────────────────────────────────────────────────────────────────
/**
 * Erzeugt ein synthetisches Standardlastprofil aus dem Jahresverbrauch und schreibt seine
 * Metadaten an einen Zählpunkt — der „Nein"-Zweig der Lastgang-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIESELBE REIHENFOLGE WIE BEIM UPLOAD: ERST ERZEUGEN, DANN SCHREIBEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. Eingabe prüfen (rein) und, wo nötig, aus der Haushaltsgrösse schätzen
 *   2. `generateStandardProfileMetadata` — DETERMINISTISCH, kein Netz, kein Nebeneffekt
 *   3. den Jahresverbrauch samt Herkunftsvermerk in den Entwurf des Zählpunkts
 *   4. `set_metering_point_standard_profile`
 *
 * Schritt 2 lehnt eine unbrauchbare Eingabe ab, bevor irgendetwas geschrieben ist — wortgleich zur
 * Begründung beim Datei-Upload. Dass es hier billiger wäre, falsch herum zu laufen (es gibt keine
 * Datei, die liegen bliebe), ändert daran nichts: ein Entwurf, der einen Jahresverbrauch trägt, zu
 * dem kein Profil existiert, wäre für den nächsten Schritt nicht von einem gültigen zu
 * unterscheiden.
 *
 * ⚠ SCHRITT 3 STEHT VOR SCHRITT 4, UND NICHT UMGEKEHRT. Bricht es dazwischen ab, steht die EINGABE
 * ohne den daraus erzeugten Zeitraum — der Admin sieht die Frage erneut, trägt dieselbe Zahl ein
 * und ist am Ziel. Umgekehrt stünde ein Zeitraum da, dessen Grundlage nirgends steht: die Station
 * zeigte ein Standardprofil ohne Jahresverbrauch, und woraus es entstand, wüsste niemand mehr.
 *
 * ⚠ ES WIRD NICHT UMGELEITET, aus demselben Grund wie beim Upload: Zeitraum und Jahresverbrauch
 * sind das Einzige, woran ein Mensch erkennt, womit gerechnet werden wird.
 *
 * ── ⚠ DAS SEGMENT KOMMT AUS DER DATENBANK, NICHT AUS DEM FORMULAR ──────────────────────────────
 * Es entscheidet, WELCHE Kurve gilt — und damit über den Verbrauchsverlauf eines ganzen Jahres.
 * Als verstecktes Feld mitgeschickt wäre es eine Behauptung des Browsers über den Serverzustand,
 * und ein veralteter Tab (Segment inzwischen gewechselt) erzeugte ein Profil nach der falschen
 * Kurve, ohne dass irgendetwas fehlschlüge. Der zusätzliche Roundtrip ist der Preis dafür, dass
 * diese eine Angabe nicht geraten wird.
 */
export async function saveMeteringPointStandardProfileAction(
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

  const rawAnnual = String(formData.get('annualKwh') ?? '')
  const rawPersons = String(formData.get('persons') ?? '')
  const mode = String(formData.get('mode') ?? 'direct')
  const values = { annualKwh: rawAnnual, persons: rawPersons }

  const supabase = await createClient()

  // ── Das Segment, und damit die Kurve ──────────────────────────────────────────────────────────
  const projectRes = await supabase.rpc('admin_get_project', { p_id: projectId })
  if (projectRes.error) {
    if (isForbidden(projectRes.error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] admin_get_project (Standardprofil):', projectRes.error)
    return { formError: GENERIC, values }
  }

  const project = readAdminProject(projectRes.data)
  if (project === null || project === 'not_found') return { formError: UNKNOWN_PROJECT, values }

  const segment = (PROJECT_SEGMENTS as readonly string[]).includes(project.segment ?? '')
    ? (project.segment as ProjectSegment)
    : null
  const customerClass = customerClassForSegment(segment)
  if (customerClass === null) {
    /*
     * Über den Wizard nicht erreichbar: ohne Segment gibt es genau EINE Station, und das ist die
     * Segment-Frage. Beantwortet statt ignoriert, weil eine Server Action ein Endpunkt ist.
     */
    return {
      formError:
        'Für dieses Projekt ist noch nicht festgelegt, ob es ein Privathaushalt oder ein Betrieb ' +
        'ist. Ohne diese Angabe steht nicht fest, welche Verbrauchskurve gilt.',
      values,
    }
  }

  // ── Die Zahl: eingetragen oder geschätzt ──────────────────────────────────────────────────────
  let annualConsumptionKwh: number
  let source: 'measured' | 'assumed'
  let note: string | undefined

  if (mode === 'persons') {
    const persons = Number(rawPersons.trim())
    const estimate = estimateHouseholdConsumptionKwh(persons)
    if (estimate === null) {
      return {
        fieldErrors: {
          persons: `Bitte eine ganze Zahl zwischen 1 und ${MAX_HOUSEHOLD_PERSONS} angeben.`,
        },
        values,
      }
    }
    annualConsumptionKwh = estimate
    source = 'assumed'
    note = householdEstimateNote(persons)
  } else {
    const parsed = parseAnnualConsumptionKwh(rawAnnual)
    if (!parsed.ok) {
      return { fieldErrors: { annualKwh: annualConsumptionMessage(parsed.reason) }, values }
    }
    annualConsumptionKwh = parsed.value
    source = 'measured'
  }

  // ── Schritt 2: erzeugen. Rein, deterministisch, ohne Nebeneffekt — s. Kopf.
  const year = standardProfileYear(new Date())
  const generated = generateStandardProfileMetadata({
    annualConsumptionKwh,
    customerClass,
    year,
    timeZone: STANDARD_PROFILE_TIME_ZONE,
  })

  if (!generated.ok) {
    switch (generated.reason) {
      case 'no_profile_for_class':
        /*
         * Für Betriebe gibt es (noch) keine Profilkurve — Delta 8 lässt offen, welches G-Profil in
         * Österreich üblich ist. Die Oberfläche fragt deshalb gar nicht erst; der Satz steht hier
         * als Tiefenstaffelung, damit ein Aufruf daneben eine Auskunft bekommt statt eines
         * allgemeinen Fehlers (dieselbe Zurückhaltung wie beim Abweisungsgrund in
         * `admin_approve_partner_application`, der durch eine spätere Sperre unerreichbar wurde).
         */
        return {
          formError:
            'Für Betriebe ist noch keine Standard-Verbrauchskurve hinterlegt. Ein aus dem ' +
            'Haushaltsprofil abgeleiteter Verlauf wäre geraten — bitte laden Sie einen echten ' +
            'Lastgang hoch.',
          values,
        }
      case 'invalid_consumption':
        return {
          fieldErrors: { annualKwh: annualConsumptionMessage('invalid') },
          values,
        }
      default:
        // `invalid_year` und `empty_profile`: beide beschreiben einen Widerspruch im Generator, an
        // dem der Admin nichts ändern kann. Die Ursache gehört ins Log.
        console.error('[admin/dateneingabe] Standardprofil nicht erzeugbar:', generated.reason)
        return { formError: GENERIC, values }
    }
  }

  const metadata = generated.metadata

  // ── Schritt 3: die EINGABE in den Entwurf des Zählpunkts ─────────────────────────────────────
  /*
   * ⚠ DER ENTWURF WIRD FRISCH GELESEN, NICHT AUS EINER PROP ÜBERNOMMEN.
   * `update_metering_point_draft` ERSETZT ihn, er verschmilzt ihn nicht (bewusst: eine flache
   * Verschmelzung könnte einen Schlüssel nie wieder entfernen). Wer einen veralteten Stand
   * hineingibt, macht damit jede Angabe rückgängig, die seit dem Rendern dazugekommen ist —
   * derselbe Grund, aus dem der Chat-Ausführer vor jedem Schreibvorgang neu liest.
   */
  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] list_metering_points (Standardprofil):', listRes.error)
    return { formError: GENERIC, values }
  }

  const points = readMeteringPointList(listRes.data)
  const point = points?.find((candidate) => candidate.id === meteringPointId)
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.', values }
  }

  const nextDraft = setDraftField(
    point.draft,
    ANNUAL_CONSUMPTION_KWH_KEY,
    annualConsumptionKwh,
    source,
    note,
    new Date(),
  )

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    /*
     * ⚠ Die Zusicherung ist nötig und harmlos: `setDraftField` liefert ein
     * `Record<string, unknown>`, der generierte Parametertyp ist `Json`. Die beiden sind zur
     * Laufzeit dasselbe (der Entwurf kam als `jsonb` aus derselben Datenbank und geht unverändert
     * zurück) — TypeScript kann das nur nicht wissen, weil `unknown` auch Nicht-JSON zuliesse.
     */
    p_draft: nextDraft as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] update_metering_point_draft:', draftRes.error)
    return { formError: GENERIC, values }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error('[admin/dateneingabe] unerwartete Antwort (Entwurf):', draftRes.data)
    return { formError: GENERIC, values }
  }

  // ── Schritt 4: die Metadaten des erzeugten Profils an den Zählpunkt ──────────────────────────
  /*
   * ⚠ EIN ANDERER WRAPPER ALS BEIM UPLOAD, und das ist keine Bequemlichkeit:
   * `set_metering_point_load_profile` weist `p_source_document_id => null` mit `invalid_document`
   * ab. Ein Standardprofil hat keine Quelldatei und soll keine vortäuschen — die Begründung steht
   * im Kopf der Migration 20260911200000. Gemeinsam ist den beiden, dass sie dieselben Spalten
   * füllen: der KI-Check muss später nicht unterscheiden, woher der Zeitraum stammt.
   */
  const { data, error } = await supabase.rpc('set_metering_point_standard_profile', {
    p_metering_point_id: meteringPointId,
    p_interval_minutes: metadata.intervalMinutes,
    p_covered_from: metadata.coveredFrom,
    p_covered_to: metadata.coveredTo,
  })

  if (error) {
    if (isForbidden(error)) return { formError: FORBIDDEN, values }
    console.error('[admin/dateneingabe] set_metering_point_standard_profile:', error)
    return { formError: GENERIC, values }
  }

  switch (statusOf(data)) {
    case 'ok':
      break
    case 'not_found':
      return {
        formError:
          'Diesen Zählpunkt gibt es nicht (mehr). Der Jahresverbrauch ist gespeichert, das Profil ' +
          'konnte aber nicht zugeordnet werden. Bitte laden Sie die Seite neu.',
        values,
      }
    default:
      // `invalid_interval`, `invalid_range` — ein Widerspruch zwischen dem, was der Generator
      // geliefert hat, und dem, was die Datenbank zulässt. Für den Admin nichts zu tun.
      console.error('[admin/dateneingabe] unerwartete Antwort (Standardprofil):', data)
      return { formError: GENERIC, values }
  }

  // ⚠ Ohne das bliebe die Zusammenfassung unsichtbar — s. die Begründung beim Upload.
  revalidatePath(projectDataEntryHref(projectId))

  return {
    success: `Standardprofil für ${year} erzeugt, gerechnet mit ${formatKwh(annualConsumptionKwh)} im Jahr.`,
  }
}

/**
 * Die Zeitzone der Tagesform eines erzeugten Profils.
 *
 * ⚠ Ein Pflichtparameter der Engine, ohne Vorgabewert — „eine stillschweigend angenommene wäre eine
 * zweite Wahrheit". Hier ist sie gesetzt statt erfragt: der Wizard ist der Admin-Weg für
 * österreichische Kunden, und eine Auswahl daneben wäre ein Feld, das in jedem realen Fall denselben
 * Wert trägt. ⚠ Dieselbe Zahl steht als `STANDARD_PROFILE_TIMEZONE` in
 * `apps/website/lib/constants.ts` — sie zusammenzulegen hiesse, den öffentlichen Rechner
 * anzufassen; laufen sie je auseinander, erzeugen die zwei Wege verschiedene Tagesverläufe.
 */
/**
 * Die Zeitzone, in der dieses Werkzeug rechnet — EIN Fundort für den Wert.
 *
 * Sie hat zwei Konsumenten mit verschiedenen Fragen: das Standardprofil braucht sie als
 * Engine-Parameter (s. den Kommentar direkt darunter), der Tarif-Lookup als Grundlage des
 * KALENDERTAGS, gegen den eine effektiv datierte Preisblatt-Zeile ausgewählt wird. Zwei Literale
 * liefen beim ersten Umbau auseinander, und die Abweichung wäre an beiden Stellen still.
 */
const AUSTRIA_TIME_ZONE = 'Europe/Vienna'

const STANDARD_PROFILE_TIME_ZONE = AUSTRIA_TIME_ZONE

/** Die drei Ablehnungsgründe einer Jahresverbrauchs-Eingabe, jeder mit eigener Auskunft. */
function annualConsumptionMessage(reason: 'missing' | 'invalid' | 'too_large'): string {
  switch (reason) {
    case 'missing':
      return 'Bitte den Jahresverbrauch in kWh eintragen — er steht auf der Stromrechnung.'
    case 'too_large':
      return (
        `Über ${formatKwh(MAX_STANDARD_PROFILE_ANNUAL_KWH)} im Jahr ist ein ` +
        'Haushalts-Standardprofil keine belastbare Grundlage mehr. Für diese Grössenordnung bitte ' +
        'einen echten Lastgang hochladen.'
      )
    default:
      return 'Bitte eine Zahl grösser als 0 eintragen.'
  }
}

// ── Rechnungen ───────────────────────────────────────────────────────────────────────────────────

/** Nur PDF — die API erwartet den `document`-Block mit genau diesem Medientyp. */
const PDF_MEDIA_TYPE = 'application/pdf'

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

// ── Rechnung: Tarifwerte von Hand ────────────────────────────────────────────────────────────────
/**
 * ⚠ ES SIND JETZT NEUN ACTIONS — und die zwei letzten gehören demselben Formular.
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
 * ── WAS BEWUSST NICHT GESCHRIEBEN WIRD ─────────────────────────────────────────────────────────
 * ⚠ `netzbetreiber` — obwohl das Formular danach fragt. Er ist hier ausschliesslich der AUSLÖSER
 * für „Werte vorschlagen"; im Entwurf wäre er kein `tariffParamsSchema`-Feld und würde beim
 * nächsten Auswerten stillschweigend entfernt (dieselbe Feststellung, aus der
 * `INVOICE_DRAFT_FIELD_KEYS` ihn ausschliesst). Ein Wert, der im Entwurf steht und auf dem Weg zur
 * Engine verschwindet, ist schlimmer als einer, der gar nicht erst dort steht.
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

// ── Batterie ─────────────────────────────────────────────────────────────────────────────────────
/**
 * B24, Teil 1 — die Batterie-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DREI ACTIONS, UND NUR ZWEI DAVON SCHREIBEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   `saveMeteringPointBatteryChoiceAction`  der Nein-Zweig: „Soll die Analyse einen
 *                                           Speichervorschlag enthalten?" — EIN Feld, EIN Aufruf.
 *   `extractBatteryTextFromAction`          liest den Freitext aus und schreibt NICHTS. Sie ist
 *                                           die einzige Action dieser Station, die einen
 *                                           abrechenbaren Modellaufruf auslöst.
 *   `saveMeteringPointBatteryAction`        der Ja-Zweig: die vier — ggf. von Hand korrigierten —
 *                                           Kenndaten in den Entwurf.
 *
 * ── ⚠ DIE FRAGE OBEN IST EINE WEICHE, KEINE GESPEICHERTE ANTWORT ──────────────────────────────
 * „Haben Sie bereits einen Batteriespeicher?" lebt wie bei der Lastgang-Station in `useState` und
 * erreicht keine dieser Actions als eigenes Feld. Gespeichert wird, was die ZWEIGE erheben:
 * `hasBattery: true` gehört zu den Kenndaten („diese Werte gehören zu einer vorhandenen Anlage")
 * und entsteht deshalb ausschliesslich beim Speichern des Ja-Zweigs.
 *
 * ⚠ `hasBattery: false` WIRD AUSDRÜCKLICH NICHT GESCHRIEBEN, und das ist eine Entscheidung:
 * Der Nein-Zweig erhebt eine andere Frage (den Speichervorschlag), und ein aus ihr abgeleitetes
 * „keine Batterie vorhanden" wäre ein zweites Signal neben `wantsBatteryRecommendation`, das ihm
 * widersprechen kann. Ein Zählpunkt ohne `hasBattery` im Entwurf heisst damit „dazu ist nichts
 * erfasst" — ob „ausdrücklich keine" ein eigenes Feld braucht, entscheidet der Schritt, der den
 * Entwurf verbraucht (Teil 2), nicht diese Station.
 *
 * ── ⚠ ES GIBT KEINE KATALOG-ZUORDNUNG, und das ist seit dem 01.09.2026 so ─────────────────────
 * Eine genannte Kapazität wird NICHT auf den nächstliegenden Katalog-Kandidaten gerundet
 * (Delta 17 Teil 2): für die bereits installierte Anlage weist der Report gar keinen Preis aus, und
 * übrig bliebe eine Ersparnis, die zu einem Gerät gehört, das der Kunde nicht besitzt. Gespeichert
 * werden ausschliesslich die vier Rohwerte; `battery-combination.ts` kommt hier nicht vor.
 *
 * ── ⚠ `hasExistingBattery` AUS DER EXTRAKTION WIRD VERWORFEN ──────────────────────────────────
 * Der Extraktor liest es mit (der öffentliche Rechner braucht es, weil dort die Frage NUR im Satz
 * steht). Im Wizard steht sie als Weiche darüber und ist bereits beantwortet — ein zweites,
 * womöglich widersprüchliches Signal aus dem Fliesstext wäre verwirrend, nicht hilfreich. Es
 * erreicht deshalb weder ein Feld noch den Entwurf.
 */

/**
 * Der gemeinsame Schreibweg beider Batterie-Actions: Entwurf frisch lesen, Werte hineinfalten,
 * EINMAL schreiben.
 *
 * ⚠ FRISCH LESEN IST PFLICHT, nicht Vorsicht: `update_metering_point_draft` ERSETZT den Entwurf
 * (bewusst — eine flache Verschmelzung könnte einen Schlüssel nie wieder entfernen). Wer einen
 * Stand aus der Zeit des Seitenaufbaus hineingibt, macht jede Angabe rückgängig, die seither
 * dazugekommen ist — etwa eine in einem zweiten Tab hochgeladene Rechnung.
 *
 * `measured` für alle: der Admin trägt ein, was der Kunde über SEINE Anlage sagt. Als Annahme
 * gekennzeichnet trüge die Angabe dauerhaft den Vorbehalt einer Schätzung, und der Report wiese
 * sie bis zum Schluss als unsicher aus (Delta §3.2).
 *
 * @returns `null`, wenn geschrieben wurde — sonst der Fehlerzustand für das Formular.
 */
async function writeBatteryDraft(
  projectId: string,
  meteringPointId: string,
  values: { field: string; value: DraftValue }[],
  context: string,
): Promise<AdminState | null> {
  const supabase = await createClient()

  const listRes = await supabase.rpc('list_metering_points', { p_project_id: projectId })
  if (listRes.error) {
    if (isForbidden(listRes.error)) return { formError: FORBIDDEN }
    console.error(`[admin/dateneingabe] list_metering_points (${context}):`, listRes.error)
    return { formError: GENERIC }
  }

  const point = readMeteringPointList(listRes.data)?.find(
    (candidate) => candidate.id === meteringPointId,
  )
  if (!point) {
    return { formError: 'Diesen Zählpunkt gibt es nicht (mehr). Bitte laden Sie die Seite neu.' }
  }

  let nextDraft = point.draft
  const now = new Date()
  for (const { field, value } of values) {
    nextDraft = setDraftField(nextDraft, field, value, 'measured', undefined, now)
  }

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie in den übrigen Entwurf-Schreibwegen: zur Laufzeit dasselbe.
    p_draft: nextDraft as Json,
  })

  if (draftRes.error) {
    if (isForbidden(draftRes.error)) return { formError: FORBIDDEN }
    console.error(`[admin/dateneingabe] update_metering_point_draft (${context}):`, draftRes.error)
    return { formError: GENERIC }
  }
  if (statusOf(draftRes.data) !== 'ok') {
    console.error(`[admin/dateneingabe] unerwartete Antwort (${context}):`, draftRes.data)
    return { formError: GENERIC }
  }

  // Die Station zeigt den erfassten Stand aus der DATENBANK — s. Kopf dieser Datei.
  revalidatePath(projectDataEntryHref(projectId))
  return null
}

/**
 * Der Nein-Zweig: „Soll die Analyse einen Speichervorschlag enthalten?"
 *
 * ⚠ SIE SCHREIBT GENAU EIN FELD — `wantsBatteryRecommendation`. Keines der vier Kenndaten-Felder
 * und auch kein `hasBattery` (Begründung im Kopf dieses Abschnitts). Der Wert ist ein echter
 * Wahrheitswert, kein Vorhandensein eines Schlüssels: „nein, ausdrücklich kein Vorschlag" ist eine
 * Angabe und muss von „dazu wurde nichts gefragt" unterscheidbar bleiben.
 */
export async function saveMeteringPointBatteryChoiceAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const answer = String(formData.get('wantsRecommendation') ?? '')
  if (answer !== 'ja' && answer !== 'nein') {
    // Erreichbar nur an den zwei Knöpfen vorbei — die schicken feste Werte.
    return { formError: GENERIC }
  }
  const wants = answer === 'ja'

  const failure = await writeBatteryDraft(
    projectId,
    meteringPointId,
    [{ field: BATTERY_RECOMMENDATION_KEY, value: wants }],
    'Speichervorschlag',
  )
  if (failure) return failure

  return {
    success: wants
      ? 'Vermerkt: Die Analyse soll einen Speichervorschlag enthalten.'
      : 'Vermerkt: Es wird kein Speicher vorgeschlagen.',
  }
}

/**
 * Warum ein Freitext nicht ausgelesen werden konnte — die Zustände des Extraktors, in einem Satz.
 *
 * Dieselbe Liste wie im öffentlichen Rechner (`battery-text-panel.tsx`), nur knapper: dort steht je
 * Zustand ein eigener Absatz, hier eine Zeile über dem Formular. `api_error` heisst nach aussen
 * „fehlgeschlagen" — was genau schiefging, geht den Eintragenden nichts an.
 */
const BATTERY_TEXT_FAILURE_TEXT: Record<'not_configured' | 'api_error' | 'unreadable', string> = {
  not_configured: 'Das Auslesen freier Angaben ist auf diesem Server nicht eingerichtet. Die vier Felder lassen sich trotzdem von Hand ausfüllen.',
  api_error:
    'Das Auslesen ist fehlgeschlagen. Bitte später noch einmal versuchen — oder die vier Felder von Hand ausfüllen.',
  unreadable:
    'Aus dieser Angabe liessen sich keine Kenndaten lesen. Nötig sind die nutzbare Kapazität in kWh und die Lade-/Entladeleistung in kW; hilfreich ist zusätzlich der Wirkungsgrad.',
}

/**
 * Liest die Kenndaten aus einem frei formulierten Satz und gibt sie als Formularwerte zurück.
 *
 * ⚠ SIE SCHREIBT NICHTS. Zwischen dem Gelesenen und dem Gespeicherten steht ein zweiter, eigener
 * Klick — dasselbe Muster wie beim Preisblatt-Vorschlag der Rechnungs-Station und wie im
 * öffentlichen Rechner: der Vorschlag ist eine ANGEFORDERTE Auskunft, was damit geschieht,
 * entscheidet ein Mensch.
 *
 * ⚠ DIE PRÜFUNG LÄUFT VOR JEDEM EXTERNEN KONTAKT. Eine Server Action ist über ihre Kennung
 * aufrufbar, und jeder Aufruf ist abrechenbar — die Kürzung auf `MAX_BATTERY_TEXT_CHARS` und die
 * Leerprüfung sind deshalb eine echte Sperre, keine Bedienhilfe (das `maxlength` des Textfelds ist
 * eine Angabe des Browsers).
 *
 * ── ⚠ „GELESEN, ABER KEINE ZAHL" WIRD WIE „NICHTS GELESEN" BEHANDELT ──────────────────────────
 * Der Extraktor meldet `unreadable` nur, wenn ALLE fünf Felder leer sind — `hasExistingBattery`
 * eingeschlossen. Ein Satz wie „ja, wir haben einen Speicher" liefert damit ein `ok` ohne eine
 * einzige Zahl. Würde das als Erfolg durchgereicht, leerte es die vier Felder und behauptete
 * dabei, es habe etwas gelesen. Es bekommt deshalb denselben Satz — und die Felder bleiben, wie
 * sie sind.
 */
export async function extractBatteryTextFromAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const text = String(formData.get('batteryText') ?? '').trim()
  if (text === '') {
    return {
      fieldErrors: {
        batteryText: 'Bitte den Speicher kurz beschreiben — oder die Felder von Hand ausfüllen.',
      },
    }
  }

  const outcome = await extractBatteryText(text.slice(0, MAX_BATTERY_TEXT_CHARS))
  if (!outcome.ok) return { formError: BATTERY_TEXT_FAILURE_TEXT[outcome.reason] }

  /*
   * ⚠ ALLE VIER FELDER WERDEN GESETZT, auch die nicht gelesenen (als Leerstring).
   *
   * Ein nicht gelesenes Feld stehen zu lassen hiesse, einen Wert aus einer FRÜHEREN Ablesung neben
   * frischen stehen zu haben, ohne dass man die beiden unterscheiden kann. Was hier erscheint, ist
   * die Aussage GENAU DIESES Satzes — nicht mehr und nicht weniger. Der Preis ist benannt und in
   * der Oberfläche ausgeschrieben: eine von Hand eingetippte Zahl verliert man mit einem zweiten
   * Klick auf „Auslesen".
   */
  const values: Record<string, string> = {}
  let found = 0
  for (const entry of BATTERY_VALUE_FIELDS) {
    const value = outcome.extraction[entry.form]
    if (value === null) {
      values[entry.form] = ''
      continue
    }
    values[entry.form] = formatBatteryNumber(value)
    found += 1
  }

  if (found === 0) return { formError: BATTERY_TEXT_FAILURE_TEXT.unreadable }

  /*
   * Der Marker unterscheidet „eben gelesen" von „noch nie gelaufen" — der Zustand aus
   * `useActionState` ist beim ersten Render leer, und ein leeres `values` sähe genauso aus.
   * Dieselbe Form wie `lookup === 'ok'` bei der manuellen Tarifeingabe.
   */
  values.extraction = 'ok'
  values.found = String(found)
  return { values }
}

/**
 * Der Ja-Zweig: die vier Kenndaten in den Entwurf.
 *
 * ── DIE REIHENFOLGE ────────────────────────────────────────────────────────────────────────────
 *   1. alle gefüllten Felder prüfen (ein Fehler bricht VOR jedem Schreibvorgang ab — ein halb
 *      übernommenes Formular wäre der Zustand, den niemand nachvollziehen kann)
 *   2. Entwurf frisch lesen, Werte hineinfalten, EINMAL schreiben (`writeBatteryDraft`)
 *
 * ── ⚠ `hasBattery: true` WIRD IMMER GESCHRIEBEN, AUCH OHNE EINE EINZIGE ZAHL ──────────────────
 * „Es gibt einen Speicher, die Kenndaten fehlen noch" ist eine Angabe und nicht dasselbe wie „dazu
 * ist nichts erfasst": das eine ist eine Lücke, die der KI-Check benennen kann, das andere eine
 * Frage, die niemand gestellt hat. Deshalb hier ausdrücklich KEINE Sperre „mindestens ein Wert",
 * anders als bei der manuellen Tarifeingabe — dort gäbe es ohne Eingabe wirklich nichts zu
 * schreiben.
 *
 * ── EIN LEERES FELD IST KEINE ANGABE ──────────────────────────────────────────────────────────
 * Es wird übersprungen, nicht als `null` geschrieben: ein zuvor erfasster Wert bleibt dadurch
 * stehen, statt von einem leeren Formularfeld gelöscht zu werden. Dieselbe schonende Richtung wie
 * bei der manuellen Tarifeingabe und beim Widerspruch zweier Rechnungen.
 */
export async function saveMeteringPointBatteryAction(
  _prev: AdminState,
  formData: FormData,
): Promise<AdminState> {
  const projectId = readProjectId(formData)
  if (projectId === null) return { formError: UNKNOWN_PROJECT }

  const meteringPointId = String(formData.get('meteringPointId') ?? '')
  if (!UUID.test(meteringPointId)) return { formError: GENERIC }

  const fieldErrors: Record<string, string> = {}
  const values: { field: string; value: DraftValue }[] = [
    { field: BATTERY_PRESENT_KEY, value: true },
  ]

  for (const entry of BATTERY_VALUE_FIELDS) {
    const parsed = parseBatteryNumber(String(formData.get(entry.form) ?? ''), entry.max)
    if (parsed === undefined) continue
    if (parsed === null) {
      fieldErrors[entry.form] =
        entry.max === undefined
          ? 'Bitte eine Zahl grösser als 0 eintragen, z. B. 19,2.'
          : `Bitte eine Zahl zwischen 0 und ${entry.max} eintragen, z. B. 90.`
      continue
    }
    values.push({ field: entry.field, value: parsed })
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const failure = await writeBatteryDraft(
    projectId,
    meteringPointId,
    values,
    'Batterie',
  )
  if (failure) return failure

  // `values` trägt immer `hasBattery` — gezählt werden die Kenndaten daneben.
  const count = values.length - 1
  return {
    success:
      count === 0
        ? 'Vermerkt: Es ist bereits ein Speicher vorhanden. Kenndaten wurden keine erfasst — sie lassen sich hier jederzeit nachtragen.'
        : count === 1
          ? 'Eine Angabe zum vorhandenen Speicher wurde übernommen. Leer gelassene Felder bleiben unverändert.'
          : `${count} Angaben zum vorhandenen Speicher wurden übernommen. Leer gelassene Felder bleiben unverändert.`,
  }
}
