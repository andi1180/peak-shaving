import type { BatteryCandidate } from './battery'

/**
 * Der Speicher des Kunden — und der virtuelle Speicher „Bestand + ein Zusatzgerät".
 *
 * ── WARUM ES DIESES MODUL GIBT ─────────────────────────────────────────────────────────────────
 * Bis 01.09.2026 wurde eine Freitext-Angabe („Sungrow, 19,2 kWh, 10,6 kW, 90 %") auf den
 * NÄCHSTLIEGENDEN der fünf Katalog-Kandidaten abgebildet (Delta 17 Teil 2). Die Begründung dort
 * war, dass für eine erfundene Kapazität kein Preis existiert — und sie trägt für die
 * KAUFENTSCHEIDUNG weiterhin. Für die bestehende Anlage trägt sie nicht: dort wird gar kein Preis
 * gezeigt (die Anschaffung ist bezahlt, s. `RecommendationCard` Variante `existing`), und was
 * bleibt, ist eine Rechnung über ein Gerät, das der Kunde nicht besitzt. Wer 19,2 kWh hat, bekam
 * eine Ersparnis für 15 kWh zu sehen und hielt sie für seine.
 *
 * Deshalb: die bestehende Anlage wird mit ihren EXAKTEN Werten simuliert und läuft ausdrücklich
 * NICHT durch `recommendBattery`/`perBattery` (kein Ranking, keine Empfehlung, keine Investition).
 *
 * ── WARUM IN `packages/shared` UND NICHT IN `packages/engine` ───────────────────────────────────
 * Dieselbe Aufteilung wie beim `DEMO_BATTERY_CATALOG` und bei `battery-text.ts`: ein Katalog- bzw.
 * Kandidaten-Baustein, den die APP der Engine als Parameter hineinreicht und den der Rechenkern
 * nie selbst holt („Konfiguration an den Rändern, Determinismus im Kern"). Dazu praktisch:
 * `apps/website` hat keinen eigenen Testlauf, `packages/shared` schon — und `apps/web` (das
 * `engine` gar nicht kennt) kann die Typen für die Archiv-Ansicht lesen.
 *
 * Einziger Import ist ein TYP-Import; zur Laufzeit entsteht keine Kopplung.
 */

/**
 * ⚠ DIE VIER FELDER, DIE HIER PLATZHALTER SIND — UND WARUM SIE NIEMAND FÜR EINE INVESTITION
 * HERANZIEHEN DARF.
 *
 * `BatteryCandidate` verlangt `pricePerKwh`, `requiresFoundation`/`foundationCost` und
 * `inverterIncluded`/`extraInverterCost`. Die SIMULATION liest keines davon: `simulateBattery`
 * nimmt über `toPhysics` genau `usableCapacityKwh`, `maxPowerKw`, `roundTripEfficiency` und liest
 * zusätzlich `controlType`; `computeBatterySavings` liest `roundTripEfficiency` und `controlType`.
 * Gelesen werden die vier Felder ausschliesslich in `calculateTotalInvestment` (§3.9) — und genau
 * dorthin dürfen die hier gebauten Kandidaten NIE gelangen:
 *
 *   • Die bestehende Anlage hat keine Investition mehr (Sunk Cost, sie ist bezahlt).
 *   • Bei einer Kombination bezahlt der Kunde ausschliesslich das ZUSATZGERÄT. `calculateRoi` wird
 *     deshalb mit dem Katalog-Kandidaten aufgerufen und mit der INKREMENTELLEN Ersparnis — nie mit
 *     dem kombinierten Kandidaten (der trüge die addierte Kapazität zum Zusatzpreis, also eine
 *     Investition, die es nirgends gibt).
 *
 * Die Platzhalter sind bewusst `0` / `false` / `true`: eine erfundene positive Zahl sähe aus wie
 * eine Angabe des Kunden. Käme ein solcher Kandidat je in die ROI-Kette, stünde dort „€ 0" — sicht-
 * bar keine Preisangabe, statt einer plausiblen falschen.
 */
const NO_INVESTMENT_FIELDS = {
  pricePerKwh: 0,
  requiresFoundation: false,
  inverterIncluded: true,
} as const

/** Kennung der bestehenden Kundenanlage — kollisionsfrei gegen jede Katalog-Kennung (Doppelpunkt). */
export const EXISTING_BATTERY_ID = 'existing:kundenanlage'

/** Kennung eines kombinierten virtuellen Speichers — ebenfalls kollisionsfrei (Doppelpunkte). */
export function combinedBatteryId(existingId: string, addonId: string): string {
  return `combined:${existingId}:${addonId}`
}

/** Die drei Grössen, die eine Simulation von einem Speicher tatsächlich braucht (§3.6). */
export type ExistingBatterySpec = {
  usableCapacityKwh: number
  maxPowerKw: number
  /** Bruchteil (0,1], NICHT Prozent — die Umrechnung geschieht an genau einer Stelle im Panel. */
  roundTripEfficiency: number
}

