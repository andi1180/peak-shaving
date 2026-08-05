// DB-Gate für die formlos genannten Firmen
// (Migration 20260805120000_create_mentioned_businesses.sql, B19-Nachbesserung).
//
// ── WORAN DIESER SCHRITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ────────────────────────
// (1) ⚠ DER GANZE ZWECK DER TRENNUNG: eine formlos genannte Firma darf NIE zu einem Zugriffsrecht
//     werden. `platform.leads.partner_slug` ist seit B18-6 der Schlüssel, über den
//     `public.get_my_partner_leads` einem angemeldeten Fachbetrieb SEINE Anfragen MIT NAMEN zeigt.
//     Ein Name, den jemand am Telefon gehört hat, hat weder Bewerbung (B16-3) noch Prüfung noch
//     Genehmigung (B16-4a) noch ein Konto durchlaufen. Deshalb wird hier gemessen, dass ein Lead
//     mit formloser Erwähnung bei KEINEM echten Partner auftaucht — auch nicht bei einem, dessen
//     Anzeigename dem genannten Betrieb zum Verwechseln ähnlich sieht.
// (2) ⚠ ES ENTSTEHT KEINE ZEILE IN `platform.partners`. Nicht als Nebenfolge, nicht mit
//     `is_active = false`. Ein stillgelegter Partner wäre eine Zeitbombe: der Slug wäre
//     unwiderruflich vergeben (B16-1, kein `delete`-Grant), und ein späterer Klick auf „aktivieren"
//     schaltete rückwirkend den Zugriff auf alle so zugeordneten Leads frei.
// (3) WIEDERFINDBARKEIT IST DER GRUND, WARUM ES DIE TABELLE GIBT. Derselbe Betrieb beim zweiten
//     Anruf — in anderer Schreibweise getippt — muss auf DENSELBEN Eintrag laufen, sonst steht die
//     Auswahlliste voll mit „Elektro Huber", „elektro huber " und niemand wählt mehr aus.
// (4) DIE BEIDEN SPALTEN SIND UNABHÄNGIG. Es gibt bewusst KEINEN CHECK gegen die gleichzeitige
//     Belegung: ein Lead kann über den Link von Betrieb A gekommen sein und beim Rückruf Betrieb B
//     genannt haben. Beides ist wahr.
// (5) DIE ANONYMISIERUNG. `mentioned_business_id` überlebt sie (wie `partner_slug`, B16-1),
//     `referred_by_text` nicht. Beide Richtungen werden gemessen — und dass der Wrapper einen
//     anonymisierten Lead trotzdem nicht mehr beschreiben lässt (die Spalte steht bewusst nicht im
//     Guard, DIESE Prüfung ist der Grund, warum das trotzdem hält).
// (6) DIE RECHTEFLÄCHE. Beide Wrapper sind authenticated-only und WERFEN 42501 statt leer zu
//     antworten; auf der Tabelle hat KEINE Rolle irgendein Recht.
// (7) BEIDE WRAPPER WERDEN TATSÄCHLICH AUFGERUFEN (Arbeitsregel 2): Introspektion beweist Existenz,
//     nicht Lauffähigkeit — plpgsql prüft Funktionsrümpfe nicht beim Anlegen.
//
// ⚠ ARBEITSREGEL 5: Fehlende Aufrufbarkeit wird mit `has_function_privilege` geprüft, NIE durch
//     einen Aufruf als Rolle ohne Grant — ein solcher Aufruf hat im CI-Lauf von B16-4a den
//     Postgres-Prozess mit Signal 11 beendet. Der eingeloggte NICHT-Admin ist der zulässige
//     Aufruf-Test: er HAT ein Grant, und die Ablehnung erfolgt im Funktionsrumpf.
//
// ── ISOLATION GEGEN DEN ÜBRIGEN BESTAND ─────────────────────────────────────────────────────────
// Der UNIQUE-Index auf `lower(btrim(name))` ist GLOBAL, und vitest fährt Testdateien parallel gegen
// dieselbe Datenbank. Jeder Firmenname dieses Gates trägt deshalb eine zufällige Kennung, und
// Zählungen laufen als DELTA oder über die eigene Kennung.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
  assertStackReachable,
  createUser,
  deleteUser,
  pool,
  runAs,
  sql,
  type TestUser,
} from './client'

