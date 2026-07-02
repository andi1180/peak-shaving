// Zahlformatierung, de-AT. tabular-nums wird beim Rendern per Klasse gesetzt (siehe <Num>).
const de = (opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat('de-AT', opts)

export function formatKw(value: number): string {
  return `${de({ maximumFractionDigits: 1 }).format(value)} kW`
}

export function formatKwh(value: number): string {
  return `${de({ maximumFractionDigits: 0 }).format(value)} kWh`
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
