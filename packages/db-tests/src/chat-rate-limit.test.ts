// DB-Gate für die Kostenbremse des Projekt-Chats (B24)
// (Migration 20260910180000_create_chat_rate_limit.sql, fachlich
// `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §6.3).
//
// Dieser Schritt veröffentlicht den Chat: `apps/web/lib/project-chat/chat.ts` bekommt in derselben
// PR sein `'use server'`, und jeder Turn löst bis zu neun ABRECHENBARE Modellaufrufe aus. Die Bremse
// ist damit das Einzige zwischen einem offenen Endpunkt und einer unbegrenzten Rechnung — und zwei
// Fehlerarten wären dabei beim Klicken vollständig unsichtbar:
//
//   * SIE ZÄHLT DAS FALSCHE. Eine Zählung je PROJEKT statt je KONTO wäre keine Grenze (jedes Konto
//     darf beliebig viele Projekte anlegen — wer die Grenze erreicht, legte einfach ein zweites an).
//     Mitgezählte `assistant`-/`tool_*`-Zeilen machten aus derselben Zahl je nach Dokumentenlage ein
//     völlig anderes Limit. Beides sähe im Betrieb aus wie „die Bremse greift", nur eben zu früh,
//     zu spät oder gar nicht.
//   * SIE ZÄHLT ÜBERHAUPT NICHT. Ein Rumpf, der immer `ok` liefert, verhält sich bis zum ersten
//     Zwischenfall exakt wie der richtige. Deshalb wird hier nirgends ein Status behauptet, sondern
//     der Zählstand an echten Zeilen aufgebaut und die Kante gemessen.
//
// Das Gate beweist deshalb sieben Dinge:
//
//   (1) DER ZÄHLER ZÄHLT WIRKLICH — an der Kante gemessen (`max - 1` → ok, `max` → limit_reached),
//       und zwar gegen den TATSÄCHLICH geltenden Stand, nicht gegen eine abgeschriebene Zahl.
//   (2) ER ZÄHLT ÜBER ALLE PROJEKTE DES KONTOS — die letzte Nachricht liegt bewusst in einem
//       ZWEITEN Projekt; ohne den Join bliebe der Test grün und die Grenze umgehbar.
//   (3) ER ZÄHLT NUR `user`-ZEILEN und nur die letzten 24 Stunden.
//   (4) DIE ADMINROLLE IST AUSGENOMMEN, UND ZWAR OHNE ZÄHLUNG — die Antwort trägt keinen
//       Zählstand, es gibt also für eine Admin-Sitzung gar keinen Wert, den ein späterer Umbau
//       versehentlich auswerten könnte.
//   (5) EIN FREMDES PROJEKT IST NICHT UNTERSCHEIDBAR — `not_found`, keine Auskunft über das Budget
//       eines fremden Betriebs.
//   (6) DIE ORDNUNGSPFLICHT TRÄGT — ein Stand vor dem offenen wird abgewiesen UND hinterlässt
//       keinen Schreibvorgang; ein Stand danach schliesst die Vorgängerin exakt am Vortag
//       (nachgerechnet, nicht als Zeichenkette verglichen); derselbe Tag ersetzt in place.
//   (7) DIE RECHTEFLÄCHE IST EXAKT — kein Tabellen-Grant für irgendeine Client-Rolle, RLS aktiv ohne
//       Policy, EXECUTE ausschliesslich `authenticated`.
//
// ── JEDER NEUE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ──────────────────────────────────────────────
// Arbeitsregel 2: Introspektion beweist nur die Existenz einer Funktion, plpgsql prüft
// Funktionsrümpfe nicht beim Anlegen. Alle drei werden hier echt ausgeführt, die schreibenden auch
// auf ihren Abweisungspfaden.
//
// ── ARBEITSREGEL 5 ─────────────────────────────────────────────────────────────────────────────
// Fehlende Aufrufbarkeit wird mit `has_function_privilege` geprüft, nicht durch einen Aufruf. Die
// Ablehnung des eingeloggten NICHT-Admins wird dagegen ECHT aufgerufen — dort HAT der Aufrufer das
// Grant, und die Ablehnung IM Rumpf ist genau die zu beweisende Eigenschaft.
//
// ── ⚠ WIE AUFGERÄUMT WIRD (vitest fährt Testdateien PARALLEL gegen dieselbe Datenbank) ─────────
// ⚠ NACHGELESEN WIRD ALS EIGENTÜMER (`reset role`) IM SELBEN TRANSAKTIONSKONTEXT. Die Mindestfläche
// wirkt auch gegen den Test, der sie belegt: `authenticated` hat auf der Tabelle KEIN Grant (genau
// das ist die Zusage), ein Kontrollblick von dort scheiterte an 42501 statt an der geprüften
// Eigenschaft. Derselbe Befund und dieselbe Lösung wie in B21-2b.
//
// `platform.chat_rate_limit_settings` hat — wie `system_prompt_extensions` — nur EINE globale Kette
// und keinen Identitäts-Schlüssel; sie wird ausschliesslich von dieser Datei angefasst (gemessen).
// Alles, was die Kette VERÄNDERT, läuft deshalb in einer Transaktion mit `rollback` (der
// Advisory-Lock ist transaktions-gebunden, das trägt). Die ZÄHL-Tests fassen die Kette gar nicht an:
// sie lesen den geltenden Stand aus der Antwort und bauen ihren Zählstand daran auf — dadurch sind
// sie gegen einen geänderten Startwert immun und messen trotzdem die echte Kante.

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

