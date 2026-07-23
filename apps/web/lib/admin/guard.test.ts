import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Die Zugangsschranke des Admin-Bereichs (`lib/admin/guard.ts`).
 *
 * ── DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST ─────────────────────────────────────────────
 * `route-protection.test.ts` (B17) prüft die ABLAGE — wo die Schranke steht und wo nicht. Wohin sie
 * einen abgemeldeten Besucher SCHICKT, sagt die Ablage nicht. Und genau dort sass der Fehler: die
 * Umleitung ging auf die Kunden-Anmeldung `/anmelden`, ohne Rücksprungziel. Der Besucher meldete
 * sich korrekt an und landete auf `/konto` — er kam also an, nur nicht dort, wo er hinwollte. Kein
 * Test und kein Build konnten das sehen: beide Wege funktionieren, nur einer führt ans Ziel.
 *
 * Ebenso wichtig ist der Fall, der sich NICHT ändern durfte: eine bestehende Sitzung ohne
 * Admin-Rolle wird weiterhin NICHT umgeleitet. Eine Umleitung wäre dort eine Auskunft — sie
 * unterschiede „kenne ich nicht" von „darfst du nicht", und die neutrale „Kein Zugriff"-Seite
 * existiert, damit genau dieser Unterschied nicht beobachtbar ist.
 *
 * Ersetzt sind nur die Aussenkanten (Supabase-Client, Anfrage-Kopfzeilen, `redirect`). Die geprüfte
 * Logik — Sanierung des Ziels, Wahl des Eingangs, Fail-closed bei Lesefehler — läuft echt.
 */

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))

const getUser = vi.fn()
const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}))

/** Die Kopfzeile, die die Middleware setzt. */
let requestPathname: string | null = null
vi.mock('next/headers', () => ({
  headers: async () => new Headers(requestPathname ? { 'x-admin-pathname': requestPathname } : {}),
}))

/**
 * `redirect` wirft in Next NEXT_REDIRECT und ist als `never` typisiert. Hier ebenso — ein Test, in
 * dem die Funktion nach der Umleitung weiterliefe, prüfte einen Ablauf, den es nicht gibt.
 */
class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super(`NEXT_REDIRECT ${target}`)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw new RedirectSignal(target)
  },
}))

const { isCurrentUserAdmin } = await import('./guard')

/** Führt die Schranke aus und liefert entweder das Umleitungsziel oder das Ergebnis. */
async function run(): Promise<{ redirectedTo?: string; result?: boolean }> {
  try {
    return { result: await isCurrentUserAdmin() }
  } catch (error) {
    if (error instanceof RedirectSignal) return { redirectedTo: error.target }
    throw error
  }
}

beforeEach(() => {
  getUser.mockReset()
  rpc.mockReset()
  requestPathname = null
})

describe('ohne Sitzung — Umleitung auf den Admin-Eingang', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: null } })
  })

  it('schickt auf den Admin-Eingang, NICHT auf die Kunden-Anmeldung', async () => {
    requestPathname = '/admin/leads'
    const { redirectedTo } = await run()

    expect(redirectedTo).toBe('/admin/anmelden?next=%2Fadmin%2Fleads')
    // Der eigentliche Fehler: das Ziel war die Kunden-Anmeldung, und nach dem Login ging es
    // deshalb auf /konto statt auf die angeforderte Admin-Seite.
    expect(redirectedTo?.startsWith('/anmelden')).toBe(false)
    expect(redirectedTo?.startsWith('/admin/anmelden')).toBe(true)
  })

  it('nimmt den Query-Teil der angeforderten Seite mit', async () => {
    // Die Lead-Liste trägt ihre Filter in der URL. Ohne den Query-Teil landete ein Admin nach der
    // Anmeldung auf einer ungefilterten Liste und hielte sie für die gefilterte.
    requestPathname = '/admin/leads?status=new&branche=handel'
    const { redirectedTo } = await run()

    expect(redirectedTo).toBe('/admin/anmelden?next=%2Fadmin%2Fleads%3Fstatus%3Dnew%26branche%3Dhandel')
  })

  it('lässt den Parameter weg, wenn das Ziel ohnehin die Übersicht ist', async () => {
    requestPathname = '/admin'
    expect((await run()).redirectedTo).toBe('/admin/anmelden')
  })

  it('kommt ohne Kopfzeile auf die Übersicht zurück, statt zu scheitern', async () => {
    // Fehlt die Kopfzeile (Middleware nicht gelaufen), ist die Umleitung immer noch richtig — nur
    // ohne Rücksprungziel. Ein Fehler wäre hier die schlechtere Antwort.
    requestPathname = null
    expect((await run()).redirectedTo).toBe('/admin/anmelden')
  })

  it('verwirft ein untergeschobenes Ziel ausserhalb des Admin-Bereichs', async () => {
    for (const spoofed of ['//evil.example/admin', 'https://evil.example', '/konto', '/admin-fremd']) {
      requestPathname = spoofed
      expect((await run()).redirectedTo, spoofed).toBe('/admin/anmelden')
    }
  })

  it('macht den Eingang nicht zu seinem eigenen Ziel', async () => {
    requestPathname = '/admin/anmelden'
    expect((await run()).redirectedTo).toBe('/admin/anmelden')
  })

  it('fragt die Rolle gar nicht erst ab', async () => {
    requestPathname = '/admin/leads'
    await run()
    expect(rpc).not.toHaveBeenCalled()
  })
})

/*
 * ⚠ DIE EINE LÜCKE, DIE DIE TESTS OBEN NICHT SCHLIESSEN KÖNNEN.
 *
 * Ohne die Kopfzeile verhält sich die Schranke weiterhin korrekt — nur eben ohne Rücksprungziel
 * (der Test „kommt ohne Kopfzeile auf die Übersicht zurück" hält genau das fest). Fiele die Zeile
 * aus der Middleware, wäre der Fehler damit UNSICHTBAR: jeder Test bliebe grün, jede Umleitung ginge
 * weiter auf den richtigen Eingang, und nur das Ziel wäre stillschweigend wieder verloren — also
 * exakt der Defekt, den dieser Schritt behebt. Deshalb wird der Erzeuger der Kopfzeile im Quelltext
 * geprüft, nicht nur ihr Verbraucher.
 */
describe('die Kopfzeile hat einen Erzeuger', () => {
  it('wird in der Middleware gesetzt', () => {
    const middleware = fs.readFileSync(
      path.resolve(import.meta.dirname, '..', '..', 'middleware.ts'),
      'utf8',
    )
    expect(middleware).toContain('ADMIN_PATHNAME_HEADER')
    expect(middleware).toMatch(/headers\.set\(ADMIN_PATHNAME_HEADER/)
  })
})

describe('mit Sitzung — unverändert, keine Umleitung', () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    requestPathname = '/admin/leads'
  })

  it('lässt einen Admin durch', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await run()).toEqual({ result: true })
  })

  it('leitet ein Konto OHNE Admin-Rolle NICHT um — es bekommt die neutrale Seite', async () => {
    rpc.mockResolvedValue({ data: false, error: null })

    const outcome = await run()

    expect(outcome).toEqual({ result: false })
    expect(outcome.redirectedTo).toBeUndefined()
  })

  it('gilt bei einem Lesefehler als „kein Zugang", ohne umzuleiten (fail closed)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await run()).toEqual({ result: false })
  })
})
