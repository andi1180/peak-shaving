// DB-Gate für Korrekturweg, Segmentierungsfilter und Export (B2-1)
// (Migration 20260723090000_create_lead_editing_filters_export.sql).
//
// B2-1 macht den Bestand bearbeitbar und ausführbar. Beides sind Vorgänge mit Aussenwirkung, und
// beide sind still, wenn sie falsch sind: eine Korrektur, die eine Zweckbindung umgeht, sieht aus
// wie eine erhobene Angabe; eine Datei, die eine gesperrte Adresse enthält, sieht aus wie jede
// andere Datei. Das Gate beweist deshalb fünf Dinge:
//
//   (1) ZUGRIFFSGRENZE — jeder der vier neuen Wrapper lehnt einen eingeloggten NICHT-Admin mit
//       einem FEHLER ab (nicht mit einer leeren Antwort), und die Grant-Fläche ist exakt
//       `authenticated`.
//   (2) KORREKTURWEG — die neun erlaubten Felder ändern sich, `last_edited_by` wird gesetzt, und
//       die E-Mail ist über diesen Weg NICHT erreichbar (der Parameter existiert nicht).
//   (3) ZWECKBINDUNG — Versorger/Vertragsende ohne Einwilligung werfen; mit 'pending' geht es;
//       Leeren geht immer.
//   (4) UNVERÄNDERLICHKEIT — ein anonymisierter Lead lässt sich nicht bearbeiten und bekommt keine
//       Bearbeiter-Zuschreibung, auch nicht über service_role.
//   (5) EXPORT — die Filter zählen konsistent, gesperrte und anonymisierte Zeilen fallen
//       strukturell heraus, der Einwilligungsstand steht je Zeile, und jede Ausfuhr hinterlässt
//       genau einen Protokolleintrag.
//
// ── JEDER NEUE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ──────────────────────────────────────────────
// Introspektion beweist nur, dass eine Funktion existiert. plpgsql prüft Funktionsrümpfe NICHT beim
// Anlegen — in B3-4 lief eine Migration sauber durch und wäre erst beim ersten Aufruf gescheitert
// (ein fehlender Join). Jeder hier neue oder geänderte Wrapper wird deshalb mindestens einmal echt
// ausgeführt, nicht nur auf Existenz und Grant-Fläche geprüft.
//
// ── WARUM DIE GRANT-PRÜFUNG PER KATALOG-INTROSPEKTION LÄUFT ─────────────────────────────────────
// Wie in allen bisherigen Wrapper-Gates: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant. `has_function_privilege` ist dieselbe
// Wahrheit ohne Absturz der geteilten Test-/CI-Datenbank. Die Ablehnung des eingeloggten
// NICHT-Admins wird dagegen ECHT aufgerufen — dort HAT der Aufrufer das Grant, und genau die
// Ablehnung IN der Funktion ist die zu beweisende Eigenschaft.
//
// ── ISOLATION GEGEN DEN ÜBRIGEN BESTAND ─────────────────────────────────────────────────────────
// `admin_export_leads` und `admin_list_leads` zählen BESTANDSWEIT, und in derselben Datenbank liegen
// die Fixtures aller übrigen Gates. Jeder Zähl-Test setzt deshalb einen eindeutigen Suchbegriff als
// Firmenname und filtert darauf; das Protokoll wird über eine VORHER/NACHHER-Differenz geprüft.

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

/** Die vier Wrapper, die B2-1 neu anlegt. `admin_list_leads` wird ERSETZT und separat geprüft. */
const B2_1_WRAPPERS = [
  'admin_update_lead',
  'admin_export_leads',
  'admin_list_exports',
] as const

const spawnedUsers: string[] = []
const spawnedLeads: string[] = []
const spawnedSuppressionHashes: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

/**
 * Ein Jahresverbrauch, den sonst niemand im Bestand trägt — als Filter-Marker für die Tests, die
 * eine ANONYMISIERTE Zeile im Filter brauchen. Firmenname und E-Mail scheiden dafür aus: beide
 * werden bei der Anonymisierung entfernt, ein Freitext-Marker verlöre die Zeile schon im Filter.
 * Der Verbrauch überlebt sie bewusst (B3-1). Die Bandbreite ab 900 Mio. liegt weit ausserhalb
 * dessen, was die übrigen Gates als Fixture-Werte benutzen.
 */
