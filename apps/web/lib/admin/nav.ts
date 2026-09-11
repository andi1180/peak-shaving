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
import { CALCULATOR_REQUESTS_HREF } from './calculator-requests'
import { ADMIN_CALCULATOR_HREF } from './calculator'
import { GRID_TARIFFS_HREF } from './grid-tariffs'
import { OPEN_QUESTIONS_HREF } from './open-questions'
import { PROJECTS_HREF } from './projects'

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
  /*
   * B18-4: der Prüf-Eingang der Kalkulator-Anfragen. Eigener Punkt und ausdrücklich KEIN Unterpfad
   * eines Kalkulator-Bereichs — die Aktiv-Markierung in `AdminNav` arbeitet mit Präfixen und hätte
   * sonst zwei Punkte gleichzeitig markiert (dieselbe Überlegung wie bei „Partner-Anträge").
   * Fachlich ist es ohnehin ein eigener Gegenstand: hier stehen die Betriebe, über deren Zugang
   * noch nicht entschieden ist.
   */
  { href: CALCULATOR_REQUESTS_HREF, label: 'Kalkulator-Anfragen' },
  /*
   * B18-4: das Werkzeug selbst. Eigener Punkt und ausdrücklich NICHT derselbe Bereich wie
   * „Kalkulator-Anfragen" — dort wird über FREMDE Zugänge entschieden, hier wird gerechnet; das sind
   * zwei Tätigkeiten mit zwei Adressen.
   *
   * ⚠ DIE PRÄFIX-REGEL GILT IN BEIDE RICHTUNGEN, und hier ist die zweite die knappe: `AdminNav`
   * markiert aktiv, sobald der Pfad mit dem Punkt beginnt. `/admin/kalkulator` ist der KÜRZERE der
   * beiden Pfade und hätte den Prüf-Eingang geschluckt, wäre dieser `/admin/kalkulator/anfragen`
   * genannt worden — genau deshalb heisst er seit B18-4 `/admin/kalkulator-anfragen`. Die beiden
   * sind Geschwister, kein Paar aus Ober- und Unterpfad; gemessen in `lib/admin/calculator-ui.test.ts`
   * (und zusätzlich von der bestehenden Präfix-Probe über ALLE Punkte erfasst).
   *
   * ⚠ DIESER PUNKT PRÜFT KEIN ENTITLEMENT. Wer den Admin-Bereich betreten darf, bekommt den Rechner
   * sofort — Begründung in `app/admin/(intern)/kalkulator/page.tsx`.
   */
  { href: ADMIN_CALCULATOR_HREF, label: 'Kalkulator' },
  /*
   * B21-2b: die Pflege der Netzbetreiber-Preisblätter. Eigener Punkt und ausdrücklich KEIN Unterpfad
   * von „Kalkulator" — die Präfix-Regel von `AdminNav` markierte sonst beide gleichzeitig (dieselbe
   * Überlegung wie bei „Kalkulator-Anfragen"). Fachlich sind es ohnehin zwei Dinge: dort wird
   * gerechnet, hier stehen die Referenzdaten, gegen die gerechnet wird.
   */
  { href: GRID_TARIFFS_HREF, label: 'Netzbetreiber-Tarife' },
  /*
   * B24: Martins Posteingang der Kalkulator-Rückfragen. Eigener Punkt und ausdrücklich KEIN
   * Unterpfad von „Kalkulator" — die Präfix-Regel von `AdminNav` markierte sonst beide gleichzeitig
   * (dieselbe Überlegung wie bei „Kalkulator-Anfragen" und „Netzbetreiber-Tarife"). Fachlich sind es
   * ohnehin zwei Dinge: dort wird gerechnet, hier wartet ein Kunde auf eine Auskunft, die der Chat
   * nicht selbst geben konnte.
   *
   * ⚠ Der Punkt hat keinen Zähler. Ein „(3)" in der Navigation wäre die naheliegende Ergänzung und
   * kostete auf JEDER Admin-Seite eine zusätzliche Abfrage — der Rahmen wird aus dem Layout
   * gerendert, das jede Unterroute umschliesst. Wer ihn will, baut ihn dort bewusst und nicht
   * nebenbei.
   */
  { href: OPEN_QUESTIONS_HREF, label: 'Rückfragen' },
  /*
   * B24 (Teil 1 Schritt 1): die Projekte des Kalkulators — Container für einen Kundenfall.
   *
   * ⚠ DIE ADRESSE IST `/admin/kalkulator-projekte` UND AUSDRÜCKLICH KEIN UNTERPFAD VON
   * `/admin/kalkulator`. Die Aktiv-Markierung unten vergleicht `pathname === href` ODER
   * `pathname.startsWith(`${href}/`)` — `/admin/kalkulator/projekte` fiele damit zusätzlich unter
   * „Kalkulator", und zwei Punkte stünden gleichzeitig aktiv. Dieselbe Falle und dieselbe Auflösung
   * wie bei „Kalkulator-Anfragen" (B18-4), „Netzbetreiber-Tarife" (B21-2b) und „Rückfragen" (B24);
   * die Präfix-Probe über ALLE Punkte (`lib/admin/calculator-requests-ui.test.ts`) fasst sie mit.
   *
   * Fachlich sind es ohnehin zwei Dinge: unter „Kalkulator" wird gerechnet, hier stehen die
   * Kundenfälle, für die gerechnet wird.
   */
  { href: PROJECTS_HREF, label: 'Kalkulator-Projekte' },
] as const
