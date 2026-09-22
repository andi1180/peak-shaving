import { REPORT_OPTIONAL_SECTIONS, reportSectionEnabled, type ReportOptionalSection } from 'shared'

import { REPORT_SECTIONS, type ReportSectionKey } from './content'
import type { ReportBuildContext } from './context'
import type { ReportBaukastenId, ReportBaukastenRegistry } from './registry'
import type { ReportLayout, ReportRefTarget } from './report-text'
import type { PdfReportInput } from './types'

/**
 * Stufe D — die Beschreibung des zusammengestellten Dokuments, gegen die ein Querverweis aufgelöst
 * wird.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ SIE IST DATEN UND KEINE ZWEITE ABLEITUNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `ReportComposition` ist eine Liste: welcher Baustein steht in diesem Dokument, in welchem
 * Kapitel, an welcher Stelle der Leseordnung, und welche Felder trägt er. Sie wird aus der
 * Registry gebildet (`buildReportLayout`) und sonst nirgends erfunden. Ein Prüflauf kann sie von
 * Hand hinschreiben und damit eine ANDERE Reihenfolge messen, ohne das Dokument umzubauen — genau
 * das ist der Nachweis, dass die Verweise ortsunabhängig geworden sind (`report-text.test.ts`).
 *
 * ── ⚠ KEINE REKURSION, OBWOHL ES SO AUSSIEHT ──────────────────────────────────────────────────
 * Die Beschreibung entsteht, indem alle 26 Bausteine gebaut werden — und deren Körper tragen
 * ihrerseits Verweise. Das dreht sich nicht im Kreis: gebaut wird ein `ReportTextParts`, also der
 * UNAUFGELÖSTE Text. Gelesen werden hier ausschliesslich Titel, Zeilenbeschriftungen und die
 * Kopfzahl — nie ein Körper. Aufgelöst wird erst danach, im Renderer.
 */

/** Ein Baustein, wie das Dokument ihn zeigt — so weit ein Verweis auf ihn zeigen kann. */
export type ReportPlacement = {
  id: ReportBaukastenId
  section: ReportSectionKey
  /** Sein Titel. Leer, wo er keinen trägt (die drei Tabellen — ihre Überschrift steht im JSX). */
  title: string
  /** Die Beschriftung seiner Kopfzahl. `null` = er trägt keine. */
  amount: string | null
  /** Die Beschriftungen seiner Zeilen, über deren stabilen Schlüssel (`ReportRow.key`). */
  rows: Readonly<Record<string, string>>
  /** Die Beschriftungen seiner Spalten (nur Tabellen), über `ReportTableColumn.key`. */
  columns?: Readonly<Record<string, string>>
}

/** Die Bausteine dieses Dokuments in LESEORDNUNG. Was nicht dasteht, steht auch nicht drin. */
export type ReportComposition = readonly ReportPlacement[]

/**
 * Der Leser der Beschreibung — hier und nur hier steht, wie aus einer Leseordnung ein Ortswort
 * wird.
 *
 * ⚠ DIE DREI FÄLLE SIND DIE AUS DEM PLAN (§2.3) und decken die heutigen Formulierungen: ein Ziel
 * im selben Kapitel weiter vorne heisst „oben", weiter hinten „weiter unten", und ein Ziel in
 * einem anderen Kapitel wird über seinen KAPITELTITEL benannt statt über eine Richtung. Der dritte
 * Fall ist bewusst richtungslos: „weiter hinten" suggerierte eine Seitenzahl, die es im Fliesstext
 * nicht gibt (s. `report-text.ts`).
 */
