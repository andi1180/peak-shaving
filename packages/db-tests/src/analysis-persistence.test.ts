// DB-Gate für die Analyse-Persistenz (B14-1)
// (Migration 20260724150000_create_analysis_persistence.sql).
//
// Dieser Bauabschnitt legt Daten an, deren Fehler ERST 2027 sichtbar würden — und dann nicht mehr
// behebbar sind: die Prognose-Baseline, gegen die der Wirkungsnachweis misst. Was hier still
// schiefgeht, fällt nirgends auf, weil die Zeile ja da ist und plausibel aussieht. Das Gate beweist
// deshalb fünf Dinge:
//
//   (1) EINFRIEREN — UPDATE und DELETE sind gesperrt, auch für service_role und postgres. Eine
//       Korrektur ist eine NEUE Zeile mit supersedes_id; die ersetzte bleibt unverändert bestehen.
//   (2) DIE AUSNAHME IST ENG — das Nullen von lead_id/created_by durch ON DELETE SET NULL läuft
//       durch (sonst wäre jeder betreute Lead und jedes anlegende Konto unlöschbar), Setzen und
//       Umhängen nicht. Beide Richtungen, mit ECHTEM Löschen eines Leads und eines Kontos.
//   (3) DIE PRÜFSUMME IST GERECHNET, NICHT GEGLAUBT — eine unpassende Prüfsumme wird abgewiesen
//       und legt NICHTS an. Ohne diesen Nachweis wäre sie Dekoration.
//   (4) DER ZUSCHNITT DER WRAPPER — die Liste liefert weder result noch Blob, die Detailansicht
//       result aber keinen Blob, und der Blob kommt nur aus seinem eigenen Wrapper. Der Rundlauf
//       läuft über die ECHTE Wrapper-Kette (schreiben → lesen → entpacken → Byte-Vergleich), nicht
//       nur über das reine Modul aus TEIL 3.
//   (5) GRENZEN — ein eingeloggter NICHT-Admin scheitert an allen vier Wrappern mit einem FEHLER
//       (nicht mit einer leeren Antwort), die Grant-Fläche ist exakt `authenticated`, und
//       anonymize_lead lässt Analysen unangetastet.
//
// ── JEDER NEUE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ──────────────────────────────────────────────
// Arbeitsregel seit B3-4, beim Namens-Split erneut bestätigt: Introspektion beweist nur die Existenz
// einer Funktion, plpgsql prüft Funktionsrümpfe nicht beim Anlegen. Alle vier Wrapper werden hier
// echt ausgeführt — admin_create_analysis auch auf jedem seiner Fehlerpfade.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ─────────────────────────────────────
// Wie in allen bisherigen Wrapper-Gates: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant. `has_function_privilege` ist dieselbe
// Wahrheit ohne Absturz der geteilten Test-/CI-Datenbank. Die Ablehnung des eingeloggten
// NICHT-Admins wird dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und genau die
// Ablehnung IN der Funktion ist die zu beweisende Eigenschaft.
//
// ── WIE AUFGERÄUMT WIRD ─────────────────────────────────────────────────────────────────────────
// `platform.analyses` ist append-only: die Zeilen dieses Gates lassen sich hinterher NICHT mehr
// entfernen — auch nicht von `postgres`. Das ist die zu beweisende Eigenschaft und kein Versehen.
// Aufgeräumt werden Leads und Konten; die Analyse-Zeilen bleiben mit `lead_id = null` /
// `created_by = null` zurück, was der ON-DELETE-SET-NULL-Absicht entspricht. Alle Zähl-Assertions
// messen deshalb DELTAS oder filtern auf die eigene Zeilen-id (Muster B2-2).

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import { gzipCompress, packSourceFile, sha256Hex, unpackSourceFile } from 'shared'

import {
  assertStackReachable,
  createUser,
  deleteUser,
  pool,
  runAs,
  sql,
  type TestUser,
} from './client'

/** Die vier Wrapper, die B14-1 neu anlegt. */
const B14_1_WRAPPERS = [
  'admin_create_analysis',
  'admin_list_analyses',
  'admin_get_analysis',
  'admin_get_analysis_source',
] as const

const spawnedUsers: string[] = []
const spawnedLeads: string[] = []

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

