import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B10-4 — die Gutscheincode-Einlösung mit Rücksprungziel (`lib/redemption/actions.ts`).
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * Das DB-Gate beweist, was `public.redeem_code` tut (welcher Code welches Produkt freischaltet, wie
 * oft, für wen). Was es nicht beweisen kann, ist das Verhalten der ANWENDUNG davor — und mit B10-4
 * ist dort eine neue, angreifbare Eingabe dazugekommen: ein Weiterleitungsziel in einem versteckten
 * Formularfeld.
 *
 *   (1) Führt ein FREMDES Ziel zu einer Weiterleitung? (Open Redirect — der Nutzer löst bei uns
 *       ein und landet auf einer Seite, die er für unsere hält.)
 *   (2) Leitet auch ein ABGELEHNTER Code weiter? (Dann führte ein erratener Code in den Rechner,
 *       ohne etwas freigeschaltet zu haben — die Route hielte zwar dagegen, aber die Aussage
 *       „eingelöst" wäre falsch.)
 *   (3) Bleibt `/konto` unverändert? Das Formular hat dort KEIN Ziel; ein versehentlicher
 *       Vorgabewert schickte die Kontoseite nach jedem Einlösen auf sich selbst um und verschluckte
 *       die Bestätigung.
 *
 * Der Supabase-Client ist ersetzt und zählt mit, ob er überhaupt gefragt wurde. `sanitizeNext`
 * (`lib/auth/config.ts`) läuft ECHT — es ist die Prüfung, um die es hier geht.
 */

const rpc = vi.fn()
const getUser = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, auth: { getUser } }),
}))

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: () => revalidatePath() }))

vi.mock('next-intl/server', () => ({ getLocale: async () => 'de' }))
vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href }: { href: string }) => href,
}))

/**
 * `redirectToLocalized` WIRFT in der echten Anwendung (NEXT_REDIRECT) — der Mock tut dasselbe.
 * Ein Mock, der brav zurückkehrt, liesse einen Fehler durchgehen, den es in Produktion gibt: dass
 * die Action nach der Weiterleitung weiterläuft.
 */
const REDIRECTED = new Error('NEXT_REDIRECT (Test-Sentinel)')
const redirectToLocalized = vi.fn((_href: string, _locale: string): never => {
  throw REDIRECTED
})
vi.mock('@/lib/auth/server-helpers', () => ({
  redirectToLocalized: (href: string, locale: string) => redirectToLocalized(href, locale),
}))

const { redeemCodeAction } = await import('./actions')
const { REDEEM_INITIAL_STATE } = await import('./schema')

const RECHNER = '/peak-shaving/kalkulator/rechner'
const USER = { id: 'user-1', email: 'partnerin@example.at' }

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function run(fields: Record<string, string>) {
  return redeemCodeAction(REDEEM_INITIAL_STATE, form(fields))
}

beforeEach(() => {
  rpc.mockReset()
  getUser.mockReset()
  revalidatePath.mockReset()
  redirectToLocalized.mockClear()
  getUser.mockResolvedValue({ data: { user: USER } })
  rpc.mockResolvedValue({ data: 'redeemed', error: null })
})

describe('redeemCodeAction — Rücksprungziel', () => {
  it('ohne Ziel: keine Weiterleitung, Bestätigungszustand — das unveränderte /konto-Verhalten', async () => {
    // Der Regressions-Wächter. Auf `/konto` gibt es kein verstecktes Feld; kommt hier je eine
    // Weiterleitung heraus, ist die Bestätigung „Ihr Code wurde eingelöst" dort verschwunden.
    await expect(run({ code: 'PARTNER-2026' })).resolves.toEqual({ status: 'redeemed' })
    expect(redirectToLocalized).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('mit seiten-internem Ziel: leitet dorthin weiter — und läuft danach NICHT weiter', async () => {
    await expect(run({ code: 'PARTNER-2026', next: RECHNER })).rejects.toBe(REDIRECTED)
    expect(redirectToLocalized).toHaveBeenCalledWith(RECHNER, 'de')
  })

  it('revalidiert /konto AUCH im Weiterleitungsfall', async () => {
    // Sonst zeigte ein späterer Aufruf von /konto aus dem Router-Cache weiter „Nicht
    // freigeschaltet" für ein Produkt, das gerade freigeschaltet wurde.
    await expect(run({ code: 'PARTNER-2026', next: RECHNER })).rejects.toBe(REDIRECTED)
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['eine fremde Domain', 'https://boese.example/phishing'],
    ['ein protokollrelatives Ziel', '//boese.example/phishing'],
    ['einen relativen Pfad ohne führenden Slash', 'boese.example'],
  ])('kein Open Redirect: %s wird verworfen', async (_label, target) => {
    // Der wichtigste Test der Datei. Das Feld steht im Browser und ist dort frei änderbar — die
    // Prüfung, die zählt, ist die in der Action. Verworfen heisst hier: GAR KEINE Weiterleitung,
    // nicht „ersatzweise nach /konto" (das wäre auf der Kontoseite eine Umleitung auf sich selbst).
    await expect(run({ code: 'PARTNER-2026', next: target })).resolves.toEqual({
      status: 'redeemed',
    })
    expect(redirectToLocalized).not.toHaveBeenCalled()
  })

  it.each(['invalid_code', 'expired', 'exhausted', 'already_redeemed', 'already_active'])(
    'leitet bei „%s" NICHT weiter und behält die Eingabe',
    async (status) => {
      rpc.mockResolvedValue({ data: status, error: null })

      await expect(run({ code: ' partner-2026 ', next: RECHNER })).resolves.toEqual({
        status,
        code: 'partner-2026',
      })
      expect(redirectToLocalized).not.toHaveBeenCalled()
      expect(revalidatePath).not.toHaveBeenCalled()
    },
  )
})

describe('redeemCodeAction — Sitzung und Fehlschläge', () => {
  it('ohne Sitzung: kein RPC, keine Weiterleitung', async () => {
    // Die Route ist ohnehin sitzungsgeschützt — die Action verlässt sich darauf aber NICHT.
    // Zwischen Seitenaufbau und Absenden kann eine Sitzung ablaufen, und ein Einlösen ohne
    // `auth.uid()` hätte kein Konto, dem es etwas gutschreiben könnte.
    getUser.mockResolvedValue({ data: { user: null } })

    await expect(run({ code: 'PARTNER-2026', next: RECHNER })).resolves.toEqual({
      formError: 'notSignedIn',
      code: 'PARTNER-2026',
    })
    expect(rpc).not.toHaveBeenCalled()
    expect(redirectToLocalized).not.toHaveBeenCalled()
  })

  it('leerer Code: Feldfehler, kein RPC, keine Weiterleitung', async () => {
    const result = await run({ code: '   ', next: RECHNER })

    expect(result.fieldErrors).toEqual({ code: 'codeRequired' })
    expect(rpc).not.toHaveBeenCalled()
    expect(redirectToLocalized).not.toHaveBeenCalled()
  })

  it('Infrastrukturfehler: generischer Fehler statt Weiterleitung', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(run({ code: 'PARTNER-2026', next: RECHNER })).resolves.toEqual({
      formError: 'generic',
      code: 'PARTNER-2026',
    })
    expect(redirectToLocalized).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('unbekannter Status: keine Weiterleitung auf einen rohen DB-String hin', async () => {
    rpc.mockResolvedValue({ data: 'irgendwas_neues', error: null })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(run({ code: 'PARTNER-2026', next: RECHNER })).resolves.toEqual({
      formError: 'generic',
      code: 'PARTNER-2026',
    })
    expect(redirectToLocalized).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
