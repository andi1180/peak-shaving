import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { ADMIN_HREF } from './config'
import { ADMIN_CALCULATOR_HREF } from './calculator'
import { ADMIN_NAV_ITEMS } from './nav'
import {
  PROJECTS_HREF,
  PROJECT_SEGMENTS,
  PROJECT_SEGMENT_LABELS,
  projectHref,
  projectSegmentLabel,
  readAdminProject,
  readAdminProjectList,
} from './projects'

/**
 * B24 (Teil 1 Schritt 1) — die Eigenschaften der Admin-Projektliste, die ohne Datenbank und ohne
 * Renderer prüfbar sind.
 *
 * Die zwei Fehler, die hier sonst niemandem auffielen:
 *
 *   1. DIE ADRESSE FÄLLT UNTER „KALKULATOR". `AdminNav` markiert aktiv bei Gleichheit ODER
 *      `startsWith('<href>/')`. `/admin/kalkulator/projekte` stünde damit gleichzeitig unter zwei
 *      Punkten — und beide Seiten funktionierten, weshalb weder Build noch Typecheck etwas sagt.
 *      Die allgemeine Präfix-Probe über ALLE Punkte steht in `calculator-requests-ui.test.ts`; hier
 *      wird zusätzlich die ENGE Kante gegen `/admin/kalkulator` gemessen, weil genau sie beim
 *      Benennen dieses Bereichs zur Entscheidung stand.
 *
 *   2. EIN FEHLENDES SEGMENT WIRD ZU EINER ANGABE. `platform.projects.segment` ist NULLABLE, und
 *      NULL heisst „das Gespräch hat es noch nicht bestimmt" — nicht „privat". Ein Vorgabewert in
 *      der Anzeige behauptete etwas, das niemand entschieden hat, und an genau dieser Angabe hängt,
 *      welcher Fragen-Pool im Chat gilt.
 */

describe('B24 Projektliste — Adressen', () => {
  it('ist ein Geschwisterpfad und liegt unterhalb von /admin', () => {
    expect(PROJECTS_HREF).toBe('/admin/kalkulator-projekte')
    expect(PROJECTS_HREF.startsWith(`${ADMIN_HREF}/`)).toBe(true)
  })

  it('⚠ liegt NICHT unter /admin/kalkulator — sonst wären zwei Nav-Punkte gleichzeitig aktiv', () => {
    /*
     * Die Regel aus `components/admin/nav.tsx`, hier beidseitig nachgestellt.
     *
     * Die Breitung auf `string` ist nötig, nicht kosmetisch: beide Konstanten sind
     * Literal-Typen, und TypeScript weist einen Gleichheitsvergleich zwischen zwei verschiedenen
     * Literalen als „unintentional" ab (TS2367). Der Vergleich soll hier aber zur LAUFZEIT
     * stattfinden — er ist genau der, den `AdminNav` anstellt.
     */
    const punkt: string = ADMIN_CALCULATOR_HREF
    const eigen: string = PROJECTS_HREF
    expect(eigen === punkt).toBe(false)
    expect(eigen.startsWith(`${punkt}/`)).toBe(false)
    expect(punkt.startsWith(`${eigen}/`)).toBe(false)
  })

  it('bildet die Detailadresse aus der Kennung', () => {
    expect(projectHref('abc-123')).toBe('/admin/kalkulator-projekte/abc-123')
  })

  it('führt den Bereich genau einmal in der Navigation', () => {
    const treffer = ADMIN_NAV_ITEMS.filter((item) => item.href === PROJECTS_HREF)
    expect(treffer).toHaveLength(1)
    expect(treffer[0]?.label).toBe('Kalkulator-Projekte')
  })

  it('legt beide Routen im geschützten Zweig ab', () => {
    /*
     * `route-protection.test.ts` prüft das bereits für ALLE Admin-Routen. Hier steht es trotzdem,
     * weil eine Route ausserhalb von `(intern)` eine öffentlich erreichbare Verwaltungsseite wäre
     * und die Liste die Projektnamen aller Kunden trägt — und weil dieser Test benennt, WELCHE zwei
     * Dateien gemeint sind, falls jemand sie verschiebt.
     */
    const appDir = path.resolve(import.meta.dirname, '..', '..', 'app')
    for (const rel of [
      'admin/(intern)/kalkulator-projekte/page.tsx',
      'admin/(intern)/kalkulator-projekte/[id]/page.tsx',
    ]) {
      expect(fs.existsSync(path.join(appDir, rel)), rel).toBe(true)
    }
  })
})

