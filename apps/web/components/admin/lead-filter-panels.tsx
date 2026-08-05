/**
 * Die Inhalte der Spalten-Popover und die Marken der aktiven Filter.
 *
 * BEWUSST OHNE `'use client'`: Jedes Panel ist ein echtes `<form method="get">`. Was hier entsteht,
 * ist reines HTML — das Öffnen und Schliessen macht `components/admin/column-filter.tsx`, die
 * FILTERUNG macht die Adresse. Damit gibt es weiterhin genau einen Ort, an dem der Filterzustand
 * lebt (B1-3), und kein Panel kann eine Auswahl anzeigen, die die Liste darunter nicht hat.
 *
 * ── JEDES PANEL TRÄGT ALLE ÜBRIGEN FILTER MIT ────────────────────────────────────────────────────
 * Ein GET-Formular schickt AUSSCHLIESSLICH seine eigenen Felder — alles andere fiele beim Absenden
 * weg. Ohne `HiddenFilters` setzte also jede Filteränderung sämtliche anderen Filter zurück, und
 * der Admin bekäme wortlos eine GRÖSSERE Menge als angefordert. Genau dieser Fehler ist in B18-5
 * schon einmal beinahe entstanden (dort trug ein verstecktes Feld den Reiter mit).
 */

import * as React from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label } from '@/components/ui/input'
import {
  LEADS_HREF,
  consentStatusLabel,
  industryLabel,
  meteringTypeLabel,
  purposeLabel,
  statusLabel,
} from '@/lib/admin/leads'
import {
  filterSearchParams,
  withFilters,
  type FilterParam,
  type LeadFilters,
} from '@/lib/admin/lead-filters'
import { LEAD_SOURCE_CATEGORY_LABELS } from '@/lib/admin/lead-source-categories'
import { formatDate } from '@/lib/admin/format'

/** Eine Adresse aus einem Filterstand — leerer Filter ergibt den nackten Pfad. */
function href(params: URLSearchParams): string {
  const qs = params.toString()
  return qs ? `${LEADS_HREF}?${qs}` : LEADS_HREF
}

/**
 * Alle gesetzten Filter als versteckte Felder — ausser denen, die dieses Panel selbst bedient.
 *
 * Abgeleitet aus `filterSearchParams`, nicht aus einer eigenen Aufzählung: sonst wäre das hier die
 * zweite Liste der Parameternamen, und ein neuer Filter fiele beim Bedienen eines beliebigen
 * anderen Popovers still weg.
 */
function HiddenFilters({ filters, owns }: { filters: LeadFilters; owns: FilterParam[] }) {
  const owned = new Set<string>(owns)
  return (
    <>
      {[...filterSearchParams(filters).entries()]
        .filter(([name]) => !owned.has(name))
        .map(([name, value], i) => (
          <input key={`${name}-${value}-${i}`} type="hidden" name={name} value={value} />
        ))}
    </>
  )
}

function PanelActions({ resetHref }: { resetHref: string }) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <Button type="submit" variant="primary" size="sm">
        Übernehmen
      </Button>
      <Link
        href={resetHref}
        className="rounded-sm text-caption text-text-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
      >
        Zurücksetzen
      </Link>
    </div>
  )
}

/** Suchfeld für eine Textspalte — Teiltreffer, Gross-/Kleinschreibung egal. */
export function TextFilterPanel({
  filters,
  param,
  value,
  clear,
  placeholder,
}: {
  filters: LeadFilters
  param: FilterParam
  value: string
  /** Wie dieser Filter geleert wird — als Teilmenge von `LeadFilters`. */
  clear: Partial<LeadFilters>
  placeholder?: string
}) {
  return (
    <form method="get" action={LEADS_HREF}>
      <HiddenFilters filters={filters} owns={[param]} />
      <Input
        name={param}
        type="search"
        defaultValue={value}
        placeholder={placeholder}
        aria-label="Suchbegriff"
      />
      <p className="mt-1.5 text-caption text-text-muted">
        Teiltreffer, Gross- und Kleinschreibung egal.
      </p>
      <PanelActions resetHref={href(withFilters(filters, clear))} />
    </form>
  )
}

export type FilterChoice = { value: string; label: string; hint?: string }

/**
 * Ankreuzliste für eine kategoriale Spalte.
 *
 * ── DIE LISTE IST VOLLSTÄNDIG, NICHT „was gerade vorkommt" ───────────────────────────────────────
 * Naheliegend wäre, nur die tatsächlich vorkommenden Werte anzubieten. Das geht hier nicht ehrlich:
 * Die Seite kennt 50 Zeilen, nicht den Bestand — eine daraus gebildete Liste zeigte je nach Seite
 * und je nach bereits gesetztem Filter etwas anderes, und ein Wert verschwände genau dann aus der
 * Auswahl, wenn man ihn zum Abwählen bräuchte. Die Wertemengen sind ohnehin kurz und geschlossen
 * (drei Kategorien, acht Themen, vier Zwecke, fünf Zustände); eine Auswahl ohne Treffer ist eine
 * ehrliche Antwort, eine verschwundene Auswahl wäre eine Sackgasse.
 */
