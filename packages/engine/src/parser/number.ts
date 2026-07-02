// Zahl-Parsing mit Dezimal-/Tausendertrenner-Erkennung (§3.2).

export type DecimalSeparator = ',' | '.'

/**
 * Erkennt den Dezimaltrenner aus Wert-Stichproben.
 * Regel: Kommen in EINEM Wert beide Zeichen vor, ist das zuletzt stehende der Dezimaltrenner
 * (z. B. "1.234,56" → ","; "1,234.56" → "."). Kommt nur eines vor, gibt `fallback` den Ausschlag,
 * außer ein alleinstehendes Komma spricht klar für "," (deutsches Format).
 */
export function detectDecimalSeparator(
  samples: string[],
  fallback: DecimalSeparator = '.',
): DecimalSeparator {
  let comma = 0
  let dot = 0
  for (const raw of samples) {
    const s = raw.trim()
    if (s === '') continue
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) comma++
      else dot++
    } else if (lastComma >= 0) {
      // Nur Komma vorhanden: als Dezimaltrenner werten, außer es sieht nach Tausender aus (mehrere Kommas).
      if ((s.match(/,/g) ?? []).length === 1) comma++
      else dot++
    } else if (lastDot >= 0) {
      if ((s.match(/\./g) ?? []).length === 1) dot++
      else comma++ // mehrere Punkte → Tausendertrenner → Dezimal ist ','
    }
  }
  if (comma === 0 && dot === 0) return fallback
  return comma > dot ? ',' : '.'
}

/** Parst eine Zahl unter Berücksichtigung von Dezimal- und Tausendertrenner. Ungültig → NaN. */
export function parseNumber(raw: string, decimal: DecimalSeparator): number {
  // \s deckt auch geschützte Leerzeichen (U+00A0) ab.
  let s = raw.replace(/\s+/g, '')
  if (s === '') return NaN
  if (decimal === ',') {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/,/g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/** True, wenn der String plausibel eine Zahl ist (für Spaltenerkennung). */
export function looksNumeric(raw: string, decimal: DecimalSeparator): boolean {
  return Number.isFinite(parseNumber(raw, decimal))
}
