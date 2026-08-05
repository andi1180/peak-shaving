import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_ITEMS } from './nav'
import { ADMIN_HREF } from './config'
import { ADMIN_CALCULATOR_HREF } from './calculator'
import { CALCULATOR_REQUESTS_HREF } from './calculator-requests'

/**
 * B18-4 (Admin-Kalkulator) — die Eigenschaften des neuen Bereichs, die ohne Renderer prüfbar sind.
 *
 * Zwei Dinge, die weder Build noch Typecheck sehen und die beide „funktionieren", wenn sie falsch
 * sind:
 *
 *   1. DIE PRÄFIX-DISJUNKTHEIT gegenüber `/admin/kalkulator-anfragen`. `AdminNav` markiert einen
 *      Punkt als aktiv, sobald der Pfad mit ihm beginnt. Wären die beiden ein Paar aus Ober- und
 *      Unterpfad, stünden zwei Punkte gleichzeitig aktiv — beide Seiten laden trotzdem, niemand
 *      weiss nur mehr, wo er ist. Die bestehende Probe in `calculator-requests-ui.test.ts` deckt das
 *      bereits über ALLE Punkte ab; hier steht das Paar zusätzlich NAMENTLICH, weil es das einzige
 *      ist, bei dem die Adressen einander so ähnlich sehen, dass ein späterer Umbau sie zusammenlegt.
 *
 *   2. DASS DIE SEITE KEIN ENTITLEMENT PRÜFT. Das ist die bewusste Ausnahme dieses Bereichs (ein
 *      Admin ist kein Kunde seines eigenen Werkzeugs) — und ein später „zur Vereinheitlichung"
 *      hinzugefügtes `getCalculatorAccess()` wäre in keinem Test sichtbar: die Seite funktionierte
 *      weiter, nur sähe der Admin ohne `calculator_pro` plötzlich das Anfrage-Formular statt des
 *      Rechners. Quelltextprüfung, weil es eine Eigenschaft der DATEI ist und nicht des Ablaufs.
 */

const ADMIN_CALCULATOR_PAGE = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'app',
  'admin',
  '(intern)',
  'kalkulator',
  'page.tsx',
)

/** Kommentare raus, bevor der Quelltext geprüft wird — sonst wertet der Wächter das ERKLÄREN der
 *  Regel als Verstoss (die Falle aus B11, s. `route-protection.test.ts`). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('B18-4 — Adresse des Admin-Kalkulators', () => {
  it('liegt unterhalb von /admin und ist kurz', () => {
    expect(ADMIN_CALCULATOR_HREF).toBe('/admin/kalkulator')
    expect(ADMIN_CALCULATOR_HREF.startsWith(`${ADMIN_HREF}/`)).toBe(true)
  })

  it('⚠ ist KEIN Unterpfad des Prüf-Eingangs — und der Prüf-Eingang keiner von ihm', () => {
    // Beide Richtungen, weil die Aktiv-Markierung in beide Richtungen wirkt. Der kürzere Pfad ist
    // hier der gefährlichere: `/admin/kalkulator/anfragen` hätte den Prüf-Eingang geschluckt.
    expect(
      CALCULATOR_REQUESTS_HREF.startsWith(`${ADMIN_CALCULATOR_HREF}/`),
      `${CALCULATOR_REQUESTS_HREF} liegt unter ${ADMIN_CALCULATOR_HREF}`,
    ).toBe(false)
    expect(
      ADMIN_CALCULATOR_HREF.startsWith(`${CALCULATOR_REQUESTS_HREF}/`),
      `${ADMIN_CALCULATOR_HREF} liegt unter ${CALCULATOR_REQUESTS_HREF}`,
    ).toBe(false)
    // Und sie sind nicht versehentlich dieselbe Adresse.
    expect(ADMIN_CALCULATOR_HREF).not.toBe(CALCULATOR_REQUESTS_HREF)
  })
})

describe('B18-4 — Navigation', () => {
  it('führt den Bereich genau einmal, mit dem Label „Kalkulator"', () => {
    const treffer = ADMIN_NAV_ITEMS.filter((item) => item.href === ADMIN_CALCULATOR_HREF)
    expect(treffer).toHaveLength(1)
    expect(treffer[0]?.label).toBe('Kalkulator')
  })

  it('führt beide Kalkulator-Punkte nebeneinander, mit verschiedenen Beschriftungen', () => {
    const labels = ADMIN_NAV_ITEMS.filter(
      (item) => item.href === ADMIN_CALCULATOR_HREF || item.href === CALCULATOR_REQUESTS_HREF,
    ).map((item) => item.label)
    expect(labels).toHaveLength(2)
    expect(new Set(labels).size).toBe(2)
  })
})

describe('B18-4 — die Seite prüft ausschliesslich die Adminrolle', () => {
  const source = stripComments(fs.readFileSync(ADMIN_CALCULATOR_PAGE, 'utf8'))

  it('ruft isCurrentUserAdmin auf', () => {
    expect(source).toContain('isCurrentUserAdmin')
  })

  it('⚠ liest KEIN Entitlement — kein getCalculatorAccess, kein calculator_pro', () => {
    // Die bewusste Ausnahme dieses Bereichs. Ein hier ergänzter Aufruf wäre die „Vereinheitlichung",
    // die dem Admin ausgerechnet dann das Anfrage-Formular zeigt, wenn er eine Anfrage prüfen will.
    expect(source).not.toContain('getCalculatorAccess')
    expect(source).not.toContain('calculator_pro')
    expect(source).not.toContain('get_my_entitlement')
  })

  it('bettet den Rechner über die geteilte Konstante ein, statt eine URL zu tippen', () => {
    expect(source).toContain('EMBEDDED_CALCULATOR_SRC')
    expect(source).not.toContain('peak-shaving-website')
  })
})
