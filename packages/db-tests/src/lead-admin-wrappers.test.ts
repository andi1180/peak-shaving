// DB-Gate für den Admin-Abschnitt „Leads" (B1-3)
// (Migration 20260721180000_create_lead_admin_wrappers.sql).
//
// Diese Migration öffnet die dritte Zugriffsrichtung auf den Lead-Bestand: den ANGEMELDETEN Admin.
// Erstmals SCHREIBT damit ein eingeloggter Nutzer in `platform`-Lead-Daten — bis B1-2 konnte
// `authenticated` dort ausschliesslich lesen. Das Gate beweist deshalb genau vier Dinge:
//
//   (1) ZUGRIFFSGRENZE — jeder der sechs neuen Wrapper lehnt einen eingeloggten NICHT-Admin mit
//       einem FEHLER ab (nicht mit einer leeren Antwort: „kein Zugriff" darf sich nie als „nichts
//       gefunden" lesen lassen), und die Grant-Fläche ist exakt `authenticated`.
//   (2) AUFBEWAHRUNG — der Statuswechsel auf 'customer' hebt die Rechtsgrundlage auf 'commercial'
//       und die Frist auf 84 Monate; der Rückweg wird abgelehnt.
//   (3) ANONYMISIERUNG — sie entfernt die Identitätsmerkmale, lässt Nachweis und Sperrliste stehen,
//       ist idempotent und UNUMKEHRBAR — auch für service_role und für postgres.
//   (4) FILTER — die Trefferzahl gehört zur gefilterten Menge, nicht zum Gesamtbestand.
//
// ── WARUM (3) HIER STEHT UND NICHT IN apps/web ───────────────────────────────────────────────────
// „Unumkehrbar" ist eine Aussage über die Datenbank, nicht über eine React-Seite. Eine deaktivierte
// Schaltfläche beweist nichts; der Beweis ist, dass ein UPDATE unter der PRIVILEGIERTESTEN
// verfügbaren Rolle scheitert.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ──────────────────────────────────────
// Wie in allen bisherigen Wrapper-Gates: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant. `has_function_privilege` ist dieselbe
// Wahrheit, nur ohne Absturz der geteilten Test-/CI-Datenbank. Die Ablehnung des eingeloggten
// NICHT-Admins wird dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und genau die
// Ablehnung IN der Funktion ist die zu beweisende Eigenschaft.
//
// ── AUFRÄUMEN ────────────────────────────────────────────────────────────────────────────────────
// Wie in den B1-1-/B1-2-Gates: Leads hängen nicht an auth.users, es gibt keinen Cascade von aussen.
// Jeder Test räumt seine Leads (Cascade nimmt die Einwilligungen mit) und Sperrlisten-Einträge
// selbst ab, privilegiert als postgres — service_role hat bewusst kein delete-Grant.

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

/** Die sechs Wrapper, die B1-3 neu anlegt (admin_list_leads/admin_get_lead stammen aus B1-1). */
const B1_3_WRAPPERS = [
  'admin_set_lead_status',
  'admin_withdraw_consent',
  'admin_suppress_lead',
  'admin_anonymize_lead',
  'admin_is_email_suppressed',
  'admin_suppression_count',
] as const

const spawnedUsers: string[] = []
const spawnedLeads: string[] = []
const spawnedSuppressionHashes: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

/** Admin per direktem user_roles-Insert (Muster wie das T4-4-/B1-1-Gate). */
async function makeAdmin(userId: string): Promise<TestUser['id']> {
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [userId])
  return userId
}

async function newAdmin(): Promise<TestUser> {
  const u = await newUser()
  await makeAdmin(u.id)
  return u
}

interface TestLead {
  id: string
  email: string
}

