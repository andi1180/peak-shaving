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

/** Ein Bereich ohne Messwerte, wie ihn `platform.metering_points.gaps` trägt. Halboffen: `[from, to)`. */
export type MeteringPointGapRange = {
  /** Erster Zeitpunkt OHNE Messwert, ISO/UTC. */
  from: string
  /** Erster Zeitpunkt, zu dem wieder ein Messwert vorliegt, ISO/UTC. */
  to: string
}

/**
 * Was der Wizard von einem Zählpunkt braucht.
 *
 * ── ⚠ DIE LASTGANG-METADATEN STEHEN SEIT DEM LASTGANG-SCHRITT HIER, `draft` SEIT DEM ZWEITEN ────
 * Der ursprüngliche Zuschnitt liess alle vier Metadaten-Felder bewusst weg, mit der Begründung
 * „Felder ohne Leser". Für `interval_minutes`, `covered_from`/`covered_to` und `gaps` gilt sie
 * nicht mehr: die Lastgang-Station ZEIGT genau diese vier — sie sind das Einzige, woran ein Mensch
 * erkennt, ob die hochgeladene Datei die richtige war. Sie aus dem Rückgabewert der Action zu
 * nehmen statt aus der Datenbank wäre die schlechtere Wahl: nach einem Neuladen stünde die Station
 * dann ohne Zusammenfassung da, obwohl gespeichert ist.
 *
 * ⚠ `draft` STAND HIER BIS ZUM STANDARDPROFIL-ZWEIG BEWUSST NICHT, mit derselben Begründung, und
 * dieselbe Begründung fällt jetzt weg: der Jahresverbrauch, aus dem ein erzeugtes Profil entstanden
 * ist, steht IM Entwurf (`annualConsumptionKwh` samt Herkunftsvermerk) — ihn nicht zu zeigen hiesse,
 * einen Zeitraum auszuweisen, dessen Grundlage der Admin nirgends sehen kann. Er bleibt ein rohes
 * `Record`: wie er AUSGELEGT wird, entscheidet `lib/admin/standard-profile.ts` für das eine Feld,
 * um das es hier geht; die übrigen gehören den Schritten, die es noch nicht gibt (Rechnung,
 * Batterie, PV, Tarif), und der Chat legt sie anders aus, als ein Formular es täte.
 */
export type MeteringPointSummary = {
  id: string
  /**
   * WOHER die Verbrauchsgrundlage dieses Zählpunkts stammt — `null`, solange es keine gibt.
   *
   * ⚠ DAS WAR BIS ZUM STANDARDPROFIL-ZWEIG EIN BOOLEAN (`hasLoadProfile`) AN `source_document_id`,
   * und genau das ging mit dem zweiten Weg kaputt: `set_metering_point_standard_profile` setzt die
   * Quelle ausdrücklich auf `null` (ein erzeugtes Profil hat keine Datei und soll keine
   * vortäuschen) und füllt trotzdem Intervall und Zeitraum. Ein Flag an der Quelle hätte danach
   * „kein Lastgang" gemeldet, während der Zählpunkt einen vollständigen Zeitraum trägt — die
   * Station stellte ihre Ja/Nein-Frage erneut, und die Übersicht zählte den Zählpunkt als leer.
   *
   * Es ist deshalb kein zweites Flag daneben geworden, sondern die HERKUNFT als eigene Aussage:
   * „gibt es eine Grundlage?" ist `profileSource !== null`, „kommt sie aus einer Datei?" ist
   * `=== 'upload'`. Zwei Flags nebeneinander liessen den vierten Zustand („beides") entstehen, den
   * es in der Datenbank nicht geben kann.
   *
   * ⚠ `'upload'` ist zugleich die Angabe, an der `admin_set_metering_point_count` ein Verkleinern
   * verweigert (`has_load_profile` prüft `source_document_id`) — ein Zählpunkt mit erzeugtem
   * Standardprofil lässt sich also sehr wohl wegkürzen. Das ist beabsichtigt: dabei geht eine Zahl
   * verloren, die neu eingetragen werden kann, keine hochgeladene Datei.
   */
  profileSource: 'upload' | 'standard' | null
  /** 15 oder 60, sobald ein Lastgang eingelesen wurde — sonst `null`. */
  intervalMinutes: number | null
  /** Beginn des ersten Intervalls mit Messwert, ISO/UTC — sonst `null`. */
  coveredFrom: string | null
  /**
   * ENDE des letzten Intervalls mit Messwert, ISO/UTC — sonst `null`.
   *
   * ⚠ OBERE KANTE EINES HALBOFFENEN BEREICHS (`[coveredFrom, coveredTo)`), nicht der letzte
   * Zeitstempel. Ein Jahreslastgang endet damit am 1. Jänner des FOLGEjahres um 00:00, und wer das
   * für einen Messwert hält, liest ein Intervall zu viel. Die Anzeige muss es benennen.
   */
  coveredTo: string | null
  /**
   * Die gespeicherten Lücken, in zeitlicher Reihenfolge. Leer = keine über der Toleranzschwelle
   * (`GAP_TOLERANCE_INTERVALS` in der Engine) — ausdrücklich NICHT „keine Angabe": ohne Lastgang
   * gibt es gar keine Zeile dazu, und das steht in `profileSource`.
   *
   * ⚠ Bei `profileSource === 'standard'` ist die Liste IMMER leer, und zwar per Konstruktion: ein
   * erzeugtes Profil ist lückenlos, und der Wrapper nimmt `gaps` gar nicht erst als Parameter.
   */
  gaps: MeteringPointGapRange[]
  /**
   * Der rohe Entwurf des Zählpunkts (`platform.metering_points.draft`), leer wenn keiner dasteht.
   *
   * Roh und nicht ausgelegt — s. Kopf. Der einzige heutige Leser ist die Lastgang-Station, und die
   * fragt über `readStandardProfileConsumption` nach genau EINEM Feld.
   */
  draft: Record<string, unknown>
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
    rows.push({
      id,
      profileSource: readProfileSource(row),
      intervalMinutes: typeof row?.interval_minutes === 'number' ? row.interval_minutes : null,
      coveredFrom: typeof row?.covered_from === 'string' ? row.covered_from : null,
      coveredTo: typeof row?.covered_to === 'string' ? row.covered_to : null,
      gaps: readGaps(row?.gaps),
      draft: readDraft(row?.draft),
    })
  }
  return rows
}