interface TestLead {
  id: string
  email: string
}

/** Legt einen Lead auf dem REALEN Schreibpfad an (service_role, committed). */
async function newLead(): Promise<TestLead> {
  const email = `b141-${randomUUID()}@test.local`
  const id = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into platform.leads (email, first_source_key, company)
       values ($1, 'kontaktformular', 'B14-1 GmbH')
       returning id`,
      [email],
    )
    return rows[0]!.id
  })
  spawnedLeads.push(id)
  return { id, email }
}

/**
 * Ein realistisch grosser Lastgang: 35.040 Viertelstundenwerte (§3.2, volles Jahr). Bewusst nicht
 * drei Zeilen — die Grenzfälle der Archiv-Kette (Blockgrenzen der Web-Streams, TOAST-Speicherung des
 * Blobs, base64-Rundlauf) treten erst bei echter Grösse auf.
 */
function syntheticLoadProfileCsv(rows = 35_040): Uint8Array {
  const lines: string[] = ['Zeitstempel;Wirkleistung [kW]']
  const start = Date.UTC(2026, 0, 1, 0, 0, 0)
  for (let i = 0; i < rows; i++) {
    const t = new Date(start + i * 15 * 60_000)
    const dd = String(t.getUTCDate()).padStart(2, '0')
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0')
    const hh = String(t.getUTCHours()).padStart(2, '0')
    const mi = String(t.getUTCMinutes()).padStart(2, '0')
    const kw = (12 + 8 * Math.sin(i / 96) + (i % 37) / 10).toFixed(3).replace('.', ',')
    lines.push(`${dd}.${mm}.${t.getUTCFullYear()} ${hh}:${mi};${kw}`)
  }
  return new TextEncoder().encode(lines.join('\r\n') + '\r\n')
}

/** Ein kleiner Lastgang für die Tests, in denen es nicht auf die Grösse ankommt. */
const SMALL_FILE = syntheticLoadProfileCsv(96)

type CreateArgs = {
  customerLabel?: string
  analysisKind?: 'betreut' | 'intern'
  leadId?: string | null
  supersedesId?: string | null
  siteLabel?: string | null
  file?: Uint8Array
  /** Überschreibt die Prüfsumme — für den Nachweis, dass sie GERECHNET und nicht geglaubt wird. */
  sha256Override?: string
  /** Überschreibt den Blob — für den Nachweis der Blob-Bindung. */
  gzipOverride?: Uint8Array
  billedBefore?: number
  billedAfter?: number
  annualSaving?: number
}

/**
 * Ruft `admin_create_analysis` so auf, wie es B14-2 tun wird: als angemeldeter Admin, mit BENANNTEN
 * Parametern (so ruft supabase-js sie auf) und mit einer echt gepackten Datei.
 */
async function createAnalysis(
  admin: TestUser,
  args: CreateArgs = {},
): Promise<{ status: string; id: string }> {
  const file = args.file ?? SMALL_FILE
  const packed = await packSourceFile(file)
  return runAs({ role: 'authenticated', userId: admin.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: { status: string; id: string } }>(
      `select public.admin_create_analysis(
         p_customer_label            => $1,
         p_analysis_kind             => $2,
         p_engine_version            => $3,
         p_engine_commit_sha         => $4,
         p_computed_at               => $5::timestamptz,
         p_inputs                    => $6::jsonb,
         p_result                    => $7::jsonb,
         p_baseline_billed_kw_before => $8,
         p_baseline_billed_kw_after  => $9,
         p_baseline_annual_saving_eur=> $10,
         p_source_file_name          => $11,
         p_source_file_sha256        => $12,
         p_source_file               => $13,
         p_source_file_gzip          => $14,
         p_site_label                => $15,
         p_lead_id                   => $16,
         p_supersedes_id             => $17,
         p_recommended_battery_label => $18,
         p_recommended_capacity_kwh  => $19
       ) as r`,
      [
        args.customerLabel ?? 'Bäckerei Beispiel GmbH',
        args.analysisKind ?? 'betreut',
        '0.1.0',
        'f6a1f24aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '2026-07-24T09:00:00Z',
        // WERTE, keine Verweise (Regel (b) der Migration): Tarifsatz und Batteriepreis stehen als
        // Zahl in inputs, nicht als Fremdschlüssel auf eine Konfigurationszeile.
        JSON.stringify({
          tariffParams: { billingModel: 'annual_max', leistungspreisEurPerKwYear: 82.92 },
          financialParams: { subsidyPercent: 30, horizonYears: 10 },
          catalog: [{ id: 'peakstore-c60', pricePerKwh: 235 }],
        }),
        JSON.stringify({
          current: { billedKw: args.billedBefore ?? 50.8, leistungspreisCostPerYear: 4212 },
          recommendation: { batteryId: 'peakstore-c60', rationale: 'Beispiel' },
        }),
        args.billedBefore ?? 50.8,
        args.billedAfter ?? 20.8,
        args.annualSaving ?? 2700,
        'lastgang-2026.csv',
        args.sha256Override ?? packed.sha256,
        Buffer.from(file),
        Buffer.from(args.gzipOverride ?? packed.gzip),
        args.siteLabel === undefined ? 'Standort Wien' : args.siteLabel,
        args.leadId ?? null,
        args.supersedesId ?? null,
        'PeakStore C60',
        60,
      ],
    )
    return rows[0]!.r
  })
}

/** Aufruf als eingeloggter Nutzer MIT JWT-Claims — so ruft es die Server Component. */
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

/** Rohzeile aus der Tabelle (privilegiert), ohne den Blob. */
async function rawRow(id: string) {
  const rows = await sql<{
    id: string
    lead_id: string | null
    created_by: string | null
    customer_label: string
    site_label: string | null
    analysis_kind: string
    supersedes_id: string | null
    baseline_billed_kw_before: string
    source_file_sha256: string
    created_at: string
  }>(
    `select id, lead_id, created_by, customer_label, site_label, analysis_kind, supersedes_id,
            baseline_billed_kw_before, source_file_sha256, created_at
       from platform.analyses where id = $1`,
    [id],
  )
  return rows[0] ?? null
}

type ListResult = {
  status: string
  total?: number
  filter?: string
  analyses?: Record<string, unknown>[]
}

type GetResult = {
  status: string
  analysis?: Record<string, unknown>
}

type SourceResult = {
  status: string
  source?: {
    source_file_name: string
    source_file_sha256: string
    source_file_gzip_base64: string
    source_file_gzip_bytes: number
  }
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  for (const id of spawnedUsers.splice(0)) {
    await deleteUser(id)
  }
  // platform.analyses wird NICHT aufgeräumt — append-only, und zwar mit Absicht (s. Kopf).
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Zugriffsgrenze ───────────────────────────────────────────────────────────────────────────
describe('(1) Zugriffsgrenze', () => {
  it('ein eingeloggter NICHT-Admin scheitert an ALLEN VIER Wrappern mit 42501, nicht mit leerer Antwort', async () => {
    const user = await newUser()
    const admin = await newAdmin()
    // Eine echte Zeile, damit ein „not_found" nicht als Ablehnung durchginge.
    const created = await createAnalysis(admin)

    await expect(
      callAs(
        user,
        `select public.admin_create_analysis(
           p_customer_label => 'Fremd GmbH', p_analysis_kind => 'intern',
           p_engine_version => '0.1.0', p_engine_commit_sha => 'deadbeef',
           p_computed_at => now(), p_inputs => '{}'::jsonb, p_result => '{}'::jsonb,
           p_baseline_billed_kw_before => 1, p_baseline_billed_kw_after => 1,
           p_baseline_annual_saving_eur => 0,
           p_source_file_name => 'x.csv', p_source_file_sha256 => $1,
           p_source_file => $2, p_source_file_gzip => $3
         ) as r`,
        [await sha256Hex(SMALL_FILE), Buffer.from(SMALL_FILE), Buffer.from(await gzipCompress(SMALL_FILE))],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      callAs(user, `select public.admin_list_analyses(50, 0, null, null) as r`),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      callAs(user, `select public.admin_get_analysis($1) as r`, [created.id]),
    ).rejects.toMatchObject({ code: '42501' })

    await expect(
      callAs(user, `select public.admin_get_analysis_source($1) as r`, [created.id]),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('der abgewiesene Aufruf hat NICHTS angelegt', async () => {
    const user = await newUser()
    const label = `Fremd GmbH ${randomUUID()}`

    await expect(
      callAs(
        user,
        `select public.admin_create_analysis(
           p_customer_label => $4, p_analysis_kind => 'intern',
           p_engine_version => '0.1.0', p_engine_commit_sha => 'deadbeef',
           p_computed_at => now(), p_inputs => '{}'::jsonb, p_result => '{}'::jsonb,
           p_baseline_billed_kw_before => 1, p_baseline_billed_kw_after => 1,
           p_baseline_annual_saving_eur => 0,
           p_source_file_name => 'x.csv', p_source_file_sha256 => $1,
           p_source_file => $2, p_source_file_gzip => $3
         ) as r`,
        [
          await sha256Hex(SMALL_FILE),
          Buffer.from(SMALL_FILE),
          Buffer.from(await gzipCompress(SMALL_FILE)),
          label,
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' })

    // Auf die konkrete Zeile geprüft und nicht über einen Gesamtzähler: die Tabelle ist
    // append-only, andere Tests legen parallel Zeilen an, und ein Zähler-Vergleich wäre damit eine
    // Aussage über den Bestand statt über diesen Aufruf.
    expect(
      await sql(`select 1 from platform.analyses where customer_label = $1`, [label]),
    ).toEqual([])
  })

  it('die Grant-Fläche ist exakt authenticated — anon und service_role nirgends', async () => {
    for (const fn of B14_1_WRAPPERS) {
      expect(await canExecute('authenticated', fn), `authenticated darf ${fn}`).toBe(true)
      expect(await canExecute('service_role', fn), `service_role darf ${fn} NICHT`).toBe(false)
      expect(await canExecute('anon', fn), `anon darf ${fn} NICHT`).toBe(false)
    }
    // Der Trigger-Helfer ist von aussen gar nicht aufrufbar.
    for (const role of ['anon', 'authenticated', 'service_role']) {
      expect(
        await canExecute(role, 'reject_analysis_mutation', 'platform'),
        `${role} darf platform.reject_analysis_mutation`,
      ).toBe(false)
    }
  })

  it('platform.analyses hat RLS ohne Policy und für KEINE Rolle ein Tabellenrecht', async () => {
    const [rls] = await sql<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname = 'analyses'`,
    )
    expect(rls!.relrowsecurity).toBe(true)

    const policies = await sql(
      `select 1 from pg_policies where schemaname = 'platform' and tablename = 'analyses'`,
    )
    expect(policies.length).toBe(0)

    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        const [row] = await sql<{ can: boolean }>(
          `select has_table_privilege($1, 'platform.analyses', $2) as can`,
          [role, priv],
        )
        expect(row!.can, `${role} darf ${priv}`).toBe(false)
      }
    }
  })
})