const spawnedUsers: string[] = []
const spawnedLeads: string[] = []
const spawnedPartners: string[] = []
const spawnedBusinesses: string[] = []

function newName(label = 'Elektro'): string {
  return `${label} Gate-${randomUUID().slice(0, 8)}`
}

function newEmail(): string {
  return `gate-b19n-${randomUUID().slice(0, 8)}@example.test`
}

function newSlug(): string {
  return `gate-b19n-${randomUUID().slice(0, 8)}`
}

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

async function newAdmin(): Promise<TestUser> {
  const u = await newUser()
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

/** Ein echter Fachbetrieb — reines Fixture-Setup als `postgres` (Muster `partner-portal.test.ts`). */
async function newPartner(userId: string, displayName = 'Elektro Musterbetrieb GmbH'): Promise<string> {
  const slug = newSlug()
  await sql(
    `insert into platform.partners (slug, display_name, user_id, is_active)
     values ($1, $2, $3, true)`,
    [slug, displayName, userId],
  )
  spawnedPartners.push(slug)
  return slug
}

/** Der Weg der Aufnahme: `public.capture_lead` als service_role (wie `lib/leads/store.ts`). */
async function newLead(args: Record<string, unknown> = {}): Promise<string> {
  const params = {
    p_email: newEmail(),
    p_source_key: 'telefonanfrage',
    p_company: 'Tischlerei Gruber',
    p_first_name: 'Anna',
    p_last_name: 'Gruber',
    ...args,
  }
  const keys = Object.keys(params)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  const res = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: { lead_id: string } }>(
      `select public.capture_lead(${named}) as r`,
      keys.map((k) => params[k as keyof typeof params]),
    )
    return rows[0]!.r
  })
  spawnedLeads.push(res.lead_id)
  return res.lead_id
}

type AttachResult = {
  status: string
  business_id?: string
  name?: string
  created?: boolean
}

async function attach(
  user: TestUser,
  leadId: string | null,
  args: { businessId?: string | null; name?: string | null },
): Promise<AttachResult> {
  const res = await runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: AttachResult }>(
      `select public.admin_attach_mentioned_business(
         p_lead_id => $1, p_business_id => $2, p_name => $3
       ) as r`,
      [leadId, args.businessId ?? null, args.name ?? null],
    )
    return rows[0]!.r
  })
  if (res.status === 'ok' && res.business_id && !spawnedBusinesses.includes(res.business_id)) {
    spawnedBusinesses.push(res.business_id)
  }
  return res
}

type BusinessList = { status: string; businesses?: Record<string, unknown>[] }

async function listBusinesses(user: TestUser): Promise<BusinessList> {
  return runAs({ role: 'authenticated', userId: user.id }, async (c) => {
    const { rows } = await c.query<{ r: BusinessList }>(
      `select public.admin_list_mentioned_businesses() as r`,
    )
    return rows[0]!.r
  })
}

type PartnerLeads = { status: string; total?: number; leads?: Record<string, unknown>[] }

async function getMyPartnerLeads(user: TestUser): Promise<PartnerLeads> {
  return runAs({ role: 'authenticated', userId: user.id }, async (c) => {
    const { rows } = await c.query<{ r: PartnerLeads }>(`select public.get_my_partner_leads() as r`)
    return rows[0]!.r
  })
}

async function readLead(id: string) {
  const rows = await sql<{
    partner_slug: string | null
    mentioned_business_id: string | null
    referred_by_text: string | null
    anonymized_at: string | null
  }>(
    `select partner_slug, mentioned_business_id, referred_by_text, anonymized_at
       from platform.leads where id = $1`,
    [id],
  )
  return rows[0]
}

async function countPartners(): Promise<number> {
  const rows = await sql<{ n: number }>('select count(*)::int as n from platform.partners')
  return rows[0]!.n
}

