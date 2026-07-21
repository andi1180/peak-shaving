/**
 * Die Rechnung des SCHNELLRECHNERS (§5.4) — herausgezogen aus
 * `components/quick-calculator.tsx`, damit sie zweimal gebraucht werden kann und trotzdem nur
 * einmal existiert:
 *
 *   1. im Browser, für die live nachgerechnete Anzeige (unverändert),
 *   2. auf dem Server, wenn jemand sich sein Ergebnis zuschicken lässt (B3-2, 'rechnerergebnis').
 *
 * DER SERVER RECHNET SELBST NACH, statt das angezeigte Ergebnis vom Client entgegenzunehmen. Sonst
 * wäre die Zahl in unserer eigenen E-Mail frei wählbar — dieselbe Regel wie beim Thema-Label des
 * Kontaktformulars, das die Route serverseitig auflöst.
 *
 * REIN: kein `server-only`, kein React, kein `next/*`. Die Formel ist bewusst weiterhin trivial
 * (Zielreduktion × Leistungspreis) und NICHT `packages/engine` — die Grenze Teaser/Pro-Kalkulator
 * bleibt, wo sie ist (§5.4).
 */

/** Die drei Eingaben des Schnellrechners, in seinen eigenen Bezeichnungen. */
export type QuickCalculatorInputs = {
  /** Aktuelle Leistungsspitze (kW). */
  peakKw: number
  /** Zielreduktion (kW). */
  reductionKw: number
  /** Leistungspreis (€/kW·a). */
  pricePerKwYear: number
}

export type QuickCalculatorResult = {
  /** Für die Rechnung verwendete Reduktion — ggf. auf die Spitze geklemmt. */
  effectiveReductionKw: number
  /** Jährliche Ersparnis (€). */
  savingEur: number
  /** Die Reduktion lag über der Spitze und wurde begrenzt. */
  capped: boolean
}

/**
 * Ersparnis aus drei gültigen Zahlen. `null`, wenn das Produkt nicht mehr endlich ist — dann gibt es
 * kein Ergebnis, und ein „Infinity" in einer E-Mail wäre schlimmer als gar keine Zahl.
 *
 * Die Klemmung auf die Spitze ist dieselbe wie im Formular: mehr als die aktuelle Spitze lässt sich
 * nicht wegnehmen. Ohne sie wäre die Spitzen-Eingabe ein Feld ohne jede Wirkung.
 */
export function computeQuickSaving(inputs: QuickCalculatorInputs): QuickCalculatorResult | null {
  const { peakKw, reductionKw, pricePerKwYear } = inputs
  if (![peakKw, reductionKw, pricePerKwYear].every((v) => Number.isFinite(v))) return null

  const capped = reductionKw > peakKw
  const effectiveReductionKw = capped ? peakKw : reductionKw

  const savingEur = effectiveReductionKw * pricePerKwYear
  if (!Number.isFinite(savingEur)) return null

  return { effectiveReductionKw, savingEur, capped }
}

/*
 * ZWEI Locales, mit Grund — nachgemessen, nicht geraten:
 * de-AT gruppiert WÄHRUNG mit Punkt („€ 9.576.000"), blanke ZAHLEN aber mit einem geschützten
 * Leerzeichen („48 000"). Beides nebeneinander wären zwei verschiedene Tausendertrenner im Abstand
 * von 20 px — und der Tausenderpunkt ist gefordert. Deshalb:
 *   Währung  -> de-AT: „€ 12.000". Punkt-Gruppierung UND identisch zur Report-Formatierung des
 *               Pro-Kalkulators (apps/website/lib/format.ts). Der Übergang Marketing -> Kalkulator
 *               soll wie EIN Produkt lesen.
 *   Zahlen   -> de-DE: „48.000" / „82,92". Punkt-Gruppierung, Komma-Dezimaltrenner — genau das
 *               deutsche Zahlenformat, das de-AT hier NICHT liefert.
 *
 * Sie stehen seit B3-2 hier und nicht mehr in der Komponente, weil die Ergebnis-Mail dieselben
 * Zahlen zeigen muss wie der Bildschirm. Zwei Formatierungen wären zwei Beträge für dasselbe
 * Ergebnis — und die Mail käme genau dann in Erinnerung, wenn sie vom Gesehenen abweicht.
 */
export const QUICK_EUR = new Intl.NumberFormat('de-AT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

/**
 * 2 Nachkommastellen, nicht 1: die Formel unter dem Ergebnis muss dieses Ergebnis REPRODUZIEREN.
 * Bei 1 Stelle würde ein realer Leistungspreis wie 82,92 €/kW·a als „82,9" angezeigt, gerechnet aber
 * mit 82,92 — eine Formel, die ihre eigene Zahl nicht ergibt, wäre schlimmer als gar keine.
 */
export const QUICK_DECIMAL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 })