export function ChoiceFilterPanel({
  filters,
  param,
  choices,
  selected,
  clear,
  extra,
  extraParams = [],
}: {
  filters: LeadFilters
  param: FilterParam
  choices: FilterChoice[]
  selected: string[]
  clear: Partial<LeadFilters>
  /** Zusätzliche Ankreuzfelder mit eigenem Parameter (z. B. „ohne Thema", „nur ohne Fachbetrieb"). */
  extra?: React.ReactNode
  /**
   * Die Parameter, die `extra` bedient. Sie MÜSSEN hier stehen: ein Ankreuzfeld, dessen Parameter
   * zugleich als verstecktes Feld mitfährt, liesse sich nicht mehr abwählen — das versteckte Feld
   * schickte den alten Wert bei jedem Absenden erneut mit.
   */
  extraParams?: FilterParam[]
}) {
  const owned = new Set(selected)
  return (
    <form method="get" action={LEADS_HREF}>
      <HiddenFilters filters={filters} owns={[param, ...extraParams]} />
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Werte auswählen</legend>
        {choices.map((choice) => {
          const id = `f-${param}-${choice.value}`
          return (
            <div key={choice.value} className="flex items-start gap-2">
              <Checkbox
                id={id}
                name={param}
                value={choice.value}
                defaultChecked={owned.has(choice.value)}
              />
              <Label htmlFor={id} className="font-normal leading-tight">
                {choice.label}
                {choice.hint && (
                  <span className="block text-caption text-text-muted">{choice.hint}</span>
                )}
              </Label>
            </div>
          )
        })}
        {extra}
      </fieldset>
      <p className="mt-2 text-caption text-text-muted">
        Nichts angekreuzt heisst: keine Einschränkung.
      </p>
      <PanelActions resetHref={href(withFilters(filters, clear))} />
    </form>
  )
}

/** Zeitraum über das Anlagedatum — beide Grenzen einschliessend. */
export function DateRangeFilterPanel({ filters }: { filters: LeadFilters }) {
  return (
    <form method="get" action={LEADS_HREF}>
      <HiddenFilters filters={filters} owns={['von', 'bis']} />
      <div className="flex flex-col gap-2">
        <div>
          <Label htmlFor="f-von">von</Label>
          <div className="mt-1">
            <Input id="f-von" name="von" type="date" defaultValue={filters.createdFrom} />
          </div>
        </div>
        <div>
          <Label htmlFor="f-bis">bis</Label>
          <div className="mt-1">
            <Input id="f-bis" name="bis" type="date" defaultValue={filters.createdTo} />
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-caption text-text-muted">
        Beide Tage zählen mit. Eine Grenze allein genügt.
      </p>
      <PanelActions resetHref={href(withFilters(filters, { createdFrom: '', createdTo: '' }))} />
    </form>
  )
}

/**
 * Die gesetzten Filter als abwählbare Marken über der Liste.
 *
 * ── WARUM ES DIE GIBT, UND ZWAR NICHT ALS SCHMUCK ────────────────────────────────────────────────
 * Ein Filter, der nur als kleines Symbol im Spaltenkopf sichtbar ist, ist bei zehn Spalten leicht
 * zu übersehen — und ein übersehener Filter liest sich als „es gibt nicht mehr". Genau der Fehler,
 * gegen den die Trefferzahl und der Ausfuhr-Hinweis seit B2-1 gebaut sind. Die Marken sagen im
 * Klartext, was gerade eingegrenzt ist, und jede lässt sich einzeln entfernen.
 *
 * Sie decken AUCH die Filter ab, für die es keine Spalte (mehr) gibt — Status, Branche, Messart,
 * PLZ, Jahresverbrauch, Vertragsende, die alte Freitextsuche und die einzelne Herkunft. Die stehen
 * seit B2-1/B3-1 im Vokabular und bleiben über gespeicherte Adressen erreichbar; ohne Marke wäre
 * ein solcher Filter gesetzt, unsichtbar und nur durch Löschen der Adresszeile wieder loszuwerden.
 */
