// DB-Gate für die Partner-Lead-Freigabe (B18-6)
// (Migrationen 20260804090000_partner_lead_disclosure_purpose.sql +
//  20260804090100_create_partner_lead_disclosure.sql).
//
// ── WORAN DIESER SCHRITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ────────────────────────
// (1) ⚠ FREMDE ANFRAGEN. `public.get_my_partner_leads` ist der erste Weg überhaupt, auf dem ein
//     `authenticated`-Konto Daten aus `platform.leads` sieht — einer Tabelle, die für anon und
//     authenticated weiterhin weder Grant noch Policy hat. Eine vergessene `partner_slug`-Bedingung
//     fiele bei genau EINEM Fachbetrieb nirgends auf: Jeder sähe „seine" Anfragen, und sie wären
//     richtig. Ab dem ZWEITEN Betrieb wäre dieselbe Lücke die Herausgabe fremder Kundenkontakte an
//     einen Wettbewerber. Deshalb stehen hier ZWEI Partner nebeneinander, und beide Richtungen
//     werden geprüft — in der Liste UND in der Zahl.
// (2) ⚠ DIE EINWILLIGUNG IST DIE EINZIGE RECHTSGRUNDLAGE. Ohne BESTÄTIGTE Einwilligung darf die
//     Zeile NICHTS Identifizierendes tragen, aber mitzählen. Geprüft wird beides: dass sie in der
//     Zahl auftaucht und dass sie in der Liste FEHLT. Ein Widerruf muss sofort wirken — die
//     Sichtbarkeit wird bei jedem Aufruf neu aus `platform.has_confirmed_consent` entschieden und
//     nirgends zwischengespeichert.
// (3) DER RÜCKGABEUMFANG. Was der Wrapper liefert, kann im ausgelieferten HTML landen — auch wenn
//     niemand es rendert. Geprüft werden die SCHLÜSSEL der Antwort gegen die Spalten von
//     `platform.leads`: der interne Lebenszyklus (`status`), die Aufbewahrungsfelder, Herkunft und
//     Zuordnung sowie die Segmentierungsmerkmale dürfen NICHT mitfahren.
// (4) EIN INAKTIVER PARTNER SIEHT NICHTS — dieselbe Antwort wie „kein Partner", wie bei
//     `get_my_partner` (B16-4b) und `get_active_partner` (B16-2). Die Deaktivierung IST die Ansage.
// (5) ANONYMISIERTE ANFRAGEN SIND WEDER IN DER LISTE NOCH IN DER ZAHL. ⚠ Das ist eine Entscheidung
//     DIESES Wrappers und keine Folge des Schemas: `partner_slug` überlebt die Anonymisierung seit
//     B16-1 ausdrücklich, damit die Partner-Statistik die 24-Monats-Frist überdauert.
// (6) DER NEUE ENUM-WERT VERHÄLT SICH WIE VORGESEHEN. `purpose_requires_double_opt_in` schliesst ihn
//     nicht ein — nicht als Annahme, sondern an der WIRKUNG gemessen: `capture_lead` liefert
//     `consent_confirmed` und speichert keinen Token.
// (7) DER WORTLAUT IST UNVERÄNDERLICH. `platform.consent_texts` ist append-only; eine Korrektur ist
//     version 2, nie ein UPDATE derselben Zeile. Sonst wäre der Nachweis kein Nachweis.
// (8) DIE RECHTEFLÄCHE. authenticated-only; `service_role` bekommt bewusst NICHTS (über service_role
//     ist `auth.uid()` null — ein Grant wäre die Einladung, den Wrapper später „nutzbar" zu machen
//     und damit die einzige Bindung zu entfernen, die diese Sicht sicher macht).
// (9) DER WRAPPER WIRD TATSÄCHLICH AUFGERUFEN (Arbeitsregel 2): Introspektion beweist Existenz,
//     nicht Lauffähigkeit — plpgsql prüft Funktionsrümpfe nicht beim Anlegen.
//
// ⚠ ARBEITSREGEL 5: Fehlende Aufrufbarkeit wird mit `has_function_privilege` geprüft, NIE durch
//     einen Aufruf als Rolle ohne Grant — ein solcher Aufruf hat im CI-Lauf von B16-4a den
//     Postgres-Prozess mit Signal 11 beendet.
//
// ── ISOLATION GEGEN DEN ÜBRIGEN BESTAND ─────────────────────────────────────────────────────────
// Der Wrapper zählt ausschliesslich über den eigenen `partner_slug`, und jeder Slug dieses Gates
// trägt eine zufällige Kennung. Die Zahlen sind damit unabhängig von den Fixtures anderer Gates.

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