/** Die drei public-Wrapper, die dieser Bauschritt neu anlegt. */
const WRAPPER_SIGNATURES = {
  admin_set_chat_rate_limit: 'public.admin_set_chat_rate_limit(integer, date)',
  admin_get_chat_rate_limit: 'public.admin_get_chat_rate_limit()',
  check_chat_rate_limit: 'public.check_chat_rate_limit(uuid)',
} as const

/** Die zwei, die bei fehlender Adminrolle WERFEN müssen — mit einem gültigen Beispielaufruf. */
const ADMIN_ONLY_CALLS: Array<[string, string]> = [
  ['admin_set_chat_rate_limit', 'public.admin_set_chat_rate_limit(5)'],
  ['admin_get_chat_rate_limit', 'public.admin_get_chat_rate_limit()'],
]

const createdUsers: string[] = []
const createdProjects: string[] = []
const createdAccounts: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  createdUsers.push(u.id)
  return u
}

async function newAdmin(): Promise<TestUser> {
  const u = await newUser()
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

async function callAs<T = Record<string, unknown>>(
  user: TestUser,
  fnCall: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ out: T }>(`select ${fnCall} as out`, params)
    return rows[0]!.out
  })
}

async function createProjectFor(user: TestUser, label = `B24 Bremse ${randomUUID()}`) {
  const out = await callAs<{ status: string; project_id: string; account_id: string }>(
    user,
    'public.create_my_project($1)',
    [label],
  )
  expect(out.status).toBe('ok')
  createdProjects.push(out.project_id)
  createdAccounts.push(out.account_id)
  return { projectId: out.project_id, accountId: out.account_id }
}

interface LimitAnswer {
  status: string
  reason?: string
  used?: number
  max?: number
}

/** Die Frage, die die Chat-Schleife vor ihrem ersten Modellaufruf stellt. */
async function check(user: TestUser, projectId: string): Promise<LimitAnswer> {
  return callAs<LimitAnswer>(user, 'public.check_chat_rate_limit($1)', [projectId])
}

/**
 * Legt `count` Zeilen der gewünschten Rolle an — privilegiert, weil der Wrapper
 * `append_project_message` je Aufruf genau eine Zeile schreibt und `created_at` selbst setzt (für
 * den 24-Stunden-Test muss der Zeitpunkt aber in der Vergangenheit liegen).
 */
async function seedMessages(
  projectId: string,
  count: number,
  opts: { role?: string; ageHours?: number } = {},
): Promise<void> {
  if (count <= 0) return
  await sql(
    `insert into platform.project_messages (project_id, role, content, created_at)
     select $1, $2, '[{"type":"text","text":"x"}]'::jsonb, now() - make_interval(hours => $4::int)
       from generate_series(1, $3)`,
    [projectId, opts.role ?? 'user', count, opts.ageHours ?? 0],
  )
}

beforeAll(assertStackReachable)

afterEach(async () => {
  if (createdProjects.length > 0) {
    await sql(`delete from platform.projects where id = any($1::uuid[])`, [createdProjects])
    createdProjects.length = 0
  }
  if (createdAccounts.length > 0) {
    await sql(`delete from platform.accounts where id = any($1::uuid[])`, [createdAccounts])
    createdAccounts.length = 0
  }
  for (const id of createdUsers.splice(0)) await deleteUser(id)
})

afterAll(async () => {
  await pool.end()
})

