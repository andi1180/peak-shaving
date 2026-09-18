/**
 * Report-Baukasten C — die Bausteine, die ein Mensch vor dem Renderlauf abwählen kann.
 *
 * ── ⚠ WARUM DAS IN `shared` LIEGT UND NICHT IN `apps/website` ─────────────────────────────────
 * Die Liste hat zwei Konsumenten in verschiedenen Apps: den SCHREIBENDEN Schritt (`apps/web`, der
 * Admin kreuzt an und legt die Auswahl in `report_input_meta` ab) und den LESENDEN (`apps/website`,
 * der Report wertet sie aus). Zwei Listen liefen auseinander — und der Fehler wäre still: eine
 * Kennung mit Tippfehler käme als „abgewählt" an, weil sie in der Auswahl fehlt.
 *
 * ── ⚠ ES SIND FÜNF UND NICHT 28 ───────────────────────────────────────────────────────────────
 * Der Katalog kennt 28 Bausteine (`apps/website/lib/pdf-report/registry.ts`). Freigegeben ist, wer
 * ohne eingehenden Verweis dasteht ODER wessen eingehende Verweise ihre Fassung OHNE ihn
 * mittragen — `table_candidates` ist mit B3-1 der erste Fall dieser zweiten Art (Stufe D).
 *
 * Nicht dabei und ausdrücklich nicht vergessen: `addon` — Kapitel 2 verweist darauf („steht auf
 * der Kernergebnis-Seite", `recommendation.ts`). Der Verweis ist zwar migriert, aber sein Ziel
 * kann in Block 3 Nr. 18 die Kennung wechseln; freigegeben wird er erst danach.
 * Fundstellen und Messung: `Report_Baukasten_Auswahlschicht_Verifikation.md` §2,
 * `Report_Baukasten_Block3_Plan.md` §1.5.
 */

/**
 * Die Kennungen, in Dokumentreihenfolge (Kapitel 5 vor Kapitel 6 vor Kapitel 8).
 *
 * ⚠ Sie sind wörtlich die `ReportBaukastenId`-Werte des Katalogs; dass sie eine TEILMENGE davon
 * sind, wird in `registry.ts` typseitig erzwungen — dieses Paket kennt den Katalog nicht.
 */
export const REPORT_OPTIONAL_SECTIONS = [
  'hour_flow',
  'charge_price',
  'table_candidates',
  'data_quality',
  'pv_outage',
] as const

export type ReportOptionalSection = (typeof REPORT_OPTIONAL_SECTIONS)[number]

/**
 * Die Auswahl einer Übergabe. `undefined` heisst **alle** und ist nicht dasselbe wie `[]`.
 *
 * ⚠ DIE UNTERSCHEIDUNG IST PFLICHT UND KEINE FEINHEIT: eine Übergabe lebt 24 Stunden, es liegen
 * zum Zeitpunkt jedes Deployments also Zeilen ohne das Feld in `platform.report_render_requests`.
 * Fiele die Abwesenheit auf `[]`, verlöre ein bereits verschickter Report beim Öffnen sämtliche
 * abwählbaren Bausteine — und niemand sähe, warum.
 */
export type ReportSectionSelection = readonly ReportOptionalSection[] | undefined

/** Steht dieser Baustein im Report? */
export function reportSectionEnabled(
  selection: ReportSectionSelection,
  id: ReportOptionalSection,
): boolean {
  return selection === undefined || selection.includes(id)
}

/**
 * Eine Auswahl aus einer fremd geformten Quelle lesen — `report_input_meta` (jsonb, ohne Struktur)
 * oder einem `FormData`.
 *
 * ⚠ GEFILTERT STATT GEPRÜFT, und die Reihenfolge kommt aus der KONSTANTE: ein unbekannter Eintrag
 * fällt heraus, statt die ganze Auswahl zu verwerfen. Anders als bei den Monatsnamen des PV-Befunds
 * (`readPvOutageMonths`) landet hier nichts auf dem Kundendokument, was falsch aussehen könnte — es
 * entscheidet nur, ob ein Baustein steht. Eine wegen eines fremden Eintrags komplett verworfene
 * Auswahl zeigte dagegen wieder alle und sähe aus, als hätte der Admin nichts angekreuzt.
 *
 * ⚠ `undefined` bei allem, was keine Liste ist — s. `ReportSectionSelection`.
 */
export function readReportSectionSelection(value: unknown): ReportOptionalSection[] | undefined {
  if (!Array.isArray(value)) return undefined
  return REPORT_OPTIONAL_SECTIONS.filter((id) => value.includes(id))
}

/**
 * Die zwei Formularfelder, über die die Auswahl den Trigger-Aufruf erreicht.
 *
 * ⚠ SIE STEHEN HIER UND NICHT IN DER SERVER ACTION: eine `'use server'`-Datei darf ausschliesslich
 * asynchrone Funktionen exportieren — eine Konstante daneben ist ein Build-Fehler. Und sie werden
 * an zwei Stellen gebraucht: die Kachel schreibt sie, die Aktion liest sie.
 *
 * ⚠ ZWEI FELDER UND NICHT EINES. Ein unangekreuztes Kontrollkästchen sendet NICHTS; „alle
 * abgewählt" und „dieses Formular führt die Auswahl gar nicht" sähen ohne den Marker gleich aus —
 * und sie bedeuten das Gegenteil voneinander (keinen zeigen / alle zeigen).
 */
export const REPORT_OPTIONAL_SECTIONS_FIELD = 'optionalSections'
export const REPORT_OPTIONAL_SECTIONS_MARKER = 'optionalSectionsChoice'
