// DB-Gate für das Thema einer Kontaktanfrage — `platform.leads.thema`
// (Migration 20260805150000_create_lead_thema.sql).
//
// Die Spalte hält den SCHLÜSSEL des im Kontaktformular gewählten Themas (`peakShaving`, `esg`, …),
// und sie hat bewusst KEINEN CHECK: die Werteliste ist datengetrieben aus der Leistungs-Taxonomie
// (`apps/web/lib/kontakt/themen.ts`), eine feste Liste in der Datenbank wäre eine zweite Taxonomie.
// Genau deshalb kann die Datenbank hier wenig garantieren — und genau deshalb muss das Gate die
// Eigenschaften messen, die noch tragen:
//
//   (1) SCHEMA — die Spalte ist `text`, nullable, ohne CHECK. Ein nachträglich ergänzter Constraint
//       liesse die Erfassung beim ersten Leistungs-Rename mit 23514 scheitern, mitten im
//       Kontaktformular; der Test hält die Entscheidung fest, statt sie nur zu kommentieren.
//   (2) SIGNATUR UND RECHTE — `p_thema` hängt HINTEN an, es gibt genau EINE Überladung, und die
//       Rechtefläche von `capture_lead` ist nach dem DROP+CREATE unverändert service_role-only
//       (in B3-1 ist genau dieser Schritt schon einmal übersehen worden).
//   (3) ZUSAMMENFÜHRUNG — der JÜNGERE Wert gewinnt (B3-1-Segmentierungsregel), ein null lässt den
//       Bestand UNBERÜHRT. Ohne die zweite Hälfte löschte jede Erfassung über einen themenlosen
//       Weg (Telefonaufnahme, Warteliste, Rechnerergebnis) das zuvor genannte Thema — still, ohne
//       Fehler, sichtbar erst an einer unerklärlich leeren Auswertung.
//   (4) REGRESSION ÜBER DIE GANZE PALETTE — jeder bestehende Aufrufer bleibt funktionsfähig,
//       insbesondere der POSITIONALE Aufruf, den das B1-2-Gate bewusst führt.
//   (5) LESEWEGE — `admin_list_leads` und `admin_export_leads` liefern die Spalte tatsächlich mit.
//       Beide werden ECHT aufgerufen (Arbeitsregel 2): plpgsql prüft Funktionsrümpfe nicht beim
//       Anlegen, Introspektion beweist also nur Existenz.
//   (6) ANONYMISIERUNG — das Thema ÜBERLEBT (Kategorie, kein Identitätsmerkmal — wie `industry`)
//       und ist danach unveränderlich, auch für service_role und postgres.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ─────────────────────────────────────
// Arbeitsregel 5: ein Aufruf als Rolle OHNE Execute-Grant hat den Postgres-Prozess schon
// abgeschossen (Signal 11, in B16-4a mitten im CI-Lauf). `has_function_privilege` ist dieselbe
// Wahrheit ohne Absturz der geteilten Testdatenbank.
//
// ── ISOLATION ───────────────────────────────────────────────────────────────────────────────────
// `admin_list_leads`/`admin_export_leads` zählen BESTANDSWEIT, und in derselben Datenbank liegen die
// Fixtures aller übrigen Gates (vitest fährt die Dateien parallel). Beide Lesetests klammern
// deshalb über einen eindeutigen Firmennamen als Suchbegriff.

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

function newEmail(): string {
  return `thema-${randomUUID()}@test.local`
}

type Outcome = { outcome: string; lead_id?: string }

/**
 * `capture_lead` auf dem REALEN Weg: als service_role, committed, mit BENANNTEN Parametern — so
 * ruft supabase-js es auch auf. Nur die Felder, um die es hier geht; alles Übrige bleibt auf den
 * Vorgabewerten, damit der Test nicht nebenbei etwas anderes misst.
 */
