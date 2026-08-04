// DB-Gate für die Kalkulator-Anfrage eines Fachbetriebs
// (Migration 20260804150000_create_calculator_requests.sql, B18-4).
//
// ── WORAN DIESER SCHRITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ────────────────────────
// (1) ⚠ DER DRITTE SCHREIBWEG IN `platform.entitlements`. Bis hierher schrieben dort genau zwei
//     Wege (Stripe-Trigger und Gutscheineinlösung). Ein Fehler an dieser Stelle ist ein
//     VERSCHENKTER oder ein FEHLENDER Produktzugang — beides fällt beim Klicken nicht auf: Der
//     Betrieb sieht entweder einen Rechner, den er nicht bestellt hat, oder eine Anfrage-Seite,
//     obwohl seine Freigabe längst durch ist. Gemessen wird deshalb nicht die Zeile, sondern die
//     WIRKUNG: `public.get_my_entitlement('calculator_pro')` für GENAU diesen Partner true, für ein
//     anderes Konto unverändert false — und `monitor` bleibt bei beiden false (Produkt-Isolation,
//     die Lücke, die es vor dem zweiten Produkt gar nicht geben konnte, s. B10-1).
// (2) ⚠ DIE ATOMARITÄT IST DIE ZUSAGE DIESES ABSCHNITTS. „Genehmigt, aber Zugang fehlt" ist der
//     eine Zustand, den es nicht geben darf. Der Beweis lässt sich nicht durch Zusehen führen —
//     alle bekannten Fehlerfälle werden VOR dem Schreiben als Status beantwortet. Deshalb wird das
//     Anlegen des Entitlements künstlich zum Scheitern gebracht (temporärer Trigger) und geprüft,
//     dass die Anfrage danach unangetastet `pending` ist.
// (3) NUR EINE OFFENE ANFRAGE JE BETRIEB, und zwar in ZWEI Schichten: der Wrapper antwortet
//     `already_pending` (ein 23505 ist für die Person davor keine Auskunft), der partielle
//     UNIQUE-Index hält auch dann, wenn zwei Absendungen gleichzeitig an der Vorprüfung
//     vorbeikommen. Beide werden einzeln gemessen. Nach einer ABGELEHNTEN oder GENEHMIGTEN Anfrage
//     ist eine neue ausdrücklich erlaubt — auch das ist eine Zusage und kein Nebeneffekt.
// (4) FREMDE BETRIEBE. `submit_calculator_request` hat KEINEN Parameter für die Partner-Identität;
//     die Bindung entsteht über `auth.uid()`. Eine vergessene Bedingung fiele mit genau einem
//     Fachbetrieb nirgends auf. Deshalb stehen hier zwei nebeneinander.
// (5) EIN STILLGELEGTER PARTNER KANN NICHT ANFRAGEN und bekommt dieselbe Antwort wie ein Konto ohne
//     Partnerzeile — er DARF aber weiterhin entschieden werden (Stilllegung betrifft die
//     Empfehlungslinks, nicht das Werkzeug). Beide Richtungen sind Entscheidungen, keine Zufälle.
// (6) ⚠ `no_account` GILT NUR FÜRS FREIGEBEN. Ohne `partners.user_id` gibt es nichts
//     freizuschalten; ABLEHNEN muss möglich bleiben, sonst bliebe die Anfrage ewig offen und der
//     partielle UNIQUE-Index sperrte jede neue.
// (7) `notified_at` SAGT DIE WAHRHEIT ODER NICHTS: kein Zeitstempel-Parameter, kein Zurücksetzen,
//     nur an einer GENEHMIGTEN Anfrage — und der CHECK ist die Schicht, die auch dann hält, wenn
//     jemand den Vermerk anders auslöst.
// (8) DIE RECHTEFLÄCHE. Alle vier Wrapper authenticated-only; die drei `admin_*` WERFEN 42501 statt
//     leer zu antworten (ein leeres Ergebnis läse sich als „keine Anfragen"). Auf der Tabelle hat
//     KEINE Rolle irgendein Recht.
// (9) JEDER WRAPPER WIRD TATSÄCHLICH AUFGERUFEN (Arbeitsregel 2): Introspektion beweist Existenz,
//     nicht Lauffähigkeit — plpgsql prüft Funktionsrümpfe nicht beim Anlegen.
//
// ⚠ ARBEITSREGEL 5: Fehlende Aufrufbarkeit wird mit `has_function_privilege` geprüft, NIE durch
//     einen Aufruf als Rolle ohne Grant — ein solcher Aufruf hat im CI-Lauf von B16-4a den
//     Postgres-Prozess mit Signal 11 beendet. Ein echter Aufruf ist nur dort sicher, wo die Rolle
//     einen Grant BESITZT und die Ablehnung im Funktionsrumpf erfolgt (der eingeloggte Nicht-Admin).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { assertStackReachable, createUser, deleteUser, runAs, sql, type TestUser } from './client'

