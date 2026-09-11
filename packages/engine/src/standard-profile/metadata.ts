import { analysisWindow } from 'shared'

import { generateStandardLoadProfile, type StandardProfileCustomerClass } from './h0'

/**
 * Die METADATEN eines erzeugten Standardlastprofils — Zeitpunkte und Zahlen ÜBER die Reihe, nie
 * die Reihe selbst (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DIESE ABLEITUNG IN DER ENGINE LIEGT UND NICHT IM ADAPTER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sie besteht fast nur aus einer Zeile — und diese eine Zeile ist genau die Konvention, die in
 * diesem Repo am häufigsten falsch gelesen wird: `coveredTo` ist die OBERE KANTE eines halboffenen
 * Bereichs, `analysisWindow` liefert dagegen beide Grenzen INKLUSIV (Delta 15, Regel A). Wer den
 * Aufschlag vergisst, verliert das letzte Intervall, und nichts daran schlägt fehl.
 *
 * Dieselbe Konvention bildet der LASTGANG-Leser (`parser/metadata.ts`, `coveredTo: last + stepMs`).
 * Die beiden münden auf dieselben vier Spalten in `platform.metering_points` und müssen deshalb
 * dasselbe bedeuten — sie gehören nebeneinander, in dasselbe Paket, unter denselben Testlauf.
 *
 * Dazu der praktische Grund: `packages/extractors` hat KEINEN Testlauf (wie `apps/website`), die
 * Engine hat einen. Eine Ableitung, deren einzige Falle sich nur am Ergebnis messen lässt, in ein
 * Paket ohne Testlauf zu legen hiesse, sie ungeprüft zu lassen.
 *
 * `packages/extractors/src/standard-profile/generate.ts` ist deshalb ein reiner Re-Export —
 * dasselbe Verhältnis wie zwischen `readLoadProfileMetadata` (hier) und dem Lastgang-Adapter dort.
 */

/**
 * Was der Wizard von einem erzeugten Profil braucht — und sonst nichts.
 *
 * Die Feldnamen und ihre Bedeutung sind ABSICHTLICH die des Lastgang-Lesers (`LoadProfileScan`):
 * beide münden auf dieselben vier Spalten in `platform.metering_points`, und ein abweichender
 * Zuschnitt hier zwänge den Aufrufer zu einer Übersetzung, bei der man `coveredTo` falsch
 * verstehen kann.
 */
export type StandardProfileMetadata = {
  /** 15 — der Generator arbeitet im Viertelstunden-Gitter. Trotzdem gelesen statt gesetzt, s. u. */
  intervalMinutes: number
  /** Beginn des ersten Intervalls, ISO/UTC. */
  coveredFrom: string
  /**
   * ENDE des letzten Intervalls, ISO/UTC — also letzter Zeitstempel + `intervalMinutes`.
   *
   * ⚠ OBERE KANTE EINES HALBOFFENEN BEREICHS, nicht der letzte Zeitstempel. `analysisWindow`
   * liefert beide Grenzen INKLUSIV (Delta 15, Regel A); die Dauer des letzten Intervalls wird
   * deshalb aufgeschlagen. Ohne den Aufschlag endete ein Jahresprofil am 31.12. um 23:45 statt am
   * 1. Jänner um 00:00 — eine Viertelstunde, die in `[coveredFrom, coveredTo)` fehlte, und der
   * Wrapper `set_metering_point_standard_profile` nähme sie widerspruchsfrei an.
   */
  coveredTo: string
  /**
   * Der Jahresverbrauch, auf den das Profil skaliert wurde — unverändert die Eingabe.
   *
   * Er reist mit, damit der Aufrufer ihn nicht ein zweites Mal aus seinem Formular nehmen muss:
   * was gespeichert wird, soll das sein, womit erzeugt wurde.
   */
  annualConsumptionKwh: number
}

/**
 * Ausgang des Erzeugens. Die Gründe sind unverändert die der Engine — hier wird keiner
 * zusammengefasst und keiner erfunden.
 */
export type StandardProfileMetadataOutcome =
  | { ok: true; metadata: StandardProfileMetadata }
  | { ok: false; reason: 'no_profile_for_class' | 'invalid_consumption' | 'invalid_year' }
  /**
   * Das erzeugte Profil trug keinen einzigen Messwert. Über die Engine nicht erreichbar (sie
   * baut das Gitter über ein volles Kalenderjahr), aber `analysisWindow` kann `null` liefern, und
   * ein `null` ungeprüft in einen Zeitstempel zu zwingen wäre die Art Annahme, die später niemand
   * mehr prüft. Tiefenstaffelung, kein erwarteter Zustand.
   */
  | { ok: false; reason: 'empty_profile' }

/**
 * Erzeugt das Standardlastprofil und gibt AUSSCHLIESSLICH seine Metadaten zurück.
 *
 * @param annualConsumptionKwh Jahresverbrauch in kWh — die einzige kundenseitige Zahl.
 * @param customerClass        Aus dem Segment des Projekts abgeleitet, nicht neu erfragt.
 * @param year                 Kalenderjahr, das das Profil abdeckt (`standardProfileYear`).
 * @param timeZone             Zeitzone der Tagesform (Wanduhr). Pflichtparameter, wie in der Engine.
 */
export function standardProfileMetadata(input: {
  annualConsumptionKwh: number
  customerClass: StandardProfileCustomerClass
  year: number
  timeZone: string
}): StandardProfileMetadataOutcome {
  const outcome = generateStandardLoadProfile(input)
  if (!outcome.ok) return { ok: false, reason: outcome.reason }

  const window = analysisWindow(outcome.profile)
  if (window === null) return { ok: false, reason: 'empty_profile' }

  /*
   * Das Intervall wird aus dem ERZEUGTEN Profil gelesen, nicht als 15 hingeschrieben. Heute ist es
   * dasselbe; die Zahl gehört aber dem Generator, und eine hier festgeschriebene 15 wäre eine
   * zweite Aussage darüber, die beim nächsten Umbau still falsch würde.
   */
  const intervalMinutes = outcome.profile.intervalMinutes
  const coveredTo = new Date(
    new Date(window.endIso).getTime() + intervalMinutes * 60_000,
  ).toISOString()

  return {
    ok: true,
    metadata: {
      intervalMinutes,
      coveredFrom: window.startIso,
      coveredTo,
      annualConsumptionKwh: input.annualConsumptionKwh,
    },
  }
}
