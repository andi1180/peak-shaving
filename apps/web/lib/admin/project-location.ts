/**
 * Land + optionale PLZ aus einem Formular → geprüfter Standort. Eine Prüfung für Projektanlage und
 * Stammdaten; die Regel selbst steht in `shared/country`.
 */

import { lookupPostalCodeCentroid } from 'shared'
import { isCountry, normalizePostalCodeFor, type Country } from 'shared/country'
import { COUNTRY_REQUIRED, postalCodeFormatError } from './project-country'

export const POSTAL_CODE_UNKNOWN = 'Diese Postleitzahl kennen wir nicht — bitte prüfen.'

export type ParsedProjectLocation =
  | { ok: true; country: Country; postalCode: string | null; placeName: string | null }
  | { ok: false; fieldErrors: { country?: string; postalCode?: string } }

/**
 * Das Land ist Pflicht (kein Vorgabewert); die PLZ ist optional und wird, wenn angegeben, gegen
 * das gewählte Land geprüft. Die österreichische Koordinatentabelle gilt nur bei AT.
 */
export function parseProjectLocation(
  countryRaw: string,
  postalCodeRaw: string,
): ParsedProjectLocation {
  const country = countryRaw.trim()
  if (!isCountry(country)) return { ok: false, fieldErrors: { country: COUNTRY_REQUIRED } }

  const raw = postalCodeRaw.trim()
  if (raw === '') return { ok: true, country, postalCode: null, placeName: null }

  const postalCode = normalizePostalCodeFor(country, raw)
  if (postalCode === null) {
    return { ok: false, fieldErrors: { postalCode: postalCodeFormatError(country) } }
  }

  if (country === 'AT') {
    const centroid = lookupPostalCodeCentroid(postalCode)
    if (!centroid) return { ok: false, fieldErrors: { postalCode: POSTAL_CODE_UNKNOWN } }
    return { ok: true, country, postalCode, placeName: centroid.name }
  }
  return { ok: true, country, postalCode, placeName: null }
}
