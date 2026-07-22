import { describe, expect, it } from 'vitest'

import {
  PARTNER_SLUG_MAX_LENGTH,
  PARTNER_SLUG_PATTERN,
  suggestPartnerSlug,
} from './partner-slug'

/*
 * Der Vorschlag ist die einzige Stelle dieses Bauabschnitts, an der ein Mensch einen
 * UNWIDERRUFLICHEN Wert vorgesetzt bekommt: Nach der Genehmigung lässt sich der Kurz-Key nicht mehr
 * ändern (Trigger platform.guard_partner_slug), und er steht in Links, die ein Fachbetrieb an
 * hunderte Bestandskunden verschickt. Deshalb wird hier zweierlei gemessen — dass das Ergebnis
 * GÜLTIG ist (sonst scheitert die Genehmigung erst nach dem Bestätigen) und dass es LESBAR ist
 * (sonst überschreibt es ohnehin jeder, und der Vorschlag hat keinen Wert).
 */
describe('suggestPartnerSlug', () => {
  it('DER KERNFALL: Umlaute werden AUFGELÖST, nicht entfernt', () => {
    // „mller" wäre gültig und trotzdem falsch: der Name ist darin nicht wiederzuerkennen.
    expect(suggestPartnerSlug('Elektro Müller GmbH')).toBe('elektro-mueller')
    expect(suggestPartnerSlug('Bäckerei Öhler')).toBe('baeckerei-oehler')
    expect(suggestPartnerSlug('Straßer & Söhne')).toBe('strasser-soehne')
    expect(suggestPartnerSlug('Über-Strom KG')).toBe('ueber-strom')
  })

  it('die Reihenfolge stimmt: erst die Umlaut-Tabelle, dann die Unicode-Zerlegung', () => {
    /*
     * Andersherum zerlegte NFD das „ü" zuerst in u + Trema, das Trema fiele als Combining Mark weg
     * und aus „Müller" würde `muller`. Der Test steht getrennt, weil er nicht die Ausgabe prüft,
     * sondern die Reihenfolge zweier Schritte, die beide für sich richtig aussehen.
     */
    expect(suggestPartnerSlug('Müller')).toBe('mueller')
    expect(suggestPartnerSlug('Müller')).not.toBe('muller')
  })

  it('andere Diakritika fallen weg, statt den Vorschlag unbrauchbar zu machen', () => {
    // Für „é" gibt es keine allgemein richtige Ersetzung; `e` ist die nächstbeste Lesart.
    expect(suggestPartnerSlug('Élan Énergie')).toBe('elan-energie')
    expect(suggestPartnerSlug('Håkan Larsson')).toBe('hakan-larsson')
  })

  it('nachgestellte Rechtsformen fallen weg — der Link wird vorgelesen und abgetippt', () => {
    expect(suggestPartnerSlug('Elektro Müller GmbH & Co KG')).toBe('elektro-mueller')
    expect(suggestPartnerSlug('Raymann Elektrotechnik GmbH')).toBe('raymann-elektrotechnik')
    expect(suggestPartnerSlug('Installateur Huber e.U.')).toBe('installateur-huber')
  })

  it('eine Rechtsform MITTEN im Namen bleibt stehen', () => {
    // Nur nachgestellte Formen werden entfernt — sonst verlöre „AG Elektrotechnik" seinen Anfang.
    expect(suggestPartnerSlug('AG Elektrotechnik Wien')).toBe('ag-elektrotechnik-wien')
  })

  it('ein Name, der NUR aus einer Rechtsform besteht, bleibt unverändert', () => {
    // Sonst käme ein leerer Vorschlag heraus, obwohl ein brauchbarer Name dastand.
    expect(suggestPartnerSlug('GmbH')).toBe('gmbh')
  })

  it('das Ergebnis erfüllt IMMER die Form, die die Datenbank verlangt', () => {
    /*
     * Der CHECK auf platform.partners.slug (`^[a-z0-9-]+$`, B16-1) ist die harte Grenze; ein
     * Vorschlag, der ihn verletzt, wäre eine Ablehnung nach dem Bestätigen — bei einem Vorgang, der
     * nicht zurücknehmbar ist.
     */
    const namen = [
      'Elektro Müller GmbH',
      'Ökostrom & Wärme OG',
      'Fa. Huber — Elektro/Installation',
      '  Doppelte   Leerzeichen  ',
      'CAPS LOCK ELEKTRO',
      'Zahlen 24/7 Service',
      "O'Brien Electrics",
      'Straßer & Söhne',
    ]
    for (const name of namen) {
      const slug = suggestPartnerSlug(name)
      expect(slug, name).not.toBe('')
      expect(PARTNER_SLUG_PATTERN.test(slug), `${name} → ${slug}`).toBe(true)
      expect(slug.length, name).toBeLessThanOrEqual(PARTNER_SLUG_MAX_LENGTH)
    }
  })

  it('KEIN erfundener Rückfallwert, wenn nichts Brauchbares übrig bleibt', () => {
    /*
     * Ein `partner-1` sähe aus wie eine Empfehlung und würde unwiderruflich übernommen. Ohne
     * Vorschlag bleibt das Feld leer, und die Person tippt selbst — das ist der ehrlichere Zustand.
     */
    expect(suggestPartnerSlug('')).toBe('')
    expect(suggestPartnerSlug('   ')).toBe('')
    expect(suggestPartnerSlug('—/—')).toBe('')
    // Unter zwei Zeichen: gültig für die DB, aber vom Formular-Schema (min 2) abgelehnt — ein
    // Vorschlag, der garantiert zurückkommt, ist kein Vorschlag.
    expect(suggestPartnerSlug('B')).toBe('')
  })

  it('lange Namen werden gekürzt, ohne einen Bindestrich am Ende zu hinterlassen', () => {
    const slug = suggestPartnerSlug(
      'Erste Wiener Elektrotechnik und Gebäudeinstallation für Gewerbebetriebe Aktiengesellschaft',
    )
    expect(slug.length).toBeLessThanOrEqual(PARTNER_SLUG_MAX_LENGTH)
    expect(slug.endsWith('-')).toBe(false)
    expect(PARTNER_SLUG_PATTERN.test(slug)).toBe(true)
  })
})
