/**
 * Das Thema einer Anfrage im ADMIN-BEREICH — Auswahlliste und Anzeige, aus der EINEN Taxonomie.
 *
 * ── WARUM ES DIESES MODUL GIBT ──────────────────────────────────────────────────────────────────
 * Gespeichert wird der SCHLÜSSEL (`peakShaving`, `esg`, …), nicht das übersetzte Label — ein Label
 * ist sprachabhängig und änderbar und wäre im Bestand eine zweite, veraltende Kopie von
 * `messages/*.json`. Die Anzeige muss ihn also wieder auflösen, und zwar über GENAU DIE Liste, die
 * auch das öffentliche Dropdown füllt (`lib/kontakt/themen.ts`, datengetrieben aus `LEISTUNGEN`).
 * Acht deutsche Beschriftungen hier abzutippen wäre exakt die zweite Liste, gegen die jenes Modul
 * gebaut ist: Beim ersten Leistungs-Rename zeigte der Admin-Bereich einen Namen, den es nicht mehr
 * gibt — und niemandem fiele es auf.
 *
 * ── DIE ÜBERSETZER KOMMEN VON AUSSEN, DAMIT DIESES MODUL REIN BLEIBT ────────────────────────────
 * Kein `server-only`, kein `next/*`, kein next-intl-Import: Die aufrufende Server-Komponente reicht
 * eine Funktion `(namespace, key) => label` herein. Damit ist das Modul ohne Request prüfbar, und
 * die Frage „woher kommen die deutschen Wörter" bleibt an einer Stelle beantwortbar.
 *
 * ⚠ DER ADMIN-BEREICH LIEGT SONST AUSSERHALB DER next-intl-STRUKTUR (`lib/admin/schema.ts`: seine
 * eigenen Sätze stehen im Code, ein Key-Umweg ohne Wörterbuch wäre eine Indirektion ohne Nutzen).
 * Das gilt weiterhin und wird hier NICHT aufgeweicht: Aufgelöst werden ausschliesslich die Labels
 * der ÖFFENTLICHEN Taxonomie — also fremde Texte, die dieser Bereich nur anzeigt und nie besitzt.
 * Die Auflösung passiert serverseitig; ins Client-Bündel wandern fertige Zeichenketten, kein
 * Nachrichtenkatalog.
 */

import { THEMEN, findThema, isThemaKey, type Thema } from '@/lib/kontakt/themen'

/** Ein Thema, wie es das Admin-Formular anbietet und die Detailseite anzeigt. */
export type ThemaOption = { key: string; label: string }

/**
 * Löst einen Label-Schlüssel innerhalb eines Namensraums auf. Genau die Form, die
 * `getTranslations({ locale, namespace })` liefert — die Seite reicht die beiden Namensräume
 * herein, die `lib/kontakt/themen.ts` kennt (`Nav` für die sechs Leistungen, `Kontakt` für die
 * zwei Zusätze).
 */
export type ThemaLabelResolver = (namespace: Thema['labelNamespace'], key: string) => string

function labelOf(thema: Thema, resolve: ThemaLabelResolver): string {
  return resolve(thema.labelNamespace, thema.labelKey)
}

/**
 * Alle Themen in der Reihenfolge der Taxonomie — Leistungen wie im Menü, dann das Flaggschiff, dann
 * das Auffangbecken. Dieselbe Liste und dieselbe Reihenfolge wie im öffentlichen Formular; ein
 * Thema kann hier nicht fehlen, ohne dort ebenfalls zu fehlen.
 */
export function themaOptions(resolve: ThemaLabelResolver): ThemaOption[] {
  return THEMEN.map((thema) => ({ key: thema.key, label: labelOf(thema, resolve) }))
}

/**
 * Der ANZEIGETEXT zu einem gespeicherten Schlüssel — oder `null`, wenn keiner hinterlegt ist.
 *
 * ⚠ EIN UNBEKANNTER SCHLÜSSEL WIRD ROH ANGEZEIGT, NICHT VERSCHWIEGEN UND NICHT GEWORFEN.
 * `platform.leads.thema` trägt bewusst KEINEN CHECK (die Werteliste ist datengetrieben, ein
 * Constraint wäre eine zweite und liesse die Erfassung beim ersten Rename mit 23514 scheitern) —
 * ein Wert, den die heutige Taxonomie nicht mehr kennt, ist deshalb ein realer Zustand: ein
 * umbenanntes Leistungsfeld, ein Bestand aus der Zeit davor. `findThema` wirft in diesem Fall;
 * hier wäre das die schlechteste Antwort, denn es risse die gesamte Detailseite eines Leads
 * herunter, dessen einziges Problem eine veraltete Kategorie ist. Ein leeres Feld wäre die
 * zweitschlechteste: Es sähe aus wie „nicht angegeben" und wäre eine Angabe.
 */
export function themaLabel(
  key: string | null | undefined,
  resolve: ThemaLabelResolver,
): string | null {
  const trimmed = key?.trim() ?? ''
  if (trimmed === '') return null
  if (!isThemaKey(trimmed)) return trimmed
  return labelOf(findThema(trimmed), resolve)
}
