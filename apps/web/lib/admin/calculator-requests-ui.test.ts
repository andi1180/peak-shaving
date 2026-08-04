import { describe, expect, it } from 'vitest'

import { ADMIN_NAV_ITEMS } from './nav'
import { ADMIN_HREF } from './config'
import {
  CALCULATOR_REQUESTS_HREF,
  CALCULATOR_REQUEST_DETAIL_HREF,
  CALCULATOR_REQUEST_STATUSES,
  CALCULATOR_REQUEST_STATUS_LABEL,
} from './calculator-requests'
import { calculatorApprovalNotificationNote } from '@/lib/partner-portal/notify-messages'
import type { CalculatorRequestNotificationOutcome } from '@/lib/partner-portal/calculator-request-notify'

/**
 * B18-4 (Oberfläche) — die Eigenschaften des Prüf-Eingangs, die ohne Renderer prüfbar sind.
 *
 * Der wichtigste Test dieser Datei ist die PRÄFIX-PROBE der Navigation: `AdminNav` markiert einen
 * Punkt als aktiv, sobald der Pfad mit ihm beginnt. Wäre der neue Punkt ein Unterpfad eines
 * bestehenden (oder umgekehrt), stünden zwei Punkte gleichzeitig aktiv und niemand wüsste, wo er
 * ist — ein Fehler, den kein Build und kein Typecheck sieht, weil beide Seiten funktionieren.
 */

const ALL_STATUSES: CalculatorRequestNotificationOutcome['status'][] = [
  'sent',
  'unknown_partner',
  'no_account',
  'send_failed',
  'not_recorded',
]

describe('B18-4 — Adressen des Prüf-Eingangs', () => {
  it('ist ein Geschwisterpfad und liegt unterhalb von /admin', () => {
    expect(CALCULATOR_REQUESTS_HREF).toBe('/admin/kalkulator-anfragen')
    expect(CALCULATOR_REQUESTS_HREF.startsWith(`${ADMIN_HREF}/`)).toBe(true)
  })

  it('bildet die Detailadresse aus der Kennung', () => {
    expect(CALCULATOR_REQUEST_DETAIL_HREF('abc-123')).toBe('/admin/kalkulator-anfragen/abc-123')
  })
})

describe('B18-4 — Navigation', () => {
  it('führt den neuen Bereich genau einmal', () => {
    const treffer = ADMIN_NAV_ITEMS.filter((item) => item.href === CALCULATOR_REQUESTS_HREF)
    expect(treffer).toHaveLength(1)
    expect(treffer[0]?.label).toBe('Kalkulator-Anfragen')
  })

  it('⚠ kein Punkt ist Präfix eines anderen — sonst wären zwei gleichzeitig aktiv', () => {
    /*
     * `/admin` selbst ist ausgenommen: `AdminNav` vergleicht die Übersicht EXAKT, genau weil sie
     * Präfix von allem ist. Für alle übrigen Punkte gilt die Präfix-Regel, und sie muss disjunkt
     * sein.
     */
    const bereiche = ADMIN_NAV_ITEMS.map((item) => item.href).filter((href) => href !== ADMIN_HREF)

    for (const a of bereiche) {
      for (const b of bereiche) {
        if (a === b) continue
        expect(b.startsWith(`${a}/`), `${b} liegt unter ${a}`).toBe(false)
      }
    }
  })
})

describe('B18-4 — Statusbeschriftungen', () => {
  it('beschriftet jeden Zustand des Enums', () => {
    for (const status of CALCULATOR_REQUEST_STATUSES) {
      expect(CALCULATOR_REQUEST_STATUS_LABEL[status]).toBeTruthy()
    }
    expect(Object.keys(CALCULATOR_REQUEST_STATUS_LABEL)).toHaveLength(
      CALCULATOR_REQUEST_STATUSES.length,
    )
  })
})

describe('B18-4 — Meldung zur Benachrichtigung nach einer Freigabe', () => {
  it('gibt zu jedem der fünf Zustände einen eigenen Satz', () => {
    const saetze = ALL_STATUSES.map(calculatorApprovalNotificationNote)
    expect(saetze.every((s) => s.length > 0)).toBe(true)
    expect(new Set(saetze).size).toBe(ALL_STATUSES.length)
  })

  it('⚠ relativiert bei einem Mailproblem NIE den vergebenen Zugang', () => {
    // Der Zugang steht in jedem dieser Fälle — sonst versucht der Admin die Freigabe erneut, und
    // die antwortet `already_reviewed`, was wie ein zweiter Fehler aussieht.
    for (const status of ['send_failed', 'not_recorded', 'no_account', 'unknown_partner'] as const) {
      expect(calculatorApprovalNotificationNote(status)).toMatch(/Zugang( selbst)? (steht|ist)/)
    }
  })

  it('⚠ rät bei „versendet, nicht vermerkt" ausdrücklich vom Nachfassen ab', () => {
    // Der eine Zustand, dessen Verwechslung real Schaden anrichtet: die Mail IST raus.
    expect(calculatorApprovalNotificationNote('not_recorded')).toMatch(/NICHT von Hand nachfassen/)
    expect(calculatorApprovalNotificationNote('send_failed')).toMatch(/anderen Weg informieren/)
  })
})
