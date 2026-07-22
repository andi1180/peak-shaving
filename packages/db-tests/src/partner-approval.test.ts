// DB-Gate für die Genehmigung eines Partner-Antrags
// (Migration 20260726090000_create_partner_approval.sql, B16-4a).
//
// ── WORAN DIESER SCHRITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ────────────────────────
// (1) ATOMARITÄT. Genehmigen heisst: Partner anlegen UND Antrag auf 'approved' setzen. Bleibt eine
//     Hälfte übrig, entsteht genau der stille Zustand, dessentwegen B16-3 auf 'approved' verzichtet
//     hat — ein genehmigter Antrag ohne Partner sieht aus wie Erfolg. Geprüft wird das nicht durch
//     Zusehen, sondern indem das Anlegen des Partners KÜNSTLICH ZUM SCHEITERN gebracht wird.
// (2) FÜNF UNTERSCHEIDBARE ABWEISUNGSGRÜNDE. Ein Sammelstatus zwänge die Oberfläche zu raten, was
//     zu tun ist; „Slug vergeben" und „das Konto hängt schon woanders" verlangen vollkommen
//     verschiedene Handlungen. Beide kämen ohne Vorprüfung als derselbe 23505 zurück.
// (3) ⚠ EIN ANTRAG OHNE KONTO IST NICHT GENEHMIGBAR. In Produktion real aufgetreten (die
//     Kontoanlage scheiterte am Rate-Limit des Mailversands, der Antrag entstand trotzdem — so
//     gewollt, B16-3). Ein daraus genehmigter Partner hätte nie ein Login, und der Slug wäre
//     unwiderruflich verbraucht.
// (4) DER WÄCHTER AUS B16-1 HÄLT WEITERHIN, UND ER STEHT DEM KONTO-LÖSCHEN NICHT IM WEG. Das ist
//     der Stolperdraht dieses Schritts: `ON DELETE SET NULL` ist selbst ein UPDATE, und in diesem
//     Repo ist daran dreimal etwas hängen geblieben. Beide Richtungen werden gemessen.
// (5) DIE MANUELLE VERKNÜPFUNG ÜBERSCHREIBT NICHTS. Ohne sie käme Raymann — der erste reale, von
//     Hand angelegte Partner — nie ins Portal; mit einem Upsert nähme sie einem bestehenden Konto
//     stillschweigend den Zugang zu seinem eigenen Betrieb.
// (6) DIE RECHTEFLÄCHE. Beide neuen Wrapper sind authenticated-only und WERFEN 42501 statt leer zu
//     antworten. Nachgemessen, nicht vorausgesetzt — und die zwei per `create or replace`
//     nachgezogenen Wrapper ebenfalls (ein DROP hätte ihre Grants entfernt, in B3-1 real passiert).
// (7) JEDER WRAPPER WIRD TATSÄCHLICH AUFGERUFEN (Arbeitsregel 2): Introspektion beweist Existenz,
//     nicht Lauffähigkeit — plpgsql prüft Funktionsrümpfe nicht beim Anlegen.
//
// ⚠ EINE GRENZE DAZU, HIER REAL GELERNT (26.07.2026, s. Arbeitsregel 5 in der Root-`CLAUDE.md`):
//     Ein Aufruf ist nur sicher, wenn die aufrufende Rolle ein EXECUTE-Grant HAT und die Ablehnung
//     im FUNKTIONSRUMPF erfolgt (`raise … 42501`). Ein Aufruf als Rolle OHNE Grant — also der
//     Versuch, fehlenden Zugriff durch die Ablehnung zu beweisen — beendet den Postgres-Prozess
//     (Signal 11); im CI-Lauf dieses Bauabschnitts ist genau das passiert. Für diesen Fall wird
//     `has_function_privilege` geprüft, nicht aufgerufen.

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
const spawnedPartners: string[] = []