const spawnedUsers: string[] = []
const spawnedPartners: string[] = []

type Json = Record<string, unknown>

function newSlug(): string {
  return `gate-b184-${randomUUID().slice(0, 8)}`
}

async function newPlainUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

async function newAdmin(): Promise<TestUser> {
  const u = await newPlainUser()
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

/**
 * Legt einen Fachbetrieb an — als `postgres`, also reines Fixture-Setup.
 *
 * Bewusst NICHT über `admin_approve_partner_application`: Dieses Gate misst die Kalkulator-Anfrage,
 * nicht die Genehmigung einer Bewerbung (die ist in `partner-approval.test.ts` vollständig
 * gemessen). Der Umweg über den Antragsweg brächte drei weitere Fixtures und keine zusätzliche
 * Aussage.
 */
async function newPartner(
  input: { userId?: string | null; displayName?: string; isActive?: boolean } = {},
): Promise<string> {
  const slug = newSlug()
  await sql(
    `insert into platform.partners (slug, display_name, contact_first_name, contact_last_name,
                                    user_id, is_active)
     values ($1, $2, 'Anna', 'Gruber', $3, $4)`,
    [
      slug,
      input.displayName ?? 'Elektro Musterbetrieb GmbH',
      input.userId ?? null,
      input.isActive ?? true,
    ],
  )
  spawnedPartners.push(slug)
  return slug
}

/** Ein Fachbetrieb mit verknüpftem Konto — der Regelfall dieses Abschnitts. */
async function newLinkedPartner(displayName?: string): Promise<{ user: TestUser; slug: string }> {
  const user = await newPlainUser()
  const slug = await newPartner({ userId: user.id, displayName })
  return { user, slug }
}

/** Der Weg des Portals: ein angemeldetes Partnerkonto reicht ein. */
async function submit(user: TestUser | null, message: string): Promise<Json> {
  return runAs({ role: 'authenticated', userId: user?.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: Json }>(`select public.submit_calculator_request($1) as r`, [
      message,
    ])
    return rows[0]!.r
  })
}

/** Der Weg des Admin-Bereichs: ein angemeldetes Konto ruft einen `admin_*`-Wrapper auf. */
async function asAdmin(user: TestUser, text: string, params: unknown[] = []): Promise<Json> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: Json }>(text, params)
    return rows[0]!.r
  })
}

const decide = (admin: TestUser, id: unknown, decision: string) =>
  asAdmin(admin, `select public.admin_decide_calculator_request($1, $2) as r`, [id, decision])

const markNotified = (admin: TestUser, id: unknown) =>
  asAdmin(admin, `select public.admin_mark_calculator_request_notified($1) as r`, [id])

const listRequests = (admin: TestUser, status: string | null = null, limit = 200, offset = 0) =>
  asAdmin(admin, `select public.admin_list_calculator_requests($1, $2, $3) as r`, [
    status,
    limit,
    offset,
  ])

async function readRequest(id: unknown) {
  const rows = await sql<{
    partner_slug: string
    message: string
    status: string
    reviewed_by: string | null
    reviewed_at: Date | null
    notified_at: Date | null
  }>(
    `select partner_slug, message, status, reviewed_by, reviewed_at, notified_at
       from platform.calculator_requests where id = $1`,
    [id],
  )
  return rows[0]
}

async function countRequests(slug: string): Promise<number> {
  const rows = await sql<{ n: number }>(
    `select count(*)::int as n from platform.calculator_requests where partner_slug = $1`,
    [slug],
  )
  return rows[0]!.n
}