/** Legt einen Lead auf dem REALEN Schreibpfad an (service_role, committed). */
async function newLead(
  opts: { sourceKey?: string; company?: string; dueDaysAgo?: number } = {},
): Promise<TestLead> {
  const email = `b13-${randomUUID()}@test.local`
  const id = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into platform.leads
         (email, first_source_key, company, first_name, last_name, phone, last_interaction_at)
       values ($1, $2, $3, 'Max', 'Muster', '+43 1 0000', now() - make_interval(days => $4::int))
       returning id`,
      [email, opts.sourceKey ?? 'kontaktformular', opts.company ?? 'DB-Gate GmbH', opts.dueDaysAgo ?? 0],
    )
    return rows[0]!.id
  })
  spawnedLeads.push(id)
  return { id, email }
}

/**
 * Setzt die sechs Segmentierungsmerkmale aus B3-1 auf einem bestehenden Lead (service_role,
 * committed). Getrennt von `newLead`, damit die vorhandenen B1-3-Tests unverändert bleiben.
 */
async function setSegments(leadId: string): Promise<void> {
  await runAs({ role: 'service_role', commit: true }, (c) =>
    c.query(
      `update platform.leads
          set industry = 'kuehlhaus',
              postal_code = '1100',
              annual_consumption_kwh = 180000,
              metering_type = 'netzebene_7',
              supplier = 'Wien Energie',
              contract_end_date = date '2027-03-31'
        where id = $1`,
      [leadId],
    ),
  )
}

/** Der Segmentierungs-Ausschnitt einer Lead-Zeile (B3-1). `date` als TEXT, s. leadRow. */
async function segmentRow(id: string) {
  const rows = await sql<{
    industry: string | null
    postal_code: string | null
    annual_consumption_kwh: number | null
    metering_type: string | null
    supplier: string | null
    contract_end_date: string | null
  }>(
    `select industry, postal_code, annual_consumption_kwh, metering_type, supplier,
            contract_end_date::text as contract_end_date
       from platform.leads where id = $1`,
    [id],
  )
  return rows[0]!
}

async function consentTextId(purpose: string): Promise<string> {
  const rows = await sql<{ id: string }>(
    `select id from platform.consent_texts where purpose = $1 and version = 1 and locale = 'de'`,
    [purpose],
  )
  return rows[0]!.id
}

/** Einwilligung auf dem realen Schreibpfad — MIT source_ip/user_agent, die die Anonymisierung nullt. */
async function insertConsent(fields: {
  leadId: string
  purpose: string
  status?: string
  confirmedAt?: string | null
  tokenExpiresIn?: string | null
}): Promise<string> {
  const textId = await consentTextId(fields.purpose)
  return runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into platform.consents
         (lead_id, consent_text_id, source_key, status, confirmed_at, source_ip, user_agent,
          token_hash, token_expires_at)
       values ($1, $2, 'kontaktformular', $3, $4, '203.0.113.7', 'db-gate/1.0',
               $5, case when $6::text is null then null else now() + $6::interval end)
       returning id`,
      [
        fields.leadId,
        textId,
        fields.status ?? 'pending',
        fields.confirmedAt ?? null,
        fields.tokenExpiresIn === undefined ? null : randomUUID(),
        fields.tokenExpiresIn ?? null,
      ],
    )
    return rows[0]!.id
  })
}

/** Ruft einen Wrapper so auf, wie es die Server Action tut: als authenticated MIT JWT-Claims. */
async function callAs<T = Record<string, unknown>>(
  user: TestUser,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(text, params)
    return rows[0]!.r
  })
}

/** Execute-Recht per Katalog (robust über die OID, keine fragile Signatur-Zeichenkette). */
async function canExecute(role: string, funcName: string): Promise<boolean> {
  const rows = await sql<{ can: boolean }>(
    `select has_function_privilege($1, p.oid, 'execute') as can
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $2`,
    [role, funcName],
  )
  return rows[0]?.can ?? false
}

async function leadRow(id: string) {
  const rows = await sql<{
    email: string
    company: string | null
    first_name: string | null
    last_name: string | null
    phone: string | null
    status: string
    retention_basis: string
    anonymized_at: string | null
    anonymized_by: string | null
    matches_24_months: boolean
    matches_84_months: boolean
  }>(
    // anonymized_at als TEXT: der pg-Treiber liefert timestamptz sonst als Date-Objekt, und zwei
    // Date-Instanzen desselben Zeitpunkts sind nicht identisch — der Idempotenz-Vergleich wäre
    // dann ein Objektvergleich statt eines Zeitpunktvergleichs.
    `select email, company, first_name, last_name, phone, status, retention_basis,
            anonymized_at::text as anonymized_at,
            anonymized_by,
            deletion_due_at = last_interaction_at + interval '24 months' as matches_24_months,
            deletion_due_at = last_interaction_at + interval '84 months' as matches_84_months
       from platform.leads where id = $1`,
    [id],
  )
  return rows[0]!
}

async function suppress(email: string): Promise<string> {
  const hash = (await sql<{ h: string }>(`select platform.email_hash($1) as h`, [email]))[0]!.h
  await sql(
    `insert into platform.email_suppressions (email_hash, reason) values ($1, 'manual')
     on conflict (email_hash) do nothing`,
    [hash],
  )
  spawnedSuppressionHashes.push(hash)
  return hash
}

type ListResult = {
  status: string
  total: number
  filter?: string
  leads: {
    id: string
    email: string
    status: string
    is_suppressed: boolean
    deletion_due: boolean
    consents: { purpose: string; status: string; effective_status: string }[]
  }[]
  sources: { key: string; label: string }[]
}

