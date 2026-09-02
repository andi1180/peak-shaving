// Zahlformatierung, de-AT. tabular-nums wird beim Rendern per Klasse gesetzt (siehe <Num>).
const de = (opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat('de-AT', opts)

export function formatKw(value: number): string {
  return `${de({ maximumFractionDigits: 1 }).format(value)} kW`
}

export function formatKwh(value: number): string {
  return `${de({ maximumFractionDigits: 0 }).format(value)} kWh`
}

/**
 * kWh mit bis zu einer Nachkommastelle — für Angaben, die NICHT gerundet werden dürfen.
 *
 * ⚠ Nötig geworden mit dem Bestandsspeicher (01.09.2026): der Kunde nennt „19,2 kWh", und beides
 * wäre falsch — `formatKwh` machte daraus „19 kWh" (gerundet, obwohl mit 19,2 gerechnet wurde),
 * eine rohe Zahl im JSX „19.2 kWh" (englischer Dezimalpunkt mitten im deutschen Report). Im
 * Live-Lauf gemessen, bevor diese Funktion stand.
 */
export function formatKwh1(value: number): string {
  return `${de({ maximumFractionDigits: 1 }).format(value)} kWh`
}

/**
 * kWp mit bis zu einer Nachkommastelle — die Nennleistung einer PV-Anlage (B22b).
 *
 * ⚠ Eine Nachkommastelle ist Pflicht und keine Feinheit: eine Anlage heisst „10,2 kWp", und auf
 * „10 kWp" gerundet stünde im Report eine andere Anlage, als der Kunde eingegeben hat. Dieselbe
 * Lehre wie bei `formatKwh1` (Bestandsspeicher, 01.09.2026).
 */
export function formatKwp(value: number): string {
  return `${de({ maximumFractionDigits: 1 }).format(value)} kWp`
}

/**
 * Winkelangabe in Grad, de-AT (B22b).
 *
 * ⚠ Sie MUSS durch einen Formatierer laufen: ein negativer PVGIS-Azimut („-47") und eine
 * Nachkommastelle („22.5") kämen als rohe Zahl im englischen Format in einen deutschen Report.
 */
export function formatDeg(value: number): string {
  return `${de({ maximumFractionDigits: 1 }).format(value)}°`
}

/** Euro, ohne Nachkommastellen (Report-Übersichtszahlen). */
export function formatEur(value: number): string {
  return de({ style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
}

/** Euro mit zwei Nachkommastellen (Detailwerte). */
export function formatEur2(value: number): string {
  return de({ style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(value)
}

export function formatYears(value: number): string {
  return `${de({ maximumFractionDigits: 1 }).format(value)} Jahre`
}

export function formatPercent(value: number): string {
  return `${de({ maximumFractionDigits: 1 }).format(value)} %`
}
