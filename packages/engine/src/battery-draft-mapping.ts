import {
  ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY,
  buildExistingBatteryCandidate,
  EXISTING_BATTERY_DRAFT_KEYS,
} from 'shared'

import type { ExistingBatteryInput } from './compute-analysis'

/**
 * D3, Baustein 2 — DER WIZARD-ENTWURF WIRD ZU `ExistingBatteryInput`.
 *
 * Das Gegenstück zu `tariff/draft-mapping.ts` für den bereits installierten Speicher des Kunden,
 * und nach demselben Zuschnitt: REIN (kein I/O, kein Nachschlagen, kein Katalog), deterministisch,
 * und sie rät nicht. Sie liegt neben `compute-analysis.ts` statt unter `tariff/`, weil ihr Ergebnis
 * ein Feld des Payloads ist und mit der Tarifschicht nichts zu tun hat.
 *
 * ⚠ SIE BAUT DENSELBEN KANDIDATEN WIE DER ÖFFENTLICHE RECHNER (`battery-text-panel.tsx`): über
 * `buildExistingBatteryCandidate`, mit den EXAKTEN Werten des Kunden und ohne Rundung auf einen
 * Katalog-Kandidaten. Zwei Wege, ein Speicher, eine Zahl.
 *
 * ── ⚠ DER PREIS BLEIBT AUSSEN VOR ─────────────────────────────────────────────────────────────
 * `existingBatteryPricePerKwh` wird hier NICHT gelesen. Eine installierte Anlage ist bezahlt (Sunk
 * Cost); ihre Investitionsfelder kommen ausschliesslich aus `NO_INVESTMENT_FIELDS`
 * (`packages/shared/src/battery-combination.ts`). Mit einem echten Preis geriete der Bestand in
 * eine Amortisationsrechnung, die es für ihn nicht gibt.
 *
 * ── ⚠ `wantsBatteryRecommendation` WIRD EBENFALLS NICHT GELESEN ───────────────────────────────
 * `computeAnalysis` rechnet `perBattery` immer über den vollen Katalog. Das Feld beantwortet eine
 * Frage der ANZEIGE, nicht der Rechnung.
 */

/** Eine Zahl aus dem `jsonb`-Entwurf — alles andere heisst „keine Angabe". */
function readPositiveNumber(draft: Record<string, unknown>, key: string): number | undefined {
  const value = draft[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value
}

/**
 * Bildet die Bestandsbatterie eines Zählpunkt-Entwurfs auf `ExistingBatteryInput` ab.
 *
 * `undefined` heisst „kein Bestandsblock" — dann verhält sich die Rechnung wie ohne bestehende
 * Anlage (voller Katalog, Empfehlung, Amortisation).
 *
 * ⚠ OFFENE KANTE, BEWUSST SO: `hasBattery: true` OHNE Kapazität oder Leistung ergibt ebenfalls
 * `undefined`. Der Zustand ist real (die Station wurde mit „ja" beantwortet, die Kenndaten stehen
 * noch aus), und eine Simulation ohne diese zwei Grössen gibt es nicht (§3.6). Der Lauf rechnet
 * dann ohne den Speicher — wer das enger fassen will, tut es hier, nicht beim Aufrufer.
 *
 * @throws wenn ein Wirkungsgrad DASTEHT, aber kein brauchbarer Prozentwert ist. Er sagt dann etwas
 *         aus, das sich nicht einlösen lässt; ihn auf die Annahme zurückfallen zu lassen ersetzte
 *         eine Angabe des Kunden still durch eine fremde Zahl.
 */
export function mapDraftToExistingBatteryInput(
  draft: Record<string, unknown>,
): ExistingBatteryInput | undefined {
  if (draft[EXISTING_BATTERY_DRAFT_KEYS.present] !== true) return undefined

  const usableCapacityKwh = readPositiveNumber(draft, EXISTING_BATTERY_DRAFT_KEYS.capacityKwh)
  const maxPowerKw = readPositiveNumber(draft, EXISTING_BATTERY_DRAFT_KEYS.maxPowerKw)
  if (usableCapacityKwh === undefined || maxPowerKw === undefined) return undefined

  const rawEfficiency = draft[EXISTING_BATTERY_DRAFT_KEYS.roundTripEfficiencyPercent]
  const efficiencyAssumed = rawEfficiency === undefined || rawEfficiency === null
  if (
    !efficiencyAssumed &&
    (typeof rawEfficiency !== 'number' ||
      !Number.isFinite(rawEfficiency) ||
      rawEfficiency <= 0 ||
      rawEfficiency > 100)
  ) {
    throw new Error(
      `Der Entwurf trägt unter \`${EXISTING_BATTERY_DRAFT_KEYS.roundTripEfficiencyPercent}\` ` +
        `keinen brauchbaren Prozentwert (${String(rawEfficiency)}). Erwartet wird eine Zahl in ` +
        '(0, 100] — in PROZENT, wie ein Mensch sie schreibt.',
    )
  }

  return {
    battery: buildExistingBatteryCandidate({
      usableCapacityKwh,
      maxPowerKw,
      // ⚠ Prozent → Bruchteil. Die Station erfasst 90, die Simulation rechnet mit 0,9.
      roundTripEfficiency: efficiencyAssumed
        ? ASSUMED_EXISTING_ROUND_TRIP_EFFICIENCY
        : (rawEfficiency as number) / 100,
    }),
    efficiencyAssumed,
  }
}