// ── (2) Einfrieren ───────────────────────────────────────────────────────────────────────────────
describe('(2) Einfrieren — append-only', () => {
  it('UPDATE und DELETE sind gesperrt, auch für service_role und postgres', async () => {
    const admin = await newAdmin()
    const created = await createAnalysis(admin, { customerLabel: 'Eingefroren GmbH' })

    // SCHICHT 1 — fehlendes Tabellenrecht: service_role kommt gar nicht bis zum Trigger. Das ist
    // die erwartete Meldung und zugleich der Beweis, dass die Tabelle für KEINE Rolle ein Grant hat.
    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query(`update platform.analyses set customer_label = 'x' where id = $1`, [created.id]),
      ),
    ).rejects.toThrow(/permission denied/i)
    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query(`delete from platform.analyses where id = $1`, [created.id]),
      ),
    ).rejects.toThrow(/permission denied/i)

    // SCHICHT 2 — der Trigger: `postgres` HAT jedes Recht und wird trotzdem abgewiesen. Genau
    // deshalb steht der Trigger da: ein Grant, das jemand später versehentlich vergibt, hebt das
    // Einfrieren nicht auf.
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.analyses set customer_label = 'x' where id = $1`, [created.id]),
      ),
    ).rejects.toThrow(/append-only/i)
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`delete from platform.analyses where id = $1`, [created.id]),
      ),
    ).rejects.toThrow(/append-only/i)

    // Die eigentliche Zusage: result und inputs lassen sich nicht nachrechnen.
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.analyses set result = '{"neu": true}'::jsonb where id = $1`, [
          created.id,
        ]),
      ),
    ).rejects.toThrow(/append-only/i)
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.analyses set baseline_annual_saving_eur = 1 where id = $1`, [
          created.id,
        ]),
      ),
    ).rejects.toThrow(/append-only/i)

    const row = await rawRow(created.id)
    expect(row!.customer_label).toBe('Eingefroren GmbH')
    expect(row!.baseline_billed_kw_before).toBe('50.8')
  })

  it('eine supersedes_id-Kette lässt sich anlegen, und die ERSETZTE Analyse bleibt unverändert', async () => {
    const admin = await newAdmin()
    const first = await createAnalysis(admin, {
      customerLabel: 'Kette GmbH',
      annualSaving: 2700,
      billedAfter: 20.8,
    })
    const before = await rawRow(first.id)

    // Die Korrektur ist eine NEUE Zeile mit anderen Zahlen — nicht eine Änderung der alten.
    const second = await createAnalysis(admin, {
      customerLabel: 'Kette GmbH',
      supersedesId: first.id,
      annualSaving: 2450,
      billedAfter: 22.4,
    })
    const third = await createAnalysis(admin, {
      customerLabel: 'Kette GmbH',
      supersedesId: second.id,
      annualSaving: 2500,
    })

    const chain = await sql<{ id: string; supersedes_id: string | null }>(
      `select id, supersedes_id from platform.analyses where id = any($1::uuid[])`,
      [[first.id, second.id, third.id]],
    )
    expect(chain.find((r) => r.id === first.id)!.supersedes_id).toBeNull()
    expect(chain.find((r) => r.id === second.id)!.supersedes_id).toBe(first.id)
    expect(chain.find((r) => r.id === third.id)!.supersedes_id).toBe(second.id)

    // Der Punkt der ganzen Konstruktion: die ersetzte Baseline steht unverändert da, samt der Zahl,
    // die sich als korrekturbedürftig erwiesen hat.
    const after = await rawRow(first.id)
    expect(after).toEqual(before)
    const saving = await sql<{ v: string }>(
      `select baseline_annual_saving_eur::text as v from platform.analyses where id = $1`,
      [first.id],
    )
    expect(saving[0]!.v).toBe('2700')
  })

  it('auch die ersetzte Analyse lässt sich nicht löschen — der Fremdschlüssel ist die zweite Sperre', async () => {
    const admin = await newAdmin()
    const first = await createAnalysis(admin)
    await createAnalysis(admin, { supersedesId: first.id })

    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`delete from platform.analyses where id = $1`, [first.id]),
      ),
    ).rejects.toThrow(/append-only/i)
  })
})

// ── (3) Die eine Ausnahme: ON DELETE SET NULL ────────────────────────────────────────────────────
describe('(3) Die Ausnahme ist eng — nullen ja, setzen und umhängen nein', () => {
  it('das Löschen eines verknüpften LEADS nullt lead_id, ohne die Zeile sonst zu verändern', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    const created = await createAnalysis(admin, { leadId: lead.id, customerLabel: 'Lead GmbH' })

    const before = await rawRow(created.id)
    expect(before!.lead_id).toBe(lead.id)

    // Der ECHTE Pfad: den Lead löschen. ON DELETE SET NULL ist selbst ein UPDATE — ohne die
    // Ausnahme wäre jeder Lead, für den je eine Analyse entstand, unlöschbar.
    await sql('delete from platform.leads where id = $1', [lead.id])
    spawnedLeads.splice(spawnedLeads.indexOf(lead.id), 1)

    const after = await rawRow(created.id)
    expect(after).not.toBeNull()
    expect(after!.lead_id).toBeNull()
    // Alles andere bit-identisch — der INHALT der Analyse hat überlebt, nur die Zuschreibung
    // entfällt. Insbesondere der denormalisierte Kundenname (deshalb steht er auf der Zeile).
    expect({ ...after, lead_id: before!.lead_id }).toEqual(before)
    expect(after!.customer_label).toBe('Lead GmbH')
  })

  it('das Löschen des ANLEGENDEN KONTOS nullt created_by, ohne die Zeile sonst zu verändern', async () => {
    const admin = await newAdmin()
    const created = await createAnalysis(admin, { customerLabel: 'Konto GmbH' })

    const before = await rawRow(created.id)
    expect(before!.created_by).toBe(admin.id)

    await deleteUser(admin.id)
    spawnedUsers.splice(spawnedUsers.indexOf(admin.id), 1)

    const after = await rawRow(created.id)
    expect(after).not.toBeNull()
    expect(after!.created_by).toBeNull()
    expect({ ...after, created_by: before!.created_by }).toEqual(before)
  })

  it('lead_id auf einen ANDEREN Lead umzuhängen wird abgewiesen', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    const other = await newLead()
    const created = await createAnalysis(admin, { leadId: lead.id })

    // Sonst liesse sich eine Analyse nachträglich einem fremden Kunden zuschreiben — und die
    // eingefrorene Baseline gehörte plötzlich zu einer anderen Anlage.
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.analyses set lead_id = $2 where id = $1`, [created.id, other.id]),
      ),
    ).rejects.toThrow(/append-only/i)

    expect((await rawRow(created.id))!.lead_id).toBe(lead.id)
  })

  it('lead_id/created_by nachträglich zu SETZEN wird abgewiesen', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    const created = await createAnalysis(admin, { leadId: null })
    expect((await rawRow(created.id))!.lead_id).toBeNull()

    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.analyses set lead_id = $2 where id = $1`, [created.id, lead.id]),
      ),
    ).rejects.toThrow(/append-only/i)

    const otherUser = await newUser()
    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.analyses set created_by = $2 where id = $1`, [
          created.id,
          otherUser.id,
        ]),
      ),
    ).rejects.toThrow(/append-only/i)
  })

  it('nullen UND gleichzeitig etwas anderes ändern wird abgewiesen', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    const created = await createAnalysis(admin, { leadId: lead.id })

    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(
          `update platform.analyses set lead_id = null, customer_label = 'Umgeschrieben' where id = $1`,
          [created.id],
        ),
      ),
    ).rejects.toThrow(/append-only/i)

    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(
          `update platform.analyses set created_by = null, result = '{"x":1}'::jsonb where id = $1`,
          [created.id],
        ),
      ),
    ).rejects.toThrow(/append-only/i)
  })
})

