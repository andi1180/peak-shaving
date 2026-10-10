/**
 * Die eine Meldung für eine Datei im falschen Messraster (Fehlercode `wrong_interval`).
 *
 * Gerechnet wird ausschliesslich im Viertelstunden-Raster (`LoadProfile.intervalMinutes` ist
 * `15`); Upload, Chat, PV-Upload, Analyselauf und öffentlicher Rechner nennen den Grund deshalb
 * mit demselben Satz.
 */

export type IntervalFileKind = 'load_profile' | 'pv_profile'

const REQUIRED: Record<IntervalFileKind, string> = {
  load_profile:
    'Wir benötigen den Viertelstunden-Lastgang (15 Minuten); bitte beim Netzbetreiber anfordern.',
  pv_profile:
    'Wir benötigen die PV-Erzeugung in Viertelstundenwerten (15 Minuten); bitte als ' +
    '15-Minuten-Export aus dem Wechselrichter-Portal herunterladen.',
}

export function wrongIntervalMessage(
  detectedMinutes: number | null,
  kind: IntervalFileKind = 'load_profile',
): string {
  const found =
    detectedMinutes !== null && Number.isFinite(detectedMinutes) && detectedMinutes > 0
      ? `Die Datei enthält Werte im ${detectedMinutes}-Minuten-Raster.`
      : 'Die Datei enthält keine Werte im Viertelstunden-Raster.'
  return `${found} ${REQUIRED[kind]}`
}

// Der Parser (`parse.ts`) nennt das erkannte Intervall nur im Text: „(erkannt: 60 min)".
const DETECTED = /erkannt:\s*(\d+)\s*min/

/** Die Meldung eines Parser-Fehlers, wie sie der Anwender sieht — `wrong_interval` zentral. */
export function parseErrorMessage(
  error: { code: string; message: string },
  kind: IntervalFileKind = 'load_profile',
): string {
  if (error.code !== 'wrong_interval') return error.message
  const match = DETECTED.exec(error.message)
  return wrongIntervalMessage(match ? Number(match[1]) : null, kind)
}