function newSlug(prefix = 'gate-b164a'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`
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

/** Der Weg, den die Bewerbungsseite geht: service_role, wie `lib/partner-application/store.ts`. */
async function submit(
  input: { company?: string; firstName?: string; lastName?: string; email?: string } = {},
): Promise<string> {
  const res = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: { status: string; application_id?: string } }>(
      `select public.submit_partner_application(
         p_company => $1, p_first_name => $2, p_last_name => $3, p_email => $4, p_message => $5
       ) as r`,
      [
        input.company ?? 'Elektro Musterbetrieb GmbH',
        input.firstName ?? 'Anna',
        input.lastName ?? 'Gruber',
        input.email ?? `bewerbung-${randomUUID()}@test.local`,
        'Wir montieren seit 20 Jahren Speicher und wollen Partner werden.',
      ],
    )
    return rows[0]!.r
  })
  if (!res.application_id) throw new Error(`submit_partner_application: ${JSON.stringify(res)}`)
  spawnedApplications.push(res.application_id)
  return res.application_id
}

/** Ein Antrag MIT verknüpftem Konto — der Normalfall, den B16-4a genehmigt. */
async function submitWithAccount(
  input: { company?: string; firstName?: string; lastName?: string } = {},
): Promise<{ applicationId: string; user: TestUser }> {
  const user = await newPlainUser()
  const applicationId = await submit({ ...input, email: user.email })
  return { applicationId, user }
}

async function asAdmin<T extends Record<string, unknown>>(
  admin: TestUser,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: admin.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(text, params)
    return rows[0]!.r
  })
}

async function approve(admin: TestUser, applicationId: string, slug: string) {
  const res = await asAdmin(admin, `select public.admin_approve_partner_application($1,$2) as r`, [
    applicationId,
    slug,
  ])
  if (res.status === 'ok') spawnedPartners.push(String(res.slug))
  return res
}

async function readApplication(id: string) {
  const rows = await sql<{
    status: string
    user_id: string | null
    reviewed_by: string | null
    reviewed_at: string | null
  }>(
    `select status, user_id, reviewed_by, reviewed_at
       from platform.partner_applications where id = $1`,
    [id],
  )
  return rows[0]
}

async function readPartner(slug: string) {
  const rows = await sql<{
    slug: string
    display_name: string
    contact_first_name: string | null
    contact_last_name: string | null
    user_id: string | null
    application_id: string | null
    is_active: boolean
  }>(
    `select slug, display_name, contact_first_name, contact_last_name, user_id, application_id,
            is_active
       from platform.partners where slug = $1`,
    [slug],
  )
  return rows[0]
}

async function countPartners(): Promise<number> {
  const rows = await sql<{ n: number }>('select count(*)::int as n from platform.partners')
  return rows[0]!.n
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  // Reihenfolge: erst Partner (FK `restrict` auf den Antrag), dann Anträge, dann Konten.
  for (const slug of spawnedPartners.splice(0)) {
    await sql('delete from platform.partners where slug = $1', [slug])
  }
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

// ── (1) Der Gutfall ──────────────────────────────────────────────────────────────────────────────
describe('(1) Genehmigung: aus einem Antrag wird ein Fachbetrieb', () => {
  it('DER KERNFALL: die Stammdaten kommen AUS DEM ANTRAG, nichts wird erneut eingetippt', async () => {
    const admin = await newAdmin()
    const { applicationId, user } = await submitWithAccount({
      company: 'Elektro Müller GmbH',
      firstName: 'Maximilian',
      lastName: 'von der Müller',
    })
    const slug = newSlug('elektro-mueller')

    const res = await approve(admin, applicationId, slug)
    expect(res).toEqual({ status: 'ok', slug })

    const partner = await readPartner(slug)
    /*
     * Firma und Name kommen aus dem Antrag — der Slug ist der EINZIGE Wert, den der Admin
     * beisteuert. Der Nachname trägt bewusst ein Leerzeichen: Vor- und Nachname reisen getrennt,
     * eine nachträgliche Zerlegung scheiterte bei genau solchen Namen (dieselbe Begründung wie beim
     * Namens-Split von platform.leads).
     */
    expect(partner!.display_name).toBe('Elektro Müller GmbH')
    expect(partner!.contact_first_name).toBe('Maximilian')
    expect(partner!.contact_last_name).toBe('von der Müller')
    expect(partner!.user_id).toBe(user.id)
    expect(partner!.application_id).toBe(applicationId)
    expect(partner!.is_active).toBe(true)

    const application = await readApplication(applicationId)
    expect(application!.status).toBe('approved')
    expect(application!.reviewed_by).toBe(admin.id)
    expect(application!.reviewed_at).not.toBeNull()
  })

  it('der Slug wird kleingeschrieben übernommen, nicht abgewiesen', async () => {
    // Dieselbe Regel wie in admin_create_partner (B16-1): die Bedeutung ist eindeutig, es gibt keine
    // zweite Lesart — eine Ablehnung wäre eine Hürde ohne Ertrag.
    const admin = await newAdmin()
    const { applicationId } = await submitWithAccount()
    const slug = newSlug('gross')

    const res = await approve(admin, applicationId, `  ${slug.toUpperCase()}  `)

    expect(res).toEqual({ status: 'ok', slug })
    expect(await readPartner(slug)).toBeDefined()
  })

  it('E-Mail, Telefon und Website werden NICHT auf den Partner kopiert', async () => {
    /*
     * platform.partners hat dafür bewusst keine Spalten (B16-1). Eine Kopie wäre eine zweite Fassung
     * derselben Angabe, die ab dem ersten Korrekturformular auseinanderläuft — und die Adresse gäbe
     * es dann dreifach (Antrag, Partner, Konto). Erreichbar bleibt sie über application_id.
     */
    const columns = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'platform' and table_name = 'partners'
        order by column_name`,
    )
    expect(columns.map((c) => c.column_name)).toEqual([
      'application_id',
      'contact_first_name',
      'contact_last_name',
      'created_at',
      'display_name',
      'is_active',
      'slug',
      'updated_at',
      'user_id',
    ])
  })

  it('der Antrag bleibt vollständig lesbar und verweist auf den entstandenen Partner', async () => {
    const admin = await newAdmin()
    const { applicationId } = await submitWithAccount()
    const slug = newSlug()
    await approve(admin, applicationId, slug)

    const res = await asAdmin<{ status: string; application: Record<string, unknown> }>(
      admin,
      `select public.admin_get_partner_application($1) as r`,
      [applicationId],
    )

    expect(res.status).toBe('ok')
    // Ohne partner_slug endete ein genehmigter Antrag in einer Sackgasse: die Gegenrichtung des
    // Fremdschlüssels wird sonst nirgends gelesen.
    expect(res.application.partner_slug).toBe(slug)
    expect(res.application.account_partner_slug).toBe(slug)
    expect(res.application.reviewed_by_email).toBe(admin.email)
  })
})