describe('B24 — Kostenbremse: der Zähler', () => {
  it('⚠ zählt WIRKLICH — an der Kante gemessen, gegen den tatsächlich geltenden Stand', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)

    const leer = await check(user, projectId)
    expect(leer.status).toBe('ok')
    expect(leer.used).toBe(0)
    // Der geltende Stand kommt aus der ANTWORT, nicht aus einer hier abgeschriebenen Zahl — sonst
    // prüfte der Test seine eigene Annahme und nicht die Datenbank.
    const max = leer.max!
    expect(max).toBeGreaterThan(0)

    await seedMessages(projectId, max - 1)
    const knappDrunter = await check(user, projectId)
    expect(knappDrunter.status).toBe('ok')
    expect(knappDrunter.used).toBe(max - 1)

    await seedMessages(projectId, 1)
    const anDerKante = await check(user, projectId)
    expect(anDerKante).toMatchObject({ status: 'limit_reached', used: max, max })
  })

  it('⚠ zählt über ALLE Projekte des Kontos — die letzte Nachricht liegt in einem ZWEITEN Projekt', async () => {
    const user = await newUser()
    const a = await createProjectFor(user)
    const b = await createProjectFor(user)
    expect(a.accountId).toBe(b.accountId)

    const max = (await check(user, a.projectId)).max!

    await seedMessages(a.projectId, max - 1)
    expect((await check(user, a.projectId)).status).toBe('ok')

    // Die eine fehlende Nachricht in das ANDERE Projekt desselben Kontos. Ohne den Join über
    // `platform.projects` bliebe die Antwort `ok` — und die Grenze wäre mit einem zweiten Projekt
    // beliebig oft umgehbar.
    await seedMessages(b.projectId, 1)
    expect(await check(user, a.projectId)).toMatchObject({ status: 'limit_reached', used: max })
    // …und zwar aus BEIDEN Richtungen, nicht nur beim zuerst gefragten Projekt.
    expect((await check(user, b.projectId)).status).toBe('limit_reached')
  })

  it('das Konto eines ANDEREN zählt nicht mit', async () => {
    const eigner = await newUser()
    const fremder = await newUser()
    const meins = await createProjectFor(eigner)
    const seins = await createProjectFor(fremder)

    const max = (await check(eigner, meins.projectId)).max!
    await seedMessages(seins.projectId, max + 5)

    expect(await check(eigner, meins.projectId)).toMatchObject({ status: 'ok', used: 0 })
  })

  it('⚠ zählt NUR `user`-Zeilen — `assistant`/`tool_call`/`tool_result` entstehen als Folge eines Turns', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const max = (await check(user, projectId)).max!

    for (const role of ['assistant', 'tool_call', 'tool_result']) {
      await seedMessages(projectId, max, { role })
    }

    expect(await check(user, projectId)).toMatchObject({ status: 'ok', used: 0 })
  })

  it('⚠ zählt nur die letzten 24 Stunden — eine Stunde älter, und sie zählt nicht mehr', async () => {
    const user = await newUser()
    const { projectId } = await createProjectFor(user)
    const max = (await check(user, projectId)).max!

    await seedMessages(projectId, max, { ageHours: 25 })
    expect(await check(user, projectId)).toMatchObject({ status: 'ok', used: 0 })

    // Die Grenze selbst gehört noch dazu: 23 Stunden alt zählt.
    await seedMessages(projectId, max, { ageHours: 23 })
    expect(await check(user, projectId)).toMatchObject({ status: 'limit_reached', used: max })
  })
})

describe('B24 — Kostenbremse: Zugriff', () => {
  it('⚠ die Adminrolle ist ausgenommen — und es wird dabei GAR NICHT gezählt', async () => {
    const admin = await newAdmin()
    const { projectId } = await createProjectFor(admin)
    await seedMessages(projectId, 500)

    const out = await check(admin, projectId)
    expect(out.status).toBe('ok')
    expect(out.reason).toBe('admin')
    // Kein Zählstand in der Antwort: für eine Admin-Sitzung existiert gar kein Wert, den ein
    // späterer Umbau versehentlich als Budget auswerten könnte.
    expect(out.used).toBeUndefined()
    expect(out.max).toBeUndefined()
  })

  it('ein FREMDES Projekt liefert not_found — keine Auskunft über ein fremdes Budget', async () => {
    const eigner = await newUser()
    const fremder = await newUser()
    const { projectId } = await createProjectFor(eigner)
    await seedMessages(projectId, 500)

    expect(await check(fremder, projectId)).toEqual({ status: 'not_found' })
  })

  it('ein Projekt, das es nicht gibt, ist davon nicht unterscheidbar', async () => {
    const user = await newUser()
    expect(await check(user, randomUUID())).toEqual({ status: 'not_found' })
  })

  it('⚠ ein eingeloggter NICHT-Admin scheitert an beiden admin_*-Wrappern mit 42501', async () => {
    const user = await newUser()
    for (const [name, call] of ADMIN_ONLY_CALLS) {
      await expect(
        runAs({ role: 'authenticated', userId: user.id }, async (c) => c.query(`select ${call}`)),
        `${name} muss werfen`,
      ).rejects.toMatchObject({ code: '42501' })
    }
  })

  it('…und hinterlässt dabei keinen Schreibvorgang', async () => {
    const user = await newUser()
    const [vorher] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.chat_rate_limit_settings`,
    )
    await runAs({ role: 'authenticated', userId: user.id }, async (c) => {
      await c.query(`select public.admin_set_chat_rate_limit(7)`).catch(() => undefined)
    })
    const [nachher] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.chat_rate_limit_settings`,
    )
    expect(nachher!.n).toBe(vorher!.n)
  })
})

