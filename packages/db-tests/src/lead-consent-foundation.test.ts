// DB-Gate für das Lead- und Einwilligungsfundament (B1-1)
// (Migration 20260721100000_create_lead_consent_foundation.sql).
//
// Beweist auf DB-Ebene, was B1-2/B1-3 voraussetzen dürfen: (1) der Lead-Bestand ist für anon UND
// für eingeloggte Nicht-Admins vollständig unerreichbar; (2) Einwilligungstexte sind unveränderlich;
// (3) eine bestätigungspflichtige Einwilligung kann NIE ohne Bestätigungszeitstempel als bestätigt
// gelten; (4) die Löschfrist ist eine Ableitung, die mit jeder Interaktion nachrückt und der
// Rechtsgrundlage folgt; (5) eine Abmeldung überlebt die Löschung des Leads; (6) der
// Herkunftskontext ist nach dem Anlegen unveränderlich.
//
// ── WARUM SETUP-SCHREIBVORGÄNGE ALS service_role LAUFEN ──────────────────────────────────────────
// Das ist der reale Schreibpfad: die anonyme Erfassung läuft in B1-2 über eine Server Action mit
// service_role (kein anon-Grant, konsistent mit dem Stripe-Webhook). Die Tests schreiben deshalb
// genauso — nebenbei ist damit bewiesen, dass service_role die nötigen Rechte HAT (inklusive
// Execute auf die von den Triggern aufgerufenen Funktionen).
//
// ── WARUM AUFGERÄUMT WERDEN MUSS ─────────────────────────────────────────────────────────────────
// Leads hängen NICHT an auth.users — der Cascade, der in den anderen Gates alles mitnimmt, greift
// hier nicht. Jeder Test entfernt seine Leads (Cascade räumt die Einwilligungen ab) und seine
// Sperrlisten-Einträge selbst. Gelöscht wird privilegiert (postgres): service_role hat bewusst KEIN
// delete-Grant — der Löschjob der Aufbewahrungsfristen gehört nicht zu B1-1.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ──────────────────────────────────────
// Wie in allen bisherigen Wrapper-Gates: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant. Die Autorisierungs-Wahrheit wird
// deshalb über has_function_privilege geprüft, nicht über einen anon-Aufruf. Die Ablehnung des
// eingeloggten NICHT-Admins wird dagegen echt aufgerufen — dort HAT der Aufrufer das Grant, und
// genau die Ablehnung in der Funktion ist die zu beweisende Eigenschaft.

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

const LEAD_TABLES = [
  'lead_sources',
  'leads',
  'consent_texts',
  'consents',
  'email_suppressions',
] as const

const spawnedUsers: string[] = []
const spawnedLeads: string[] = []
const spawnedSuppressionHashes: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

/** Admin per direktem user_roles-Insert (Muster wie das T4-4-Gate). */
async function makeAdmin(userId: string): Promise<void> {
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [userId])
}

interface TestLead {
  id: string
  email: string
}

/** Legt einen Lead auf dem REALEN Schreibpfad an (service_role, committed). */
async function newLead(
  opts: {
    email?: string
    sourceKey?: string
    retentionBasis?: 'marketing' | 'commercial'
    /** Verschiebt last_interaction_at in die Vergangenheit, um das Nachrücken sichtbar zu machen. */
    lastInteractionDaysAgo?: number
  } = {},
): Promise<TestLead> {
  const email = opts.email ?? `lead-${randomUUID()}@test.local`
  const id = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into platform.leads
         (email, first_source_key, retention_basis, last_interaction_at, company)
       values ($1, $2, $3, now() - make_interval(days => $4::int), 'DB-Gate')
       returning id`,
      [
        email,
        opts.sourceKey ?? 'kontaktformular',
        opts.retentionBasis ?? 'marketing',
        opts.lastInteractionDaysAgo ?? 0,
      ],
    )
    return rows[0]!.id
  })
  spawnedLeads.push(id)
  return { id, email }
}

async function consentTextId(purpose: string): Promise<string> {
  const rows = await sql<{ id: string }>(
    `select id from platform.consent_texts where purpose = $1 and version = 1 and locale = 'de'`,
    [purpose],
  )
  return rows[0]!.id
}

/** Legt eine Einwilligung an — ebenfalls auf dem realen Schreibpfad (service_role). */
async function insertConsent(fields: {
  leadId: string
  purpose: string
  status?: string
  confirmedAt?: string | null
  sourceKey?: string
}): Promise<string> {
  const textId = await consentTextId(fields.purpose)
  return runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into platform.consents
         (lead_id, consent_text_id, source_key, status, confirmed_at, source_ip, user_agent)
       values ($1, $2, $3, $4, $5, '203.0.113.7', 'db-gate/1.0')
       returning id`,
      [
        fields.leadId,
        textId,
        fields.sourceKey ?? 'kontaktformular',
        fields.status ?? 'pending',
        fields.confirmedAt ?? null,
      ],
    )
    return rows[0]!.id
  })
}