// ── (2) Die fünf Abweisungsgründe ────────────────────────────────────────────────────────────────
describe('(2) Was NICHT genehmigt wird — jeder Grund unterscheidbar', () => {
  it('KEINE ZWEITGENEHMIGUNG: der zweite Aufruf legt keinen zweiten Partner an', async () => {
    const admin = await newAdmin()
    const { applicationId } = await submitWithAccount()
    const erster = newSlug('erster')
    await approve(admin, applicationId, erster)
    const ersteEntscheidung = (await readApplication(applicationId))!.reviewed_at

    const vorher = await countPartners()
    const zweite = await approve(admin, applicationId, newSlug('zweiter'))

    expect(zweite).toEqual({ status: 'already_reviewed', current: 'approved' })
    expect(await countPartners()).toBe(vorher)
    // Der Zeitpunkt der ERSTEN Entscheidung bleibt stehen (wie in
    // admin_reject_partner_application, B16-3).
    expect((await readApplication(applicationId))!.reviewed_at).toEqual(ersteEntscheidung)
  })

  it('ein ABGELEHNTER Antrag lässt sich nicht nachträglich genehmigen', async () => {
    const admin = await newAdmin()
    const { applicationId } = await submitWithAccount()
    await asAdmin(admin, `select public.admin_reject_partner_application($1) as r`, [applicationId])

    const vorher = await countPartners()
    const res = await approve(admin, applicationId, newSlug())

    expect(res).toEqual({ status: 'already_reviewed', current: 'rejected' })
    expect(await countPartners()).toBe(vorher)
  })

  it('⚠ EIN ANTRAG OHNE KONTO KANN GAR NICHT MEHR ENTSTEHEN — der Wächter liegt jetzt davor', async () => {
    /*
     * ── DIESER TEST HAT AM 26.07.2026 SEINE AUSSAGE GEWECHSELT, UND ZWAR NACH OBEN ──────────────
     * Vorher stand hier: „ein Antrag mit user_id null wird beim Genehmigen abgewiesen (no_account)".
     * Der Fall war real — `submit_partner_application` legte den Antrag auch dann an, wenn die
     * Kontoanlage scheiterte (gemessen: 429 over_email_send_rate_limit), und B16-4a fing ihn als
     * Notbremse ab. Die Bewerbung war zu diesem Zeitpunkt aber bereits verloren: Der Bewerber sah
     * „Danke, wir melden uns", und im Prüf-Eingang lag eine Zeile, mit der niemand etwas anfangen
     * konnte.
     *
     * Seit der Nachbesserung (20260726120000) entsteht ein solcher Antrag nicht mehr. Das Fixture
     * dieses Tests lässt sich deshalb nicht mehr bauen — was die stärkere Aussage ist: nicht „der
     * Wrapper fängt es ab", sondern „es kann gar nicht mehr entstehen".
     *
     * ── DIE ABWEISUNG IM GENEHMIGUNGS-WRAPPER BLEIBT TROTZDEM STEHEN ────────────────────────────
     * Tiefenstaffelung. Sie kostet nichts und ist die zweite Linie, falls je wieder ein Schreibweg
     * entsteht, der am Trigger vorbeiläuft. Dass sie heute unerreichbar ist, macht sie nicht
     * falsch — es macht sie unbenutzt.
     */
    const vorher = await countPartners()

    // (a) Der öffentliche Schreibweg legt nichts mehr an.
    const email = `niemand-${randomUUID()}@test.local`
    const res = await runAs({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ r: { status: string } }>(
        `select public.submit_partner_application(
           p_company => 'Ohne Konto GmbH', p_first_name => 'Anna', p_last_name => 'Gruber',
           p_email => $1, p_message => 'Wir montieren seit 20 Jahren Speicher und wollen Partner werden.'
         ) as r`,
        [email],
      )
      return rows[0]!.r
    })
    expect(res).toEqual({ status: 'no_account' })
    const angelegt = await sql<{ n: number }>(
      `select count(*)::int as n from platform.partner_applications where email = $1`,
      [email],
    )
    expect(angelegt[0]!.n).toBe(0)

    // (b) Und auch am Wrapper vorbei entsteht die Zeile nicht — als `postgres`, mit allen Rechten.
    await expect(
      sql(
        `insert into platform.partner_applications (company, first_name, last_name, email, message, user_id)
         values ('Ohne Konto GmbH','Anna','Gruber',$1,'Am Wrapper vorbei, lang genug fuer den CHECK.', null)`,
        [email],
      ),
    ).rejects.toThrow(/ohne verknüpftes Konto entsteht nicht/)

    // (c) Der Abweisungsgrund im Genehmigungs-Wrapper existiert weiterhin im Funktionsrumpf.
    const rumpf = await sql<{ def: string }>(
      `select pg_get_functiondef('public.admin_approve_partner_application(uuid,text)'::regprocedure) as def`,
    )
    expect(rumpf[0]!.def).toContain('no_account')

    // Es ist dabei kein Partner entstanden.
    expect(await countPartners()).toBe(vorher)
  })

  it('DIE ZWEI GRÜNDE, DIE OHNE VORPRÜFUNG DERSELBE 23505 WÄREN: Konto vergeben vs. Slug vergeben', async () => {
    /*
     * Beide liefen sonst in eine UNIQUE-Bedingung und kämen als derselbe Constraint-Fehler zurück —
     * bei vollkommen verschiedenen Handlungen: einen anderen Slug wählen ODER das Konto klären.
     */
    const admin = await newAdmin()

    // (a) Das Konto des Antrags hängt bereits an einem Fachbetrieb.
    const { applicationId: ersterAntrag, user } = await submitWithAccount()
    const bestehend = newSlug('bestehend')
    await approve(admin, ersterAntrag, bestehend)

    const zweiterAntrag = await submit({ email: user.email })
    expect((await readApplication(zweiterAntrag))!.user_id).toBe(user.id)

    const kontoVergeben = await approve(admin, zweiterAntrag, newSlug('neuer'))
    expect(kontoVergeben).toEqual({ status: 'account_taken', partner_slug: bestehend })

    // (b) Der Slug ist vergeben — anderer Status, und der Antrag bleibt OFFEN.
    const { applicationId: dritterAntrag } = await submitWithAccount()
    const slugVergeben = await approve(admin, dritterAntrag, bestehend)

    expect(slugVergeben).toEqual({ status: 'duplicate_slug' })
    expect((await readApplication(dritterAntrag))!.status).toBe('pending')
    expect((await readApplication(dritterAntrag))!.reviewed_at).toBeNull()

    // Und die beiden Antworten sind tatsächlich verschieden — das ist der Punkt des Tests.
    expect(kontoVergeben.status).not.toBe(slugVergeben.status)
  })

  it('ein formverletzender Slug wird als STATUS abgelehnt, nicht als 23514', async () => {
    // Der CHECK auf platform.partners.slug fängt ihn ohnehin (in B10-5 real gemessen); hier steht
    // die lesbare Fassung davor, damit die Oberfläche es sagen kann, BEVOR jemand einen
    // unwiderruflichen Schlüssel vergibt.
    const admin = await newAdmin()
    const { applicationId } = await submitWithAccount()

    for (const slug of ['Elektro_Müller', 'mit leerzeichen', 'ÜMLAUT']) {
      expect(await approve(admin, applicationId, slug)).toEqual({ status: 'invalid_slug' })
    }
    expect(await approve(admin, applicationId, '   ')).toEqual({ status: 'missing_fields' })
    expect((await readApplication(applicationId))!.status).toBe('pending')
  })

  it('ein unbekannter Antrag ist ein fachlicher Zustand, kein Fehler', async () => {
    const admin = await newAdmin()
    expect(await approve(admin, randomUUID(), newSlug())).toEqual({ status: 'not_found' })
  })
})

