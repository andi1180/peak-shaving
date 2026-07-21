// DB-Gate für die Auftrennung des Kontaktnamens in Vor- und Nachname
// (Migration 20260724090000_split_contact_name.sql).
//
// `platform.leads.contact_name` war seit B1-1 EIN Freitextfeld. Es ist durch `first_name` und
// `last_name` ersetzt, weil eine korrekte Anrede in Korrespondenz (Fahrplan B9) den Nachnamen als
// eigenen Wert braucht und die nachträgliche Zerlegung eines zusammengesetzten Namens bei
// Doppelnamen, Namenszusätzen und Titeln unzuverlässig ist.
//
// ── DAS EIGENTLICHE RISIKO DIESER ÄNDERUNG IST EIN ÜBERSEHENER AUFRUFER ─────────────────────────
// Zwei Wrapper haben eine BRECHEND geänderte Signatur (`capture_lead`, `admin_update_lead`), drei
// weitere lasen die verschwundene Spalte (`admin_list_leads`, `admin_export_leads`,
// `admin_get_lead`), und zwei Trigger-/Hilfsfunktionen nannten sie (`guard_anonymized_lead`,
// `platform.anonymize_lead`). plpgsql prüft Funktionsrümpfe NICHT beim Anlegen — eine vergessene
// Stelle bricht deshalb erst beim ersten AUFRUF, nicht beim Anwenden der Migration (derselbe Befund
// wie in B3-4). Nach der ab B2-1 geltenden Regel wird hier jeder betroffene Wrapper tatsächlich
// AUFGERUFEN, nicht nur auf seine Signatur geprüft.
//
// Bewiesen werden:
//   (1) SPALTEN — contact_name existiert nicht mehr, first_name/last_name schon.
//   (2) ZUSAMMENFÜHRUNG — ein zweiter capture_lead-Aufruf mit anderem Namen überschreibt den zuerst
//       erfassten NICHT (Identitätsfeld-Regel, bewusst gegenläufig zur Segmentierungsregel aus
//       B3-1), und die zwei Felder werden EINZELN zusammengeführt.
//   (3) LEERSTRINGS — werden zu null normalisiert und landen nicht im Bestand.
//   (4) UNVERÄNDERLICHKEIT — ein anonymisierter Lead lässt sich über first_name/last_name nicht mehr
//       ändern, auch nicht über service_role; und anonymize_lead nullt beide.
//   (5) KORREKTURWEG — admin_update_lead ändert beide Felder und respektiert „leer heisst löschen"
//       je Feld einzeln.
//   (6) BACKFILL — die Zerlegungsregel der Migration, an Beispielzeilen MIT und OHNE Leerzeichen
//       nachgerechnet (die Migration selbst ist zum Testzeitpunkt längst gelaufen, s. Kommentar am
//       Test).
//   (7) DIE LESENDEN WRAPPER — admin_get_lead, admin_list_leads und admin_export_leads liefern die
//       zwei Felder und nicht mehr contact_name; alle drei werden echt ausgeführt.
//
// ── ISOLATION GEGEN DEN ÜBRIGEN BESTAND ─────────────────────────────────────────────────────────
// `admin_list_leads`/`admin_export_leads` zählen BESTANDSWEIT, und in derselben Datenbank liegen die
// Fixtures aller übrigen Gates. Die zwei Tests, die eine bestimmte Zeile finden müssen, filtern
// deshalb über einen eindeutigen Firmennamen.

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
  return `namesplit-${randomUUID()}@test.local`
}