interface LeadRetentionRow {
  deletion_due_epoch: number
  last_interaction_epoch: number
  /** Prüft die Ableitungsregel EXAKT in SQL (kein Float-Vergleich in JS). */
  matches_24_months: boolean
  matches_84_months: boolean
}

async function retentionRow(leadId: string): Promise<LeadRetentionRow> {
  const rows = await sql<LeadRetentionRow>(
    `select extract(epoch from deletion_due_at)::float8      as deletion_due_epoch,
            extract(epoch from last_interaction_at)::float8  as last_interaction_epoch,
            deletion_due_at = last_interaction_at + interval '24 months' as matches_24_months,
            deletion_due_at = last_interaction_at + interval '84 months' as matches_84_months
       from platform.leads where id = $1`,
    [leadId],
  )
  return rows[0]!
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

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedUsers.splice(0)) await deleteUser(id)
  // Privilegiert löschen: service_role hat bewusst kein delete-Grant (s. Kopfkommentar).
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  for (const h of spawnedSuppressionHashes.splice(0)) {
    await sql('delete from platform.email_suppressions where email_hash = $1', [h])
  }
})

afterAll(async () => {
  await pool.end()
})

// ── (1) anon ─────────────────────────────────────────────────────────────────────────────────────
describe('Zugriffsgrenze — anon', () => {
  it('anon bekommt auf ALLEN fünf Tabellen permission denied bei SELECT', async () => {
    for (const table of LEAD_TABLES) {
      await expect(
        runAs({ role: 'anon' }, (c) => c.query(`select * from platform.${table} limit 1`)),
        `anon SELECT auf ${table} muss scheitern`,
      ).rejects.toThrow(/permission denied/i)
    }
  })

  it('anon und service_role haben KEIN Execute-Recht auf die beiden Admin-Wrapper', async () => {
    for (const fn of ['admin_list_leads', 'admin_get_lead']) {
      expect(await canExecute('anon', fn), `anon darf ${fn} nicht ausführen`).toBe(false)
      expect(
        await canExecute('service_role', fn),
        `service_role darf ${fn} nicht ausführen (Autorisierung hängt an auth.uid())`,
      ).toBe(false)
      expect(await canExecute('authenticated', fn), `${fn} ist authenticated-only`).toBe(true)
    }
  })
})

// ── (2) authenticated ohne Adminrolle ────────────────────────────────────────────────────────────
describe('Zugriffsgrenze — eingeloggter Nicht-Admin', () => {
  it('bekommt aus admin_list_leads einen FEHLER, keine (leere) Liste', async () => {
    const user = await newUser()
    const lead = await newLead()

    await expect(
      callAs(user, 'select public.admin_list_leads() as r'),
      'ein Nicht-Admin darf keine Antwort bekommen, die sich als "keine Leads" lesen lässt',
    ).rejects.toThrow(/Adminrolle erforderlich/)

    await expect(
      callAs(user, 'select public.admin_get_lead($1) as r', [lead.id]),
    ).rejects.toThrow(/Adminrolle erforderlich/)
  })

  it('hat auf leads/consents/email_suppressions kein Tabellen-Grant (Leads sind kein Nutzerdatum)', async () => {
    const user = await newUser()
    for (const table of ['leads', 'consents', 'email_suppressions'] as const) {
      await expect(
        runAs({ role: 'authenticated', userId: user.id }, (c) =>
          c.query(`select * from platform.${table} limit 1`),
        ),
        `authenticated SELECT auf ${table} muss scheitern`,
      ).rejects.toThrow(/permission denied/i)
    }
  })
})

