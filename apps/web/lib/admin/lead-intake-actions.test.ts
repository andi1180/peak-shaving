import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B19 — die Server Action der Telefonanfrage.
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * 1. Dass ohne Adminrolle NICHTS geschrieben wird. `public.capture_lead` ist `service_role`-only
 *    und prüft — anders als jeder Admin-Wrapper — im Rumpf KEINE Rolle; es ist der Wrapper des
 *    anonymen Erfassungspfads. Die Autorisierung hängt deshalb an dieser Action, und eine Server
 *    Action ist ein eigener, direkt adressierbarer Endpunkt: Dass die Seite davor prüft, schützt
 *    sie nicht. `captureLead` ist hier ersetzt und zählt mit — kein Aufruf heisst keine Zeile.
 * 2. Dass eine beanstandete Eingabe die Datenbank gar nicht erst berührt.
 * 3. Dass ein Fehlschlag NICHT als Erfolg quittiert wird (anders als im öffentlichen Formular, wo
 *    der Lead die Zugabe zu einer bereits zugestellten Mail ist — hier ist er das einzige Ergebnis).
 *
 * Das Verhalten von `capture_lead` selbst (Zusammenführung, Zwecke, Sperrliste) ist B1-1/B16-1 und
 * liegt im DB-Gate.
 */

const captureLead = vi.fn()
const rpc = vi.fn()
const getUser = vi.fn()
const createClient = vi.fn(async () => ({ rpc, auth: { getUser } }))

vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('@/lib/leads/store', () => ({ captureLead: (input: unknown) => captureLead(input) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/headers', () => ({
  headers: async () => new Map([['user-agent', 'vitest']]) as unknown as Headers,
}))

const { createLeadAction } = await import('./lead-intake-actions')

const PARTNERS = {
  status: 'ok',
  partners: [
    { slug: 'raymann', display_name: 'Raymann Elektro', is_active: true },
    { slug: 'stillgelegt', display_name: 'Alt GmbH', is_active: false },
  ],
}

function formular(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const werte: Record<string, string> = {
    vorname: 'Eva',
    nachname: 'Mayr-Stihl',
    email: 'eva.mayr@baeckerei-mayr.at',
    unternehmen: 'Bäckerei Mayr GmbH',
    telefon: '+43 1 234 5678',
    empfehlung: '',
    partnerSlug: '',
    datenschutz: 'on',
    ...overrides,
  }
  for (const [key, value] of Object.entries(werte)) {
    // Ein nicht angehaktes Kästchen sendet gar nichts — der Leerstring steht hier dafür.
    if (value !== '') fd.set(key, value)
  }
  return fd
}

beforeEach(() => {
  captureLead.mockReset()
  rpc.mockReset()
  getUser.mockReset()
  createClient.mockClear()
  getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } })
  rpc.mockImplementation(async (fn: string) =>
    fn === 'is_admin' ? { data: true, error: null } : { data: PARTNERS, error: null },
  )
  captureLead.mockResolvedValue({ outcome: 'lead_only', leadId: 'lead-1', consentId: null })
})

describe('createLeadAction — ohne Adminrolle wird nichts geschrieben', () => {
  it('schreibt nichts ohne Sitzung', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const state = await createLeadAction({}, formular())
    expect(state.formError).toBeTruthy()
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('schreibt nichts, wenn is_admin nicht ausdrücklich true ist', async () => {
    rpc.mockImplementation(async () => ({ data: false, error: null }))
    const state = await createLeadAction({}, formular())
    expect(state.formError).toBeTruthy()
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('schreibt nichts, wenn die Rollenabfrage FEHLSCHLÄGT (fail closed)', async () => {
    // Ein Lesefehler ist keine Zusage — dieselbe Regel wie in `lib/admin/guard.ts`.
    rpc.mockImplementation(async (fn: string) =>
      fn === 'is_admin' ? { data: null, error: { message: 'weg' } } : { data: PARTNERS, error: null },
    )
    const state = await createLeadAction({}, formular())
    expect(state.formError).toBeTruthy()
    expect(captureLead).not.toHaveBeenCalled()
  })
})

describe('createLeadAction — der Gutfall', () => {
  it('ruft capture_lead GENAU EINMAL, mit der neuen Herkunft und ohne Zweck', async () => {
    const state = await createLeadAction({}, formular())

    expect(state.formError).toBeUndefined()
    expect(state.success).toContain('keine E-Mail')
    expect(captureLead).toHaveBeenCalledTimes(1)
    expect(captureLead.mock.calls[0]?.[0]).toMatchObject({
      email: 'eva.mayr@baeckerei-mayr.at',
      sourceKey: 'telefonanfrage',
      purpose: null,
    })
  })

  it('ruft capture_lead ZWEIMAL, wenn die Partner-Freigabe angehakt ist', async () => {
    const state = await createLeadAction(
      {},
      formular({ partnerSlug: 'raymann', partnerFreigabe: 'on' }),
    )

    expect(state.success).toBeTruthy()
    expect(captureLead).toHaveBeenCalledTimes(2)
    expect(captureLead.mock.calls[0]?.[0]).toMatchObject({ purpose: null, partnerSlug: 'raymann' })
    expect(captureLead.mock.calls[1]?.[0]).toMatchObject({ purpose: 'partner_lead_disclosure' })
  })

  it('lehnt einen STILLGELEGTEN Fachbetrieb ab, obwohl der Wrapper ihn kennt', async () => {
    const state = await createLeadAction({}, formular({ partnerSlug: 'stillgelegt' }))
    expect(state.fieldErrors?.partnerSlug).toBeTruthy()
    expect(captureLead).not.toHaveBeenCalled()
  })
})

describe('createLeadAction — Ablehnungen und Fehlschläge', () => {
  it('berührt die Datenbank nicht, wenn das Datenschutz-Häkchen fehlt', async () => {
    const state = await createLeadAction({}, formular({ datenschutz: '' }))
    expect(state.fieldErrors?.datenschutz).toBeTruthy()
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('gibt die Eingaben zur Wiederanzeige zurück, statt sie zu verwerfen', async () => {
    const state = await createLeadAction({}, formular({ email: 'kaputt', datenschutz: '' }))
    expect(state.values?.vorname).toBe('Eva')
    expect(state.values?.email).toBe('kaputt')
  })

  it('quittiert einen Fehlschlag NICHT als Erfolg', async () => {
    // Hier ist der Lead das einzige Ergebnis: kein Mail, kein zweites Artefakt, kein Absender, der
    // es noch einmal versuchte. Ein stiller Fehlschlag hiesse, die Anfrage verschwindet, während
    // auf dem Bildschirm „gespeichert" steht.
    captureLead.mockRejectedValue(new Error('DB weg'))
    const state = await createLeadAction({}, formular())
    expect(state.success).toBeUndefined()
    expect(state.formError).toBeTruthy()
  })
})
