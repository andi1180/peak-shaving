'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  stationAfterMeteringPointCount,
  stationAfterSegment,
  stationHref,
} from './data-entry-stations'
import { PROJECT_SEGMENTS, type ProjectSegment } from './projects'
import type { AdminState } from './schema'
import {
  FORBIDDEN,
  GENERIC,
  UNKNOWN_PROJECT,
  isForbidden,
  readProjectId,
  statusOf,
} from './data-entry-actions-shared'

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

