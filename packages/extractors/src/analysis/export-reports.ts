import {
  combineImportWithHourlyExport,
  countCoveredMonths,
  IMPORT_ONLY_WITHOUT_PV_WARNING,
  parseHourlyPlantReports,
  utcMsToLocalFields,
  type DataQuality,
  type PlantReportFile,
} from 'engine'
import { draftPvPeakPowerKwp, readStoredExportReports, type LoadProfile } from 'shared'

type ParsedLoad = { profile: LoadProfile; dataQuality: DataQuality }

/** Beginn der Hinweise dieses Wegs — erkennbar wie `IMPORT_ONLY_WITHOUT_PV_WARNING`. */
export const EXPORT_REPORTS_COMBINED_WARNING_PREFIX = 'Einspeisung aus Anlagenberichten ergänzt:'
export const EXPORT_REPORTS_UNUSED_WARNING_PREFIX = 'Anlagenberichte nicht verwendet:'

const SLOTS_PER_DAY = 96

const kwhFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })
const kwhFormatFine = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

function localDate(ms: number, timeZone: string): string {
  const { year, month, day } = utcMsToLocalFields(ms, timeZone)
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`
}

function withWarnings(load: ParsedLoad, warnings: string[]): ParsedLoad {
  return {
    ...load,
    dataQuality: { ...load.dataQuality, warnings: [...load.dataQuality.warnings, ...warnings] },
  }
}

/**
 * Bytec S9-3b: gemessener 15-min-Bezug + stündliche Anlagenberichte (`_exportReports`) → signierte
 * Netzlast, danach gerechnet wie ein signierter Lastgang. Ohne Seiteneintrag kommt `load` unverändert
 * zurück. Nur bei `import_only` — ein Lastgang mit Einspeisung bekäme sie sonst doppelt. Ein
 * unlesbarer Bericht bricht die Analyse nicht ab; gerechnet wird dann ohne Kombination.
 */
export async function combineLoadWithExportReports(
  draft: Record<string, unknown>,
  load: ParsedLoad,
  readDocument: (documentId: string) => Promise<{ bytes: ArrayBuffer; filename: string } | null>,
): Promise<ParsedLoad> {
  const stored = readStoredExportReports(draft)
  if (stored === null) return load

  if (load.profile.source !== 'import_only') {
    return withWarnings(load, [
      `${EXPORT_REPORTS_UNUSED_WARNING_PREFIX} Lastgang enthält bereits Einspeisung.`,
    ])
  }

  const files: PlantReportFile[] = []
  for (const { documentId, filename } of stored.documents) {
    const document = await readDocument(documentId)
    if (document === null) {
      return withWarnings(load, [
        `${EXPORT_REPORTS_UNUSED_WARNING_PREFIX} Datei „${filename}“ nicht (mehr) vorhanden.`,
      ])
    }
    files.push({ name: filename, data: document.bytes })
  }

  const timeZone = load.profile.timezoneMeta
  const reports = parseHourlyPlantReports(files, timeZone)
  if ('error' in reports) {
    return withWarnings(load, [
      `${EXPORT_REPORTS_UNUSED_WARNING_PREFIX} Datei „${reports.file}“ nicht lesbar (${reports.error}).`,
    ])
  }

  const { netSigned15, diagnostics } = combineImportWithHourlyExport({
    import15: load.profile,
    exportHourly: reports.exportHourly,
    importHourly: reports.importHourly,
    exportCapKw: draftPvPeakPowerKwp(draft) ?? undefined,
  })
  if (diagnostics.range === null) {
    return withWarnings(load, [
      `${EXPORT_REPORTS_UNUSED_WARNING_PREFIX} keine zeitliche Überlappung mit dem Lastgang.`,
    ])
  }

  const fromMs = Date.parse(diagnostics.range.from)
  const toMs = Date.parse(diagnostics.range.to)
  // Auch gegen Bezug saldierte Einspeisung zählt — die negativen Viertelstunden allein sind zu wenig.
  const assignedKwh = diagnostics.assignedExportKwh

  const warnings = [
    `${EXPORT_REPORTS_COMBINED_WARNING_PREFIX} ${kwhFormat.format(assignedKwh)} kWh, Zeitraum ` +
      `${localDate(fromMs, timeZone)}–${localDate(toMs - 1, timeZone)} (Überlappung mit dem Lastgang).`,
  ]
  if (diagnostics.droppedExportKwh > 0) {
    warnings.push(
      `${kwhFormatFine.format(diagnostics.droppedExportKwh)} kWh Einspeisung in ` +
        `${diagnostics.droppedExportHours} Stunden ohne Viertelstunde im Lastgang nicht zugeordnet.`,
    )
  }
  if (diagnostics.overCapExportKwh > 0) {
    warnings.push(
      `${kwhFormatFine.format(diagnostics.overCapExportKwh)} kWh Einspeisung in ` +
        `${diagnostics.overCapExportHours} Stunden über der Leistungsgrenze verteilt – bitte prüfen.`,
    )
  }
  if (diagnostics.missingExportHours > 0) {
    warnings.push(
      `${diagnostics.missingExportHours} Stunden ohne Anlagenbericht, Einspeisung dort 0.`,
    )
  }
  const offset = diagnostics.importCheck?.bestOffsetHours ?? 0
  if (offset !== 0) {
    warnings.push(
      'Zeitabgleich Anlagenbericht/Lastgang auffällig (bester Versatz ' +
        `${offset > 0 ? '+' : '−'}1 h) – bitte prüfen.`,
    )
  }

  return {
    profile: { ...load.profile, readings: netSigned15, source: 'net_signed' },
    dataQuality: {
      ...load.dataQuality,
      coveredDays: Math.round(netSigned15.length / SLOTS_PER_DAY),
      coveredMonths: countCoveredMonths(
        netSigned15.map((r) => Date.parse(r.ts)),
        timeZone,
      ),
      // Das Profil ist jetzt signiert — die §3.1-Pflichtwarnung trifft nicht mehr zu.
      warnings: [
        ...load.dataQuality.warnings.filter((w) => w !== IMPORT_ONLY_WITHOUT_PV_WARNING),
        ...warnings,
      ],
    },
  }
}
