// DB-Gate für den Zuordnungs-Filter „hat einen Fachbetrieb / hat keinen"
// (Migration 20260804120000_lead_partner_assignment_filter.sql, B18-5).
//
// B16-1 hat den Filter „genau DIESER Fachbetrieb" gebaut (`p_partner_slug`). Der Admin-Bereich
// braucht zusätzlich die Mengenfrage: welche Leads sind ÜBERHAUPT einem Betrieb zugeordnet, welche
// nicht. Das ist ein eigener Parameter (`p_partner_assignment`), kein zweiter Sinn für den Slug.
//
// ── WORAN DIESER ABSCHNITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ──────────────────────
// (1) DER FILTER GREIFT NUR IN DER LISTE. Der Export übernimmt die Filter der Sicht; fehlte der
//     Parameter dort, fiele aus einer auf Partner-Leads gefilterten Ansicht eine Datei mit dem
//     GESAMTBESTAND. Beide Zahlen wären plausibel, und die Abweichung fiele erst an der Datei auf,
//     wenn sie das System bereits verlassen hat. Deshalb wird jede Richtung in BEIDEN Wrappern
//     gemessen und die Mengen werden gegeneinander geprüft.
// (2) `total` ZÄHLT DEN GESAMTBESTAND STATT DER TEILMENGE. Die Trefferzahl entsteht aus derselben
//     CTE wie die Zeilen — wenn sie es nicht täte, zeigte die Seitenaufteilung mehr Seiten an, als
//     es Treffer gibt. Gemessen wird deshalb `total`, nicht nur `leads.length`.
// (3) DER FILTER WIRKT, ABER DIE SPALTE FEHLT IN DER ANTWORT. Dann liesse sich am Ergebnis nicht
//     nachvollziehen, warum die Menge kleiner wurde (B2-1). `partner_slug` wird im zurückgegebenen
//     JSON geprüft, nicht nur die Zeilenzahl.
// (4) EIN UNBEKANNTER WERT WIRD STILL VERWORFEN. Dann bekäme der Admin den vollen Bestand und
//     hielte ihn für die gefilterte Teilmenge — der teuerste stille Ausfall dieser Schicht.
// (5) DER WIDERSPRUCH LIEFERT EINE LEERE MENGE. „genau dieser Betrieb" UND „gar kein Betrieb" ist
//     per Konstruktion leer, und die leere Menge läse sich als „dieser Fachbetrieb hat niemanden
//     gebracht" (dieselbe Fehlauskunft, gegen die B16-1 den unbekannten Slug ablehnt).
// (6) DER DROP HAT GRANTS ENTFERNT. Vier Funktionen sind neu angelegt worden; die Rechtefläche wird
//     NACHGEMESSEN, nicht vorausgesetzt (in B3-1 real einmal passiert). Geprüft wird über
//     `has_function_privilege` und NICHT über einen Aufruf als Rolle ohne Grant — ein solcher
//     Aufruf hat im CI-Image bereits einmal den Postgres-Prozess abgeschossen (Arbeitsregel 5).
// (7) DIE BESTEHENDEN FILTER SIND MITGEWANDERT UND KAPUTT. `leads_matching` wurde vollständig neu
//     angelegt; jede bestehende Bedingung ist damit potenziell betroffen. Eine Regressionsprobe
//     über Branche, PLZ-Präfix, Status, Freitext und Einwilligungszustand läuft deshalb mit.
//
// ── ISOLATION GEGEN DEN ÜBRIGEN BESTAND ─────────────────────────────────────────────────────────
// `admin_list_leads`/`admin_export_leads` zählen BESTANDSWEIT, und in derselben Datenbank liegen die
// Fixtures aller übrigen Gates. Bei `p_partner_slug` genügte ein eindeutiger Slug als Klammer — die
// Richtung `unassigned` trifft dagegen JEDEN Lead ohne Zuordnung, also fast den gesamten Bestand.
// Jeder Test dieses Gates setzt deshalb einen eindeutigen FIRMENnamen und klammert über
// `p_search` — was zugleich beweist, dass der neue Filter mit einem bestehenden zusammenwirkt.

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

