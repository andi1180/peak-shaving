/**
 * B24, Teil 1 — die geteilten Helfer der Dateneingabe-Actions.
 *
 * ⚠ KEIN `'use server'`. Dieses Modul exportiert Konstanten und synchrone Funktionen; in einer
 * `'use server'`-Datei sind ausschliesslich asynchrone Exporte zulässig, und jeder Export würde
 * dort zu einem über seine Kennung aufrufbaren Endpunkt. Es ist rein intern und wird vom Barrel
 * `data-entry-actions.ts` bewusst NICHT re-exportiert.
 */

import { revalidatePath } from 'next/cache'
import {
  DRAFT_PROVENANCE_KEY,
  dropInapplicableBillingModel,
  readDraftProvenance,
  setDraftField,
  type DraftValue,
} from '@/lib/project-chat/draft'
import { createClient } from '@/lib/supabase/server'
import { readMeteringPointList } from './metering-points'
import { projectDataEntryHref } from './projects'
import type { AdminState } from './schema'
import type { Json } from '@/db-types'

export const FORBIDDEN = 'Keine Berechtigung. Bitte laden Sie die Seite neu.'
export const GENERIC = 'Das hat nicht geklappt. Bitte versuchen Sie es erneut.'
export const UNKNOWN_PROJECT = 'Dieses Projekt gibt es nicht (mehr). Bitte laden Sie die Seite neu.'

/** SQLSTATE 42501 = insufficient_privilege. Die Rolle wurde zwischen Aufbau und Klick entzogen. */
export function isForbidden(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42501'
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Die Projekt-Kennung kommt als verstecktes Feld aus unserer eigenen Seite — eine unbrauchbare
 * kann also nur von einem Aufruf daneben stammen. Sie trotzdem hier zu prüfen erspart einen rohen
 * `22P02 invalid input syntax for type uuid`, aus dem die Oberfläche keinen Satz bilden kann.
 */
export function readProjectId(formData: FormData): string | null {
  const value = String(formData.get('projectId') ?? '')
  return UUID.test(value) ? value : null
}

export function statusOf(data: unknown): unknown {
  return (data as { status?: unknown } | null)?.status
}


/*
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ AB HIER: HELFER, DIE MEHRERE STATIONEN BRAUCHEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie standen bis zur Aufteilung in `data-entry-actions.ts` und wurden dort stationsübergreifend
 * benutzt (`formatMegabytes` in Lastgang/Batterie/PV, `AUSTRIA_TIME_ZONE` in Lastgang/Rechnung,
 * `PDF_MEDIA_TYPE` in Rechnung/Batterie/PV, `writeMeteringPointDraftFields` in Batterie/PV).
 *
 * ⚠ SIE KÖNNEN NICHT AUS EINER STATIONS-DATEI EXPORTIERT WERDEN. Die tragen `'use server'`, und
 * dort ist jeder Export ein über seine Kennung aufrufbarer Endpunkt: eine Konstante bricht den
 * Build, und `writeMeteringPointDraftFields` — asynchron — würde zu einer öffentlich aufrufbaren
 * Action, die einen fremden Entwurf überschreiben kann. Ihr Fundort ist deshalb dieses Modul.
 */

/** Dateigrösse in MB mit einer Nachkommastelle — nur für die Meldung am Feld. */
export function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',')
}


/**
 * Die Zeitzone, in der dieses Werkzeug rechnet — EIN Fundort für den Wert.
 *
 * Sie hat zwei Konsumenten mit verschiedenen Fragen: das Standardprofil braucht sie als
 * Engine-Parameter (s. den Kommentar direkt darunter), der Tarif-Lookup als Grundlage des
 * KALENDERTAGS, gegen den eine effektiv datierte Preisblatt-Zeile ausgewählt wird. Zwei Literale
 * liefen beim ersten Umbau auseinander, und die Abweichung wäre an beiden Stellen still.
 */
export const AUSTRIA_TIME_ZONE = 'Europe/Vienna'

/** Nur PDF — die API erwartet den `document`-Block mit genau diesem Medientyp. */
export const PDF_MEDIA_TYPE = 'application/pdf'


/**
 * Der gemeinsame RAHMEN beider Entwurfs-Wege: frisch lesen, umformen, EINMAL schreiben, die
 * Station neu rendern lassen.
 *
 * ⚠ ER IST HERAUSGELÖST, WEIL ES SEIT DEM BATTERIE-LÖSCHWEG ZWEI UMFORMUNGEN GIBT — Felder
 * hineinfalten und Felder entfernen. Der Rahmen ist für beide Wort für Wort derselbe (dieselbe
 * Fehlerbehandlung, dieselbe Zählpunkt-Prüfung, derselbe `revalidatePath`); zweimal ausgeschrieben
 * liefe er beim ersten Umbau auseinander, und zwar an der unauffälligsten Stelle: eine der beiden
 * Kopien vergässe das Neurendern, und die Station zeigte weiter einen Stand, den es nicht mehr
 * gibt. Was sich unterscheidet, ist ausschliesslich `transform`.
 *
 * ⚠ FRISCH LESEN IST PFLICHT, nicht Vorsicht: `update_metering_point_draft` ERSETZT den Entwurf
 * (bewusst — eine flache Verschmelzung könnte einen Schlüssel nie wieder entfernen). Wer einen
 * Stand aus der Zeit des Seitenaufbaus hineingibt, macht jede Angabe rückgängig, die seither
 * dazugekommen ist — etwa eine in einem zweiten Tab hochgeladene Rechnung.
 *
 * @returns `null`, wenn geschrieben wurde — sonst der Fehlerzustand für das Formular.
 */
