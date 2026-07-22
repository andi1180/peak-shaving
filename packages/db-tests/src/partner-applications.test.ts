// DB-Gate für die Partner-Bewerbungen
// (Migration 20260725150000_create_partner_applications.sql, B16-3).
//
// ── WORAN DIESER SCHRITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ────────────────────────
// (1) ANTI-ENUMERATION. Die Bewerbungsseite darf nie verraten, ob eine Adresse bereits ein Konto hat
//     oder sich schon einmal beworben hat. Zwei Dinge sichern das in der DATENBANK: es gibt KEIN
//     UNIQUE auf E-Mail oder Firma (ein Constraint-Fehler wäre genau das Leck), und die Rückgabe von
//     `submit_partner_application` sagt NICHTS über die Kontoauflösung. Beides wird auf der ANTWORT
//     gemessen, nicht auf dem, was die Oberfläche zufällig anzeigt.
// (2) ES GIBT KEINEN WEG ZU 'approved'. Genehmigen erzeugt in B16-4 Partner, Slug und
//     Freischaltung; ein Weg, der jetzt nur den Status setzte, hinterliesse einen genehmigten
//     Antrag ohne Partner — ein stiller Zustand, der wie Erfolg aussieht. Geprüft wird deshalb die
//     RECHTEFLÄCHE (kein Grant auf der Tabelle für irgendeine Rolle) UND die Wrapper-Menge.
// (3) DIE VERKNÜPFUNG MIT DEM KONTO. Sie ist der Grund, warum B16-4 überhaupt weiss, welches Konto
//     freizuschalten ist. Drei Fälle: laufende Sitzung schlägt Adresse · genau ein Konto zur
//     Adresse · kein oder mehrere Konten → unverknüpft, aber der Antrag entsteht trotzdem.
// (4) EIN ANTRAG DARF NICHT VERLORENGEHEN. Er entsteht auch ohne Konto, auch mehrfach zur selben
//     Adresse, und er blockiert kein Konto-Löschen (on delete set null).
// (5) DIE RECHTEFLÄCHE DER VIER WRAPPER. `anon` hat in `platform` nirgends etwas; der Schreibweg ist
//     service_role-only, die drei Admin-Wrapper authenticated-only und WERFEN 42501 statt leer zu
//     antworten.
// (6) JEDER WRAPPER WIRD TATSÄCHLICH AUFGERUFEN (Arbeitsregel 2): Introspektion beweist Existenz,
//     nicht Lauffähigkeit — plpgsql prüft Funktionsrümpfe nicht beim Anlegen.

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
const spawnedApplications: string[] = []

type SubmitInput = {
  company?: string | null
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  message?: string | null
  phone?: string | null
  website?: string | null
  userId?: string | null
}

async function newAdmin(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

async function newPlainUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  return u
}

/**
 * Der Aufruf, den die Bewerbungsseite macht: service_role, wie `lib/partner-application/store.ts`.
 *
 * Vorgabewerte greifen nur, wenn der Schlüssel FEHLT — ein ausdrücklich übergebenes `null` bleibt
 * `null`. Mit `??` wäre genau der Fall unprüfbar geworden, den die Pflichtfeld-Tests messen (ein
 * `null` fiele auf den Vorgabewert zurück und der Wrapper sähe nie einen leeren Wert).
 */
async function submit(input: SubmitInput = {}): Promise<Record<string, unknown>> {
  const value = <K extends keyof SubmitInput>(key: K, fallback: SubmitInput[K]) =>
    key in input ? input[key] : fallback

  const res = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: Record<string, unknown> }>(
      `select public.submit_partner_application(
         p_company => $1, p_first_name => $2, p_last_name => $3, p_email => $4,
         p_message => $5, p_phone => $6, p_website => $7, p_user_id => $8
       ) as r`,
      [
        value('company', 'Elektro Musterbetrieb GmbH'),
        value('firstName', 'Anna'),
        value('lastName', 'Gruber'),
        value('email', `bewerbung-${randomUUID()}@test.local`),
        value('message', 'Wir montieren seit 20 Jahren Speicher und wollen Partner werden.'),
        value('phone', null),
        value('website', null),
        value('userId', null),
      ],
    )
    return rows[0]!.r
  })
  if (typeof res.application_id === 'string') spawnedApplications.push(res.application_id)
  return res
}

