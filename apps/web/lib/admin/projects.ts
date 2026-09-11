/**
 * Vokabular und Antwort-Leser des Admin-Abschnitts „Kalkulator-Projekte" (B24, Teil 1 Schritt 1).
 *
 * REIN: kein `server-only`, kein `next/*` — die Seiten lesen die Typen, das Client-Formular die
 * Beschriftungen, die Server Action die Pfade. Gleiche Aufteilung wie `lib/admin/leads.ts` (B1-3),
 * `lib/admin/analyses.ts` (B14-2) und `lib/admin/open-questions.ts` (B24, zehnter Bauschritt).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE ADRESSE IST `/admin/kalkulator-projekte` UND AUSDRÜCKLICH NICHT `/admin/kalkulator/…`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `AdminNav` markiert einen Punkt als aktiv, sobald der Pfad ihm GLEICH ist oder mit `<href>/`
 * beginnt. `/admin/kalkulator/projekte` fiele damit unter den bestehenden Punkt „Kalkulator" —
 * zwei Punkte stünden gleichzeitig aktiv, und niemand wüsste, wo er ist. Genau deshalb heisst der
 * Prüf-Eingang seit B18-4 `/admin/kalkulator-anfragen` und nicht `/admin/kalkulator/anfragen`; die
 * Pflege der Preisblätter (B21-2b) und Martins Posteingang (B24) folgen derselben Regel.
 *
 * Es sind Geschwister, kein Paar aus Ober- und Unterpfad. Gemessen von der Präfix-Probe über ALLE
 * Navigationspunkte in `lib/admin/calculator-requests-ui.test.ts` — und zusätzlich hier, damit die
 * Begründung neben der Konstante steht, die sie trägt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ `admin_list_projects` UND `admin_get_project` LIEFERN SEIT 20260911090000 segment UND industry
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Beide führen eine AUSGESCHRIEBENE Spaltenliste; bis zu dieser Migration erschienen die zwei
 * Felder deshalb nirgends, obwohl die Spalten seit dem zweiten bzw. fünften Bauschritt existieren
 * und der Chat sie füllt. Erweitert wurde der RUMPF, nicht die Signatur (`create or replace` —
 * die Grants bleiben, ein DROP hätte sie mitgenommen). Das DB-Gate
 * (`packages/db-tests/src/metering-points.test.ts`) misst beides: genau eine Überladung, Grants
 * unverändert, und beide Felder kommen bei einem ECHTEN Aufruf wirklich an.
 */

/** Basispfad des Abschnitts — ohne Locale-Präfix, wie der ganze Admin-Bereich. */
export const PROJECTS_HREF = '/admin/kalkulator-projekte'

/** Pfad der Detailseite eines Projekts. */
export function projectHref(id: string): string {
  return `${PROJECTS_HREF}/${id}`
}

/**
 * Spiegel des CHECK auf `platform.projects.segment` (`check (segment in ('privat','betrieb'))`).
 *
 * Als Konstante zulässig aus demselben Grund wie `ANALYSIS_KINDS` (B14-2): kurze, GESCHLOSSENE
 * Liste — das Delta nennt sie in §4.1 ausdrücklich als zweiwertige Achse. Weicht sie ab, lehnt die
 * Datenbank den Wert ohnehin ab.
 *
 * ⚠ NICHT zu verwechseln mit `industry`: die ist laut Delta §4.1 eine OFFENE Liste (Branchen-Pools
 * sollen ohne Schema-Änderung entstehen) und hat deshalb hier bewusst KEINE Werteliste.
 */
export const PROJECT_SEGMENTS = ['privat', 'betrieb'] as const
export type ProjectSegment = (typeof PROJECT_SEGMENTS)[number]

export const PROJECT_SEGMENT_LABELS: Record<ProjectSegment, string> = {
  privat: 'Privat',
  betrieb: 'Betrieb',
}

