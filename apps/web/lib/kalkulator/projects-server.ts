import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * B24 — DIE LESESEITE DES KUNDENSEITIGEN PROJEKTBEREICHS (achter Bauschritt).
 *
 * ── ⚠ `get_my_project`, NICHT `get_project` — und das ist der ganze Zugriffsschutz dieser Route ──
 * Es gibt ZWEI Lese-Wrapper für ein Projekt, und sie beantworten verschiedene Fragen:
 *   – `public.get_project` (B24 zweiter Bauschritt) prüft `platform.project_accessible`, also
 *     „eigenes Projekt ODER Adminrolle". Ihn benutzen die Chat-Ports und der Dokument-Upload.
 *   – `public.get_my_project` (B24 erster Bauschritt) prüft AUSSCHLIESSLICH das Eigentum.
 *
 * Der Kundenbereich nimmt den ZWEITEN. Der Unterschied wird erst mit dem Admin-Bereich sichtbar:
 * mit `get_project` sähe ein Admin, der die Adresse eines Kundenprojekts aufruft, dessen Chat in
 * der KUNDEN-Oberfläche — mit der Eingabezeile darunter. Er würde damit unter dem Konto des Kunden
 * in dessen Gespräch schreiben, und im Verlauf stünde es als Nachricht des Kunden. Die Admin-Sicht
 * ist ein eigener Schritt mit eigener Oberfläche; hier ist „gehört mir" die richtige Frage.
 *
 * „Gibt es nicht" und „gehört jemand anderem" liefern denselben Status — wer Kennungen
 * durchprobiert, soll nicht erfahren, welche existieren (durchgängige Nicht-Unterscheidbarkeit
 * dieses Schemas).
 */

export interface ProjectListRow {
  id: string
  customerLabel: string
  createdAt: string
  updatedAt: string
}

/** Die eigenen Projekte, neueste zuerst. Kein Konto oder keine Projekte → leere Liste. */
export async function readMyProjects(): Promise<
  { ok: true; projects: ProjectListRow[] } | { ok: false }
> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_my_projects')

  if (error) {
    console.error('[projekte] list_my_projects:', error)
    return { ok: false }
  }

  const result = data as { status?: string; projects?: unknown } | null
  if (result?.status !== 'ok' || !Array.isArray(result.projects)) {
    /*
     * ⚠ Ein Lesefehler ist NICHT dasselbe wie „noch keine Projekte". Beides gleich anzuzeigen
     * hiesse, jemandem mit laufenden Analysen zu sagen, er habe noch keine — und ihn zu einem
     * zweiten Projekt für dieselbe Sache einzuladen (dieselbe Unterscheidung wie im Partner-Portal
     * zwischen „leer" und „nicht abrufbar").
     */
    console.error('[projekte] list_my_projects: unerwartete Antwort')
    return { ok: false }
  }

  return {
    ok: true,
    projects: (result.projects as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      customerLabel: String(row.customer_label),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    })),
  }
}

/** EIN eigenes Projekt. `null` = gibt es nicht ODER gehört jemand anderem (bewusst dasselbe). */
export async function readMyProject(projectId: string): Promise<ProjectListRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_my_project', { p_id: projectId })

  if (error) {
    console.error('[projekte] get_my_project:', error)
    return null
  }

  const result = data as { status?: string; project?: Record<string, unknown> } | null
  if (result?.status !== 'ok' || !result.project) return null

  const row = result.project
  return {
    id: String(row.id),
    customerLabel: String(row.customer_label),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}