// ── Positivfall: der Admin-Weg trägt wirklich ────────────────────────────────────────────────────
describe('Admin-Wrapper — Positivfall', () => {
  it('admin_list_leads listet den Lead samt Sperr- und Einwilligungsstand', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email' })

    const res = await callAs<{
      status: string
      total: number
      limit: number
      leads: { id: string; email: string; is_suppressed: boolean; consents: unknown[] }[]
    }>(admin, 'select public.admin_list_leads() as r')

    expect(res.status).toBe('ok')
    expect(res.limit).toBe(50)
    expect(res.total).toBeGreaterThanOrEqual(1)

    const row = res.leads.find((l) => l.id === lead.id)
    expect(row, 'der neu angelegte Lead muss auf der ersten Seite stehen').toBeDefined()
    expect(row!.email).toBe(lead.email)
    expect(row!.is_suppressed).toBe(false)
    expect(row!.consents).toHaveLength(1)
  })

  it('admin_get_lead liefert die Einwilligung MIT Wortlaut und Version (der eigentliche Nachweis)', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email', sourceKey: 'fachvortrag' })

    const res = await callAs<{
      status: string
      lead: { id: string; email: string }
      consents: {
        purpose: string
        status: string
        source_key: string
        consent_text_version: number
        consent_text_locale: string
        consent_text_body: string
        requires_double_opt_in: boolean
      }[]
    }>(admin, 'select public.admin_get_lead($1) as r', [lead.id])

    expect(res.status).toBe('ok')
    expect(res.lead.id).toBe(lead.id)
    expect(res.consents).toHaveLength(1)

    const consent = res.consents[0]!
    expect(consent.purpose).toBe('marketing_email')
    expect(consent.status).toBe('pending')
    expect(consent.source_key).toBe('fachvortrag')
    expect(consent.consent_text_version).toBe(1)
    expect(consent.consent_text_locale).toBe('de')
    expect(consent.requires_double_opt_in).toBe(true)
    // Der Wortlaut selbst — ohne ihn wäre der "Nachweis" nur ein Schlüsselwort.
    expect(consent.consent_text_body).toContain('COOLiN ENERGY GmbH')
    expect(consent.consent_text_body).toContain('jederzeit')
  })

  it('admin_get_lead auf eine unbekannte id ist ein fachlicher Zustand, kein Fehler', async () => {
    const admin = await newUser()
    await makeAdmin(admin.id)
    const res = await callAs<{ status: string }>(admin, 'select public.admin_get_lead($1) as r', [
      randomUUID(),
    ])
    expect(res.status).toBe('not_found')
  })
})

// ── (3) consent_texts append-only ────────────────────────────────────────────────────────────────
describe('Einwilligungstexte sind unveränderlich', () => {
  it('UPDATE und DELETE auf consent_texts sind gesperrt — auch privilegiert (postgres)', async () => {
    const textId = await consentTextId('marketing_email')

    await expect(
      sql(`update platform.consent_texts set body = 'manipuliert' where id = $1`, [textId]),
      'ein änderbarer Einwilligungstext wäre kein Nachweis',
    ).rejects.toThrow(/append-only/)

    await expect(
      sql(`delete from platform.consent_texts where id = $1`, [textId]),
    ).rejects.toThrow(/append-only/)

    // Beweis, dass der Schutz gegriffen hat: der Wortlaut ist unverändert.
    const rows = await sql<{ body: string }>(
      'select body from platform.consent_texts where id = $1',
      [textId],
    )
    expect(rows[0]?.body).toContain('COOLiN ENERGY GmbH')
    expect(rows[0]?.body).not.toContain('manipuliert')
  })
})

// ── (4) Double-Opt-in lässt sich nicht fälschen ──────────────────────────────────────────────────
describe('Bestätigungspflicht (Double-Opt-in)', () => {
  it('marketing_email kann NICHT auf confirmed gesetzt werden, solange confirmed_at fehlt', async () => {
    const lead = await newLead()

    // (a) direkt als bestätigt einfügen
    await expect(
      insertConsent({ leadId: lead.id, purpose: 'marketing_email', status: 'confirmed' }),
    ).rejects.toThrow(/bestätigungspflichtig/)

    // (b) eine bestehende pending-Einwilligung nachträglich hochstufen
    const consentId = await insertConsent({ leadId: lead.id, purpose: 'marketing_email' })
    await expect(
      runAs({ role: 'service_role', commit: true }, (c) =>
        c.query(`update platform.consents set status = 'confirmed' where id = $1`, [consentId]),
      ),
    ).rejects.toThrow(/bestätigungspflichtig/)

    const after = await sql<{ status: string }>(
      'select status from platform.consents where id = $1',
      [consentId],
    )
    expect(after[0]?.status).toBe('pending')

    // (c) MIT Zeitstempel geht es — die Sperre blockiert die Fälschung, nicht den Vorgang.
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(
        `update platform.consents set status = 'confirmed', confirmed_at = now() where id = $1`,
        [consentId],
      ),
    )
    const confirmed = await sql<{ status: string }>(
      'select status from platform.consents where id = $1',
      [consentId],
    )
    expect(confirmed[0]?.status).toBe('confirmed')
  })

  it('contract_expiry_reminder ist ebenso bestätigungspflichtig, result_delivery nicht', async () => {
    const lead = await newLead()

    await expect(
      insertConsent({ leadId: lead.id, purpose: 'contract_expiry_reminder', status: 'confirmed' }),
    ).rejects.toThrow(/bestätigungspflichtig/)

    // result_delivery: die Zusendung IST die angeforderte Leistung — kein Bestätigungsschritt,
    // den ein Zeitstempel belegen könnte.
    const id = await insertConsent({
      leadId: lead.id,
      purpose: 'result_delivery',
      status: 'confirmed',
    })
    expect(id).toBeTruthy()
  })
})