/** Die WIRKUNG, nicht die Zeile: derselbe Lesepfad, den der Kalkulator benutzt (T4-2). */
async function myEntitlement(user: TestUser, product: string): Promise<boolean> {
  return runAs({ role: 'authenticated', userId: user.id }, async (c) => {
    const { rows } = await c.query<{ r: boolean }>(`select public.get_my_entitlement($1) as r`, [
      product,
    ])
    return rows[0]!.r
  })
}

async function entitlementRow(userId: string, product = 'calculator_pro') {
  const rows = await sql<{
    is_active: boolean
    valid_until: Date | null
    source: string
    note: string | null
  }>(
    `select is_active, valid_until, source, note from platform.entitlements
      where user_id = $1 and product = $2`,
    [userId, product],
  )
  return rows[0]
}

beforeAll(assertStackReachable)

afterAll(async () => {
  // Reihenfolge ist bindend: `calculator_requests.partner_slug` ist `on delete restrict` — ohne
  // das Löschen der Anfragen bliebe der Fachbetrieb stehen (und mit ihm sein Konto-Verweis).
  if (spawnedPartners.length) {
    await sql(`delete from platform.calculator_requests where partner_slug = any($1)`, [
      spawnedPartners,
    ])
    await sql(`delete from platform.partners where slug = any($1)`, [spawnedPartners])
  }
  for (const id of spawnedUsers) await deleteUser(id)
})

describe('B18-4 — Struktur und Rechtefläche', () => {
  it('führt ein EIGENES Statusenum mit genau drei Werten', async () => {
    const rows = await sql<{ vals: string[] }>(
      `select array_agg(e.enumlabel::text order by e.enumsortorder) as vals
         from pg_type t join pg_enum e on e.enumtypid = t.oid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'platform' and t.typname = 'calculator_request_status'`,
    )
    expect(rows[0]?.vals).toEqual(['pending', 'approved', 'rejected'])

    // Und es ist NICHT derselbe Typ wie der der Partner-Bewerbungen — die Werte stimmen heute
    // überein, die Lebenszyklen nicht (s. Kopf der Migration).
    const distinct = await sql<{ n: number }>(
      `select count(distinct t.oid)::int as n
         from pg_type t join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'platform'
          and t.typname in ('calculator_request_status', 'partner_application_status')`,
    )
    expect(distinct[0]?.n).toBe(2)
  })

  it('hat RLS an und für KEINE Rolle irgendein Tabellenrecht', async () => {
    const rls = await sql<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname = 'calculator_requests'`,
    )
    expect(rls[0]?.relrowsecurity).toBe(true)

    const grants = await sql<{
      rolname: string
      sel: boolean
      ins: boolean
      upd: boolean
      del: boolean
    }>(
      `select rolname,
              has_table_privilege(rolname, 'platform.calculator_requests', 'select') as sel,
              has_table_privilege(rolname, 'platform.calculator_requests', 'insert') as ins,
              has_table_privilege(rolname, 'platform.calculator_requests', 'update') as upd,
              has_table_privilege(rolname, 'platform.calculator_requests', 'delete') as del
         from unnest(array['anon','authenticated','service_role']) as rolname`,
    )
    for (const g of grants) {
      expect({ role: g.rolname, ...g }).toMatchObject({ sel: false, ins: false, upd: false, del: false })
    }
  })

  it('grantet alle vier Wrapper AUSSCHLIESSLICH an authenticated (has_function_privilege)', async () => {
    const rows = await sql<{ proname: string; rolname: string; ex: boolean; overloads: number }>(
      `select p.proname, r.rolname,
              has_function_privilege(r.rolname, p.oid, 'execute') as ex,
              count(*) over (partition by p.proname)::int / 3 as overloads
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        cross join unnest(array['anon','authenticated','service_role']) as r(rolname)
        where n.nspname = 'public'
          and p.proname in ('submit_calculator_request', 'admin_decide_calculator_request',
                            'admin_list_calculator_requests', 'admin_mark_calculator_request_notified')
        order by p.proname, r.rolname`,
    )
    expect(rows).toHaveLength(12)
    for (const r of rows) {
      expect({ fn: r.proname, role: r.rolname, ex: r.ex }).toEqual({
        fn: r.proname,
        role: r.rolname,
        ex: r.rolname === 'authenticated',
      })
      // Genau EINE Überladung je Funktion — sonst wäre ein Aufruf mehrdeutig.
      expect(r.overloads).toBe(1)
    }
  })

  it('hat für den Vermerk KEINEN Zeitstempel-Parameter und kein Gegenstück zum Nullen', async () => {
    const rows = await sql<{ args: string[] | null }>(
      `select p.proargnames as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_mark_calculator_request_notified'`,
    )
    expect(rows[0]?.args).toEqual(['p_id'])

    const clearing = await sql<{ n: number }>(
      `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname ilike '%calculator_request%'
          and (p.proname ilike '%unnotif%' or p.proname ilike '%clear%' or p.proname ilike '%delete%')`,
    )
    expect(clearing[0]?.n).toBe(0)
  })
})

