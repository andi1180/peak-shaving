// Output-Contract der Tarif-Engine (§5.1/§5.3/§5.4/§9). Reine Typen — alle drei Kernfunktionen
// sind implementiert: `normalizeTariffCost` (`./normalize/normalize.ts`), `compareTariffs`
// (`./compare/compare.ts`), `checkPlausibility` (`./plausibility/plausibility.ts`).
// Barrel-Reexport über `./index.ts`.

// ── Eingabe: der Nutzer-Ist-Zustand (Stufe 1 Pflicht, Stufe 2 optional, §5.1) ──
export type UserTariffInput = {
  // Stufe 1 — Pflicht
  annualConsumptionKwh: number
  energyPriceCtPerKwh: number // NUR Lieferantenanteil, nie Gesamtpreis (§1.4)
  baseFeeEurPerYear: number // Grundgebühr, auf €/Jahr normalisiert
  postalCode: string // → Netzgebiet, für T2-Abgleich
  // Stufe 2 — optional, hebt confidence
  providerName?: string
  tariffName?: string
  bonusEur?: number
  bonusConditionText?: string
  priceGuaranteeMonths?: number
  contractCommitmentMonths?: number
  billingCycle?: 'monthly' | 'annual'
  greenEnergy?: boolean
}

// ── Ein Tarif-Kandidat (eigener Ist-Tarif ODER Zeile aus der Scraping-Tabelle T2) ──
export type TariffCostObject = {
  providerName: string
  tariffName: string
  energyPriceCtPerKwh: number
  baseFeeEurPerYear: number
  bonusEur: number // 0 wenn keiner
  bonusConditionText?: string
  priceGuaranteeMonths?: number // fehlt = unbefristet/unbekannt
  contractCommitmentMonths: number // 0 = keine Bindung
  billingCycle: 'monthly' | 'annual'
  greenEnergy: boolean
  requiresPrepayment?: boolean // Vorauskasse ODER Kaution nötig; fehlt/false = nein (§9-Präferenzfilter)
}

// ── normalisiertes Jahreskosten-Ergebnis EINES Tarifs für EINEN Verbrauch (§5.4) ──
export type NormalizedYearlyCost = {
  firstYearCostEur: number // inkl. Bonus
  ongoingYearlyCostEur: number // OHNE Bonus — einzige Headline-Basis (§1.3)
  bonusEur: number // separat, nie in ongoing eingerechnet
  priceGuaranteeMonths?: number // Metadatum, NICHT in Headline gefaltet (§1.3-Annahme)
}

// ── Präferenz-Filter (§9), reine Eingabe ──
export type ComparisonPreferences = {
  greenEnergyOnly?: boolean
  maxContractCommitmentMonths?: number
  excludePrepayment?: boolean
}

// ── Plausibilitäts-Warnung, Stufen 1–4 (§5.3) ──
export type PlausibilityWarning = {
  stage: 1 | 2 | 3 | 4
  field: string
  message: string
}

// ── Vergleichsergebnis: Ist-Tarif vs. Alternative(n) ──
export type TariffComparisonResult = {
  current: NormalizedYearlyCost & { source: 'user_input' }
  alternatives: Array<{
    tariff: TariffCostObject
    cost: NormalizedYearlyCost
    savingOngoingEurPerYear: number // Headline-Ersparnis (Dauerpreis-Basis, §1.3)
    savingFirstYearEur: number // separat, inkl. Bonus-Effekt
    passesPreferenceFilter: boolean // Array kommt VOLLSTÄNDIG zurück, UI filtert/slice't
  }>
  recommendation?: { tariff: TariffCostObject; rationale: string }
  confidence: 'rough' | 'detailed' // Feld-Tiefe, KEIN Abo-Flag (§1.1/§3)
  plausibility: { warnings: PlausibilityWarning[] }
}
