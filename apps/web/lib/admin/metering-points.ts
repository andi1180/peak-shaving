/**
 * Antwort-Leser für `public.list_metering_points` im Admin-Bereich (B24, Teil 1).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — die Seite ruft den Wrapper und
 * reicht die rohe Antwort herein. Gleiche Aufteilung und gleicher defensiver Stil wie
 * `readAdminProjectList` in `lib/admin/projects.ts`: der Typ ist eine BEHAUPTUNG über die Migration,
 * kein Beweis (der Wrapper gibt `jsonb` zurück).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM ES DIESEN LESER GIBT, OBWOHL ES SCHON EINEN FÜR DIESELBE FUNKTION GIBT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `listMeteringPoints` in `lib/project-chat/supabase-ports.ts` liest denselben Wrapper und ist
 * dort richtig: es FÄLLT BEI EINEM LESEFEHLER AUF DIE LEERE LISTE ZURÜCK, weil das für den
 * Ausführer die sichere Aussage ist („es gibt keinen Zählpunkt, an den ich schreiben könnte").
 *
 * Für den Wizard ist genau dieser Rückfall gefährlich, und zwar konkret: Die Zahl der Zählpunkte
 * entscheidet, WELCHE Station gilt. Eine leere Liste führt auf den Zählpunkt-Schritt, und dessen
 * Formular ruft `admin_set_metering_point_count` — einen Wrapper, der eine bestehende Zahl auch
 * VERKLEINERT. Ein Lesefehler brächte damit einen Admin dazu, „2" einzutragen, während drei
 * Zählpunkte existieren, und der dritte wäre weg. `null` heisst hier deshalb „nicht gelesen", und
 * die Seite zeigt dann gar keinen Wizard (fail closed) statt der Startseite eines leeren Projekts.
 *
 * Der Wrapper selbst ist der richtige Leseweg für eine Server-Komponente im Admin-Bereich, und der
 * naheliegende zweite ist keiner: `public.admin_get_project` liefert AUSSCHLIESSLICH den
 * Projektkopf (`id, account_id, customer_label, segment, industry, created_by, created_by_email,
 * created_at, updated_at` — Migration 20260911090000 TEIL 3) und kennt die Zählpunkte gar nicht.
 * `list_metering_points` prüft `platform.project_accessible`, und die trägt seit dem Chat-Zustand
 * `or platform.is_admin()` — ein Admin erreicht damit jedes Projekt, ohne dass es dafür einen
 * eigenen `admin_*`-Zwilling bräuchte.
 */

/**
 * Was der Wizard von einem Zählpunkt braucht.
 *
 * Bewusst KEIN Abbild der ganzen Zeile: `interval_minutes`, `covered_from`/`covered_to`, `gaps` und
 * `draft` gehören zu den Schritten, die es in diesem Bauabschnitt noch nicht gibt. Sie hier schon
 * mitzulesen erzeugte Felder ohne Leser — und beim Füllen der Stationen nähme sich der nächste
 * Schritt die Freiheit, sie anders auszulegen als der Chat es tut.
 */
export type MeteringPointSummary = {
  id: string
  /**
   * `source_document_id` gesetzt. Das ist die Angabe, an der
   * `admin_set_metering_point_count` ein Verkleinern verweigert (`has_load_profile`) — die
   * Oberfläche kann damit sagen, warum, bevor jemand es versucht.
   */
  hasLoadProfile: boolean
}

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/**
 * `null` = der Wrapper hat NICHT `ok` gemeldet. Das ist NICHT „keine Zählpunkte" — s. Kopf.
 *
 * Die Reihenfolge kommt unverändert aus der Datenbank (älteste zuerst) und wird hier NICHT
 * nachsortiert: die Position in dieser Liste ist die Zählpunkt-Nummer des Wizards, und eine zweite
 * Ordnung darüber machte aus „Zählpunkt 1" je nach Ansicht einen anderen.
 */
export function readMeteringPointList(data: unknown): MeteringPointSummary[] | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null
  if (!Array.isArray(obj.metering_points)) return null

  const rows: MeteringPointSummary[] = []
  for (const raw of obj.metering_points as unknown[]) {
    const row = asObject(raw)
    const id = row?.id
    // Eine Zeile ohne Kennung ist keine — sie zu zählen erzeugte eine Station ohne Gegenstück.
    if (typeof id !== 'string' || id === '') continue
    rows.push({ id, hasLoadProfile: typeof row?.source_document_id === 'string' })
  }
  return rows
}