// ── (5) has_confirmed_consent ────────────────────────────────────────────────────────────────────
describe('has_confirmed_consent — die Frage vor jedem Versand', () => {
  it('liefert bei pending false und erst nach echter Bestätigung true', async () => {
    const lead = await newLead()
    const consentId = await insertConsent({ leadId: lead.id, purpose: 'marketing_email' })

    const check = async () => {
      const rows = await sql<{ ok: boolean }>(
        `select platform.has_confirmed_consent($1, 'marketing_email') as ok`,
        [lead.id],
      )
      return rows[0]!.ok
    }

    expect(await check(), 'eine unbestätigte Einwilligung ist rechtlich wertlos').toBe(false)

    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(
        `update platform.consents set status = 'confirmed', confirmed_at = now() where id = $1`,
        [consentId],
      ),
    )
    expect(await check()).toBe(true)

    // Ein anderer Zweck bleibt unberührt — Einwilligungen sind zweckgebunden.
    const other = await sql<{ ok: boolean }>(
      `select platform.has_confirmed_consent($1, 'contract_expiry_reminder') as ok`,
      [lead.id],
    )
    expect(other[0]?.ok).toBe(false)

    // Ein Widerruf nimmt die Berechtigung sofort zurück.
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(
        `update platform.consents set status = 'withdrawn', withdrawn_at = now() where id = $1`,
        [consentId],
      ),
    )
    expect(await check()).toBe(false)
  })
})

// ── (6) + (7) Löschfrist ─────────────────────────────────────────────────────────────────────────
describe('Aufbewahrungsfrist ist eine Ableitung', () => {
  it('deletion_due_at rückt nach, wenn eine neue Einwilligung eingeht', async () => {
    const lead = await newLead({ lastInteractionDaysAgo: 10 })

    const before = await retentionRow(lead.id)
    expect(before.matches_24_months, 'marketing = 24 Monate ab letzter Interaktion').toBe(true)

    await insertConsent({ leadId: lead.id, purpose: 'result_delivery' })

    const after = await retentionRow(lead.id)
    expect(after.matches_24_months).toBe(true)
    expect(after.deletion_due_epoch).toBeGreaterThan(before.deletion_due_epoch)
    // Die Interaktion war 10 Tage "alt" → die Frist rückt um rund 10 Tage nach. Toleranz, weil
    // Monatsarithmetik auf timestamptz kalender- und DST-abhängig ist (Stunden, nicht Tage).
    const shiftDays = (after.deletion_due_epoch - before.deletion_due_epoch) / 86_400
    expect(shiftDays).toBeGreaterThan(9.5)
    expect(shiftDays).toBeLessThan(10.5)
  })

  it('Wechsel auf retention_basis=commercial verschiebt die Frist auf 84 Monate', async () => {
    const lead = await newLead()
    const before = await retentionRow(lead.id)
    expect(before.matches_24_months).toBe(true)

    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(`update platform.leads set retention_basis = 'commercial' where id = $1`, [lead.id]),
    )

    const after = await retentionRow(lead.id)
    expect(after.matches_84_months).toBe(true)
    expect(after.matches_24_months).toBe(false)
    expect(after.deletion_due_epoch).toBeGreaterThan(before.deletion_due_epoch)
  })

  it('ein vom Aufrufer mitgegebenes deletion_due_at wird überschrieben (Ableitung, keine Eingabe)', async () => {
    const lead = await newLead()
    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(`update platform.leads set deletion_due_at = now() + interval '99 years' where id = $1`, [
        lead.id,
      ]),
    )
    const row = await retentionRow(lead.id)
    expect(row.matches_24_months, 'der Trigger rechnet die Frist bei JEDEM Schreibvorgang neu').toBe(
      true,
    )
  })
})

