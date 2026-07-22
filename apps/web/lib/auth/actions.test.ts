import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B10-5 — die Registrierung schreibt einen Lead (`signUpAction` in `lib/auth/actions.ts`).
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * Das DB-Gate beweist, was `public.capture_lead` tut (Zusammenführung, Herkunft, keine
 * Einwilligung). Was es nicht beweisen kann, ist das Verhalten der ANWENDUNG davor — und dort
 * sitzen genau die Fehler, die nichts kaputt aussehen lassen:
 *
 *   (1) Entsteht der Lead auch dann, wenn die Person die Bestätigungsmail nie öffnet? Er muss
 *       NACH `signUp` und VOR jeder Bestätigung entstehen — die Abbrecher sind der Zielfall.
 *   (2) Bringt ein Datenbankfehler die Registrierung zum Scheitern? Das darf er nie: die Person
 *       versuchte es erneut und bekäme „Adresse bereits vergeben".
 *   (3) Landet die richtige HERKUNFT im Bestand — abhängig vom Rücksprungziel?
 *   (4) Wird ein manipuliertes Ziel abgewiesen (kein Open Redirect über den Bestätigungslink)?
 *   (5) Entsteht bei ungültiger Eingabe wirklich NICHTS — weder Konto noch Lead?
 *
 * Ersetzt sind nur die Aussenkanten (Supabase-Client, Datenbank-Rand, Callback-URL). Die geprüfte
 * Logik — Prüfung, Sanierung des Ziels, Herkunftsableitung, Fehlertoleranz — läuft ECHT.
 */

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))

const signUp = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { signUp } }),
}))

/**
 * Der EINE Datenbank-Rand des Lead-Pfads. Ihn zu ersetzen (statt `capture-registration.ts`) ist
 * Absicht: so laufen die Fehlertoleranz und die Herkunftsableitung echt, und der Test sieht genau
 * die Argumente, die auch der Wrapper sähe.
 */
const captureLead = vi.fn()
vi.mock('@/lib/leads/store', () => ({
  captureLead: (input: unknown) => captureLead(input),
}))

const callbackUrl = vi.fn(async (next: string) => `https://coolin.at/auth/callback?next=${next}`)
vi.mock('@/lib/auth/server-helpers', () => ({
  callbackUrl: (next: string) => callbackUrl(next),
  redirectToLocalized: () => {
    throw new Error('NEXT_REDIRECT (Test-Sentinel)')
  },
}))

vi.mock('next-intl/server', () => ({ getLocale: async () => 'de' }))

const { signUpAction } = await import('./actions')
const { AUTH_INITIAL_STATE } = await import('./schema')

const RECHNER = '/peak-shaving/kalkulator/rechner'

const GUELTIG = {
  email: 'chefin@elektro-muster.at',
  password: 'ein-langes-passwort',
  company: 'Elektro Muster GmbH',
  firstName: 'Anna',
  lastName: 'Gruber',
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

function run(fields: Record<string, string>) {
  return signUpAction(AUTH_INITIAL_STATE, form(fields))
}

beforeEach(() => {
  signUp.mockReset()
  captureLead.mockReset()
  callbackUrl.mockClear()
  signUp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  captureLead.mockResolvedValue({ outcome: 'lead_only', leadId: 'lead-1', consentId: null })
})

describe('signUpAction — Lead-Erfassung', () => {
  it('schreibt nach erfolgreichem signUp genau EINEN Lead, ohne Zweck', async () => {
    const state = await run(GUELTIG)

    expect(state).toEqual({ emailSent: true, email: GUELTIG.email })
    expect(captureLead).toHaveBeenCalledTimes(1)
    expect(captureLead).toHaveBeenCalledWith({
      email: GUELTIG.email,
      sourceKey: 'registrierung',
      // Ohne Zweck entsteht KEINE Einwilligungszeile — Rechtsgrundlage ist Vertragsanbahnung.
      purpose: null,
      company: GUELTIG.company,
      firstName: GUELTIG.firstName,
      lastName: GUELTIG.lastName,
      locale: 'de',
    })
  })

  it('erfasst den Lead VOR der Bestätigung — die Mail ist erst unterwegs', async () => {
    /*
     * Der Zielfall des ganzen Bauabschnitts: Der Zustand nach dieser Action ist „Bestätigungsmail
     * verschickt, Konto unbestätigt". Der Lead muss zu diesem Zeitpunkt bereits stehen — sonst
     * hinterliesse jeder Abbrecher nur eine Adresse ohne Kontext.
     */
    const state = await run(GUELTIG)

    expect(state.emailSent).toBe(true)
    expect(signUp).toHaveBeenCalledTimes(1)
    expect(captureLead).toHaveBeenCalledTimes(1)
    // Reihenfolge: erst das Konto, dann der Lead. Andersherum entstünde ein Lead zu einer
    // Registrierung, die es nicht gibt.
    expect(signUp.mock.invocationCallOrder[0]).toBeLessThan(
      captureLead.mock.invocationCallOrder[0]!,
    )
  })

  it('schliesst die Registrierung auch dann erfolgreich ab, wenn der Lead-Schreibweg fehlschlägt', async () => {
    captureLead.mockRejectedValue(new Error('Datenbank nicht erreichbar'))
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {})

    const state = await run(GUELTIG)

    // Ein verlorenes Konto wiegt schwerer als ein verlorener Bestandseintrag.
    expect(state).toEqual({ emailSent: true, email: GUELTIG.email })
    expect(fehler).toHaveBeenCalledTimes(1)
    // Die Adresse gehört NICHT ins Log — ein Fehlerlog ist kein zweiter Speicherort für
    // Personenbezug.
    expect(JSON.stringify(fehler.mock.calls[0])).not.toContain(GUELTIG.email)
    fehler.mockRestore()
  })
})

