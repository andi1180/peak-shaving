import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Die Server Actions des Lieferanten-Tarifkatalogs (`createRetailTariffAction`,
 * `confirmRetailTariffAction`).
 *
 * ── DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST ─────────────────────────────────────────────
 * Dass eine Ablehnung die Datenbank NICHT BERÜHRT. Nicht „dort abgelehnt wird" — es entsteht kein
 * Client, kein RPC, gar nichts. Der service_role-Client ist deshalb ersetzt und zählt mit, ob er
 * überhaupt erzeugt wurde; ohne Client kein RPC, ohne RPC keine Zeile.
 *
 * ⚠ Das wiegt hier schwerer als bei jedem anderen Admin-Schreibweg: `public.create_retail_tariff`
 * und `public.confirm_retail_tariff` sind SECURITY INVOKER und prüfen KEINE Rolle (der Aufrufer ist
 * `service_role` und trägt kein JWT). Die `isCurrentUserAdmin()`-Zeile IST die Zugangsentscheidung —
 * sie hat in der Datenbank kein Gegenstück, das sie auffinge. Und anders als bei den
 * Netzbetreiber-Tarifen gibt es für `retail_tariffs` ausdrücklich KEINEN Löschweg, auch nicht für
 * `service_role`: eine zu Unrecht angelegte Zeile bleibt stehen und lässt sich nur durch einen neuen
 * Stand ablösen.
 *
 * Das Verhalten der Funktionen selbst (Effektiv-Datierung, Advisory-Lock, Rechtefläche, dass
 * `confirm` ausschliesslich `checked_at` anfasst) ist Sache des DB-Gates
 * (`packages/db-tests/src/retail-tariff-{write-path,confirm}.test.ts`).
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

const { confirmRetailTariffAction, createRetailTariffAction } =
  await import('./retail-tariffs-actions')

const ID = '11111111-2222-4333-8444-555555555555'

/** Ein vollständiges, gültiges Anlageformular — der Weg „bekannter Anbieter". */
function createForm(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const base: Record<string, string> = {
    providerSelect: 'awattar',
    providerId: 'awattar',
    providerName: 'aWATTar GmbH',
    segment: 'betrieb',
    energyPriceCtPerKwh: '24.1',
    baseFeeEurPerMonth: '5.75',
    priceBasis: 'net',
    sourceUrl: 'https://www.awattar.at/tariffs',
    validFrom: '2026-10-01',
    ...overrides,
  }
  for (const [k, v] of Object.entries(base)) fd.set(k, v)
  return fd
}

function confirmForm(tariffId: string): FormData {
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
})