async function updateMeteringPointDraft(
  projectId: string,
  meteringPointId: string,
  transform: (draft: Record<string, unknown>) => Record<string, unknown>,
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

  const draftRes = await supabase.rpc('update_metering_point_draft', {
    p_metering_point_id: meteringPointId,
    // Zusicherung wie in den übrigen Entwurf-Schreibwegen: zur Laufzeit dasselbe.
    p_draft: dropInapplicableBillingModel(transform(point.draft)) as Json,
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
 * Werte in den Entwurf eines Zählpunkts falten.
 *
 * ⚠ ER HIESS BIS ZUR PV-STATION `writeBatteryDraft`, und der Name war schon damals zu eng: der
 * Rumpf kennt keine Batterie, er faltet eine Liste von Feldern in den Entwurf. Mit der PV-Station
 * hat er einen dritten Aufrufer, der mit Batterien nichts zu tun hat — umbenannt statt von dort
 * aus einen `…BatteryDraft` zu rufen, was jeden Leser über die Zuständigkeit täuschte.
 *
 * `measured` für alle: der Admin trägt ein, was der Kunde über SEINE Anlage sagt. Als Annahme
 * gekennzeichnet trüge die Angabe dauerhaft den Vorbehalt einer Schätzung, und der Report wiese
 * sie bis zum Schluss als unsicher aus (Delta §3.2).
 *
 * @returns `null`, wenn geschrieben wurde — sonst der Fehlerzustand für das Formular.
 */
export async function writeMeteringPointDraftFields(
  projectId: string,
  meteringPointId: string,
  values: { field: string; value: DraftValue }[],
  context: string,
): Promise<AdminState | null> {
  const now = new Date()
  return updateMeteringPointDraft(
    projectId,
    meteringPointId,
    (draft) => {
      let next = draft
      for (const { field, value } of values) {
        next = setDraftField(next, field, value, 'measured', undefined, now)
      }
      return next
    },
    context,
  )
}

/**
 * Felder aus dem Entwurf eines Zählpunkts ENTFERNEN — samt ihrer Herkunfts-Vermerke.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DAS KEIN `setDraftField(…, null)` SEIN DARF
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der naheliegende Weg wäre, den Wert auf `null` zu setzen und alles Übrige gleich zu lassen. Das
 * löscht nichts: der SCHLÜSSEL stünde weiterhin im Entwurf, und sein Vermerk stünde weiterhin in
 * `_provenance` — nur mit leerem Inhalt. Für jeden Leser ist das eine ANGABE, keine Fehlanzeige.
 *
 * Es geht dabei nicht um Kosmetik, sondern um genau die Unterscheidung, die dieser Entwurf überall
 * sonst mit Sorgfalt trägt: `readBatteryDraft` liest `hasBattery === false` als „ausdrücklich keine
 * Anlage" und ein fehlendes Feld als „dazu ist nichts erfasst" (`battery-draft.ts`), und
 * `check_draft_completeness` zählt einen vorhandenen Schlüssel mit. Ein genulltes Feld landete
 * damit im schlechtesten aller Zustände — gelöscht gemeint, als Aussage gelesen. Deshalb: `delete`,
 * und „gelöscht" heisst, der Schlüssel existiert nicht mehr.
 *
 * ⚠ `DraftValue` KANN `null` GAR NICHT TRAGEN (`number | string | boolean`) — der falsche Weg wäre
 * also ohnehin eine Aufweichung dieses Typs gewesen, und die hätte JEDEN Schreibweg betroffen.
 *
 * Ein leer gewordenes `_provenance` wird selbst entfernt, aus demselben Grund: ein Seiteneintrag
 * ohne Einträge ist keine Herkunftsangabe, er sieht nur so aus.
 *
 * @returns `null`, wenn geschrieben wurde — sonst der Fehlerzustand für das Formular.
 */
export async function clearMeteringPointDraftFields(
  projectId: string,
  meteringPointId: string,
  fields: readonly string[],
  context: string,
): Promise<AdminState | null> {
  return updateMeteringPointDraft(
    projectId,
    meteringPointId,
    (draft) => {
      const next: Record<string, unknown> = { ...draft }
      /*
       * Gelesen und normalisiert wie in `setDraftField` — die Vermerke der ÜBRIGEN Felder wandern
       * dadurch in derselben Form zurück, in der jeder Schreibweg sie hinterlässt. Sie bleiben
       * nachweislich stehen; entfernt wird ausschliesslich, was `fields` nennt.
       */
      const provenance = readDraftProvenance(draft)
      for (const field of fields) {
        delete next[field]
        delete provenance[field]
      }
      if (Object.keys(provenance).length > 0) next[DRAFT_PROVENANCE_KEY] = provenance
      else delete next[DRAFT_PROVENANCE_KEY]
      return next
    },
    context,
  )
}
