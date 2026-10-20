/** Die sechs Branchen in der Reihenfolge des Prototyps; Texte unter `Schnellreport.branchen`. */
export const BRANCHE_KEYS = [
  'produktion',
  'lebensmittel',
  'gastro',
  'logistik',
  'handel',
  'sonstige',
] as const

export type BrancheKey = (typeof BRANCHE_KEYS)[number]

export function isBrancheKey(value: unknown): value is BrancheKey {
  return typeof value === 'string' && (BRANCHE_KEYS as readonly string[]).includes(value)
}
