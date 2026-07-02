// Parser + Lastgang-Aufbereitung (§3.2/§3.3). Rein & isomorph, kein I/O.
export { parseLoadProfile, parsePvProfile } from './parse'
export { adapters, matchAdapter } from './adapters'
export type { FormatAdapter, AdapterContext, AdapterHints } from './adapters'
export type {
  RawFileInput,
  FileFormat,
  Unit,
  ParseOptions,
  ParseLimits,
  ColumnMapping,
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