function newEmail(): string {
  return `b185-${randomUUID()}@test.local`
}

/** Ein eindeutiger, formatgültiger Slug — Bindestriche, keine Unterstriche (der CHECK verlangt es). */
function newSlug(prefix = 'b185'): string {
  return `${prefix}-${randomUUID()}`
}

/** Die Klammer eines Testlaufs: ein Firmenname, den kein anderes Fixture trägt. */
function newMarker(): string {
  return `B185-${randomUUID()}`
}

async function newAdmin(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

type Outcome = { outcome: string; lead_id?: string }

async function capture(args: Record<string, unknown>): Promise<Outcome> {
  const keys = Object.keys(args)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  const result = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: Outcome }>(
      `select public.capture_lead(${named}) as r`,
      keys.map((k) => args[k]),
    )
    return rows[0]!.r
  })
  if (result.lead_id && !spawnedLeads.includes(result.lead_id)) spawnedLeads.push(result.lead_id)
  return result
}

async function callNamed<T = Record<string, unknown>>(
  user: TestUser,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const keys = Object.keys(args)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(
      `select ${fn}(${named}) as r`,
      keys.map((k) => args[k]),
    )
    return rows[0]!.r
  })
}

async function createPartner(admin: TestUser, slug: string): Promise<void> {
  const res = await callNamed<{ status: string }>(admin, 'public.admin_create_partner', {
    p_slug: slug,
    p_display_name: `Elektro ${slug}`,
  })
  expect(res.status, `Partner ${slug} anlegen`).toBe('created')
  spawnedPartners.push(slug)
}

type ListResult = {
  status: string
  total: number
  export_total: number
  leads: Record<string, unknown>[]
}

type ExportResult = {
  status: string
  row_count: number
  filter_summary: string
  rows: Record<string, unknown>[]
}

/** Liste UND Ausfuhr mit DENSELBEN Filtern — der Vergleich ist der eigentliche Zweck des Gates. */
async function listAndExport(
  admin: TestUser,
  filters: Record<string, unknown>,
): Promise<{ list: ListResult; exp: ExportResult }> {
  const list = await callNamed<ListResult>(admin, 'public.admin_list_leads', filters)
  const exp = await callNamed<ExportResult>(admin, 'public.admin_export_leads', filters)
  return { list, exp }
}

async function clearExports(admin: TestUser): Promise<void> {
  await sql('delete from platform.admin_exports where exported_by = $1', [admin.id])
}

/**
 * Das Standard-Fixture: zwei Leads MIT Fachbetrieb (verschiedene Betriebe — sonst wäre `assigned`
 * von einem Slug-Filter nicht zu unterscheiden) und zwei OHNE, alle unter einem Firmennamen.
 */
