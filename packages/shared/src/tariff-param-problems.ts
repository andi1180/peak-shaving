import type { ZodIssue } from 'zod'

import type { tariffParamsSchema } from './tariff'

/**
 * Klartext-Namen der `TariffParams`-Felder für Meldungen an den Admin — eine Tabelle für alle Länder.
 * Die Einheit steht mit dabei, weil sie bestimmt, welche Zeile der Rechnung gemeint ist.
 */
export const TARIFF_PARAM_LABELS = {
  leistungspreisEurPerKwYear: 'Leistungspreis Netz (€/kW·a)',
  minBillableKw: 'Mindestleistung (kW)',
  energyPriceCtPerKwh: 'Energie-Arbeitspreis (ct/kWh)',
  billingModel: 'Abrechnungsmodell',
  meteringVariant: 'Messvariante',
  netzebene: 'Netzebene',
  arbeitspreisNetzCtPerKwh: 'Netz-Arbeitspreis (ct/kWh)',
  energyPriceNightCtPerKwh: 'Nachttarif (ct/kWh)',
  supplierBaseFeeEurPerMonth: 'Grundgebühr des Lieferanten (€/Monat)',
  einspeiseverguetungCtPerKwh: 'Einspeisevergütung (ct/kWh)',
  supplierTariff: 'Liefertarif bekannt/unbekannt',
  comparisonSupplier: 'Vergleichstarif',
  timeOfUseWindows: 'Tarifzeitfenster',
  dynamicPriceProfile: 'Dynamisches Preisprofil',
  benutzungsdauerModel: 'Benutzungsdauer-Modell',
} as const satisfies Record<keyof typeof tariffParamsSchema.shape, string>

const FIELD_ORDER = Object.keys(TARIFF_PARAM_LABELS)

function labelOf(field: string): string {
  return (TARIFF_PARAM_LABELS as Record<string, string>)[field] ?? field
}

function isMissing(issue: ZodIssue): boolean {
  if (issue.code === 'invalid_type') return issue.received === 'undefined'
  return issue.code === 'custom' && issue.message === 'Required'
}

/**
 * Eine Meldung für alle Probleme eines abgewiesenen Tarif-Kandidaten auf einmal.
 *
 * Der Energie-Arbeitspreis wird zusätzlich am Kandidaten selbst geprüft: seine Pflicht steht in
 * einem `superRefine`, das zod erst ausführt, wenn die Basisfelder passen — sonst erführe der Admin
 * erst nach dem nächsten Speichern, dass noch ein Feld fehlt.
 */
export function describeTariffParamsProblems(
  candidate: Record<string, unknown>,
  issues: readonly ZodIssue[],
): string {
  const missing = new Set<string>()
  const invalid = new Map<string, string>()

  for (const issue of issues) {
    const field = String(issue.path[0] ?? '')
    if (isMissing(issue)) missing.add(field)
    else if (!invalid.has(field)) {
      invalid.set(field, issue.code === 'custom' ? issue.message : 'Wert wird nicht angenommen')
    }
  }
  if (candidate.supplierTariff !== 'unknown' && candidate.energyPriceCtPerKwh === undefined) {
    missing.add('energyPriceCtPerKwh')
  }

  const rank = (field: string) => {
    const index = FIELD_ORDER.indexOf(field)
    return index === -1 ? FIELD_ORDER.length : index
  }
  const ordered = (fields: Iterable<string>) => [...fields].sort((a, b) => rank(a) - rank(b))

  const parts: string[] = []
  if (missing.size > 0) {
    parts.push(`Für die Berechnung fehlen: ${ordered(missing).map(labelOf).join(', ')}.`)
  }
  if (invalid.size > 0) {
    const entries = ordered(invalid.keys()).map(
      (field) => `${labelOf(field)} (${invalid.get(field)})`,
    )
    parts.push(`Nicht verwendbar: ${entries.join(', ')}.`)
  }
  parts.push(
    'Eintragen in: Rechnung-Station (oder Knopf „Werte vorschlagen" aus dem Preisblatt bzw. ' +
      '„Ohne Rechnung fortfahren").',
  )
  return parts.join(' ')
}