describe('signUpAction — Herkunft aus dem Rücksprungziel', () => {
  it('vergibt die Kalkulator-Herkunft, wenn das Ziel im Kalkulator-Bereich liegt', async () => {
    await run({ ...GUELTIG, next: RECHNER })

    expect(captureLead.mock.calls[0]?.[0]).toMatchObject({
      sourceKey: 'kalkulator-registrierung',
    })
    // Und der Bestätigungslink führt dorthin zurück, statt auf `/konto` zu enden.
    expect(callbackUrl).toHaveBeenCalledWith(RECHNER)
  })

  it('vergibt die allgemeine Herkunft ohne Ziel (Monitor-Weg) und führt auf /konto', async () => {
    await run(GUELTIG)

    expect(captureLead.mock.calls[0]?.[0]).toMatchObject({ sourceKey: 'registrierung' })
    expect(callbackUrl).toHaveBeenCalledWith('/konto')
  })

  it('weist ein manipuliertes Ziel ab: keine fremde Weiterleitung, allgemeine Herkunft', async () => {
    /*
     * Das versteckte Feld ist im Browser frei änderbar. Ohne Prüfung wäre der BESTÄTIGUNGSLINK ein
     * Open Redirect — er käme aus einer echten Mail von uns und führte auf eine fremde Seite.
     * Geprüft wird beides: kein fremdes Ziel im Callback UND keine erschlichene Kalkulator-Herkunft.
     */
    for (const boese of [
      'https://boese.example/peak-shaving/kalkulator',
      '//boese.example/peak-shaving/kalkulator',
      'javascript:alert(1)',
    ]) {
      captureLead.mockClear()
      callbackUrl.mockClear()

      await run({ ...GUELTIG, next: boese })

      expect(callbackUrl, boese).toHaveBeenCalledWith('/konto')
      expect(captureLead.mock.calls[0]?.[0], boese).toMatchObject({ sourceKey: 'registrierung' })
    }
  })
})

describe('signUpAction — Pflichtfelder', () => {
  it.each(['company', 'firstName', 'lastName'] as const)(
    'ohne %s entsteht weder Konto noch Lead',
    async (feld) => {
      const state = await run({ ...GUELTIG, [feld]: '   ' })

      expect(state.fieldErrors?.[feld]).toBeTruthy()
      expect(signUp).not.toHaveBeenCalled()
      expect(captureLead).not.toHaveBeenCalled()
    },
  )

  it('gibt die bereits getippten Angaben zurück, aber nie das Passwort', async () => {
    const state = await run({ ...GUELTIG, email: 'keine-adresse' })

    expect(state.fieldErrors?.email).toBe('emailInvalid')
    expect(state.company).toBe(GUELTIG.company)
    expect(state.firstName).toBe(GUELTIG.firstName)
    expect(state.lastName).toBe(GUELTIG.lastName)
    expect(JSON.stringify(state)).not.toContain(GUELTIG.password)
  })

  it('schreibt keinen Lead, wenn die Registrierung selbst fehlschlägt', async () => {
    signUp.mockResolvedValue({ data: null, error: { message: 'weak password', status: 422 } })

    const state = await run(GUELTIG)

    expect(state.formError).toBeTruthy()
    expect(captureLead).not.toHaveBeenCalled()
  })
})
