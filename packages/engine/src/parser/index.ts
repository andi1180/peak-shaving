// Parser + Lastgang-Aufbereitung (§3.2/§3.3). Rein & isomorph, kein I/O.
export { parseLoadProfile, parsePvProfile } from './parse'
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
// D6 Teil 2b: die Zeitzonen-Umrechnung in BEIDE Richtungen. Der synthetische Lückenausschnitt der
// Jahres-Hochrechnung entsteht an echten Kalendertagen und muss dafür lokale Mitternacht in einen
// UTC-Instant übersetzen — bisher paketintern, `packages/extractors` kam sonst nicht daran.
export { toIsoUtc, utcMsToLocalFields, zonedWallToUtcMs } from './datetime'
export type { LocalFields } from './datetime'