// ── (8) Sperrliste überlebt die Löschung ─────────────────────────────────────────────────────────
describe('Sperrliste überlebt den Lead', () => {
  it('ein email_suppressions-Eintrag bleibt bestehen, wenn der Lead gelöscht wird', async () => {
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email' })

    const hashRows = await sql<{ h: string }>('select platform.email_hash($1) as h', [lead.email])
    const hash = hashRows[0]!.h
    spawnedSuppressionHashes.push(hash)

    await runAs({ role: 'service_role', commit: true }, (c) =>
      c.query(
        `insert into platform.email_suppressions (email_hash, reason) values ($1, 'unsubscribed')`,
        [hash],
      ),
    )

    const suppressedBefore = await sql<{ ok: boolean }>(
      'select platform.is_suppressed($1) as ok',
      [lead.email],
    )
    expect(suppressedBefore[0]?.ok).toBe(true)

    // Lead löschen (privilegiert — s. Kopfkommentar). Die Einwilligungen gehen per Cascade mit.
    await sql('delete from platform.leads where id = $1', [lead.id])
    spawnedLeads.splice(spawnedLeads.indexOf(lead.id), 1)

    const consentsLeft = await sql<{ n: number }>(
      'select count(*)::int as n from platform.consents where lead_id = $1',
      [lead.id],
    )
    expect(consentsLeft[0]?.n, 'Einwilligungen hängen am Lead und gehen mit').toBe(0)

    const suppressionsLeft = await sql<{ n: number }>(
      'select count(*)::int as n from platform.email_suppressions where email_hash = $1',
      [hash],
    )
    expect(
      suppressionsLeft[0]?.n,
      'die Abmeldung MUSS überleben — sonst steht die Person beim nächsten Import wieder im Verteiler',
    ).toBe(1)

    const suppressedAfter = await sql<{ ok: boolean }>(
      'select platform.is_suppressed($1) as ok',
      [lead.email],
    )
    expect(suppressedAfter[0]?.ok).toBe(true)

    // Und in der Sperrliste steht KEIN Klartext.
    const stored = await sql<{ email_hash: string }>(
      'select email_hash from platform.email_suppressions where email_hash = $1',
      [hash],
    )
    expect(stored[0]?.email_hash).not.toContain('@')
  })
})

// ── (9) Herkunftskontext ist einmalig ────────────────────────────────────────────────────────────
describe('Herkunftskontext', () => {
  it('first_source_key lässt sich nach dem Anlegen nicht ändern', async () => {
    const lead = await newLead({ sourceKey: 'schnellrechner' })

    await expect(
      runAs({ role: 'service_role', commit: true }, (c) =>
        c.query(`update platform.leads set first_source_key = 'direktkontakt' where id = $1`, [
          lead.id,
        ]),
      ),
    ).rejects.toThrow(/unveränderlich/)

    const rows = await sql<{ first_source_key: string }>(
      'select first_source_key from platform.leads where id = $1',
      [lead.id],
    )
    expect(rows[0]?.first_source_key).toBe('schnellrechner')
  })

  it('ein unbekannter Einstiegspunkt wird abgelehnt (Referenztabelle, kein Freitext)', async () => {
    await expect(newLead({ sourceKey: 'gibt-es-nicht' })).rejects.toThrow(/foreign key|lead_sources/i)
  })
})

// ── Eindeutigkeit über die normalisierte Adresse ─────────────────────────────────────────────────
describe('E-Mail-Normalisierung', () => {
  it('dieselbe Adresse in anderer Schreibweise ist derselbe Lead (unique über den Normalwert)', async () => {
    const base = `Mixed-${randomUUID()}@Test.Local`
    const lead = await newLead({ email: `  ${base}  ` })

    const stored = await sql<{ email: string }>('select email from platform.leads where id = $1', [
      lead.id,
    ])
    expect(stored[0]?.email, 'gespeichert wird die normalisierte Adresse').toBe(base.toLowerCase())

    await expect(
      newLead({ email: base.toUpperCase() }),
      'derselbe Mensch darf nicht zweimal im Bestand stehen',
    ).rejects.toThrow(/duplicate key|leads_email_normalized_key/i)
  })
})
