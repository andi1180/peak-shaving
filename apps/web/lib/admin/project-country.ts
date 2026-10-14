/**
 * Länderabhängige Beschriftungen des Projektstandorts (Land + Postleitzahl).
 *
 * Rein, damit Formular (Client) und Server Action dieselben Sätze benutzen. Die Regel selbst steht
 * in `shared/country`; hier stehen nur die Worte dazu.
 */

import { POSTAL_CODE_LENGTH, type Country } from 'shared/country'

export const COUNTRY_REQUIRED = 'Bitte ein Land wählen.'

export function postalCodeFormatError(country: Country): string {
  return country === 'AT'
    ? 'Eine österreichische Postleitzahl hat genau vier Ziffern.'
    : 'Eine deutsche Postleitzahl hat genau fünf Ziffern.'
}

export function postalCodeHint(country: Country): string {
  return country === 'AT'
    ? 'Vier Ziffern, österreichisch — z. B. 1100. Sie gilt für das ganze Projekt.'
    : 'Fünf Ziffern, deutsch — z. B. 10115. Sie gilt für das ganze Projekt.'
}

/** Eingabelänge im Feld; `normalizePostalCodeFor` erlaubt bei AT Präfixe wie „A-1100". */
export function postalCodeMaxLength(country: Country): number {
  return country === 'AT' ? 8 : POSTAL_CODE_LENGTH[country]
}
