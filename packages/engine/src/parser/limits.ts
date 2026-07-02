import type { ParseLimits } from './types'

// Sicherheits-Limits (§3.2). Die eigentliche Enforcement-Grenze zieht das UI (Upload),
// aber die Engine kennt und prüft sie, damit sie auch serverseitig greifen.
export const DEFAULT_LIMITS: ParseLimits = {
  maxBytes: 25 * 1024 * 1024, // 25 MB
  maxRows: 40_000, // 1 Jahr 15-min = 35.040 + Header/Puffer
}

export function resolveLimits(partial?: Partial<ParseLimits>): ParseLimits {
  return {
    maxBytes: partial?.maxBytes ?? DEFAULT_LIMITS.maxBytes,
    maxRows: partial?.maxRows ?? DEFAULT_LIMITS.maxRows,
  }
}

/** Byte-Größe des Roh-Inhalts (String → UTF-8-Länge, sonst byteLength). */
export function byteSize(content: string | ArrayBuffer | Uint8Array): number {
  if (typeof content === 'string') {
    // Isomorph: TextEncoder ist in Browser und Node vorhanden.
    return new TextEncoder().encode(content).length
  }
  if (content instanceof Uint8Array) return content.byteLength
  return content.byteLength
}
