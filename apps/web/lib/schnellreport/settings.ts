/**
 * Einstellungen des PDF-Schnellreports (Leadgen-Umbau Schritt 3b-1) — die einzige Stelle, an der
 * Ansprechpartner, Telefon und Preis stehen. Ein leerer Wert lässt das Feld im PDF weg; ein
 * Platzhalter wie „[Name]" darf nie im Kundendokument landen.
 */
export type SchnellreportSettings = {
  /** Ansprechpartner auf dem Abschlussblatt. */
  contactName: string
  /** Funktion des Ansprechpartners. */
  contactRole: string
  /** Telefonnummer auf dem Abschlussblatt. */
  phone: string
  /** E-Mail-Adresse auf dem Abschlussblatt. */
  email: string
  /** Preis des Profi-Reports (Seite „Profi-Report"); leer = Preisblock entfällt. */
  price: string
  /** Zusatz neben dem Preis. */
  priceNote: string
  /** Zeile unter der Überschrift der Seite „Netztarife“; leer = entfällt. */
  tariffsAsOf: string
}

// Telefon in der Schreibweise des Impressums (`COMPANY_LEGAL.phone`), wie im Profi-Report.
export const SCHNELLREPORT_SETTINGS: SchnellreportSettings = {
  contactName: 'Martin Neubauer',
  contactRole: 'CEO',
  phone: '+43 676 76 30456',
  email: 'energy@coolin.at',
  price: '495 €',
  priceNote: 'Einführungspreis bis 31.12.2026, zzgl. USt.',
  tariffsAsOf: 'Stand Oktober 2026',
}