async function asAdmin<T>(
  admin: TestUser,
  fn: (query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>>) => Promise<T>,
): Promise<T> {
  return runAs({ role: 'authenticated', userId: admin.id, commit: true }, async (c) =>
    fn(async (text, params = []) => {
      const { rows } = await c.query<{ r: Record<string, unknown> }>(text, params)
      return rows[0]!.r
    }),
  )
}

async function readApplication(id: string) {
  const rows = await sql<{
    company: string
    email: string
    phone: string | null
    website: string | null
    message: string
    status: string
    user_id: string | null
    reviewed_by: string | null
    reviewed_at: string | null
  }>(
    `select company, email, phone, website, message, status, user_id, reviewed_by, reviewed_at
       from platform.partner_applications where id = $1`,
    [id],
  )
  return rows[0]
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedApplications.splice(0)) {
    await sql('delete from platform.partner_applications where id = $1', [id])
  }
  for (const id of spawnedUsers.splice(0)) {
    await deleteUser(id)
  }
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Anti-Enumeration ─────────────────────────────────────────────────────────────────────────
describe('(1) Anti-Enumeration: was die Bewerbung NICHT verrät', () => {
  it('DER KERNFALL: die Rückgabe trägt AUSSCHLIESSLICH status und application_id', async () => {
    /*
     * Gemessen auf den SCHLÜSSELN, nicht auf einem erwarteten Feld: Ein zusätzliches
     * `user_id`/`account_exists` im Wrapper wäre sonst unsichtbar, solange die Oberfläche es nicht
     * anzeigt — und genau dieser Rückgabewert entscheidet, was der öffentliche Weg erfahren kann.
     * Wer es nicht erfährt, kann es auch nicht weitergeben.
     */
    const res = await submit()

    expect(Object.keys(res).sort()).toEqual(['application_id', 'status'])
    expect(res.status).toBe('created')
  })

  it('ein Konto zur Adresse ändert die ANTWORT nicht — nur die Zeile in der Datenbank', async () => {
    const user = await newPlainUser()

    const mitKonto = await submit({ email: user.email })
    const ohneKonto = await submit()

    // Bit-identische Form; nur die (zufällige) ID unterscheidet sich.
    expect(Object.keys(mitKonto).sort()).toEqual(Object.keys(ohneKonto).sort())
    expect(mitKonto.status).toBe(ohneKonto.status)

    expect((await readApplication(mitKonto.application_id as string))!.user_id).toBe(user.id)
    expect((await readApplication(ohneKonto.application_id as string))!.user_id).toBeNull()
  })

  it('ZWEITE Bewerbung mit derselben Adresse geht durch — kein UNIQUE, kein Constraint-Fehler', async () => {
    /*
     * Ein UNIQUE auf der Adresse wäre der bequemste Weg zu einem sauberen Bestand und zugleich das
     * Leck: „diese Adresse hat sich schon beworben" ist genau die Auskunft, die diese Seite nicht
     * geben darf. Mehrfachbewerbungen sind erlaubt und im Admin als zwei Zeilen sichtbar.
     */
    const email = `doppelt-${randomUUID()}@test.local`

    const erste = await submit({ email, company: 'Erster Anlauf GmbH' })
    const zweite = await submit({ email, company: 'Zweiter Anlauf GmbH' })

    expect(erste.status).toBe('created')
    expect(zweite.status).toBe('created')
    expect(erste.application_id).not.toBe(zweite.application_id)

    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.partner_applications where email = $1`,
      [email],
    )
    expect(rows[0]!.n).toBe(2)
  })

  it('dieselbe FIRMA zweimal geht ebenfalls durch', async () => {
    const company = `Gleiche Firma ${randomUUID()}`
    expect((await submit({ company })).status).toBe('created')
    expect((await submit({ company })).status).toBe('created')
  })

  it('auf E-Mail und Firma liegt nachweislich KEIN eindeutiger Index', async () => {
    /*
     * Die Gegenprobe zur Verhaltensmessung: ein UNIQUE könnte auch später versehentlich dazukommen
     * (etwa über einen „Aufräum"-Index). Geprüft wird deshalb der Katalog.
     */
    const rows = await sql<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'platform' and tablename = 'partner_applications'`,
    )
    const unique = rows.filter((r) => /unique/i.test(r.indexdef) && !/_pkey/.test(r.indexdef))
    expect(unique).toEqual([])
  })
})

