// DB-Gate für das Partner-Portal und den Benachrichtigungsvermerk
// (Migration 20260726150000_create_partner_portal.sql, B16-4b).
//
// ── WORAN DIESER SCHRITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ────────────────────────
// (1) ⚠ FREMDE PARTNER. `public.get_my_partner` ist der erste Lesezugriff einer NEUEN
//     Zugriffsebene — ein Partner ist weder Kunde noch Admin. Eine vergessene oder falsche
//     `user_id`-Bedingung fiele nirgends auf, solange es genau einen Fachbetrieb gibt: Jeder sähe
//     „seinen" Link, und er wäre richtig. Ab dem ZWEITEN Betrieb ist dieselbe Lücke ein
//     Empfehlungslink im Portal eines fremden Unternehmens — und die daraus entstehenden Anfragen
//     würden dem Falschen zugeordnet, ohne dass irgendetwas nach einem Fehler aussieht. Deshalb
//     stehen hier ZWEI Partner nebeneinander, und beide Richtungen werden geprüft.
// (2) DER RÜCKGABEUMFANG. Was der Wrapper liefert, kann im ausgelieferten HTML landen — auch wenn
//     niemand es rendert. Geprüft werden die SCHLÜSSEL der Antwort und zusätzlich der vollständige
//     serialisierte Rückgabewert gegen die internen Felder (Ansprechperson, notified_at, user_id,
//     application_id). Eine Auswahlliste im TypeScript-Leser wäre eine Zusage, die der nächste Umbau
//     zurücknimmt; die hier gemessene steht in der Datenbank.
// (3) EIN INAKTIVER PARTNER IST NICHT AUFFINDBAR — dieselbe Antwort wie „kein Partner". Sonst könnte
//     das Portal einen dritten Zustand erfinden und einem stillgelegten Betrieb weiterhin einen Link
//     zum Kopieren anbieten, der nachweislich ins Leere führt (seine Landingpage antwortet 404).
// (4) `notified_at` SAGT DIE WAHRHEIT ODER NICHTS. Es gibt keinen Zeitstempel-Parameter, kein
//     Zurücksetzen und keinen Weg an `public.admin_mark_partner_notified` vorbei (kein
//     `update`-Grant auf `platform.partners` für irgendeine Rolle). Ohne verknüpftes Konto wird
//     abgewiesen: die Mail verweist auf ein Portal mit Anmeldung, und ohne Konto gibt es die nicht.
// (5) DIE RECHTEFLÄCHE. Beide neuen Wrapper sind authenticated-only; `admin_mark_partner_notified`
//     WIRFT 42501 statt leer zu antworten. Der per `create or replace` nachgezogene
//     `admin_list_partners` behält seine Grants (ein DROP hätte sie entfernt — in B3-1 real
//     passiert) und wird nachgemessen, nicht vorausgesetzt.
// (6) JEDER WRAPPER WIRD TATSÄCHLICH AUFGERUFEN (Arbeitsregel 2): Introspektion beweist Existenz,
//     nicht Lauffähigkeit — plpgsql prüft Funktionsrümpfe nicht beim Anlegen.
// (7) DIE NEUE SPALTE BRICHT NICHTS. `guard_partner_slug` (B16-1) blockt weiterhin jede Umbenennung
//     und steht dem Setzen von `notified_at` nicht im Weg; ein Konto bleibt löschbar; und
//     `public.get_active_partner` — der ÖFFENTLICHE Lesepfad — gibt `notified_at` NICHT heraus.
//
// ⚠ ARBEITSREGEL 5: Fehlende Aufrufbarkeit wird mit `has_function_privilege` geprüft, NIE durch
//     einen Aufruf als Rolle ohne Grant — ein solcher Aufruf hat im CI-Lauf von B16-4a den
//     Postgres-Prozess mit Signal 11 beendet. Ein echter Aufruf ist nur dort sicher, wo die Rolle
//     einen Grant BESITZT und die Ablehnung im Funktionsrumpf erfolgt (der eingeloggte Nicht-Admin).

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
const spawnedPartners: string[] = []

