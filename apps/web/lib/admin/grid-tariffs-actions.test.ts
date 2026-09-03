import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B21-2c — die Server Action des Löschwegs (`deleteGridTariffAction`).
 *
 * ── DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST ─────────────────────────────────────────────
 * Dass eine Ablehnung die Datenbank NICHT BERÜHRT. Nicht „dort abgelehnt wird" — es entsteht kein
 * Client, kein RPC, gar nichts. Der service_role-Client ist deshalb ersetzt und zählt mit, ob er
 * überhaupt erzeugt wurde; ohne Client kein RPC, ohne RPC keine gelöschte Zeile.
 *
 * ⚠ Das ist an dieser Stelle mehr als eine Formalie: `public.delete_grid_tariff` ist SECURITY
 * INVOKER und prüft KEINE Rolle (der Aufrufer ist `service_role` und trägt kein JWT). Diese
 * Rollenprüfung IST die Zugangsentscheidung — sie hat in der Datenbank kein Gegenstück, das sie
 * auffangen würde. Fällt sie weg, löscht jeder angemeldete Nutzer, der die Action-Kennung kennt.
 *
 * Das Verhalten der Funktion selbst (Kaskade, Abzug, not_found, Rechtefläche) ist B21-2c und liegt
 * im DB-Gate (`packages/db-tests/src/grid-tariff-delete-path.test.ts`).
 */

const rpc = vi.fn()
const createServiceRoleClient = vi.fn(() => ({ rpc }))
const isCurrentUserAdmin = vi.fn()
const currentUserEmail = vi.fn()
const revalidatePath = vi.fn()

vi.mock('@/lib/supabase/service-role', () => ({
  createServiceRoleClient: () => createServiceRoleClient(),
}))
vi.mock('./guard', () => ({ isCurrentUserAdmin: () => isCurrentUserAdmin() }))
vi.mock('./session', () => ({ currentUserEmail: () => currentUserEmail() }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))

const { backfillGridTariffAction, createGridTariffAction, deleteGridTariffAction } =
  await import('./grid-tariffs-actions')

const ID = '11111111-2222-4333-8444-555555555555'

function formFor(tariffId: string): FormData {
  const fd = new FormData()
  fd.set('tariffId', tariffId)
  return fd
}

beforeEach(() => {
  rpc.mockReset()
  createServiceRoleClient.mockClear()
  isCurrentUserAdmin.mockReset()
  currentUserEmail.mockReset()
  revalidatePath.mockReset()
  isCurrentUserAdmin.mockResolvedValue(true)
  currentUserEmail.mockResolvedValue('admin@coolin.at')
  rpc.mockResolvedValue({ data: { status: 'deleted', id: ID, window_count: 2 }, error: null })
})