// ── (4) Die Prüfsumme wird gerechnet, nicht geglaubt ─────────────────────────────────────────────
describe('(4) Prüfsumme und Blob-Bindung', () => {
  it('admin_create_analysis WIRFT bei nicht passender Prüfsumme und legt NICHTS an', async () => {
    const admin = await newAdmin()
    const label = `Prüfsumme GmbH ${randomUUID()}`

    // Eine Prüfsumme, die formal richtig aussieht (64 Hex-Zeichen) und zu einer ANDEREN Datei
    // gehört — genau der Fall, den ein ungeprüftes Feld nie bemerken würde.
    const foreign = await sha256Hex(new TextEncoder().encode('eine ganz andere Datei'))
    await expect(
      createAnalysis(admin, { sha256Override: foreign, customerLabel: label }),
    ).rejects.toThrow(/Prüfsumme passt nicht/)

    expect(
      await sql(`select 1 from platform.analyses where customer_label = $1`, [label]),
    ).toEqual([])
  })

  it('eine formal ungültige Prüfsumme wird ebenfalls abgewiesen', async () => {
    const admin = await newAdmin()
    await expect(createAnalysis(admin, { sha256Override: 'nicht-hex' })).rejects.toThrow(
      /64 Hex-Zeichen/,
    )
    // Auch die Grossschreibung derselben Prüfsumme ist zulässig — sie wird normalisiert, nicht
    // abgelehnt (sonst hinge die Gültigkeit an der Schreibweise des Aufrufers).
    const packed = await packSourceFile(SMALL_FILE)
    const ok = await createAnalysis(admin, { sha256Override: packed.sha256.toUpperCase() })
    expect(ok.status).toBe('ok')
    expect((await rawRow(ok.id))!.source_file_sha256).toBe(packed.sha256)
  })

  it('ein Blob, der nicht zur geprüften Datei gehört, wird abgewiesen', async () => {
    const admin = await newAdmin()

    // Kein gzip-Datenstrom.
    await expect(
      createAnalysis(admin, { gzipOverride: new TextEncoder().encode('kein gzip') }),
    ).rejects.toThrow(/kein gzip-Datenstrom/)

    // Gültiges gzip — aber einer ANDEREN Datei. Der ISIZE-Abgleich im gzip-Abschluss fängt das ab.
    const foreignGzip = await gzipCompress(syntheticLoadProfileCsv(200))
    await expect(createAnalysis(admin, { gzipOverride: foreignGzip })).rejects.toThrow(
      /gehört nicht zur übergebenen Datei/,
    )
  })

  it('ein leerer Kundenname wird abgewiesen — die Analyse muss 2027 zuordenbar bleiben', async () => {
    const admin = await newAdmin()
    await expect(createAnalysis(admin, { customerLabel: '   ' })).rejects.toThrow(
      /customer_label ist Pflicht/,
    )
  })

  it('ein unbekanntes analysis_kind wird von der EINEN Definition (CHECK) abgewiesen', async () => {
    const admin = await newAdmin()
    await expect(
      createAnalysis(admin, { analysisKind: 'pilotversuch' as 'betreut' }),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

// ── (5) Zuschnitt der Wrapper + Rundlauf über die echte Kette ────────────────────────────────────
describe('(5) Zuschnitt der Wrapper', () => {
  it('admin_list_analyses liefert NACHWEISLICH weder result noch inputs noch Blob — mit Gesamtzahl', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await createAnalysis(admin, { leadId: lead.id, customerLabel: 'Liste GmbH' })
    await createAnalysis(admin, { leadId: lead.id, analysisKind: 'intern' })

    const listing = await callAs<ListResult>(
      admin,
      `select public.admin_list_analyses(50, 0, $1, null) as r`,
      [lead.id],
    )

    expect(listing.status).toBe('ok')
    expect(listing.total).toBe(2)
    expect(listing.analyses!.length).toBe(2)

    for (const row of listing.analyses!) {
      const keys = Object.keys(row)
      expect(keys).not.toContain('result')
      expect(keys).not.toContain('inputs')
      expect(keys).not.toContain('source_file_gzip')
      expect(keys).not.toContain('source_file_gzip_base64')
      // Die fünf typisierten Auszüge fahren MIT — sie sind der Zweck der Liste.
      expect(keys).toEqual(
        expect.arrayContaining([
          'baseline_billed_kw_before',
          'baseline_billed_kw_after',
          'baseline_annual_saving_eur',
          'recommended_battery_label',
          'recommended_capacity_kwh',
        ]),
      )
    }
    // Und die gesamte Antwort trägt den Blob auch nicht versteckt.
    expect(JSON.stringify(listing)).not.toContain('H4sI')

    // Der kind-Filter greift, ein unbekannter Wert wird ABGELEHNT statt ignoriert.
    const betreut = await callAs<ListResult>(
      admin,
      `select public.admin_list_analyses(50, 0, $1, 'betreut') as r`,
      [lead.id],
    )
    expect(betreut.total).toBe(1)
    const bad = await callAs<ListResult>(
      admin,
      `select public.admin_list_analyses(50, 0, null, 'egal') as r`,
    )
    expect(bad.status).toBe('invalid_filter')
    expect(bad.filter).toBe('kind')
  })

  it('admin_get_analysis liefert result und inputs, aber KEINEN Blob', async () => {
    const admin = await newAdmin()
    const created = await createAnalysis(admin, { customerLabel: 'Detail GmbH' })

    const got = await callAs<GetResult>(admin, `select public.admin_get_analysis($1) as r`, [
      created.id,
    ])

    expect(got.status).toBe('ok')
    const a = got.analysis!
    expect(a.customer_label).toBe('Detail GmbH')
    // Das eingefrorene Ergebnis kommt WORTGLEICH zurück.
    expect((a.result as { current: { billedKw: number } }).current.billedKw).toBe(50.8)
    expect((a.inputs as { tariffParams: { billingModel: string } }).tariffParams.billingModel).toBe(
      'annual_max',
    )
    // Aber der Blob nicht — nur seine Grösse, damit die Oberfläche ihn ANBIETEN kann.
    expect(Object.keys(a)).not.toContain('source_file_gzip')
    expect(Object.keys(a)).not.toContain('source_file_gzip_base64')
    expect(a.source_file_gzip_bytes as number).toBeGreaterThan(0)
    expect(a.created_by_email).toBe(admin.email)

    const missing = await callAs<GetResult>(admin, `select public.admin_get_analysis($1) as r`, [
      randomUUID(),
    ])
    expect(missing.status).toBe('not_found')
  })

  it('der Blob überlebt Schreiben und Lesen BYTE-IDENTISCH — Rundlauf über die echte Wrapper-Kette', async () => {
    const admin = await newAdmin()
    // Ein voller Jahres-Lastgang, nicht drei Zeilen: die Grenzfälle (TOAST-Speicherung, base64,
    // Blockgrenzen der Web-Streams) treten erst bei echter Grösse auf.
    const original = syntheticLoadProfileCsv()
    expect(original.byteLength).toBeGreaterThan(500_000)
    const packed = await packSourceFile(original)

    const created = await createAnalysis(admin, { file: original })

    const source = await callAs<SourceResult>(
      admin,
      `select public.admin_get_analysis_source($1) as r`,
      [created.id],
    )
    expect(source.status).toBe('ok')
    expect(source.source!.source_file_name).toBe('lastgang-2026.csv')
    expect(source.source!.source_file_sha256).toBe(packed.sha256)
    expect(source.source!.source_file_gzip_bytes).toBe(packed.gzip.byteLength)

    // Über die ECHTE Kette zurück: base64 → gzip → entpacken → gegen die Prüfsumme halten.
    const gzipBack = new Uint8Array(
      Buffer.from(source.source!.source_file_gzip_base64, 'base64'),
    )
    const fileBack = await unpackSourceFile(gzipBack, source.source!.source_file_sha256)

    expect(fileBack.byteLength).toBe(original.byteLength)
    expect(Buffer.from(fileBack).equals(Buffer.from(original))).toBe(true)
    // Und die Prüfsumme der zurückgelesenen Datei ist dieselbe wie beim Schreiben — der Beleg, dass
    // die archivierte Datei die ist, aus der gerechnet wurde.
    expect(await sha256Hex(fileBack)).toBe(packed.sha256)

    const missing = await callAs<SourceResult>(
      admin,
      `select public.admin_get_analysis_source($1) as r`,
      [randomUUID()],
    )
    expect(missing.status).toBe('not_found')
  })
})

// ── (6) Aufbewahrung: die Analyse überlebt die Anonymisierung des Leads ──────────────────────────
describe('(6) Aufbewahrung', () => {
  it('anonymize_lead löscht KEINE Analyse und ändert customer_label NICHT', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    const created = await createAnalysis(admin, {
      leadId: lead.id,
      customerLabel: 'Bäckerei Aufbewahrung GmbH',
    })
    const before = await rawRow(created.id)

    const res = await callAs<{ status: string; outcome: string }>(
      admin,
      `select public.admin_anonymize_lead($1) as r`,
      [lead.id],
    )
    expect(res.status).toBe('ok')
    expect(res.outcome).toBe('anonymized')

    // Der Lead trägt keine Identitätsmerkmale mehr …
    const [anonLead] = await sql<{ email: string; company: string | null; status: string }>(
      `select email, company, status from platform.leads where id = $1`,
      [lead.id],
    )
    expect(anonLead!.company).toBeNull()
    expect(anonLead!.status).toBe('anonymized')

    // … die Analyse dagegen steht unverändert da, inklusive Kundenname und Verknüpfung. Sie ist
    // eine kaufmännische Leistung mit eigener, längerer Aufbewahrungsfrist (7 Jahre ab
    // Vertragsschluss) — genau deshalb ist customer_label denormalisiert.
    const after = await rawRow(created.id)
    expect(after).toEqual(before)
    expect(after!.customer_label).toBe('Bäckerei Aufbewahrung GmbH')
    expect(after!.lead_id).toBe(lead.id)
  })
})