function newSlug(prefix = 'gate-b164b'): string {
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

/**
 * Legt einen Fachbetrieb an — als `postgres`, also reines Fixture-Setup.
 *
 * Bewusst NICHT über `admin_approve_partner_application`: Dieses Gate misst das Portal, nicht die
 * Genehmigung (die ist in `partner-approval.test.ts` vollständig gemessen). Ein Umweg über den
 * Antragsweg brächte hier drei weitere Fixtures und keine zusätzliche Aussage.
 */
async function newPartner(
  input: { userId?: string | null; displayName?: string; contactFirstName?: string } = {},
): Promise<string> {
  const slug = newSlug()
  await sql(
    `insert into platform.partners (slug, display_name, contact_first_name, contact_last_name, user_id)
     values ($1, $2, $3, 'Gruber', $4)`,
    [
      slug,
      input.displayName ?? 'Elektro Musterbetrieb GmbH',
      input.contactFirstName ?? 'Anna',
      input.userId ?? null,
    ],
  )
  spawnedPartners.push(slug)
  return slug
}

/** Der Weg des Portals: ein angemeldetes Konto ruft `public.get_my_partner()` auf. */
async function getMyPartner(user: TestUser): Promise<Record<string, unknown>> {
  return runAs({ role: 'authenticated', userId: user.id }, async (c) => {
    const { rows } = await c.query<{ r: Record<string, unknown> }>(
      `select public.get_my_partner() as r`,
    )
    return rows[0]!.r
  })
}

/** Der Weg des Admin-Bereichs: ein angemeldetes Konto ruft einen `admin_*`-Wrapper auf. */
async function asAdmin<T extends Record<string, unknown>>(
  user: TestUser,
  text: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(text, params)
    return rows[0]!.r
  })
}

async function markNotified(user: TestUser, slug: string) {
  return asAdmin(user, `select public.admin_mark_partner_notified($1) as r`, [slug])
}

async function readNotifiedAt(slug: string): Promise<string | null> {
  const rows = await sql<{ notified_at: string | null }>(
    `select notified_at from platform.partners where slug = $1`,
    [slug],
  )
  return rows[0]?.notified_at ?? null
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

// ── (1) get_my_partner: die eigene Zeile, und nur die ────────────────────────────────────────────
describe('(1) get_my_partner — der Lesezugriff des eingeloggten Fachbetriebs', () => {
  it('liefert die eigene Partnerzeile', async () => {
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id, displayName: 'Raymann Elektrotechnik GmbH' })

    expect(await getMyPartner(user)).toEqual({
      status: 'ok',
      slug,
      display_name: 'Raymann Elektrotechnik GmbH',
    })
  })

  it('DER RÜCKGABEUMFANG: genau drei Schlüssel — keine internen Felder', async () => {
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id, contactFirstName: 'Ingeborg' })
    // Ein Vermerk, der es unter keinen Umständen nach aussen schaffen darf.
    const admin = await newAdmin()
    await markNotified(admin, slug)

    const res = await getMyPartner(user)
    expect(Object.keys(res).sort()).toEqual(['display_name', 'slug', 'status'])

    /*
     * Zusätzlich der ROHTEXT: Eine Schlüsselprüfung fängt ein umbenanntes Feld nicht („kontakt"
     * statt „contact_first_name" wäre ein vierter Schlüssel, aber der Test oben nennt ihn nicht
     * beim Namen). Der Kontaktname und der Benachrichtigungsvermerk dürfen in der Antwort
     * NIRGENDS vorkommen — auch nicht als Teil eines anderen Feldes.
     */
    const raw = JSON.stringify(res)
    expect(raw).not.toContain('Ingeborg')
    expect(raw).not.toContain('notified')
    expect(raw).not.toContain(user.id)
  })

  it('⚠ DER WÄCHTER: zwei Fachbetriebe sehen ausschliesslich den JEWEILS EIGENEN Link', async () => {
    const userA = await newPlainUser()
    const userB = await newPlainUser()
    const slugA = await newPartner({ userId: userA.id, displayName: 'Betrieb A' })
    const slugB = await newPartner({ userId: userB.id, displayName: 'Betrieb B' })

    const resA = await getMyPartner(userA)
    const resB = await getMyPartner(userB)

    expect(resA).toEqual({ status: 'ok', slug: slugA, display_name: 'Betrieb A' })
    expect(resB).toEqual({ status: 'ok', slug: slugB, display_name: 'Betrieb B' })

    // Beide Richtungen ausdrücklich: der Slug des anderen darf in keiner der Antworten stehen.
    expect(JSON.stringify(resA)).not.toContain(slugB)
    expect(JSON.stringify(resB)).not.toContain(slugA)
  })

  it('ein Konto OHNE Partnerzeile bekommt {status: none} — der Normalfall, kein Fehler', async () => {
    const user = await newPlainUser()
    expect(await getMyPartner(user)).toEqual({ status: 'none' })
  })

  it('ein Konto ohne Partnerzeile sieht auch dann nichts, wenn es Fachbetriebe GIBT', async () => {
    const owner = await newPlainUser()
    const slug = await newPartner({ userId: owner.id })
    const stranger = await newPlainUser()

    const res = await getMyPartner(stranger)
    expect(res).toEqual({ status: 'none' })
    expect(JSON.stringify(res)).not.toContain(slug)
  })

  it('ein von Hand angelegter Betrieb OHNE Konto ist über niemanden erreichbar', async () => {
    const slug = await newPartner({ userId: null })
    const user = await newPlainUser()

    expect(JSON.stringify(await getMyPartner(user))).not.toContain(slug)
  })

  it('STILLGELEGT = UNAUFFINDBAR, und Reaktivieren stellt den Zugang wieder her', async () => {
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id })

    expect(await getMyPartner(user)).toMatchObject({ status: 'ok', slug })

    await sql('update platform.partners set is_active = false where slug = $1', [slug])
    // Dieselbe Antwort wie „kein Partner" — die Route kann den dritten Zustand nicht erfinden.
    expect(await getMyPartner(user)).toEqual({ status: 'none' })

    await sql('update platform.partners set is_active = true where slug = $1', [slug])
    expect(await getMyPartner(user)).toMatchObject({ status: 'ok', slug })
  })

  it('nach dem Löschen des Kontos bleibt der Betrieb bestehen und ist über niemanden erreichbar', async () => {
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id })

    // `on delete set null` (B16-4a): das Konto geht, der Fachbetrieb bleibt.
    await deleteUser(user.id)
    spawnedUsers.splice(spawnedUsers.indexOf(user.id), 1)

    const rows = await sql<{ user_id: string | null }>(
      'select user_id from platform.partners where slug = $1',
      [slug],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.user_id).toBeNull()

    const other = await newPlainUser()
    expect(JSON.stringify(await getMyPartner(other))).not.toContain(slug)
  })

  it('RECHTEFLÄCHE: nur `authenticated` darf aufrufen', async () => {
    expect(await executeGrants('get_my_partner')).toEqual({
      anon: false,
      authenticated: true,
      /*
       * Bewusst KEIN service_role-Grant: dort ist `auth.uid()` null, der Wrapper fände per
       * Konstruktion nichts — und ein Aufrufer, der das als „kein Partner" liest, sperrte einen
       * echten Fachbetrieb aus seinem eigenen Portal aus.
       */
      service_role: false,
    })
  })
})