/** Liste mit benannten Parametern — so ruft supabase-js sie auch auf. */
async function list(admin: TestUser, args: Record<string, unknown> = {}): Promise<ListResult> {
  const keys = Object.keys(args)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  return callAs<ListResult>(
    admin,
    `select public.admin_list_leads(${named}) as r`,
    keys.map((k) => args[k]),
  )
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  for (const h of spawnedSuppressionHashes.splice(0)) {
    await sql('delete from platform.email_suppressions where email_hash = $1', [h])
  }
  for (const id of spawnedUsers.splice(0)) {
    await deleteUser(id)
  }
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Zugriffsgrenze ───────────────────────────────────────────────────────────────────────────
describe('Zugriffsgrenze der sechs neuen Wrapper', () => {
  it('die Grant-Fläche ist exakt `authenticated`', async () => {
    for (const fn of B1_3_WRAPPERS) {
      expect(await canExecute('anon', fn), `anon darf ${fn} nicht ausführen`).toBe(false)
      expect(
        await canExecute('service_role', fn),
        `service_role darf ${fn} nicht ausführen (Autorisierung hängt an auth.uid())`,
      ).toBe(false)
      expect(await canExecute('authenticated', fn), `${fn} ist authenticated-only`).toBe(true)
    }
  })

  it('platform.anonymize_lead ist von aussen gar nicht aufrufbar', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const rows = await sql<{ can: boolean }>(
        `select has_function_privilege($1, p.oid, 'execute') as can
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'platform' and p.proname = 'anonymize_lead'`,
        [role],
      )
      expect(rows[0]!.can, `${role} darf platform.anonymize_lead nicht direkt aufrufen`).toBe(false)
    }
  })

  it('ein eingeloggter Nicht-Admin bekommt aus JEDEM Wrapper einen FEHLER, keine leere Antwort', async () => {
    const user = await newUser()
    const lead = await newLead()

    const calls: [string, string, unknown[]][] = [
      ['admin_set_lead_status', 'select public.admin_set_lead_status($1, $2) as r', [lead.id, 'contacted']],
      [
        'admin_withdraw_consent',
        `select public.admin_withdraw_consent($1, 'marketing_email') as r`,
        [lead.id],
      ],
      ['admin_suppress_lead', 'select public.admin_suppress_lead($1) as r', [lead.id]],
      ['admin_anonymize_lead', 'select public.admin_anonymize_lead($1) as r', [lead.id]],
      [
        'admin_is_email_suppressed',
        'select public.admin_is_email_suppressed($1) as r',
        [lead.email],
      ],
      ['admin_suppression_count', 'select public.admin_suppression_count() as r', []],
    ]

    for (const [name, text, params] of calls) {
      await expect(callAs(user, text, params), `${name} muss werfen`).rejects.toThrow(
        /Adminrolle erforderlich/,
      )
    }

    // Und nichts davon hat gewirkt.
    const row = await leadRow(lead.id)
    expect(row.status).toBe('new')
    expect(row.anonymized_at).toBeNull()
  })

  it('die Ablehnung trägt SQLSTATE 42501 (insufficient_privilege), nicht den Sammelcode P0001', async () => {
    const user = await newUser()
    const lead = await newLead()
    let code: string | undefined
    try {
      await callAs(user, 'select public.admin_anonymize_lead($1) as r', [lead.id])
    } catch (err) {
      code = (err as { code?: string }).code
    }
    expect(code).toBe('42501')
  })
})