async function seedMixed(admin: TestUser) {
  const marker = newMarker()
  const slugA = newSlug('a')
  const slugB = newSlug('b')
  await createPartner(admin, slugA)
  await createPartner(admin, slugB)

  const withA = await capture({
    p_email: newEmail(),
    p_source_key: 'kontaktformular',
    p_company: marker,
    p_partner_slug: slugA,
  })
  const withB = await capture({
    p_email: newEmail(),
    p_source_key: 'kontaktformular',
    p_company: marker,
    p_partner_slug: slugB,
  })
  // Ein Lead, der den Betrieb NUR im Freitext nennt: er gilt als „ohne Zuordnung". Genau dieser
  // Fall ist der, den ein Mensch noch entscheiden muss — er darf nicht in `assigned` landen.
  const freetextOnly = await capture({
    p_email: newEmail(),
    p_source_key: 'kontaktformular',
    p_company: marker,
    p_referred_by_text: `Fa. Elektro ${slugA}`,
  })
  const plain = await capture({
    p_email: newEmail(),
    p_source_key: 'kontaktformular',
    p_company: marker,
  })

  return {
    marker,
    slugA,
    slugB,
    ids: {
      withA: withA.lead_id!,
      withB: withB.lead_id!,
      freetextOnly: freetextOnly.lead_id!,
      plain: plain.lead_id!,
    },
  }
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  // Partner NACH den Leads: der Fremdschlüssel ist `on delete restrict`.
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

// ── (1) Rechte nach dem DROP ─────────────────────────────────────────────────────────────────────
describe('(1) Grants — nach dem DROP nachgemessen, nicht vorausgesetzt', () => {
  it('die zwei public-Wrapper sind weiterhin authenticated-only', async () => {
    /*
     * Arbeitsregel 5: KEIN Aufruf als Rolle ohne Grant. Eine SECURITY-DEFINER-Funktion so
     * aufzurufen hat im CI-Image bereits einmal den Postgres-Prozess abgeschossen (Signal 11)
     * statt sauber mit 42501 abzulehnen. `has_function_privilege` beantwortet dieselbe Frage.
     */
    const rows = await sql<{ proname: string; role: string; can: boolean }>(
      `select p.proname, r.role, has_function_privilege(r.role, p.oid, 'execute') as can
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace,
              (values ('anon'), ('authenticated'), ('service_role')) as r(role)
        where n.nspname = 'public'
          and p.proname in ('admin_list_leads', 'admin_export_leads')`,
    )
    expect(rows.length, 'je Funktion GENAU EINE Überladung × drei Rollen').toBe(6)

    for (const row of rows) {
      expect(row.can, `${row.proname} für ${row.role}`).toBe(row.role === 'authenticated')
    }
  })

  it('die zwei platform-Filterfunktionen sind von aussen weiterhin nicht aufrufbar', async () => {
    const rows = await sql<{ proname: string; role: string; can: boolean }>(
      `select p.proname, r.role, has_function_privilege(r.role, p.oid, 'execute') as can
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace,
              (values ('anon'), ('authenticated'), ('service_role')) as r(role)
        where n.nspname = 'platform'
          and p.proname in ('leads_matching', 'lead_filter_summary')`,
    )
    expect(rows.length, 'je Funktion GENAU EINE Überladung × drei Rollen').toBe(6)
    for (const row of rows) {
      expect(row.can, `platform.${row.proname} für ${row.role}`).toBe(false)
    }
  })

  it('der neue Parameter steht in allen vier Funktionen und heisst überall gleich', async () => {
    const rows = await sql<{ fn: string; has: boolean }>(
      `select n.nspname || '.' || p.proname as fn,
              'p_partner_assignment' = any(p.proargnames) as has
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname = 'public'
                 and p.proname in ('admin_list_leads', 'admin_export_leads'))
           or (n.nspname = 'platform'
                 and p.proname in ('leads_matching', 'lead_filter_summary'))`,
    )
    expect(rows.length, 'vier Funktionen, keine Überladung').toBe(4)
    for (const row of rows) {
      expect(row.has, `${row.fn} kennt p_partner_assignment`).toBe(true)
    }
  })
})

// ── (2) Der Filter selbst ────────────────────────────────────────────────────────────────────────
describe('(2) assigned / unassigned in Liste UND Ausfuhr', () => {
  it('OHNE den Filter sind alle vier da — die Gegenprobe zum Fixture', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    const { list, exp } = await listAndExport(admin, { p_search: f.marker })
    expect(list.status).toBe('ok')
    expect(list.total, 'alle vier Leads des Laufs').toBe(4)
    expect(exp.row_count).toBe(4)
    await clearExports(admin)
  })

  it('DER KERNFALL assigned: nur zugeordnete Leads, und die Ausfuhr liefert dieselbe Menge', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    const { list, exp } = await listAndExport(admin, {
      p_search: f.marker,
      p_partner_assignment: 'assigned',
    })

    expect(list.status).toBe('ok')
    // `total` ist die Trefferzahl der TEILMENGE, nicht die des Bestands — sonst zeigte die
    // Seitenaufteilung mehr Seiten an, als es Treffer gibt.
    expect(list.total, 'nur die zwei Leads mit Zuordnung').toBe(2)
    expect(list.leads.length).toBe(2)
    expect(new Set(list.leads.map((l) => l.id))).toEqual(new Set([f.ids.withA, f.ids.withB]))

    // Der Lead, der den Betrieb NUR im Freitext nennt, gehört NICHT dazu: gefiltert wird über die
    // bestätigte Zuordnung, nicht über die Beobachtung.
    expect(list.leads.map((l) => l.id)).not.toContain(f.ids.freetextOnly)

    /*
     * DIE EIGENTLICHE AUSSAGE: derselbe Filter, dieselbe Menge. Ohne den durchgereichten Parameter
     * fiele aus einer gefilterten Sicht eine Datei mit dem Gesamtbestand — beide Zahlen wären
     * plausibel, und die Abweichung fiele erst an der Datei auf.
     */
    expect(exp.status).toBe('ok')
    expect(exp.row_count).toBe(list.export_total)
    expect(exp.row_count).toBe(2)
    expect(new Set(exp.rows.map((r) => r.id))).toEqual(new Set([f.ids.withA, f.ids.withB]))

    await clearExports(admin)
  })

  it('DER KERNFALL unassigned: nur Leads ohne Zuordnung, Ausfuhr deckungsgleich', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    const { list, exp } = await listAndExport(admin, {
      p_search: f.marker,
      p_partner_assignment: 'unassigned',
    })

    expect(list.total, 'der Freitext-Lead und der schlichte').toBe(2)
    expect(new Set(list.leads.map((l) => l.id))).toEqual(
      new Set([f.ids.freetextOnly, f.ids.plain]),
    )
    expect(list.leads.every((l) => l.partner_slug === null)).toBe(true)

    expect(exp.row_count).toBe(list.export_total)
    expect(exp.row_count).toBe(2)
    expect(new Set(exp.rows.map((r) => r.id))).toEqual(new Set([f.ids.freetextOnly, f.ids.plain]))

    await clearExports(admin)
  })

  it('die zwei Richtungen sind komplementär und überschneidungsfrei', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    const all = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
      p_search: f.marker,
    })
    const assigned = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
      p_search: f.marker,
      p_partner_assignment: 'assigned',
    })
    const unassigned = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
      p_search: f.marker,
      p_partner_assignment: 'unassigned',
    })

    expect(assigned.total + unassigned.total, 'zusammen der volle Bestand des Laufs').toBe(
      all.total,
    )
    const overlap = assigned.leads
      .map((l) => l.id)
      .filter((id) => unassigned.leads.some((l) => l.id === id))
    expect(overlap, 'kein Lead liegt in beiden Mengen').toEqual([])
  })

  it('`partner_slug` steht tatsächlich im JSON — Liste UND Ausfuhr', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    const { list, exp } = await listAndExport(admin, {
      p_search: f.marker,
      p_partner_assignment: 'assigned',
    })

    /*
     * Der Filter kann wirken, ohne dass die Spalte mitfährt — dann liesse sich am Ergebnis nicht
     * nachvollziehen, WARUM die Menge kleiner wurde (B2-1). Geprüft wird der Schlüssel, nicht nur
     * ein Wahrheitswert: ein fehlendes Feld käme als `undefined` und ginge in einer
     * Wahrheitsprüfung unter.
     */
    for (const row of list.leads) {
      expect(Object.keys(row), 'Liste führt partner_slug').toContain('partner_slug')
      expect(Object.keys(row), 'Liste führt referred_by_text').toContain('referred_by_text')
    }
    expect(new Set(list.leads.map((l) => l.partner_slug))).toEqual(new Set([f.slugA, f.slugB]))

    for (const row of exp.rows) {
      expect(Object.keys(row), 'Ausfuhr führt partner_slug').toContain('partner_slug')
      expect(Object.keys(row), 'Ausfuhr führt den Anzeigenamen').toContain('partner_display_name')
    }
    expect(new Set(exp.rows.map((r) => r.partner_slug))).toEqual(new Set([f.slugA, f.slugB]))

    await clearExports(admin)
  })

  it('das Ausfuhrprotokoll nennt die Zuordnungsfrage — und verwechselt sie nicht mit einem Slug', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    const assigned = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_search: f.marker,
      p_partner_assignment: 'assigned',
    })
    expect(assigned.filter_summary).toContain('nur mit Fachbetrieb-Zuordnung')
    // Nicht als zweites „Partner: …": daneben stünde dasselbe Wort für zwei verschiedene Aussagen,
    // und wer das Protokoll später liest, müsste raten, ob ein einzelner Betrieb gemeint war.
    expect(assigned.filter_summary).not.toContain('Partner: assigned')

    const unassigned = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_search: f.marker,
      p_partner_assignment: 'unassigned',
    })
    expect(unassigned.filter_summary).toContain('nur ohne Fachbetrieb-Zuordnung')

    // Und der Eintrag ist wirklich geschrieben worden, mit der Zeilenzahl der Teilmenge.
    const rows = await sql<{ row_count: number; filter_summary: string }>(
      `select row_count, filter_summary from platform.admin_exports
        where exported_by = $1 order by exported_at`,
      [admin.id],
    )
    expect(rows.length).toBe(2)
    expect(rows[0]!.row_count).toBe(2)
    expect(rows[1]!.row_count).toBe(2)

    await clearExports(admin)
  })
})

