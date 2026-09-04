import type { AnalysisResult, LoadProfile, TariffParams } from 'shared'

import { localYear } from '@/lib/local-time'

/**
 * B23a — Titel, Untertitel und Zeitraum des Reports, aus dem Contract abgeleitet.
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN ─────────────────────────────────────
 * Sie ist der EINZIGE Teil dieses Verzeichnisses, der aus einem Bündel heraus statisch importiert
 * werden darf: alles Übrige zieht die PDF-Bibliothek und damit deren Lazy-Chunk (Spike §3:
 * ≈ 307 kB gzip). Wer diese Datei anfasst, hält sie frei von jedem Import aus diesem Verzeichnis,
 * der react-pdf berührt — sonst wandert der Chunk in den First Load der Route, die sie liest.
 *
 * ── DIE PARAMETER SIND STRUKTURELLE TEILMENGEN, NICHT DER GANZE CONTRACT ───────────────────────
 * `Pick<…>` statt `AnalysisResult`/`LoadProfile`: die Funktionen lesen je ein bis zwei Felder, und
 * die engere Signatur sagt genau das. Praktisch messbar wird der Unterschied dort, wo eine Prüfung
 * oder ein Prüfstand die Ableitung fahren will, ohne einen vollständigen Rechenlauf zu haben — mit
 * dem ganzen Contract als Parameter müsste dafür ein Ergebnis erfunden werden, das gar nicht
 * gebraucht wird.
 */

/** Ohne den Börsenpreis-Hebel. */
const TITLE_BASE = 'Wirtschaftlichkeitsanalyse Batteriespeicher'
const TITLE_TARIFF_SUFFIX = ' & Ladeoptimierung'

/**
 * Der VORGESCHLAGENE Dokumenttitel. Der Nutzer kann ihn im Gate überschreiben — was hier entsteht,
 * ist eine Vorbelegung und keine Festlegung.
 *
 * ── DIE BEDINGUNG IST DIESELBE WIE IM REPORT, UND ZWAR DIESELBE ZEILE ──────────────────────────
 * `result.tariffOptimization?.computable === true` — wortgleich zu `report.tsx`, wo daran hängt, ob
 * die Ladeoptimierungs-Karte überhaupt eine Zahl zeigt (B21-3c). Der Titel darf den zweiten Hebel
 * nur dann nennen, wenn er im Dokument auch vorkommt: „& Ladeoptimierung" auf dem Deckblatt eines
 * Reports, der die Optimierung als nicht berechenbar ausweist, wäre eine Ankündigung, die das
 * Dokument selbst zurücknimmt.
 *
 * Eine hier nachgebaute, „ähnliche" Prüfung (etwa an `monthlyComparison`) wäre eine zweite
 * Bedingung für dieselbe Frage — sie liefe beim nächsten Umbau auseinander.
 */
export function defaultReportTitle(result: Pick<AnalysisResult, 'tariffOptimization'>): string {
  const withTariffLever = result.tariffOptimization?.computable === true
  return withTariffLever ? `${TITLE_BASE}${TITLE_TARIFF_SUFFIX}` : TITLE_BASE
}

/**
 * Der Untertitel. AUSDRÜCKLICH NICHT EDITIERBAR und deshalb auch kein Feld im Gate: er ist eine
 * Aussage über die Datengrundlage, keine Beschriftung. Wäre er frei, könnte auf einem Report, der
 * auf einem geschätzten Standardprofil beruht, „auf Basis Ihres Viertelstunden-Lastgangs" stehen —
 * und genau diese Verwechslung ist die, die dem Leser am teuersten kommt.
 *
 * Abgeleitet aus `loadProfile.source` und damit aus derselben Eigenschaft, an der die Engine die
 * Spitzenkappung abschaltet (`peakShavingBlockers`, Delta 9b-1) und der Bildschirm-Report seinen
 * Standardprofil-Hinweis zeigt. Kein zweiter Zustand.
 */
export function reportSubtitle(loadProfile: Pick<LoadProfile, 'source'>): string {
  const basis =
    loadProfile.source === 'standard_profile'
      ? 'eines geschätzten Jahresprofils'
      : 'Ihres Viertelstunden-Lastgangs'
  return `Auf Basis ${basis}`
}