describe('B24 Projektliste — Segment', () => {
  it('beschriftet jeden Wert des geschlossenen Enums', () => {
    for (const segment of PROJECT_SEGMENTS) {
      expect(PROJECT_SEGMENT_LABELS[segment]).toBeTruthy()
    }
    expect(Object.keys(PROJECT_SEGMENT_LABELS)).toHaveLength(PROJECT_SEGMENTS.length)
  })

  it('⚠ NULL bleibt NULL — es gibt keinen Rückfall auf „Privat"', () => {
    expect(projectSegmentLabel(null)).toBeNull()
    expect(projectSegmentLabel('')).toBeNull()
    expect(projectSegmentLabel('privat')).toBe('Privat')
    expect(projectSegmentLabel('betrieb')).toBe('Betrieb')
  })

  it('reicht einen unbekannten Wert durch, statt ihn zu verschlucken', () => {
    // Er stünde so in der Datenbank; ihn zu verschweigen machte einen Pflegefehler unsichtbar.
    expect(projectSegmentLabel('gewerbe')).toBe('gewerbe')
  })
})

describe('B24 Projektliste — Leser', () => {
  it('⚠ trennt „konnte nicht geladen werden" von „es gibt noch nichts"', () => {
    /*
     * Der Unterschied entscheidet, was die Seite zeigt: bei `total === 0` führt sie direkt zum
     * Anlage-Formular, bei `null` sagt sie, dass etwas schiefging. Gleich dargestellt legte jemand
     * ein zweites Projekt an, weil das erste scheinbar fehlt.
     */
    expect(readAdminProjectList({ status: 'boom' })).toBeNull()
    expect(readAdminProjectList(null)).toBeNull()
    expect(readAdminProjectList({ status: 'ok', total: 0, projects: [] })).toEqual({
      total: 0,
      projects: [],
    })
  })

  it('führt `total` getrennt von der Zahl der gelieferten Zeilen', () => {
    // `admin_list_projects` deckelt bei 200 je Aufruf — ohne die getrennte Zahl könnte die Seite
    // die Kürzung nicht offenlegen und täuschte Vollständigkeit vor.
    const list = readAdminProjectList({
      status: 'ok',
      total: 137,
      projects: [{ id: 'p1', customer_label: 'A' }],
    })
    expect(list?.total).toBe(137)
    expect(list?.projects).toHaveLength(1)
  })

  it('trennt „gibt es nicht" von „nicht geladen" beim Projektkopf', () => {
    expect(readAdminProject({ status: 'not_found' })).toBe('not_found')
    expect(readAdminProject({ status: 'boom' })).toBeNull()
    expect(readAdminProject(null)).toBeNull()
  })

  it('liest den Projektkopf aus dem verschachtelten Feld, samt Segment und Branche', () => {
    /*
     * Die zwei Felder kommen seit `20260911090000` mit (Rumpf von `admin_get_project` erweitert,
     * Signatur unverändert). Dass sie WIRKLICH aus der Datenbank kommen, misst das DB-Gate
     * (`packages/db-tests/src/metering-points.test.ts`) mit einem echten Aufruf — hier wird nur
     * geprüft, dass der Leser sie nicht unterwegs verliert.
     */
    const head = readAdminProject({
      status: 'ok',
      project: {
        id: 'p1',
        customer_label: 'Hotel Alpenblick',
        account_id: null,
        segment: 'betrieb',
        industry: 'hotel',
      },
    })
    expect(head).not.toBeNull()
    if (head === null || head === 'not_found') return
    expect(head.customer_label).toBe('Hotel Alpenblick')
    expect(head.segment).toBe('betrieb')
    expect(head.industry).toBe('hotel')
  })
})
