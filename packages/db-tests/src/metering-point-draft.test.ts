// DB-Gate für den Entwurf AM ZÄHLPUNKT (B24, Teil 1; Migration 20260911150000). Fachlich
// `Pflichtenheft_Kalkulator_Delta_KI-Interface.md` §2.3/§3.1/§3.2.
//
// ── WORUM ES GEHT ──────────────────────────────────────────────────────────────────────────────
// Der Entwurf lag bisher als EINE Spalte am Projekt. Gegen ihn geprüft wird `tariffParamsSchema`,
// und das besteht zu hundert Prozent aus Tarif- und Vertragsangaben — Arbeitspreis, Leistungspreis,
// Messvariante, Zeitfenster. Jede davon ist eine Eigenschaft des ZÄHLPUNKTS: ein Vertrag wird je
// Zählpunkt geschlossen, ein Netzentgelt je Zählpunkt verrechnet. Am Projekt abgelegt trüge ein
// Betrieb mit zwei Anschlüssen den Arbeitspreis des einen auch am anderen.
//
// ── WAS HIER SCHIEFGEHEN KANN, OHNE DASS ES AUFFÄLLT ───────────────────────────────────────────
//
//   * ZWEI ZÄHLPUNKTE TEILEN SICH EINEN ENTWURF. Der teuerste denkbare Fehler dieses Schritts und
//     der Grund für den Umzug: der zweite Schreibvorgang überschriebe den ersten, ohne dass
//     irgendetwas fehlschlägt, und der Report zeigte für beide Anschlüsse denselben Tarif. Geprüft
//     wird deshalb mit ZWEI Zählpunkten und DEMSELBEN Feldnamen, in BEIDE Richtungen.
//
//   * `list_metering_points` VERSCHWEIGT DIE NEUE SPALTE. Die Funktion baut ihre Antwort aus einer
//     AUSGESCHRIEBENEN Spaltenliste, nicht aus `to_jsonb(mp)` — eine neue Spalte erscheint darin
//     NICHT von selbst. Fehlte sie, läse der Chat dauerhaft `{}` und überschriebe bei jedem
//     Schreibvorgang den ganzen Entwurf mit genau einem Feld. Ein stiller Datenverlust ohne Fehler,
//     ohne Status, ohne Ausnahme.
//
//   * DER WRAPPER VERSCHMILZT STATT ZU ERSETZEN. Eine flache Verschmelzung könnte einen Schlüssel
//     nie wieder ENTFERNEN — und genau das löst eine Korrektur im Gespräch aus („doch keine
//     Leistungsmessung"). Geprüft wird, dass ein Schlüssel wieder VERSCHWINDET.
//
//   * DIE ZUGRIFFSPRÜFUNG GREIFT AM FALSCHEN GEGENSTAND. `platform.project_accessible` kennt nur
//     Projekte; der Zählpunkt muss zuerst auf sein Projekt aufgelöst werden. Ohne das schriebe ein
//     Fremder in den Zählpunkt eines anderen Kunden — ein echtes Leck über Kundengrenzen.
//
//   * DIE ALTE SPALTE WIRD WIEDER ANGELEGT. `platform.projects.draft` ist mit der Migration
//     20260911160000 gefallen. Käme sie zurück und schriebe irgendetwas hinein, gäbe es zwei
//     Entwürfe nebeneinander, und welcher gilt, entschiede der Aufrufweg.
//
// ── WIE AUFGERÄUMT WIRD ────────────────────────────────────────────────────────────────────────
// vitest fährt Testdateien parallel gegen dieselbe Datenbank. Jede Assertion filtert auf die
// eigenen Zeilen; gelöscht werden am Ende ausschliesslich die eigenen Projekte, Accounts und
// Konten. Die Zählpunkte gehen über die Kaskade des Projekts mit.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assertStackReachable, createUser, deleteUser, runAs, sql, type TestUser } from './client'

const createdUsers: string[] = []
const createdProjects: string[] = []
const createdAccounts: string[] = []

async function newUser(): Promise<TestUser> {
  const u = await createUser()
  createdUsers.push(u.id)
  return u
}

async function makeAdmin(user: TestUser): Promise<void> {
  await sql(
    `insert into platform.user_roles (user_id, role) values ($1, 'admin')
       on conflict (user_id, role) do nothing`,
    [user.id],
  )
}