describe('B18-4 — submit_calculator_request', () => {
  it('legt für einen AKTIVEN Partner eine offene Anfrage an', async () => {
    const { user, slug } = await newLinkedPartner()
    const res = await submit(user, '  Wir wollen Lastgänge für Bestandskunden rechnen.  ')

    expect(res.status).toBe('ok')
    const row = await readRequest(res.request_id)
    expect(row).toMatchObject({
      partner_slug: slug,
      // Umgebende Leerzeichen fallen weg — gespeichert wird, was gemessen wurde.
      message: 'Wir wollen Lastgänge für Bestandskunden rechnen.',
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      notified_at: null,
    })
  })

  it('antwortet für ein Konto OHNE Partnerzeile, für einen STILLGELEGTEN Partner und ohne Sitzung identisch', async () => {
    const plain = await newPlainUser()
    expect(await submit(plain, 'Bitte freischalten.')).toEqual({ status: 'none' })

    const inactiveUser = await newPlainUser()
    const inactiveSlug = await newPartner({ userId: inactiveUser.id, isActive: false })
    expect(await submit(inactiveUser, 'Bitte freischalten.')).toEqual({ status: 'none' })
    expect(await countRequests(inactiveSlug)).toBe(0)

    // Ohne Sitzung ist auth.uid() null — der Wrapper hat für `authenticated` ein Grant, die
    // Ablehnung erfolgt im Rumpf (Arbeitsregel 5: dieser Aufruf ist sicher).
    expect(await submit(null, 'Bitte freischalten.')).toEqual({ status: 'none' })
  })

  it('weist leeren Text ab und legt dabei NICHTS an', async () => {
    const { user, slug } = await newLinkedPartner()
    expect(await submit(user, '   ')).toEqual({ status: 'missing_fields' })
    expect(await submit(user, '')).toEqual({ status: 'missing_fields' })
    expect(await countRequests(slug)).toBe(0)
  })

  it('weist zu langen Text mit eigenem Status ab, nimmt genau 4000 Zeichen an', async () => {
    const { user, slug } = await newLinkedPartner()

    const tooLong = await submit(user, 'x'.repeat(4001))
    expect(tooLong).toMatchObject({ status: 'message_too_long', max_length: 4000 })
    expect(await countRequests(slug)).toBe(0)

    const ok = await submit(user, 'y'.repeat(4000))
    expect(ok.status).toBe('ok')
    expect(await countRequests(slug)).toBe(1)
  })

  it('weist eine ZWEITE Einreichung bei offener Anfrage ab — mit Kennung und Zeitpunkt', async () => {
    const { user, slug } = await newLinkedPartner()
    const first = await submit(user, 'Erste Anfrage.')

    const second = await submit(user, 'Zweite Anfrage.')
    expect(second.status).toBe('already_pending')
    expect(second.request_id).toBe(first.request_id)
    expect(second.created_at).toBeTruthy()

    // Der Text der zweiten Absendung ist NICHT angekommen — und es gibt weiterhin genau eine Zeile.
    expect(await countRequests(slug)).toBe(1)
    expect((await readRequest(first.request_id))?.message).toBe('Erste Anfrage.')
  })

  it('⚠ der partielle UNIQUE-Index ist die harte Schicht darunter (23505)', async () => {
    const { user, slug } = await newLinkedPartner()
    await submit(user, 'Erste Anfrage.')

    // Am Wrapper vorbei, als `postgres` — genau der Fall, den zwei gleichzeitige Absendungen
    // erzeugen könnten, wenn beide die Vorprüfung passieren.
    await expect(
      sql(`insert into platform.calculator_requests (partner_slug, message) values ($1, 'Zweite.')`, [
        slug,
      ]),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('erlaubt eine neue Anfrage nach ABLEHNUNG und nach GENEHMIGUNG', async () => {
    const admin = await newAdmin()
    const { user, slug } = await newLinkedPartner()

    const first = await submit(user, 'Erste Anfrage.')
    expect((await decide(admin, first.request_id, 'rejected')).status).toBe('ok')
    const second = await submit(user, 'Zweite Anfrage.')
    expect(second.status).toBe('ok')

    expect((await decide(admin, second.request_id, 'approved')).status).toBe('ok')
    const third = await submit(user, 'Dritte Anfrage.')
    expect(third.status).toBe('ok')

    expect(await countRequests(slug)).toBe(3)
  })

  it('bindet an das eigene Konto — zwei Betriebe nebeneinander (beide Richtungen)', async () => {
    const a = await newLinkedPartner('Alpha Elektro GmbH')
    const b = await newLinkedPartner('Beta Elektro GmbH')

    const resA = await submit(a.user, 'Anfrage von Alpha.')
    const resB = await submit(b.user, 'Anfrage von Beta.')

    expect((await readRequest(resA.request_id))?.partner_slug).toBe(a.slug)
    expect((await readRequest(resB.request_id))?.partner_slug).toBe(b.slug)
    expect(await countRequests(a.slug)).toBe(1)
    expect(await countRequests(b.slug)).toBe(1)
  })
})

describe('B18-4 — admin_decide_calculator_request', () => {
  it('WIRFT 42501 für ein eingeloggtes Konto OHNE Adminrolle und ändert nichts', async () => {
    const { user, slug } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')

    await expect(decide(user, req.request_id, 'approved')).rejects.toMatchObject({ code: '42501' })

    expect((await readRequest(req.request_id))?.status).toBe('pending')
    expect(await myEntitlement(user, 'calculator_pro')).toBe(false)
    expect(await countRequests(slug)).toBe(1)
  })

  it('weist unbekannte Anfrage, fehlende und ungültige Entscheidung ab', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')

    expect(await decide(admin, randomUUID(), 'approved')).toEqual({ status: 'not_found' })
    expect(await decide(admin, req.request_id, '  ')).toEqual({ status: 'missing_fields' })
    expect(await decide(admin, req.request_id, 'quatsch')).toEqual({ status: 'invalid_decision' })

    // Eine falsch getippte Entscheidung darf nicht die schärfere sein.
    expect((await readRequest(req.request_id))?.status).toBe('pending')
  })

  it('⚠ FREIGABE erzeugt Status UND calculator_pro-Zugang — gemessen an der WIRKUNG', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()
    const other = await newPlainUser()
    const req = await submit(user, 'Anfrage.')

    expect(await myEntitlement(user, 'calculator_pro')).toBe(false)

    const res = await decide(admin, req.request_id, 'approved')
    expect(res).toMatchObject({ status: 'ok', decision: 'approved', entitlement: 'granted' })

    const row = await readRequest(req.request_id)
    expect(row?.status).toBe('approved')
    expect(row?.reviewed_by).toBe(admin.id)
    expect(row?.reviewed_at).not.toBeNull()

    // Der Lesepfad, den der Kalkulator benutzt (T4-2) — für GENAU diesen Partner.
    expect(await myEntitlement(user, 'calculator_pro')).toBe(true)
    // ⚠ Produkt-Isolation in beide Richtungen: kein Monitor-Zugang, kein fremdes Konto.
    expect(await myEntitlement(user, 'monitor')).toBe(false)
    expect(await myEntitlement(other, 'calculator_pro')).toBe(false)

    expect(await entitlementRow(user.id)).toMatchObject({
      is_active: true,
      valid_until: null,
      source: 'manual',
    })
    // Die Herkunft steht in der Zeile — ab jetzt gibt es DREI Schreibwege in entitlements.
    expect(await entitlementRow(user.id)).toMatchObject({
      note: expect.stringContaining(String(req.request_id)),
    })
  })

  it('ABLEHNUNG setzt nur den Status — kein Entitlement', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')

    expect(await decide(admin, req.request_id, 'rejected')).toEqual({
      status: 'ok',
      decision: 'rejected',
    })

    const row = await readRequest(req.request_id)
    expect(row?.status).toBe('rejected')
    expect(row?.reviewed_by).toBe(admin.id)
    expect(row?.reviewed_at).not.toBeNull()

    expect(await myEntitlement(user, 'calculator_pro')).toBe(false)
    expect(await entitlementRow(user.id)).toBeUndefined()
  })

  it('lässt keine ZWEITE Entscheidung zu und nennt den aktuellen Stand', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')

    await decide(admin, req.request_id, 'approved')
    const before = await readRequest(req.request_id)

    expect(await decide(admin, req.request_id, 'rejected')).toEqual({
      status: 'already_reviewed',
      current: 'approved',
    })

    // Kein zweiter Zeitstempel — die Prüfung ist eine einmalige Handlung.
    const after = await readRequest(req.request_id)
    expect(after?.status).toBe('approved')
    expect(after?.reviewed_at?.getTime()).toBe(before?.reviewed_at?.getTime())
    expect(await myEntitlement(user, 'calculator_pro')).toBe(true)
  })

  it('⚠ überschreibt einen BESTEHENDEN aktiven Zugang nicht (Stripe-Sync bleibt intakt)', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()

    // Ein bereits bestehender Zugang aus einer anderen Quelle — hier mit eigenem Vermerk, damit
    // sichtbar wird, ob die Zeile angefasst wurde.
    await sql(
      `insert into platform.entitlements (user_id, product, is_active, valid_until, source, note)
       values ($1, 'calculator_pro', true, null, 'manual', 'VORBESTAND')`,
      [user.id],
    )

    const req = await submit(user, 'Anfrage.')
    const res = await decide(admin, req.request_id, 'approved')

    expect(res).toMatchObject({ status: 'ok', entitlement: 'already_active' })
    expect((await readRequest(req.request_id))?.status).toBe('approved')
    // Die Zeile ist unangetastet — insbesondere ihre Herkunft.
    expect((await entitlementRow(user.id))?.note).toBe('VORBESTAND')
    expect(await myEntitlement(user, 'calculator_pro')).toBe(true)
  })

  it('⚠ no_account gilt NUR fürs Freigeben — Ablehnen bleibt möglich', async () => {
    const admin = await newAdmin()
    const { user, slug } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')

    // Der reale Weg dorthin: das Konto wird gelöscht, `on delete set null` nullt die Spalte.
    await sql(`update platform.partners set user_id = null where slug = $1`, [slug])

    expect(await decide(admin, req.request_id, 'approved')).toEqual({ status: 'no_account' })
    expect((await readRequest(req.request_id))?.status).toBe('pending')

    expect(await decide(admin, req.request_id, 'rejected')).toEqual({
      status: 'ok',
      decision: 'rejected',
    })
    expect((await readRequest(req.request_id))?.status).toBe('rejected')
  })

  it('entscheidet auch über einen STILLGELEGTEN Fachbetrieb', async () => {
    const admin = await newAdmin()
    const { user, slug } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')

    // Stilllegung NACH der Absendung — der Betrieb kann nichts Neues einreichen, die offene Anfrage
    // bleibt aber entscheidbar (Stilllegung betrifft die Empfehlungslinks, nicht das Werkzeug).
    await sql(`update platform.partners set is_active = false where slug = $1`, [slug])
    expect(await submit(user, 'Noch eine.')).toEqual({ status: 'none' })

    expect(await decide(admin, req.request_id, 'approved')).toMatchObject({ status: 'ok' })
    expect(await myEntitlement(user, 'calculator_pro')).toBe(true)
  })

  it('⚠ ATOMAR: scheitert das Entitlement, bleibt die Anfrage unangetastet pending', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')

    // Das Anlegen des Entitlements künstlich zum Scheitern bringen. Alle bekannten Fehlerfälle
    // werden vorher als Status beantwortet — ohne diesen Eingriff liesse sich die Atomarität nicht
    // beobachten.
    await sql(`create function pg_temp_fail_entitlement() returns trigger language plpgsql as $$
                 begin raise exception 'B18-4-Gate: Entitlement absichtlich blockiert'; end $$`)
    await sql(`create trigger zz_b184_gate_block before insert or update
                 on platform.entitlements for each row
                 when (new.product = 'calculator_pro')
                 execute function pg_temp_fail_entitlement()`)
    try {
      await expect(decide(admin, req.request_id, 'approved')).rejects.toThrow(
        /absichtlich blockiert/,
      )
    } finally {
      await sql(`drop trigger zz_b184_gate_block on platform.entitlements`)
      await sql(`drop function pg_temp_fail_entitlement()`)
    }

    const row = await readRequest(req.request_id)
    expect(row?.status).toBe('pending')
    expect(row?.reviewed_at).toBeNull()
    expect(row?.reviewed_by).toBeNull()
    expect(await myEntitlement(user, 'calculator_pro')).toBe(false)

    // Gegenprobe ohne Sperre: derselbe Aufruf läuft durch.
    expect(await decide(admin, req.request_id, 'approved')).toMatchObject({ status: 'ok' })
    expect(await myEntitlement(user, 'calculator_pro')).toBe(true)
  })
})

