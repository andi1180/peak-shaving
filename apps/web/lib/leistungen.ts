/**
 * Die 6 Leistungen als DATENQUELLE (Pflichtenheft §5.1).
 *
 * Genau EIN Template rendert alle 6 Unterseiten und die Übersicht
 * (`components/leistung/`). Hier steht, was die Seiten voneinander
 * unterscheidet und NICHT aus einem Text besteht: Slug, Gruppe, Icon und die
 * Cross-Link-Ziele. Alle sichtbaren Texte kommen über `messages/de.json`
 * (§8.7 — keine Strings hart im JSX); die Reihenfolge/Slugs kommen aus
 * `lib/nav.ts` (die IA hat genau einen Fundort, §4.1).
 *
 * Eine neue Leistung ist damit: ein Eintrag in `lib/nav.ts` + ein Icon/Cross-Link
 * hier + ein Message-Block. Keine neue Seiten-Datei mit kopiertem Layout.
 */

import { ClipboardCheck, Coins, Gauge, ScrollText, Sun, Thermometer } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { MAIN_NAV, LEISTUNGEN_FLAT, type NavLeaf } from './nav'

/**
 * ICONS je Leistung — schlichte, einfarbige lucide-Line-Icons. KEINE Emoji
 * (Pflichtenheft §7.3; der Bestand nutzt ☀️📜📊⚡💶🧾 — genau der Hauptgrund
 * für den verspielten Eindruck der alten Seite).
 *
 * Steht hier und nicht in einer Komponente: Portfolio-Kacheln (Startseite),
 * Leistungs-Übersicht und Leistungs-Hero zeigen dasselbe Icon je Leistung —
 * drei Kopien derselben Zuordnung wären drei Gelegenheiten zum Auseinanderlaufen.
 */
export const LEISTUNG_ICONS: Record<string, LucideIcon> = {
  pvSpeicher: Sun,
  energiemanagement: Gauge,
  smartHeating: Thermometer,
  ppa: ScrollText,
  finanzierung: Coins,
  esg: ClipboardCheck,
}

/**
 * Cross-Link-Ziele (§4.2/§6.4). Ein Ziel ist entweder eine andere Leistung oder
 * das Peak-Shaving-Flaggschiff — die interne Verlinkung auf die „Money-Page" ist
 * ausdrücklich erwünscht (§4.2).
 *
 * `navKey` zeigt in den `Nav`-Namespace (der Titel des Links IST das Nav-Label —
 * ein zweiter, abweichender Name für dieselbe Seite wäre eine Falle). Der
 * ERKLÄRTEXT je Link steht dagegen pro Quellseite in den Messages
 * (`Leistungen.Pages.<seite>.related.<key>`): warum ausgerechnet DIESE Seite auf
 * jenes Ziel verweist, ist je Kontext eine andere Aussage.
 */
type CrossTarget = { href: string; navKey: string }

const LEISTUNG_HREF: Record<string, string> = Object.fromEntries(
  LEISTUNGEN_FLAT.map((leaf: NavLeaf) => [leaf.labelKey, leaf.href]),
)

const CROSS_TARGETS: Record<string, CrossTarget> = {
  // Die 5 möglichen Geschwister-Leistungen — Slugs aus lib/nav.ts, nicht getippt.
  ...Object.fromEntries(
    LEISTUNGEN_FLAT.map((leaf: NavLeaf) => [leaf.labelKey, { href: leaf.href, navKey: leaf.labelKey }]),
  ),
  // Das Flaggschiff: Erklärseite (Methode) und Produktseite (Kalkulator) sind
  // zwei Intents und zwei Ziele (§6.2) — hier bewusst einzeln adressierbar.
  peakShaving: { href: '/peak-shaving', navKey: 'peakShavingWhat' },
  kalkulator: { href: '/peak-shaving/kalkulator', navKey: 'peakShavingCalculator' },
}