/** Ruft einen Wrapper als eingeloggtes Konto auf und persistiert (commit). */
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

/** Wie oben, aber ohne commit — für reine Lese-Assertions. */
async function readAs<T = Record<string, unknown>>(
  user: TestUser,
  fnCall: string,
  params: unknown[] = [],
): Promise<T> {
  return runAs({ role: 'authenticated', userId: user.id }, async (c) => {
    const { rows } = await c.query<{ out: T }>(`select ${fnCall} as out`, params)
    return rows[0]!.out
  })
}

async function createProjectFor(user: TestUser, label: string): Promise<string> {
  const out = await callAs<{ status: string; project_id: string; account_id: string }>(
    user,
    'public.create_my_project($1)',
    [label],
  )
  expect(out.status).toBe('ok')
  createdProjects.push(out.project_id)
  createdAccounts.push(out.account_id)
  return out.project_id
}

/**
 * Legt `count` Zählpunkte an und gibt ihre Kennungen zurück, ÄLTESTE ZUERST.
 *
 * Zählpunkte entstehen ausschliesslich durch einen Admin (`admin_set_metering_point_count`) — es
 * gibt bewusst keinen Kundenweg, weil die Struktur eines Betriebs eine fachliche Frage ist.
 */
async function meteringPointsFor(
  admin: TestUser,
  projectId: string,
  count: number,
): Promise<string[]> {
  const out = await callAs<{ status: string }>(
    admin,
    'public.admin_set_metering_point_count($1, $2)',
    [projectId, count],
  )
  expect(out.status).toBe('ok')

  const rows = await sql<{ id: string }>(
    `select id from platform.metering_points
      where project_id = $1 order by created_at, id`,
    [projectId],
  )
  expect(rows).toHaveLength(count)
  return rows.map((row) => row.id)
}

async function draftOf(meteringPointId: string): Promise<Record<string, unknown>> {
  const [row] = await sql<{ draft: Record<string, unknown> }>(
    `select draft from platform.metering_points where id = $1`,
    [meteringPointId],
  )
  return row!.draft
}

beforeAll(assertStackReachable)