export function ActiveFilterChips({
  filters,
  themaLabels,
}: {
  filters: LeadFilters
  /** Schlüssel → Beschriftung, aufgelöst über die öffentliche Taxonomie (`lib/admin/lead-thema.ts`). */
  themaLabels: Map<string, string>
}) {
  const chips: Array<{ label: string; clear: Partial<LeadFilters> }> = []

  if (filters.company) chips.push({ label: `Firma: ${filters.company}`, clear: { company: '' } })
  if (filters.firstName)
    chips.push({ label: `Vorname: ${filters.firstName}`, clear: { firstName: '' } })
  if (filters.lastName) chips.push({ label: `Name: ${filters.lastName}`, clear: { lastName: '' } })
  if (filters.email) chips.push({ label: `E-Mail: ${filters.email}`, clear: { email: '' } })
  if (filters.phone) chips.push({ label: `Telefon: ${filters.phone}`, clear: { phone: '' } })
  if (filters.assignment)
    chips.push({ label: `Zuordnung: ${filters.assignment}`, clear: { assignment: '' } })

  for (const category of filters.sourceCategories) {
    chips.push({
      label: `Herkunft: ${LEAD_SOURCE_CATEGORY_LABELS[category]}`,
      clear: { sourceCategories: filters.sourceCategories.filter((c) => c !== category) },
    })
  }
  for (const key of filters.themaKeys) {
    chips.push({
      label: `Thema: ${themaLabels.get(key) ?? key}`,
      clear: { themaKeys: filters.themaKeys.filter((k) => k !== key) },
    })
  }
  if (filters.themaNone) chips.push({ label: 'Thema: ohne Thema', clear: { themaNone: false } })

  if (filters.partnerAssignment === 'assigned')
    chips.push({ label: 'nur mit Fachbetrieb', clear: { partnerAssignment: '' } })
  if (filters.partnerAssignment === 'unassigned')
    chips.push({ label: 'nur ohne Fachbetrieb', clear: { partnerAssignment: '' } })

  for (const purpose of filters.consentPurposes) {
    chips.push({
      label: `Einwilligung: ${purposeLabel(purpose)}`,
      clear: { consentPurposes: filters.consentPurposes.filter((p) => p !== purpose) },
    })
  }
  for (const state of filters.consentStates) {
    chips.push({
      label: `Zustand: ${state === 'none' ? 'keine' : consentStatusLabel(state)}`,
      clear: { consentStates: filters.consentStates.filter((s) => s !== state) },
    })
  }

  if (filters.createdFrom)
    chips.push({
      label: `Eingegangen ab ${formatDate(filters.createdFrom)}`,
      clear: { createdFrom: '' },
    })
  if (filters.createdTo)
    chips.push({
      label: `Eingegangen bis ${formatDate(filters.createdTo)}`,
      clear: { createdTo: '' },
    })

  // Die Filter ohne eigene Spalte — s. Kopf dieses Bauteils.
  if (filters.search) chips.push({ label: `Suche: ${filters.search}`, clear: { search: '' } })
  if (filters.status)
    chips.push({ label: `Status: ${statusLabel(filters.status)}`, clear: { status: '' } })
  if (filters.sourceKey)
    chips.push({ label: `Herkunftsschlüssel: ${filters.sourceKey}`, clear: { sourceKey: '' } })
  if (filters.dueOnly)
    chips.push({ label: 'nur zur Anonymisierung fällige', clear: { dueOnly: false } })
  if (filters.industry)
    chips.push({ label: `Branche: ${industryLabel(filters.industry)}`, clear: { industry: '' } })
  if (filters.meteringType)
    chips.push({
      label: `Messart: ${meteringTypeLabel(filters.meteringType)}`,
      clear: { meteringType: '' },
    })
  if (filters.postalPrefix)
    chips.push({ label: `PLZ beginnt mit ${filters.postalPrefix}`, clear: { postalPrefix: '' } })
  if (filters.consumptionMin)
    chips.push({
      label: `Verbrauch ab ${filters.consumptionMin} kWh`,
      clear: { consumptionMin: '' },
    })
  if (filters.consumptionMax)
    chips.push({
      label: `Verbrauch bis ${filters.consumptionMax} kWh`,
      clear: { consumptionMax: '' },
    })
  if (filters.contractEndFrom)
    chips.push({
      label: `Vertragsende ab ${formatDate(filters.contractEndFrom)}`,
      clear: { contractEndFrom: '' },
    })
  if (filters.contractEndTo)
    chips.push({
      label: `Vertragsende bis ${formatDate(filters.contractEndTo)}`,
      clear: { contractEndTo: '' },
    })

  if (chips.length === 0) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-caption font-semibold uppercase tracking-wide text-text-muted">
        Aktive Filter
      </span>
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={href(withFilters(filters, chip.clear))}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-subtle px-2.5 py-0.5 text-caption text-ink outline-none hover:border-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          {chip.label}
          <span aria-hidden="true" className="text-text-muted">
            ×
          </span>
          <span className="sr-only">— Filter entfernen</span>
        </Link>
      ))}
      <Link
        href={LEADS_HREF}
        className="rounded-sm text-caption text-text-muted underline underline-offset-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
      >
        alle zurücksetzen
      </Link>
    </div>
  )
}