// ── (2) Aufbewahrung: Statuswechsel auf 'customer' ───────────────────────────────────────────────
describe('Statuspflege und Aufbewahrungsgrundlage', () => {
  it('Wechsel auf „Kunde" setzt commercial UND verschiebt die Frist auf 84 Monate', async () => {
    const admin = await newAdmin()
    const lead = await newLead()

    const before = await leadRow(lead.id)
    expect(before.retention_basis).toBe('marketing')
    expect(before.matches_24_months).toBe(true)

    const res = await callAs<{ status: string; lead_status: string; retention_basis: string }>(
      admin,
      `select public.admin_set_lead_status($1, 'customer') as r`,
      [lead.id],
    )
    expect(res.status).toBe('ok')
    // Die Antwort trägt zurück, was die TRIGGER gemacht haben — nicht, was der Aufrufer wollte.
    expect(res.retention_basis).toBe('commercial')

    const after = await leadRow(lead.id)
    expect(after.status).toBe('customer')
    expect(after.retention_basis).toBe('commercial')
    expect(after.matches_84_months, 'deletion_due_at muss auf 84 Monate nachrücken').toBe(true)
    expect(after.matches_24_months).toBe(false)
  })

  it('der Rückweg commercial → marketing wird abgelehnt — auch für service_role', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await callAs(admin, `select public.admin_set_lead_status($1, 'customer') as r`, [lead.id])

    await expect(
      runAs({ role: 'service_role', commit: true }, (c) =>
        c.query(`update platform.leads set retention_basis = 'marketing' where id = $1`, [lead.id]),
      ),
    ).rejects.toThrow(/commercial → marketing/)

    expect((await leadRow(lead.id)).retention_basis).toBe('commercial')
  })

  it('der Statuswechsel ZURÜCK von „Kunde" lässt die kaufmännische Frist stehen', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await callAs(admin, `select public.admin_set_lead_status($1, 'customer') as r`, [lead.id])
    await callAs(admin, `select public.admin_set_lead_status($1, 'contacted') as r`, [lead.id])

    const row = await leadRow(lead.id)
    expect(row.status).toBe('contacted')
    // Der springende Punkt: eine entstandene Aufbewahrungspflicht endet nicht mit dem Absprung.
    expect(row.retention_basis).toBe('commercial')
    expect(row.matches_84_months).toBe(true)
  })

  it('„anonymized" ist über die Statuspflege NICHT setzbar', async () => {
    const admin = await newAdmin()
    const lead = await newLead()

    const res = await callAs<{ status: string }>(
      admin,
      `select public.admin_set_lead_status($1, 'anonymized') as r`,
      [lead.id],
    )
    expect(res.status).toBe('invalid_status')

    const row = await leadRow(lead.id)
    expect(row.status).toBe('new')
    // Entscheidend: kein Lead, der „anonymisiert" HEISST und alle Identitätsmerkmale noch trägt.
    expect(row.email).toBe(lead.email)
  })

  it('ein unbekannter Lead ist ein fachlicher Zustand, keine Exception', async () => {
    const admin = await newAdmin()
    const res = await callAs<{ status: string }>(
      admin,
      `select public.admin_set_lead_status($1, 'contacted') as r`,
      [randomUUID()],
    )
    expect(res.status).toBe('not_found')
  })
})

