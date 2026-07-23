/**
 * Die Bereiche des Admin-Rahmens (B17) — Fundort der Navigationspunkte.
 *
 * ⚠ DIESES MODUL DARF AUS KEINER CLIENT-KOMPONENTE IMPORTIERT WERDEN, und das ist keine Stilfrage.
 * Die Beschriftungen sind die STRUKTUR des Verwaltungsbereichs („Leads", „Analysen",
 * „Partner-Anträge"). Läge die Liste in einer `'use client'`-Datei, landete sie als JavaScript-Chunk
 * im Auslieferungsverzeichnis und wäre damit für jeden abrufbar, der die Adresse eines solchen
 * Chunks kennt — auch für jemanden ohne Sitzung, und ohne dass irgendein HTML sie je enthalten
 * hätte. Bis B17 war genau das der Fall (`components/admin/nav.tsx` trug die Liste selbst).
 *
 * Deshalb: die Liste wird in der SERVER-Komponente `components/admin/shell.tsx` gelesen und der
 * Client-Navigation als Prop übergeben. Die Client-Datei enthält danach nur noch die Darstellung
 * (sie braucht `usePathname`, um den aktiven Punkt zu markieren) und keinen einzigen Bereichsnamen.
 *
 * Ein neuer Bereich ist ein Eintrag in dieser Liste — mehr nicht; Rahmen, Navigation und
 * Aktiv-Markierung ziehen von selbst nach.
 */
import { ADMIN_HREF } from './config'
import { LEADS_HREF } from './leads'
import { ANALYSES_HREF } from './analyses'
import { PARTNERS_HREF } from './partners'
import { PARTNER_APPLICATIONS_HREF } from './partner-applications'

export type AdminNavItem = {
  href: string
  label: string
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: ADMIN_HREF, label: 'Übersicht' },
  { href: LEADS_HREF, label: 'Leads' },
  // B14-2: das Archiv der eingefrorenen Auslegungen. Eigener Punkt und nicht ein Abschnitt unter
  // „Leads": eine Analyse überlebt den Lead bewusst (B14-1, ON DELETE SET NULL statt CASCADE) und
  // kann von vornherein ohne einen entstehen.
  { href: ANALYSES_HREF, label: 'Analysen' },
  // B16-2: die Stammdaten der Fachbetriebe. Eigener Punkt und kein Abschnitt unter „Leads": ein
  // Partner ist eine Vereinbarung mit eigener Lebensdauer — er entsteht vor dem ersten Lead und
  // überlebt dessen Anonymisierung (B16-1 hält `partner_slug` bewusst aus dem Guard heraus).
  { href: PARTNERS_HREF, label: 'Partner' },
  /*
   * B16-3: der Prüf-Eingang der Bewerbungen. Eigener Punkt neben „Partner" und ausdrücklich KEIN
   * Unterpfad davon: `/admin/partner/antraege` hätte wegen der Präfix-Regel in `AdminNav` BEIDE
   * Punkte gleichzeitig markiert — genau der Zustand, den der Kommentar dort ausschliesst. Fachlich
   * sind es ohnehin zwei Dinge: „Partner" sind die aufgenommenen Betriebe, hier stehen die, über die
   * noch nicht entschieden ist.
   */
  { href: PARTNER_APPLICATIONS_HREF, label: 'Partner-Anträge' },
] as const