// ── (2) Es gibt keinen Weg zu 'approved' ─────────────────────────────────────────────────────────
describe('(2) Genehmigen ist in B16-3 unerreichbar', () => {
  it('DER WICHTIGSTE TEST DIESER DATEI: es gibt KEINEN Wrapper, der einen Antrag genehmigt', async () => {
    /*
     * B16-4 erzeugt beim Genehmigen einen Partner, einen Slug und eine Freischaltung. Ein Wrapper,
     * der jetzt nur den Status setzte, hinterliesse einen genehmigten Antrag OHNE Partner — ein
     * stiller Zustand, der wie Erfolg aussieht und den niemand mehr von einem echten unterscheiden
     * kann. Geprüft wird die vollständige Wrapper-Menge, nicht die Abwesenheit eines geratenen
     * Namens: ein `admin_decide_partner_application` mit Status-Parameter wäre derselbe Fehler unter
     * anderem Namen.
     */
    const rows = await sql<{ proname: string; args: string }>(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname like '%partner_application%'
        order by p.proname`,
    )

    expect(rows.map((r) => r.proname)).toEqual([
      'admin_get_partner_application',
      'admin_list_partner_applications',
      'admin_reject_partner_application',
      'submit_partner_application',
    ])

    // Und der eine schreibende Admin-Wrapper nimmt KEINEN Status entgegen — der Zielwert ist ein
    // Literal im Rumpf. Ein Statusparameter wäre der Weg zu 'approved' über dieselbe Funktion.
    const reject = rows.find((r) => r.proname === 'admin_reject_partner_application')!
    expect(reject.args).toBe('p_id uuid')
  })

  it('der Enum kennt approved — erreichbar ist der Wert nur über eine künftige Migration', async () => {
    // `::text[]` ist nötig, nicht kosmetisch: `array_agg(enumlabel)` liefert `name[]`, wofür
    // node-postgres keinen Parser hat — die Zusicherung stünde sonst gegen eine Zeichenkette.
    const rows = await sql<{ labels: string[] }>(
      `select array_agg(e.enumlabel order by e.enumsortorder)::text[] as labels
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'partner_application_status'`,
    )
    expect(rows[0]!.labels).toEqual(['pending', 'approved', 'rejected'])
  })

  it('KEINE Rolle hat irgendein Tabellenrecht — auch nicht schreibend', async () => {
    /*
     * Die zweite Hälfte desselben Beweises: Ohne Wrapper UND ohne Tabellenrecht gibt es über
     * PostgREST keinen Weg, den Status von Hand zu setzen. Muster platform.job_runs (B4-1) und
     * platform.admin_exports (B2-1).
     */
    const rows = await sql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'partner_applications'
          and grantee in ('anon','authenticated','service_role')`,
    )
    expect(rows).toEqual([])
  })

  it('RLS ist aktiv und es gibt keine Policy', async () => {
    const rls = await sql<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where oid = 'platform.partner_applications'::regclass`,
    )
    expect(rls[0]!.relrowsecurity).toBe(true)

    const policies = await sql<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'platform' and tablename = 'partner_applications'`,
    )
    expect(policies).toEqual([])
  })

  it('anon kann die Tabelle auch direkt nicht lesen', async () => {
    await expect(
      runAs({ role: 'anon', commit: false }, (c) =>
        c.query('select 1 from platform.partner_applications'),
      ),
    ).rejects.toThrow()
  })
})

