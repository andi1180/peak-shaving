import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { COMPANY, COMPANY_LEGAL } from './nav'

/**
 * Die Fusszeile des Druck-Reports (`apps/website/components/report/print-frame.tsx`) nennt Firma
 * und Adresse. `apps/website` ist eine eigene Next-App mit eigenem Deployment und hat keine
 * Abhängigkeit auf `apps/web`; die Werte stehen dort deshalb als kleine Kopie in
 * `apps/website/lib/company.ts`.
 *
 * Der Kopf von `lib/nav.ts` benennt genau die Gefahr, die daraus entsteht: „Eine zweite Adresse im
 * Repo könnte von der sichtbaren abweichen." Dieser Test hält beide zusammen. Er liest die Kopie
 * als TEXT statt sie zu importieren — ein App-übergreifender Modulverweis wäre genau die Kopplung,
 * die es hier nicht geben soll (dasselbe Vorgehen wie beim Backfill-Anker in `packages/shared`).
 *
 * ⚠ Wird er rot, ist NICHT der Test zu lockern: entweder ist die Kopie nachzuziehen, oder die
 * kanonische Adresse hat sich geändert und beide Orte sind gemeinsam zu ändern.
 */
const SOURCE = readFileSync(
  join(__dirname, '../../website/lib/company.ts'),
  'utf8',
)

function literal(field: string): string {
  const match = SOURCE.match(new RegExp(`${field}:\\s*'([^']*)'`))
  if (!match) throw new Error(`Feld ${field} nicht in apps/website/lib/company.ts gefunden`)
  return match[1]!
}

describe('Druck-Fusszeile — die Firmendaten laufen nicht auseinander', () => {
  it('Strasse und Ort sind wortgleich zu COMPANY in apps/web', () => {
    expect(literal('street')).toBe(COMPANY.street)
    expect(literal('city')).toBe(COMPANY.city)
  })

  it('der Firmenname ist die MARKE, nicht der Rechtsträger', () => {
    /*
     * `COMPANY.name` ist „COOLiN ENERGY" — die Marke, unter der die Seite auftritt. Der eingetragene
     * Rechtsträger („COOLiN CONSULTING AND INNOVATION GmbH", `COMPANY_LEGAL.legalName`) gehört ins
     * Impressum und ausdrücklich NICHT in die Fusszeile eines Analyse-Reports: eine Fusszeile ist
     * eine Absenderangabe, und eine halbe Pflichtangabe wäre schlechter als keine.
     */
    expect(literal('name')).toBe(COMPANY.name)
  })

  it('die Web-Adresse steht ohne Protokoll — eine Fusszeile auf Papier ist kein Link', () => {
    expect(literal('web')).toBe('www.coolin.at')
  })

  /*
   * Die Abschlussseite des PDF-Reports (`REPORT_CONTACT` in derselben Kopie) nennt zusätzlich
   * Telefonnummer und E-Mail-Adresse. Beide haben eine kanonische Quelle in dieser App — sie
   * gehören damit unter dieselbe Klammer wie Strasse und Ort, sonst ist die Kopie nur zur Hälfte
   * abgesichert.
   */
  it('Telefon und E-Mail der Abschlussseite sind wortgleich zu apps/web', () => {
    expect(literal('phone')).toBe(COMPANY_LEGAL.phone)
    expect(literal('email')).toBe(COMPANY.email)
  })

  it('die Ansprechperson steht als Angabe da, nicht als Platzhalter', () => {
    /*
     * Name und Rolle haben in `apps/web` KEINE kanonische Quelle (`lib/team.ts` führt nur
     * Initialen; die Namen liegen in den Übersetzungsdateien). Der Test kann sie deshalb nicht
     * gegen etwas halten — er pinnt sie, damit eine Änderung bewusst geschieht, und stellt sicher,
     * dass dort kein Platzhalter steht: ein „[MARTIN: …]" auf einer Kundenseite wäre der Fehler,
     * den dieses Repo an anderer Stelle ausdrücklich sichtbar macht.
     */
    expect(SOURCE).toContain("name: 'Martin Neubauer'")
    expect(SOURCE).toContain("role: 'CEO'")
    expect(SOURCE).not.toContain('[MARTIN')
  })
})