afterAll(async () => {
  if (createdProjects.length > 0) {
    await sql(`delete from platform.projects where id = any($1::uuid[])`, [createdProjects])
  }
  if (createdAccounts.length > 0) {
    await sql(`delete from platform.accounts where id = any($1::uuid[])`, [createdAccounts])
  }
  for (const id of createdUsers) await deleteUser(id)
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Zählpunkt-Entwurf — Spalte, Signatur, Rechtefläche', () => {
  it('die Spalte ist not null mit Objekt-Default und trägt den CHECK', async () => {
    const [col] = await sql<{ is_nullable: string; column_default: string; data_type: string }>(
      `select is_nullable, column_default, data_type
         from information_schema.columns
        where table_schema = 'platform' and table_name = 'metering_points'
          and column_name = 'draft'`,
    )
    expect(col).toMatchObject({ is_nullable: 'NO', data_type: 'jsonb' })
    expect(col!.column_default).toContain("'{}'")

    /*
     * ⚠ Der CHECK ist nicht Dekoration: ein jsonb-ARRAY liefe durch jede Schreiboperation und
     * bräche erst den LESER — `Object.entries` auf ein Array ergibt Indizes als Feldnamen, und der
     * Entwurf trüge danach Felder namens „0" und „1".
     */
    const [chk] = await sql<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def
         from pg_constraint c
        where c.conname = 'metering_points_draft_is_object'`,
    )
    expect(chk!.def).toContain("jsonb_typeof(draft) = 'object'")
  })

  it('⚠ GENAU EINE Überladung von update_metering_point_draft', async () => {
    const rows = await sql<{ args: string; names: string[] }>(
      `select pg_get_function_identity_arguments(p.oid) as args, p.proargnames as names
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'update_metering_point_draft'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.args).toBe('p_metering_point_id uuid, p_draft jsonb')
    expect(rows[0]!.names).toEqual(['p_metering_point_id', 'p_draft'])
  })

  it('authenticated ja, anon und service_role nein', async () => {
    // Arbeitsregel 5: has_function_privilege statt eines Aufrufs als Rolle ohne Grant.
    const [row] = await sql<{ anon: boolean; auth: boolean; svc: boolean }>(
      `select has_function_privilege('anon',          $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as auth,
              has_function_privilege('service_role',  $1, 'execute') as svc`,
      ['public.update_metering_point_draft(uuid, jsonb)'],
    )
    expect(row).toEqual({ anon: false, auth: true, svc: false })
  })

  it('platform.metering_points hat weiterhin für KEINE Client-Rolle ein Tabellenrecht', async () => {
    const rows = await sql(
      `select 1 from information_schema.role_table_grants
        where table_schema = 'platform' and table_name = 'metering_points'
          and grantee in ('anon', 'authenticated', 'service_role')`,
    )
    expect(rows).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Zählpunkt-Entwurf — schreiben und lesen', () => {
  it('⚠ list_metering_points LIEFERT den Entwurf mit — sonst läse der Chat dauerhaft {}', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, 'B24 Entwurf sichtbar')
    const [mp] = await meteringPointsFor(admin, projectId, 1)

    await callAs(kunde, 'public.update_metering_point_draft($1, $2)', [
      mp,
      JSON.stringify({ energyPriceCtPerKwh: 24.4 }),
    ])

    const out = await readAs<{
      status: string
      metering_points: { id: string; draft: Record<string, unknown> }[]
    }>(kunde, 'public.list_metering_points($1)', [projectId])

    expect(out.status).toBe('ok')
    expect(out.metering_points[0]!.draft).toEqual({ energyPriceCtPerKwh: 24.4 })
  })

  it('ERSETZT den Entwurf, statt ihn zu verschmelzen', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, 'B24 Entwurf ersetzen')
    const [mp] = await meteringPointsFor(admin, projectId, 1)

    await callAs(kunde, 'public.update_metering_point_draft($1, $2)', [
      mp,
      JSON.stringify({ energyPriceCtPerKwh: 25, meteringVariant: 'mit_leistungsmessung' }),
    ])
    expect(await draftOf(mp!)).toEqual({
      energyPriceCtPerKwh: 25,
      meteringVariant: 'mit_leistungsmessung',
    })

    // Der eigentliche Nachweis: ein Schlüssel VERSCHWINDET wieder. Eine flache Verschmelzung könnte
    // das nicht — und genau diese Bewegung löst eine Korrektur im Gespräch aus.
    await callAs(kunde, 'public.update_metering_point_draft($1, $2)', [
      mp,
      JSON.stringify({ energyPriceCtPerKwh: 30 }),
    ])
    expect(await draftOf(mp!)).toEqual({ energyPriceCtPerKwh: 30 })
  })

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ DER TEST, FÜR DEN DIESE MIGRATION GEMACHT IST
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Zwei Zählpunkte, DASSELBE Feld, zwei verschiedene Werte — der Betrieb mit zwei Anschlüssen und
   * zwei Verträgen. Beide Richtungen werden geprüft: nur die eine Hälfte bliebe auch dann grün,
   * wenn sich beide Zeilen denselben Entwurf teilten.
   */
  it('⚠ zwei Zählpunkte tragen dasselbe Feld mit verschiedenen Werten — kein Überschreiben', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, 'B24 zwei Zählpunkte')
    const [mpA, mpB] = await meteringPointsFor(admin, projectId, 2)

    await callAs(kunde, 'public.update_metering_point_draft($1, $2)', [
      mpA,
      JSON.stringify({ energyPriceCtPerKwh: 24.4 }),
    ])
    await callAs(kunde, 'public.update_metering_point_draft($1, $2)', [
      mpB,
      JSON.stringify({ energyPriceCtPerKwh: 31.9 }),
    ])

    expect(await draftOf(mpA!)).toEqual({ energyPriceCtPerKwh: 24.4 })
    expect(await draftOf(mpB!)).toEqual({ energyPriceCtPerKwh: 31.9 })

    // Und über den Leseweg ebenso — sonst wäre der Bestand richtig und die Antwort falsch.
    const out = await readAs<{
      metering_points: { id: string; draft: Record<string, unknown> }[]
    }>(kunde, 'public.list_metering_points($1)', [projectId])
    expect(out.metering_points.map((row) => row.draft)).toEqual([
      { energyPriceCtPerKwh: 24.4 },
      { energyPriceCtPerKwh: 31.9 },
    ])
  })

  it('ein ungültiger Entwurf wird als STATUS abgewiesen und schreibt nichts', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, 'B24 Entwurf ungültig')
    const [mp] = await meteringPointsFor(admin, projectId, 1)

    // Ein roher 23514 aus dem CHECK trüge keinen Feldbezug, den eine Oberfläche anzeigen könnte.
    expect(
      await readAs(kunde, 'public.update_metering_point_draft($1, $2)', [
        mp,
        JSON.stringify([1, 2]),
      ]),
    ).toEqual({ status: 'invalid_draft' })
    expect(
      await readAs(kunde, 'public.update_metering_point_draft($1, $2)', [mp, null]),
    ).toEqual({ status: 'invalid_draft' })

    expect(await draftOf(mp!)).toEqual({})
  })
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('B24 Zählpunkt-Entwurf — die Grenzen', () => {
  it('⚠ ein FREMDER Zählpunkt liefert not_found und bleibt unangetastet', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const owner = await newUser()
    const stranger = await newUser()
    const projectId = await createProjectFor(owner, 'B24 nur für den Eigentümer')
    const [mp] = await meteringPointsFor(admin, projectId, 1)

    await callAs(owner, 'public.update_metering_point_draft($1, $2)', [
      mp,
      JSON.stringify({ energyPriceCtPerKwh: 24.4 }),
    ])

    /*
     * ⚠ DIE ZUGRIFFSPRÜFUNG GEHT ÜBER DAS PROJEKT DES ZÄHLPUNKTS. Ohne sie schriebe ein Fremder in
     * den Zählpunkt eines anderen Kunden — ein echtes Leck über Kundengrenzen, und zwar eines, das
     * nur der Kunde bemerkte, dessen Tarif sich plötzlich geändert hat.
     */
    expect(
      await readAs(stranger, 'public.update_metering_point_draft($1, $2)', [
        mp,
        JSON.stringify({ energyPriceCtPerKwh: 99 }),
      ]),
    ).toEqual({ status: 'not_found' })

    expect(await draftOf(mp!)).toEqual({ energyPriceCtPerKwh: 24.4 })
  })

  it('eine unbekannte Kennung liefert denselben Status wie ein fremder Zählpunkt', async () => {
    const kunde = await newUser()
    // Zufällig, also mit an Sicherheit grenzender Wahrscheinlichkeit nicht vorhanden. „Gibt es
    // nicht" und „gehört jemand anderem" sind bewusst nicht unterscheidbar.
    expect(
      await readAs(kunde, 'public.update_metering_point_draft($1, $2)', [
        '00000000-0000-4000-8000-000000000000',
        '{}',
      ]),
    ).toEqual({ status: 'not_found' })
  })

  /*
   * ⚠ DIE ALTE SPALTE IST WEG, UND SIE SOLL WEG BLEIBEN. Bis zur Migration 20260911160000 stand
   * `platform.projects.draft` eingefroren daneben, und dieser Test mass, dass der neue Weg nicht
   * dorthin schreibt. Seit dem Drop ist das strukturell wahr; gemessen wird deshalb, dass es die
   * Spalte wirklich nicht mehr gibt — käme sie zurück, gäbe es wieder zwei Entwürfe nebeneinander,
   * und welcher gilt, entschiede der Aufrufweg.
   *
   * Der Test steht hier UND in `project-chat-state.test.ts` (dort von der Wrapper-Seite aus). Das
   * ist kein Duplikat: die eine Datei misst, dass der ZÄHLPUNKT-Weg nicht zurückschreibt, die
   * andere, dass der PROJEKT-Weg es nicht tut.
   */
  it('⚠ platform.projects.draft existiert nicht mehr — der Zählpunkt-Entwurf steht am Zählpunkt', async () => {
    const admin = await newUser()
    await makeAdmin(admin)
    const kunde = await newUser()
    const projectId = await createProjectFor(kunde, 'B24 alte Spalte gedroppt')
    const [mp] = await meteringPointsFor(admin, projectId, 1)

    await callAs(kunde, 'public.update_metering_point_draft($1, $2)', [
      mp,
      JSON.stringify({ energyPriceCtPerKwh: 24.4 }),
    ])

    const cols = await sql<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'platform' and table_name = 'projects' and column_name = 'draft'`,
    )
    expect(cols).toEqual([])

    const [row] = await sql<{ draft: Record<string, unknown> }>(
      `select draft from platform.metering_points where id = $1`,
      [mp],
    )
    expect(row!.draft).toEqual({ energyPriceCtPerKwh: 24.4 })
  })
})