/** EXECUTE-Rechte per Katalog — kein Aufruf (Arbeitsregel 5). */
async function executeGrants(fn: string): Promise<Record<string, boolean>> {
  const rows = await sql<{ rolname: string; ex: boolean }>(
    `select r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as ex
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace,
            (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
      where n.nspname = 'public' and p.proname = $1`,
    [fn],
  )
  return Object.fromEntries(rows.map((r) => [r.rolname, r.ex]))
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  for (const id of spawnedBusinesses.splice(0)) {
    await sql('delete from platform.mentioned_businesses where id = $1', [id])
  }
  for (const slug of spawnedPartners.splice(0)) {
    await sql('delete from platform.partners where slug = $1', [slug])
  }
  for (const id of spawnedUsers.splice(0)) {
    await deleteUser(id)
  }
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Die Rechtefläche ─────────────────────────────────────────────────────────────────────────
describe('(1) Rechte — authenticated-only, Tabelle für niemanden', () => {
  it('beide Wrapper sind ausschliesslich für authenticated aufrufbar', async () => {
    for (const fn of ['admin_list_mentioned_businesses', 'admin_attach_mentioned_business']) {
      const grants = await executeGrants(fn)
      expect(grants.authenticated, fn).toBe(true)
      expect(grants.anon, fn).toBe(false)
      // service_role bekommt bewusst NICHTS: die Autorisierung leitet sich aus auth.uid() ab, das
      // dort null ist — der Aufruf wäre stets abgelehnt und das Grant blosse Fläche.
      expect(grants.service_role, fn).toBe(false)
    }
  })

  it('auf platform.mentioned_businesses hat KEINE Rolle irgendein Tabellenrecht', async () => {
    const rows = await sql<{ rolname: string; priv: string; ok: boolean }>(
      `select r.rolname, p.priv,
              has_table_privilege(r.rolname, 'platform.mentioned_businesses', p.priv) as ok
         from (values ('anon'), ('authenticated'), ('service_role')) as r(rolname),
              (values ('select'), ('insert'), ('update'), ('delete')) as p(priv)`,
    )
    expect(rows.filter((r) => r.ok)).toEqual([])
  })

  it('RLS ist aktiv und es gibt keine Policy', async () => {
    const rows = await sql<{ rls: boolean; policies: number }>(
      `select c.relrowsecurity as rls,
              (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname = 'mentioned_businesses'`,
    )
    expect(rows[0]?.rls).toBe(true)
    expect(rows[0]?.policies).toBe(0)
  })

  it('ein eingeloggter NICHT-Admin wird von beiden Wrappern mit 42501 abgewiesen', async () => {
    // Zulässiger echter Aufruf: die Rolle HAT ein Grant, die Ablehnung erfolgt im Rumpf.
    const user = await newUser()
    const leadId = await newLead()

    await expect(listBusinesses(user)).rejects.toMatchObject({ code: '42501' })
    await expect(attach(user, leadId, { name: newName() })).rejects.toMatchObject({ code: '42501' })

    // …und es ist nichts entstanden.
    const lead = await readLead(leadId)
    expect(lead?.mentioned_business_id).toBeNull()
  })
})

// ── (2) Anlegen, Finden, Wiederfinden ───────────────────────────────────────────────────────────
describe('(2) Anlegen-oder-Finden — der Zweck der Ablage', () => {
  it('legt eine neue Firma an, ordnet sie zu und meldet `created`', async () => {
    const admin = await newAdmin()
    const leadId = await newLead()
    const name = newName()

    const res = await attach(admin, leadId, { name })

    expect(res.status).toBe('ok')
    expect(res.created).toBe(true)
    expect(res.name).toBe(name)

    const lead = await readLead(leadId)
    expect(lead?.mentioned_business_id).toBe(res.business_id)

    const rows = await sql<{ created_by: string | null }>(
      'select created_by from platform.mentioned_businesses where id = $1',
      [res.business_id!],
    )
    // Eine Notiz entsteht durch einen Menschen, der sie verantwortet.
    expect(rows[0]?.created_by).toBe(admin.id)
  })

  it('findet dieselbe Firma beim nächsten Anruf wieder — case- und randraum-unabhängig', async () => {
    /*
     * DAS IST DER ZWECK DES GANZEN ABSCHNITTS. Ohne diese Zusammenführung stünden „Elektro Huber",
     * „elektro huber " und „ELEKTRO HUBER" als drei Einträge in derselben Auswahlliste, und die
     * Liste selbst wäre der Grund, warum niemand mehr auswählt.
     */
    const admin = await newAdmin()
    const name = newName()

    const first = await attach(admin, await newLead(), { name })
    const second = await attach(admin, await newLead(), { name: `  ${name.toUpperCase()}  ` })

    expect(second.status).toBe('ok')
    expect(second.business_id).toBe(first.business_id)
    expect(second.created).toBe(false)
    // Zurück kommt die GESPEICHERTE Schreibweise, nicht die eingetippte.
    expect(second.name).toBe(name)

    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.mentioned_businesses
        where lower(btrim(name)) = lower($1)`,
      [name],
    )
    expect(rows[0]?.n).toBe(1)
  })

  it('ordnet eine bestehende Firma über ihre Kennung zu', async () => {
    const admin = await newAdmin()
    const created = await attach(admin, await newLead(), { name: newName() })

    const zweiterLead = await newLead()
    const res = await attach(admin, zweiterLead, { businessId: created.business_id })

    expect(res.status).toBe('ok')
    expect(res.created).toBe(false)
    expect((await readLead(zweiterLead))?.mentioned_business_id).toBe(created.business_id)
  })

  it('listet die Firma samt Lead-Zahl auf — sofort für den nächsten Anruf', async () => {
    const admin = await newAdmin()
    const name = newName()
    const created = await attach(admin, await newLead(), { name })
    await attach(admin, await newLead(), { businessId: created.business_id })

    const list = await listBusinesses(admin)
    expect(list.status).toBe('ok')
    const row = list.businesses?.find((b) => b.id === created.business_id)
    expect(row).toBeDefined()
    expect(row?.name).toBe(name)
    expect(row?.lead_count).toBe(2)
  })
})

// ── (3) Die Trennung von platform.partners ──────────────────────────────────────────────────────
describe('(3) ⚠ Eine formlose Erwähnung erzeugt NIE ein Zugriffsrecht', () => {
  it('legt keine Zeile in platform.partners an — auch keine inaktive', async () => {
    const admin = await newAdmin()
    const vorher = await countPartners()

    await attach(admin, await newLead(), { name: newName() })
    await attach(admin, await newLead(), { name: newName('Installateur') })

    expect(await countPartners()).toBe(vorher)
  })

  it('setzt niemals partner_slug', async () => {
    const admin = await newAdmin()
    const leadId = await newLead()

    await attach(admin, leadId, { name: newName() })

    expect((await readLead(leadId))?.partner_slug).toBeNull()
  })

  it('ist für KEINEN echten Fachbetrieb sichtbar — auch nicht bei ähnlichem Namen', async () => {
    /*
     * Der Kern-Test dieses Gates. Ein Fachbetrieb, dessen Anzeigename dem formlos genannten Betrieb
     * zum Verwechseln ähnlich sieht, darf die Anfrage NICHT bekommen: die Sicht hängt an
     * `partner_slug`, nicht an einer Namensähnlichkeit — und genau diese Verwechslung wäre die
     * Herausgabe eines fremden Kundenkontakts.
     */
    const admin = await newAdmin()
    const nameDerFirma = newName()

    const userA = await newUser()
    const slugA = await newPartner(userA.id, nameDerFirma) // exakt derselbe Anzeigename
    const userB = await newUser()
    await newPartner(userB.id, 'Ganz anderer Betrieb GmbH')

    const leadId = await newLead()
    await attach(admin, leadId, { name: nameDerFirma })

    for (const user of [userA, userB]) {
      const view = await getMyPartnerLeads(user)
      expect(view.status).toBe('ok')
      expect(view.total).toBe(0)
      expect(view.leads ?? []).toEqual([])
    }

    // Gegenprobe: über partner_slug WÜRDE derselbe Betrieb die Anfrage zählen.
    const kontrolle = await newLead({ p_partner_slug: slugA })
    expect(kontrolle).toBeTruthy()
    expect((await getMyPartnerLeads(userA)).total).toBe(1)
  })

  it('lässt beide Spalten unabhängig nebeneinander stehen (kein CHECK)', async () => {
    const admin = await newAdmin()
    const user = await newUser()
    const slug = await newPartner(user.id)

    const leadId = await newLead({ p_partner_slug: slug })
    const res = await attach(admin, leadId, { name: newName() })

    expect(res.status).toBe('ok')
    const lead = await readLead(leadId)
    expect(lead?.partner_slug).toBe(slug)
    expect(lead?.mentioned_business_id).toBe(res.business_id)
  })
})

// ── (4) Ablehnungen ──────────────────────────────────────────────────────────────────────────────
describe('(4) Die Ablehnungen sind laut, nicht still', () => {
  it('weist eine unbekannte Firmenkennung mit 22023 ab', async () => {
    // Still verworfen sähe die Zuordnung für die aufnehmende Person aus wie erfolgt.
    const admin = await newAdmin()
    await expect(
      attach(admin, await newLead(), { businessId: '11111111-2222-3333-4444-555555555555' }),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('weist „beides" und „keines von beidem" mit 22023 ab', async () => {
    const admin = await newAdmin()
    const leadId = await newLead()
    const created = await attach(admin, await newLead(), { name: newName() })

    await expect(attach(admin, leadId, {})).rejects.toMatchObject({ code: '22023' })
    await expect(
      attach(admin, leadId, { businessId: created.business_id, name: newName() }),
    ).rejects.toMatchObject({ code: '22023' })

    expect((await readLead(leadId))?.mentioned_business_id).toBeNull()
  })

  it('antwortet bei unbekanntem Lead mit not_found statt zu werfen', async () => {
    const admin = await newAdmin()
    const res = await attach(admin, '11111111-2222-3333-4444-555555555555', { name: newName() })
    expect(res.status).toBe('not_found')
  })
})

// ── (5) Anonymisierung ───────────────────────────────────────────────────────────────────────────
describe('(5) Anonymisierung — die Erwähnung überlebt, beschreibbar ist sie nicht mehr', () => {
  it('behält mentioned_business_id und nullt referred_by_text', async () => {
    /*
     * Dieselbe Trennlinie wie B16-1: `referred_by_text` ist der Satz eines Menschen und kann den
     * Namen eines Dritten tragen; `mentioned_business_id` verweist auf einen BETRIEB und ist ohne
     * E-Mail, Name und PLZ keine personenbezogene Angabe mehr.
     */
    const admin = await newAdmin()
    const leadId = await newLead({ p_referred_by_text: 'mein Schwager, der Elektriker Huber' })
    const res = await attach(admin, leadId, { name: newName() })

    await sql('select platform.anonymize_lead($1, $2)', [leadId, admin.id])

    const lead = await readLead(leadId)
    expect(lead?.anonymized_at).not.toBeNull()
    expect(lead?.referred_by_text).toBeNull()
    expect(lead?.mentioned_business_id).toBe(res.business_id)
  })

  it('weist einen anonymisierten Lead ab, bevor irgendetwas geschrieben wird', async () => {
    // Die Spalte steht bewusst NICHT in guard_anonymized_lead (wie partner_slug) — DIESE Prüfung
    // ist der Grund, warum sie trotzdem nicht nachträglich beschreibbar ist.
    const admin = await newAdmin()
    const leadId = await newLead()
    await sql('select platform.anonymize_lead($1, $2)', [leadId, admin.id])

    const res = await attach(admin, leadId, { name: newName() })

    expect(res.status).toBe('anonymized')
    expect((await readLead(leadId))?.mentioned_business_id).toBeNull()
  })
})

// ── (6) Die Lesestelle ──────────────────────────────────────────────────────────────────────────
describe('(6) admin_get_lead zeigt die Erwähnung', () => {
  it('liefert Kennung UND Namen — sonst wäre die Angabe schreibbar und nirgends lesbar', async () => {
    const admin = await newAdmin()
    const leadId = await newLead()
    const name = newName()
    const res = await attach(admin, leadId, { name })

    const view = await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      const { rows } = await c.query<{ r: { status: string; lead: Record<string, unknown> } }>(
        `select public.admin_get_lead($1) as r`,
        [leadId],
      )
      return rows[0]!.r
    })

    expect(view.status).toBe('ok')
    expect(view.lead.mentioned_business_id).toBe(res.business_id)
    expect(view.lead.mentioned_business_name).toBe(name)
  })
})
