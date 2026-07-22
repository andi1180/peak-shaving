import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B10-2 — die Zugangsentscheidung des Pro-Kalkulators (`lib/kalkulator/access.ts`).
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * Das DB-Gate (B10-1) beweist bereits, dass `get_my_entitlement`/`platform.has_entitlement` mit
 * `calculator_pro` korrekt antworten und die Produkte isoliert sind. Was es NICHT beweisen kann,
 * ist das Verhalten der ANWENDUNG davor — und genau dort sitzen die Fehler, die eine
 * Privilegiengrenze aufmachen, ohne dass etwas kaputt aussieht:
 *
 *   (1) Wird der Wrapper überhaupt mit `calculator_pro` gefragt — und nicht mit `monitor`?
 *       Ein vertauschtes Argument fiele NIRGENDS auf: der Zugang funktionierte, nur bekämen ihn
 *       die falschen Leute (jeder Monitor-Abonnent) und die richtigen nicht.
 *   (2) Wird ohne Sitzung gar nicht erst gefragt?
 *   (3) Was passiert, wenn die Abfrage FEHLSCHLÄGT — Zugang oder kein Zugang?
 *   (4) Genügt „irgendein wahrer Wert" für den Zugang, oder nur ein echtes `true`?
 *
 * Der Supabase-Client ist deshalb ersetzt und zählt mit, WOMIT er gefragt wurde.
 */

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung; `@/lib/supabase/server`
// liest zusätzlich `cookies()`. Ersetzt werden nur diese beiden Aussenkanten — die geprüfte Logik
// selbst läuft echt.
vi.mock('server-only', () => ({}))

const rpc = vi.fn()
const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, auth: { getUser } }),
}))

const { CALCULATOR_PRODUCT, getCalculatorAccess } = await import('./access')

const USER = { id: 'user-1', email: 'kundin@example.at' }

beforeEach(() => {
  rpc.mockReset()
  getUser.mockReset()
  getUser.mockResolvedValue({ data: { user: USER } })
  rpc.mockResolvedValue({ data: true, error: null })
})

describe('getCalculatorAccess', () => {
  it('fragt das Entitlement für calculator_pro ab — nicht für monitor', async () => {
    await getCalculatorAccess()

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_my_entitlement', { p_product: 'calculator_pro' })
    // Der exportierte Schlüssel ist derselbe Wert — sonst könnte die Kontoseite (die ihn
    // importiert) ein anderes Produkt anzeigen, als die Route prüft.
    expect(CALCULATOR_PRODUCT).toBe('calculator_pro')
  })

  it('gewährt Zugang bei aktivem Entitlement', async () => {
    await expect(getCalculatorAccess()).resolves.toEqual({ state: 'granted' })
  })

  it('verweigert Zugang ohne Entitlement und nennt die angemeldete Adresse', async () => {
    rpc.mockResolvedValue({ data: false, error: null })

    await expect(getCalculatorAccess()).resolves.toEqual({
      state: 'no_entitlement',
      email: 'kundin@example.at',
    })
  })

  it('ohne Sitzung ist der Zustand anonymous — und die Datenbank wird nicht befragt', async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    await expect(getCalculatorAccess()).resolves.toEqual({ state: 'anonymous' })
    // Ohne Sitzung gibt es niemanden, nach dessen Entitlement man fragen könnte. Ein trotzdem
    // abgesetzter RPC wäre kein Sicherheitsloch, aber ein Aufruf pro anonymem Seitenaufruf.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fail closed: ein Fehler beim Lesen gewährt KEINEN Zugang', async () => {
    // Der wichtigste Test der Datei. Ein `catch`, das im Zweifel durchlässt, wäre an einem guten
    // Tag unsichtbar und an einem schlechten der Grund, warum der Rechner offen im Netz stand.
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(getCalculatorAccess()).resolves.toEqual({
      state: 'no_entitlement',
      email: 'kundin@example.at',
    })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['die Zeichenkette "true"', 'true'],
    ['die Zahl 1', 1],
  ])('gewährt keinen Zugang, wenn die Antwort %s ist', async (_label, value) => {
    // `'true'` und `1` sind truthy: eine lose Prüfung (`if (data)`) öffnete den Zugang. Deshalb
    // steht im Modul `data === true` — dieser Test ist der Wächter davor, dass jemand das
    // „vereinfacht".
    rpc.mockResolvedValue({ data: value, error: null })

    await expect(getCalculatorAccess()).resolves.toMatchObject({ state: 'no_entitlement' })
  })
})