// ── (3) Atomarität ───────────────────────────────────────────────────────────────────────────────
describe('(3) Atomarität: es gibt keinen halben Zustand', () => {
  it('DER KERNFALL: scheitert die Partner-Anlage, bleibt der Antrag pending', async () => {
    /*
     * Künstlich zum Scheitern gebracht — anders liesse sich die Zusage nicht messen: alle bekannten
     * Fehlerfälle werden VOR dem Schreiben als Status beantwortet und schreiben deshalb ohnehin
     * nichts. Der Trigger steht für alles, was diese Prüfungen nicht kennen (ein später ergänzter
     * CHECK, ein neuer Trigger, ein Constraint aus einer künftigen Migration).
     */
    const admin = await newAdmin()
    const { applicationId } = await submitWithAccount()
    const slug = newSlug('atomar')

    await sql(`
      create function pg_temp_fail_partner_insert() returns trigger
      language plpgsql as $$
      begin
        raise exception 'Testsperre: Partner-Anlage scheitert' using errcode = 'P0001';
      end;
      $$;
      create trigger zzz_gate_fail_partner_insert
        before insert on platform.partners
        for each row execute function pg_temp_fail_partner_insert();
    `)

    try {
      await expect(approve(admin, applicationId, slug)).rejects.toMatchObject({ code: 'P0001' })
    } finally {
      await sql(`
        drop trigger zzz_gate_fail_partner_insert on platform.partners;
        drop function pg_temp_fail_partner_insert();
      `)
    }

    // Weder ein Partner noch ein genehmigter Antrag — der Aufruf ist vollständig zurückgenommen.
    expect(await readPartner(slug)).toBeUndefined()
    const application = await readApplication(applicationId)
    expect(application!.status).toBe('pending')
    expect(application!.reviewed_at).toBeNull()
    expect(application!.reviewed_by).toBeNull()

    // Gegenprobe: OHNE die Sperre läuft derselbe Aufruf durch — der Test misst die Atomarität, nicht
    // einen dauerhaft kaputten Pfad.
    expect(await approve(admin, applicationId, slug)).toEqual({ status: 'ok', slug })
  })
})