// ── (3) Die Verknüpfung mit dem Konto ────────────────────────────────────────────────────────────
describe('(3) submit_partner_application: welches Konto verknüpft wird', () => {
  it('GENAU EIN Konto zur Adresse → dieses Konto, auch bei abweichender Schreibweise', async () => {
    /*
     * Case-insensitiv wie `public.admin_grant_role_by_email` (T4-4): niemand kennt die Schreibweise
     * seines eigenen Kontos, und das Kleinschreiben kann nur einen Nicht-Treffer in den richtigen
     * Treffer verwandeln.
     */
    const user = await newPlainUser()
    const res = await submit({ email: `  ${user.email.toUpperCase()}  ` })

    const row = await readApplication(res.application_id as string)
    expect(row!.user_id).toBe(user.id)
    // Gespeichert wird die normalisierte Adresse — sonst stünden zwei Schreibweisen im Bestand.
    expect(row!.email).toBe(user.email.toLowerCase())
  })

  it('DIE LAUFENDE SITZUNG SCHLÄGT DIE ADRESSE: p_user_id gewinnt gegen einen Adresstreffer', async () => {
    /*
     * Wer angemeldet ist, bewirbt sich mit SEINEM Konto — auch dann, wenn er eine abweichende
     * Kontaktadresse einträgt. Andernfalls entstünde ein Antrag, der auf ein fremdes Konto zeigt,
     * obwohl die Person gerade in ihrem eigenen angemeldet war.
     */
    const angemeldet = await newPlainUser()
    const fremd = await newPlainUser()

    const res = await submit({ email: fremd.email, userId: angemeldet.id })

    const row = await readApplication(res.application_id as string)
    expect(row!.user_id).toBe(angemeldet.id)
    expect(row!.email).toBe(fremd.email.toLowerCase())
  })

  it('KEIN Konto zur Adresse → der Antrag entsteht trotzdem, unverknüpft', async () => {
    const res = await submit({ email: `niemand-${randomUUID()}@test.local` })

    expect(res.status).toBe('created')
    expect((await readApplication(res.application_id as string))!.user_id).toBeNull()
  })

  it('MEHRERE Konten zur Adresse → unverknüpft statt zufällig gewählt', async () => {
    /*
     * auth.users erzwingt keine globale E-Mail-Eindeutigkeit (mehrere Identity-Provider). Einen der
     * Treffer zu nehmen hiesse, später ein zufällig ausgewähltes FREMDES Konto freizuschalten — der
     * teuerste denkbare Fehler dieses Abschnitts. Abgewiesen wird der Antrag deshalb trotzdem nicht
     * (anders als in admin_grant_role_by_email): dort steht eine Admin-Handlung auf dem Spiel, hier
     * eine Bewerbung, die nicht verlorengehen darf.
     */
    const a = await newPlainUser()
    const b = await newPlainUser()
    /*
     * GEMESSEN, nicht angenommen: `auth.users` trägt den partiellen eindeutigen Index
     * `users_email_partial_key` — UNIQUE (email) WHERE is_sso_user = false. Zwei Konten mit
     * derselben Adresse sind also GENAU DANN möglich, wenn eines über einen externen
     * Identity-Provider kam. Ein blosses UPDATE der Adresse scheitert an diesem Index (beim ersten
     * Testlauf real als 23505 aufgeschlagen) — der Fall wird deshalb so hergestellt, wie er auch
     * real entstünde.
     */
    await sql('update auth.users set is_sso_user = true, email = $1 where id = $2', [a.email, b.id])

    const res = await submit({ email: a.email })

    expect(res.status).toBe('created')
    expect((await readApplication(res.application_id as string))!.user_id).toBeNull()
  })

  it('eine übergebene, aber nicht existierende Konto-ID verhindert den Antrag nicht', async () => {
    const res = await submit({ userId: randomUUID() })

    expect(res.status).toBe('created')
    expect((await readApplication(res.application_id as string))!.user_id).toBeNull()
  })

  it('das Löschen des Kontos nullt die Verknüpfung und lässt den Antrag stehen', async () => {
    /*
     * `on delete set null`: Ein Löschverlangen darf weder am Antrag scheitern noch ihn mitreissen —
     * dieselbe Konstruktion wie platform.leads.anonymized_by (B1-3).
     */
    const user = await createUser()
    const res = await submit({ email: user.email })
    expect((await readApplication(res.application_id as string))!.user_id).toBe(user.id)

    await deleteUser(user.id)

    const row = await readApplication(res.application_id as string)
    expect(row).toBeDefined()
    expect(row!.user_id).toBeNull()
    expect(row!.company).toBe('Elektro Musterbetrieb GmbH')
  })
})

