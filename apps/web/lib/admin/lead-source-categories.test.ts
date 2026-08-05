/**
 * Tests für die drei Anzeige-Kategorien der Herkunftsspalte.
 *
 * ── WAS HIER GEPRÜFT WIRD, UND WARUM ES EIN TEST SEIN MUSS ──────────────────────────────────────
 * „Kontaktformular" ist als RESTMENGE definiert, nicht als Aufzählung der heute bekannten
 * Schlüssel. Der Unterschied ist beim nächsten Einstiegspunkt sichtbar — und zwar nur hier: Mit
 * einer Aufzählung fiele er aus ALLEN drei Kategorien heraus und wäre über die Herkunftsspalte
 * unauffindbar, ohne dass irgendetwas rot würde. Die Liste zeigte ihn weiterhin (die Spalte
 * beschriftet jede Zeile), nur der FILTER liesse ihn still aus.
 */
import { describe, expect, it } from 'vitest'

import {
  LEAD_SOURCE_CATEGORIES,
  LEAD_SOURCE_CATEGORY_LABELS,
  categoryOfSourceKey,
  isLeadSourceCategory,
  sourceCategoryLabel,
  sourceKeysForCategories,
} from './lead-source-categories'
import { LEAD_SOURCE_KEYS } from '@/lib/leads/registry'

describe('die Zuordnung Schlüssel → Kategorie', () => {
  it('die zwei benannten Einstiegspunkte bekommen ihre eigene Kategorie', () => {
    expect(categoryOfSourceKey('partner-empfehlung')).toBe('partner')
    expect(categoryOfSourceKey('telefonanfrage')).toBe('admin')
  })

  it('JEDER übrige Herkunftsschlüssel fällt auf „Kontaktformular"', () => {
    /*
     * Über die vollständige Registry, nicht über eine Handvoll Beispiele: Die Registry ist im
     * DB-Gate in BEIDE Richtungen gegen `platform.lead_sources` gepinnt
     * (`lead-source-registry.test.ts`), sie IST damit die Liste der real vorkommenden Schlüssel.
     */
    const rest = LEAD_SOURCE_KEYS.filter(
      (key) => key !== 'partner-empfehlung' && key !== 'telefonanfrage',
    )
    expect(rest.length, 'die Restmenge ist nicht leer').toBeGreaterThan(0)
    for (const key of rest) {
      expect(categoryOfSourceKey(key), `„${key}"`).toBe('kontakt')
    }
  })

  it('ein Schlüssel, den es heute noch nicht gibt, fällt ebenfalls auf „Kontaktformular"', () => {
    /*
     * DER EIGENTLICHE TEST DIESER DATEI. Er beschreibt die Restmengen-Eigenschaft an einem Wert,
     * den die Registry nicht kennt — genau der Fall, den ein künftiger Einstiegspunkt erzeugt.
     * Eine Aufzählung statt einer Restmenge macht ihn rot.
     */
    expect(categoryOfSourceKey('ein-kanal-den-es-2027-gibt')).toBe('kontakt')
  })

  it('jede Kategorie hat eine Beschriftung, und die Zeile zeigt sie', () => {
    for (const category of LEAD_SOURCE_CATEGORIES) {
      expect(LEAD_SOURCE_CATEGORY_LABELS[category].trim().length).toBeGreaterThan(0)
    }
    expect(sourceCategoryLabel('partner-empfehlung')).toBe('über einen Partner')
    expect(sourceCategoryLabel('telefonanfrage')).toBe('Manuelle Admin Eingabe')
    expect(sourceCategoryLabel('kontaktformular')).toBe('Kontaktformular')
  })

  it('isLeadSourceCategory kennt genau die drei', () => {
    for (const category of LEAD_SOURCE_CATEGORIES) expect(isLeadSourceCategory(category)).toBe(true)
    for (const other of ['', 'quatsch', 'kontaktformular', null, 7]) {
      expect(isLeadSourceCategory(other), String(other)).toBe(false)
    }
  })
})

describe('die Auflösung Kategorie → Schlüsselmenge (der Filter)', () => {
  it('eine Kategorie liefert genau ihre Schlüssel', () => {
    expect(sourceKeysForCategories(['partner'])).toEqual(['partner-empfehlung'])
    expect(sourceKeysForCategories(['admin'])).toEqual(['telefonanfrage'])
  })

  it('„Kontaktformular" liefert ALLE übrigen Schlüssel der Registry', () => {
    const keys = sourceKeysForCategories(['kontakt'])
    expect(keys).toBeDefined()
    expect(keys).not.toContain('partner-empfehlung')
    expect(keys).not.toContain('telefonanfrage')
    expect(keys?.length).toBe(LEAD_SOURCE_KEYS.length - 2)
    // Stichproben aus verschiedenen Bauabschnitten — sie alle sind „Selbstauskunft übers Web".
    for (const key of ['kontaktformular', 'warteliste', 'registrierung', 'artikel-inline']) {
      expect(keys, `„${key}" gehört zur Restmenge`).toContain(key)
    }
  })

  it('zwei Kategorien ergeben die Vereinigung', () => {
    const keys = sourceKeysForCategories(['partner', 'admin'])
    expect(keys?.sort()).toEqual(['partner-empfehlung', 'telefonanfrage'])
  })

  it('KEINE und ALLE Kategorien sind beides „kein Filter"', () => {
    /*
     * Beides heisst „keine Einschränkung". Ein Filter, der jeden Schlüssel durchlässt, gehört nicht
     * in die Adresse — und schon gar nicht ins Ausfuhrprotokoll, das ihn sonst als angewandte
     * Auswahl ausweisen würde („Herkunft (Auswahl): …" statt „alle (kein Filter gesetzt)").
     */
    expect(sourceKeysForCategories([])).toBeUndefined()
    expect(sourceKeysForCategories([...LEAD_SOURCE_CATEGORIES])).toBeUndefined()
  })

  it('die Vereinigung aller drei Kategorien deckt die Registry vollständig ab', () => {
    /*
     * Ohne Lücke und ohne Dublette: Jeder Schlüssel gehört zu GENAU EINER Kategorie. Sonst wäre ein
     * Lead entweder über keine Kategorie auffindbar oder er erschiene unter zweien.
     */
    const all = LEAD_SOURCE_CATEGORIES.flatMap(
      (category) => sourceKeysForCategories([category]) ?? [],
    )
    expect([...all].sort()).toEqual([...LEAD_SOURCE_KEYS].sort())
  })
})