// ── (3) Anonymisierung ───────────────────────────────────────────────────────────────────────────
describe('Anonymisierung', () => {
  it('entfernt die Identitätsmerkmale, nullt source_ip/user_agent und lässt den Nachweis stehen', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email' })
    await insertConsent({
      leadId: lead.id,
      purpose: 'result_delivery',
      status: 'confirmed',
      confirmedAt: 'now()',
    })
    const hash = await suppress(lead.email)

    const res = await callAs<{ status: string; outcome: string }>(
      admin,
      'select public.admin_anonymize_lead($1) as r',
      [lead.id],
    )
    expect(res).toMatchObject({ status: 'ok', outcome: 'anonymized' })

    const row = await leadRow(lead.id)
    expect(row.email).toBe(`anonymized+${lead.id}@invalid`)
    expect(row.company).toBeNull()
    expect(row.first_name).toBeNull()
    expect(row.last_name).toBeNull()
    expect(row.phone).toBeNull()
    expect(row.status).toBe('anonymized')
    expect(row.anonymized_at).not.toBeNull()
    expect(row.anonymized_by, 'der handelnde Admin wird festgehalten').toBe(admin.id)

    // Die Einwilligungszeilen BLEIBEN — sie sind ohne Identitätsmerkmale kein Personenbezug mehr,
    // belegen aber weiter, dass korrekt gearbeitet wurde.
    const consents = await sql<{ n: number; ips: number; uas: number }>(
      `select count(*)::int as n, count(source_ip)::int as ips, count(user_agent)::int as uas
         from platform.consents where lead_id = $1`,
      [lead.id],
    )
    expect(consents[0]!.n).toBe(2)
    expect(consents[0]!.ips).toBe(0)
    expect(consents[0]!.uas).toBe(0)

    // Und der Wortlaut hängt weiter dran (der eigentliche Nachweis).
    const texts = await sql<{ n: number }>(
      `select count(*)::int as n from platform.consents c
         join platform.consent_texts ct on ct.id = c.consent_text_id
        where c.lead_id = $1 and length(ct.body) > 0`,
      [lead.id],
    )
    expect(texts[0]!.n).toBe(2)

    // DER KERN DES B1-1-ENTWURFS: die Sperre überlebt die Löschung.
    const suppression = await sql<{ n: number }>(
      `select count(*)::int as n from platform.email_suppressions where email_hash = $1`,
      [hash],
    )
    expect(suppression[0]!.n).toBe(1)
  })

  it('nullt die LOKALISIERENDEN Segmentierungsmerkmale und erhält die grob einordnenden', async () => {
    // B3-1. Die Trennlinie verläuft entlang „lokalisierend" gegen „grob einordnend", nicht entlang
    // „geschäftlich nützlich": PLZ + Branche + Versorger zusammen erkennen einen Betrieb wieder (in
    // einem 4-Ziffern-Gebiet gibt es selten zwei Kühlhäuser mit 180 MWh), Branche + Verbrauchsgrösse
    // + Messart allein nicht — die bleiben als statistische Merkmale nutzbar.
    const admin = await newAdmin()
    const lead = await newLead()
    await setSegments(lead.id)

    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])

    expect(await segmentRow(lead.id)).toEqual({
      industry: 'kuehlhaus',
      annual_consumption_kwh: 180_000,
      metering_type: 'netzebene_7',
      postal_code: null,
      supplier: null,
      contract_end_date: null,
    })
  })

  it('ist idempotent: der zweite Aufruf meldet Erfolg ohne zweite Wirkung', async () => {
    const admin = await newAdmin()
    const lead = await newLead()

    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])
    const first = await leadRow(lead.id)

    const second = await callAs<{ status: string; outcome: string; anonymized_at: string }>(
      admin,
      'select public.admin_anonymize_lead($1) as r',
      [lead.id],
    )
    expect(second).toMatchObject({ status: 'ok', outcome: 'already_anonymized' })

    const after = await leadRow(lead.id)
    // anonymized_at bleibt der ERSTE Zeitpunkt — ein nachgeschriebenes Datum wäre eine Fälschung.
    expect(after.anonymized_at).toBe(first.anonymized_at)
    expect(after.email).toBe(first.email)
  })

  it('ein anonymisierter Lead lässt sich nicht mehr ändern — auch nicht über service_role', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    // B3-1: mit gesetzten Segmentierungsmerkmalen, damit der Guard unten BEIDE Fälle abdeckt —
    // die drei genullten Spalten wieder füllen UND die drei überlebenden verändern.
    await setSegments(lead.id)
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])

    const forbidden: [string, string][] = [
      ['email', `update platform.leads set email = 'zurueck@test.local' where id = $1`],
      ['company', `update platform.leads set company = 'Wieder Da GmbH' where id = $1`],
      // Der aufgetrennte Kontaktname: BEIDE Spalten einzeln geprüft. Ein Guard, der nur den
      // Nachnamen schützte, liesse den Vornamen frei änderbar — und ein Vorname ist genauso ein
      // Identitätsmerkmal wie der Rest.
      ['first_name', `update platform.leads set first_name = 'Max' where id = $1`],
      ['last_name', `update platform.leads set last_name = 'Muster' where id = $1`],
      ['phone', `update platform.leads set phone = '+43 1 1' where id = $1`],
      ['status', `update platform.leads set status = 'contacted' where id = $1`],
      ['retention_basis', `update platform.leads set retention_basis = 'commercial' where id = $1`],
      // Ohne diesen Schutz liesse sich der Guard mit seiner eigenen Bedingung abschalten.
      ['anonymized_at', `update platform.leads set anonymized_at = null where id = $1`],
      // B3-1: die sechs Segmentierungsspalten. Ohne sie liefe der Guard an seiner eigenen
      // Erweiterung vorbei — ausgerechnet PLZ und Versorger, deren Entfernung die Anonymisierung
      // ausmacht, liessen sich nachträglich wieder füllen.
      ['industry', `update platform.leads set industry = 'tischlerei' where id = $1`],
      ['postal_code', `update platform.leads set postal_code = '4020' where id = $1`],
      [
        'annual_consumption_kwh',
        `update platform.leads set annual_consumption_kwh = 42000 where id = $1`,
      ],
      ['metering_type', `update platform.leads set metering_type = 'unknown' where id = $1`],
      ['supplier', `update platform.leads set supplier = 'EVN' where id = $1`],
      [
        'contract_end_date',
        `update platform.leads set contract_end_date = date '2028-01-31' where id = $1`,
      ],
    ]

    for (const [field, text] of forbidden) {
      await expect(
        runAs({ role: 'service_role', commit: true }, (c) => c.query(text, [lead.id])),
        `${field} darf für service_role nicht änderbar sein`,
      ).rejects.toThrow(/anonymisiert/)
    }

    // Auch die PRIVILEGIERTESTE verfügbare Rolle kommt nicht daran vorbei — der Trigger kennt
    // keine Ausnahme, und genau das macht „endgültig" zu einer Tatsache statt einer Zusage.
    await expect(
      sql(`update platform.leads set status = 'contacted' where id = $1`, [lead.id]),
    ).rejects.toThrow(/anonymisiert/)
  })

  it('last_interaction_at bleibt änderbar — der B1-1-Trigger touch_lead_on_consent muss laufen können', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])

    await expect(
      insertConsent({ leadId: lead.id, purpose: 'marketing_email' }),
    ).resolves.toBeTruthy()
  })

  it('nach der Anonymisierung lehnen Statuspflege und Sperre sauber ab (Zustand, keine Exception)', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email' })
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])

    for (const [name, text, params] of [
      ['status', `select public.admin_set_lead_status($1, 'contacted') as r`, [lead.id]],
      ['withdraw', `select public.admin_withdraw_consent($1, 'marketing_email') as r`, [lead.id]],
      ['suppress', `select public.admin_suppress_lead($1) as r`, [lead.id]],
    ] as [string, string, unknown[]][]) {
      const res = await callAs<{ status: string }>(admin, text, params)
      expect(res.status, `${name} muss 'anonymized' melden`).toBe('anonymized')
    }

    // Der entscheidende Nebeneffekt: KEIN Müll-Hash der Platzhalter-Adresse in der Sperrliste.
    const junk = await sql<{ n: number }>(
      `select count(*)::int as n from platform.email_suppressions
        where email_hash = platform.email_hash($1)`,
      [`anonymized+${lead.id}@invalid`],
    )
    expect(junk[0]!.n).toBe(0)
  })

  it('zwei anonymisierte Leads kollidieren nicht am E-Mail-UNIQUE', async () => {
    const admin = await newAdmin()
    const a = await newLead()
    const b = await newLead()

    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [a.id])
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [b.id])

    expect((await leadRow(a.id)).email).not.toBe((await leadRow(b.id)).email)
  })

  it('das Löschen des handelnden Kontos entfernt die Zuschreibung, nicht den Lead', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])
    expect((await leadRow(lead.id)).anonymized_by).toBe(admin.id)

    // ON DELETE SET NULL: das Konto darf gehen, ohne den Lead mitzureissen oder festzuhängen.
    await deleteUser(admin.id)
    spawnedUsers.splice(spawnedUsers.indexOf(admin.id), 1)

    const row = await leadRow(lead.id)
    expect(row.anonymized_by).toBeNull()
    expect(row.anonymized_at, 'der VORGANG bleibt belegt').not.toBeNull()
    expect(row.status).toBe('anonymized')
  })
})

