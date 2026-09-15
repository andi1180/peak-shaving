import type { TranscriptEntry } from '@/lib/project-chat/transcript'

/** Rein, damit die Trigger-Beschriftung des Energieberater-Popups ohne Renderer testbar ist. */
export function energyAdvisorTriggerLabel(initialTranscript: readonly TranscriptEntry[]): string {
  return initialTranscript.length === 0 ? 'KI-Prüfung starten' : 'KI-Prüfung öffnen'
}
