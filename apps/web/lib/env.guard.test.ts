import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Der Wächter über die produktionspflichtigen Umgebungsvariablen (`lib/env.guard.ts`).
 *
 * ── DIE EIGENSCHAFT, DIE HIER GEPRÜFT WIRD, IST EINE ASYMMETRIE ─────────────────────────────────
 * Derselbe fehlende Wert muss unter der Produktivdomain ABBRECHEN und überall sonst DURCHLAUFEN.
 * Beide Richtungen sind gleich wichtig, und beide fallen ohne Test nicht auf:
 *
 *   – Fehlt die strenge Richtung, ist genau der Zustand wieder da, der zu diesem Wächter geführt
 *     hat: `/partner-werden` lieferte in Produktion 0× `cf-turnstile`, monatelang, ohne dass etwas
 *     rot wurde.
 *   – Fehlt die milde Richtung, bricht die CI (die keine Produktions-Env setzt) und jede Preview.
 *     Das fiele zwar sofort auf — aber als „der Build ist kaputt", und der naheliegende Reflex wäre
 *     dann, den Wächter wieder zu entfernen.
 *
 * Geprüft wird BEIDES: die reine Bedingung (`assertProductionEnv`) und die VERDRAHTUNG, also dass
 * das Modul beim blossen Import wirft. Die Verdrahtung ist die eigentliche Wirkung — eine korrekte
 * Funktion, die niemand aufruft, wäre genau der stille Zustand von vorher.
 */

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung. Ersetzt wird nur diese
// Aussenkante; die geprüfte Logik läuft echt.
vi.mock('server-only', () => ({}))

const publicEnv = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined as string | undefined }
const serverEnv = { TURNSTILE_SECRET_KEY: undefined as string | undefined }
const site = { IS_PRODUCTION_SITE: false, PRODUCTION_ORIGIN: 'https://coolin.at' }

vi.mock('./env.public', () => ({ publicEnv }))
vi.mock('./env.server', () => ({ serverEnv }))
vi.mock('./site', () => site)

// Beim Laden dieser Zeile steht `IS_PRODUCTION_SITE` auf `false` — der Seiteneffekt des Moduls
// läuft also geräuschlos durch, und die reine Funktion ist danach direkt aufrufbar.
const { assertProductionEnv } = await import('./env.guard')

/** Lädt das Modul FRISCH — nur so läuft der Seiteneffekt beim Import erneut. */
async function importGuard() {
  vi.resetModules()
  return import('./env.guard')
}

beforeEach(() => {
  publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY = undefined
  serverEnv.TURNSTILE_SECRET_KEY = undefined
  site.IS_PRODUCTION_SITE = false
})

describe('assertProductionEnv', () => {
  it('lässt einen Nicht-Produktions-Build ohne beide Werte durch', () => {
    expect(() => assertProductionEnv(false, undefined, undefined)).not.toThrow()
  })

  it('bricht unter der Produktivdomain ab und nennt BEIDE fehlenden Werte', () => {
    expect(() => assertProductionEnv(true, undefined, undefined)).toThrow(
      /NEXT_PUBLIC_TURNSTILE_SITE_KEY[\s\S]*TURNSTILE_SECRET_KEY/,
    )
    expect(() => assertProductionEnv(true, undefined, undefined)).toThrow(
      /Build\/Start abgebrochen/,
    )
  })

  it('bricht ab, wenn NUR der Widget-Key fehlt — und nennt nur diesen', () => {
    // Halb konfiguriert ist der gefährlichere Zustand als gar nicht: Die Prüfung stünde bereit,
    // das Formular erzeugte aber nie ein Token — jede Absendung liefe in die Ablehnung.
    expect(() => assertProductionEnv(true, undefined, 'secret')).toThrow(
      /NEXT_PUBLIC_TURNSTILE_SITE_KEY/,
    )
    expect(() => assertProductionEnv(true, undefined, 'secret')).not.toThrow(
      /TURNSTILE_SECRET_KEY: fehlt/,
    )
  })

  it('bricht ab, wenn NUR das Secret fehlt', () => {
    expect(() => assertProductionEnv(true, 'site-key', undefined)).toThrow(/TURNSTILE_SECRET_KEY/)
  })

  it('lässt einen Produktions-Build mit beiden Werten durch', () => {
    expect(() => assertProductionEnv(true, 'site-key', 'secret')).not.toThrow()
  })

  it('behandelt einen leeren String wie „nicht gesetzt"', () => {
    // `optionalEnv` normalisiert `FOO=` bereits zu `undefined`; der Wächter darf sich darauf nicht
    // verlassen müssen — ein leerer Widget-Key rendert genauso wenig ein Turnstile-Feld.
    expect(() => assertProductionEnv(true, '', '')).toThrow(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/)
  })
})

describe('Verdrahtung — der Import selbst ist der Wächter', () => {
  it('wirft beim blossen Import, wenn die Produktivdomain ohne Turnstile-Werte gebaut wird', async () => {
    site.IS_PRODUCTION_SITE = true
    await expect(importGuard()).rejects.toThrow(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/)
  })

  it('importiert geräuschlos, sobald beide Werte gesetzt sind', async () => {
    site.IS_PRODUCTION_SITE = true
    publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'site-key'
    serverEnv.TURNSTILE_SECRET_KEY = 'secret'
    await expect(importGuard()).resolves.toBeDefined()
  })

  it('importiert ausserhalb der Produktivdomain geräuschlos, auch ohne beide Werte', async () => {
    await expect(importGuard()).resolves.toBeDefined()
  })
})