describe('B24 — Kostenbremse: Pflege der Kette', () => {
  it('admin_get liefert den offenen Stand', async () => {
    const admin = await newAdmin()
    const out = await callAs<{ status: string; setting?: Record<string, unknown> }>(
      admin,
      'public.admin_get_chat_rate_limit()',
    )
    expect(out.status).toBe('ok')
    expect(typeof out.setting!.max_messages_per_account_per_day).toBe('number')
    expect(out.setting!.valid_until).toBeNull()
  })

  it('⚠ ein Stand VOR dem offenen wird abgewiesen und schreibt nichts (Ordnungspflicht)', async () => {
    const admin = await newAdmin()
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      const { rows } = await c.query<{ out: { status: string; open_valid_from: string } }>(
        `select public.admin_set_chat_rate_limit(9, current_date - 30) as out`,
      )
      expect(rows[0]!.out.status).toBe('invalid_valid_from')
      expect(rows[0]!.out.open_valid_from).toBeTruthy()

      await c.query('reset role')
      const { rows: n } = await c.query<{ n: number }>(
        `select count(*)::int as n from platform.chat_rate_limit_settings
          where max_messages_per_account_per_day = 9`,
      )
      expect(n[0]!.n).toBe(0)
    })
  })

  it('⚠ ein Stand DANACH schliesst die Vorgängerin exakt am Vortag — nachgerechnet, nicht abgelesen', async () => {
    const admin = await newAdmin()
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      const { rows } = await c.query<{ out: { status: string; closed_count: number } }>(
        `select public.admin_set_chat_rate_limit(42, current_date + 10) as out`,
      )
      expect(rows[0]!.out.status).toBe('created')
      expect(rows[0]!.out.closed_count).toBe(1)

      // Der Abstand zwischen dem Ende der Vorgängerin und dem Beginn des neuen Stands muss GENAU
      // ein Tag sein — weniger wäre eine Überschneidung, mehr eine Lücke. Als Zeichenkette
      // verglichen bliebe der Test auch dann grün, wenn dort ein festes Datum stünde.
      await c.query('reset role')
      const { rows: kette } = await c.query<{ luecke: number }>(
        `select (neu.valid_from - alt.valid_until) as luecke
           from platform.chat_rate_limit_settings neu
           join platform.chat_rate_limit_settings alt on alt.valid_until is not null
          where neu.valid_until is null`,
      )
      expect(kette).toHaveLength(1)
      expect(kette[0]!.luecke).toBe(1)
    })
  })

  it('⚠ derselbe Tag ERSETZT in place — es gibt hier keinen Löschweg, das ist die einzige Korrektur', async () => {
    const admin = await newAdmin()
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      const { rows: erst } = await c.query<{ out: { status: string; id: string } }>(
        `select public.admin_set_chat_rate_limit(11, current_date + 3) as out`,
      )
      expect(erst[0]!.out.status).toBe('created')

      const { rows: zweit } = await c.query<{ out: { status: string; id: string; max: number } }>(
        `select public.admin_set_chat_rate_limit(12, current_date + 3) as out`,
      )
      expect(zweit[0]!.out.status).toBe('replaced')
      expect(zweit[0]!.out.id).toBe(erst[0]!.out.id)
      expect(zweit[0]!.out.max).toBe(12)

      await c.query('reset role')
      const { rows: n } = await c.query<{ n: number }>(
        `select count(*)::int as n from platform.chat_rate_limit_settings where valid_from = current_date + 3`,
      )
      expect(n[0]!.n).toBe(1)
    })
  })

  it('⚠ ein Wert < 1 wird abgewiesen — eine 0 wäre ein Not-Aus und kein Limit', async () => {
    const admin = await newAdmin()
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      for (const wert of [0, -5]) {
        const { rows } = await c.query<{ out: { status: string } }>(
          `select public.admin_set_chat_rate_limit($1) as out`,
          [wert],
        )
        expect(rows[0]!.out.status, `Wert ${wert}`).toBe('invalid_max')
      }
      // Und die Grenze steht zusätzlich im Schema, nicht nur im Rumpf. Der direkte INSERT braucht
      // dafür den Eigentümer — als `authenticated` scheiterte er am fehlenden Tabellen-Grant (42501)
      // und bewiese über den CHECK gar nichts.
      await c.query('reset role')
      await expect(
        c.query(
          `insert into platform.chat_rate_limit_settings (max_messages_per_account_per_day, valid_from)
           values (0, current_date + 99)`,
        ),
      ).rejects.toMatchObject({ code: '23514' })
    })
  })

  it('⚠ ein neu gesetzter Stand wirkt sofort auf die Zählung', async () => {
    const admin = await newAdmin()
    const kunde = await newUser()
    const { projectId } = await createProjectFor(kunde)
    await seedMessages(projectId, 3)

    // Vorher: drei Nachrichten liegen deutlich unter dem Startwert.
    expect((await check(kunde, projectId)).status).toBe('ok')

    // In DERSELBEN Transaktion das Limit auf 2 senken und erneut fragen — danach rollback, damit
    // die globale Kette unangetastet bleibt.
    await runAs({ role: 'authenticated', userId: admin.id }, async (c) => {
      const { rows: gesetzt } = await c.query<{ out: { status: string } }>(
        `select public.admin_set_chat_rate_limit(2) as out`,
      )
      expect(['created', 'replaced']).toContain(gesetzt[0]!.out.status)

      // Der Kunde fragt in derselben Transaktion — dafür die Claims wechseln.
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: kunde.id, role: 'authenticated', aud: 'authenticated' }),
      ])
      const { rows } = await c.query<{ out: LimitAnswer }>(
        `select public.check_chat_rate_limit($1) as out`,
        [projectId],
      )
      expect(rows[0]!.out).toMatchObject({ status: 'limit_reached', used: 3, max: 2 })
    })

    // Nach dem rollback gilt wieder der Startwert.
    expect((await check(kunde, projectId)).status).toBe('ok')
  })
})

