/*
 * Schnellcheck (Leadgen-Umbau Schritt 3a) — reine Rechnung, ohne React und ohne Datenbank.
 * Vorlage für Verhalten und Rundung: `docs/prototypes/schnellcheck-prototyp.html`.
 */

/**
 * Durchschnittlicher Leistungspreis in Österreich, € pro kW und Jahr, Stand 2026.
 *
 * Ungewichteter Mittelwert der Leistungspreise NE 5–7 (gemessene Leistung) über 13 Netzbereiche
 * ohne Kleinwalsertal, SNE-V 2018 idF BGBl. II Nr. 305/2025. Mit Inkrafttreten der neuen
 * Netztarife 2027 neu berechnen (Jahrespflege, `apps/web/CLAUDE.md`).
 */
export const AVG_DEMAND_PRICE_EUR_PER_KW_YEAR = 67

/** Unterhalb dieses Jahresverbrauchs erscheint ein Hinweis — keine Sperre. */
export const SMALL_CONSUMPTION_KWH = 90_000

/** Regler, wenn keine höchste Leistung eingegeben ist. Der Startwert ist ein Beispielwert. */
export const KW_SLIDER = { min: 20, max: 1000, step: 5, initial: 150 } as const

export type Country = 'AT' | 'DE'

export type SchnellcheckInput = {
  country: Country
  kwh: number | null
  kw: number | null
  bill: number | null
  sliderKw: number
}

export type BillShare = {
  billEur: number
  peakEur: number
  restEur: number
  /** Anteil der Spitzenkosten an der Rechnung, 0–100, ungerundet (Balkenbreite). */
  share: number
  /** Derselbe Anteil auf ganze Prozent gerundet (Anzeige). */
  percent: number
}

export type SchnellcheckResult =
  | { country: 'DE'; smallConsumption: boolean }
  | {
      country: 'AT'
      smallConsumption: boolean
      kw: number
      /** true = vom Nutzer eingegeben, false = Reglerwert (Beispiel). */
      kwFromInput: boolean
      peakCostEur: number
      bill: BillShare | null
    }

const GROUPED = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

/** Ganze Zahl mit Tausenderpunkt („250.000"). */
export function formatGrouped(n: number): string {
  return GROUPED.format(Math.round(n))
}

/**
 * Liest eine getippte Zahl: Punkte sind Tausendertrenner, ein Komma ist Dezimaltrenner, alles
 * andere fällt weg. Kein positiver Wert → null.
 */
export function parseGroupedNumber(raw: string): number | null {
  const normalized = raw
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '')
  const value = Number.parseFloat(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Feldwert nach einer Eingabe: gültige Zahl mit Tausenderpunkt, sonst nur Ziffern und Punkte. */
export function formatTyped(raw: string): string {
  const value = parseGroupedNumber(raw)
  return value === null ? raw.replace(/[^\d.]/g, '') : formatGrouped(value)
}

/** Spitzenkosten pro Jahr: kW × Durchschnittsleistungspreis, auf 100 € gerundet. */
export function peakCostEur(kw: number): number {
  return Math.round((kw * AVG_DEMAND_PRICE_EUR_PER_KW_YEAR) / 100) * 100
}

/** Rechnungsbalken nur, wenn die Spitzenkosten kleiner als die Rechnung sind. */
export function billShare(peakEur: number, billEur: number | null): BillShare | null {
  if (billEur === null || peakEur >= billEur) return null
  const share = (peakEur / billEur) * 100
  return { billEur, peakEur, restEur: billEur - peakEur, share, percent: Math.round(share) }
}

/** Ohne Jahresverbrauch gibt es kein Ergebnis. In Deutschland wird keine Euro-Zahl gerechnet. */
export function computeSchnellcheck(input: SchnellcheckInput): SchnellcheckResult | null {
  if (input.kwh === null) return null
  const smallConsumption = input.kwh < SMALL_CONSUMPTION_KWH
  if (input.country === 'DE') return { country: 'DE', smallConsumption }

  const kwFromInput = input.kw !== null
  const kw = input.kw ?? input.sliderKw
  const peak = peakCostEur(kw)
  return {
    country: 'AT',
    smallConsumption,
    kw,
    kwFromInput,
    peakCostEur: peak,
    bill: billShare(peak, input.bill),
  }
}