const PURPOSE = 'partner_lead_disclosure'

const spawnedUsers: string[] = []
const spawnedPartners: string[] = []
const spawnedLeads: string[] = []

function newSlug(): string {
  return `gate-b186-${randomUUID().slice(0, 8)}`
}

function newEmail(): string {
  return `gate-b186-${randomUUID().slice(0, 8)}@example.test`
}

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

/**
 * Legt einen Fachbetrieb an — als `postgres`, also reines Fixture-Setup (Muster wie
 * `partner-portal.test.ts`). Der Genehmigungsweg ist dort und in `partner-approval.test.ts`
 * vollständig gemessen; ein Umweg darüber brächte hier Fixtures und keine zusätzliche Aussage.
 */
async function newPartner(userId: string | null, isActive = true): Promise<string> {
  const slug = newSlug()
  await sql(
    `insert into platform.partners (slug, display_name, user_id, is_active)
     values ($1, $2, $3, $4)`,
    [slug, 'Elektro Musterbetrieb GmbH', userId, isActive],
  )
  spawnedPartners.push(slug)
  return slug
}

type Outcome = { outcome: string; lead_id?: string; consent_id?: string | null }

/**
 * `public.capture_lead` mit BENANNTEN Parametern — genau wie supabase-js es aufruft
 * (`apps/web/lib/leads/store.ts`). Der service_role-Weg ist der einzige echte Schreibpfad.
 */
async function capture(args: Record<string, unknown>): Promise<Outcome> {
  const keys = Object.keys(args)
  const named = keys
    .map((k, i) => `${k} => $${i + 1}${k === 'p_purpose' ? '::platform.consent_purpose' : ''}`)
    .join(', ')
  const result = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: Outcome }>(`select public.capture_lead(${named}) as r`, [
      ...keys.map((k) => args[k]),
    ])
    return rows[0]!.r
  })
  if (result.lead_id && !spawnedLeads.includes(result.lead_id)) spawnedLeads.push(result.lead_id)
  return result
}

/**
 * Eine Anfrage über die Partner-Landingpage — genau die Aufrufe, die `lib/leads/capture.ts` macht:
 * ERST der Lead, DANN (bei angehakter Freigabe) die Einwilligung als ZWEITER Aufruf.
 */
async function newLead(
  partnerSlug: string,
  opts: { withDisclosure?: boolean; company?: string } = {},
): Promise<{ leadId: string; email: string; disclosure: Outcome | null }> {
  const email = newEmail()
  const lead = await capture({
    p_email: email,
    p_source_key: 'partner-empfehlung',
    p_company: opts.company ?? 'Tischlerei Gruber',
    p_first_name: 'Anna',
    p_last_name: 'Gruber',
    p_phone: '+43 660 1234567',
    p_partner_slug: partnerSlug,
  })

  let disclosure: Outcome | null = null
  if (opts.withDisclosure) {
    disclosure = await capture({
      p_email: email,
      p_source_key: 'partner-empfehlung',
      p_purpose: PURPOSE,
      p_source_ip: '203.0.113.9',
      p_user_agent: 'db-gate/1.0',
    })
  }

  return { leadId: lead.lead_id!, email, disclosure }
}

type PartnerLeads = {
  status: string
  total?: number
  leads?: Record<string, unknown>[]
}