/**
 * Beschriftung eines Segments — oder `null`, wenn keines gesetzt ist.
 *
 * ⚠ `null` HEISST „DAS GESPRÄCH HAT ES NOCH NICHT BESTIMMT", NICHT „PRIVAT". Der Spaltenkommentar
 * in der Migration sagt genau das. Eine Ansicht, die hier auf „Privat" zurückfiele, behauptete eine
 * Angabe, die niemand getroffen hat — und die entscheidet, welcher Fragen-Pool gilt. Deshalb gibt
 * es keinen Vorgabewert: die Seite zeigt in diesem Fall gar nichts.
 *
 * Ein unbekannter Wert wird DURCHGEREICHT statt verschluckt: er stünde so in der Datenbank, und
 * eine Ansicht, die ihn verschweigt, machte einen Pflegefehler unsichtbar.
 */
export function projectSegmentLabel(segment: string | null): string | null {
  if (segment === null || segment === '') return null
  return PROJECT_SEGMENT_LABELS[segment as ProjectSegment] ?? segment
}

/**
 * Eine Zeile aus `public.admin_list_projects`.
 *
 * Der Typ ist eine BEHAUPTUNG über die Migration, kein Beweis (der Wrapper gibt `jsonb` zurück) —
 * deshalb lesen die Funktionen unten defensiv (Muster `lib/admin/analyses.ts`).
 */
export type AdminProjectRow = {
  id: string
  /**
   * `null` = ein Admin hat das Projekt angelegt (Delta §2.2). NICHT „Konto gelöscht" — das wäre
   * zwar auch `null` (`on delete set null`), ist aber von aussen nicht unterscheidbar; die Ansicht
   * sagt deshalb „ohne Kundenkonto" und nicht „vom Admin angelegt".
   */
  account_id: string | null
  /**
   * DENORMALISIERT an `platform.projects` (B14-1-Muster): der Name überlebt das Konto. Genau
   * deshalb ist er die einzige Angabe, an der ein Mensch ein Projekt in einer Liste wiedererkennt.
   */
  customer_label: string
  segment: string | null
  industry: string | null
  created_by: string | null
  created_by_email: string | null
  created_at: string
  updated_at: string
}

/** Der Projektkopf aus `public.admin_get_project` — dieselben Felder, eine Zeile. */
export type AdminProjectHead = AdminProjectRow

export type AdminProjectList = {
  total: number
  projects: AdminProjectRow[]
}

function asObject(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null
}

/**
 * `null` = der Wrapper hat NICHT `ok` gemeldet — das ist NICHT dasselbe wie „es gibt keine
 * Projekte".
 *
 * Der Unterschied ist hier nicht theoretisch: eine LEERE Liste ist der erwartete Anfangszustand
 * (es hat noch nie jemand ein Projekt angelegt), und die Seite zeigt dafür das Anlage-Formular.
 * „Konnte nicht geladen werden" heisst das Gegenteil, und beides gleich darzustellen führte dazu,
 * dass jemand ein zweites Projekt anlegt, weil das erste scheinbar fehlt.
 */
export function readAdminProjectList(data: unknown): AdminProjectList | null {
  const obj = asObject(data)
  if (!obj || obj.status !== 'ok') return null

  return {
    total: typeof obj.total === 'number' ? obj.total : 0,
    projects: Array.isArray(obj.projects) ? (obj.projects as AdminProjectRow[]) : [],
  }
}

/**
 * `null` = nicht gelesen; `'not_found'` = es gibt das Projekt nicht. Zwei verschiedene Aussagen.
 *
 * ⚠ DIESE FUNKTION STAND BIS ZU DIESEM SCHRITT IN `lib/admin/open-questions.ts` und ist hierher
 * gewandert — nicht kopiert. Sie liest `public.admin_get_project`, und dieser Wrapper hat mit
 * diesem Bauschritt zwei Felder dazubekommen; in zwei Fassungen nebeneinander liefen die beiden
 * Leser beim nächsten Umbau auseinander, und eine von beiden Ansichten zeigte dann eine Angabe
 * nicht, die vorhanden ist. Der Rückfragen-Bereich importiert sie jetzt von hier.
 */
export function readAdminProject(data: unknown): AdminProjectHead | 'not_found' | null {
  const obj = asObject(data)
  if (!obj) return null
  if (obj.status === 'not_found') return 'not_found'
  if (obj.status !== 'ok') return null
  const project = asObject(obj.project)
  return project ? (project as AdminProjectHead) : null
}
