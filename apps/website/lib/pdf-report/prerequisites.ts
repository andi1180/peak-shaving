import { displayedPriceLabel } from 'shared'
import type { PvSource, PvStage } from 'shared'

import { formatEur, formatKw, formatKwh1, formatKwp, formatPercent } from '@/lib/format'
import type { ReportNotice, ReportRow, ReportStatement } from './statement'
import { summaryWaysOf } from './summary'
import type { PdfReportAnalysis, PdfReportInput, PdfReportTariffSource } from './types'

/**
 * Das Kapitel „Voraussetzungen" — zwischen Zusammenfassung und Empfehlung: welche Anlage der
 * Kunde hat, welcher Rahmen für seinen Anschluss gilt, und worauf die heutigen Kosten beruhen.
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — dieselbe Regel wie überall sonst in
 * diesem Verzeichnis (s. `summary.ts`). Gerendert wird in `document.tsx`.
 *
 * ── ⚠ ZWEI TABELLEN, NICHT DREI BZW. VIER EINZELKÄSTEN ────────────────────────────────────────
 * Vorbild ist S. 3 des Urbanz-Referenz-PDFs (nur Struktur/Optik, keine Zahlen übernommen): je eine
 * Zeile pro Anlagenteil in EINER Aussage (`StatementRow`, wortgleich zur Tarifkomponenten-Tabelle
 * in `basis.ts`), nicht ein eigener Kasten je Anlagenteil — dieselben Bausteine, die es im Baukasten
 * schon gibt.
 *
 * ── ⚠ KEINE ZAHL WIRD HIER NEU GERECHNET ───────────────────────────────────────────────────────
 * Kosten, Zeitraum und die Werte der Zeilen kommen ausschliesslich aus bereits vorhandenen
 * Contract-Feldern bzw. aus `summaryWaysOf` — derselben Funktion, aus der auch die Kopfzahl der
 * Zusammenfassung entsteht. Ein zweiter Rechenweg für dieselbe Zahl liefe irgendwann von ihr weg.
 */

function neutralRow(label: string, value: string): ReportRow {
  return { label, value, tone: 'neutral' }
}

