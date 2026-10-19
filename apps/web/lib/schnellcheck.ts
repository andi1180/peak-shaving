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
export const LP_AT = 67

/**
 * Leistungspreise Deutschland, € pro kW und Jahr: Mittelwerte Niederspannung aus einer Stichprobe
 * von 18 Netzbetreibern, vorläufige Preisblätter 2027 (cleverwatt.energy, Stand 10.10.2026) —
 * unter 2.500 Benutzungsstunden 33,53 → 34, ab 2.500 Stunden 151,65 → 152. Mit den endgültigen
 * Preisblättern 2027 prüfen (Jahrespflege, `apps/web/CLAUDE.md`).
 */
export const LP_DE_LOW = 34
export const LP_DE_HIGH = 152

/** Grenze der Benutzungsdauer in Stunden pro Jahr; genau 2.500 h zählen schon zum hohen Preis. */
export const BD_LIMIT = 2500

/** Anteil, um den die Spitze in der Beispielrechnung sinkt (10-%-Box). */
export const SAVING_SHARE = 0.1

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

export type SchnellcheckResult = {
  country: Country
  smallConsumption: boolean
  kw: number
  /** true = vom Nutzer eingegeben, false = Reglerwert (Beispiel). */
  kwFromInput: boolean
  /** Leistungspreis in € pro kW und Jahr, mit dem gerechnet wurde. */
  demandPrice: number
  /** Benutzungsstunden (Jahresverbrauch / kW), nur in Deutschland. */
  usageHours: number | null
  peakCostEur: number
  /** Ersparnis bei einer um 10 % niedrigeren Spitze, auf 100 € gerundet. */
  savingEur: number
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

const round100 = (n: number) => Math.round(n / 100) * 100

/** Benutzungsstunden pro Jahr: Jahresverbrauch geteilt durch die höchste Leistung. */
export function usageHours(kwh: number, kw: number): number {
  return kwh / kw
}

/** Leistungspreis je Land; in Deutschland hängt er an der Benutzungsdauer. */
export function demandPrice(country: Country, kwh: number, kw: number): number {
  if (country === 'AT') return LP_AT
  return usageHours(kwh, kw) >= BD_LIMIT ? LP_DE_HIGH : LP_DE_LOW
}

/** Rechnungsbalken nur, wenn die Spitzenkosten kleiner als die Rechnung sind. */
export function billShare(peakEur: number, billEur: number | null): BillShare | null {
  if (billEur === null || peakEur >= billEur) return null
  const share = (peakEur / billEur) * 100
  return { billEur, peakEur, restEur: billEur - peakEur, share, percent: Math.round(share) }
}

/** Ohne Jahresverbrauch gibt es kein Ergebnis. Beide Länder rechnen kW × Leistungspreis. */
export function computeSchnellcheck(input: SchnellcheckInput): SchnellcheckResult | null {
  if (input.kwh === null) return null
  const kwFromInput = input.kw !== null
  const kw = input.kw ?? input.sliderKw
  const price = demandPrice(input.country, input.kwh, kw)
  const peak = round100(kw * price)
  return {
    country: input.country,
    smallConsumption: input.kwh < SMALL_CONSUMPTION_KWH,
    kw,
    kwFromInput,
    demandPrice: price,
    usageHours: input.country === 'DE' ? usageHours(input.kwh, kw) : null,
    peakCostEur: peak,
    savingEur: round100(kw * price * SAVING_SHARE),
    bill: billShare(peak, input.bill),
  }
}
