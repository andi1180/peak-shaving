import type { LoadProfile, PvProfile } from 'shared'

/**
 * Die Kopplung (B22a) — der eigentliche Zweck des ganzen Bauabschnitts:
 * **Netz(t) = Verbrauch(t) − Erzeugung(t)**, signiert, negative Werte sind Einspeisung.
 *
 * ── ⚠ WARUM EIN LASTGANG UND NICHT EIN `PvProfile` ENTSTEHT ────────────────────────────────────
 * Gemessen (Bestandsaufnahme 1.2): ein `PvProfile` ändert heute KEINE einzige Ersparnis-Zahl. Es
 * wird an keine Physik-Primitive weitergereicht, und die Herkunftsmarkierung der FIFO-Schichten in
 * `computeBatterySavings` hängt am VORZEICHEN DER NETZLAST, nicht am Profil — über drei
 * Lastgang-Typen ist das gesamte `BatterySavings`-Objekt mit und ohne `PvProfile` bit-gleich. Ein
 * Generator, der ein `PvProfile` erzeugt, wäre also wirkungslos.
 *
 * Wirksam ist ausschliesslich die Einspeisung IM Lastgang: dasselbe H0-Standardprofil geht von
 * € 0,00 auf € 384,69/Jahr Eigenverbrauchs-Ersparnis, sobald die PV im Lastgang steht.
 *
 * ── ⚠ `source` BLEIBT UNVERÄNDERT — und das ist keine Nachlässigkeit ───────────────────────────
 * Naheliegend wäre, das Ergebnis als `net_signed` zu etikettieren: es TRÄGT ja Einspeisung. Genau
 * das wäre der Fehler. `source` beschreibt, wie der VERBRAUCH zustande kam, und daran ändert eine
 * geschätzte Erzeugung nichts (Pflichtenheft §2.2). Zwei Folgen, beide unerwünscht:
 *
 *   1. Aus „synthetischer Verbrauch + geschätzte PV" (der wichtigste Anwendungsfall und die
 *      SCHWÄCHSTE Grundlage im ganzen Rechner) würde ein Lastgang, der wie eine Messung aussieht.
 *   2. Der `standard_profile`-Blocker fiele weg — die Spitzenkappung wäre auf einem Profil wieder
 *      eingeschaltet, dessen Spitzen aus einer Durchschnittskurve stammen. Die Sperre hinge dann
 *      allein an `estimated_pv`, und die zweite, unabhängige Begründung wäre still verschwunden.
 *
 * Die Herkunft der Schätzung steht deshalb in einem EIGENEN, orthogonalen Feld: `pvSource`.
 */

/**
 * Verbrauch − Erzeugung → signierter Netz-Lastgang mit `pvSource: 'estimated'`.
 *
 * Rein & deterministisch. Die Zeitstempel werden VERBATIM übernommen (dieselben Zeichenketten, nicht
 * neu formatierte) — sie sind der Schlüssel, über den `alignPvGrossToLoad` ein PV-Profil zuordnet,
 * und der Vergleich dort ist ein exakter ISO-String-Vergleich (Bestandsaufnahme 1.1). Eine neu
 * gebildete, auch nur anders geschriebene Zeichenkette liesse die Zuordnung still ins Leere laufen.
 *
 * @throws wenn die Erzeugungsreihe nicht dieselbe Länge hat wie der Lastgang. Das ist ein
 *   Programmfehler des Aufrufers, kein Datenzustand: die Reihe entsteht aus GENAU diesen
 *   Zeitstempeln (`expandReferenceToTimestamps`). Still auf die kürzere Länge zu kürzen hiesse,
 *   einen Teil des Jahres ohne PV zu rechnen — und das sähe im Ergebnis wie ein trüber Herbst aus.
 */
export function applyEstimatedPv(
  consumption: LoadProfile,
  pvGenerationKw: readonly number[],
): LoadProfile {
  if (pvGenerationKw.length !== consumption.readings.length) {
    throw new Error(
      `applyEstimatedPv: Erzeugungsreihe (${pvGenerationKw.length}) und Lastgang ` +
        `(${consumption.readings.length}) haben verschiedene Längen.`,
    )
  }

  return {
    ...consumption,
    readings: consumption.readings.map((r, i) => ({
      ts: r.ts,
      gridPowerKw: r.gridPowerKw - (pvGenerationKw[i] ?? 0),
    })),
    pvSource: 'estimated',
  }
}

