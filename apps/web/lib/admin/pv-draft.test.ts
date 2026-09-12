import { describe, expect, it } from 'vitest'

import { PV_PRESENT_KEY, readPvDraft } from './pv-draft'

/**
 * B24, Teil 1 — der Leser der PV-Angaben.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER GEGENSTAND: „NEIN" MUSS VON „NICHT GEFRAGT" UNTERSCHEIDBAR BLEIBEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Station wählt ihren Zweig ausschliesslich an diesem einen Rückgabewert. Läse der Leser ein
 * gespeichertes `false` als „nichts da", stellte die Station ihre Frage nach jedem Neuladen erneut
 * — und zwar ausgerechnet dem, der sie schon beantwortet hat. Ein `null` als `false` gelesen wäre
 * der umgekehrte Fehler: der Nein-Zweig stünde da, ohne dass jemand „nein" gesagt hätte.
 *
 * Drei Zustände, drei Bedeutungen, und keine zwei davon dürfen zusammenfallen.
 */
describe('readPvDraft', () => {
  it('liest die drei Zustände auseinander', () => {
    expect(readPvDraft({ [PV_PRESENT_KEY]: true }).hasPv).toBe(true)
    // ⚠ Die eigentliche Zusage: ein gespeichertes `false` ist eine ANGABE, kein leerer Entwurf.
    expect(readPvDraft({ [PV_PRESENT_KEY]: false }).hasPv).toBe(false)
    expect(readPvDraft({}).hasPv).toBeNull()
  })

  it('⚠ liest STRIKT — was wie eine Antwort aussieht, ist keine', () => {
    /*
     * Der Entwurf ist jsonb und wird von mehreren Wegen beschrieben; ein `'true'` oder `1` könnte
     * aus einem Eingriff von Hand oder einem künftigen Importweg stammen. Als Antwort gelesen
     * zeigte die Station einen beantworteten Zweig für eine Angabe, die niemand gemacht hat —
     * dieselbe Lesart wie `readBatteryDraft`.
     */
    for (const value of ['true', 'false', 'ja', 1, 0, null, undefined, {}, []]) {
      expect(readPvDraft({ [PV_PRESENT_KEY]: value }).hasPv).toBeNull()
    }
  })

  it('⚠ liest GENAU diesen Schlüssel und leitet ihn aus keinem anderen ab', () => {
    // Ein Entwurf mit Batterie-Angaben sagt nichts über eine PV-Anlage. Würde der Leser je auf ein
    // Nachbarfeld ausweichen, stünde ein Zweig da, den niemand gewählt hat.
    expect(readPvDraft({ hasBattery: true, wantsBatteryRecommendation: false }).hasPv).toBeNull()
    expect(PV_PRESENT_KEY).toBe('hasPv')
  })
})