/** Bewusste Doppelung zu `summary.ts` — dieselbe Bedingung, eigenständig gehalten (s. dort). */
function hasLeistungspreis(current: PdfReportAnalysis['current']): boolean {
  return current.leistungspreisCostPerYear > 0
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Block 1 — „Voraussetzungen für diese Auswertung": eine Zeile je Anlagenteil
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Nur mit Bestandsanlage — dieselbe Bedingung wie `equipmentSentence` in `summary.ts`. */
function batteryRow(analysis: PdfReportAnalysis): ReportRow | null {
  const battery = analysis.existingBatteryAnalysis?.entry.battery
  if (!battery) return null

  return neutralRow(
    'Ihre Batterie',
    `${formatKwh1(battery.usableCapacityKwh)} · ${formatKw(battery.maxPowerKw)} · ` +
      `${formatPercent(battery.roundTripEfficiency * 100)} Wirkungsgrad`,
  )
}

/**
 * Nur mit angegebener PV-Anlage. `pvPeakPowerKwp === undefined` bleibt ohne Nennleistungs-Angabe —
 * dieselbe Zurückhaltung wie beim PV-Satz der Zusammenfassung (`buildPvPointer`).
 *
 * ⚠ Modulanzahl und Montageart (Fassade/Dach/Freifläche) stehen NICHT hier, anders als im
 * Referenz-PDF: der Contract trägt sie nicht (nur `pvPeakPowerKwp`, die Summe über alle
 * Modulflächen) — s. `types.ts`.
 */
function pvRow(
  hasPv: boolean | undefined,
  pvStage: PvStage | undefined,
  pvPeakPowerKwp: number | undefined,
): ReportRow | null {
  if (hasPv !== true) return null

  /*
   * ⚠ „bestehend" IST EINE TATSACHENBEHAUPTUNG. Bis zum 22.09.2026 stand sie hier unbedingt — auch
   * über einer Anlage, die erst geplant ist: die Station fragte nach einer „errichteten ODER FEST
   * BESTELLTEN" und konnte die beiden gar nicht trennen. Eine fehlende Stufe gilt als `existing`,
   * weil jeder vor dieser Änderung erfasste Zählpunkt genau das meinte (`DEFAULT_PV_STAGE`).
   */
  const stage = pvStage === 'planned' ? 'geplant' : 'bestehend'

  return neutralRow(
    'Ihre PV-Anlage',
    pvPeakPowerKwp === undefined ? stage : `${formatKwp(pvPeakPowerKwp)}, ${stage}`,
  )
}

/** Immer — anders als die beiden Anlagenteile gibt es einen Netzanschluss in jedem Report. */
function gridConnectionRow(analysis: PdfReportAnalysis, tariffSource: PdfReportTariffSource): ReportRow {
  const netzebene =
    typeof tariffSource === 'object' && tariffSource !== null
      ? `Netzebene ${tariffSource.netzebene}`
      : 'Netzebene nicht erfasst'
  const measurement = hasLeistungspreis(analysis.current)
    ? 'mit Leistungsmessung'
    : 'ohne Leistungsmessung'

  return neutralRow('Ihr Netzanschluss', `${netzebene}, ${measurement}`)
}

/** Bis zu drei Zeilen — nur die vorhandenen (Batterie/PV fallen weg, der Netzanschluss nie). */
export function buildOverviewStatement(input: PdfReportInput): ReportStatement {
  const analysis = input.analysis
  const rows = [
    batteryRow(analysis),
    pvRow(input.hasPv, input.pvStage, input.pvPeakPowerKwp),
    gridConnectionRow(analysis, input.tariffSource),
  ].filter((r): r is ReportRow => r !== null)

  return {
    id: 'prerequisites_overview',
    title: 'Voraussetzungen für diese Auswertung',
    amount: null,
    rows,
    body: '',
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Block 2 — der Rahmen: hat der Anschluss einen Leistungspreis?
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

const NO_LEISTUNGSPREIS_HEAD =
  'Ihr Anschluss hat keinen Leistungspreis-Bestandteil (eine Zusatzgebühr für hohe ' +
  'Verbrauchsspitzen, vor allem bei Gewerbekunden üblich).'

/**
 * Zwei Textvarianten, je danach, ob der Anschluss einen Leistungspreis trägt — und je danach, ob
 * es eine Batterie gibt, deren Kappung dabei überhaupt zur Sprache kommen kann.
 *
 * ⚠ DIE FALSE-VARIANTE MIT BATTERIE IST DER GETESTETE FALL (Urbanz) — ihr Wortlaut ist wörtlich aus
 * dem Auftrag übernommen. Die übrigen drei Kombinationen sind ungetestet (kein Live-Fall mit
 * Leistungspreis > 0 bislang).
 */
export function buildFramingNotice(analysis: PdfReportAnalysis, hasBattery: boolean): ReportNotice {
  const body = hasLeistungspreis(analysis.current)
    ? hasBattery
      ? 'Ihr Anschluss hat einen Leistungspreis-Bestandteil. Ihre Batterie kann hier zusätzlich ' +
        'Kosten senken, indem sie Verbrauchsspitzen kappt — ein Hebel unabhängig vom gewählten Tarif.'
      : 'Ihr Anschluss hat einen Leistungspreis-Bestandteil. Ein Batteriespeicher kann hier ' +
        'zusätzlich Kosten senken, indem er Verbrauchsspitzen kappt — ein Hebel unabhängig vom ' +
        'gewählten Tarif.'
    : hasBattery
      ? `${NO_LEISTUNGSPREIS_HEAD} Ihre Batterie kann bei Ihnen deshalb keine Ersparnis durchs ` +
        '„Kappen von Spitzen" bringen. Die gesamte Ersparnis in dieser Auswertung kommt aus zwei ' +
        'anderen Quellen: dem gewählten Tarif und, falls aWATTar, der gezielten Steuerung der Batterie.'
      : `${NO_LEISTUNGSPREIS_HEAD} Die gesamte Ersparnis in dieser Auswertung kommt aus zwei ` +
        'anderen Quellen: dem gewählten Tarif und, falls aWATTar, der gezielten Steuerung eines Speichers.'

  return {
    id: 'prerequisites_framing',
    tone: 'warning',
    title: 'Ein wichtiger Rahmen vorweg',
    body,
    list: null,
    hints: [],
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Block 3 — „Ihr Verbrauch heute"
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ WIEDERVERWENDET, NICHT NEU GERECHNET: `summaryWaysOf` ist dieselbe Funktion, aus der die
 * Kopfzahl der Zusammenfassung (`buildSummaryKpis`) entsteht. `costTodayEur` hier und dort sind
 * damit strukturell derselbe Wert, nicht nur zufällig gleich.
 */
export function buildConsumptionTodayStatement(
  analysis: PdfReportAnalysis,
  pvSource: PvSource | undefined,
): ReportStatement {
  const ways = summaryWaysOf(analysis)

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ „GEMESSEN" IST HIER EINE ZUSAGE, UND SIE GILT NICHT IMMER
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Wurde eine PVGIS-Schätzung vom Verbrauch abgezogen (PV-Stufe „geplant", `run-from-draft.ts`),
   * steht die Spitze dieses Lastgangs dort, wo die GESCHÄTZTE Erzeugung gerade klein war — nicht
   * dort, wo ein Zähler eine gemessen hat. Der Report sagt das auf Seite 7 bereits im Klartext
   * („damit ist jede Lastspitze dieses Lastgangs zur Hälfte eine Schätzung"); dieselbe Zahl hier
   * als „gemessen" zu beschriften widerspräche dem eigenen Hinweis zwei Seiten weiter.
   *
   * ⚠ DIE BEDINGUNG IST `pvSource`, NICHT DIE PV-STUFE. Beide sagen heute dasselbe, aber `pvSource`
   * ist die Eigenschaft des LASTGANGS, der tatsächlich gerechnet wurde — dieselbe Tatsache, an der
   * auch der Seite-7-Hinweis hängt (Blocker `estimated_pv`). Über die Stufe abgeleitet könnten die
   * beiden Aussagen auseinanderlaufen, und sie widersprächen einander im selben Dokument. Der
   * öffentliche Rechner (`apps/website`) kennt die Stufe zudem gar nicht, koppelt aber ebenso.
   *
   * ⚠ NUR DAS LABEL. Die ZAHL bleibt unverändert — sie ist die Spitze des gerechneten Lastgangs,
   * und genau die trägt den Leistungspreis.
   */
  const peakLabel =
    pvSource === 'estimated'
      ? 'Höchste Verbrauchsspitze (nach Abzug der geschätzten PV-Erzeugung)'
      : 'Höchste gemessene Verbrauchsspitze'

  return {
    id: 'prerequisites_consumption',
    title: 'Ihr Verbrauch heute',
    amount: null,
    rows: [
      neutralRow(
        'Kosten',
        ways
          ? `${formatEur(ways.costTodayEur)} (${displayedPriceLabel(analysis)})`
          : 'nicht berechenbar',
      ),
      neutralRow('Zeitraum', `${analysis.dataQuality.coveredDays} gemessene Tage`),
      neutralRow(peakLabel, formatKw(analysis.current.annualPeakKw)),
    ],
    body: '',
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Block 4 — Preisgrundlage, nur wenn die Werte aus einer älteren Rechnung stammen
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠ ES GIBT KEIN FELD, DAS LIEFERANTENNAME ODER RECHNUNGSZEITRAUM UNABHÄNGIG TRÄGT — geprüft:
 * der Contract kennt keinen Lieferantennamen, und `tariffProvenance.invoicePeriods` ist an eine
 * ANDERE Bedingung geknüpft (ob eine Rechnung gelesen wurde) als der Preisstand-Satz hier (ob der
 * ausgewertete Zeitraum in ein laufendes Kalenderjahr reicht). Verwendet wird deshalb `tariffVintage`
 * — derselbe Satz, den `derive.ts`/`tariffVintageNote` für das Schlusskapitel bildet und der dort
 * bereits als Fussnote unter der Tarifkomponenten-Tabelle steht (`document.tsx`). Zwei verschiedene
 * Sätze für dieselbe Bedingung liefen auseinander.
 */
export function buildPriceBasisNotice(tariffVintage: string | null): ReportNotice | null {
  if (tariffVintage === null) return null

  return {
    id: 'prerequisites_price_basis',
    tone: 'warning',
    title: 'Wichtig zur Preisgrundlage',
    body:
      `${tariffVintage} Ihre Netzkosten und die gesetzlichen Abgaben sind davon nicht betroffen: ` +
      'sie sind in dieser Auswertung bereits auf dem aktuellen Jahresstand gerechnet.',
    list: null,
    hints: [],
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Die ganze Seite
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

export type PrerequisitesChapterData = {
  overview: ReportStatement
  framing: ReportNotice
  consumption: ReportStatement
  /** `null`, solange die Tarifwerte nicht aus einer älteren Rechnung stammen. */
  priceBasis: ReportNotice | null
}

export function buildPrerequisitesChapter(input: PdfReportInput): PrerequisitesChapterData {
  const analysis = input.analysis
  const hasBattery = analysis.existingBatteryAnalysis != null

  return {
    overview: buildOverviewStatement(input),
    framing: buildFramingNotice(analysis, hasBattery),
    consumption: buildConsumptionTodayStatement(analysis, input.loadProfile.pvSource),
    priceBasis: buildPriceBasisNotice(input.tariffVintage),
  }
}
