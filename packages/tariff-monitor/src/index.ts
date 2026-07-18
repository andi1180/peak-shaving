// Tarif-Engine (§3/§5): Vergleichs-/Normalisierungskern des Haushalts-Energiemonitors.
// T1-Teil 1 — der Output-Contract (Typen + Funktionssignaturen). T1-Teil 2 — Normalisierung
// (§5.4, `normalizeTariffCost`). T1-Teil 3 — Vergleich (§1.3/§3/§9, `compareTariffs`).
// T1-Teil 4 — Plausibilitäts-Automatik (§5.3, `checkPlausibility`).
export * from './types'
export * from './normalize'
export * from './compare'
export * from './plausibility'