export function reportLayoutOf(composition: ReportComposition): ReportLayout {
  const byId = new Map<string, ReportPlacement & { index: number }>(
    composition.map((placement, index) => [placement.id, { ...placement, index }]),
  )

  const labelOf = (target: ReportRefTarget): string => {
    const to = byId.get(target.id)
    if (!to) return ''
    if (target.kind === 'amount') return to.amount ?? ''
    if (target.kind === 'row') return to.rows[target.row] ?? ''
    if (target.kind === 'column') return to.columns?.[target.column] ?? ''
    return to.title
  }

  return {
    present: (target) => {
      const to = byId.get(target.id)
      if (!to) return false
      if (target.kind === 'amount') return to.amount !== null
      if (target.kind === 'row') return to.rows[target.row] !== undefined
      if (target.kind === 'column') return to.columns?.[target.column] !== undefined
      return true
    },
    label: labelOf,
    section: (target) => {
      const to = byId.get(target.id)
      return to ? (REPORT_SECTIONS[to.section].reference ?? null) : null
    },
    place: (from, target) => {
      const to = byId.get(target.id)
      if (!to) return ''
      const origin = byId.get(from)
      /* Kein Kapitel gemeinsam — dann benennt der Verweis das Kapitel, statt eine Richtung zu
         behaupten. Ein unbekannter Ursprung fällt in denselben Zweig: ohne ihn gibt es kein Oben. */
      if (!origin || origin.section !== to.section) {
        return `im Kapitel „${REPORT_SECTIONS[to.section].title}"`
      }
      return to.index < origin.index ? 'oben' : 'weiter unten'
    },
  }
}

/**
 * Report-Baukasten C — zeigt das Dokument diesen Baustein, soweit die Admin-Auswahl darüber
 * entscheidet?
 *
 * ⚠ EINE BEDINGUNG, EIN ORT: `document.tsx` (`selectedStatement`/`selectedNotice`) und die
 * Beschreibung hier müssen dieselbe Antwort geben. Zwei Fassungen ergäben einen Verweis auf einen
 * Baustein, den der Leser nicht sieht — und das ist genau der Fehler, den Stufe D abstellt.
 */
export function reportBlockSelected(input: PdfReportInput, id: ReportBaukastenId): boolean {
  const optional = (REPORT_OPTIONAL_SECTIONS as readonly string[]).includes(id)
  return !optional || reportSectionEnabled(input.optionalSections, id as ReportOptionalSection)
}

/**
 * Die Beschreibung aus der Registry — EINMAL je Erzeugung (`render.tsx`), nicht je Durchlauf.
 *
 * ⚠ DREI GRÜNDE, AUS DENEN EIN GEBAUTER BAUSTEIN TROTZDEM NICHT IM DOKUMENT STEHT, und alle drei
 * gehören hierher: die Admin-Auswahl (`reportBlockSelected`), der Kapitel-Schalter des
 * Ladeverhalten-Kapitels und der der Gerätewahl. Die Registry kennt den ersten nur für die zwei
 * Hinweise des Schlusskapitels (sie kommen fertig aus dem Kontext) und den zweiten gar nicht —
 * `document.tsx` wendet ihn beim Rendern an. Hier nachgebildet ist damit die ANTWORT des
 * Dokuments und nicht die der Registry.
 */
export function buildReportLayout(
  input: PdfReportInput,
  context: ReportBuildContext,
  registry: ReportBaukastenRegistry,
): ReportLayout {
  const composition: ReportPlacement[] = []

  for (const entry of registry.entries) {
    if (!reportBlockSelected(input, entry.id)) continue
    if ((entry.id === 'hour_flow' || entry.id === 'charge_price') && !context.hasInsight) continue

    if (entry.form === 'statement') {
      const built = entry.build()
      if (!built) continue
      composition.push({
        id: entry.id,
        section: entry.section,
        title: built.title,
        /* Leere Bezugsgrösse = keine (das Verdikt „Nein“ trägt keine, s. `statement.ts`):
           sonst löste ein Verweis darauf zu „die Zahl „““ auf. */
        amount: built.amount && built.amount.caption !== '' ? built.amount.caption : null,
        rows: Object.fromEntries(
          built.rows.flatMap((r) => (r.key ? [[r.key, r.label] as const] : [])),
        ),
      })
      continue
    }

    if (entry.form === 'notice' || entry.form === 'method') {
      const built = entry.build()
      if (!built) continue
      composition.push({
        id: entry.id,
        section: entry.section,
        title: built.title,
        amount: null,
        rows: {},
      })
      continue
    }

    /* Tabellen: ihre Überschrift steht als Literal im JSX und nicht im Objekt — s. `ReportTable`. */
    const built = entry.build()
    if (built === null) continue
    composition.push({
      id: entry.id,
      section: entry.section,
      title: '',
      amount: null,
      rows: {},
      columns: Object.fromEntries(
        built.columns.flatMap((c) => (c.key ? [[c.key, c.label] as const] : [])),
      ),
    })
  }

  return reportLayoutOf(composition)
}
