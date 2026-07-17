/**
 * Das Team als DATENQUELLE (/ueber-uns, Prompt 20) — analog zu
 * `lib/leistungen.ts`/`lib/branchen.ts`.
 *
 * Hier steht NUR Struktur: Reihenfolge, `id` und die `initials` für den
 * Foto-Platzhalter. KEIN Fließtext — Name, Rolle und Bio sind sichtbarer Text
 * und kommen über `messages/de.json` (`UeberUns.team.<id>`, §8.7). Die
 * Reihenfolge des Arrays IST die Anzeigereihenfolge der Karten.
 *
 * Die Initialen stehen bewusst HIER und werden nicht aus dem Namen (Message)
 * abgeleitet: „Martin Neubauer" und „Martina Neubauer" ergäben beide „MN" — der
 * Platzhalter ist eine bewusste, gepflegte Angabe, keine Berechnung. Bis echte
 * Fotos vorliegen (analog OP#7), ist der Initialen-Kreis der Platzhalter; ein
 * Foto ersetzt später nur die Avatar-Darstellung, nicht diese Struktur.
 */

export type TeamMember = {
  /** Schlüssel in `UeberUns.team` der Message-Datei. */
  id: string
  /** Initialen für den Avatar-Platzhalter (kein abgeleiteter Wert, s. o.). */
  initials: string
}

export const TEAM: TeamMember[] = [
  { id: 'martin', initials: 'MN' },
  { id: 'andreas', initials: 'AD' },
  { id: 'martina', initials: 'MN' },
]
