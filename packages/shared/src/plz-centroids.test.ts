import { describe, expect, it } from 'vitest'

import {
  AT_POSTAL_CODE_COUNT,
  POSTAL_CODE_SOURCE,
  lookupPostalCodeCentroid,
  normalizePostalCode,
} from './plz-centroids'

/**
 * B22b — die PLZ-Tabelle. Geprüft wird, was still schiefgehen kann: ein verstümmelter Datenblock,
 * eine geratene Koordinate, ein Ort ausserhalb Österreichs.
 */
describe('B22b — PLZ → Koordinate', () => {
  it('trägt alle 2.501 österreichischen Postleitzahlen des Datensatzes', () => {
    // Fällt der Datenblock beim Formatieren oder Zusammenführen auseinander, wird das hier sichtbar
    // — und nicht erst daran, dass ein Kunde seine PLZ nicht findet.
    expect(AT_POSTAL_CODE_COUNT).toBe(2501)
    let found = 0
    for (let plz = 1000; plz <= 9999; plz++) {
      if (lookupPostalCodeCentroid(String(plz))) found++
    }
    expect(found).toBe(AT_POSTAL_CODE_COUNT)
  })

  it('löst Stichproben quer durch alle Bundesländer auf den erwarteten Hauptort auf', () => {
    // Von Hand gegen die erwartete Gemeinde geprüft (s. Kopf des Moduls, 0 Abweichungen).
    const expected: Record<string, string> = {
      '1010': 'Wien, Innere Stadt',
      '1100': 'Wien, Favoriten',
      '2700': 'Wiener Neustadt',
      '4020': 'Linz',
      '4400': 'Steyr',
      '5020': 'Salzburg',
      '6020': 'Innsbruck',
      '6900': 'Bregenz',
      '7000': 'Eisenstadt',
      '8010': 'Graz',
      '9020': 'Klagenfurt am Wörthersee',
    }
    for (const [plz, name] of Object.entries(expected)) {
      expect(lookupPostalCodeCentroid(plz)?.name, `PLZ ${plz}`).toBe(name)
    }
  })

  it('liefert Koordinaten, die in Österreich liegen', () => {
    // Österreich liegt zwischen rund 46,4–49,0° N und 9,5–17,2° O. Ein Eintrag ausserhalb wäre ein
    // Datenfehler, der als völlig plausible Ertragszahl herauskäme.
    for (let plz = 1000; plz <= 9999; plz++) {
      const hit = lookupPostalCodeCentroid(String(plz))
      if (!hit) continue
      expect(hit.lat, `PLZ ${plz} Breite`).toBeGreaterThan(46.3)
      expect(hit.lat, `PLZ ${plz} Breite`).toBeLessThan(49.1)
      expect(hit.lon, `PLZ ${plz} Länge`).toBeGreaterThan(9.4)
      expect(hit.lon, `PLZ ${plz} Länge`).toBeLessThan(17.3)
    }
  })

  it('⚠ eine unbekannte PLZ ergibt null — niemals eine geratene Koordinate', () => {
    expect(lookupPostalCodeCentroid('0000')).toBeNull()
    expect(lookupPostalCodeCentroid('9999')).toBeNull()
    // Eine deutsche fünfstellige PLZ ist keine österreichische, auch nicht auf vier gekürzt.
    expect(lookupPostalCodeCentroid('80331')).toBeNull()
    expect(lookupPostalCodeCentroid('')).toBeNull()
    expect(lookupPostalCodeCentroid('abcd')).toBeNull()
  })

  it('nimmt die Schreibweisen an, die auf Rechnungen und Briefköpfen stehen', () => {
    expect(normalizePostalCode(' 1100 ')).toBe('1100')
    expect(normalizePostalCode('A-1100')).toBe('1100')
    expect(normalizePostalCode('AT-1100')).toBe('1100')
    expect(normalizePostalCode('AT 1100')).toBe('1100')
    expect(normalizePostalCode('11 00')).toBe('1100')
    expect(lookupPostalCodeCentroid('A-1010')?.name).toBe('Wien, Innere Stadt')
  })

  it('weist alles ab, was keine vierstellige Zahl ist', () => {
    expect(normalizePostalCode('110')).toBeNull()
    expect(normalizePostalCode('11000')).toBeNull()
    expect(normalizePostalCode('1a00')).toBeNull()
  })

  it('trägt die Namensnennung, die die Lizenz verlangt', () => {
    // Die Nennung ist eine LIZENZBEDINGUNG (CC BY 4.0) und muss zusätzlich sichtbar in der
    // Oberfläche stehen — hier wird nur geprüft, dass die Angaben überhaupt da sind.
    expect(POSTAL_CODE_SOURCE.name).toBe('GeoNames')
    expect(POSTAL_CODE_SOURCE.license).toBe('CC BY 4.0')
    expect(POSTAL_CODE_SOURCE.url).toMatch(/^https:\/\//)
    expect(POSTAL_CODE_SOURCE.licenseUrl).toMatch(/^https:\/\//)
    expect(POSTAL_CODE_SOURCE.retrievedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('⚠ alle Wiener Bezirke tragen dieselbe Koordinate — gemessene Grenze, kein Defekt', () => {
    // Der Datensatz setzt für jeden Wiener Gemeindebezirk den Stadtmittelpunkt. Das ist der Fall,
    // für den die Messung „innerhalb einer Stadt unter 1 % Ertragsunterschied" gilt; der
    // ANZEIGENAME unterscheidet die Bezirke trotzdem. Als Test festgehalten, damit ein späterer
    // Datensatz-Wechsel diese Eigenschaft sichtbar ändert statt still.
    const innereStadt = lookupPostalCodeCentroid('1010')!
    const donaustadt = lookupPostalCodeCentroid('1220')!
    expect(donaustadt.lat).toBe(innereStadt.lat)
    expect(donaustadt.lon).toBe(innereStadt.lon)
    expect(donaustadt.name).not.toBe(innereStadt.name)
  })
})