// ── (4) Der Wächter aus B16-1 ────────────────────────────────────────────────────────────────────
describe('(4) guard_partner_slug: hält weiterhin, blockiert aber kein Konto-Löschen', () => {
  it('der Slug ist auch nach der Genehmigung unveränderlich — für service_role UND postgres', async () => {
    const admin = await newAdmin()
    const { applicationId } = await submitWithAccount()
    const slug = newSlug('unveraenderlich')
    await approve(admin, applicationId, slug)

    // service_role scheitert schon am fehlenden update-Grant, postgres am Trigger. Zwei
    // unabhängige Schichten — die zweite hält auch dann, wenn jemand später ein Grant vergibt.
    await expect(
      runAs({ role: 'service_role', commit: false }, (c) =>
        c.query(`update platform.partners set slug = 'anders' where slug = $1`, [slug]),
      ),
    ).rejects.toThrow()

    await expect(
      sql(`update platform.partners set slug = 'anders' where slug = $1`, [slug]),
    ).rejects.toMatchObject({ code: 'P0001' })

    expect(await readPartner(slug)).toBeDefined()
  })

  it('⚠ DER STOLPERDRAHT: das Löschen des Kontos nullt user_id und wird NICHT blockiert', async () => {
    /*
     * `ON DELETE SET NULL` ist selbst ein UPDATE. In diesem Repo ist daran dreimal etwas hängen
     * geblieben (leads.last_edited_by B2-1, email_events.lead_id B2-2, analyses.lead_id B14-1):
     * ein Unveränderlichkeits-Trigger ohne asymmetrische Ausnahme macht den referenzierten
     * Datensatz UNLÖSCHBAR — ausgerechnet gegen ein Löschverlangen.
     *
     * Hier ist keine Ausnahme nötig, weil guard_partner_slug ausschliesslich den Slug vergleicht.
     * Dieser Test ist der Beweis dafür — und der Wächter, falls jemand den Trigger später um
     * weitere Spalten erweitert, ohne die Ausnahme mitzubauen.
     */
    const admin = await newAdmin()
    const { applicationId, user } = await submitWithAccount()
    const slug = newSlug('konto-weg')
    await approve(admin, applicationId, slug)
    expect((await readPartner(slug))!.user_id).toBe(user.id)

    await deleteUser(user.id)
    spawnedUsers.splice(spawnedUsers.indexOf(user.id), 1)

    const partner = await readPartner(slug)
    expect(partner).toBeDefined()
    expect(partner!.user_id).toBeNull()
    expect(partner!.slug).toBe(slug)
    expect(partner!.display_name).toBe('Elektro Musterbetrieb GmbH')
    // Der Antrag verliert seine Verknüpfung ebenfalls (B16-3), bleibt aber genehmigt.
    const application = await readApplication(applicationId)
    expect(application!.status).toBe('approved')
    expect(application!.user_id).toBeNull()
  })

  it('ein Antrag, aus dem ein Partner wurde, lässt sich nicht still entfernen (on delete restrict)', async () => {
    const admin = await newAdmin()
    const { applicationId } = await submitWithAccount()
    const slug = newSlug('restrict')
    await approve(admin, applicationId, slug)

    await expect(
      sql('delete from platform.partner_applications where id = $1', [applicationId]),
    ).rejects.toMatchObject({ code: '23503' })

    expect((await readPartner(slug))!.application_id).toBe(applicationId)
  })

  it('auf user_id liegt eine UNIQUE-Bedingung, auf application_id NICHT', async () => {
    /*
     * UNIQUE auf user_id: heute entspricht ein Konto genau einem Partner — ohne die Bedingung
     * müsste das Portal raten, welchen Betrieb es anzeigt. ⚠ Mehrere Logins je Betrieb sind
     * absehbar und werden ADDITIV über eine Zwischentabelle nachgerüstet; DANN fällt diese
     * Bedingung. Auf application_id gibt es bewusst keine: sie ist Herkunftsnachweis, kein
     * Schlüssel, und mehrere Partner aus einem Antrag verhindert bereits die Statusprüfung.
     */
    const rows = await sql<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'platform' and tablename = 'partners'`,
    )
    const unique = rows.filter((r) => /unique/i.test(r.indexdef) && !/_pkey/.test(r.indexdef))
    expect(unique).toHaveLength(1)
    expect(unique[0]!.indexdef).toMatch(/\(user_id\)/)
  })
})

// ── (5) Die manuelle Verknüpfung ─────────────────────────────────────────────────────────────────
describe('(5) admin_link_partner_account: Raymanns Weg ins Portal', () => {
  async function createPartnerByHand(admin: TestUser, slug: string) {
    const res = await asAdmin(admin, `select public.admin_create_partner($1,$2) as r`, [
      slug,
      `Raymann Elektrotechnik ${slug}`,
    ])
    expect(res.status).toBe('created')
    spawnedPartners.push(slug)
  }

  it('DER KERNFALL: ein von Hand angelegter Partner bekommt sein Konto — über die ADRESSE', async () => {
    /*
     * Ohne diesen Weg käme Raymann nie ins Portal: seine Zeile hat keine user_id, und der einzige
     * andere Weg dorthin führt über einen genehmigten Antrag, den es für ihn nicht gibt und nicht
     * mehr geben kann (der Slug ist vergeben, eine zweite Zeile wäre ein zweiter Partner).
     */
    const admin = await newAdmin()
    const slug = newSlug('raymann')
    await createPartnerByHand(admin, slug)
    const chef = await newPlainUser()

    // Case-insensitiv und mit Leerzeichen: niemand kennt die Schreibweise seines eigenen Kontos.
    const res = await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, [
      slug,
      `  ${chef.email.toUpperCase()}  `,
    ])

    expect(res).toEqual({ status: 'ok', slug, user_id: chef.id })
    expect((await readPartner(slug))!.user_id).toBe(chef.id)
  })

  it('⚠ EINE BESTEHENDE ZUORDNUNG WIRD NICHT ÜBERSCHRIEBEN', async () => {
    /*
     * Ein Upsert nähme dem bisherigen Konto den Zugang zu seinem eigenen Betrieb, ohne dass es
     * irgendwo auffiele — und es gäbe keinen Weg zurück, weil niemand mehr wüsste, welches Konto es
     * war. Dieselbe Entscheidung wie bei admin_create_partner (B16-1).
     */
    const admin = await newAdmin()
    const slug = newSlug('besetzt')
    await createPartnerByHand(admin, slug)
    const erster = await newPlainUser()
    const zweiter = await newPlainUser()

    await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, [
      slug,
      erster.email,
    ])

    const res = await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, [
      slug,
      zweiter.email,
    ])

    expect(res).toEqual({ status: 'already_linked', current_email: erster.email })
    // Die entscheidende Zeile: das ERSTE Konto steht unverändert.
    expect((await readPartner(slug))!.user_id).toBe(erster.id)
  })

  it('ein Konto, das schon an einem anderen Partner hängt, wird abgewiesen — mit dessen Slug', async () => {
    const admin = await newAdmin()
    const belegt = newSlug('belegt')
    const frei = newSlug('frei')
    await createPartnerByHand(admin, belegt)
    await createPartnerByHand(admin, frei)
    const chef = await newPlainUser()

    await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, [belegt, chef.email])

    const res = await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, [
      frei,
      chef.email,
    ])

    expect(res).toEqual({ status: 'account_taken', partner_slug: belegt })
    expect((await readPartner(frei))!.user_id).toBeNull()
  })

  it('unbekannte Adresse und Mehrfachtreffer werden unterschiedlich beantwortet', async () => {
    /*
     * Mehrfachtreffer NICHT auf den ersten aufzulösen ist hier die teuerste vermeidbare
     * Verwechslung: ein zufällig gewähltes FREMDES Konto bekäme Zugriff auf einen Fachbetrieb.
     * auth.users erzwingt Eindeutigkeit nur partiell (users_email_partial_key: UNIQUE (email) WHERE
     * is_sso_user = false) — der Fall wird deshalb so hergestellt, wie er real entstünde.
     */
    const admin = await newAdmin()
    const slug = newSlug('mehrdeutig')
    await createPartnerByHand(admin, slug)

    const unbekannt = await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, [
      slug,
      `niemand-${randomUUID()}@test.local`,
    ])
    expect(unbekannt).toEqual({ status: 'user_not_found' })

    const a = await newPlainUser()
    const b = await newPlainUser()
    await sql('update auth.users set is_sso_user = true, email = $1 where id = $2', [a.email, b.id])

    const mehrdeutig = await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, [
      slug,
      a.email,
    ])
    expect(mehrdeutig).toEqual({ status: 'ambiguous_email' })
    expect((await readPartner(slug))!.user_id).toBeNull()
  })

  it('ein unbekannter Partner und fehlende Angaben sind fachliche Zustände', async () => {
    const admin = await newAdmin()
    expect(
      await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, [
        'gibt-es-nicht',
        'wer@test.local',
      ]),
    ).toEqual({ status: 'not_found' })

    expect(
      await asAdmin(admin, `select public.admin_link_partner_account($1,$2) as r`, ['  ', '  ']),
    ).toEqual({ status: 'missing_fields' })
  })

  it('die Partnerliste zeigt Konto und Herkunft — Adresse NEBEN der Kennung', async () => {
    const admin = await newAdmin()
    const { applicationId, user } = await submitWithAccount({ company: 'Elektro Liste GmbH' })
    const slug = newSlug('liste')
    await approve(admin, applicationId, slug)

    const res = await asAdmin<{ status: string; partners: Record<string, unknown>[] }>(
      admin,
      'select public.admin_list_partners() as r',
    )

    const row = res.partners.find((p) => p.slug === slug)!
    expect(row.user_id).toBe(user.id)
    // Eine UUID sagt einem Menschen nicht, WELCHES Konto verknüpft ist.
    expect(row.account_email).toBe(user.email)
    expect(row.application_id).toBe(applicationId)
  })
})

// ── (6) Rechtefläche ─────────────────────────────────────────────────────────────────────────────
describe('(6) Rechte der neuen und der nachgezogenen Wrapper', () => {
  it('beide neuen Wrapper: EXECUTE ausschliesslich für authenticated', async () => {
    /*
     * `service_role` bekommt bewusst KEIN Grant: beide leiten ihre Autorisierung aus auth.uid() ab,
     * das dort NULL ist. Bei der Genehmigung wiegt das zusätzlich schwerer — reviewed_by bliebe
     * strukturell leer, und die Zuschreibung einer unumkehrbaren Handlung ist der halbe Zweck des
     * Protokolls (wie created_by in B14-1).
     */
    for (const fn of ['admin_approve_partner_application', 'admin_link_partner_account']) {
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

  it('die zwei per create-or-replace nachgezogenen Wrapper haben ihre Grants BEHALTEN', async () => {
    // Ein DROP hätte sie entfernt — in B3-1 real passiert. Deshalb gemessen, nicht vorausgesetzt.
    for (const fn of ['admin_list_partners', 'admin_get_partner_application']) {
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

  it('es entstehen KEINE neuen Tabellenrechte', async () => {
    const partners = await sql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'partners'
          and grantee in ('anon','authenticated','service_role')
        order by grantee, privilege_type`,
    )
    // Unverändert seit B16-1: nur service_role darf lesen, niemand schreiben oder löschen.
    expect(partners).toEqual([{ grantee: 'service_role', privilege_type: 'SELECT' }])

    const applications = await sql<{ grantee: string }>(
      `select grantee from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'partner_applications'
          and grantee in ('anon','authenticated','service_role')`,
    )
    expect(applications).toEqual([])
  })

  it('EIN EINGELOGGTER NICHT-ADMIN SCHEITERT MIT 42501 — und hinterlässt nichts', async () => {
    const admin = await newAdmin()
    const fremder = await newPlainUser()
    const { applicationId } = await submitWithAccount()
    const slug = newSlug('fremd')
    const handSlug = newSlug('hand')
    await asAdmin(admin, `select public.admin_create_partner($1,$2) as r`, [handSlug, 'Von Hand'])
    spawnedPartners.push(handSlug)

    for (const call of [
      `select public.admin_approve_partner_application('${applicationId}', '${slug}') as r`,
      `select public.admin_link_partner_account('${handSlug}', '${fremder.email}') as r`,
    ]) {
      await expect(
        runAs({ role: 'authenticated', userId: fremder.id, commit: false }, (c) => c.query(call)),
      ).rejects.toMatchObject({ code: '42501' })
    }

    expect(await readPartner(slug)).toBeUndefined()
    expect((await readApplication(applicationId))!.status).toBe('pending')
    expect((await readPartner(handSlug))!.user_id).toBeNull()
  })

  it('anon hat auf KEINEM public.admin_*-Wrapper ein EXECUTE — introspektiv, ohne Aufruf', async () => {
    /*
     * ⚠ HIER STAND EIN DIREKTER AUFRUF ALS `anon`, UND ER HAT DEN DATENBANKPROZESS ABGESCHOSSEN.
     *
     * Ein `select public.admin_approve_partner_application(...)` unter der Rolle `anon` — also der
     * Versuch, fehlenden Zugriff durch die erwartete Ablehnung zu BEWEISEN — beendet den
     * Postgres-Backend-Prozess (Signal 11) statt sauber mit 42501 abzulehnen. Lokal lief der Test
     * zweimal grün, im CI-Image ist er am 26.07.2026 reproduzierbar aufgeschlagen: der Server nahm
     * mitten im Lauf keine Verbindungen mehr an („Connection terminated unexpectedly"), und die
     * nachfolgende Testdatei scheiterte schon an der Erreichbarkeitsprüfung.
     *
     * Für Prüfungen gegen die Cloud-DB galt „kein Funktionsaufruf" längst als Konvention
     * (Segfault-Vermeidung, seit B10-1 in den Handover-Logs). Sie gilt ab jetzt AUCH lokal und im
     * CI — als Arbeitsregel in der Root-`CLAUDE.md` festgehalten.
     *
     * DIE ABGRENZUNG, auf die es ankommt: Ein echter Aufruf ist NUR dann sicher, wenn die
     * aufrufende Rolle ein EXECUTE-Grant besitzt und die Ablehnung IM FUNKTIONSRUMPF erfolgt
     * (`raise … using errcode = '42501'`). Genau das prüft der Test „EIN EINGELOGGTER NICHT-ADMIN
     * SCHEITERT MIT 42501" oben — er ruft real auf, als `authenticated` mit Grant, und ist
     * unverändert geblieben. Nicht sicher ist die Ablehnung auf GRANT-Ebene, also der Fall, den
     * dieser Test hier abdeckt.
     *
     * Gemessen wird deshalb der Katalog — und zwar BREITER als der abgelöste Aufruf: nicht die zwei
     * neuen Wrapper (die decken die beiden Tests darüber ab), sondern die GESAMTE
     * `public.admin_*`-Fläche. `anon` hat in `platform` seit T4-1 nirgends ein Recht; ein
     * versehentlich vergebenes Grant auf irgendeinem Admin-Wrapper fiele sonst erst dort auf, wo
     * jemand zufällig hinsieht.
     */
    const rows = await sql<{ proname: string; can: boolean }>(
      `select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as can
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.prokind = 'f'
          and p.proname like 'admin\\_%'
        order by p.proname`,
    )

    // Die beiden neuen Wrapper sind nachweislich Teil der geprüften Menge — sonst prüfte der Test
    // im Zweifel eine leere Liste und wäre still wertlos.
    expect(rows.map((r) => r.proname)).toEqual(
      expect.arrayContaining(['admin_approve_partner_application', 'admin_link_partner_account']),
    )
    expect(rows.filter((r) => r.can).map((r) => r.proname)).toEqual([])
  })
})
