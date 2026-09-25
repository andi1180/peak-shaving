import type { LoadProfile, TariffOptimizationBlocker, TariffParams } from 'shared'

/**
 * Warum eine Analyse NICHT gerechnet wird — benannte Zustände statt einer Schätzung
 * („Eigener Tarif unbekannt", 25.09.2026; Muster wie die NE-7-Verweigerung).
 *
 * `supplier_tariff_unknown_without_price_basis`: ohne eigenen Arbeitspreis ist die aWATTar-Reihe
 * die einzige Preisbasis; ist sie nicht rechenbar, gäbe es einen Report ohne Zahlen.
 * `blocker` nennt die fehlende Seite, `null` heisst: Preisdaten wurden gar nicht angefordert.
 *
 * `feed_in_tariff_missing`: der Lastgang speist ein oder PV ist erfasst, aber die
 * Einspeisevergütung fehlt — jede eingespeiste kWh bliebe unbewertet.
 */
export type AnalysisRefusal =
  | {
      reason: 'supplier_tariff_unknown_without_price_basis'
      blocker: TariffOptimizationBlocker | null
    }
  | { reason: 'feed_in_tariff_missing' }

export class AnalysisRefusedError extends Error {
  constructor(readonly refusal: AnalysisRefusal) {
    super(refusalMessage(refusal))
    this.name = 'AnalysisRefusedError'
  }
}

const BLOCKER_SIDE_LABEL: Record<TariffOptimizationBlocker['side'], string> = {
  grid_tariff: 'Netzentgelt',
  spot_price: 'Spotpreise',
  levy: 'Abgaben',
}

function refusalMessage(refusal: AnalysisRefusal): string {
  if (refusal.reason === 'feed_in_tariff_missing') {
    return (
      'Die Einspeisevergütung fehlt, obwohl eingespeist wird (Einspeisung im Lastgang oder PV ' +
      'erfasst). Ohne sie bliebe jede eingespeiste kWh unbewertet — bitte in der Rechnung-Station ' +
      'nachtragen.'
    )
  }
  const basis = refusal.blocker
    ? `fehlende Grundlage: ${BLOCKER_SIDE_LABEL[refusal.blocker.side]} — ${refusal.blocker.message}`
    : 'fehlende Grundlage: Netzentgelt, Abgaben und Spotpreise wurden nicht abgefragt'
  return (
    'Der eigene Liefertarif ist unbekannt, und der aWATTar-Vergleich ist für diesen Zeitraum nicht ' +
    `rechenbar (${basis}). Ohne ihn gibt es keine Preisbasis; die Analyse wird nicht gerechnet.`
  )
}

/** Speist der Lastgang in mindestens einem Intervall ein? */
export function hasFeedIn(loadProfile: LoadProfile): boolean {
  return loadProfile.readings.some((reading) => reading.gridPowerKw < 0)
}

/**
 * Die Einspeisevergütung, wo sie gelesen wird. Fehlt sie bei einspeisendem Lastgang, wird
 * abgebrochen; ohne Einspeisung wird die 0 nie mit einer kWh multipliziert.
 */
export function feedInTariffCtPerKwh(loadProfile: LoadProfile, tariffParams: TariffParams): number {
  const value = tariffParams.einspeiseverguetungCtPerKwh
  if (value !== undefined) return value
  if (hasFeedIn(loadProfile)) throw new AnalysisRefusedError({ reason: 'feed_in_tariff_missing' })
  return 0
}