describe('deleteGridTariffAction — ohne Adminrolle geschieht NICHTS', () => {
  it('lehnt ab, ohne einen service_role-Client zu erzeugen', async () => {
    isCurrentUserAdmin.mockResolvedValue(false)
    const state = await deleteGridTariffAction({}, formFor(ID))

    expect(state.formError).toMatch(/Keine Berechtigung/)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('die Prüfung steht VOR der Formprüfung — auch eine unbrauchbare id ergibt „Keine Berechtigung"', async () => {
    // Wer keinen Zugang hat, soll nicht erfahren, welche Felder die Action kennt und wie sie
    // geprüft werden (dieselbe Reihenfolge wie beim Anlegen).
    isCurrentUserAdmin.mockResolvedValue(false)
    const state = await deleteGridTariffAction({}, formFor('offensichtlich-keine-uuid'))

    expect(state.formError).toMatch(/Keine Berechtigung/)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('ein Fehler beim Lesen der Rolle gilt als „kein Zugang" (fail closed)', async () => {
    isCurrentUserAdmin.mockRejectedValue(new Error('Sitzung nicht lesbar'))
    await expect(deleteGridTariffAction({}, formFor(ID))).rejects.toThrow()
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('deleteGridTariffAction — die Prüfkette liegt VOR der Datenbank', () => {
  it('eine unbrauchbare Kennung erreicht die Datenbank gar nicht', async () => {
    const state = await deleteGridTariffAction({}, formFor('12345'))

    expect(state.formError).toMatch(/keine gültige Tarifzeile/)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ein fehlendes Feld ebenfalls', async () => {
    const state = await deleteGridTariffAction({}, new FormData())

    expect(state.formError).toMatch(/keine gültige Tarifzeile/)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('deleteGridTariffAction — der Gutfall setzt GENAU EINEN Aufruf ab', () => {
  it('reicht Kennung und Adresse durch und meldet den Erfolg samt Zeitfenster-Zahl', async () => {
    const state = await deleteGridTariffAction({}, formFor(ID))

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('delete_grid_tariff', {
      p_tariff_id: ID,
      p_deleted_by: 'admin@coolin.at',
    })
    expect(state.formError).toBeUndefined()
    expect(state.success).toMatch(/gelöscht, mit 2 Zeitfenstern/)
    expect(state.success).toMatch(/Löschprotokoll/)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/netzbetreiber-tarife')
  })

  it('ohne lesbare Sitzungsadresse steht ein erkennbarer Platzhalter im Protokoll', async () => {
    // Wie beim Anlegen (`created_by`): ein leerer String sähe später wie eine Angabe aus.
    currentUserEmail.mockResolvedValue(null)
    await deleteGridTariffAction({}, formFor(ID))

    expect(rpc).toHaveBeenCalledWith('delete_grid_tariff', {
      p_tariff_id: ID,
      p_deleted_by: 'unbekannt',
    })
  })

  it('EIN Zeitfenster wird korrekt im Singular gemeldet', async () => {
    rpc.mockResolvedValue({ data: { status: 'deleted', id: ID, window_count: 1 }, error: null })
    const state = await deleteGridTariffAction({}, formFor(ID))

    expect(state.success).toMatch(/mit 1 Zeitfenster\./)
  })
})

describe('deleteGridTariffAction — Antworten der Datenbank', () => {
  it('`not_found` bekommt einen eigenen Satz statt der Allgemeinmeldung', async () => {
    // Der reale Fall: zwei offene Browser-Fenster, eines hat die Zeile schon entfernt. Ein
    // allgemeines „hat nicht geklappt" liesse den Admin die Ursache suchen, die es nicht gibt.
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'not_found' } })
    const state = await deleteGridTariffAction({}, formFor(ID))

    expect(state.formError).toMatch(/gibt es nicht mehr/)
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('ein Betriebsfehler wird NICHT als Erfolg ausgegeben', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failure' } })
    const state = await deleteGridTariffAction({}, formFor(ID))

    expect(state.formError).toMatch(/nicht geklappt/)
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('ein unerwarteter Status gilt als Fehlschlag, nicht als Erfolg', async () => {
    // Fail closed: käme je ein neuer Status dazu, den diese Datei nicht kennt, darf die Oberfläche
    // nicht „gelöscht" behaupten — die Zeile stünde ja womöglich noch.
    rpc.mockResolvedValue({ data: { status: 'irgendwas_neues' }, error: null })
    const state = await deleteGridTariffAction({}, formFor(ID))

    expect(state.formError).toMatch(/nicht geklappt/)
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

/**
 * ── ⚠ DER ERFOLGSFALL MUSS DIE EINGABEN ZURÜCKGEBEN ─────────────────────────────────────────────
 * Seit dem Nachtrag zu PR #120 ersetzt sich `CreateGridTariffForm` nach einem `created` durch eine
 * reine Anzeige dessen, was angelegt wurde — und die liest ausschliesslich `state.values`. Fiele
 * die Zeile aus dem Erfolgszweig, stünde dort für JEDES Feld ein Gedankenstrich: der Admin hätte
 * gerade neun Felder und bis zu zwölf Zeitfenster abgetippt, der Vorgang wäre unumkehrbar, und
 * das Abgeschickte wäre im selben Moment unsichtbar. Kein Typfehler, kein Absturz, keine
 * Fehlermeldung — genau die Sorte stiller Verlust, die nur ein Test fängt.
 */
function createForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const base: Record<string, string> = {
    operatorSelect: 'wiener_netze',
    operatorId: 'wiener_netze',
    operatorName: 'Wiener Netze GmbH',
    netzebene: '5',
    grundpreisAmount: '44.8',
    grundpreisUnit: 'eur_per_kw_year',
    netzverlustCtPerKwh: '0.74',
    priceBasis: 'net',
    validFrom: '2027-01-01',
    w0_label: 'normal',
    w0_ctPerKwh: '4.62',
    w0_timeFrom: '00:00',
    w0_timeTo: '24:00',
    w0_monthDayFrom: '',
    w0_monthDayTo: '',
    ...overrides,
  }
  for (const [k, v] of Object.entries(base)) fd.set(k, v)
  return fd
}

describe('createGridTariffAction — der Erfolgsfall trägt die Eingaben zurück', () => {
  beforeEach(() => {
    rpc.mockResolvedValue({
      data: {
        status: 'created',
        id: ID,
        window_count: 1,
        closed_count: 0,
        closed_valid_until: null,
      },
      error: null,
    })
  })

  it('meldet den Erfolg UND liefert die abgesendeten Werte mit', async () => {
    const state = await createGridTariffAction({}, createForm())
    expect(state.success).toContain('Tarifstand angelegt')
    expect(state.formError).toBeUndefined()
    expect(state.fieldErrors).toBeUndefined()
    expect(state.values).toBeDefined()
    // Genau die Felder, aus denen die Erfolgsanzeige ihre Zeilen baut.
    expect(state.values).toMatchObject({
      operatorName: 'Wiener Netze GmbH',
      operatorId: 'wiener_netze',
      netzebene: '5',
      grundpreisAmount: '44.8',
      grundpreisUnit: 'eur_per_kw_year',
      netzverlustCtPerKwh: '0.74',
      priceBasis: 'net',
      validFrom: '2027-01-01',
      w0_label: 'normal',
      w0_ctPerKwh: '4.62',
      w0_timeFrom: '00:00',
      w0_timeTo: '24:00',
    })
  })

  it('die Messvariante fährt mit, wo es eine gibt — und fehlt sonst', async () => {
    const withVariant = await createGridTariffAction(
      {},
      createForm({ netzebene: '7', meteringVariant: 'mit_leistungsmessung' }),
    )
    expect(withVariant.values?.meteringVariant).toBe('mit_leistungsmessung')

    const without = await createGridTariffAction({}, createForm())
    expect(without.values?.meteringVariant).toBeUndefined()
  })

  it('ein zweites Zeitfenster erscheint vollständig unter seinem eigenen Index', async () => {
    const state = await createGridTariffAction(
      {},
      createForm({
        w1_label: 'snap',
        w1_ctPerKwh: '11.35',
        w1_timeFrom: '17:00',
        w1_timeTo: '20:00',
        w1_monthDayFrom: '10-01',
        w1_monthDayTo: '03-31',
      }),
    )
    expect(state.values).toMatchObject({
      w1_label: 'snap',
      w1_ctPerKwh: '11.35',
      w1_timeFrom: '17:00',
      w1_timeTo: '20:00',
      w1_monthDayFrom: '10-01',
      w1_monthDayTo: '03-31',
    })
  })

  /*
   * Die Gegenprobe: `success` ist für DIESE Action gleichbedeutend mit „angelegt" — daran hängt im
   * Formular die Entscheidung, die Eingabefelder überhaupt nicht mehr zu rendern. Ein Fehlerfall
   * darf das Feld deshalb unter keinen Umständen setzen.
   */
  it('ein abgelehnter Gültigkeitsbeginn setzt KEIN success', async () => {
    rpc.mockResolvedValue({
      data: { status: 'invalid_valid_from', open_valid_from: '2027-01-01' },
      error: null,
    })
    const state = await createGridTariffAction({}, createForm())
    expect(state.success).toBeUndefined()
    expect(state.fieldErrors?.validFrom).toContain('01.01.2027')
    expect(state.values).toBeDefined()
  })

  it('auch „keine Berechtigung" setzt KEIN success', async () => {
    isCurrentUserAdmin.mockResolvedValue(false)
    const state = await createGridTariffAction({}, createForm())
    expect(state.success).toBeUndefined()
    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })
})

describe('backfillGridTariffAction — der Nachtrag ist ein eigener Weg, kein Sonderfall des Anlegens', () => {
  /** Ein vollständiges Formular des Nachtrag-Wegs — ohne `operatorName` (der kommt aus dem Bestand). */
  function backfillForm(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData()
    const base: Record<string, string> = {
      operatorId: 'wiener_netze',
      netzebene: '5',
      grundpreisAmount: '38.52',
      grundpreisUnit: 'eur_per_kw_year',
      netzverlustCtPerKwh: '1.23',
      priceBasis: 'net',
      validFrom: '2025-01-01',
      w0_label: 'normal',
      w0_timeFrom: '00:00',
      w0_timeTo: '24:00',
      w0_ctPerKwh: '6.98',
      ...overrides,
    }
    for (const [k, v] of Object.entries(base)) fd.set(k, v)
    return fd
  }

  it('lehnt ohne Adminrolle ab, ohne einen service_role-Client zu erzeugen', async () => {
    /*
     * Dieselbe Eigenschaft wie bei den drei Actions darüber, und sie wiegt hier genauso schwer:
     * `public.backfill_grid_tariff` ist SECURITY INVOKER und prüft KEINE Rolle. Diese Zeile IST die
     * Zugangsentscheidung — sie hat in der Datenbank kein Gegenstück, das sie auffinge.
     */
    isCurrentUserAdmin.mockResolvedValue(false)
    const state = await backfillGridTariffAction({}, backfillForm())

    expect(state.formError).toMatch(/Keine Berechtigung/)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ruft `backfill_grid_tariff` — und übergibt KEINEN Anzeigenamen', async () => {
    /*
     * Der Wrapper hat für `operator_name` bewusst keinen Parameter: Der Name kommt aus dem Bestand,
     * sonst stünde dieselbe Kennung mit zwei Anzeigenamen in der Liste. Ein hier trotzdem
     * mitgeschicktes Argument würde von PostgREST als unbekannter Parameter abgewiesen — der Test
     * pinnt die Abwesenheit, nicht bloss die Anwesenheit der übrigen.
     */
    rpc.mockResolvedValue({
      data: { status: 'backfilled', window_count: 1, new_valid_until: '2025-12-31' },
      error: null,
    })
    const state = await backfillGridTariffAction({}, backfillForm())

    expect(rpc).toHaveBeenCalledTimes(1)
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>]
    expect(fn).toBe('backfill_grid_tariff')
    expect(args).not.toHaveProperty('p_operator_name')
    expect(args.p_operator_id).toBe('wiener_netze')
    expect(args.p_netzebene).toBe(5)
    expect(args.p_valid_from).toBe('2025-01-01')
    expect(args.p_windows).toEqual([
      {
        label: 'normal',
        month_day_from: null,
        month_day_to: null,
        time_from: '00:00',
        time_to: '24:00',
        ct_per_kwh: 6.98,
        note: null,
      },
    ])
    expect(state.success).toMatch(/nachgetragen/)
    expect(state.success).toContain('31.12.2025')
    expect(revalidatePath).toHaveBeenCalled()
  })

  it('⚠ `not_before_oldest` verlangt ein FRÜHERES Datum — nicht ein späteres wie beim Anlegen', async () => {
    /*
     * Der teuerste denkbare Textfehler dieses Abschnitts: Ein aus `createGridTariffAction`
     * übernommener Satz („muss NACH diesem Tag beginnen") schickte den Eintragenden in die
     * verkehrte Richtung, er korrigierte nach hinten und liefe erneut in dieselbe Abweisung.
     */
    rpc.mockResolvedValue({
      data: { status: 'not_before_oldest', min_valid_from: '2026-01-01' },
      error: null,
    })
    const state = await backfillGridTariffAction({}, backfillForm({ validFrom: '2026-06-01' }))

    expect(state.fieldErrors?.validFrom).toContain('01.01.2026')
    expect(state.fieldErrors?.validFrom).toMatch(/VOR diesem Tag/)
    expect(state.fieldErrors?.validFrom).not.toMatch(/NACH diesem Tag/)
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('`no_existing_stand` verweist auf den Anlageweg statt einen Fehler zu behaupten', async () => {
    // Kein stilles Anlegen einer ersten Zeile: dafür ist `create_grid_tariff` da (s. Migration).
    rpc.mockResolvedValue({ data: { status: 'no_existing_stand' }, error: null })
    const state = await backfillGridTariffAction({}, backfillForm({ operatorId: 'linz_netz' }))

    expect(state.formError).toMatch(/noch gar keinen Tarifstand/)
    expect(state.formError).toMatch(/Neuen Tarifstand anlegen/)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('ein unbrauchbares Formular erzeugt weder Client noch RPC', async () => {
    // Die Prüfkette liegt VOR der Datenbank: was hier scheitert, fragt sie gar nicht erst.
    const state = await backfillGridTariffAction({}, backfillForm({ validFrom: '01.01.2025' }))

    expect(state.fieldErrors?.validFrom).toBeTruthy()
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
