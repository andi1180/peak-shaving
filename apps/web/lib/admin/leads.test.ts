/**
 * Tests für das Vokabular der Lead-Liste, soweit es die Spalten der Sicht trägt (B18-5-Oberfläche).
 *
 * ── WAS HIER PRÜFBAR IST UND WAS NICHT ───────────────────────────────────────────────────────────
 * Die Zeilen-Typen sind eine BEHAUPTUNG über die Wrapper (`jsonb` → `Json`), kein Beweis; ob die
 * Datenbank `partner_slug` wirklich mitliefert, entscheidet das DB-Gate. Prüfbar ist hier die andere
 * Hälfte: dass die Anwendung ein mitgeliefertes Feld auch LIEST — `readLeadList` hat die
 * Partner-Liste bis B18-5 verworfen, obwohl sie seit B16-1 in jeder Antwort steht, und genau
 * dadurch war die Partner-Spalte ohne Wrapper-Änderung nicht baubar.
 */
import { describe, expect, it } from 'vitest'

import { contactName, partnerLabel, readLeadList, type LeadPartner } from './leads'

const PARTNERS: LeadPartner[] = [
  { slug: 'raymann', display_name: 'Raymann Elektrotechnik GmbH', is_active: true },
  { slug: 'alt-betrieb', display_name: 'Alt Elektro e.U.', is_active: false },
]

describe('die Ansprechperson (neu in der Liste)', () => {
  it('fügt Vor- und Nachname zu einer Zeile zusammen', () => {
    expect(contactName({ first_name: 'Anna Maria', last_name: 'von der Gruber' })).toBe(
      'Anna Maria von der Gruber',
    )
  })

  it('eine hinterlegte Hälfte allein wird gezeigt, nicht verschwiegen', () => {
    /*
     * Nur Vor- ODER Nachname ist ein zulässiger Zustand (beide Spalten sind nullable, B18-3) — real
     * bei von Hand aufgenommenen Kontakten. Als „keine Angabe" zu zeigen, was dasteht, wäre der
     * schlechtere Fehler: die Zeile sähe ungepflegter aus, als sie ist.
     */
    expect(contactName({ first_name: 'Anna', last_name: null })).toBe('Anna')
    expect(contactName({ first_name: null, last_name: 'Gruber' })).toBe('Gruber')
  })

  it('gar kein Name ist `null` — die Zelle entscheidet über den Gedankenstrich, nicht diese Funktion', () => {
    expect(contactName({ first_name: null, last_name: null })).toBeNull()
    // Leerstrings entstehen real: ein leer abgesendetes Formularfeld. Sie sind „nicht hinterlegt".
    expect(contactName({ first_name: '', last_name: '   ' })).toBeNull()
  })

  it('umgebende Leerzeichen erzeugen keine doppelten Trennzeichen', () => {
    expect(contactName({ first_name: ' Anna ', last_name: ' Gruber ' })).toBe('Anna Gruber')
  })
})

describe('die Partner-Spalte', () => {
  it('zeigt den Anzeigenamen, nicht den Slug', () => {
    /*
     * Der Slug ist eine Adress-Kennung („elektro-mueller"), kein Name. Ihn in einer Liste zu zeigen,
     * die ein Mensch überfliegt, verlangte eine Übersetzung, die die Antwort schon mitbringt.
     */
    expect(partnerLabel('raymann', PARTNERS)).toBe('Raymann Elektrotechnik GmbH')
  })

  it('ein STILLGELEGTER Fachbetrieb hat weiterhin einen Namen', () => {
    /*
     * Stilllegung heisst: seine Landingpage antwortet 404 (B16-2). Seine bereits zugeordneten Leads
     * bleiben und behalten die Zuordnung — sie hier namenlos zu zeigen, machte aus einem sichtbaren
     * Zustand ein Ausbleiben.
     */
    expect(partnerLabel('alt-betrieb', PARTNERS)).toBe('Alt Elektro e.U.')
  })

  it('ohne Eintrag bleibt der Slug stehen — er benennt die Zuordnung, die nachweislich besteht', () => {
    expect(partnerLabel('unbekannt', PARTNERS)).toBe('unbekannt')
    expect(partnerLabel('raymann', [])).toBe('raymann')
  })
})

describe('readLeadList liest, was die Antwort mitbringt', () => {
  const ANSWER = {
    status: 'ok',
    leads: [{ id: 'a', partner_slug: 'raymann' }],
    total: 1,
    export_total: 1,
    limit: 50,
    offset: 0,
    sources: [{ key: 'kontaktformular', label: 'Kontaktformular' }],
    partners: PARTNERS,
  }

  it('die Partner-Liste kommt an — sonst gäbe es die Spalte nur als Slug', () => {
    expect(readLeadList(ANSWER)?.partners).toEqual(PARTNERS)
  })

  it('eine Antwort ohne `partners` liefert eine leere Liste statt `undefined`', () => {
    // Verteidigung gegen eine ältere Datenbank: die Spalte fällt dann auf den Slug zurück, die
    // Seite rendert weiter. Ein `undefined` wäre ein Laufzeitfehler mitten im Rendern.
    const { partners: _drop, ...ohne } = ANSWER
    expect(readLeadList(ohne)?.partners).toEqual([])
  })

  it('ein nicht-`ok`-Status bleibt `null` — „konnte nicht geladen werden" ist nicht „keine Leads"', () => {
    expect(readLeadList({ status: 'invalid_filter', filter: 'partner_assignment' })).toBeNull()
  })
})
