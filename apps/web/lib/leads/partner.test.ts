/**
 * Die Formprüfung eines Partner-Slugs (B16-2).
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Ob es einen Fachbetrieb GIBT, weiss allein die Datenbank; das prüft das DB-Gate
 * (`packages/db-tests/src/partner-landing.test.ts`). Hier steht die Frage davor: Welche Zeichenketten
 * dürfen überhaupt bis zur Datenbank durchgereicht werden — und welche beantwortet die Route ohne
 * einen einzigen Aufruf mit 404.
 *
 * Die Prüfung ist eine Spiegelung des CHECK auf `platform.partners.slug` (`^[a-z0-9-]+$`, B16-1).
 * Sie ist damit keine zweite Wahrheit: Ein Slug, der ihr nicht genügt, KANN nicht gespeichert sein
 * und fände auch über den Wrapper nichts. Was sie hinzufügt, ist die frühe, aufrufsfreie Antwort.
 */
import { describe, expect, it } from 'vitest'
import {
  PARTNER_HREF,
  PARTNER_ROUTE_TEMPLATE,
  isPartnerSlugFormat,
  normalizePartnerSlug,
  partnerHref,
} from './partner'

describe('normalizePartnerSlug', () => {
  it('nimmt einen wohlgeformten Slug unverändert an', () => {
    expect(normalizePartnerSlug('raymann')).toBe('raymann')
    expect(normalizePartnerSlug('raymann-elektrotechnik')).toBe('raymann-elektrotechnik')
    expect(normalizePartnerSlug('elektro-2000')).toBe('elektro-2000')
  })

  it('schneidet Leerraum ab — ein kopierter Link trägt schon einmal ein Leerzeichen', () => {
    expect(normalizePartnerSlug('  raymann-elektro  ')).toBe('raymann-elektro')
  })

  it('SCHREIBT NICHT KLEIN — eine Adresse hat genau eine Form', () => {
    /*
     * Die bewusste Abweichung von der Datenbank: `public.capture_lead` und
     * `public.get_active_partner` schreiben klein (dort geht es um einen VERGLEICH, und das kann nur
     * einen Nicht-Treffer in den richtigen Treffer verwandeln). Hier geht es um eine ADRESSE:
     * Akzeptierte Schreibvarianten wären mehrere URLs für dieselbe Seite. Der Link wird ohnehin
     * nicht getippt, sondern im Admin-Bereich fertig zum Kopieren angezeigt.
     */
    expect(normalizePartnerSlug('RAYMANN')).toBeNull()
    expect(normalizePartnerSlug('Raymann-Elektro')).toBeNull()
  })

  it('weist zurück, was der Datenbank-CHECK ohnehin nie enthalten kann', () => {
    // Unterstrich: genau der Fall, der in B10-5 real mit SQLSTATE 23514 aufgeschlagen ist.
    expect(normalizePartnerSlug('raymann_elektro')).toBeNull()
    expect(normalizePartnerSlug('raymann elektro')).toBeNull()
    expect(normalizePartnerSlug('raymänn')).toBeNull()
    expect(normalizePartnerSlug('raymann/../admin')).toBeNull()
    expect(normalizePartnerSlug('')).toBeNull()
    expect(normalizePartnerSlug('   ')).toBeNull()
  })

  it('begrenzt die Länge — die Eingabe kommt aus einer öffentlichen URL', () => {
    expect(normalizePartnerSlug('a'.repeat(64))).toBe('a'.repeat(64))
    expect(normalizePartnerSlug('a'.repeat(65))).toBeNull()
  })

  it('nimmt nur Zeichenketten entgegen', () => {
    expect(normalizePartnerSlug(undefined)).toBeNull()
    expect(normalizePartnerSlug(null)).toBeNull()
    expect(normalizePartnerSlug(42)).toBeNull()
    expect(normalizePartnerSlug({ slug: 'raymann' })).toBeNull()
  })
})

describe('isPartnerSlugFormat', () => {
  it('prüft die Form, ohne zu normalisieren', () => {
    expect(isPartnerSlugFormat('raymann')).toBe(true)
    // Ungleich `normalizePartnerSlug`: hier wird NICHT kleingeschrieben, die Form gilt wie sie ist.
    expect(isPartnerSlugFormat('RAYMANN')).toBe(false)
    expect(isPartnerSlugFormat(' raymann ')).toBe(false)
  })
})

describe('Pfade', () => {
  it('bildet den öffentlichen Pfad ohne Locale-Präfix', () => {
    expect(partnerHref('raymann')).toBe('/partner/raymann')
  })

  it('die Routen-Vorlage passt zum Basispfad — sonst bricht assertRoutesMatchDisk()', () => {
    /*
     * `lib/routes.ts` führt die Vorlage in `DYNAMIC_TEMPLATES` und vergleicht sie beim Bauen mit den
     * Ordnern auf der Platte. Liefen Konstante und Vorlage auseinander, bräche der Build mit einer
     * Meldung über eine Route, die es „nicht gibt" — dieser Test benennt die Ursache vorher.
     */
    expect(PARTNER_ROUTE_TEMPLATE).toBe(`${PARTNER_HREF}/[slug]`)
  })
})
