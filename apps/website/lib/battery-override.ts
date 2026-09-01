import type { BatteryCandidate } from 'shared'
import type { BatteryOverride } from './analysis-protocol'

/**
 * `catalog` mit genau EINEM modifizierten Eintrag (Architektur-Vorgabe §6.2: eine modifizierte
 * Kopie, nicht ein zweiter Katalog) — die übrigen Kandidaten bleiben unangetastet, damit die
 * Neu-Einordnung (Ranking) ehrlich gegen die unveränderten Alternativen läuft.
 *
 * ── WARUM DAS SEIT B14-2 HIER STEHT UND NICHT MEHR IM WORKER ────────────────────────────────────
 * Das Analyse-Bündel führt den Batteriekatalog-STAND als WERTE mit — genau das Array, mit dem
 * gerechnet wurde, inklusive einer Änderung aus dem Annahmen-Panel. Der Export läuft im
 * UI-Thread, die Rechnung im Worker; eine zweite Umsetzung derselben Regel liefe irgendwann
 * auseinander, und dann trüge das Archiv einen Katalog, gegen den nie gerechnet wurde. Eine
 * Definition, zwei Aufrufer.
 */
export function applyBatteryOverride(
  catalog: BatteryCandidate[],
  override: BatteryOverride | undefined,
): BatteryCandidate[] {
  if (!override) return catalog
  return catalog.map((b) =>
    b.id === override.batteryId
      ? {
          ...b,
          ...(override.roundTripEfficiency != null
            ? { roundTripEfficiency: override.roundTripEfficiency }
            : {}),
          ...(override.pricePerKwh != null ? { pricePerKwh: override.pricePerKwh } : {}),
        }
      : b,
  )
}

/**
 * Welcher Override für einen LAUF gilt: der ausdrücklich gesetzte — sonst das bestätigte Preset.
 *
 * ── ⚠ WARUM ES DIESE FUNKTION GIBT (gemessener Defekt, 01.09.2026) ─────────────────────────────
 * Delta 17 Teil 2 wendet das Preset beim ERSTLAUF an. Eine Live-Neuberechnung (§6.2) baute den
 * Katalog dagegen aus `msg.batteryOverride` — und der ist `undefined`, sobald der Nutzer die
 * Batteriefelder NICHT anfasst: das Annahmen-Panel emittiert ihn nur bei Abweichung von seiner
 * Grundlinie, und die Grundlinie IST bereits das preset-angewandte Gerät. Ein Nutzer, der nach
 * bestätigten „90 %" nur den Betrachtungshorizont ändert, bekam damit still wieder die 91 % aus
 * dem Katalog — die Angabe, die er gemacht hat, verschwand ohne jede Meldung. Dasselbe galt für
 * den Jahreshöchstwert-Shortcut, der gar keinen Override mitgibt.
 *
 * ── ⚠ SIE HAT ZWEI AUFRUFER, UND DAS IST DER EIGENTLICHE PUNKT ────────────────────────────────
 * Der Worker RECHNET mit dem Ergebnis, der Hook PROTOKOLLIERT es (`AnalysisRunInputs`), und aus
 * dem Protokoll schreibt der Bündel-Export den Katalog-Stand ins Archiv (`bundle-export.ts`). Nur
 * im Worker aufgelöst behauptete das Bündel einen Katalog, gegen den nie gerechnet wurde — genau
 * der Fehler, vor dem der Kopf von `applyBatteryOverride` warnt, nur eine Ebene höher. Deshalb
 * EINE Regel, von beiden gelesen.
 *
 * ── WAS SIE BEWUSST NICHT TUT: ZUSAMMENFÜHREN ─────────────────────────────────────────────────
 * Es bleibt bei GENAU EINEM aktiven Override (Architektur-Vorgabe §6.2/U2 Prompt C). Bearbeitet
 * der Nutzer einen ANDEREN Kandidaten als den voreingestellten, gewinnt seine ausdrückliche
 * Eingabe und das Preset tritt zurück — es wird nicht heimlich danebengelegt. Ob das die richtige
 * fachliche Antwort ist, ist eine offene Produktfrage (s. CLAUDE.md); technisch ist es die einzige,
 * die den bestehenden Ein-Override-Mechanismus nicht aufbricht.
 *
 * Idempotent: ein bereits aufgelöster Wert bleibt unverändert.
 */
export function resolveBatteryOverride(
  explicit: BatteryOverride | undefined,
  preset: BatteryOverride | undefined,
): BatteryOverride | undefined {
  return explicit ?? preset
}