export type LeistungCrossLink = { key: string } & CrossTarget

export type Leistung = {
  /** Schlüssel in `Nav`, `Pages` und `Leistungen.Pages` der Message-Datei. */
  key: string
  href: string
  /** Gruppen-Überschrift im Mega-Menü — dieselbe Gruppierung trägt die Übersicht. */
  groupKey: string
  icon: LucideIcon
  crossLinks: LeistungCrossLink[]
}

/**
 * Cross-Links je Leistung — inhaltlich gewählt, nicht „alle mit allen":
 * eine Linkliste, die jede Seite auf jede andere zeigt, trägt keine Information
 * mehr (dieselbe Logik wie beim Akzent: überall = nirgends).
 *
 * Peak Shaving steht bei den drei Seiten, die technisch daran hängen (Speicher,
 * Lastgang-Daten, steuerbare Last) — nicht bei PPA/ESG, wo der Bezug konstruiert
 * wäre. Der Kalkulator (Produkt-Intent) steht nur dort, wo er wirklich das
 * nächste Werkzeug ist: bei der Wirtschaftlichkeitsrechnung.
 */
const CROSS_LINKS: Record<string, string[]> = {
  pvSpeicher: ['peakShaving', 'energiemanagement', 'finanzierung'],
  energiemanagement: ['peakShaving', 'pvSpeicher', 'esg'],
  smartHeating: ['peakShaving', 'energiemanagement'],
  ppa: ['pvSpeicher', 'energiemanagement', 'esg'],
  finanzierung: ['pvSpeicher', 'kalkulator', 'esg'],
  esg: ['energiemanagement', 'ppa'],
}

function resolve(key: string): LeistungCrossLink {
  const target = CROSS_TARGETS[key]
  if (!target) throw new Error(`Cross-Link-Ziel "${key}" ist in CROSS_TARGETS nicht bekannt`)
  return { key, ...target }
}

/**
 * Die 6 Leistungen in Menü-Reihenfolge, samt Gruppe. Aus MAIN_NAV abgeleitet:
 * Reihenfolge und Gruppierung der Übersicht folgen so automatisch dem Mega-Menü
 * (Aufgabe 4) — eine zweite, handgepflegte Liste würde davon abdriften.
 */
export const LEISTUNGEN: Leistung[] = (
  MAIN_NAV.find((item) => item.labelKey === 'leistungen')?.groups ?? []
).flatMap((group) =>
  group.items.map((leaf) => {
    const icon = LEISTUNG_ICONS[leaf.labelKey]
    if (!icon) throw new Error(`Leistung "${leaf.labelKey}" hat kein Icon in LEISTUNG_ICONS`)
    return {
      key: leaf.labelKey,
      href: leaf.href,
      groupKey: group.labelKey,
      icon,
      crossLinks: (CROSS_LINKS[leaf.labelKey] ?? []).map(resolve),
    }
  }),
)

/** Die Übersicht rendert die Gruppen des Mega-Menüs in derselben Reihenfolge. */
export const LEISTUNGEN_GROUPS: { labelKey: string; items: Leistung[] }[] = (
  MAIN_NAV.find((item) => item.labelKey === 'leistungen')?.groups ?? []
).map((group) => ({
  labelKey: group.labelKey,
  items: LEISTUNGEN.filter((l) => l.groupKey === group.labelKey),
}))

export function findLeistung(key: string): Leistung {
  const leistung = LEISTUNGEN.find((l) => l.key === key)
  if (!leistung) throw new Error(`Leistung "${key}" fehlt in LEISTUNGEN (lib/nav.ts?)`)
  return leistung
}

/** Slug einer Leistung, falls eine andere Seite direkt darauf zeigen will. */
export function leistungHref(key: string): string {
  const href = LEISTUNG_HREF[key]
  if (!href) throw new Error(`Leistung "${key}" fehlt in lib/nav.ts`)
  return href
}