// ── (4) Widerruf und Sperre über den Admin-Weg ───────────────────────────────────────────────────
describe('Widerruf und Sperre', () => {
  it('widerruft ALLE Zeilen eines Zwecks und lässt die anderen Zwecke unberührt', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email' })
    await insertConsent({
      leadId: lead.id,
      purpose: 'marketing_email',
      status: 'confirmed',
      confirmedAt: 'now()',
    })
    await insertConsent({
      leadId: lead.id,
      purpose: 'result_delivery',
      status: 'confirmed',
      confirmedAt: 'now()',
    })

    const res = await callAs<{ status: string; withdrawn_count: number }>(
      admin,
      `select public.admin_withdraw_consent($1, 'marketing_email') as r`,
      [lead.id],
    )
    expect(res.status).toBe('ok')
    expect(res.withdrawn_count, 'beide marketing-Zeilen, nicht nur die jüngste').toBe(2)

    const may = await sql<{ marketing: boolean; delivery: boolean }>(
      `select platform.has_confirmed_consent($1, 'marketing_email') as marketing,
              platform.has_confirmed_consent($1, 'result_delivery')  as delivery`,
      [lead.id],
    )
    expect(may[0]!.marketing).toBe(false)
    expect(may[0]!.delivery, 'der andere Zweck bleibt unberührt').toBe(true)
  })

  it('die Sperre widerruft alles, trägt den Hash ein und ist über die Auskunft sichtbar', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await insertConsent({
      leadId: lead.id,
      purpose: 'marketing_email',
      status: 'confirmed',
      confirmedAt: 'now()',
    })
    spawnedSuppressionHashes.push(
      (await sql<{ h: string }>(`select platform.email_hash($1) as h`, [lead.email]))[0]!.h,
    )

    const before = await callAs<{ is_suppressed: boolean }>(
      admin,
      'select public.admin_is_email_suppressed($1) as r',
      [lead.email],
    )
    expect(before.is_suppressed).toBe(false)

    const res = await callAs<{ status: string; withdrawn_count: number }>(
      admin,
      'select public.admin_suppress_lead($1) as r',
      [lead.id],
    )
    expect(res).toMatchObject({ status: 'ok', withdrawn_count: 1 })

    const after = await callAs<{ is_suppressed: boolean; normalized_email: string }>(
      admin,
      'select public.admin_is_email_suppressed($1) as r',
      [`  ${lead.email.toUpperCase()}  `],
    )
    // Dieselbe Definition von „dieselbe Adresse" wie im Bestand (platform.normalize_email).
    expect(after.is_suppressed).toBe(true)
    expect(after.normalized_email).toBe(lead.email)
  })

  it('die Sperrzahl steigt um genau eins', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    spawnedSuppressionHashes.push(
      (await sql<{ h: string }>(`select platform.email_hash($1) as h`, [lead.email]))[0]!.h,
    )

    const before = await callAs<{ count: number }>(admin, 'select public.admin_suppression_count() as r')
    await callAs(admin, 'select public.admin_suppress_lead($1) as r', [lead.id])
    const after = await callAs<{ count: number }>(admin, 'select public.admin_suppression_count() as r')

    expect(after.count).toBe(before.count + 1)
  })

  it('eine leere Adresse ist ein fachlicher Zustand, keine Auskunft', async () => {
    const admin = await newAdmin()
    const res = await callAs<{ status: string }>(
      admin,
      'select public.admin_is_email_suppressed($1) as r',
      ['   '],
    )
    expect(res.status).toBe('invalid_email')
  })
})

