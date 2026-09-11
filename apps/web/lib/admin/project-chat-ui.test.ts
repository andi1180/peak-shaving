import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PROJECTS_HREF, projectDataEntryHref, projectHref } from './projects'

/**
 * B24, Teil 1 — die Eigenschaften des Admin-Zugriffs auf den Projekt-Chat, die ohne Renderer
 * prüfbar sind. Drei Dinge, die weder Build noch Typecheck sehen und die alle drei „funktionieren",
 * wenn sie falsch sind:
 *
 *   1. DASS DIE SEITE KEIN ENTITLEMENT PRÜFT. Die bewusste Ausnahme des Admin-Bereichs (ein Admin
 *      ist kein Kunde seines eigenen Werkzeugs, B18-4). Ein später „zur Vereinheitlichung"
 *      ergänztes `getCalculatorAccess()` wäre in keinem Test sichtbar: die Seite funktionierte
 *      weiter, nur stünde Andreas vor dem Anfrage-Formular, wenn er ein Projekt bearbeiten will,
 *      das er selbst angelegt hat.
 *
 *   2. DASS SIE DEN ADMIN-LESEPFAD BENUTZT. `get_my_project` prüft EIGENTUM, `admin_get_project`
 *      die Adminrolle. Mit dem falschen Wrapper wäre die Seite für JEDES Projekt leer, das dem
 *      Admin nicht selbst gehört — also für praktisch alle, und ausgerechnet im Admin-Bereich.
 *
 *   3. ⚠ DASS DER INTL-KONTEXT VON AUSSEN KOMMT. `ProjectChat` ruft `useTranslations`, und
 *      `/admin` liegt ausserhalb von `app/(site)/[locale]`. Dass es trotzdem läuft, hängt an EINER
 *      Zeile in `components/admin/root-shell.tsx` — die dort aus einem ANDEREN Grund steht (die
 *      locale-bewussten UI-Primitives). Wer sie entfernt, bricht diesen Chat, und zwar erst zur
 *      Laufzeit und nur auf dieser einen Route. Deshalb steht die Abhängigkeit als Paar im Test:
 *      der eine Teil darf nicht ohne den anderen verschwinden.
 *
 * Reine Datei- und Quelltextprüfung: kein React, kein Request, keine Datenbank (s. `vitest.config.ts`).
 */

const APP_DIR = path.resolve(import.meta.dirname, '..', '..', 'app')
const COMPONENTS_DIR = path.resolve(import.meta.dirname, '..', '..', 'components')

const DATA_ENTRY_PAGE = path.join(
  APP_DIR,
  'admin',
  '(intern)',
  'kalkulator-projekte',
  '[id]',
  'dateneingabe',
  'page.tsx',
)
const DETAIL_PAGE = path.join(
  APP_DIR,
  'admin',
  '(intern)',
  'kalkulator-projekte',
  '[id]',
  'page.tsx',
)
const CUSTOMER_PAGE = path.join(
  APP_DIR,
  '(site)',
  '[locale]',
  'kalkulator',
  'projekte',
  '[id]',
  'page.tsx',
)
const ROOT_SHELL = path.join(COMPONENTS_DIR, 'admin', 'root-shell.tsx')
const PROJECT_CHAT = path.join(COMPONENTS_DIR, 'kalkulator', 'project-chat.tsx')