describe('B24 — Kostenbremse: Rechtefläche', () => {
  it('die drei Wrapper existieren genau einmal und sind SECURITY DEFINER', async () => {
    for (const [name, signature] of Object.entries(WRAPPER_SIGNATURES)) {
      const rows = await sql<{ n: number; secdef: boolean }>(
        `select count(*)::int as n, bool_and(p.prosecdef) as secdef
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`,
        [name],
      )
      expect(rows[0]!.n, `${signature} genau einmal`).toBe(1)
      expect(rows[0]!.secdef, `${signature} security definer`).toBe(true)
    }
  })

  it('⚠ EXECUTE ausschliesslich für authenticated (anon und service_role dürfen nicht)', async () => {
    for (const signature of Object.values(WRAPPER_SIGNATURES)) {
      const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as svc`,
        [signature],
      )
      expect(row, signature).toEqual({ anon: false, auth: true, svc: false })
    }
  })

  it('⚠ die Tabelle hat RLS, keine Policy und für KEINE Client-Rolle ein Tabellenrecht', async () => {
    const [rls] = await sql<{ on: boolean }>(
      `select relrowsecurity as on from pg_class where oid = 'platform.chat_rate_limit_settings'::regclass`,
    )
    expect(rls!.on).toBe(true)

    const [policies] = await sql<{ n: number }>(
      `select count(*)::int as n from pg_policies
        where schemaname = 'platform' and tablename = 'chat_rate_limit_settings'`,
    )
    expect(policies!.n).toBe(0)

    const grants = await sql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'chat_rate_limit_settings'
          and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')`,
    )
    expect(grants).toEqual([])
  })

  it('genau EIN offener Stand — die Invariante, die der Constraint nicht ausdrücken kann', async () => {
    const [row] = await sql<{ n: number }>(
      `select count(*)::int as n from platform.chat_rate_limit_settings where valid_until is null`,
    )
    expect(row!.n).toBe(1)
  })
})