describe('B18-4 — admin_list_calculator_requests', () => {
  it('WIRFT 42501 für ein eingeloggtes Konto ohne Adminrolle (statt leer zu antworten)', async () => {
    const { user } = await newLinkedPartner()
    await expect(listRequests(user)).rejects.toMatchObject({ code: '42501' })
  })

  it('weist einen unbekannten Statusfilter AB, statt ihn still zu ignorieren', async () => {
    const admin = await newAdmin()
    expect(await listRequests(admin, 'quatsch')).toEqual({
      status: 'invalid_filter',
      field: 'status',
    })
  })

  it('liefert Freitext, Status und die Partner-IDENTITÄT als lesbaren Namen', async () => {
    const admin = await newAdmin()
    const { user, slug } = await newLinkedPartner('Raymann Elektrotechnik GmbH')
    const req = await submit(user, 'Wir wollen zehn Bestandskunden durchrechnen.')

    const list = await listRequests(admin, 'pending')
    const row = (list.requests as Json[]).find((r) => r.id === req.request_id)

    expect(row).toMatchObject({
      partner_slug: slug,
      partner_display_name: 'Raymann Elektrotechnik GmbH',
      partner_is_active: true,
      account_email: user.email,
      message: 'Wir wollen zehn Bestandskunden durchrechnen.',
      status: 'pending',
      reviewed_at: null,
      reviewed_by_email: null,
      notified_at: null,
    })
  })

  it('zählt TREFFER (nicht den Bestand) und filtert nach Status', async () => {
    const admin = await newAdmin()
    const before = (await listRequests(admin, 'approved')).total as number

    const { user } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')
    await decide(admin, req.request_id, 'approved')

    const approved = await listRequests(admin, 'approved')
    expect((approved.total as number) - before).toBe(1)
    expect((approved.requests as Json[]).some((r) => r.id === req.request_id)).toBe(true)

    // Dieselbe Anfrage darf im Gegenfilter NICHT erscheinen.
    const pending = await listRequests(admin, 'pending')
    expect((pending.requests as Json[]).some((r) => r.id === req.request_id)).toBe(false)

    // Die Prüferadresse steht nach der Entscheidung an der Zeile.
    const row = (approved.requests as Json[]).find((r) => r.id === req.request_id)
    expect(row?.reviewed_by_email).toBe(admin.email)
  })

  it('deckelt limit und offset, ohne zu werfen', async () => {
    const admin = await newAdmin()
    const capped = await listRequests(admin, null, 9999, -5)
    expect(capped).toMatchObject({ status: 'ok', limit: 200, offset: 0 })
  })
})

