// Parser + Lastgang-Aufbereitung (§3.2/§3.3). Rein & isomorph, kein I/O.
export { IMPORT_ONLY_WITHOUT_PV_WARNING, parseLoadProfile, parsePvProfile } from './parse'
export { ZERO_DAY_FILLED_WARNING_PREFIX } from './zero-days'
export type { ZeroDayFill, ZeroDayFillSource } from './zero-days'
// B24, Teil 1: der Metadaten-Leser (Zeitraum, Intervall, Lücken) — bewusst NEBEN `parseLoadProfile`
// und nicht darin, s. den Kopf von `metadata.ts`.
export {
  readLoadProfileMetadata,
  GAP_TOLERANCE_INTERVALS,
  SUPPORTED_INTERVAL_MINUTES,
} from './metadata'
export type { LoadProfileGap, LoadProfileMetadata, LoadProfileScan } from './metadata'
// B24, Teil 1: das PV-Gegenstück — dieselbe Aufteilung, dieselben Gründe (s. Kopf von `metadata.ts`).
export { readPvProfileMetadata } from './metadata'
export type { PvProfileGap, PvProfileMetadata, PvProfileScan } from './metadata'
export { adapters, matchAdapter } from './adapters'
export type { FormatAdapter, AdapterContext, AdapterHints } from './adapters'
export type {
  RawFileInput,
  FileFormat,
  Unit,
  ParseOptions,
  ParseLimits,
  ColumnMapping,
  ColumnRole,
  ValueColumnInfo,
  SignConvention,
  TimestampMarks,
  Detection,
  DataQuality,
  TablePreview,
  MappingIssue,
  MappingIssueField,
  ParseError,
  ParseErrorCode,
  ParseOutcome,
  PvParseOutcome,
} from './types'
export { DEFAULT_LIMITS } from './limits'
// Bytec S9-1: 15-min-Bezug + stündliche Einspeisung → signierte Netzlast (noch ohne Aufrufer).
export { combineImportWithHourlyExport } from './combine-hourly-export'
export type {
  CombineDiagnostics,
  CombineImportWithHourlyExportInput,
  CombineImportWithHourlyExportResult,
  HourlyEnergyReading,
  HourOffset,
  ImportCheck,
} from './combine-hourly-export'
// Bytec S9-2: stündliche Anlagenberichte (Einspeisung/Bezug) für die Kombination (noch ohne Aufrufer).
export { parseHourlyPlantReports } from './hourly-plant-report'
export type {
  HourlyPlantReportDiagnostics,
  HourlyPlantReportResult,
  PlantReportFile,
  PlantReportFileSummary,
} from './hourly-plant-report'
// D6 Teil 2b: die Zeitzonen-Umrechnung in BEIDE Richtungen. Der synthetische Lückenausschnitt der
// Jahres-Hochrechnung entsteht an echten Kalendertagen und muss dafür lokale Mitternacht in einen
// UTC-Instant übersetzen — bisher paketintern, `packages/extractors` kam sonst nicht daran.
export { countCoveredMonths, toIsoUtc, utcMsToLocalFields, zonedWallToUtcMs } from './datetime'
export type { LocalFields } from './datetime'
