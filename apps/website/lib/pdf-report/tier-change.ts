import type { NetworkTierSummary } from 'shared'

/**
 * Wechselt der Speicher die Netzentgelt-Stufe (Benutzungsdauer)? Nur dann heisst der Leistungs-Anteil
 * „Kappung und Stufenwechsel" statt Spitzenkappung. Liest vorhandene Felder, rechnet nichts.
 */
export function tierChangesWithStorage(
  current: { networkTier?: NetworkTierSummary },
  entry: { networkTier?: NetworkTierSummary } | null | undefined,
): boolean {
  const today = current.networkTier
  const withStorage = entry?.networkTier
  return today !== undefined && withStorage !== undefined && today.tier !== withStorage.tier
}

/** Die Beschriftung des Anteils bei Stufenwechsel (Tabellen, Jahreskapitel, Vorschlag). */
export const TIER_CHANGE_SHARE_LABEL = 'Kappung und Stufenwechsel'
