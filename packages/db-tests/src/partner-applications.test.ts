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
//     Adresse · kein oder mehrere Konten → ⚠ ABBRUCH, es entsteht KEIN Antrag (nachgebessert am
//     26.07.2026, s. (4)).
// (4) ⚠ EIN ANTRAG ENTSTEHT NICHT OHNE KONTO — NACHGEBESSERT, DIE B16-3-REGEL WAR HIER FALSCH.
//     Ursprünglich entstand der Antrag auch unverknüpft („eine verlorene Bewerbung wiegt schwerer
//     als eine fehlende Verknüpfung"). In Produktion hat genau das einen Antrag erzeugt, der zu
//     keinem Login führt: die Kontoanlage scheiterte am Rate-Limit des Mailversands (429
//     over_email_send_rate_limit), der Antrag wurde trotzdem geschrieben, und der Bewerber sah
//     „Danke, wir melden uns". Seit 20260726120000 bricht der Schreibweg stattdessen ab
//     (`no_account`), und ein Trigger setzt dieselbe Bedingung auf Speicherebene durch.
//     Ein Antrag darf trotzdem nicht verlorengehen, wo es keinen Grund dazu gibt: mehrfach zur
//     selben Adresse geht weiter, und ein Konto-Löschen bleibt möglich (on delete set null — der
//     Grund, warum die Invariante ein Trigger ist und kein NOT NULL auf der Spalte).
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

  /*
   * ⚠ OHNE ausdrücklich übergebene Adresse entsteht ZUERST EIN KONTO (seit der Nachbesserung vom
   * 26.07.2026). Das ist kein Test-Kunstgriff, sondern der reale Ablauf: Die Bewerbungsseite legt
   * das Konto an, BEVOR sie diesen Wrapper ruft — ein Antrag ohne aufgelöstes Konto entsteht seit
   * dem Fix gar nicht mehr. Eine erfundene Adresse als Vorgabewert machte deshalb JEDEN Test
   * dieser Datei zu einem Test des Abbruchpfads, und die eigentlich gemeinten Zusicherungen (Form
   * der Rückgabe, kein UNIQUE, Normalisierung, Admin-Sichten) wären still unprüfbar geworden.
   * Wer den ABBRUCH messen will, übergibt eine Adresse ohne Konto — ausdrücklich und sichtbar.
   */
  const fallbackEmail =
    'email' in input ? null : (await newPlainUser()).email

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
        value('email', fallbackEmail),
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

  it('ein NEUES und ein BESTEHENDES Konto ergeben dieselbe Antwort — nur die Zeile unterscheidet sich', async () => {
    /*
     * Der Fall, den die Bewerbungsseite real erzeugt: Sie legt vor diesem Aufruf ein Konto an. Ob
     * es dabei NEU entstanden ist oder schon bestand (GoTrue antwortet dann mit 422
     * `user_already_exists`, ohne das Passwort anzutasten), darf die Antwort nicht verraten — und
     * tut es nicht: In beiden Fällen findet der Wrapper genau ein Konto und antwortet `created`.
     */
    const bestehend = await newPlainUser()
    const frisch = await newPlainUser()

    const mitBestehendem = await submit({ email: bestehend.email })
    const mitFrischem = await submit({ email: frisch.email })

    // Bit-identische Form; nur die (zufällige) ID unterscheidet sich.
    expect(Object.keys(mitBestehendem).sort()).toEqual(Object.keys(mitFrischem).sort())
    expect(mitBestehendem.status).toBe(mitFrischem.status)

    expect((await readApplication(mitBestehendem.application_id as string))!.user_id).toBe(
      bestehend.id,
    )
    expect((await readApplication(mitFrischem.application_id as string))!.user_id).toBe(frisch.id)
  })

  it('⚠ OFFENGELEGTE GRENZE: eine Adresse OHNE Konto bekommt seit dem Fix eine ANDERE Antwort', async () => {
    /*
     * Das ist der Preis der Invariante, und er wird hier gemessen statt beschwiegen: Bis zur
     * Nachbesserung war die Rückgabe für eine bekannte und eine unbekannte Adresse identisch.
     * `created` heisst jetzt, dass zur Adresse ein Konto existiert.
     *
     * WARUM DAS TRAGBAR IST — und woran sich das ändern würde, wenn jemand daran baut:
     *   - „Kein Antrag ohne Konto" und „die Antwort verrät nichts über die Existenz einer Adresse"
     *     schliessen einander aus, sobald die Kontoanlage scheitert. Es ist eine Wahl, keine Lücke.
     *   - Der Wrapper ist service_role-only und hat GENAU EINEN Aufrufer
     *     (`apps/web/lib/partner-application/store.ts`); von aussen ist er nicht erreichbar.
     *   - Im Normalfall legt der Anwendungscode vorher ein Konto an, dann trifft `created` auf
     *     beide Fälle zu. Erreichbar ist der Unterschied nur, wenn die Kontoanlage fehlschlägt —
     *     also im Zeitfenster des Mailversand-Rate-Limits, das getrennt behoben wird.
     *   - Nach AUSSEN führen beide Abbruchgründe (kein Konto / Datenbank weg) zu derselben
     *     neutralen Meldung; das misst `apps/web/lib/partner-application/flow.test.ts`.
     */
    const ohneKonto = await submit({ email: `niemand-${randomUUID()}@test.local` })

    expect(ohneKonto).toEqual({ status: 'no_account' })
    // Und die Antwort trägt weiterhin NICHTS darüber hinaus — kein Grund, keine Adresse, kein Konto.
    expect(Object.keys(ohneKonto)).toEqual(['status'])
  })

  it('ZWEITE Bewerbung mit derselben Adresse geht durch — kein UNIQUE, kein Constraint-Fehler', async () => {
    /*
     * Ein UNIQUE auf der Adresse wäre der bequemste Weg zu einem sauberen Bestand und zugleich das
     * Leck: „diese Adresse hat sich schon beworben" ist genau die Auskunft, die diese Seite nicht
     * geben darf. Mehrfachbewerbungen sind erlaubt und im Admin als zwei Zeilen sichtbar.
     */
    // Die Adresse trägt ein Konto — die zweite Bewerbung ist der REALE Fall: derselbe Betrieb
    // bewirbt sich noch einmal, sein Konto gibt es seit dem ersten Mal.
    const { email } = await newPlainUser()

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

// ── (2) Der Weg zu 'approved' ────────────────────────────────────────────────────────────────────
describe('(2) Genehmigen führt nur über den Partner (seit B16-4a)', () => {
  it('DER WICHTIGSTE TEST DIESER DATEI: es gibt genau EINEN Genehmigungsweg, und er verlangt einen SLUG', async () => {
    /*
     * ⚠ NACHGEZOGEN IN B16-4a, NICHT AUFGEWEICHT. Bis B16-3 lautete die Zusicherung „es gibt
     * KEINEN Wrapper, der einen Antrag genehmigt" — genau diese Zeile wurde von der B16-4a-Migration
     * rot gemacht, und genau so war sie gemeint (in B16-3 als Wächter-Probe gemessen). Die
     * Zusicherung dahinter bleibt dieselbe und ist nur schärfer geworden:
     *
     *   Ein Antrag kann NICHT allein durch das Setzen eines Status genehmigt werden.
     *
     * Der Beleg dafür steht in der SIGNATUR: `admin_approve_partner_application` verlangt einen
     * Slug. Es gibt damit keinen Aufruf, der 'approved' erreicht, ohne dass ein Fachbetrieb
     * entsteht — dass beides in derselben Transaktion passiert, prüft partner-approval.test.ts (3).
     *
     * Geprüft wird weiterhin die VOLLSTÄNDIGE Wrapper-Menge, nicht die Abwesenheit eines geratenen
     * Namens: ein `admin_decide_partner_application` mit Status-Parameter wäre derselbe Fehler unter
     * anderem Namen und fiele hier auf.
     */
    const rows = await sql<{ proname: string; args: string }>(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname like '%partner_application%'
        order by p.proname`,
    )

    expect(rows.map((r) => r.proname)).toEqual([
      'admin_approve_partner_application',
      'admin_get_partner_application',
      'admin_list_partner_applications',
      'admin_reject_partner_application',
      'submit_partner_application',
    ])

    // Genehmigen verlangt den Slug — ein Aufruf ohne ihn erreicht 'approved' nicht.
    const approve = rows.find((r) => r.proname === 'admin_approve_partner_application')!
    expect(approve.args).toBe('p_id uuid, p_slug text')

    // Und der ablehnende Wrapper nimmt weiterhin KEINEN Status entgegen — der Zielwert ist ein
    // Literal im Rumpf. Ein Statusparameter wäre der Weg zu 'approved' über dieselbe Funktion,
    // vorbei am Partner.
    const reject = rows.find((r) => r.proname === 'admin_reject_partner_application')!
    expect(reject.args).toBe('p_id uuid')
  })

  it('der Enum kennt approved — erreichbar seit B16-4a, aber nur zusammen mit einem Fachbetrieb', async () => {
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

  it('⚠ KEIN Konto zur Adresse → es entsteht KEIN Antrag (nachgebessert)', async () => {
    /*
     * DIE KERNZUSICHERUNG DIESER NACHBESSERUNG. Vorher entstand der Antrag unverknüpft — er führte
     * zu keinem Login, war in B16-4a nicht genehmigbar (`no_account`), und der Bewerber bekam
     * trotzdem „Danke, wir melden uns" zu sehen. In Produktion real aufgetreten, Ursache 429
     * over_email_send_rate_limit bei der Kontoanlage.
     */
    const email = `niemand-${randomUUID()}@test.local`
    const res = await submit({ email })

    expect(res).toEqual({ status: 'no_account' })

    // Und zwar wirklich NICHTS geschrieben — nicht bloss unverknüpft.
    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.partner_applications where email = $1`,
      [email],
    )
    expect(rows[0]!.n).toBe(0)
  })

  it('MEHRERE Konten zur Adresse → ebenfalls Abbruch, statt eines zufällig zu wählen', async () => {
    /*
     * auth.users erzwingt keine globale E-Mail-Eindeutigkeit (mehrere Identity-Provider). Einen der
     * Treffer zu nehmen hiesse, später ein zufällig ausgewähltes FREMDES Konto freizuschalten — der
     * teuerste denkbare Fehler dieses Abschnitts.
     *
     * Seit der Nachbesserung endet der Fall im ABBRUCH statt in einem unverknüpften Antrag, und
     * zwar mit DEMSELBEN Status wie „kein Konto": Ein eigener Status wäre für den Aufrufer eine
     * Auskunft über den Kontobestand zu einer fremden Adresse — genau das, was dieser Wrapper
     * nicht gibt.
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

    expect(res).toEqual({ status: 'no_account' })
    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.partner_applications where email = $1`,
      [a.email],
    )
    expect(rows[0]!.n).toBe(0)
  })

  it('eine übergebene, aber nicht existierende Konto-ID fällt auf die Adresse zurück', async () => {
    /*
     * Eine abgelaufene oder gefälschte Sitzungskennung darf die Bewerbung nicht kosten, solange die
     * Adresse selbst auflösbar ist — die Auflösung über `auth.users` greift dann weiterhin. Nur
     * wenn AUCH sie ins Leere läuft, bricht der Schreibweg ab (Test darüber).
     */
    const user = await newPlainUser()
    const res = await submit({ email: user.email, userId: randomUUID() })

    expect(res.status).toBe('created')
    expect((await readApplication(res.application_id as string))!.user_id).toBe(user.id)
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

// ── (3a) Die Invariante auf Speicherebene ────────────────────────────────────────────────────────
describe('(3a) partner_applications_require_account: der Wächter unter dem Wrapper', () => {
  /*
   * ⚠ WARUM EIN TRIGGER UND KEIN `NOT NULL` AUF DER SPALTE — gemessen, nicht abgeleitet.
   *
   * `user_id` trägt `on delete set null`, und diese referentielle Aktion IST SELBST EIN UPDATE
   * (dieselbe Falle wie bei leads.last_edited_by/B2-1, email_events.lead_id/B2-2 und
   * analyses.lead_id/created_by/B14-1). In einer zurückgerollten Transaktion gegen PostgreSQL 17.6
   * mit echtem Konto und echtem Antrag gemessen:
   *
   *   NOT NULL + on delete set null → `delete from auth.users` scheitert mit 23502. Das Konto ist
   *                                   UNLÖSCHBAR, sobald ein Antrag daran hängt — ausgerechnet
   *                                   gegen ein Löschverlangen.
   *   NOT NULL + on delete cascade  → das Löschen VERNICHTET den offenen Antrag, und sobald aus ihm
   *                                   ein Partner wurde, scheitert es mit 23503 an
   *                                   partners_application_id_fkey (on delete restrict, B16-4a) —
   *                                   das Konto ist dann wieder unlöschbar.
   *
   * Die Invariante ist deshalb enger gefasst, als eine Spaltenbedingung sie ausdrücken kann: Ein
   * Antrag darf nicht ohne Konto ENTSTEHEN. Dass die Verknüpfung SPÄTER entfällt, weil die Person
   * ihr Konto löscht, ist kein illegitimer Antrag — genau dafür ist `on delete set null` da (der
   * Test direkt darüber misst es).
   */
  it('DER WÄCHTER: ein direkter INSERT ohne Konto wird abgewiesen — auch für postgres', async () => {
    /*
     * Als `postgres`, also mit allen Rechten und am Wrapper vorbei: Die Invariante ist eine
     * Eigenschaft der Datenbank und keine Übereinkunft des Anwendungscodes. `service_role` hat auf
     * dieser Tabelle ohnehin kein Grant (Teil (2) dieser Datei) und käme gar nicht so weit.
     */
    await expect(
      sql(
        `insert into platform.partner_applications (company, first_name, last_name, email, message, user_id)
         values ('Direkt GmbH','A','B',$1,'Ein Antrag am Wrapper vorbei, lang genug fuer den CHECK.', null)`,
        [`direkt-${randomUUID()}@test.local`],
      ),
    ).rejects.toThrow(/ohne verknüpftes Konto entsteht nicht/)
  })

  it('user_id lässt sich weder SETZEN noch UMHÄNGEN', async () => {
    /*
     * Die Gegenrichtung zur Ausnahme: Ein Antrag, dessen Konto gelöscht wurde, darf nicht
     * nachträglich an ein anderes gehängt werden — an genau dieser Spalte entscheidet B16-4a, WER
     * freigeschaltet wird. Ein Nachziehen von Hand wäre eine Genehmigung ohne Antragsteller.
     */
    const eigen = await newPlainUser()
    const fremd = await newPlainUser()
    const res = await submit({ email: eigen.email })
    const id = res.application_id as string

    // Umhängen auf ein anderes Konto.
    await expect(
      sql('update platform.partner_applications set user_id = $1 where id = $2', [fremd.id, id]),
    ).rejects.toThrow(/nicht setzen oder umhängen/)

    // Und nach dem Nullen auch das erneute Setzen.
    await deleteUser(eigen.id)
    spawnedUsers.splice(spawnedUsers.indexOf(eigen.id), 1)
    expect((await readApplication(id))!.user_id).toBeNull()
    await expect(
      sql('update platform.partner_applications set user_id = $1 where id = $2', [fremd.id, id]),
    ).rejects.toThrow(/nicht setzen oder umhängen/)
  })

  it('DIE AUSNAHME IST ENG: nullen PLUS eine andere Änderung ist gesperrt', async () => {
    /*
     * Erlaubt ist ausschliesslich das Nullen bei sonst BIT-IDENTISCHER Zeile — sonst wäre die
     * Ausnahme ein Schlupfloch, durch das sich beliebige Felder mitverändern liessen (dieselbe
     * Konstruktion wie reject_analysis_mutation, B14-1).
     */
    const user = await newPlainUser()
    const id = (await submit({ email: user.email })).application_id as string

    await expect(
      sql(
        `update platform.partner_applications set user_id = null, company = 'Umbenannt GmbH' where id = $1`,
        [id],
      ),
    ).rejects.toThrow(/nicht setzen oder umhängen/)
  })

  it('ein normales UPDATE (Status, Prüfer, Zeitpunkt) läuft unverändert durch', async () => {
    // Sonst hätte der Wächter die Genehmigungs- und Ablehnungswrapper aus B16-3/B16-4a mit
    // blockiert — er darf nur auf user_id ansprechen.
    const admin = await newAdmin()
    const user = await newPlainUser()
    const id = (await submit({ email: user.email })).application_id as string

    const res = await asAdmin(admin, (q) =>
      q(`select public.admin_reject_partner_application($1) as r`, [id]),
    )

    expect(res.status).toBe('ok')
    expect((await readApplication(id))!.status).toBe('rejected')
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

    /*
     * Für `has_account = false` wird das Konto NACHTRÄGLICH gelöscht — seit der Nachbesserung
     * (20260726120000) ist das der einzige Weg, auf dem ein Antrag ohne Konto überhaupt noch
     * existieren kann. Genau deshalb bleibt die Kennzeichnung in der Liste sinnvoll: Sie zeigt
     * jetzt „das Konto wurde gelöscht" statt wie früher „die Kontoanlage ist schiefgegangen".
     */
    const gelöscht = await createUser()
    const alt = await submit({ company: 'Alter Antrag GmbH', email: gelöscht.email })
    await deleteUser(gelöscht.id)
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
    // `account_partner_slug` und `partner_slug` sind in B16-4a dazugekommen (der Fachbetrieb, an dem
    // das Konto schon hängt, bzw. der aus diesem Antrag entstandene). Die Liste wird NACHGEZOGEN,
    // nicht durch eine Teilmengen-Prüfung ersetzt: sie ist die Absicherung dagegen, dass ein Feld
    // unbemerkt in eine Ansicht über fremde Personen wandert.
    expect(Object.keys(app).sort()).toEqual([
      'account_email',
      'account_partner_slug',
      'company',
      'created_at',
      'email',
      'first_name',
      'id',
      'last_name',
      'message',
      'partner_slug',
      'phone',
      'reviewed_at',
      'reviewed_by_email',
      'status',
      'user_id',
      'website',
    ])
    expect(app.partner_slug).toBeNull()
    expect(app.account_partner_slug).toBeNull()
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
