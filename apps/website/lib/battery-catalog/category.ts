import type { BatteryCatalogCategory } from 'shared'

/**
 * WELCHE Katalog-Kategorie der öffentliche Rechner lädt — die EINE Stelle, an der das entschieden
 * wird (K3b). Rein, ohne Datenbank, ohne React: deshalb prüfbar.
 *
 * ── ⚠ DIE REGEL IST EIN RÜCKFALL, UND DAS IST GEMESSEN ─────────────────────────────────────────
 * Der Auftrag lautete: gibt es im öffentlichen Rechner eine AUSDRÜCKLICHE Privat/Gewerbe-Auswahl,
 * dann gilt die. Es gibt sie nicht — gesucht wurde über den gesamten 4-Schritt-Flow, und die
 * einzige Stelle, an der überhaupt eine Kundenklasse vorkommt, ist das Standardprofil
 * (`standard-profile-panel.tsx`, Auswahlfeld „Kundenklasse"). Es bleibt also der Rückfall:
 * Standardprofil mit Kundenklasse Haushalt → `heim`, alles andere → `gewerbe`.
 *
 * ── WARUM NICHT EINFACH `profile.source === 'standard_profile'` ────────────────────────────────
 * Weil die Kundenklasse mitreisen MUSS, sobald `kleingewerbe` wählbar wird (heute ist der Eintrag
 * im Auswahlfeld sichtbar, aber deaktiviert — Delta 9, „Transparenz gilt auch für Unfertiges").
 * Ein Rückschluss allein aus der Herkunft des Lastgangs wäre an dem Tag still falsch: ein
 * Kleingewerbe bekäme Heimspeicher vorgeschlagen, und es fiele niemandem auf.
 *
 * ── WARUM EIN HOCHGELADENER LASTGANG IMMER `gewerbe` IST ───────────────────────────────────────
 * Wer einen Viertelstunden-Lastgang seines Netzbetreibers hochlädt oder eine Netzrechnung scannt,
 * hat einen gewerblichen Anschluss — Haushalte bekommen diese Dateien in aller Regel gar nicht.
 * Die Vermutung ist damit nicht geraten, sondern aus dem Einstieg selbst abgeleitet; und sie liegt
 * auf der Seite, die heute überhaupt einen Katalog hat.
 *
 * ── DAS B24-SEGMENT BILDET DIREKT AB (K3c, `apps/web/lib/admin/battery-catalog-source.ts`) ─────
 * Der Admin-Wizard erhebt je Projekt ein Segment `privat | betrieb` — eine AUSDRÜCKLICHE Angabe,
 * die jeden Rückfall schlägt: `privat → 'heim'`, `betrieb → 'gewerbe'`. Der Wizard ruft diese
 * Funktion deshalb NICHT auf: die Angabe zu haben und stattdessen zu raten wäre der Fehler.
 */
export type BatteryCategoryInput =
  | { entry: 'upload' }
  | { entry: 'standard_profile'; customerClass: 'privat' | 'kleingewerbe' }

export function batteryCategoryFor(input: BatteryCategoryInput): BatteryCatalogCategory {
  if (input.entry === 'standard_profile' && input.customerClass === 'privat') return 'heim'
  return 'gewerbe'
}

/**
 * Vorgabe des Schalters „Mit Börsen-Strompreisen vergleichen". Ein Heimspeicher spart ohne
 * dynamischen Tarif nichts (kein Leistungspreis, beim Standardprofil ohnehin keine Kappung) —
 * für Haushalte ist der Vergleich deshalb die eigentliche Frage. Gewerbe bleibt bei „aus".
 */
export function tariffComparisonDefaultFor(category: BatteryCatalogCategory): boolean {
  return category === 'heim'
}