async function newAdmin(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

type Outcome = { outcome: string; lead_id?: string }

/**
 * `capture_lead` mit BENANNTEN Parametern — genauso, wie supabase-js es tut (`lib/leads/store.ts`).
 * Der service_role-Weg ist der einzige echte Schreibpfad des Erfassungspfads.
 */
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

async function nameOf(leadId: string) {
  const rows = await sql<{ first_name: string | null; last_name: string | null }>(
    `select first_name, last_name from platform.leads where id = $1`,
    [leadId],
  )
  return rows[0]!
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
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Die Spalten ──────────────────────────────────────────────────────────────────────────────
describe('(1) Spalten', () => {
  it('contact_name existiert nicht mehr, first_name und last_name schon', async () => {
    const rows = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'platform' and table_name = 'leads'
          and column_name in ('contact_name', 'first_name', 'last_name')
        order by column_name`,
    )
    expect(rows.map((r) => r.column_name)).toEqual(['first_name', 'last_name'])
  })

  it('capture_lead trägt p_first_name/p_last_name an der Stelle des früheren p_contact_name', async () => {
    const rows = await sql<{ args: string[] }>(
      `select p.proargnames as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'capture_lead'`,
    )
    // GENAU EINE Überladung: eine zweite machte jeden bestehenden Aufruf mehrdeutig und legte den
    // gesamten Erfassungspfad lahm (der Grund für DROP + CREATE statt eines blossen CREATE).
    expect(rows).toHaveLength(1)
    const args = rows[0]!.args
    expect(args).not.toContain('p_contact_name')
    // Die POSITION ist die eigentliche Aussage: der Name steht weiterhin zwischen Firma und
    // Telefon. Ein Anhängen ans Ende hätte die Lesereihenfolge der Erfassung zerrissen.
    expect(args.slice(args.indexOf('p_company'), args.indexOf('p_phone') + 1)).toEqual([
      'p_company',
      'p_first_name',
      'p_last_name',
      'p_phone',
    ])
  })

  it('capture_lead ist weiterhin service_role-only, admin_update_lead authenticated-only', async () => {
    const can = async (role: string, fn: string) => {
      const rows = await sql<{ can: boolean }>(
        `select has_function_privilege($1, p.oid, 'execute') as can
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $2`,
        [role, fn],
      )
      return rows[0]!.can
    }

    // Ein DROP entfernt bestehende Grants — beide Wrapper wurden neu angelegt, die Rechtefläche
    // musste also erneut gesetzt werden. Genau das wird hier nachgemessen und nicht vorausgesetzt.
    expect(await can('service_role', 'capture_lead')).toBe(true)
    expect(await can('anon', 'capture_lead')).toBe(false)
    expect(await can('authenticated', 'capture_lead')).toBe(false)

    expect(await can('authenticated', 'admin_update_lead')).toBe(true)
    expect(await can('anon', 'admin_update_lead')).toBe(false)
    expect(await can('service_role', 'admin_update_lead')).toBe(false)
  })
})

// ── (2) Zusammenführung ──────────────────────────────────────────────────────────────────────────
describe('(2) Zusammenführung bei wiederholter Erfassung', () => {
  it('DER KERNFALL: ein zweiter Aufruf mit ANDEREM Namen überschreibt den ersten NICHT', async () => {
    const email = newEmail()
    const first = await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })

    const second = await capture({
      p_email: email,
      p_source_key: 'fachvortrag',
      p_first_name: 'Tippfehler',
      p_last_name: 'Falsch',
    })
    expect(second.lead_id, 'derselbe Lead, kein zweiter').toBe(first.lead_id)

    /*
     * Identitätsfeld-Regel: Bestand gewinnt — dieselbe Vorrangregel wie company/phone und bewusst
     * die UMGEKEHRTE der sechs Segmentierungsfelder (B3-1: dort gewinnt der neue Wert, weil
     * Verbrauch, Versorger und Vertragsende genau das sind, was sich ändert). Ein Name ändert sich
     * selten; beim zweiten Mal wird weniger sorgfältig getippt.
     */
    expect(await nameOf(first.lead_id!)).toEqual({ first_name: 'Erika', last_name: 'Muster' })
  })

  it('die zwei Felder werden EINZELN zusammengeführt, nicht als Paar', async () => {
    const email = newEmail()
    // Erster Kontakt: nur der Nachname (ein Einstiegspunkt, der den Vornamen nicht erhebt).
    const first = await capture({
      p_email: email,
      p_source_key: 'fachvortrag',
      p_last_name: 'Muster',
    })
    expect(await nameOf(first.lead_id!)).toEqual({ first_name: null, last_name: 'Muster' })

    // Zweiter Kontakt bringt den Vornamen mit — und darf den bestehenden Nachnamen nicht anfassen.
    await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_first_name: 'Erika',
      p_last_name: 'Anders',
    })
    expect(await nameOf(first.lead_id!)).toEqual({ first_name: 'Erika', last_name: 'Muster' })
  })

  it('ein Aufruf ohne Namen löscht einen bestehenden nicht', async () => {
    const email = newEmail()
    const first = await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })

    // Genau der Fall, in dem ohne die COALESCE-Semantik alles verlorenginge, was der erste Kontakt
    // erbracht hat: ein Einstiegspunkt, der nur die Adresse erhebt.
    await capture({ p_email: email, p_source_key: 'artikel-inline' })

    expect(await nameOf(first.lead_id!)).toEqual({ first_name: 'Erika', last_name: 'Muster' })
  })
})

// ── (3) Leerstrings ──────────────────────────────────────────────────────────────────────────────
describe('(3) Leerstring-Normalisierung', () => {
  it('leere und nur aus Leerzeichen bestehende Namen werden zu null, nicht gespeichert', async () => {
    const res = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_first_name: '',
      p_last_name: '   ',
    })

    /*
     * Ein '' ist kein null: es überlebt jedes COALESCE und überschriebe damit später eine echte
     * Angabe. Genau diese Falle ist in B3-1 schon einmal beschrieben worden — hier gilt sie für
     * die zwei neuen Felder.
     */
    expect(await nameOf(res.lead_id!)).toEqual({ first_name: null, last_name: null })
  })

  it('umgebende Leerzeichen werden entfernt, der Wert selbst bleibt', async () => {
    const res = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_first_name: '  Anna Maria ',
      p_last_name: ' von der Gruber  ',
    })

    // Ein Vorname DARF ein Leerzeichen enthalten („Anna Maria") — getrimmt wird nur aussen. Das ist
    // der Unterschied zur früheren Zerlegung eines Gesamtnamens, die genau hier raten musste.
    expect(await nameOf(res.lead_id!)).toEqual({
      first_name: 'Anna Maria',
      last_name: 'von der Gruber',
    })
  })

  it('ein leer übergebener Name überschreibt einen bestehenden nicht', async () => {
    const email = newEmail()
    const first = await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })

    await capture({
      p_email: email,
      p_source_key: 'direktkontakt',
      p_first_name: '',
      p_last_name: '  ',
    })

    expect(await nameOf(first.lead_id!)).toEqual({ first_name: 'Erika', last_name: 'Muster' })
  })
})

// ── (4) Unveränderlichkeit nach Anonymisierung ───────────────────────────────────────────────────
describe('(4) anonymisierter Lead', () => {
  it('anonymize_lead nullt BEIDE Namensfelder', async () => {
    const admin = await newAdmin()
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })

    // Über den echten Admin-Wrapper — der ruft platform.anonymize_lead auf, und genau der Rumpf ist
    // hier geändert worden.
    const res = await callAs<{ status: string; outcome: string }>(
      admin,
      'select public.admin_anonymize_lead($1) as r',
      [lead.lead_id],
    )
    expect(res).toMatchObject({ status: 'ok', outcome: 'anonymized' })

    expect(await nameOf(lead.lead_id!)).toEqual({ first_name: null, last_name: null })
  })

  it('first_name/last_name lassen sich danach nicht mehr setzen — auch nicht über service_role', async () => {
    const admin = await newAdmin()
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.lead_id])

    const forbidden: [string, string][] = [
      ['first_name', `update platform.leads set first_name = 'Erika' where id = $1`],
      ['last_name', `update platform.leads set last_name = 'Muster' where id = $1`],
    ]

    for (const [label, statement] of forbidden) {
      // BEIDE privilegierten Rollen: der Guard ist ein Trigger und gilt deshalb auch für den
      // Eigentümer der Datenbank — die Anonymisierung ist endgültig, nicht nur „für die Anwendung".
      for (const role of ['service_role', 'postgres'] as const) {
        await expect(
          runAs({ role }, (c) => c.query(statement, [lead.lead_id])),
          `${role} darf ${label} eines anonymisierten Leads nicht setzen`,
        ).rejects.toThrow(/anonymisiert/)
      }
    }

    expect(await nameOf(lead.lead_id!)).toEqual({ first_name: null, last_name: null })
  })
})

// ── (5) Korrekturweg ─────────────────────────────────────────────────────────────────────────────
describe('(5) admin_update_lead', () => {
  it('ändert beide Felder und setzt last_edited_by', async () => {
    const admin = await newAdmin()
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_first_name: 'Falsch',
      p_last_name: 'Geschrieben',
    })

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_lead', {
      p_lead_id: lead.lead_id,
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })
    expect(res.status).toBe('ok')

    expect(await nameOf(lead.lead_id!)).toEqual({ first_name: 'Erika', last_name: 'Muster' })

    const rows = await sql<{ last_edited_by: string | null }>(
      `select last_edited_by from platform.leads where id = $1`,
      [lead.lead_id],
    )
    expect(rows[0]!.last_edited_by).toBe(admin.id)
  })

  it('LEER HEISST LÖSCHEN — und zwar je Feld einzeln', async () => {
    const admin = await newAdmin()
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })

    /*
     * Nur der Vorname wird geleert, der Nachname mitgeschickt. Die Lösch-Semantik ist hier bewusst
     * die UMGEKEHRTE zu capture_lead (dort lässt null unberührt): ein Bearbeitungsformular schickt
     * immer alle Felder, ein geleertes ist eine Aussage. Ohne die Einzelbetrachtung liesse sich ein
     * falsch eingetragener Vorname nicht entfernen, ohne den Nachnamen mitzunehmen.
     */
    await callNamed(admin, 'public.admin_update_lead', {
      p_lead_id: lead.lead_id,
      p_first_name: '   ',
      p_last_name: 'Muster',
    })
    expect(await nameOf(lead.lead_id!)).toEqual({ first_name: null, last_name: 'Muster' })

    // Und ohne beide Parameter fallen beide weg.
    await callNamed(admin, 'public.admin_update_lead', { p_lead_id: lead.lead_id })
    expect(await nameOf(lead.lead_id!)).toEqual({ first_name: null, last_name: null })
  })
})

// ── (6) Backfill ─────────────────────────────────────────────────────────────────────────────────
describe('(6) die Zerlegungsregel des Backfills', () => {
  /*
   * Die Migration ist längst gelaufen, wenn dieser Test startet, und `contact_name` gibt es nicht
   * mehr — der Backfill lässt sich also nicht an echten Zeilen wiederholen. Geprüft wird deshalb
   * die REGEL selbst, mit WÖRTLICH denselben Ausdrücken wie in der Migration, gegen
   * Beispielwerte MIT und OHNE Leerzeichen. Dasselbe Vorgehen wie beim B3-2-Backfill-Test.
   *
   * Das ist keine Tautologie: der Test pinnt, dass ein einzelnes Wort zum NACHNAMEN wird (und nicht
   * zum Vornamen) und dass bei einem Doppelnamen der GESAMTE Rest hinten landet — genau die zwei
   * Entscheidungen, die eine spätere „Vereinfachung" still umdrehen könnte.
   */
  it('zerlegt am ERSTEN Leerzeichen; ein Einzelwort wird zum Nachnamen', async () => {
    const cases: [string, string | null, string][] = [
      ['Max Muster', 'Max', 'Muster'],
      ['Anna Maria Gruber', 'Anna', 'Maria Gruber'],
      ['Muster', null, 'Muster'],
      ['  Erika   Muster  ', 'Erika', 'Muster'],
      ['Dr. Max Muster', 'Dr.', 'Max Muster'],
    ]

    for (const [input, expectedFirst, expectedLast] of cases) {
      const rows = await sql<{ f: string | null; l: string }>(
        `select case
                  when strpos(btrim($1::text), ' ') = 0 then null
                  else split_part(btrim($1::text), ' ', 1)
                end as f,
                case
                  when strpos(btrim($1::text), ' ') = 0 then btrim($1::text)
                  else btrim(substr(btrim($1::text), strpos(btrim($1::text), ' ') + 1))
                end as l`,
        [input],
      )
      expect([input, rows[0]!.f, rows[0]!.l]).toEqual([input, expectedFirst, expectedLast])
    }
  })
})

// ── (7) Die lesenden Wrapper ─────────────────────────────────────────────────────────────────────
describe('(7) die drei lesenden Wrapper liefern die zwei Felder', () => {
  it('admin_get_lead', async () => {
    const admin = await newAdmin()
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })

    const res = await callAs<{
      status: string
      lead: Record<string, unknown>
    }>(admin, 'select public.admin_get_lead($1) as r', [lead.lead_id])

    expect(res.status).toBe('ok')
    expect(res.lead.first_name).toBe('Erika')
    expect(res.lead.last_name).toBe('Muster')
    expect(res.lead).not.toHaveProperty('contact_name')
  })

  it('admin_list_leads', async () => {
    const admin = await newAdmin()
    // Eindeutiger Firmenname als Filter: die Liste zählt bestandsweit, und in derselben Datenbank
    // liegen die Fixtures aller übrigen Gates.
    const marker = `NameSplit-${randomUUID()}`
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })

    const res = await callNamed<{ status: string; total: number; leads: Record<string, unknown>[] }>(
      admin,
      'public.admin_list_leads',
      { p_search: marker },
    )

    expect(res.status).toBe('ok')
    expect(res.total).toBe(1)
    expect(res.leads[0]!.id).toBe(lead.lead_id)
    expect(res.leads[0]!.first_name).toBe('Erika')
    expect(res.leads[0]!.last_name).toBe('Muster')
    expect(res.leads[0]).not.toHaveProperty('contact_name')
  })

  it('admin_export_leads — zwei Spalten, nicht eine zusammengesetzte', async () => {
    const admin = await newAdmin()
    const marker = `NameSplit-${randomUUID()}`
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_first_name: 'Erika',
      p_last_name: 'Muster',
    })

    const res = await callNamed<{
      status: string
      row_count: number
      rows: Record<string, unknown>[]
    }>(admin, 'public.admin_export_leads', { p_search: marker })

    expect(res.status).toBe('ok')
    expect(res.row_count).toBe(1)
    /*
     * Der Grund für die Auftrennung — korrekte Anrede, Wiederverwendbarkeit in einem Serienbrief —
     * gilt für die ausgeführte Datei genauso wie für die Anzeige. Sie hier wieder zu verkleben,
     * gäbe den Zweck genau dort auf, wo er am ehesten gebraucht wird.
     */
    expect(res.rows[0]!.first_name).toBe('Erika')
    expect(res.rows[0]!.last_name).toBe('Muster')
    expect(res.rows[0]).not.toHaveProperty('contact_name')

    // Die Ausfuhr hinterlässt einen Protokolleintrag (B2-1) — hier nur aufgeräumt, geprüft wird das
    // im B2-1-Gate.
    await sql('delete from platform.admin_exports where exported_by = $1', [admin.id])
  })
})
