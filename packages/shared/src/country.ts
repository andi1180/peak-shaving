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
