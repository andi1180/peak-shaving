/**
 * Einstellungen des PDF-Schnellreports (Leadgen-Umbau Schritt 3b-1) — die einzige Stelle, an der
 * Ansprechpartner, Telefon und Preis stehen. Ein leerer Wert lässt das Feld im PDF weg; ein
 * Platzhalter wie „[Name]" darf nie im Kundendokument landen.
 */
export type SchnellreportSettings = {
  /** Ansprechpartner im Kontaktblock auf Seite 4. */
  contactName: string
  /** Telefonnummer im Kontaktblock auf Seite 4. */
  phone: string
  /** Preis des Profi-Reports (Seite 4); leer = Preisblock entfällt. */
  price: string
  /** Zusatz neben dem Preis. */
  priceNote: string
}

export const SCHNELLREPORT_SETTINGS: SchnellreportSettings = {
  contactName: '',
  phone: '',
  price: '495 €',
  priceNote: 'Einführungspreis bis 31.12.2026, zzgl. USt.',
}
