/**
 * Der Kontext einer Anmeldung aus dem Rücksprungziel (`lib/auth/login-context.ts`).
 *
 * ── WAS SICH NUR HIER PRÜFEN LÄSST ──────────────────────────────────────────────────────────────
 * Die Anmeldeseite wird von mehreren Wegen geteilt. Was ihr Wortlaut und ihr „Noch kein Konto?"-Link
 * zeigen, hängt an genau EINER Zeichenketten-Entscheidung — und deren Fehler schlagen NIRGENDS fehl:
 *
 *   (1) Wird das Portal-Ziel auch mit angehängter Query erkannt?
 *   (2) Wird ein NUR ÄHNLICHER Pfad (`/partner-portal-fremd`) fälschlich mitgezählt? Dann bekäme
 *       jemand die Partner-Beschriftung samt Verweis auf die Bewerbung, obwohl er woanders hinwollte.
 *   (3) Bleibt der KALKULATOR-Zugang unberührt? Er teilt sich dieselbe Seite, und ein zu weit
 *       gefasster Vergleich schickte einen zahlenden Interessenten auf das Partner-Formular —
 *       der Weg funktionierte weiter, nur führte er an der Registrierung vorbei.
 *   (4) Fällt „kein Ziel" und ein manipuliertes Ziel sauber auf `default` zurück?
 */

import { describe, expect, it } from 'vitest'

import { CALCULATOR_RUN_HREF } from '../nav'
import { PARTNER_BEWERBUNG_HREF } from '../partner-application/config'
import { PARTNER_PORTAL_HREF } from '../partner-portal/config'
import { KONTO_HREF, sanitizeNext } from './config'
import { loginContextForNext } from './login-context'

describe('loginContextForNext', () => {
  it('erkennt das Partner-Portal', () => {
    expect(loginContextForNext(PARTNER_PORTAL_HREF)).toBe('partner')
  })

  it('erkennt tiefere Pfade unterhalb des Portals', () => {
    // Ein künftiger Unterbereich des Portals gehört demselben Kontext an.
    for (const next of [`${PARTNER_PORTAL_HREF}/vorlagen`, `${PARTNER_PORTAL_HREF}/a/b`]) {
      expect(loginContextForNext(next), next).toBe('partner')
    }
  })

  it('ignoriert Query und Fragment beim Vergleich', () => {
    for (const next of [
      `${PARTNER_PORTAL_HREF}?von=mail`,
      `${PARTNER_PORTAL_HREF}#link`,
      `${PARTNER_PORTAL_HREF}/vorlagen?a=1`,
    ]) {
      expect(loginContextForNext(next), next).toBe('partner')
    }
  })

  it('zählt einen nur ÄHNLICHEN Pfad NICHT als Partner-Anmeldung', () => {
    // Ein reiner Präfix-Vergleich ohne Grenzprüfung träfe die ersten beiden — sie sind aber
    // andere Routen. `/partner/<slug>` ist die öffentliche Landingpage, nicht das Portal.
    for (const next of [
      `${PARTNER_PORTAL_HREF}-fremd`,
      `${PARTNER_PORTAL_HREF}x`,
      '/partner',
      '/partner/raymann',
    ]) {
      expect(loginContextForNext(next), next).toBe('default')
    }
  })

  it('behandelt die Bewerbungsseite bewusst NICHT als Partner-Kontext', () => {
    /*
     * Sonst zeigte der „Noch kein Konto?"-Verweis genau auf die Seite, von der jemand gerade
     * kommt — ein Link im Kreis. Der Partner-Kontext meint das PORTAL, nicht die Bewerbung.
     */
    expect(loginContextForNext(PARTNER_BEWERBUNG_HREF)).toBe('default')
  })

  it('lässt den Kalkulator-Zugang unverändert im allgemeinen Kontext', () => {
    /*
     * Ausdrücklich geprüft, nicht nur nicht gebaut: An diesem Weg hängt seit B10-5 die
     * Registrierung samt Herkunft des Leads (`lib/leads/registration-source.ts`). Er darf durch
     * die Partner-Unterscheidung nicht abgezweigt werden.
     */
    for (const next of [CALCULATOR_RUN_HREF, '/peak-shaving/kalkulator']) {
      expect(loginContextForNext(next), next).toBe('default')
    }
  })

  it('fällt ohne Ziel und bei fremdem Ziel auf den allgemeinen Kontext zurück', () => {
    for (const next of [undefined, null, '', KONTO_HREF, '/strom-check', '/kontakt']) {
      expect(loginContextForNext(next), String(next)).toBe('default')
    }
  })

  it('ein manipuliertes Ziel überlebt `sanitizeNext` nicht und bleibt im allgemeinen Kontext', () => {
    /*
     * Der Ablauf im Ernstfall: die Seite saniert ZUERST (Vorgabewert `/konto`), erst danach läuft
     * die Ableitung. Hier wird genau diese Verkettung geprüft — mit der echten `sanitizeNext`,
     * nicht mit einer nachgebauten Regel. Ein fremder Host mit passendem Pfad darf weder die
     * Beschriftung setzen noch als Rücksprungziel überleben.
     */
    for (const roh of [
      `https://boese.example${PARTNER_PORTAL_HREF}`,
      `//boese.example${PARTNER_PORTAL_HREF}`,
      'partner-portal',
      'javascript:alert(1)',
    ]) {
      const saniert = sanitizeNext(roh)
      expect(saniert, roh).toBe(KONTO_HREF)
      expect(loginContextForNext(saniert), roh).toBe('default')
    }
  })
})
