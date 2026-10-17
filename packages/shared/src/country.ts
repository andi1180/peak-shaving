/**
 * Das Land eines Projekts — und die Postleitzahl-Regel je Land.
 *
 * Rein, ohne Abhängigkeiten und ohne Seiteneffekte (auch als Subpfad `shared/country` für
 * Client-Komponenten importierbar, ohne die PLZ-Koordinatentabelle mitzuziehen). Die Preiszone wird bewusst NICHT gespeichert: sie folgt aus dem
 * Land und wird in einem späteren Schritt dort abgeleitet, wo sie gebraucht wird.
 *
 * ⚠ Die Regex hier und der CHECK `projects_postal_code_country_check` in der Datenbank
 * (`20261014090000_project_country.sql`) sind dieselbe Regel in zwei Sprachen — wer eine ändert,
 * ändert beide.
 */

export const COUNTRIES = ['AT', 'DE'] as const

export type Country = (typeof COUNTRIES)[number]

/** Vorgabe und Wert aller Bestandsprojekte. */
export const DEFAULT_COUNTRY: Country = 'AT'

export const COUNTRY_LABELS: Record<Country, string> = {
  AT: 'Österreich',
  DE: 'Deutschland',
}

/** Wie ein Land im Report erscheint: Locale, Monatsnamen und ob das Land im Kopf steht. */
// Kurze Monatsnamen mit drei Buchstaben: einbuchstabig wären J, M und A mehrfach vergeben.
export type CountryDisplay = {
  locale: string
  monthsShort: readonly string[]
  monthsLong: readonly string[]
  /** Anzeige im Report-Kopf; `null` = nicht anzeigen (Vorgabeland). */
  reportLabel: string | null
  /** IANA-Zeitzone, in der Lastgänge dieses Landes gelesen werden (Monats- und Tagesgrenzen). */
  timeZone: string
}

export const COUNTRY_DISPLAY: Record<Country, CountryDisplay> = {
  AT: {
    locale: 'de-AT',
    monthsShort: [
      'Jän',
      'Feb',
      'Mär',
      'Apr',
      'Mai',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Okt',
      'Nov',
      'Dez',
    ],
    monthsLong: [
      'Jänner',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
    reportLabel: null,
    timeZone: 'Europe/Vienna',
  },
  DE: {
    locale: 'de-DE',
    monthsShort: [
      'Jan',
      'Feb',
      'Mär',
      'Apr',
      'Mai',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Okt',
      'Nov',
      'Dez',
    ],
    monthsLong: [
      'Januar',
      'Februar',
      'März',
      'April',
      'Mai',
      'Juni',
      'Juli',
      'August',
      'September',
      'Oktober',
      'November',
      'Dezember',
    ],
    reportLabel: COUNTRY_LABELS.DE,
    timeZone: 'Europe/Berlin',
  },
}

/** Anzeige-Daten eines Landes; ohne Angabe gilt das Vorgabeland (alte Übergaben, AT-Fixtures). */
export function countryDisplay(country: Country | null | undefined): CountryDisplay {
  return COUNTRY_DISPLAY[country ?? DEFAULT_COUNTRY]
}

export function isCountry(value: unknown): value is Country {
  return typeof value === 'string' && (COUNTRIES as readonly string[]).includes(value)
}

/** Ziffernzahl der Postleitzahl: Österreich vier, Deutschland fünf. */
export const POSTAL_CODE_LENGTH: Record<Country, number> = {
  AT: 4,
  DE: 5,
}

export function isValidPostalCode(country: Country, postalCode: string): boolean {
  return new RegExp(`^[0-9]{${POSTAL_CODE_LENGTH[country]}}$`).test(postalCode)
}

/**
 * Österreichische Schreibweisen (`1100`, `A-1100`, `AT 1100`, mit Leerzeichen) auf die vierstellige
 * Form; alles andere ergibt `null`. Die EINE Stelle dieser Regel — `normalizePostalCode`
 * (plz-centroids) delegiert hierher.
 */
export function normalizeAtPostalCode(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toUpperCase()
    .replace(/^A[T]?[\s-]*/, '')
    .replace(/\s+/g, '')
  return /^\d{4}$/.test(cleaned) ? cleaned : null
}

/**
 * Eingetippte PLZ → die Form, die gespeichert wird, oder `null`, wenn sie für das Land keine PLZ ist.
 *
 * AT übernimmt die Schreibweisen österreichischer Briefköpfe („A-1100", „AT 1100"); DE verlangt
 * genau fünf Ziffern und normalisiert nichts. Wird im Wizard (clientseitig) und in der Server
 * Action benutzt — dieselbe Regel an beiden Orten.
 */
export function normalizePostalCodeFor(country: Country, raw: string): string | null {
  if (country === 'AT') return normalizeAtPostalCode(raw)
  const trimmed = raw.trim()
  return isValidPostalCode(country, trimmed) ? trimmed : null
}

/** Quellenschlüssel in `public.spot_prices.provider` — je Preiszone eine aWATTar-Instanz. */
export type SpotPriceProvider = 'awattar_at' | 'awattar_de'

/** Die Day-Ahead-Quelle eines Landes: AT → aWATTar Österreich, DE → aWATTar Deutschland (DE-LU). */
export function spotPriceProviderFor(country: Country): SpotPriceProvider {
  return country === 'AT' ? 'awattar_at' : 'awattar_de'
}
