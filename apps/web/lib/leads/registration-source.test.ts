/**
 * B10-5 — die Herkunftsableitung aus dem Rücksprungziel (`lib/leads/registration-source.ts`).
 *
 * ── WAS SICH NUR HIER PRÜFEN LÄSST ──────────────────────────────────────────────────────────────
 * Das DB-Gate beweist, dass beide Herkünfte existieren und dass darunter ein Lead entstehen kann.
 * Was es nicht beweisen kann, ist die ENTSCHEIDUNG davor — und die ist der ganze Unterschied
 * zwischen einer brauchbaren und einer stillschweigend falschen Kanal-Auswertung:
 *
 *   (1) Wird ein Kalkulator-Ziel auch dann erkannt, wenn eine Query daranhängt?
 *   (2) Wird ein NUR ÄHNLICHER Pfad (`/peak-shaving/kalkulator-fremd`) fälschlich mitgezählt?
 *   (3) Fällt „kein Ziel" sauber auf die allgemeine Herkunft zurück — statt auf einen Ersatzwert?
 *
 * Ein Fehler in (1) oder (2) schlägt NIRGENDS fehl: der Lead entsteht, nur unter der falschen
 * Herkunft. Genau davor warnt der Kopf des DB-Gates zur Registry.
 */

import { describe, expect, it } from 'vitest'

import { sanitizeNext } from '../auth/config'
import { CALCULATOR_RUN_HREF } from '../nav'
import {
  CALCULATOR_AREA_PREFIX,
  LEAD_SOURCE_KALKULATOR_REGISTRIERUNG,
  LEAD_SOURCE_REGISTRIERUNG,
  leadSourceForRegistration,
} from './registration-source'

describe('leadSourceForRegistration', () => {
  it('erkennt die geschützte Rechner-Route', () => {
    expect(leadSourceForRegistration(CALCULATOR_RUN_HREF)).toBe(
      LEAD_SOURCE_KALKULATOR_REGISTRIERUNG,
    )
  })

  it('erkennt den Bereich selbst und tiefere Pfade darunter', () => {
    for (const next of [
      CALCULATOR_AREA_PREFIX,
      `${CALCULATOR_AREA_PREFIX}/rechner`,
      `${CALCULATOR_AREA_PREFIX}/rechner/irgendwas`,
    ]) {
      expect(leadSourceForRegistration(next), next).toBe(LEAD_SOURCE_KALKULATOR_REGISTRIERUNG)
    }
  })

  it('ignoriert Query und Fragment beim Vergleich', () => {
    // Sonst zählte derselbe Klick je nach angehängtem Parameter unterschiedlich.
    for (const next of [
      `${CALCULATOR_RUN_HREF}?von=mail`,
      `${CALCULATOR_RUN_HREF}#abschnitt`,
      `${CALCULATOR_AREA_PREFIX}?a=1`,
    ]) {
      expect(leadSourceForRegistration(next), next).toBe(LEAD_SOURCE_KALKULATOR_REGISTRIERUNG)
    }
  })

  it('zählt einen nur ÄHNLICHEN Pfad NICHT als Kalkulator-Registrierung', () => {
    // Ein reiner Präfix-Vergleich ohne Grenzprüfung träfe diese Pfade — sie sind aber andere
    // Routen, und ihre Registrierungen gehören nicht in die Kalkulator-Auswertung.
    for (const next of [
      `${CALCULATOR_AREA_PREFIX}-fremd`,
      `${CALCULATOR_AREA_PREFIX}x`,
      '/peak-shaving',
    ]) {
      expect(leadSourceForRegistration(next), next).toBe(LEAD_SOURCE_REGISTRIERUNG)
    }
  })

  it('fällt ohne Ziel und bei fremdem Ziel auf die allgemeine Herkunft zurück', () => {
    for (const next of [undefined, null, '', '/konto', '/strom-check', '/kontakt']) {
      expect(leadSourceForRegistration(next), String(next)).toBe(LEAD_SOURCE_REGISTRIERUNG)
    }
  })

  it('ein manipuliertes Ziel überlebt `sanitizeNext` nicht und wird zur allgemeinen Herkunft', () => {
    /*
     * Der Ablauf im Ernstfall: die Seite/Action sanieren ZUERST (leerer Rückfallwert), erst danach
     * läuft die Ableitung. Hier wird genau diese Verkettung geprüft — mit der echten
     * `sanitizeNext`, nicht mit einer nachgebauten Regel.
     */
    for (const roh of [
      'https://boese.example/peak-shaving/kalkulator',
      '//boese.example/peak-shaving/kalkulator',
      'peak-shaving/kalkulator',
      'javascript:alert(1)',
    ]) {
      const saniert = sanitizeNext(roh, '')
      expect(saniert, roh).toBe('')
      expect(leadSourceForRegistration(saniert), roh).toBe(LEAD_SOURCE_REGISTRIERUNG)
    }
  })
})
