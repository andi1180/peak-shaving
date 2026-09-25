import { hasMeteringVariant } from 'shared'

/**
 * Ob für diesen Anschluss ein Abrechnungsmodell überhaupt gilt — nicht auf NE 7 ohne
 * Leistungsmessung, dort fällt kein Leistungspreis an (dieselbe Bedingung wie `noPowerMeasurement`
 * im öffentlichen Rechner). Liest `netzebene` als „NE 7" (Entwurf) wie als „7" (Formular).
 */
export function billingModelApplies(fields: {
  netzebene?: unknown
  meteringVariant?: unknown
}): boolean {
  if (fields.meteringVariant !== 'ohne_leistungsmessung') return true
  const level = Number(
    String(fields.netzebene ?? '')
      .trim()
      .replace(/^NE\s*/i, ''),
  )
  return !hasMeteringVariant(level)
}