// ── (2) admin_mark_partner_notified: der Vermerk sagt die Wahrheit oder nichts ────────────────────
describe('(2) admin_mark_partner_notified — OB und WANN benachrichtigt wurde', () => {
  it('setzt notified_at und gibt den Zeitpunkt zurück', async () => {
    const admin = await newAdmin()
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id })

    expect(await readNotifiedAt(slug)).toBeNull()

    const res = await markNotified(admin, slug)
    expect(res.status).toBe('ok')
    expect(res.notified_at).toEqual(expect.any(String))
    expect(await readNotifiedAt(slug)).not.toBeNull()
  })

  it('ein ERNEUTER Versand überschreibt den Zeitpunkt (letzte Benachrichtigung, nicht erste)', async () => {
    const admin = await newAdmin()
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id })

    await markNotified(admin, slug)
    const first = await readNotifiedAt(slug)

    // Ohne diesen Rückdatier-Schritt lägen beide `now()` im selben Zeitraster.
    await sql(`update platform.partners set notified_at = notified_at - interval '1 day'
                where slug = $1`, [slug])
    const backdated = await readNotifiedAt(slug)

    await markNotified(admin, slug)
    const second = await readNotifiedAt(slug)

    expect(first).not.toBeNull()
    expect(new Date(second!).getTime()).toBeGreaterThan(new Date(backdated!).getTime())
  })

  it('⚠ OHNE VERKNÜPFTES KONTO wird abgewiesen — und nichts geschrieben', async () => {
    const admin = await newAdmin()
    const slug = await newPartner({ userId: null })

    expect(await markNotified(admin, slug)).toEqual({ status: 'no_account' })
    expect(await readNotifiedAt(slug)).toBeNull()
  })

  it('unbekannter Slug → not_found, leerer Slug → missing_fields', async () => {
    const admin = await newAdmin()
    expect(await markNotified(admin, 'gibt-es-nicht-b164b')).toEqual({ status: 'not_found' })
    expect(await markNotified(admin, '   ')).toEqual({ status: 'missing_fields' })
  })

  it('der Slug wird kleingeschrieben aufgelöst (wie capture_lead/get_active_partner)', async () => {
    const admin = await newAdmin()
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id })

    expect((await markNotified(admin, slug.toUpperCase())).status).toBe('ok')
    expect(await readNotifiedAt(slug)).not.toBeNull()
  })

  it('ein eingeloggter NICHT-Admin bekommt 42501 — und der Vermerk bleibt leer', async () => {
    const nonAdmin = await newPlainUser()
    const owner = await newPlainUser()
    const slug = await newPartner({ userId: owner.id })

    /*
     * Sicher, weil `authenticated` ein EXECUTE-Grant BESITZT und die Ablehnung im Funktionsrumpf
     * erfolgt (`raise … 42501`) — nicht auf Grant-Ebene (Arbeitsregel 5).
     */
    await expect(markNotified(nonAdmin, slug)).rejects.toMatchObject({ code: '42501' })
    expect(await readNotifiedAt(slug)).toBeNull()
  })

  it('ES GIBT KEINEN WEG AN DEM WRAPPER VORBEI: service_role darf partners nicht schreiben', async () => {
    const owner = await newPlainUser()
    const slug = await newPartner({ userId: owner.id })

    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query('update platform.partners set notified_at = now() where slug = $1', [slug]),
      ),
    ).rejects.toThrow()
    expect(await readNotifiedAt(slug)).toBeNull()
  })

  it('RECHTEFLÄCHE: nur `authenticated` darf aufrufen', async () => {
    expect(await executeGrants('admin_mark_partner_notified')).toEqual({
      anon: false,
      authenticated: true,
      service_role: false,
    })
  })
})

