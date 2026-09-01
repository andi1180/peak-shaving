import type { AnalysisResult } from 'shared'

import { formatEur, formatYears } from './format'

type Entry = AnalysisResult['perBattery'][number]

const classLabel: Record<Entry['battery']['class'], string> = {
  residential: 'Heimspeicher',
  commercial: 'Gewerbespeicher',
}

// RFC 4180: Feld in Anführungszeichen, sobald es das Trennzeichen, ein Anführungszeichen oder
// einen Zeilenumbruch enthält (Warnungen sind volle deutsche Sätze — die enthalten fast immer
// Kommas). Eingebettete Anführungszeichen werden verdoppelt, nicht escaped (RFC-Konvention).
function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function csvRow(fields: string[]): string {
  return fields.map(csvField).join(',') + '\r\n'
}

/**
 * Export §6.2 — das VOLLSTÄNDIGE `perBattery`-Array (nicht nur die Empfehlung), damit die
 * Ergebnistabelle offline (Excel/Sheets) mit allen Kandidaten weiterverwendet werden kann.
 * Zahlenwerte in derselben Formatierung wie im Report (`formatEur`/`formatYears`, de-AT) —
 * konsistent mit dem, was der Nutzer bereits auf dem Bildschirm sieht, kein zweites Zahlenformat.
 *
 * ── BEIDE ENERGIE-WERTE, JE EIGENE SPALTE (§3.7-Jahres-Hochrechnung) ────────────────────────────
 * Eigenverbrauch und tarifbewusstes Laden stehen zweimal: einmal auf ein Jahr HOCHGERECHNET (die
 * Zahl, die in `Gesamtersparnis pro Jahr` und damit in Amortisation und Netto-Ersparnis eingeht)
 * und einmal als GEMESSENE Summe über den tatsächlich abgedeckten Zeitraum. Dazwischen stehen die
 * Bezugsgrössen `Abgedeckte Tage` und `Hochrechnungsfaktor`, damit sich der Weg von der einen zur
 * anderen Zahl in der Tabelle nachrechnen lässt — bei voller Jahresabdeckung ist der Faktor 1 und
 * beide Paare sind identisch. Nur die hochgerechnete Zahl auszugeben hiesse, eine ANNAHME als
 * Messung zu exportieren; nur die gemessene, sie mit einem Leistungspreis-Anteil in eine Zeile zu
 * stellen, der bereits eine Jahresgrösse ist.
 */
export function buildPerBatteryCsv(perBattery: Entry[], horizonYears: number): string {
  const header = [
    'Modell',
    'Klasse',
    'Investition',
    'Spitzenkappung (Leistungspreis)',
    'Eigenverbrauch pro Jahr',
    'Tarifbewusstes Laden pro Jahr',
    'Abgedeckte Tage',
    'Hochrechnungsfaktor',
    'Eigenverbrauch gemessen (abgedeckter Zeitraum)',
    'Tarifbewusstes Laden gemessen (abgedeckter Zeitraum)',
    'Gesamtersparnis pro Jahr',
    'Amortisation',
    `Netto-Ersparnis über ${horizonYears} Jahre`,
    'Warnungen',
  ]

  const rows = perBattery.map((entry) =>
    csvRow([
      entry.battery.name,
      classLabel[entry.battery.class],
      formatEur(entry.totalInvestment),
      formatEur(entry.leistungspreisSavingPerYear),
      formatEur(entry.selfConsumptionSavingPerYear),
      formatEur(entry.loadShiftSavingPerYear),
      String(entry.coveredDays),
      // Der Faktor ausgeschrieben statt gerundet: er ist der Rechenweg zwischen den beiden
      // Zahlenpaaren nebenan, und mit zwei Nachkommastellen ginge er in einer Tabellenkalkulation
      // nicht mehr sauber auf. de-AT-Dezimalkomma wie die übrigen Spalten (`formatEur`).
      entry.annualizationFactor.toFixed(4).replace('.', ','),
      formatEur(entry.selfConsumptionSavingOverCoveredPeriod),
      formatEur(entry.loadShiftSavingOverCoveredPeriod),
      formatEur(entry.totalSavingPerYear),
      formatYears(entry.amortizationYears),
      formatEur(entry.netSavingOverHorizon),
      entry.warnings.join(' | '),
    ]),
  )

  // BOM: Excel erkennt die UTF-8-Kodierung sonst nicht zuverlässig (€, Umlaute in Warnungen).
  return '﻿' + csvRow(header) + rows.join('')
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