// ── (5) Filter der Liste ─────────────────────────────────────────────────────────────────────────
// Alle Zählungen laufen über eine EINDEUTIGE Firmenbezeichnung als Freitext-Anker. Sonst zählte
// `total` den gesamten Bestand des geteilten Stacks mit, und der Test wäre von der Reihenfolge
// anderer Tests abhängig.
describe('Filter von admin_list_leads', () => {
  it('liefert Trefferzahlen der GEFILTERTEN Menge, nicht des Bestands', async () => {
    const admin = await newAdmin()
    const marker = `Filtermarke ${randomUUID()}`

    const a = await newLead({ company: `${marker} Alpha`, sourceKey: 'kontaktformular' })
    const b = await newLead({ company: `${marker} Beta`, sourceKey: 'fachvortrag' })
    // Gamma bleibt bewusst ohne jede Einwilligung — der Gegenprobe-Fall für den 'none'-Filter.
    await newLead({ company: `${marker} Gamma`, sourceKey: 'fachvortrag' })

    await insertConsent({ leadId: a.id, purpose: 'marketing_email', status: 'pending' })
    await insertConsent({
      leadId: b.id,
      purpose: 'marketing_email',
      status: 'confirmed',
      confirmedAt: 'now()',
    })

    const all = await list(admin, { p_search: marker })
    expect(all.status).toBe('ok')
    expect(all.total).toBe(3)
    expect(all.leads).toHaveLength(3)
    // `sources` fährt mit, damit der Filter echte Bezeichnungen zeigt (lead_sources ist Tabelle).
    expect(all.sources.some((s) => s.key === 'fachvortrag')).toBe(true)

    expect((await list(admin, { p_search: marker, p_source_key: 'fachvortrag' })).total).toBe(2)
    expect((await list(admin, { p_search: marker, p_status: 'new' })).total).toBe(3)
    expect((await list(admin, { p_search: marker, p_status: 'customer' })).total).toBe(0)

    expect(
      (await list(admin, { p_search: marker, p_consent_status: 'confirmed' })).total,
      'nur b hat eine bestätigte Einwilligung',
    ).toBe(1)
    expect(
      (await list(admin, { p_search: marker, p_consent_status: 'none' })).total,
      'nur Gamma hat gar keine Einwilligung',
    ).toBe(1)
    expect(
      (
        await list(admin, {
          p_search: marker,
          p_consent_purpose: 'result_delivery',
          p_consent_status: 'none',
        })
      ).total,
      'für result_delivery hat KEINER eine Einwilligung',
    ).toBe(3)
  })

  it('Trefferzahl und Seite passen zusammen — die Zahl gilt für die ganze Filtermenge', async () => {
    const admin = await newAdmin()
    const marker = `Seitenmarke ${randomUUID()}`
    await newLead({ company: `${marker} 1` })
    await newLead({ company: `${marker} 2` })
    await newLead({ company: `${marker} 3` })

    const page = await list(admin, { p_search: marker, p_limit: 2 })
    expect(page.total, 'total ist die Trefferzahl, nicht die Seitenlänge').toBe(3)
    expect(page.leads).toHaveLength(2)

    const second = await list(admin, { p_search: marker, p_limit: 2, p_offset: 2 })
    expect(second.total).toBe(3)
    expect(second.leads).toHaveLength(1)

    const ids = new Set([...page.leads, ...second.leads].map((l) => l.id))
    expect(ids.size, 'keine Zeile doppelt oder übersprungen').toBe(3)
  })

  it('„zur Anonymisierung fällig" trifft nur überfällige, noch nicht anonymisierte Leads', async () => {
    const admin = await newAdmin()
    const marker = `Fristmarke ${randomUUID()}`
    // 24 Monate + 1 Tag zurück ⇒ die abgeleitete Frist liegt in der Vergangenheit.
    const overdue = await newLead({ company: `${marker} faellig`, dueDaysAgo: 24 * 31 })
    await newLead({ company: `${marker} frisch` })

    const due = await list(admin, { p_search: marker, p_due_only: true })
    expect(due.total).toBe(1)
    expect(due.leads[0]!.id).toBe(overdue.id)
    expect(due.leads[0]!.deletion_due).toBe(true)

    // Nach der Anonymisierung verschwindet der Fall aus der Arbeitsliste — sonst stünde er dort
    // dauerhaft, obwohl er erledigt ist.
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [overdue.id])
    expect((await list(admin, { p_search: marker, p_due_only: true })).total).toBe(0)
  })

  it('eine pending-Zeile mit verfallenem Token gilt als abgelaufen — angezeigt UND gefiltert', async () => {
    const admin = await newAdmin()
    const marker = `Ablaufmarke ${randomUUID()}`
    const lead = await newLead({ company: marker })
    await insertConsent({
      leadId: lead.id,
      purpose: 'marketing_email',
      status: 'pending',
      tokenExpiresIn: '-1 day',
    })

    const rows = await list(admin, { p_search: marker })
    const consent = rows.leads[0]!.consents[0]!
    // Gespeichert bleibt pending (B1-2 räumt lazy ab) — angezeigt wird der WIRKSAME Zustand.
    expect(consent.status).toBe('pending')
    expect(consent.effective_status).toBe('expired')

    expect((await list(admin, { p_search: marker, p_consent_status: 'expired' })).total).toBe(1)
    expect(
      (await list(admin, { p_search: marker, p_consent_status: 'pending' })).total,
      'die Zeile darf nicht doppelt zählen',
    ).toBe(0)
  })

  it('ein unbekannter Filterwert wird abgelehnt statt still ignoriert', async () => {
    const admin = await newAdmin()

    const badStatus = await list(admin, { p_status: 'gibt-es-nicht' })
    expect(badStatus).toMatchObject({ status: 'invalid_filter', filter: 'status' })

    const badConsent = await list(admin, { p_consent_status: 'vielleicht' })
    expect(badConsent).toMatchObject({ status: 'invalid_filter', filter: 'consent_status' })
  })

  it('die Freitextsuche behandelt LIKE-Sonderzeichen als Text, nicht als Muster', async () => {
    const admin = await newAdmin()
    const marker = `Maskenmarke ${randomUUID()}`
    await newLead({ company: marker })

    // Ein getipptes „%" darf nicht plötzlich alles treffen.
    expect((await list(admin, { p_search: '%' })).total).toBe(0)
    expect((await list(admin, { p_search: marker.toLowerCase() })).total, 'Suche ignoriert Groß-/Kleinschreibung').toBe(1)
  })

  it('admin_get_lead zeigt den wirksamen Status und den Handelnden der Anonymisierung', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await insertConsent({
      leadId: lead.id,
      purpose: 'marketing_email',
      status: 'pending',
      tokenExpiresIn: '-1 day',
    })

    const before = await callAs<{
      status: string
      lead: { anonymized_by: string | null; anonymized_by_email: string | null }
      consents: { status: string; effective_status: string; consent_text_body: string }[]
    }>(admin, 'select public.admin_get_lead($1) as r', [lead.id])

    expect(before.status).toBe('ok')
    expect(before.consents[0]!.effective_status).toBe('expired')
    expect(before.consents[0]!.consent_text_body.length).toBeGreaterThan(0)
    expect(before.lead.anonymized_by).toBeNull()

    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])

    const after = await callAs<{
      lead: { anonymized_by: string | null; anonymized_by_email: string | null }
    }>(admin, 'select public.admin_get_lead($1) as r', [lead.id])
    expect(after.lead.anonymized_by).toBe(admin.id)
    expect(after.lead.anonymized_by_email).toBe(admin.email)
  })
})