// ── (3) admin_list_partners: nachgezogen, Grants unverändert ─────────────────────────────────────
describe('(3) admin_list_partners führt notified_at mit', () => {
  it('WIRD ECHT AUFGERUFEN und liefert notified_at je Zeile', async () => {
    const admin = await newAdmin()
    const userA = await newPlainUser()
    const userB = await newPlainUser()
    const slugNotified = await newPartner({ userId: userA.id })
    const slugSilent = await newPartner({ userId: userB.id })

    await markNotified(admin, slugNotified)

    const res = await asAdmin<{ status: string; partners: Array<Record<string, unknown>> }>(
      admin,
      `select public.admin_list_partners() as r`,
    )
    expect(res.status).toBe('ok')

    const notified = res.partners.find((p) => p.slug === slugNotified)
    const silent = res.partners.find((p) => p.slug === slugSilent)
    expect(notified?.notified_at).toEqual(expect.any(String))
    // `null` ist ein ECHTER Zustand: „noch nie benachrichtigt".
    expect(silent).toHaveProperty('notified_at', null)
  })

  it('die Grants haben den `create or replace` überlebt', async () => {
    expect(await executeGrants('admin_list_partners')).toEqual({
      anon: false,
      authenticated: true,
      service_role: false,
    })
  })
})

