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
 * ── WIE DAS B24-SEGMENT SPÄTER DARAUF ABBILDET (NICHT GEBAUT, nur festgehalten) ────────────────
 * Der Admin-Wizard (`apps/web`, B24) erhebt je Projekt ein Segment `privat | betrieb`. Das ist
 * eine AUSDRÜCKLICHE Angabe eines Menschen und schlägt damit jeden Rückfall: `privat → 'heim'`,
 * `betrieb → 'gewerbe'`. Der Wizard-Analysepfad (`run-from-draft.ts`) ist K3c und bleibt hier
 * unangetastet — wenn er umgestellt wird, ruft er NICHT diese Funktion auf, sondern bildet das
 * Segment direkt ab: die Angabe zu haben und stattdessen zu raten wäre der Fehler.
 */
export type BatteryCategoryInput =
  | { entry: 'upload' }
  | { entry: 'standard_profile'; customerClass: 'privat' | 'kleingewerbe' }

export function batteryCategoryFor(input: BatteryCategoryInput): BatteryCatalogCategory {
  if (input.entry === 'standard_profile' && input.customerClass === 'privat') return 'heim'
  return 'gewerbe'
}
