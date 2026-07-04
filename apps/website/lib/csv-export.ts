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
 */
export function buildPerBatteryCsv(perBattery: Entry[], horizonYears: number): string {
  const header = [
    'Modell',
    'Klasse',
    'Investition',
    'Spitzenkappung (Leistungspreis)',
    'Eigenverbrauch',
    'Tarifbewusstes Laden',
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
