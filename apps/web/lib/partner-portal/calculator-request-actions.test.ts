import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CALCULATOR_REQUEST_INITIAL_STATE } from './calculator-request-form-state'

/**
 * B18-4 (Portal) — die Server Action des Anfrageformulars.
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * 1. ⚠ `already_pending` bleibt ein EIGENER Zustand und wird nicht zu `error`. Er entsteht real
 *    ohne Fehlverhalten (zwei Tabs, Doppelklick) — als generischer Fehler angezeigt wäre er die
 *    falsche Auskunft: Es HAT geklappt, nur nicht durch diesen Klick.
 * 2. Ohne Sitzung oder ohne aktive Partnerzeile wird die Datenbank GAR NICHT erst gefragt — damit
 *    entsteht insbesondere keine interne Benachrichtigungsmail mit leeren Partner-Angaben.
 * 3. Die Partner-Angaben stammen aus `readPortal()` derselben Anfrage und NICHT aus dem Formular.
 * 4. Der getippte Text fährt bei jedem Fehler zurück.
 */

const readPortal = vi.fn()
const submit = vi.fn()
const revalidatePath = vi.fn()

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung.
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('./read', () => ({ readPortal: () => readPortal() }))
vi.mock('./calculator-request-server', () => ({
  submitCalculatorRequest: (input: unknown) => submit(input),
}))

const { submitCalculatorRequestAction } = await import('./calculator-request-actions')

const PARTNER = {
  email: 'anna@elektro-muster.at',
  state: {
    state: 'partner',
    partner: { slug: 'elektro-muster', displayName: 'Elektro Muster GmbH' },
  },
  referralUrl: 'https://www.coolin.at/partner/elektro-muster',
}

function form(message: string, extra: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('begruendung', message)
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  readPortal.mockReset()
  submit.mockReset()
  revalidatePath.mockReset()
  readPortal.mockResolvedValue(PARTNER)
})

describe('B18-4 Portal — submitCalculatorRequestAction', () => {
  it('reicht ein und meldet Erfolg', async () => {
    submit.mockResolvedValue({ status: 'ok', requestId: 'req-1' })

    const state = await submitCalculatorRequestAction(
      CALCULATOR_REQUEST_INITIAL_STATE,
      form('Zehn Bestandskunden.'),
    )

    expect(submit).toHaveBeenCalledTimes(1)
    expect(state).toEqual({ status: 'ok' })
    expect(revalidatePath).toHaveBeenCalledWith('/kalkulator')
  })

  it('⚠ die Partner-Angaben kommen aus der SITZUNG, nicht aus dem Formular', async () => {
    submit.mockResolvedValue({ status: 'ok', requestId: 'req-1' })

    await submitCalculatorRequestAction(
      CALCULATOR_REQUEST_INITIAL_STATE,
      form('Begründung.', {
        partnerSlug: 'fremder-betrieb',
        partnerDisplayName: 'Fremd GmbH',
        accountEmail: 'fremd@example.org',
      }),
    )

    expect(submit).toHaveBeenCalledWith({
      message: 'Begründung.',
      partnerSlug: 'elektro-muster',
      partnerDisplayName: 'Elektro Muster GmbH',
      accountEmail: 'anna@elektro-muster.at',
    })
  })

  it('⚠ hält already_pending als eigenen Zustand samt Zeitpunkt fest', async () => {
    submit.mockResolvedValue({
      status: 'already_pending',
      requestId: 'req-0',
      createdAt: '2026-08-03T08:00:00+00:00',
    })

    const state = await submitCalculatorRequestAction(
      CALCULATOR_REQUEST_INITIAL_STATE,
      form('Zweiter Tab.'),
    )

    expect(state).toEqual({
      status: 'already_pending',
      createdAt: '2026-08-03T08:00:00+00:00',
    })
    // Die Seite soll danach den Wartezustand zeigen, nicht weiter das Formular.
    expect(revalidatePath).toHaveBeenCalledWith('/kalkulator')
  })

  it('⚠ fragt ohne Sitzung und ohne Partnerzeile gar nicht erst — kein Versand', async () => {
    readPortal.mockResolvedValue(null)
    expect(await submitCalculatorRequestAction(CALCULATOR_REQUEST_INITIAL_STATE, form('X.'))).toEqual(
      { status: 'none' },
    )

    readPortal.mockResolvedValue({ email: null, state: { state: 'no_partner' }, referralUrl: null })
    expect(await submitCalculatorRequestAction(CALCULATOR_REQUEST_INITIAL_STATE, form('X.'))).toEqual(
      { status: 'none' },
    )

    expect(submit).not.toHaveBeenCalled()
  })

  it('reicht die Feldfehler samt getipptem Text zurück', async () => {
    submit.mockResolvedValue({ status: 'missing_fields' })
    expect(await submitCalculatorRequestAction(CALCULATOR_REQUEST_INITIAL_STATE, form('   '))).toEqual(
      { status: 'missing_fields', message: '   ' },
    )

    submit.mockResolvedValue({ status: 'message_too_long', maxLength: 4000 })
    expect(
      await submitCalculatorRequestAction(CALCULATOR_REQUEST_INITIAL_STATE, form('lang')),
    ).toEqual({ status: 'message_too_long', maxLength: 4000, message: 'lang' })
  })

  it('⚠ verliert den getippten Text auch bei einem Datenbankfehler nicht', async () => {
    submit.mockResolvedValue({ status: 'error' })

    const state = await submitCalculatorRequestAction(
      CALCULATOR_REQUEST_INITIAL_STATE,
      form('Drei Absätze Begründung.'),
    )

    expect(state).toEqual({ status: 'error', message: 'Drei Absätze Begründung.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
