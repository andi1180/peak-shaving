/** Ein Lastgang-CSV im lokalen Netzbetreiber-Format (`;`, Dezimalkomma), nur für Tests. */
export function lastgangCsv(intervalMinutes: number, days = 2): string {
  const two = (n: number) => String(n).padStart(2, '0')
  const lines = ['Zeitstempel;Leistung (kW)']
  for (let day = 1; day <= days; day++) {
    for (let m = 0; m < 24 * 60; m += intervalMinutes) {
      const value = (3 + ((m / intervalMinutes) % 7) * 0.1).toFixed(2).replace('.', ',')
      lines.push(`${two(day)}.06.2025 ${two(Math.floor(m / 60))}:${two(m % 60)};${value}`)
    }
  }
  return lines.join('\n')
}

export const HOURLY_LOAD_PROFILE_MESSAGE =
  'Die Datei enthält Werte im 60-Minuten-Raster. Wir benötigen den Viertelstunden-Lastgang ' +
  '(15 Minuten); bitte beim Netzbetreiber anfordern.'