/**
 * Numerisches Netz gegen Fliesskomma-Ausreisser am Rand des Wertebereichs (`.gt(0).max(1)`).
 * KEINE fachliche Regel: ein gewichtetes Mittel zweier Werte aus (0,1] liegt mathematisch immer
 * wieder in (0,1]; die Klammer fängt nur den Fall ab, dass die Summe zweier Produkte durch die
 * Kapazitätssumme minimal über 1 landet.
 */
function clampEfficiency(value: number): number {
  return Math.min(1, Math.max(Number.EPSILON, value))
}

/**
 * Der Speicher des Kunden als simulierbarer Kandidat — mit seinen EXAKTEN Werten.
 *
 * ⚠ `controlType: 'static'` ist gesetzt und nicht abgeleitet (Pessimismus-Prinzip): eine
 * bestehende Anlage steuert im Regelfall keine Spitzenkappung (sie wurde für Eigenverbrauch
 * gebaut), und wir wissen aus einem Freitext nicht, ob eine Peak-Shaving-Steuerung daran hängt.
 * `static` heisst hier: Eigenverbrauch und Lastverschiebung werden gerechnet, die Spitzenkappung
 * NICHT — der Report weist sie mit € 0 aus und sagt im Warntext, dass sie mit zusätzlicher
 * Steuerungshardware erreichbar wäre. Die Gegenrichtung (dynamic annehmen) rechnete dem Kunden
 * eine Ersparnis vor, die seine Anlage möglicherweise gar nicht erbringt.
 */
export function buildExistingBatteryCandidate(spec: ExistingBatterySpec): BatteryCandidate {
  return {
    id: EXISTING_BATTERY_ID,
    name: 'Ihr Speicher',
    manufacturer: 'Ihre Angabe',
    class: spec.usableCapacityKwh >= 20 ? 'commercial' : 'residential',
    usableCapacityKwh: spec.usableCapacityKwh,
    maxPowerKw: spec.maxPowerKw,
    roundTripEfficiency: clampEfficiency(spec.roundTripEfficiency),
    controlType: 'static',
    ...NO_INVESTMENT_FIELDS,
  }
}

/**
 * Der virtuelle Speicher „bestehende Anlage + EIN Zusatzgerät" — die Grundlage der Frage „lohnt
 * sich ein zusätzlicher Speicher?".
 *
 * Kapazität und Leistung addieren sich (zwei Geräte am selben Anschluss laden und entladen
 * gemeinsam). Der Wirkungsgrad ist KAPAZITÄTSGEWICHTET: er ist eine Eigenschaft der gespeicherten
 * kWh, nicht der Geräteanzahl — ein arithmetisches Mittel gäbe einem 5-kWh-Gerät dasselbe Gewicht
 * wie einem 60-kWh-Gerät.
 *
 * ⚠ `controlType: 'static'`, unabhängig von den Eingaben und ausdrücklich auch dann, wenn das
 * Zusatzgerät `dynamic` ist (Pessimismus-Prinzip, dieselbe Entscheidung wie oben). Der Grund ist
 * hier zusätzlich physikalisch: nur ein Teil der kombinierten Kapazität hinge an einer
 * kappungsfähigen Steuerung, und die Simulation kennt keinen „halb kappenden" Speicher. Eine
 * Kombination als `dynamic` zu führen unterstellte, dass auch der Bestand mitkappt.
 *
 * FOLGE, die beim Lesen der Ergebnisse mitzudenken ist: die inkrementelle Ersparnis eines
 * Zusatzgeräts enthält KEINEN Spitzenkappungs-Anteil — sie speist sich aus Eigenverbrauch und
 * tarifbewusstem Laden. Bei einem Kunden MIT Leistungspreis ist der Vergleich dadurch bewusst
 * vorsichtig (s. Handover, offener Punkt).
 */
export function combineBatteries(
  existing: BatteryCandidate,
  addon: BatteryCandidate,
): BatteryCandidate {
  const usableCapacityKwh = existing.usableCapacityKwh + addon.usableCapacityKwh
  const weighted =
    usableCapacityKwh > 0
      ? (existing.usableCapacityKwh * existing.roundTripEfficiency +
          addon.usableCapacityKwh * addon.roundTripEfficiency) /
        usableCapacityKwh
      : existing.roundTripEfficiency

  return {
    id: combinedBatteryId(existing.id, addon.id),
    name: `${existing.name} + ${addon.name}`,
    manufacturer: addon.manufacturer,
    // Reine Anzeigegrösse; der kombinierte Kandidat selbst wird nie als Karte gerendert (gezeigt
    // wird das ZUSATZgerät). Sobald eines der beiden gewerblich ist, ist es die Kombination auch.
    class:
      existing.class === 'commercial' || addon.class === 'commercial' ? 'commercial' : 'residential',
    usableCapacityKwh,
    maxPowerKw: existing.maxPowerKw + addon.maxPowerKw,
    roundTripEfficiency: clampEfficiency(weighted),
    controlType: 'static',
    ...NO_INVESTMENT_FIELDS,
  }
}
