/**
 * B23c-1 — welchen Fall ein Prüflauf der Executive Summary fährt.
 *
 * ── ⚠ EIGENE DATEI OHNE EINEN EINZIGEN IMPORT, UND DAS IST DER GANZE ZWECK ────────────────────
 * Die Oberfläche braucht die Beschriftungen beim ERSTEN Rendern, die Eingaben dazu erst nach einem
 * Klick. Stünden beide in `summary-fixtures.ts`, zöge der statische Import dieser drei Zeilen den
 * Jahres-Lastgang (35.040 Werte), die Spotpreis-Reihe und den `shared`-Barrel in den First Load
 * der Prüfroute — für zwei Zeichenketten je Fall.
 */

export type SummaryProbeKind = 'bestand' | 'blocker' | 'katalog'

export const SUMMARY_PROBE_KINDS: readonly SummaryProbeKind[] = ['bestand', 'blocker', 'katalog']

export const SUMMARY_PROBE_LABEL: Record<SummaryProbeKind, string> = {
  bestand: 'Bestandsanlage, Ladesteuerung berechenbar',
  blocker: 'Bestandsanlage, Ladesteuerung NICHT berechenbar',
  katalog: 'Ohne Bestandsanlage (Katalog-Fall)',
}