async function capture(email: string, args: Record<string, unknown> = {}): Promise<Outcome> {
  // Zusammenführen statt anhängen: sonst stünde `p_source_key` zweimal in der Argumentliste,
  // sobald ein Test eine andere Herkunft setzt (Postgres lehnt das mit „used more than once" ab).
  const full: Record<string, unknown> = { p_email: email, p_source_key: 'kontaktformular', ...args }
  const keys = Object.keys(full)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  const result = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: Outcome }>(
      `select public.capture_lead(${named}) as r`,
      keys.map((k) => full[k]),
    )
    return rows[0]!.r
  })
  if (result.lead_id && !spawnedLeads.includes(result.lead_id)) spawnedLeads.push(result.lead_id)
  return result
}

async function themaOf(leadId: string): Promise<string | null> {
  const rows = await sql<{ thema: string | null }>(
    'select thema from platform.leads where id = $1',
    [leadId],
  )
  return rows[0]!.thema
}

async function newAdmin(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
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
async function canExecute(role: string, funcName: string, schema = 'public'): Promise<boolean> {
  const rows = await sql<{ can: boolean }>(
    `select has_function_privilege($1, p.oid, 'execute') as can
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = $3 and p.proname = $2`,
    [role, funcName, schema],
  )
  return rows[0]?.can ?? false
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  if (spawnedUsers.length > 0) {
    // Der Export protokolliert; `exported_by` trägt ON DELETE SET NULL, die Zeilen blieben sonst
    // herrenlos zurück und der nächste Lauf zählte gegen einen anderen Bestand.
    await sql('delete from platform.admin_exports where exported_by = any($1)', [spawnedUsers])
  }
  for (const id of spawnedUsers.splice(0)) {
    await deleteUser(id)
  }
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Schema ───────────────────────────────────────────────────────────────────────────────────
describe('(1) die Spalte', () => {
  it('platform.leads.thema ist text und nullable', async () => {
    const rows = await sql<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable
         from information_schema.columns
        where table_schema = 'platform' and table_name = 'leads' and column_name = 'thema'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.data_type).toBe('text')
    expect(rows[0]!.is_nullable).toBe('YES')
  })

  it('trägt KEINEN CHECK — die Werteliste lebt in der Taxonomie, nicht in der Datenbank', async () => {
    const rows = await sql<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'platform' and t.relname = 'leads'
          and pg_get_constraintdef(c.oid) ilike '%thema%'`,
    )
    expect(rows).toEqual([])
  })

  it('es entsteht kein Enum-Typ für Themen', async () => {
    const rows = await sql<{ typname: string }>(
      `select t.typname
         from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'platform' and t.typtype = 'e' and t.typname ilike '%thema%'`,
    )
    expect(rows).toEqual([])
  })
})

// ── (2) Signatur und Rechte ──────────────────────────────────────────────────────────────────────
describe('(2) capture_lead nach dem DROP + CREATE', () => {
  it('hat GENAU EINE Überladung, und p_thema hängt als LETZTER Parameter an', async () => {
    const rows = await sql<{ args: string[] }>(
      `select p.proargnames as args
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'capture_lead'`,
    )
    expect(rows, 'eine zweite Überladung machte jeden bestehenden Aufruf mehrdeutig').toHaveLength(
      1,
    )

    const args = rows[0]!.args
    expect(args.at(-1)).toBe('p_thema')
    // Die Vorgänger bleiben an ihrem Platz — sonst bräche der positionale Aufruf lautlos.
    expect(args.at(-2)).toBe('p_referred_by_text')
    expect(args.at(-3)).toBe('p_partner_slug')
  })

  it('die Rechtefläche ist unverändert service_role-only', async () => {
    // Arbeitsregel 5: kein Aufruf als Rolle ohne Grant — Introspektion statt Segfault.
    expect(await canExecute('service_role', 'capture_lead')).toBe(true)
    expect(await canExecute('authenticated', 'capture_lead')).toBe(false)
    expect(await canExecute('anon', 'capture_lead')).toBe(false)
  })
})

// ── (3) Schreibweg und Zusammenführung ───────────────────────────────────────────────────────────
describe('(3) das Thema im Bestand', () => {
  it('ein übergebenes Thema wird gespeichert — als Schlüssel, unverändert', async () => {
    const r = await capture(newEmail(), { p_thema: 'peakShaving' })
    // NICHT kleingeschrieben: die Schlüssel sind camelCase, ein lower() machte sie unauflösbar.
    expect(await themaOf(r.lead_id!)).toBe('peakShaving')
  })

  it('ohne p_thema bleibt die Spalte null — kein stiller Rückfallwert', async () => {
    const r = await capture(newEmail())
    expect(await themaOf(r.lead_id!)).toBeNull()
  })

  it('Leerstring und reine Leerzeichen werden zu null', async () => {
    const a = await capture(newEmail(), { p_thema: '' })
    expect(await themaOf(a.lead_id!)).toBeNull()

    const b = await capture(newEmail(), { p_thema: '   ' })
    expect(await themaOf(b.lead_id!)).toBeNull()
  })

  it('umgebende Leerzeichen fallen weg', async () => {
    const r = await capture(newEmail(), { p_thema: '  esg  ' })
    expect(await themaOf(r.lead_id!)).toBe('esg')
  })

  it('der JÜNGERE Wert gewinnt — das Thema ist das Anliegen DIESER Absendung', async () => {
    const email = newEmail()
    const first = await capture(email, { p_thema: 'smartHeating' })
    const second = await capture(email, { p_thema: 'peakShaving' })

    expect(second.lead_id, 'derselbe Lead, kein zweiter').toBe(first.lead_id)
    expect(await themaOf(first.lead_id!)).toBe('peakShaving')
  })

  it('ein Aufruf OHNE Thema löscht ein bestehendes NICHT', async () => {
    /*
     * Der wichtigste Test dieser Datei. Genau dieser Fall tritt real ein: derselbe Kontakt kommt
     * später über die Telefonaufnahme, die Warteliste oder ein Rechnerergebnis herein — Wege, die
     * kein Thema kennen. Mit `coalesce(neu, Bestand)` bleibt die frühere Angabe stehen.
     */
    const email = newEmail()
    const first = await capture(email, { p_thema: 'ppa' })
    await capture(email, { p_source_key: 'warteliste' })
    expect(await themaOf(first.lead_id!)).toBe('ppa')
  })

  it('ein LEERSTRING löscht ebenfalls nicht (er ist keine Angabe)', async () => {
    const email = newEmail()
    const first = await capture(email, { p_thema: 'finanzierung' })
    await capture(email, { p_thema: '' })
    expect(await themaOf(first.lead_id!)).toBe('finanzierung')
  })
})

// ── (4) Regression über die bestehenden Aufrufer ─────────────────────────────────────────────────
describe('(4) bestehende Erfassungswege bleiben funktionsfähig', () => {
  it('der POSITIONALE Aufruf mit den bisherigen 20 Argumenten läuft unverändert', async () => {
    /*
     * Das B1-2-Gate führt einen positionalen Aufruf bewusst als Test der Parameterreihenfolge. Hier
     * steht er als Regressionsprobe: der neue Parameter hängt hinten an und hat einen Vorgabewert,
     * ein Aufruf ohne ihn muss deshalb weiterhin gültig sein.
     */
    const email = newEmail()
    const r = await runAs({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ r: Outcome }>(
        `select public.capture_lead(
           $1, 'kontaktformular', null, null, null,
           'DB-Gate GmbH', 'Test', 'Person', '+43 1 0000', '203.0.113.9'::inet, 'db-gate/1.0',
           'de', null, null, null, null, null, null, null, null
         ) as r`,
        [email],
      )
      return rows[0]!.r
    })
    if (r.lead_id) spawnedLeads.push(r.lead_id)

    expect(r.outcome).toBe('lead_only')
    expect(await themaOf(r.lead_id!)).toBeNull()
  })

  it.each([
    ['partner-empfehlung', 'die Partner-Landingpage'],
    ['kalkulator-registrierung', 'die Kalkulator-Registrierung'],
    ['registrierung', 'die Registrierung'],
    ['warteliste', 'die Warteliste'],
    ['rechnerergebnis', 'das Rechnerergebnis'],
    ['telefonanfrage', 'die telefonische Aufnahme'],
    ['artikel-inline', 'das Artikel-Formular'],
  ])('%s erfasst weiterhin, und thema bleibt null (%s)', async (sourceKey) => {
    const r = await capture(newEmail(), { p_source_key: sourceKey })
    expect(r.outcome).toBe('lead_only')
    expect(r.lead_id).toBeTruthy()
    expect(await themaOf(r.lead_id!)).toBeNull()
  })

  it('der Partner-Weg ordnet weiterhin zu — und schreibt trotzdem kein Thema', async () => {
    const slug = `thema-gate-${randomUUID()}`
    await sql(
      `insert into platform.partners (slug, display_name, is_active) values ($1, $2, true)`,
      [slug, 'Thema-Gate Elektro'],
    )
    try {
      const r = await capture(newEmail(), {
        p_source_key: 'partner-empfehlung',
        p_partner_slug: slug,
        p_referred_by_text: 'Kollege aus dem Nachbarort',
      })
      const rows = await sql<{
        partner_slug: string | null
        referred_by_text: string | null
        thema: string | null
      }>('select partner_slug, referred_by_text, thema from platform.leads where id = $1', [
        r.lead_id,
      ])
      expect(rows[0]!.partner_slug).toBe(slug)
      expect(rows[0]!.referred_by_text).toBe('Kollege aus dem Nachbarort')
      expect(rows[0]!.thema, 'ein anderer Erfassungsweg bekommt kein Thema').toBeNull()
    } finally {
      // Leads zuerst (partner_slug ist `on delete restrict`), dann der Partner.
      for (const id of spawnedLeads.splice(0)) {
        await sql('delete from platform.leads where id = $1', [id])
      }
      await sql('delete from platform.partners where slug = $1', [slug])
    }
  })

  it('eine Einwilligung entsteht unverändert neben dem Thema', async () => {
    const r = await capture(newEmail(), {
      p_purpose: 'marketing_email',
      p_token_hash: randomUUID(),
      p_thema: 'pvSpeicher',
    })
    expect(r.outcome).toBe('consent_created')

    const rows = await sql<{ status: string }>(
      `select c.status from platform.consents c where c.lead_id = $1`,
      [r.lead_id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('pending')
    expect(await themaOf(r.lead_id!)).toBe('pvSpeicher')
  })
})

// ── (5) Lesewege ─────────────────────────────────────────────────────────────────────────────────
describe('(5) admin_list_leads und admin_export_leads liefern das Thema mit', () => {
  it('beide Wrapper führen thema je Zeile — ECHT aufgerufen, nicht introspiziert', async () => {
    const admin = await newAdmin()
    const marker = `Thema-Gate ${randomUUID()}`

    const withThema = await capture(newEmail(), { p_company: marker, p_thema: 'energiemanagement' })
    const withoutThema = await capture(newEmail(), { p_company: marker })

    const list = await callAs<{
      status: string
      total: number
      leads: { id: string; thema: string | null }[]
    }>(admin, 'select public.admin_list_leads(p_search => $1) as r', [marker])

    expect(list.status).toBe('ok')
    expect(list.total).toBe(2)
    const byId = new Map(list.leads.map((l) => [l.id, l.thema]))
    expect(byId.get(withThema.lead_id!)).toBe('energiemanagement')
    expect(byId.get(withoutThema.lead_id!), 'null bleibt null, kein Platzhalter').toBeNull()

    const exported = await callAs<{
      status: string
      row_count: number
      rows: { id: string; thema: string | null }[]
    }>(admin, 'select public.admin_export_leads(p_search => $1) as r', [marker])

    expect(exported.status).toBe('ok')
    expect(exported.row_count).toBe(2)
    const exportedById = new Map(exported.rows.map((r) => [r.id, r.thema]))
    expect(exportedById.get(withThema.lead_id!)).toBe('energiemanagement')
    expect(exportedById.get(withoutThema.lead_id!)).toBeNull()
  })

  /*
   * ── DER DRITTE LESEWEG, NACHGEZOGEN ────────────────────────────────────────────────────────────
   * `admin_get_lead` baut seine Spaltenliste EXPLIZIT auf und hat die neue Spalte deshalb nicht von
   * selbst übernommen (anders als `platform.leads_matching`, das `setof platform.leads` liefert).
   * Ohne diese Zeile wäre das Thema über das interne Aufnahmeformular eingebbar und auf der
   * Detailseite unsichtbar — ein Feld ohne Sicht ist dieselbe Requisite wie ein Feld ohne
   * Speicherort.
   */
  it('admin_get_lead führt thema mit — sonst wäre das Feld schreibbar und nirgends lesbar', async () => {
    const admin = await newAdmin()
    const mit = await capture(newEmail(), { p_thema: 'smartHeating' })
    const ohne = await capture(newEmail())

    type Detail = { status: string; lead: Record<string, unknown> }

    const a = await callAs<Detail>(admin, 'select public.admin_get_lead($1) as r', [mit.lead_id])
    expect(a.status).toBe('ok')
    expect(Object.keys(a.lead), 'der Schlüssel muss existieren, nicht nur der Wert').toContain(
      'thema',
    )
    expect(a.lead.thema).toBe('smartHeating')

    const b = await callAs<Detail>(admin, 'select public.admin_get_lead($1) as r', [ohne.lead_id])
    expect(b.lead.thema, 'ohne Angabe bleibt es null, kein Platzhalter').toBeNull()
  })

  it('admin_get_lead ist unverändert authenticated-only und WIRFT für einen Nicht-Admin', async () => {
    /*
     * Der Wrapper wurde per `create or replace` bei unveränderter Signatur nachgezogen — es gab
     * keinen DROP und damit nichts wiederherzustellen. Gemessen statt vorausgesetzt: In B3-1 ist
     * genau dieser Schritt schon einmal übersehen worden.
     *
     * Die Grants per Introspektion (Arbeitsregel 5), die Ablehnung dagegen ECHT: Der eingeloggte
     * Nicht-Admin HAT das Grant, und die Ablehnung erfolgt im Rumpf per RAISE.
     */
    expect(await canExecute('authenticated', 'admin_get_lead')).toBe(true)
    expect(await canExecute('anon', 'admin_get_lead')).toBe(false)
    expect(await canExecute('service_role', 'admin_get_lead')).toBe(false)

    const plain = await createUser()
    spawnedUsers.push(plain.id)
    const lead = await capture(newEmail(), { p_thema: 'esg' })

    await expect(
      callAs(plain, 'select public.admin_get_lead($1) as r', [lead.lead_id]),
    ).rejects.toMatchObject({ code: '42501' })
  })
})

// ── (6) Anonymisierung ───────────────────────────────────────────────────────────────────────────
describe('(6) Anonymisierung', () => {
  it('das Thema ÜBERLEBT — es ordnet ein, es lokalisiert niemanden (wie industry)', async () => {
    const r = await capture(newEmail(), { p_thema: 'peakShaving', p_industry: 'baeckerei' })
    await sql('select platform.anonymize_lead($1, null)', [r.lead_id])

    const rows = await sql<{
      thema: string | null
      industry: string | null
      company: string | null
    }>('select thema, industry, company from platform.leads where id = $1', [r.lead_id])
    expect(rows[0]!.thema).toBe('peakShaving')
    expect(rows[0]!.industry).toBe('baeckerei')
    expect(rows[0]!.company, 'die Identitätsfelder sind weg').toBeNull()
  })

  it('nach der Anonymisierung ist es unveränderlich — für service_role UND postgres', async () => {
    const r = await capture(newEmail(), { p_thema: 'esg' })
    await sql('select platform.anonymize_lead($1, null)', [r.lead_id])

    for (const role of ['service_role', 'postgres'] as const) {
      await expect(
        runAs({ role }, (c) =>
          c.query('update platform.leads set thema = $2 where id = $1', [r.lead_id, 'peakShaving']),
        ),
        `${role} darf das Thema eines anonymisierten Leads nicht umschreiben`,
      ).rejects.toThrow(/anonymisiert/i)
    }

    expect(await themaOf(r.lead_id!)).toBe('esg')
  })
})