describe('createRetailTariffAction', () => {
  it('Erfolg: GENAU EIN Aufruf, Beträge als Zahlen, und die Eingaben fahren zurück', async () => {
    rpc.mockResolvedValue({
      data: { status: 'created', closed_count: 1, closed_valid_until: '2026-09-30' },
      error: null,
    })

    const state = await createRetailTariffAction({}, createForm())

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('create_retail_tariff', {
      p_provider_id: 'awattar',
      p_provider_name: 'aWATTar GmbH',
      p_segment: 'betrieb',
      /*
       * ⚠ ZAHLEN, KEINE ZEICHENKETTEN. Das Formular liefert `'24.1'`; erst `z.coerce.number()` macht
       * daraus einen Betrag. Ginge der String durch, hinge die Auslegung an PostgREST statt an einer
       * Stelle, die wir prüfen — und ein Dezimalkomma fiele hier gar nicht erst auf.
       */
      p_energy_price_ct_per_kwh: 24.1,
      p_base_fee_eur_per_month: 5.75,
      p_price_basis: 'net',
      p_source_url: 'https://www.awattar.at/tariffs',
      p_valid_from: '2026-10-01',
      p_created_by: 'admin@coolin.at',
    })

    expect(state.formError).toBeUndefined()
    expect(state.fieldErrors).toBeUndefined()
    expect(state.success).toMatch(/Tarifstand angelegt/)
    // Die abgelöste Vorgängerin wird mit ihrem letzten Gültigkeitstag in de-AT benannt.
    expect(state.success).toContain('30.09.2026')
    /*
     * ⚠ AUCH IM ERFOLGSFALL FAHREN DIE EINGABEN MIT: Das Formular ersetzt sich danach durch eine
     * reine Anzeige dessen, was angelegt wurde, und deren Felder sind unkontrolliert. Fiele
     * `values` aus dem Erfolgszweig, wäre der Stand im selben Moment unsichtbar, in dem er
     * unumkehrbar wird — und hier gibt es nicht einmal einen Löschweg, um nachzusehen.
     */
    expect(state.values).toMatchObject({
      providerId: 'awattar',
      providerName: 'aWATTar GmbH',
      segment: 'betrieb',
      energyPriceCtPerKwh: '24.1',
      baseFeeEurPerMonth: '5.75',
      priceBasis: 'net',
      sourceUrl: 'https://www.awattar.at/tariffs',
      validFrom: '2026-10-01',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/lieferanten-tarife')
  })

  it('`duplicate_valid_from` landet AM DATUMSFELD, nicht als Allgemeinmeldung', async () => {
    /*
     * Der Unique-Constraint der Tabelle greift, wenn genau dieser Beginn für dieselbe Kombination
     * schon existiert. Die Ursache liegt in EINEM Feld — als `formError` müsste der Eintragende sie
     * unter acht Feldern suchen. Fail closed: kein `success`, kein Neurendern.
     */
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'duplicate_valid_from' },
    })

    const state = await createRetailTariffAction({}, createForm())

    expect(state.fieldErrors?.validFrom).toMatch(/bereits einen Stand/)
    expect(state.formError).toBeUndefined()
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('`invalid_input` wird benannt statt als allgemeiner Fehlschlag ausgegeben', async () => {
    /*
     * Die CHECKs der Tabelle sehen auch Aufrufe am Formular vorbei. Schlägt einer an, ist die
     * Ursache eine andere als „hat nicht geklappt" — der Satz nennt die drei Stellen, an denen es
     * liegen kann (Kundengruppe, Preisbasis, leerer Quellenbeleg).
     */
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid_input' } })

    const state = await createRetailTariffAction({}, createForm())

    expect(state.formError).toMatch(/ausserhalb dessen, was die Datenbank zulässt/)
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('ohne Adminrolle entsteht kein service_role-Client — und die Prüfung steht VOR der Formprüfung', async () => {
    /*
     * Auch ein unbrauchbares Formular ergibt „Keine Berechtigung": Wer keinen Zugang hat, soll nicht
     * erfahren, welche Felder die Action kennt und wie sie geprüft werden.
     */
    isCurrentUserAdmin.mockResolvedValue(false)

    const state = await createRetailTariffAction({}, createForm({ validFrom: '01.10.2026' }))

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(state.fieldErrors).toBeUndefined()
    expect(state.success).toBeUndefined()
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('confirmRetailTariffAction', () => {
  it('Erfolg: EIN Aufruf mit der Kennung — und ausdrücklich OHNE Zeitpunkt-Parameter', async () => {
    /*
     * ⚠ Die Prüfung der ABWESENHEIT ist der Kern dieses Falls: `confirm_retail_tariff` nimmt `now()`
     * selbst. Ein hier mitgeschickter Zeitstempel wäre die Einladung, ein Prüfdatum zu behaupten,
     * das nie stattgefunden hat — und genau daran hängt die Veraltet-Anzeige.
     */
    rpc.mockResolvedValue({
      data: { status: 'confirmed', checked_at: '2026-09-13T10:00:00Z' },
      error: null,
    })

    const state = await confirmRetailTariffAction({}, confirmForm(ID))

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('confirm_retail_tariff', { p_id: ID })
    expect(state.success).toMatch(/Prüfzeitpunkt steht auf heute/)
    expect(state.formError).toBeUndefined()
    expect(revalidatePath).toHaveBeenCalledWith('/admin/lieferanten-tarife')
  })

  it('`not_found` bekommt einen eigenen Satz — und rendert NICHT neu', async () => {
    /*
     * Der reale Fall: zwei offene Browser-Fenster, eines hat den Stand inzwischen abgelöst. Es wurde
     * nichts geändert; ein `revalidatePath` behauptete das Gegenteil.
     */
    rpc.mockResolvedValue({ data: { status: 'not_found' }, error: null })

    const state = await confirmRetailTariffAction({}, confirmForm(ID))

    expect(state.formError).toMatch(/gibt es nicht mehr/)
    expect(state.success).toBeUndefined()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('eine unbrauchbare Kennung erreicht die Datenbank gar nicht', async () => {
    /*
     * Der Wert kommt aus einem verborgenen Feld und ist damit nicht vertrauenswürdiger als jede
     * andere Eingabe. Geprüft wird die FORM; eine unbekannte, aber wohlgeformte Kennung beantwortet
     * die Datenbank selbst mit `not_found` (s. Test darüber).
     */
    const state = await confirmRetailTariffAction({}, confirmForm('offensichtlich-keine-uuid'))

    expect(state.formError).toMatch(/keine gültige Tarifzeile/)
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('ohne Adminrolle entsteht kein service_role-Client', async () => {
    isCurrentUserAdmin.mockResolvedValue(false)

    const state = await confirmRetailTariffAction({}, confirmForm(ID))

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(state.success).toBeUndefined()
    expect(createServiceRoleClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