/**
 * Erster und letzter Zeitstempel des Lastgangs, in ORTSZEIT — der ausgewertete Zeitraum.
 *
 * ⚠ BEWUSSTE DOPPELUNG ZU `print-cover.tsx`. Dort steht dieselbe zehnzeilige Intl-Formatierung.
 * Sie zu teilen hiesse, den CSS-Weg anzufassen — und der bleibt bis zum Cutover unverändert, weil
 * er der EINZIGE produktiv erreichbare Export ist. Eine Änderung dort für einen Weg, den heute
 * niemand erreicht, wäre ein Risiko ohne Gegenwert. Beim Cutover fällt `print-cover.tsx` weg und
 * mit ihm die Doppelung; bis dahin ist sie hier benannt.
 */
export function formatAnalysisPeriod(
  loadProfile: Pick<LoadProfile, 'readings' | 'timezoneMeta'>,
): string | null {
  const first = loadProfile.readings[0]
  const last = loadProfile.readings[loadProfile.readings.length - 1]
  if (!first || !last) return null
  const fmt = new Intl.DateTimeFormat('de-AT', {
    timeZone: loadProfile.timezoneMeta,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return `${fmt.format(Date.parse(first.ts))} – ${fmt.format(Date.parse(last.ts))}`
}

/** Das Erstellungsdatum. Nimmt `now` entgegen — s. `types.ts`, `printedAt`. */
export function formatPrintedAt(now: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now)
}

/**
 * B23c-4 — auf welchem Preisstand Arbeitspreis und Grundgebühr beruhen. `null` = kein Hinweis.
 *
 * ── ⚠ WARUM DIESER EINE SATZ DES SCHLUSSKAPITELS HIER STEHT UND NICHT IN `basis.ts` ───────────
 * Er ist der einzige Teil des Reports, dessen Aussage von der UHR abhängt — und diese Datei ist
 * die eine, die Grössen ableitet, für die das gilt (`formatPrintedAt`). `basis.ts` bekäme sonst
 * einen Zeitpunkt hereingereicht, den `PdfReportInput` ein zweites Mal führen müsste (neben dem
 * bereits formatierten `printedAt`) — zwei Felder für denselben Augenblick, die auseinanderlaufen
 * können. Das Ergebnis reist stattdessen als fertige Zeichenkette mit, genau wie `period` und
 * `subtitle`.
 *
 * ⚠ `now` ist ein PARAMETER und wird nicht von der Uhr gelesen: nur so lässt sich die Aussage
 * gegen einen festen Stichtag prüfen (dieselbe Regel wie bei `formatPrintedAt`).
 *
 * ── DIE BEDINGUNG HÄNGT AM ZEITRAUM, NICHT AN EINEM RECHNUNGSDATUM ────────────────────────────
 * Wortgleich übernommen aus `components/report/tariff-vintage-note.tsx` (samt Begründung dort):
 * `InvoiceExtraction` trägt kein Datum, welche Rechnung der Kunde vor sich hatte, weiss der
 * Rechner nicht. Was er weiss, ist der ausgewertete Zeitraum — reicht er in ein noch LAUFENDES
 * Kalenderjahr, kann es dafür noch gar keine Jahresrechnung geben, und die eingetragenen Preise
 * stammen zwangsläufig aus einer älteren Abrechnung.
 *
 * ⚠ Die Grundgebühr wird nur genannt, wo es sie gibt (Delta 19: optional, ohne Angabe 0). Sie
 * mitzunennen, wo keine eingetragen wurde, behauptete eine Grundlage, die in der Rechnung gar
 * nicht vorkommt.
 */
export function tariffVintageNote(
  loadProfile: Pick<LoadProfile, 'readings' | 'timezoneMeta'>,
  tariff: Pick<TariffParams, 'supplierBaseFeeEurPerMonth'>,
  now: Date,
): string | null {
  const last = loadProfile.readings[loadProfile.readings.length - 1]
  if (!last) return null

  const periodEndYear = localYear(Date.parse(last.ts), loadProfile.timezoneMeta)
  const currentYear = localYear(now.getTime(), loadProfile.timezoneMeta)
  if (periodEndYear < currentYear) return null

  const hasBaseFee =
    tariff.supplierBaseFeeEurPerMonth != null && tariff.supplierBaseFeeEurPerMonth > 0
  const posten = hasBaseFee ? 'Arbeitspreis und Grundgebühr basieren' : 'Der Arbeitspreis basiert'

  return (
    `${posten} auf einer ${periodEndYear - 1}er-Vorjahresrechnung — für ${periodEndYear} gibt es ` +
    `noch keine Jahresabrechnung. Für eine aktuelle Zahl wird die ${periodEndYear}er-` +
    'Jahresrechnung des Kunden benötigt.'
  )
}