// ── (3b) admin_get_partner_application: der Zustand am ANTRAG ────────────────────────────────────
describe('(3b) admin_get_partner_application führt partner_notified_at mit', () => {
  /*
   * ⚠ WARUM DIESES FELD ÜBERHAUPT AM ANTRAG HÄNGT — im Bau gemessen, nicht abgeleitet:
   * Die Erfolgsmeldung der Genehmigung bleibt nach dem Klick NICHT stehen. Das Genehmigungsformular
   * wird nur gerendert, solange der Antrag `pending` ist; mit dem Erfolg wechselt der Status, das
   * Formular verschwindet — und mit ihm sein `useActionState` samt Meldung (derselbe Fehler wie in
   * B1-3: „die Rückmeldung verschwand durch ihren eigenen Erfolg"). Ohne dieses Feld wäre der Fall
   * „Mailversand gescheitert" auf der Antragsseite unsichtbar, und ein Admin hielte den Vorgang für
   * abgeschlossen.
   */
  async function newApplicationWithAccount(): Promise<{ id: string; user: TestUser }> {
    const user = await newPlainUser()
    const res = await runAs({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ r: { application_id?: string } }>(
        `select public.submit_partner_application(
           p_company => 'Elektro Portal GmbH', p_first_name => 'Petra', p_last_name => 'Portal',
           p_email => $1, p_message => 'Wir montieren seit Jahren Speicher und wollen Partner werden.'
         ) as r`,
        [user.email],
      )
      return rows[0]!.r
    })
    if (!res.application_id) throw new Error(`submit_partner_application: ${JSON.stringify(res)}`)
    return { id: res.application_id, user }
  }

  it('WIRD ECHT AUFGERUFEN: null vor, Zeitstempel nach der Benachrichtigung', async () => {
    const admin = await newAdmin()
    const { id } = await newApplicationWithAccount()
    const slug = newSlug()

    const approved = await asAdmin<{ status: string; slug?: string }>(
      admin,
      `select public.admin_approve_partner_application($1,$2) as r`,
      [id, slug],
    )
    expect(approved.status).toBe('ok')
    spawnedPartners.push(slug)

    const read = async () =>
      (
        await asAdmin<{ application: Record<string, unknown> }>(
          admin,
          `select public.admin_get_partner_application($1) as r`,
          [id],
        )
      ).application

    // Genehmigt, aber (noch) nicht benachrichtigt — genau der Zustand nach einem gescheiterten
    // Mailversand.
    expect(await read()).toMatchObject({ partner_slug: slug, partner_notified_at: null })

    await markNotified(admin, slug)
    expect((await read()).partner_notified_at).toEqual(expect.any(String))

    // Aufräumen: der Antrag hängt am Partner (`application_id`, on delete restrict).
    await sql('delete from platform.partners where slug = $1', [slug])
    spawnedPartners.splice(spawnedPartners.indexOf(slug), 1)
    await sql('delete from platform.partner_applications where id = $1', [id])
  })

  it('die Grants haben den `create or replace` überlebt', async () => {
    expect(await executeGrants('admin_get_partner_application')).toEqual({
      anon: false,
      authenticated: true,
      service_role: false,
    })
  })
})

// ── (4) Die neue Spalte bricht nichts ────────────────────────────────────────────────────────────
describe('(4) notified_at bricht weder den Slug-Wächter noch die Löschbarkeit eines Kontos', () => {
  it('guard_partner_slug blockt weiterhin die Umbenennung, aber nicht den Vermerk', async () => {
    const admin = await newAdmin()
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id })

    // Der Vermerk läuft durch — er ist kein Slug-Wechsel.
    expect((await markNotified(admin, slug)).status).toBe('ok')

    // Gegenprobe: der Wächter hält (P0001), auch für `postgres`.
    await expect(
      sql('update platform.partners set slug = $2 where slug = $1', [slug, `${slug}-neu`]),
    ).rejects.toMatchObject({ code: 'P0001' })
  })

  it('ein benachrichtigter Betrieb macht sein Konto nicht unlöschbar — der Vermerk überlebt', async () => {
    const admin = await newAdmin()
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id })
    await markNotified(admin, slug)

    await deleteUser(user.id)
    spawnedUsers.splice(spawnedUsers.indexOf(user.id), 1)

    const rows = await sql<{ user_id: string | null; notified_at: string | null }>(
      'select user_id, notified_at from platform.partners where slug = $1',
      [slug],
    )
    expect(rows[0]!.user_id).toBeNull()
    /*
     * Die FESTSTELLUNG, dass benachrichtigt wurde, ist unabhängig davon, ob das Konto noch
     * besteht — sie beschreibt einen Vorgang, der stattgefunden hat.
     */
    expect(rows[0]!.notified_at).not.toBeNull()
  })

  it('DER ÖFFENTLICHE LESEPFAD gibt notified_at NICHT heraus (get_active_partner unverändert)', async () => {
    const admin = await newAdmin()
    const user = await newPlainUser()
    const slug = await newPartner({ userId: user.id })
    await markNotified(admin, slug)

    const res = await runAs({ role: 'service_role' }, async (c) => {
      const { rows } = await c.query<{ r: Record<string, unknown> }>(
        `select public.get_active_partner($1) as r`,
        [slug],
      )
      return rows[0]!.r
    })

    expect(Object.keys(res).sort()).toEqual(['display_name', 'slug', 'status'])
    expect(JSON.stringify(res)).not.toContain('notified')
  })
})