// ── (3) Abgelehnte Eingaben ──────────────────────────────────────────────────────────────────────
describe('(3) ein Wert, den die Bedingung nicht kennt, wird ABGELEHNT', () => {
  it('unbekannter Wert → invalid_filter in BEIDEN Wrappern, und keine Ausfuhr entsteht', async () => {
    const admin = await newAdmin()

    /*
     * Still verworfen wäre dieser Filter der teuerste Ausfall dieser Schicht: der Admin bekäme den
     * VOLLEN Bestand und hielte ihn für die gefilterte Teilmenge. Genau deshalb ist der Parameter
     * ein `text` mit fester Wertemenge und kein dreiwertiger `boolean` — auf `boolean` abgebildet
     * könnte ein unbekannter Wert im Anwendungscode nur zu „kein Filter" werden.
     */
    for (const fn of ['public.admin_list_leads', 'public.admin_export_leads']) {
      for (const bad of ['quatsch', 'true', 'mit', 'ASSIGNED-X']) {
        expect(
          await callNamed<{ status: string; filter: string }>(admin, fn, {
            p_partner_assignment: bad,
          }),
          `${fn} mit „${bad}"`,
        ).toMatchObject({ status: 'invalid_filter', filter: 'partner_assignment' })
      }
    }

    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.admin_exports where exported_by = $1`,
      [admin.id],
    )
    expect(rows[0]!.n, 'eine abgelehnte Ausfuhr ist keine Ausfuhr').toBe(0)
  })

  it('Grossschreibung und umgebende Leerzeichen sind zulässig — sie treffen denselben Wert', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    // Kleingeschrieben und getrimmt wird in Wrapper UND Filterbedingung. Liefe eines von beiden
    // ungetrimmt, käme die Prüfung durch und die Bedingung griffe nicht mehr — also wieder der
    // volle Bestand als scheinbar gefiltert.
    const res = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
      p_search: f.marker,
      p_partner_assignment: '  Assigned  ',
    })
    expect(res).toMatchObject({ status: 'ok', total: 2 })
  })

  it('ein leerer Wert ist KEIN Filter, sondern seine Abwesenheit', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    for (const empty of ['', '   ']) {
      const res = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
        p_search: f.marker,
        p_partner_assignment: empty,
      })
      expect(res, `„${empty}"`).toMatchObject({ status: 'ok', total: 4 })
    }
  })

  it('DER WIDERSPRUCH: ein Slug UND „unassigned" wird abgewiesen statt leer beantwortet', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    /*
     * Die Menge wäre per Konstruktion leer, und eine leere Menge läse sich als „dieser Fachbetrieb
     * hat niemanden gebracht" — dieselbe Fehlauskunft, gegen die B16-1 den unbekannten Slug
     * ablehnt. Der Fall ist nicht theoretisch: sobald der Reiter „Partner-Leads" eine Auswahlliste
     * einzelner Betriebe bekommt, steht daneben genau dieser Umschalter.
     */
    for (const fn of ['public.admin_list_leads', 'public.admin_export_leads']) {
      expect(
        await callNamed<{ status: string; filter: string }>(admin, fn, {
          p_partner_slug: f.slugA,
          p_partner_assignment: 'unassigned',
        }),
        fn,
      ).toMatchObject({ status: 'invalid_filter', filter: 'partner_assignment' })
    }

    await clearExports(admin)
  })

  it('„assigned" PLUS ein Slug ist dagegen zulässig — redundant, aber widerspruchsfrei', async () => {
    const admin = await newAdmin()
    const f = await seedMixed(admin)

    const { list, exp } = await listAndExport(admin, {
      p_search: f.marker,
      p_partner_slug: f.slugA,
      p_partner_assignment: 'assigned',
    })

    expect(list, 'die Schnittmenge ist genau der eine Lead').toMatchObject({
      status: 'ok',
      total: 1,
    })
    expect(list.leads[0]!.id).toBe(f.ids.withA)
    expect(exp.row_count).toBe(1)
    // Beide Filter stehen im Protokoll — der Slug als Slug, die Zuordnungsfrage als eigener Satzteil.
    expect(exp.filter_summary).toContain(`Partner: ${f.slugA}`)
    expect(exp.filter_summary).toContain('nur mit Fachbetrieb-Zuordnung')

    await clearExports(admin)
  })
})