/**
 * Das zugehörige Brutto-PV-Profil — BEIWERK DER ANZEIGE, nicht die Rechengrundlage.
 *
 * Es ändert keine Ersparnis-Zahl (s. Kopf-Kommentar); es sorgt allein dafür, dass
 * `dispatchTrace.pvGenerationKw` die echte Brutto-Erzeugung zeigt statt der Einspeise-Näherung —
 * also dass das Energiefluss-Chart (§6.2) den vor Ort direkt verbrauchten Anteil überhaupt
 * darstellen kann.
 *
 * Die Zeitstempel sind DIESELBEN Zeichenketten wie im Lastgang. Damit ist die Zuordnung in
 * `alignPvGrossToLoad` per Konstruktion vollständig (`matchedSlots === readings.length`), und die
 * Konsistenzprüfung kann nicht anschlagen: `Einspeisung = max(0, −(Verbrauch − PV)) ≤ PV`, sobald
 * der Verbrauch nicht negativ ist. Dieselbe Zusage-per-Konstruktion wie in
 * `dev-fixtures/generate-demo-pv-profile.mjs`.
 */
export function buildEstimatedPvProfile(
  consumption: LoadProfile,
  pvGenerationKw: readonly number[],
): PvProfile {
  if (pvGenerationKw.length !== consumption.readings.length) {
    throw new Error(
      `buildEstimatedPvProfile: Erzeugungsreihe (${pvGenerationKw.length}) und Lastgang ` +
        `(${consumption.readings.length}) haben verschiedene Längen.`,
    )
  }
  return {
    readings: consumption.readings.map((r, i) => ({
      ts: r.ts,
      pvGenerationKw: pvGenerationKw[i] ?? 0,
    })),
  }
}

/**
 * Darf der Generator für diesen Lastgang überhaupt angeboten werden (Pflichtenheft §2.4)?
 *
 * ── Warum nicht überall ────────────────────────────────────────────────────────────────────────
 * Trägt der Lastgang bereits Einspeisung, STEHT die Eigenverbrauchs-Ersparnis dort — sie ist
 * gemessen. Eine geschätzte Erzeugungskurve daneben erzeugte zwei Antworten auf dieselbe Frage, und
 * die Anwendung müsste entscheiden, welche gilt; das wäre ein Rückschritt gegenüber der Messung und
 * damit ein Verstoss gegen Prinzip 1.
 *
 * ── ⚠ ZWEI PRÜFUNGEN, NICHT EINE — und der Grund ist ein bekannter Parser-Defekt ───────────────
 * `source` allein genügt nicht: die Vorzeichen-Erkennung des Parsers liest nur die ersten 60
 * Zeilen (`parser/detect.ts`, dort als `[ANNAHME]` vermerkt). Ein signierter Lastgang, dessen erste
 * Einspeisung spät im Jahr liegt, wird deshalb als `import_only` etikettiert — für die ZAHLEN
 * folgenlos (`normalizeLoad` klemmt bei `import_only` nichts weg), für DIESE Regel nicht: er bekäme
 * den Generator angeboten, obwohl er Einspeisung trägt. Deshalb wird zusätzlich gemessen, ob
 * überhaupt ein negativer Wert vorkommt — über den GANZEN Lastgang, nicht über eine Stichprobe.
 *
 * Ein bereits mit geschätzter PV gekoppelter Lastgang fällt aus demselben Test heraus (er trägt
 * negative Werte) — ein zweites Aufaddieren ist damit strukturell ausgeschlossen.
 */
export type PvGeneratorEligibility =
  | { offered: true }
  /** Einspeisung liegt gemessen vor. Wird ANGEZEIGT und begründet, nicht verborgen (Delta 9). */
  | { offered: false; reason: 'measured_feed_in' }

export function pvGeneratorEligibility(load: LoadProfile): PvGeneratorEligibility {
  if (load.source === 'net_signed' || load.source === 'import_export_split') {
    return { offered: false, reason: 'measured_feed_in' }
  }
  if (load.readings.some((r) => r.gridPowerKw < 0)) {
    return { offered: false, reason: 'measured_feed_in' }
  }
  return { offered: true }
}
