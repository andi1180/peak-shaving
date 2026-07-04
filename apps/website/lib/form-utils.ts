// Geteilte Formular-Helfer (§5 Tarif-Schritt UND §6.2 Annahmen-Panel) — dieselbe Zahlen-
// Eingabe-Logik an zwei Stellen, deshalb hier statt dupliziert.

/** Deutsche Dezimaltrennung tolerieren; leer → NaN (zod lehnt NaN für z.number() ab). */
export function parseNum(s: string): number {
  return s.trim() === '' ? NaN : Number(s.replace(',', '.'))
}

/** Faktor-100-Schutz (§3.9-Kontext): Wert < 1 in einem %-Feld → sanfter Hinweis, KEINE Sperre. */
export function percentHint(s: string): string | null {
  const v = parseNum(s)
  return Number.isFinite(v) && v > 0 && v < 1
    ? `Meinten Sie ${new Intl.NumberFormat('de-AT').format(v * 100)} %?`
    : null
}
