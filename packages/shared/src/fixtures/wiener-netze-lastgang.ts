/**
 * Synthetischer Lastgang im Layout eines Wiener-Netze-Exports (anonymisierter Zählpunkt, UTC-Zeiten):
 * die ersten `placeholderRows` Zeilen tragen „-" statt eines Werts, die Einheit steht in einer eigenen
 * Spalte statt im Kopf der Wert-Spalte.
 */

export const WIENER_NETZE_START_MS = Date.UTC(2025, 5, 1, 0, 0)
export const WIENER_NETZE_ROWS = 14 * 96
export const WIENER_NETZE_PLACEHOLDER_ROWS = 770
/** Wert der ersten gemessenen Zeile (Stichprobe für die kWh→kW-Umrechnung). */
export const WIENER_NETZE_FIRST_VALUE_KWH = 1.049

export type WienerNetzeLastgangOptions = {
  placeholderRows?: number
  valueHeader?: string
  unitHeader?: string
  /** Inhalt der Einheiten-Zelle; Vorgabe „KWH" bei Messwert, „-" im Vorlauf. */
  unitCell?: (i: number, measured: boolean) => string
}

const STEP_MS = 15 * 60 * 1000
const pad = (x: number) => String(x).padStart(2, '0')

function at(ms: number): string {
  const d = new Date(ms)
  return (
    `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
  )
}

export function wienerNetzeLastgangCsv(options: WienerNetzeLastgangOptions = {}): string {
  const placeholderRows = options.placeholderRows ?? WIENER_NETZE_PLACEHOLDER_ROWS
  const unitCell = options.unitCell ?? ((_i, measured) => (measured ? 'KWH' : '-'))
  const out = [
    `Startdatum;Enddatum;Zählpunktbezeichnung;Name der Energiegemeinschaft;` +
      `ID der Energiegemeinschaft;OBIS;OBIS Kurzbeschreibung;${options.valueHeader ?? 'Wert'};` +
      `${options.unitHeader ?? 'Einheit'};Qualität;Qualitätbeschreibung`,
  ]
  for (let i = 0; i < WIENER_NETZE_ROWS; i++) {
    const ms = WIENER_NETZE_START_MS + i * STEP_MS
    const measured = i >= placeholderRows
    const kwh = i === placeholderRows ? WIENER_NETZE_FIRST_VALUE_KWH : 0.5 + (i % 7) * 0.125
    const value = measured ? kwh.toFixed(3).replace('.', ',') : '-'
    const quality = measured ? 'L1;Gemessen' : '-;Wert noch nicht Vorhanden'
    out.push(
      `${at(ms)};${at(ms + STEP_MS)};AT0010000000000000001000000000001;-;-;1-1:1.9.0 P.01;` +
        `Verbrauch;${value};${unitCell(i, measured)};${quality}`,
    )
  }
  return out.join('\n')
}