// ── (4) Regression: die bestehenden Filter ───────────────────────────────────────────────────────
describe('(4) `leads_matching` wurde neu angelegt — die bestehenden Filter sind nachgemessen', () => {
  it('Branche, PLZ-Präfix, Status und Freitext filtern unverändert', async () => {
    const admin = await newAdmin()
    const marker = newMarker()

    const kuehl = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_industry: 'kuehlhaus',
      p_postal_code: '1100',
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'warteliste',
      p_company: marker,
      p_industry: 'gastronomie',
      p_postal_code: '1010',
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_industry: 'kuehlhaus',
      p_postal_code: '8010',
    })

    const only = async (args: Record<string, unknown>) =>
      (await callNamed<ListResult>(admin, 'public.admin_list_leads', { p_search: marker, ...args }))
        .total

    expect(await only({}), 'Freitext über die Firma klammert den Lauf').toBe(3)
    expect(await only({ p_industry: 'kuehlhaus' }), 'Branche').toBe(2)
    // Der Präfix ist die führende Ziffernfolge, nicht die ganze PLZ: „1" trifft beide Wiener
    // Bezirke (1100, 1010) und nicht die Grazer 8010.
    expect(await only({ p_postal_prefix: '1' }), 'PLZ-Präfix trifft ein Gebiet').toBe(2)
    expect(await only({ p_postal_prefix: '11' }), 'engerer Präfix').toBe(1)
    expect(await only({ p_postal_prefix: '1100' }), 'PLZ-Präfix voll ausgeschrieben').toBe(1)
    expect(await only({ p_postal_prefix: '8' }), 'anderes Netzgebiet').toBe(1)
    expect(await only({ p_source_key: 'warteliste' }), 'Herkunft').toBe(1)
    expect(await only({ p_status: 'new' }), 'Status').toBe(3)
    expect(await only({ p_status: 'customer' }), 'Status ohne Treffer').toBe(0)
    expect(
      await only({ p_industry: 'kuehlhaus', p_postal_prefix: '1' }),
      'zwei bestehende Filter kombiniert',
    ).toBe(1)

    // Und die abweisenden Prüfungen sind ebenfalls mitgewandert.
    expect(
      await callNamed<{ status: string; filter: string }>(admin, 'public.admin_list_leads', {
        p_status: 'quatsch',
      }),
    ).toMatchObject({ status: 'invalid_filter', filter: 'status' })
    expect(
      await callNamed<{ status: string; filter: string }>(admin, 'public.admin_list_leads', {
        p_postal_prefix: '11a',
      }),
    ).toMatchObject({ status: 'invalid_filter', filter: 'postal_prefix' })

    expect(kuehl.outcome).toBe('lead_only')
  })

  it('BEHOBEN IN B18-5: eine Ausfuhr mit „nur fällige" lieferte einen Datenbankfehler statt einer Datei', async () => {
    const admin = await newAdmin()

    /*
     * BESTEHENDER FEHLER AUS B2-1, hier gemessen und in derselben Migration behoben.
     * `v_parts := v_parts || 'nur zur Anonymisierung fällige'` ist mehrdeutig: Postgres löste
     * `text[] || untypisiertes Literal` als `anyarray || anyarray` auf und las die Zeichenkette als
     * Array-Literal — die Funktion brach mit 22P02 („malformed array literal").
     *
     * WIRKUNG: Wer in der Lead-Liste „nur zur Anonymisierung fällige" ankreuzte und dann
     * exportierte, bekam einen Fehler statt einer Datei. Die LISTE war nie betroffen (sie filtert
     * über `leads_matching`), nur die Ausfuhr — und nur mit diesem einen Filter. Kein Test hat je
     * mit gesetztem `p_due_only` ausgeführt, deshalb ist es nie aufgefallen.
     *
     * Der Test steht hier und nicht bei den neuen Filtern, weil er eine REGRESSION pinnt: er wird
     * rot, sobald jemand den `::text`-Cast für überflüssige Kosmetik hält und entfernt.
     */
    const summary = await sql<{ r: string }>(
      `select platform.lead_filter_summary(p_due_only => true) as r`,
    )
    expect(summary[0]!.r).toContain('nur zur Anonymisierung fällige')

    // Und über den echten Wrapper: die Ausfuhr läuft durch und protokolliert den Filter im Klartext.
    const exp = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_due_only: true,
    })
    expect(exp.status).toBe('ok')
    expect(exp.filter_summary).toContain('nur zur Anonymisierung fällige')

    // Beide nackten Literale in EINEM Aufruf — der neue Zweig und der reparierte zusammen.
    const both = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_due_only: true,
      p_partner_assignment: 'assigned',
    })
    expect(both.status).toBe('ok')
    expect(both.filter_summary).toContain('nur zur Anonymisierung fällige')
    expect(both.filter_summary).toContain('nur mit Fachbetrieb-Zuordnung')

    await clearExports(admin)
  })

  it('der Einwilligungsfilter unterscheidet weiterhin Zweck und Zustand', async () => {
    const admin = await newAdmin()
    const marker = newMarker()

    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_purpose: 'marketing_email',
      p_token_hash: randomUUID(),
      p_token_expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    })
    await capture({ p_email: newEmail(), p_source_key: 'kontaktformular', p_company: marker })

    const only = async (args: Record<string, unknown>) =>
      (await callNamed<ListResult>(admin, 'public.admin_list_leads', { p_search: marker, ...args }))
        .total

    expect(await only({}), 'beide Leads').toBe(2)
    expect(await only({ p_consent_status: 'pending' }), 'offene Einwilligung').toBe(1)
    expect(await only({ p_consent_status: 'confirmed' }), 'keine bestätigte').toBe(0)
    expect(await only({ p_consent_status: 'none' }), '„none" ist die Umkehrung').toBe(1)
    expect(
      await only({ p_consent_purpose: 'marketing_email', p_consent_status: 'pending' }),
      'Zweck UND Zustand',
    ).toBe(1)
    expect(
      await only({ p_consent_purpose: 'contract_expiry_reminder', p_consent_status: 'pending' }),
      'anderer Zweck',
    ).toBe(0)
  })

  it('der neue Filter greift ZUSAMMEN mit einem bestehenden, nicht statt seiner', async () => {
    const admin = await newAdmin()
    const marker = newMarker()
    const slug = newSlug('kombi')
    await createPartner(admin, slug)

    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_industry: 'kuehlhaus',
      p_partner_slug: slug,
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_industry: 'gastronomie',
      p_partner_slug: slug,
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_industry: 'kuehlhaus',
    })

    const only = async (args: Record<string, unknown>) =>
      (await callNamed<ListResult>(admin, 'public.admin_list_leads', { p_search: marker, ...args }))
        .total

    expect(await only({ p_partner_assignment: 'assigned' })).toBe(2)
    expect(await only({ p_industry: 'kuehlhaus' })).toBe(2)
    expect(
      await only({ p_partner_assignment: 'assigned', p_industry: 'kuehlhaus' }),
      'die Schnittmenge, nicht die Vereinigung',
    ).toBe(1)
    expect(await only({ p_partner_assignment: 'unassigned', p_industry: 'kuehlhaus' })).toBe(1)
    expect(await only({ p_partner_assignment: 'unassigned', p_industry: 'gastronomie' })).toBe(0)
  })
})