/** Der Weg des Portals: ein angemeldetes Konto ruft `public.get_my_partner_leads()` auf. */
async function getMyPartnerLeads(user: TestUser): Promise<PartnerLeads> {
  return runAs({ role: 'authenticated', userId: user.id }, async (c) => {
    const { rows } = await c.query<{ r: PartnerLeads }>(
      `select public.get_my_partner_leads() as r`,
    )
    return rows[0]!.r
  })
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

// ── (1) Das Vokabular ────────────────────────────────────────────────────────────────────────────
describe('(1) platform.consent_purpose — der vierte Wert', () => {
  it(`'${PURPOSE}' ist ein Wert des Enums`, async () => {
    const rows = await sql<{ value: string }>(
      `select unnest(enum_range(null::platform.consent_purpose))::text as value`,
    )
    expect(rows.map((r) => r.value)).toContain(PURPOSE)
  })

  it('er ist NICHT bestätigungspflichtig — und das ist an der Wirkung gemessen', async () => {
    /*
     * `purpose_requires_double_opt_in` zählt zwei Werte AUF; ein neuer fällt automatisch auf false.
     * Das ist inhaltlich richtig: An den Interessenten geht aus dieser Einwilligung überhaupt keine
     * Mail — sie steuert ausschliesslich die Sichtbarkeit im Portal. Die Funktion zu befragen wäre
     * eine Introspektion; gemessen wird stattdessen, was `capture_lead` daraus macht.
     */
    const requires = await sql<{ r: boolean }>(
      `select platform.purpose_requires_double_opt_in($1::platform.consent_purpose) as r`,
      [PURPOSE],
    )
    expect(requires[0]!.r).toBe(false)

    const slug = await newPartner(null)
    const { leadId, disclosure } = await newLead(slug, { withDisclosure: true })

    // Sofort wirksam — nicht 'consent_created' (das hiesse: Bestätigungsmail).
    expect(disclosure!.outcome).toBe('consent_confirmed')

    const rows = await sql<{ status: string; confirmed_at: string | null; token_hash: string | null }>(
      `select c.status, c.confirmed_at, c.token_hash
         from platform.consents c
         join platform.consent_texts ct on ct.id = c.consent_text_id
        where c.lead_id = $1 and ct.purpose = $2::platform.consent_purpose`,
      [leadId, PURPOSE],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.status).toBe('confirmed')
    expect(rows[0]!.confirmed_at).not.toBeNull()
    // Kein Token: Es gibt nichts zu bestätigen, und ein gespeicherter Hash wäre eine
    // Zugangsberechtigung ohne Zweck.
    expect(rows[0]!.token_hash).toBeNull()
  })
})

// ── (2) Der Wortlaut ─────────────────────────────────────────────────────────────────────────────
describe('(2) platform.consent_texts — der Arbeitsstand', () => {
  it('es gibt genau eine Fassung (version 1, de), und sie ist über den Wrapper lesbar', async () => {
    const rows = await sql<{ version: number; locale: string; body: string }>(
      `select version, locale, body from platform.consent_texts
        where purpose = $1::platform.consent_purpose`,
      [PURPOSE],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.version).toBe(1)
    expect(rows[0]!.locale).toBe('de')

    /*
     * Die Landingpage liest den Wortlaut über GENAU DIESEN Wrapper (`lib/leads/store.ts`). Ohne ihn
     * rendert sie die Ankreuzmöglichkeit nicht — fail closed. Der Aufruf ist damit zugleich der
     * Nachweis nach Arbeitsregel 2 für einen Weg, den B18-6 zum ersten Mal mit diesem Zweck geht.
     */
    const active = await runAs({ role: 'service_role' }, async (c) => {
      const { rows: r } = await c.query<{ r: { status: string; body?: string } }>(
        `select public.get_active_consent_text($1::platform.consent_purpose, 'de') as r`,
        [PURPOSE],
      )
      return r[0]!.r
    })
    expect(active.status).toBe('ok')
    expect(active.body).toBe(rows[0]!.body)
  })

  it('die Aufzählung im Text deckt sich mit dem, was der Wrapper herausgibt', async () => {
    /*
     * Ein Text, der WENIGER nennt, als `get_my_partner_leads` liefert, macht die Einwilligung für
     * den Rest unwirksam; einer, der MEHR nennt, verspricht eine Weitergabe, die nicht stattfindet.
     * Diese Prüfung ist bewusst grob (Wortsuche) — der endgültige Wortlaut ist ein Arbeitsstand und
     * wird sich in der Formulierung ändern, nicht im Umfang.
     */
    const rows = await sql<{ body: string }>(
      `select body from platform.consent_texts where purpose = $1::platform.consent_purpose`,
      [PURPOSE],
    )
    const body = rows[0]!.body
    for (const wort of ['Firma', 'Name', 'E-Mail', 'Telefon']) {
      expect(body).toContain(wort)
    }
  })

  it('ein UPDATE der Fassung wird abgewiesen — eine Korrektur ist version 2', async () => {
    await expect(
      sql(
        `update platform.consent_texts set body = 'umgeschrieben'
          where purpose = $1::platform.consent_purpose`,
        [PURPOSE],
      ),
    ).rejects.toMatchObject({ code: 'P0001' })
  })
})

// ── (3) get_my_partner_leads: die eigenen Anfragen ───────────────────────────────────────────────
describe('(3) get_my_partner_leads — mit Zusage namentlich, ohne Zusage nur gezählt', () => {
  it('mit BESTÄTIGTER Freigabe: die Anfrage steht mit Feldern in der Liste', async () => {
    const user = await newUser()
    const slug = await newPartner(user.id)
    const { leadId, email } = await newLead(slug, { withDisclosure: true })

    const result = await getMyPartnerLeads(user)

    expect(result.status).toBe('ok')
    expect(result.total).toBe(1)
    expect(result.leads).toHaveLength(1)
    expect(result.leads![0]).toMatchObject({
      id: leadId,
      email,
      company: 'Tischlerei Gruber',
      first_name: 'Anna',
      last_name: 'Gruber',
      phone: '+43 660 1234567',
    })
  })

  it('⚠ OHNE Freigabe: zählt mit, steht aber in KEINER Zeile', async () => {
    /*
     * Der Kern des Bauabschnitts. Bewusst KEINE namenlose Platzhalterzeile: Sie trüge trotzdem
     * ihren Zeitpunkt, und ein Zeitpunkt neben einer verschickten Empfehlung ist für den Absender
     * dieser Empfehlung oft schon die Zuordnung. Was der Wrapper nicht herausgibt, kann die
     * Oberfläche nicht versehentlich anzeigen.
     */
    const user = await newUser()
    const slug = await newPartner(user.id)
    await newLead(slug, { withDisclosure: false })
    const mitZusage = await newLead(slug, { withDisclosure: true })

    const result = await getMyPartnerLeads(user)

    expect(result.total).toBe(2)
    expect(result.leads).toHaveLength(1)
    expect(result.leads![0]).toMatchObject({ id: mitZusage.leadId })
  })

  it('ein WIDERRUF wirkt sofort: die Zeile verschwindet aus der Liste, bleibt in der Zahl', async () => {
    /*
     * Die Sichtbarkeit kommt bei JEDEM Aufruf frisch aus `platform.has_confirmed_consent` und wird
     * nirgends zwischengespeichert — genau deshalb gibt es keine zweite Auslegung von „bestätigt"
     * im Rumpf. Ein Widerruf ist der Fall, in dem eine zweite Auslegung auseinanderliefe.
     */
    const user = await newUser()
    const slug = await newPartner(user.id)
    const { leadId } = await newLead(slug, { withDisclosure: true })

    expect((await getMyPartnerLeads(user)).leads).toHaveLength(1)

    await sql(
      `update platform.consents c
          set status = 'withdrawn', withdrawn_at = now()
         from platform.consent_texts ct
        where ct.id = c.consent_text_id
          and c.lead_id = $1
          and ct.purpose = $2::platform.consent_purpose`,
      [leadId, PURPOSE],
    )

    const nachher = await getMyPartnerLeads(user)
    expect(nachher.leads).toHaveLength(0)
    expect(nachher.total).toBe(1)
  })

  it('die Rückgabe trägt GENAU die Felder des Rückrufs — nichts darüber hinaus', async () => {
    /*
     * Was eine Server Component liest, kann im ausgelieferten HTML landen, auch wenn niemand es
     * rendert. Geprüft werden die SCHLÜSSEL, nicht ihre Werte: `status` (interner Lebenszyklus),
     * die Aufbewahrungsfelder, Herkunft/Zuordnung und die Segmentierungsmerkmale dürfen nicht
     * mitfahren. Eine Auswahlliste im TypeScript-Leser wäre eine Zusage, die der nächste Umbau
     * zurücknimmt — die hier gemessene steht in der Datenbank.
     */
    const user = await newUser()
    const slug = await newPartner(user.id)
    await newLead(slug, { withDisclosure: true })

    const result = await getMyPartnerLeads(user)

    expect(Object.keys(result.leads![0]!).sort()).toEqual(
      ['company', 'created_at', 'email', 'first_name', 'id', 'last_name', 'phone'].sort(),
    )
    expect(Object.keys(result).sort()).toEqual(['leads', 'status', 'total'].sort())
  })
})

// ── (4) Die Bindung an das eigene Konto ──────────────────────────────────────────────────────────
describe('(4) fremde Anfragen — weder in der Liste noch in der Zahl', () => {
  it('⚠ ZWEI Fachbetriebe: jeder sieht ausschliesslich seine eigenen, in BEIDE Richtungen', async () => {
    /*
     * Die Lücke, die bei einem einzigen Betrieb nicht auffiele. Geprüft wird auch die ZAHL — eine
     * korrekt gefilterte Liste neben einer bestandsweiten Gesamtzahl wäre bereits eine Auskunft
     * über den Geschäftsgang eines Wettbewerbers.
     */
    const userA = await newUser()
    const userB = await newUser()
    const slugA = await newPartner(userA.id)
    const slugB = await newPartner(userB.id)

    const a = await newLead(slugA, { withDisclosure: true, company: 'Kunde von A' })
    const b1 = await newLead(slugB, { withDisclosure: true, company: 'Kunde von B' })
    await newLead(slugB, { withDisclosure: false })

    const viewA = await getMyPartnerLeads(userA)
    expect(viewA.total).toBe(1)
    expect(viewA.leads!.map((l) => l.id)).toEqual([a.leadId])

    const viewB = await getMyPartnerLeads(userB)
    expect(viewB.total).toBe(2)
    expect(viewB.leads!.map((l) => l.id)).toEqual([b1.leadId])
  })

  it('ein Konto ohne Partnerzeile bekommt {status: none}', async () => {
    const user = await newUser()
    expect(await getMyPartnerLeads(user)).toEqual({ status: 'none' })
  })

  it('ein STILLGELEGTER Fachbetrieb bekommt dieselbe Antwort wie „kein Partner"', async () => {
    /*
     * Wortgleich zu `get_my_partner` (B16-4b) und `get_active_partner` (B16-2): `is_active` steht in
     * der BEDINGUNG, nicht in der Rückgabe. Die Anwendung kann den dritten Zustand („gibt es, ist
     * aber stillgelegt") gar nicht erst erfinden — und ein Portal, das einem stillgelegten Betrieb
     * weiterhin fremde Kontaktdaten anzeigte, wäre die schlechteste denkbare Auskunft.
     */
    const user = await newUser()
    const slug = await newPartner(user.id, false)
    await newLead(slug, { withDisclosure: true })

    expect(await getMyPartnerLeads(user)).toEqual({ status: 'none' })

    // Dieselbe Antwortform wie beim Zwilling — die beiden dürfen hier nicht auseinanderlaufen.
    const partner = await runAs({ role: 'authenticated', userId: user.id }, async (c) => {
      const { rows } = await c.query<{ r: Record<string, unknown> }>(
        `select public.get_my_partner() as r`,
      )
      return rows[0]!.r
    })
    expect(partner).toEqual({ status: 'none' })
  })
})

// ── (5) Anonymisierte Anfragen ───────────────────────────────────────────────────────────────────
describe('(5) anonymisierte Anfragen — weder gezeigt noch gezählt', () => {
  it('⚠ die Zuordnung überlebt die Anonymisierung, die Sichtbarkeit nicht', async () => {
    /*
     * `partner_slug` wird von `platform.anonymize_lead` ausdrücklich NICHT genullt (B16-1: die
     * Partner-Statistik soll die 24-Monats-Frist überdauern). Die Ausblendung ist deshalb eine
     * Entscheidung DIESES Wrappers — wer die Bedingung entfernt, bekommt anonymisierte Zeilen
     * mitgezählt, ohne dass irgendetwas bricht. Genau deshalb steht sie hier als Test.
     */
    const user = await newUser()
    const slug = await newPartner(user.id)
    const alt = await newLead(slug, { withDisclosure: true })
    const neu = await newLead(slug, { withDisclosure: true })

    expect((await getMyPartnerLeads(user)).total).toBe(2)

    await sql(`select platform.anonymize_lead($1, null, true)`, [alt.leadId])

    // Die Zuordnung steht noch — das ist die Voraussetzung dafür, dass der Test etwas beweist.
    const row = await sql<{ partner_slug: string | null; status: string }>(
      `select partner_slug, status from platform.leads where id = $1`,
      [alt.leadId],
    )
    expect(row[0]!.partner_slug).toBe(slug)
    expect(row[0]!.status).toBe('anonymized')

    const nachher = await getMyPartnerLeads(user)
    expect(nachher.total).toBe(1)
    expect(nachher.leads!.map((l) => l.id)).toEqual([neu.leadId])
  })
})

// ── (6) Die Rechtefläche ─────────────────────────────────────────────────────────────────────────
describe('(6) Rechtefläche — authenticated-only', () => {
  it('anon bekommt nichts, service_role bewusst auch nicht', async () => {
    /*
     * Arbeitsregel 5: gemessen über den Katalog, NICHT über einen Aufruf als Rolle ohne Grant — ein
     * solcher Aufruf hat im CI-Lauf von B16-4a den Postgres-Prozess mit Signal 11 beendet.
     *
     * `service_role` ohne Grant ist Absicht und kein Versehen: Über service_role ist `auth.uid()`
     * null, der Wrapper fände also ohnehin nichts. Ein Grant wäre die Einladung, ihn später mit
     * einem Slug-Parameter „nutzbar" zu machen — und damit die einzige Bindung zu entfernen, die
     * diese Sicht sicher macht.
     */
    expect(await executeGrants('get_my_partner_leads')).toEqual({
      anon: false,
      authenticated: true,
      service_role: false,
    })
  })

  it('platform.leads bleibt ohne Grant und ohne Policy für anon und authenticated', async () => {
    /*
     * Die eigentliche Zusicherung dieses Schritts: Es entsteht KEIN zweiter Lesepfad auf die
     * Tabelle. Der Wrapper ist SECURITY DEFINER — die Bindung liegt in seinem Rumpf, nicht in einer
     * Tabellenberechtigung, die der nächste Umbau versehentlich weiter öffnet.
     */
    const grants = await sql<{ grantee: string }>(
      `select grantee from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'leads'
          and grantee in ('anon', 'authenticated')`,
    )
    expect(grants).toHaveLength(0)

    const policies = await sql<{ policyname: string }>(
      `select policyname from pg_policies where schemaname = 'platform' and tablename = 'leads'`,
    )
    expect(policies).toHaveLength(0)
  })
})