function uniqueConsumption(): number {
  return 900_000_000 + Math.floor(Math.random() * 99_999_999)
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
async function newLead(
  opts: {
    company?: string
    industry?: string | null
    postalCode?: string | null
    consumption?: number | null
    meteringType?: string | null
  } = {},
): Promise<TestLead> {
  const email = `b21-${randomUUID()}@test.local`
  const id = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into platform.leads
         (email, first_source_key, company, industry, postal_code, annual_consumption_kwh,
          metering_type)
       values ($1, 'kontaktformular', $2, $3::platform.industry, $4, $5, $6)
       returning id`,
      [
        email,
        opts.company ?? 'B2-1 GmbH',
        opts.industry ?? null,
        opts.postalCode ?? null,
        opts.consumption ?? null,
        opts.meteringType ?? null,
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

/** Einwilligung auf dem realen Schreibpfad (service_role, committed). */
async function insertConsent(fields: {
  leadId: string
  purpose: string
  status: 'pending' | 'confirmed' | 'withdrawn'
}): Promise<void> {
  const textId = await consentTextId(fields.purpose)
  await runAs({ role: 'service_role', commit: true }, (c) =>
    c.query(
      `insert into platform.consents
         (lead_id, consent_text_id, source_key, status, confirmed_at, withdrawn_at,
          token_hash, token_expires_at)
       values ($1, $2, 'kontaktformular', $3,
               case when $3 = 'confirmed' then now() else null end,
               case when $3 = 'withdrawn' then now() else null end,
               $4, now() + interval '7 days')`,
      [fields.leadId, textId, fields.status, randomUUID()],
    ),
  )
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

/** Aufruf mit BENANNTEN Parametern — so ruft supabase-js sie auch auf. */
async function callNamed<T = Record<string, unknown>>(
  user: TestUser,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const keys = Object.keys(args)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  return callAs<T>(
    user,
    `select ${fn}(${named}) as r`,
    keys.map((k) => args[k]),
  )
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

async function leadRow(id: string) {
  const rows = await sql<{
    email: string
    company: string | null
    first_name: string | null
    last_name: string | null
    phone: string | null
    industry: string | null
    postal_code: string | null
    annual_consumption_kwh: number | null
    metering_type: string | null
    supplier: string | null
    contract_end_date: string | null
    last_edited_by: string | null
    status: string
  }>(
    `select email, company, first_name, last_name, phone, industry, postal_code,
            annual_consumption_kwh,
            metering_type, supplier, contract_end_date::text as contract_end_date,
            last_edited_by, status
       from platform.leads where id = $1`,
    [id],
  )
  return rows[0]!
}

async function suppress(email: string): Promise<void> {
  const hash = (await sql<{ h: string }>(`select platform.email_hash($1) as h`, [email]))[0]!.h
  await sql(
    `insert into platform.email_suppressions (email_hash, reason) values ($1, 'manual')
     on conflict (email_hash) do nothing`,
    [hash],
  )
  spawnedSuppressionHashes.push(hash)
}

type ListResult = {
  status: string
  total: number
  export_total: number
  filter?: string
  leads: { id: string; email: string; industry: string | null; postal_code: string | null }[]
}

type ExportRow = {
  id: string
  email: string
  company: string | null
  industry: string | null
  postal_code: string | null
  marketing_consent: string
}

type ExportResult = {
  status: string
  rows: ExportRow[]
  row_count: number
  filter_summary: string
  export_id: string
}

/**
 * Die ZEHN bearbeitbaren Felder in EINEM Aufruf — dieselbe Form wie die Server Action.
 * (Neun waren es bis zur Auftrennung des Kontaktnamens in Vor- und Nachname.)
 */
const TEN_FIELDS = {
  p_company: 'Korrigiert GmbH',
  p_first_name: 'Erika',
  p_last_name: 'Muster',
  p_phone: '+43 1 9999999',
  p_industry: 'tischlerei',
  p_postal_code: '4020',
  p_annual_consumption_kwh: 123456,
  p_metering_type: 'leistungsgemessen',
} as const

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  /*
   * ZUERST die Protokollzeilen der Test-Admins: `exported_by` trägt ON DELETE SET NULL, ein
   * Löschen der Konten liesse sie also als herrenlose Zeilen zurück und der nächste Lauf zählte
   * gegen einen anderen Bestand.
   */
  if (spawnedUsers.length > 0) {
    await sql('delete from platform.admin_exports where exported_by = any($1)', [spawnedUsers])
  }
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  for (const h of spawnedSuppressionHashes.splice(0)) {
    await sql('delete from platform.email_suppressions where email_hash = $1', [h])
  }
  for (const id of spawnedUsers.splice(0)) {
    // Räumt über ON DELETE SET NULL auch last_edited_by/exported_by der Testzeilen ab.
    await deleteUser(id)
  }
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Zugriffsgrenze ───────────────────────────────────────────────────────────────────────────
describe('(1) Zugriffsgrenze der neuen Wrapper', () => {
  it('die Grant-Fläche ist exakt `authenticated` — auch für das ersetzte admin_list_leads', async () => {
    for (const fn of [...B2_1_WRAPPERS, 'admin_list_leads']) {
      expect(await canExecute('anon', fn), `anon darf ${fn} nicht ausführen`).toBe(false)
      expect(
        await canExecute('service_role', fn),
        `service_role darf ${fn} nicht ausführen (Autorisierung hängt an auth.uid())`,
      ).toBe(false)
      expect(await canExecute('authenticated', fn), `${fn} ist authenticated-only`).toBe(true)
    }
  })

  it('die drei platform-Helfer sind von aussen gar nicht aufrufbar', async () => {
    for (const fn of ['leads_matching', 'lead_filter_summary', 'marketing_consent_state']) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        expect(
          await canExecute(role, fn, 'platform'),
          `${role} darf platform.${fn} nicht direkt aufrufen`,
        ).toBe(false)
      }
    }
  })

  it('platform.admin_exports hat RLS und für KEINE Rolle ein Grant', async () => {
    const rls = await sql<{ enabled: boolean }>(
      `select relrowsecurity as enabled from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'platform' and c.relname = 'admin_exports'`,
    )
    expect(rls[0]!.enabled).toBe(true)

    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const priv of ['select', 'insert', 'update', 'delete']) {
        const rows = await sql<{ can: boolean }>(
          `select has_table_privilege($1, 'platform.admin_exports', $2) as can`,
          [role, priv],
        )
        expect(rows[0]!.can, `${role} darf kein ${priv} auf platform.admin_exports`).toBe(false)
      }
    }
  })

  it('ein eingeloggter Nicht-Admin bekommt aus JEDEM neuen Wrapper einen FEHLER, keine leere Antwort', async () => {
    const user = await newUser()
    const lead = await newLead()
    const exportsBefore = (
      await sql<{ n: number }>('select count(*)::int as n from platform.admin_exports')
    )[0]!.n

    const calls: [string, string, unknown[]][] = [
      ['admin_update_lead', 'select public.admin_update_lead($1) as r', [lead.id]],
      ['admin_export_leads', 'select public.admin_export_leads() as r', []],
      ['admin_list_exports', 'select public.admin_list_exports(10) as r', []],
      [
        'admin_list_leads',
        `select public.admin_list_leads(p_industry => 'handel') as r`,
        [],
      ],
    ]

    for (const [name, text, params] of calls) {
      await expect(callAs(user, text, params), `${name} muss werfen`).rejects.toMatchObject({
        code: '42501',
      })
    }

    // Und: es ist nichts entstanden — weder eine Änderung noch ein Protokolleintrag. Gezählt wird
    // als DIFFERENZ, weil in derselben Datenbank die Fixtures der übrigen Tests liegen.
    const row = await leadRow(lead.id)
    expect(row.last_edited_by).toBeNull()
    const after = (
      await sql<{ n: number }>('select count(*)::int as n from platform.admin_exports')
    )[0]!.n
    expect(after - exportsBefore).toBe(0)
  })
})

// ── (2) + (3) Korrekturweg ───────────────────────────────────────────────────────────────────────
describe('(2) admin_update_lead ändert die neun erlaubten Felder', () => {
  it('setzt alle neun Felder und last_edited_by auf den handelnden Admin', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'contract_expiry_reminder', status: 'confirmed' })

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_lead', {
      p_lead_id: lead.id,
      ...TEN_FIELDS,
      p_supplier: 'Wien Energie',
      p_contract_end_date: '2027-03-31',
    })
    expect(res.status).toBe('ok')

    const row = await leadRow(lead.id)
    expect(row.company).toBe('Korrigiert GmbH')
    expect(row.first_name).toBe('Erika')
    expect(row.last_name).toBe('Muster')
    expect(row.phone).toBe('+43 1 9999999')
    expect(row.industry).toBe('tischlerei')
    expect(row.postal_code).toBe('4020')
    expect(row.annual_consumption_kwh).toBe(123456)
    expect(row.metering_type).toBe('leistungsgemessen')
    expect(row.supplier).toBe('Wien Energie')
    expect(row.contract_end_date).toBe('2027-03-31')
    // Die eigentliche Zusatzaussage dieses Tests: WER es war, steht in der Zeile.
    expect(row.last_edited_by).toBe(admin.id)
  })

  it('ein leeres Feld LÖSCHT die Angabe (anders als beim Erfassungspfad)', async () => {
    const admin = await newAdmin()
    const lead = await newLead({ company: 'Vorher GmbH', industry: 'handel', postalCode: '1010' })

    await callNamed(admin, 'public.admin_update_lead', { p_lead_id: lead.id })

    const row = await leadRow(lead.id)
    // `capture_lead` (B3-1) liesse diese Werte bei null-Argumenten UNBERÜHRT. Hier ist null eine
    // Aussage („war falsch, soll weg") — sonst liesse sich kein Feld je bereinigen.
    expect(row.company).toBeNull()
    expect(row.industry).toBeNull()
    expect(row.postal_code).toBeNull()
  })
})

describe('(3) die E-Mail ist über den Korrekturweg nicht erreichbar', () => {
  it('der Wrapper hat gar keinen E-Mail-Parameter', async () => {
    const rows = await sql<{ args: string[] }>(
      `select p.proargnames as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'admin_update_lead'`,
    )
    expect(rows).toHaveLength(1)
    const args = rows[0]!.args
    expect(args).not.toContain('p_email')
    // Gegenprobe, damit der Test nicht durch einen Tippfehler im Namen grün wird:
    expect(args).toContain('p_company')
    // Zehn statt neun bearbeitbarer Felder plus p_lead_id, seit der Kontaktname in Vor- und
    // Nachname aufgetrennt ist.
    expect(args).toContain('p_first_name')
    expect(args).toContain('p_last_name')
    expect(args).not.toContain('p_contact_name')
    expect(args).toHaveLength(11)
  })

  it('nach einem vollständigen Aufruf ist die Adresse unverändert', async () => {
    const admin = await newAdmin()
    const lead = await newLead()

    await callNamed(admin, 'public.admin_update_lead', { p_lead_id: lead.id, ...TEN_FIELDS })

    const row = await leadRow(lead.id)
    expect(row.email).toBe(lead.email)
    expect(row.company).toBe('Korrigiert GmbH')
  })
})

// ── (4) (5) (6) Zweckbindung ─────────────────────────────────────────────────────────────────────
describe('Zweckbindung von Versorger und Vertragsende', () => {
  it('(4) supplier ohne Einwilligung → Ausnahme, und NICHTS wurde geändert', async () => {
    const admin = await newAdmin()
    const lead = await newLead({ company: 'Unberührt GmbH' })

    await expect(
      callNamed(admin, 'public.admin_update_lead', {
        p_lead_id: lead.id,
        p_company: 'Neu GmbH',
        p_supplier: 'Verbotener Versorger',
      }),
    ).rejects.toMatchObject({ code: '22023' })

    const row = await leadRow(lead.id)
    expect(row.supplier).toBeNull()
    // Die Ausnahme kommt VOR jeder Wirkung — auch die erlaubte Firmenänderung fällt weg.
    expect(row.company).toBe('Unberührt GmbH')
    expect(row.last_edited_by).toBeNull()
  })

  it('(4b) auch das Vertragsende allein wird ohne Einwilligung abgewiesen', async () => {
    const admin = await newAdmin()
    const lead = await newLead()

    await expect(
      callNamed(admin, 'public.admin_update_lead', {
        p_lead_id: lead.id,
        p_contract_end_date: '2027-01-31',
      }),
    ).rejects.toMatchObject({ code: '22023' })

    expect((await leadRow(lead.id)).contract_end_date).toBeNull()
  })

  it('(4c) eine WIDERRUFENE Einwilligung genügt nicht', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'contract_expiry_reminder', status: 'withdrawn' })

    await expect(
      callNamed(admin, 'public.admin_update_lead', {
        p_lead_id: lead.id,
        p_supplier: 'Wien Energie',
      }),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it('(4d) eine Einwilligung zu einem ANDEREN Zweck genügt nicht', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await insertConsent({ leadId: lead.id, purpose: 'marketing_email', status: 'confirmed' })

    await expect(
      callNamed(admin, 'public.admin_update_lead', {
        p_lead_id: lead.id,
        p_supplier: 'Wien Energie',
      }),
    ).rejects.toMatchObject({ code: '22023' })
  })

  it("(5) mit 'pending'-Einwilligung ist das Setzen erlaubt", async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    // 'pending' ist zugelassen, weil capture_lead die Felder bereits VOR der Bestätigung schreibt —
    // sonst wäre eine Korrektur genau in dem Zeitfenster unmöglich, in dem Tippfehler auffallen.
    await insertConsent({ leadId: lead.id, purpose: 'contract_expiry_reminder', status: 'pending' })

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_lead', {
      p_lead_id: lead.id,
      p_supplier: 'Verbund',
      p_contract_end_date: '2027-06-30',
    })

    expect(res.status).toBe('ok')
    const row = await leadRow(lead.id)
    expect(row.supplier).toBe('Verbund')
    expect(row.contract_end_date).toBe('2027-06-30')
  })

  it('(6) auf null setzen ist auch OHNE Einwilligung erlaubt', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    // Ausgangslage privilegiert herstellen: Werte da, Einwilligung nicht (der Zustand, den der
    // B3-1-Trigger beim Widerruf hinterlässt, wenn er die Felder NICHT erwischt hätte).
    await sql(
      `update platform.leads set supplier = 'Alt', contract_end_date = date '2027-02-01'
        where id = $1`,
      [lead.id],
    )

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_lead', {
      p_lead_id: lead.id,
    })

    expect(res.status).toBe('ok')
    const row = await leadRow(lead.id)
    expect(row.supplier).toBeNull()
    expect(row.contract_end_date).toBeNull()
  })
})

// ── (7) Anonymisierter Lead ──────────────────────────────────────────────────────────────────────
describe('(7) ein anonymisierter Lead ist unveränderlich', () => {
  it('admin_update_lead lehnt ab und ändert nichts', async () => {
    const admin = await newAdmin()
    const lead = await newLead({ company: 'Weg GmbH' })
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_lead', {
      p_lead_id: lead.id,
      p_company: 'Wieder da GmbH',
      p_industry: 'handel',
    })

    // Fachlicher Zustand, kein Autorisierungsfehler — der Trigger würde ohnehin werfen.
    expect(res.status).toBe('anonymized')
    const row = await leadRow(lead.id)
    expect(row.company).toBeNull()
    expect(row.industry).toBeNull()
    expect(row.last_edited_by).toBeNull()
  })

  it('last_edited_by lässt sich auch über service_role und postgres nicht SETZEN', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])

    for (const role of ['service_role', 'postgres'] as const) {
      await expect(
        runAs({ role }, (c) =>
          c.query('update platform.leads set last_edited_by = $2 where id = $1', [
            lead.id,
            admin.id,
          ]),
        ),
        `${role} darf einem anonymisierten Lead keinen Bearbeiter anheften`,
      ).rejects.toThrow(/anonymisiert/)
    }

    expect((await leadRow(lead.id)).last_edited_by).toBeNull()
  })

  it('das NULLEN von last_edited_by bleibt möglich — sonst bräche ON DELETE SET NULL', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    // Vor der Anonymisierung bearbeiten, damit eine Zuschreibung existiert.
    await callNamed(admin, 'public.admin_update_lead', { p_lead_id: lead.id, p_company: 'X GmbH' })
    expect((await leadRow(lead.id)).last_edited_by).toBe(admin.id)

    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.id])

    /*
     * Die asymmetrische Guard-Regel (setzen verboten, nullen erlaubt) ist kein Schlupfloch, sondern
     * die Voraussetzung dafür, dass ein Admin-Konto überhaupt gelöscht werden kann: die
     * referentielle Aktion ON DELETE SET NULL IST ein UPDATE auf diese Zeile. Bei anonymized_by hat
     * B1-3 dasselbe Problem mit dem völligen Verzicht auf Schutz gelöst — hier geht mehr.
     */
    await runAs({ role: 'postgres', commit: true }, (c) =>
      c.query('update platform.leads set last_edited_by = null where id = $1', [lead.id]),
    )
    expect((await leadRow(lead.id)).last_edited_by).toBeNull()

    // Und der ECHTE Pfad: das Konto löschen, während der anonymisierte Lead darauf zeigt.
    await sql('update platform.leads set last_edited_by = null where id = $1', [lead.id])
  })

  it('das Löschen eines Admin-Kontos nullt die Zuschreibung, statt zu blockieren', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await callNamed(admin, 'public.admin_update_lead', { p_lead_id: lead.id, p_company: 'Y GmbH' })
    expect((await leadRow(lead.id)).last_edited_by).toBe(admin.id)

    await deleteUser(admin.id)
    spawnedUsers.splice(spawnedUsers.indexOf(admin.id), 1)

    const row = await leadRow(lead.id)
    expect(row.last_edited_by).toBeNull()
    // Die Korrektur selbst bleibt bestehen — nur ihre Zuschreibung entfällt.
    expect(row.company).toBe('Y GmbH')
  })
})

// ── (8) Die neuen Filter ─────────────────────────────────────────────────────────────────────────
describe('(8) die Segmentierungsfilter zählen konsistent', () => {
  it('einzeln und kombiniert; der PLZ-Präfix trifft mehrere Bezirke', async () => {
    const admin = await newAdmin()
    const marker = `filtertest-${randomUUID()}`

    await newLead({ company: marker, industry: 'kuehlhaus', postalCode: '1010', consumption: 50_000, meteringType: 'netzebene_7' })
    await newLead({ company: marker, industry: 'kuehlhaus', postalCode: '1020', consumption: 150_000, meteringType: 'leistungsgemessen' })
    await newLead({ company: marker, industry: 'handel', postalCode: '1100', consumption: 250_000, meteringType: 'netzebene_7' })
    await newLead({ company: marker, industry: 'handel', postalCode: '4020', consumption: 350_000, meteringType: null })

    const count = async (args: Record<string, unknown>): Promise<number> => {
      const res = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
        p_search: marker,
        ...args,
      })
      expect(res.status).toBe('ok')
      return res.total
    }

    expect(await count({})).toBe(4)
    expect(await count({ p_industry: 'kuehlhaus' })).toBe(2)
    expect(await count({ p_metering_type: 'netzebene_7' })).toBe(2)
    // Der Präfix ist der eigentliche Punkt: „10" trifft ZWEI verschiedene Postleitzahlen, „1" drei.
    expect(await count({ p_postal_prefix: '10' })).toBe(2)
    expect(await count({ p_postal_prefix: '1' })).toBe(3)
    expect(await count({ p_postal_prefix: '1010' })).toBe(1)
    expect(await count({ p_consumption_min: 150_000 })).toBe(3)
    expect(await count({ p_consumption_max: 150_000 })).toBe(2)
    expect(await count({ p_consumption_min: 150_000, p_consumption_max: 250_000 })).toBe(2)
    // Kombiniert: UND-Verknüpfung, nicht ODER.
    expect(await count({ p_industry: 'kuehlhaus', p_postal_prefix: '10' })).toBe(2)
    expect(await count({ p_industry: 'handel', p_postal_prefix: '10' })).toBe(0)
    expect(
      await count({ p_industry: 'kuehlhaus', p_metering_type: 'netzebene_7' }),
    ).toBe(1)
  })

  it('Vertragsende von/bis grenzt beidseitig ein (Grenzen gehören dazu)', async () => {
    const admin = await newAdmin()
    const marker = `vertragstest-${randomUUID()}`
    const a = await newLead({ company: marker })
    const b = await newLead({ company: marker })
    const c = await newLead({ company: marker })
    await sql(`update platform.leads set contract_end_date = date '2027-01-31' where id = $1`, [a.id])
    await sql(`update platform.leads set contract_end_date = date '2027-06-30' where id = $1`, [b.id])
    await sql(`update platform.leads set contract_end_date = date '2028-01-01' where id = $1`, [c.id])

    const count = async (args: Record<string, unknown>): Promise<number> =>
      (await callNamed<ListResult>(admin, 'public.admin_list_leads', { p_search: marker, ...args }))
        .total

    expect(await count({})).toBe(3)
    expect(await count({ p_contract_end_from: '2027-06-30' })).toBe(2)
    expect(await count({ p_contract_end_to: '2027-06-30' })).toBe(2)
    expect(await count({ p_contract_end_from: '2027-01-31', p_contract_end_to: '2027-06-30' })).toBe(2)
  })

  it('unbekannte Filterwerte werden ABGELEHNT, nicht still ignoriert', async () => {
    const admin = await newAdmin()

    for (const [args, expected] of [
      [{ p_metering_type: 'erfunden' }, 'metering_type'],
      [{ p_postal_prefix: '11a' }, 'postal_prefix'],
      [{ p_postal_prefix: '11000' }, 'postal_prefix'],
      [{ p_status: 'quatsch' }, 'status'],
    ] as const) {
      const res = await callNamed<ListResult>(admin, 'public.admin_list_leads', args)
      expect(res.status).toBe('invalid_filter')
      expect(res.filter).toBe(expected)
    }
  })

  it('export_total ist NICHT total: gesperrte und anonymisierte fallen heraus', async () => {
    const admin = await newAdmin()
    /*
     * Der Marker ist hier der JAHRESVERBRAUCH und nicht der Firmenname — und das ist der Punkt:
     * die Anonymisierung NULLT company und ersetzt die E-Mail, ein Freitext-Marker verlöre die
     * anonymisierte Zeile also schon im Filter und der Test bewiese nichts. Der Verbrauch überlebt
     * die Anonymisierung bewusst (B3-1: grob einordnend, nicht lokalisierend) — nur so liegt die
     * Zeile im Filter und muss vom EXPORT ausgeschlossen werden.
     */
    const marker = uniqueConsumption()
    await newLead({ consumption: marker })
    const gesperrt = await newLead({ consumption: marker })
    const anonym = await newLead({ consumption: marker })
    await suppress(gesperrt.email)
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [anonym.id])

    const res = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
      p_consumption_min: marker,
      p_consumption_max: marker,
    })
    expect(res.total).toBe(3)
    expect(res.export_total).toBe(1)
  })
})

// ── (9) (10) (11) Export ─────────────────────────────────────────────────────────────────────────
describe('Export', () => {
  it('(9) schliesst gesperrte und anonymisierte Zeilen aus, auch wenn der Filter sie einschlösse', async () => {
    const admin = await newAdmin()
    // Verbrauch als Marker, nicht Firmenname: er überlebt die Anonymisierung, die anonymisierte
    // Zeile liegt also WIRKLICH im Filter (s. ausführlich beim export_total-Test oben).
    const marker = uniqueConsumption()
    const normal = await newLead({ consumption: marker })
    const gesperrt = await newLead({ consumption: marker })
    const anonym = await newLead({ consumption: marker })
    await suppress(gesperrt.email)
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [anonym.id])

    // Der Filter schliesst alle drei ein — der Ausschluss steht in der ABFRAGE, nicht im Filter,
    // und lässt sich deshalb nicht wegkonfigurieren.
    const list = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
      p_consumption_min: marker,
      p_consumption_max: marker,
    })
    expect(list.total).toBe(3)

    const res = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_consumption_min: marker,
      p_consumption_max: marker,
    })

    expect(res.status).toBe('ok')
    expect(res.row_count).toBe(1)
    expect(res.rows.map((r) => r.id)).toEqual([normal.id])
    const emails = res.rows.map((r) => r.email)
    expect(emails).not.toContain(gesperrt.email)
    expect(emails.some((e) => e.startsWith('anonymized+'))).toBe(false)

  })

  it("(9b) ein ausdrücklicher Statusfilter 'anonymized' liefert eine LEERE Datei, keine Zeilen", async () => {
    const admin = await newAdmin()
    const marker = `exportanon-${randomUUID()}`
    const anonym = await newLead({ company: marker })
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [anonym.id])

    const res = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_search: marker,
      p_status: 'anonymized',
    })

    expect(res.status).toBe('ok')
    expect(res.row_count).toBe(0)
  })

  it('(10) der Einwilligungsstand steht je Zeile und unterscheidet bestätigt von offen', async () => {
    const admin = await newAdmin()
    const marker = `consenttest-${randomUUID()}`
    const bestaetigt = await newLead({ company: marker })
    const offen = await newLead({ company: marker })
    const widerrufen = await newLead({ company: marker })
    const keine = await newLead({ company: marker })

    await insertConsent({ leadId: bestaetigt.id, purpose: 'marketing_email', status: 'confirmed' })
    await insertConsent({ leadId: offen.id, purpose: 'marketing_email', status: 'pending' })
    await insertConsent({ leadId: widerrufen.id, purpose: 'marketing_email', status: 'withdrawn' })
    // Eine Einwilligung zu einem ANDEREN Zweck darf die Marketing-Spalte nicht färben.
    await insertConsent({ leadId: keine.id, purpose: 'result_delivery', status: 'confirmed' })

    const res = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_search: marker,
    })

    const byId = new Map(res.rows.map((r) => [r.id, r.marketing_consent]))
    expect(byId.get(bestaetigt.id)).toBe('bestätigt')
    expect(byId.get(offen.id)).toBe('offen')
    expect(byId.get(widerrufen.id)).toBe('widerrufen')
    expect(byId.get(keine.id)).toBe('keine')
    // Keine Zeile ohne Angabe — das ist die gefährlichste Zeile in der Datei.
    expect(res.rows.every((r) => r.marketing_consent.length > 0)).toBe(true)
  })

  it('(11) jede Ausfuhr hinterlässt GENAU EINEN Protokolleintrag mit passender Zeilenzahl', async () => {
    const admin = await newAdmin()
    const marker = `protokoll-${randomUUID()}`
    await newLead({ company: marker, industry: 'gastronomie', postalCode: '1010' })
    await newLead({ company: marker, industry: 'gastronomie', postalCode: '1020' })

    const before = (
      await sql<{ n: number }>('select count(*)::int as n from platform.admin_exports')
    )[0]!.n

    const res = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_search: marker,
      p_industry: 'gastronomie',
      p_postal_prefix: '10',
    })
    expect(res.row_count).toBe(2)

    const after = await sql<{
      n: number
    }>('select count(*)::int as n from platform.admin_exports')
    expect(after[0]!.n - before).toBe(1)

    const entry = (
      await sql<{ row_count: number; filter_summary: string; exported_by: string | null }>(
        'select row_count, filter_summary, exported_by from platform.admin_exports where id = $1',
        [res.export_id],
      )
    )[0]!
    expect(entry.row_count).toBe(2)
    expect(entry.exported_by).toBe(admin.id)
    // Der Filter steht im Klartext — ohne ihn beantwortet das Protokoll nur „wer und wann".
    expect(entry.filter_summary).toContain('Branche: gastronomie')
    expect(entry.filter_summary).toContain('PLZ beginnt mit 10')
    expect(entry.filter_summary).toContain('ohne gesperrte und anonymisierte Zeilen')

    // Und der Leseweg: admin_list_exports wird ECHT aufgerufen, nicht nur auf Existenz geprüft.
    const listed = await callNamed<{
      status: string
      exports: { id: string; row_count: number; exported_by_email: string | null }[]
    }>(admin, 'public.admin_list_exports', { p_limit: 100 })
    expect(listed.status).toBe('ok')
    const mine = listed.exports.find((e) => e.id === res.export_id)
    expect(mine?.row_count).toBe(2)
    expect(mine?.exported_by_email).toBe(admin.email)

  })

  it('(11b) ein leerer Filter wird als „alle" protokolliert — es gibt keinen ungefilterten Export', async () => {
    const admin = await newAdmin()

    const res = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {})
    expect(res.status).toBe('ok')
    expect(res.filter_summary).toContain('alle (kein Filter gesetzt)')

  })

  it('admin_get_lead liefert last_edited_by samt E-Mail des Kontos', async () => {
    const admin = await newAdmin()
    const lead = await newLead()
    await callNamed(admin, 'public.admin_update_lead', { p_lead_id: lead.id, p_company: 'Z GmbH' })

    const res = await callAs<{
      status: string
      lead: { last_edited_by: string | null; last_edited_by_email: string | null }
    }>(admin, 'select public.admin_get_lead($1) as r', [lead.id])

    expect(res.status).toBe('ok')
    expect(res.lead.last_edited_by).toBe(admin.id)
    expect(res.lead.last_edited_by_email).toBe(admin.email)
  })
})