// ── (4) Pflichtfelder und Normalisierung ─────────────────────────────────────────────────────────
describe('(4) submit_partner_application: was angenommen wird', () => {
  it('EIN LEERER FREITEXT WIRD ABGEWIESEN — ein Antrag ohne Begründung ist nicht prüfbar', async () => {
    for (const message of ['', '   ', null]) {
      const res = await submit({ message })
      expect(res).toEqual({ status: 'missing_fields' })
    }
  })

  it('Firma, Vorname, Nachname und Adresse sind ebenfalls Pflicht', async () => {
    expect(await submit({ company: '  ' })).toEqual({ status: 'missing_fields' })
    expect(await submit({ firstName: '' })).toEqual({ status: 'missing_fields' })
    expect(await submit({ lastName: null })).toEqual({ status: 'missing_fields' })
    expect(await submit({ email: '   ' })).toEqual({ status: 'missing_fields' })

    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.partner_applications where company = '  '`,
    )
    expect(rows[0]!.n).toBe(0)
  })

  it('Telefon und Website sind optional; leer wird zu NULL statt zu einem Leerstring', async () => {
    /*
     * Sonst überlebte ein leer abgesendetes Feld als '' und sähe in jeder Auswertung wie eine
     * Angabe aus — dieselbe Falle, die B3-1 bei den Segmentierungsfeldern beschreibt.
     */
    const res = await submit({ phone: '   ', website: '' })
    const row = await readApplication(res.application_id as string)

    expect(row!.phone).toBeNull()
    expect(row!.website).toBeNull()
  })

  it('umgebende Leerzeichen fallen weg, der Freitext bleibt sonst wörtlich erhalten', async () => {
    const message = 'Zeile 1\nZeile 2 mit Umlauten: Kühlhaus, Bäckerei & Co.'
    const res = await submit({ message: `  ${message}  `, company: '  Elektro Weiss KG  ' })
    const row = await readApplication(res.application_id as string)

    expect(row!.message).toBe(message)
    expect(row!.company).toBe('Elektro Weiss KG')
  })

  it('ein neuer Antrag ist pending, ungeprüft und ohne Prüfer', async () => {
    const row = await readApplication((await submit()).application_id as string)

    expect(row!.status).toBe('pending')
    expect(row!.reviewed_at).toBeNull()
    expect(row!.reviewed_by).toBeNull()
  })
})

// ── (5) Der Prüf-Eingang ─────────────────────────────────────────────────────────────────────────
describe('(5) Die drei Admin-Wrapper', () => {
  it('die Liste zeigt neueste zuerst, mit Freitext und Kontokennzeichen', async () => {
    const admin = await newAdmin()
    const user = await newPlainUser()

    const alt = await submit({ company: 'Alter Antrag GmbH' })
    await sql(
      `update platform.partner_applications set created_at = now() - interval '2 days' where id = $1`,
      [alt.application_id],
    )
    const neu = await submit({ company: 'Neuer Antrag GmbH', email: user.email })

    const res = await asAdmin(admin, (q) =>
      q(`select public.admin_list_partner_applications(p_limit => 200) as r`),
    )

    expect(res.status).toBe('ok')
    const rows = res.applications as Array<Record<string, unknown>>
    const mine = rows.filter((r) =>
      [alt.application_id, neu.application_id].includes(r.id as string),
    )
    expect(mine.map((r) => r.id)).toEqual([neu.application_id, alt.application_id])
    // Der Freitext fährt in der LISTE mit — sonst müsste jeder Antrag einzeln geöffnet werden, um
    // zu erfahren, worum es geht.
    expect(mine[0]!.message).toContain('Speicher')
    expect(mine[0]!.has_account).toBe(true)
    expect(mine[1]!.has_account).toBe(false)
  })

  it('der Statusfilter zählt und filtert — total ist die Zahl der TREFFER', async () => {
    const admin = await newAdmin()
    const offen = await submit({ company: 'Bleibt offen GmbH' })
    const abgelehnt = await submit({ company: 'Wird abgelehnt GmbH' })

    await asAdmin(admin, (q) =>
      q(`select public.admin_reject_partner_application($1) as r`, [abgelehnt.application_id]),
    )

    const nurOffen = await asAdmin(admin, (q) =>
      q(
        `select public.admin_list_partner_applications(p_status => 'pending', p_limit => 200) as r`,
      ),
    )
    const ids = (nurOffen.applications as Array<Record<string, unknown>>).map((r) => r.id)
    expect(ids).toContain(offen.application_id)
    expect(ids).not.toContain(abgelehnt.application_id)
    expect(nurOffen.total).toBe((nurOffen.applications as unknown[]).length)
  })

  it('ein unbekannter Statusfilter wird ABGEWIESEN, nicht still ignoriert', async () => {
    /*
     * Sonst hielte man ein ungefiltertes Ergebnis für ein gefiltertes — dieselbe Regel wie in
     * admin_list_leads (B1-3). Und: ein Enum-Parameter hätte stattdessen 22P02 geworfen, was die
     * Oberfläche nicht von einem Ausfall unterscheiden könnte.
     */
    const admin = await newAdmin()
    const res = await asAdmin(admin, (q) =>
      q(`select public.admin_list_partner_applications(p_status => 'genehmigt_vielleicht') as r`),
    )
    expect(res).toEqual({ status: 'invalid_filter', field: 'status' })
  })

  it('die Detailansicht liefert ALLE Felder samt Konto- und Prüferadresse', async () => {
    const admin = await newAdmin()
    const user = await newPlainUser()
    const created = await submit({
      email: user.email,
      phone: '+43 1 234567',
      website: 'https://elektro-muster.at',
    })

    const res = await asAdmin(admin, (q) =>
      q(`select public.admin_get_partner_application($1) as r`, [created.application_id]),
    )

    expect(res.status).toBe('ok')
    const app = res.application as Record<string, unknown>
    expect(Object.keys(app).sort()).toEqual([
      'account_email',
      'company',
      'created_at',
      'email',
      'first_name',
      'id',
      'last_name',
      'message',
      'phone',
      'reviewed_at',
      'reviewed_by_email',
      'status',
      'user_id',
      'website',
    ])
    expect(app.account_email).toBe(user.email)
    expect(app.message).toContain('Speicher')
    expect(app.reviewed_by_email).toBeNull()
  })

  it('ein unbekannter Antrag ist ein fachlicher Zustand, kein Fehler', async () => {
    const admin = await newAdmin()
    const res = await asAdmin(admin, (q) =>
      q(`select public.admin_get_partner_application($1) as r`, [randomUUID()]),
    )
    expect(res).toEqual({ status: 'not_found' })
  })

  it('ABLEHNEN setzt alle drei Felder: Status, Prüfer und Zeitpunkt', async () => {
    const admin = await newAdmin()
    const created = await submit()

    const res = await asAdmin(admin, (q) =>
      q(`select public.admin_reject_partner_application($1) as r`, [created.application_id]),
    )
    expect(res).toEqual({ status: 'ok' })

    const row = await readApplication(created.application_id as string)
    expect(row!.status).toBe('rejected')
    expect(row!.reviewed_by).toBe(admin.id)
    expect(row!.reviewed_at).not.toBeNull()
  })

  it('ein bereits geprüfter Antrag wird abgewiesen — der Zeitpunkt wird nicht überschrieben', async () => {
    const admin = await newAdmin()
    const created = await submit()

    await asAdmin(admin, (q) =>
      q(`select public.admin_reject_partner_application($1) as r`, [created.application_id]),
    )
    const ersteEntscheidung = (await readApplication(created.application_id as string))!.reviewed_at

    const zweite = await asAdmin(admin, (q) =>
      q(`select public.admin_reject_partner_application($1) as r`, [created.application_id]),
    )

    expect(zweite).toEqual({ status: 'already_reviewed', current: 'rejected' })
    expect((await readApplication(created.application_id as string))!.reviewed_at).toEqual(
      ersteEntscheidung,
    )
  })

  it('ein unbekannter Antrag lässt sich nicht ablehnen', async () => {
    const admin = await newAdmin()
    const res = await asAdmin(admin, (q) =>
      q(`select public.admin_reject_partner_application($1) as r`, [randomUUID()]),
    )
    expect(res).toEqual({ status: 'not_found' })
  })

  it('das Löschen des PRÜFER-Kontos nullt die Zuschreibung, der Vorgang bleibt belegt', async () => {
    /*
     * Deshalb verlangt der CHECK `reviewed_at is not null` und NICHT `reviewed_by is not null`:
     * sonst machte genau dieses Löschen die Zeile ungültig — und damit das Konto unlöschbar.
     */
    const admin = await newAdmin()
    const created = await submit()
    await asAdmin(admin, (q) =>
      q(`select public.admin_reject_partner_application($1) as r`, [created.application_id]),
    )

    await deleteUser(admin.id)
    spawnedUsers.splice(spawnedUsers.indexOf(admin.id), 1)

    const row = await readApplication(created.application_id as string)
    expect(row!.status).toBe('rejected')
    expect(row!.reviewed_by).toBeNull()
    expect(row!.reviewed_at).not.toBeNull()
  })
})

// ── (6) Rechtefläche ─────────────────────────────────────────────────────────────────────────────
describe('(6) Rechte der vier Wrapper', () => {
  it('submit_partner_application: EXECUTE ausschliesslich für service_role', async () => {
    const rows = await sql<{ rolname: string; can: boolean }>(
      `select r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can
         from pg_proc p, unnest(array['anon','authenticated','service_role']) as r(rolname)
        where p.proname = 'submit_partner_application' and p.pronamespace = 'public'::regnamespace`,
    )
    expect(Object.fromEntries(rows.map((r) => [r.rolname, r.can]))).toEqual({
      anon: false,
      authenticated: false,
      service_role: true,
    })
  })

  it('die drei Admin-Wrapper: EXECUTE ausschliesslich für authenticated', async () => {
    /*
     * `service_role` bekommt bewusst KEIN Grant: die drei leiten ihre Autorisierung aus auth.uid()
     * ab, das dort NULL ist — sie wären funktionslos und stets abgelehnt (B2-1/B16-1).
     */
    for (const fn of [
      'admin_list_partner_applications',
      'admin_get_partner_application',
      'admin_reject_partner_application',
    ]) {
      const rows = await sql<{ rolname: string; can: boolean }>(
        `select r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can
           from pg_proc p, unnest(array['anon','authenticated','service_role']) as r(rolname)
          where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
        [fn],
      )
      expect(Object.fromEntries(rows.map((r) => [r.rolname, r.can])), fn).toEqual({
        anon: false,
        authenticated: true,
        service_role: false,
      })
    }
  })

  it('EIN EINGELOGGTER NICHT-ADMIN SCHEITERT MIT 42501 — nicht mit einer leeren Liste', async () => {
    /*
     * „Kein Zugriff" darf sich nie als „keine Anträge" lesen lassen: ein leeres Ergebnis und eine
     * Ablehnung sind verschiedene Dinge, und eine Exception kann man nicht verwechseln (B1-1).
     */
    const fremder = await newPlainUser()
    const created = await submit()

    for (const call of [
      `select public.admin_list_partner_applications() as r`,
      `select public.admin_get_partner_application('${created.application_id}') as r`,
      `select public.admin_reject_partner_application('${created.application_id}') as r`,
    ]) {
      await expect(
        runAs({ role: 'authenticated', userId: fremder.id, commit: false }, (c) => c.query(call)),
      ).rejects.toMatchObject({ code: '42501' })
    }

    // Und der Antrag ist unverändert offen — die Ablehnung hat nichts geschrieben.
    expect((await readApplication(created.application_id as string))!.status).toBe('pending')
  })
})