/**
 * Die Herkunft der Verbrauchsgrundlage aus einer rohen Zeile.
 *
 * ⚠ DIE REIHENFOLGE DER ZWEI PRÜFUNGEN IST DIE AUSSAGE. Eine gesetzte Quelle entscheidet ZUERST:
 * nur `set_metering_point_load_profile` schreibt eine, und die Funktion verlangt sie (der Fall
 * „Dokument gesetzt, Zeitraum leer" kann also nicht entstehen). Erst danach zählt der Zeitraum,
 * und dann kann er nur aus dem Erzeuger stammen.
 *
 * Gelesen wird `covered_from`, nicht `interval_minutes`: der CHECK der Tabelle verlangt die zwei
 * Zeitgrenzen gemeinsam oder gar nicht, das Intervall steht ohne eigene Bedingung daneben.
 */
/**
 * Der rohe Entwurf, defensiv wie der Rest dieses Lesers.
 *
 * ⚠ NICHT `asObject`: das lässt ein ARRAY durch (`typeof [] === 'object'`), und `jsonb` kann eines
 * tragen. Der einzige Leser ruft `readStandardProfileConsumption(point.draft)` ohne Guard — bei
 * einem Array käme dort still `undefined` heraus, also „keine Angabe" statt „dieser Entwurf ist
 * kaputt". Ein leeres Objekt ist die ehrlichere Antwort und die einzige, die der Typ zusagt.
 */
function readDraft(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readProfileSource(row: Record<string, unknown> | null): 'upload' | 'standard' | null {
  if (typeof row?.source_document_id === 'string') return 'upload'
  if (typeof row?.covered_from === 'string') return 'standard'
  return null
}

/**
 * Die Lücken einer Zeile.
 *
 * Defensiv wie der Rest dieses Lesers: `gaps` ist `jsonb`, der Typ ist eine Behauptung über die
 * Migration. Ein Eintrag ohne beide Grenzen wird ÜBERSPRUNGEN und nicht mit einem Platzhalter
 * gefüllt — eine Lücke „von — bis —" sähe aus wie eine gemessene und wäre keine. Fehlt der
 * gesamte Wert, ist die Liste leer; das ist derselbe Zustand wie „keine Lücke", und mehr sagt die
 * Datenbank an dieser Stelle auch nicht (`gaps` hat den Default `'[]'`).
 */
function readGaps(value: unknown): MeteringPointGapRange[] {
  if (!Array.isArray(value)) return []
  const out: MeteringPointGapRange[] = []
  for (const raw of value) {
    const gap = asObject(raw)
    if (typeof gap?.from !== 'string' || typeof gap?.to !== 'string') continue
    out.push({ from: gap.from, to: gap.to })
  }
  return out
}
