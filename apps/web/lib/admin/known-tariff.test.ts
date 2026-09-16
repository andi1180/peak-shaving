import { describe, expect, it } from 'vitest'

import { ANNUAL_CONSUMPTION_KWH_KEY } from './standard-profile'
import { KNOWN_TARIFF_DRAFT_FIELDS, hasKnownTariffInDraft } from './known-tariff'

/**
 * B24, Teil 1 — „gibt es für diesen Zählpunkt überhaupt einen bekannten Tarif?"
 *
 * Die Antwort entscheidet in der Tarif-Station, ob „Tarif behalten" überhaupt angeboten wird. Ein
 * Fehlschlag wäre STILL: es stünde eine plausible Schaltfläche da, und was fehlt, sieht man ihr
 * nicht an. Die Prüfung ist rein und braucht dafür weder Browser noch Datenbank.
 */
describe('hasKnownTariffInDraft', () => {
  it('⚠ der Jahresverbrauch ALLEIN ist KEIN bekannter Tarif — genau der Fund, der dieses Modul begründet', () => {
    /*
     * Er steht in `INVOICE_DRAFT_FIELD_KEYS`, weil der Rechnungs-Scan ihn mitlesen KANN — geschrieben
     * wird er aber auch vom Standardprofil-Zweig der Lastgang-Station, unter demselben Schlüssel.
     * Mitgezählt wäre die Antwort für JEDEN Zählpunkt ohne Lastgang-Datei `true`, also ausgerechnet
     * für den Regelfall, für den die Prüfung gebaut ist.
     */
    expect(hasKnownTariffInDraft({ [ANNUAL_CONSUMPTION_KWH_KEY]: 4500 })).toBe(false)
    expect(KNOWN_TARIFF_DRAFT_FIELDS).not.toContain(ANNUAL_CONSUMPTION_KWH_KEY)
  })

  it('⚠ der NETZBETREIBER allein ist ebenfalls KEIN bekannter Tarif', () => {
    /*
     * Seit dem 16.09.2026 schreibt ihn auch der Rechnungs-Scan in den Entwurf. Mitgezählt böte die
     * Tarif-Station „aktuellen Tarif behalten" an, sobald eine Rechnung nichts weiter hergab als
     * den Namen des Netzbetreibers — er geht in keine Rechnung ein.
     */
    expect(hasKnownTariffInDraft({ netzbetreiber: 'wiener_netze' })).toBe(false)
    expect(KNOWN_TARIFF_DRAFT_FIELDS).not.toContain('netzbetreiber')
  })

  it('ein echtes Tarif-Feld genügt', () => {
    expect(hasKnownTariffInDraft({ energyPriceCtPerKwh: 24.5 })).toBe(true)
  })

  it('⚠ eine echte 0 IST eine Angabe — ein Leistungspreis von 0 ist der Normalfall ohne Leistungsmessung', () => {
    // Über einen Wahrheitswert gelesen verschwände sie, und der Zählpunkt gälte als tariflos,
    // obwohl der Wert dasteht.
    expect(hasKnownTariffInDraft({ leistungspreisEurPerKwYear: 0 })).toBe(true)
  })

  it('ein leerer Entwurf und ein Entwurf nur mit fremden Feldern ergeben false', () => {
    expect(hasKnownTariffInDraft({})).toBe(false)
    expect(hasKnownTariffInDraft({ hasPv: true, invoiceSkipped: true })).toBe(false)
  })

  it('jedes einzelne geführte Feld trägt die Antwort — kein Feld liegt tot in der Liste', () => {
    // Ohne diese Richtung bliebe der Test grün, wenn die Ableitung versehentlich auf ein einziges
    // Feld zusammenschrumpfte.
    expect(KNOWN_TARIFF_DRAFT_FIELDS.length).toBeGreaterThan(1)
    for (const field of KNOWN_TARIFF_DRAFT_FIELDS) {
      expect(hasKnownTariffInDraft({ [field]: 1 })).toBe(true)
    }
  })
})