describe('B18-4 — admin_mark_calculator_request_notified', () => {
  it('WIRFT 42501 ohne Adminrolle und kennt unbekannte Anfragen', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')
    await decide(admin, req.request_id, 'approved')

    await expect(markNotified(user, req.request_id)).rejects.toMatchObject({ code: '42501' })
    expect(await markNotified(admin, randomUUID())).toEqual({ status: 'not_found' })
    expect((await readRequest(req.request_id))?.notified_at).toBeNull()
  })

  it('vermerkt nur an einer GENEHMIGTEN Anfrage', async () => {
    const admin = await newAdmin()
    const a = await newLinkedPartner()
    const b = await newLinkedPartner()

    const pending = await submit(a.user, 'Anfrage.')
    expect(await markNotified(admin, pending.request_id)).toEqual({
      status: 'not_approved',
      current: 'pending',
    })

    const rejected = await submit(b.user, 'Anfrage.')
    await decide(admin, rejected.request_id, 'rejected')
    expect(await markNotified(admin, rejected.request_id)).toEqual({
      status: 'not_approved',
      current: 'rejected',
    })
    expect((await readRequest(rejected.request_id))?.notified_at).toBeNull()

    await decide(admin, pending.request_id, 'approved')
    const ok = await markNotified(admin, pending.request_id)
    expect(ok.status).toBe('ok')
    expect((await readRequest(pending.request_id))?.notified_at).not.toBeNull()
  })

  it('⚠ der CHECK ist die Schicht darunter (23514, auch für postgres)', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')
    await decide(admin, req.request_id, 'rejected')

    await expect(
      sql(`update platform.calculator_requests set notified_at = now() where id = $1`, [
        req.request_id,
      ]),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('B18-4 — referentielle Sicherungen', () => {
  it('⚠ ein Fachbetrieb mit Anfragen ist nicht löschbar (on delete restrict, 23503)', async () => {
    const { user, slug } = await newLinkedPartner()
    await submit(user, 'Anfrage.')

    // `platform.partners` hat für KEINE Rolle ein delete-Grant; hier zählt die referentielle
    // Aktion, also als `postgres` geprüft.
    await expect(sql(`delete from platform.partners where slug = $1`, [slug])).rejects.toMatchObject(
      { code: '23503' },
    )
  })

  it('⚠ das Konto des Prüfers bleibt löschbar — der Vorgang bleibt belegt', async () => {
    const admin = await newAdmin()
    const { user } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')
    await decide(admin, req.request_id, 'approved')
    expect((await readRequest(req.request_id))?.reviewed_by).toBe(admin.id)

    // Der echte Löschweg (GoTrue-Admin-API) — die Asymmetrie-Familie: `on delete set null` ist
    // selbst ein UPDATE. Es gibt hier keinen Unveränderlichkeits-Trigger, der ihm im Weg stünde,
    // und genau das wird gemessen statt angenommen.
    await deleteUser(admin.id)
    spawnedUsers.splice(spawnedUsers.indexOf(admin.id), 1)

    const row = await readRequest(req.request_id)
    expect(row?.reviewed_by).toBeNull()
    expect(row?.reviewed_at).not.toBeNull()
    expect(row?.status).toBe('approved')
  })

  it('⚠ das Konto des PARTNERS bleibt löschbar — die Anfrage überlebt, der Zugang fällt weg', async () => {
    const admin = await newAdmin()
    const { user, slug } = await newLinkedPartner()
    const req = await submit(user, 'Anfrage.')
    await decide(admin, req.request_id, 'approved')

    // `platform.entitlements.user_id` ist `on delete cascade` (I8) — der Zugang verschwindet mit
    // dem Konto. Die Anfrage hängt am BETRIEB und bleibt bestehen; das ist der Grund, warum sie
    // nicht am Konto hängt.
    await deleteUser(user.id)
    spawnedUsers.splice(spawnedUsers.indexOf(user.id), 1)

    const row = await readRequest(req.request_id)
    expect(row?.status).toBe('approved')
    expect(row?.partner_slug).toBe(slug)

    const ent = await sql<{ n: number }>(
      `select count(*)::int as n from platform.entitlements where user_id = $1`,
      [user.id],
    )
    expect(ent[0]?.n).toBe(0)

    const partner = await sql<{ user_id: string | null }>(
      `select user_id from platform.partners where slug = $1`,
      [slug],
    )
    expect(partner[0]?.user_id).toBeNull()
  })
})