/**
 * Kommentare raus, bevor der Quelltext geprüft wird — sonst wertet der Wächter das ERKLÄREN der
 * Regel als Verstoss (die Falle aus B11, s. `route-protection.test.ts`). Die Seite begründet
 * ausführlich, warum sie KEIN Entitlement liest, und nennt den Namen dabei.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function read(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf8'))
}

describe('B24 — Adresse der Dateneingabe', () => {
  it('liegt unterhalb der Projekt-Detailseite', () => {
    expect(projectDataEntryHref('abc')).toBe('/admin/kalkulator-projekte/abc/dateneingabe')
    expect(projectDataEntryHref('abc').startsWith(`${projectHref('abc')}/`)).toBe(true)
    expect(projectDataEntryHref('abc').startsWith(`${PROJECTS_HREF}/`)).toBe(true)
  })

  it('kollidiert nicht mit dem Kalkulator-Bereich', () => {
    // `AdminNav` markiert über `startsWith(`${href}/`)`. Der Bindestrich ist dort kein Trennzeichen
    // — sonst stünden „Kalkulator" und „Kalkulator-Projekte" gleichzeitig aktiv.
    expect(projectDataEntryHref('abc').startsWith('/admin/kalkulator/')).toBe(false)
  })

  it('liegt als Datei genau dort, wo der Pfad es sagt', () => {
    // Der Ordner liesse sich umbenennen, ohne dass irgendetwas bricht — die verlinkte Kachel
    // führte dann auf eine 404.
    expect(fs.existsSync(DATA_ENTRY_PAGE)).toBe(true)
    expect(projectDataEntryHref('x').endsWith('/dateneingabe')).toBe(true)
  })
})

describe('B24 — die Seite prüft ausschliesslich die Adminrolle', () => {
  const source = read(DATA_ENTRY_PAGE)

  it('ruft isCurrentUserAdmin auf', () => {
    expect(source).toContain('isCurrentUserAdmin')
  })

  it('⚠ liest KEIN Entitlement — kein getCalculatorAccess, kein calculator_pro', () => {
    expect(source).not.toContain('getCalculatorAccess')
    expect(source).not.toContain('calculator_pro')
    expect(source).not.toContain('get_my_entitlement')
  })

  it('⚠ liest das Projekt über den ADMIN-Wrapper, nicht über den Eigentums-Wrapper', () => {
    expect(source).toContain('readAdminProject')
    expect(source).toContain('admin_get_project')
    // `get_my_project` prüft Eigentum — ein Admin besitzt fremde Projekte nicht.
    expect(source).not.toContain('get_my_project')
    expect(source).not.toContain('readMyProject')
  })

  it('rendert den Chat und leitet die Sicht über dieselbe Erlaubnisliste wie der Kunde', () => {
    expect(source).toContain('ProjectChat')
    // Eine zweite Auslegung, WAS aus dem Verlauf sichtbar ist, liefe beim nächsten Umbau von der
    // Kundenansicht weg — dann sähe Martin eine Zeile, die der Kunde nie gelesen hat.
    expect(source).toContain('visibleTranscript')
  })
})

describe('B24 — der Intl-Kontext des Admin-Bereichs', () => {
  it('⚠ ProjectChat braucht ihn — er ruft useTranslations', () => {
    // Das ist die Voraussetzung, die den Test daneben überhaupt nötig macht. Fällt sie weg, darf
    // auch die Zusicherung am Rahmen fallen.
    expect(read(PROJECT_CHAT)).toContain('useTranslations')
  })

  it('⚠ und der Admin-Rahmen stellt ihn bereit — ohne diese Zeile bricht die Dateneingabe', () => {
    // `AdminRootShell` umschliesst beide Admin-Root-Layouts. Die Server-Variante von
    // `NextIntlClientProvider` löst ein fehlendes `messages` zu `await getMessages()` auf, liefert
    // also den vollständigen Katalog — am laufenden Server gegengeprüft (s. Kopf der Seite).
    const shell = read(ROOT_SHELL)
    expect(shell).toContain('NextIntlClientProvider')
    expect(shell).toContain('setRequestLocale')
  })

  it('setzt deshalb KEINEN zweiten Provider in der Seite', () => {
    // Er schriebe dieselben Namespaces ein zweites Mal in einen Payload, der sie ohnehin trägt.
    expect(read(DATA_ENTRY_PAGE)).not.toContain('NextIntlClientProvider')
  })
})

describe('B24 — Verlinkung und Abgrenzung', () => {
  it('verlinkt die Dateneingabe-Kachel auf der Detailseite', () => {
    const source = read(DETAIL_PAGE)
    expect(source).toContain('projectDataEntryHref')
    // Kein getippter Pfad daneben — sonst zeigt die Kachel beim nächsten Umbenennen ins Leere.
    expect(source).not.toContain("'/admin/kalkulator-projekte/")
  })

  it('lässt die Report-Kachel ein Platzhalter', () => {
    const source = read(DETAIL_PAGE)
    const report = source.slice(source.indexOf('id="report"'))
    expect(report).toContain('Platzhalter')
    expect(report).not.toContain('href')
  })

  it('⚠ fasst die Kundenroute NICHT an — sie bedient weiterhin den Kunden-Zugang', () => {
    const source = read(CUSTOMER_PAGE)
    expect(source).toContain('getCalculatorAccess')
    expect(source).toContain('readMyProject')
    expect(source).not.toContain('isCurrentUserAdmin')
    expect(source).not.toContain('readAdminProject')
  })
})
