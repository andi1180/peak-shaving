// DB-Gate für den öffentlichen Rand der Partner-Attribution
// (Migration 20260725090000_create_partner_landing_source.sql, B16-2).
//
// B16-1 hat Stammdaten, Zuordnung, Trigger und die vier ADMIN-Wrapper angelegt und im Gate
// abgesichert (`partner-attribution.test.ts`). B16-2 fügt genau zwei Dinge hinzu: eine HERKUNFT für
// Leads von der Landingpage, und den EINEN Lesezugriff, den die öffentliche Seite braucht.
//
// ── WORAN DIESER SCHRITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ────────────────────────
// (1) DATENSPARSAMKEIT. Die Landingpage ist eine Server Component; was sie liest, kann im
//     ausgelieferten HTML bzw. im Flight-Payload landen, auch wenn niemand es rendert.
//     `platform.partners` trägt die ANSPRECHPERSON des Fachbetriebs — der Name einer realen Person.
//     Der Wrapper darf sie deshalb gar nicht erst herausgeben. Das ist die Invariante, die eine
//     Auswahlliste im TypeScript-Leser NICHT garantieren kann: sie nimmt der nächste Umbau
//     versehentlich zurück. Deshalb steht sie in der Datenbank — und wird hier auf den SCHLÜSSELN
//     der Rückgabe gemessen, nicht auf dem, was die Oberfläche zufällig anzeigt.
// (2) EIN STILLGELEGTER PARTNER IST NICHT AUFFINDBAR. `is_active = false` ist die Ansage, dass die
//     Links dieses Betriebs nicht mehr wirken sollen. Findet der Wrapper ihn trotzdem, bliebe seine
//     Landingpage erreichbar, obwohl jemand die Zusammenarbeit ausdrücklich beendet hat — und die
//     Antwort verriete zusätzlich die Existenz einer beendeten Geschäftsbeziehung an jeden, der
//     Slugs durchprobiert.
// (3) DIE RECHTEFLÄCHE. `anon` hat in `platform` bis heute NIRGENDS ein Recht. Ein versehentlicher
//     anon-Grant machte diesen Wrapper zum Verzeichnisdienst über alle aktiven Fachbetriebe.
// (4) DER WRAPPER WIRD TATSÄCHLICH AUFGERUFEN (Arbeitsregel 2): Introspektion beweist Existenz,
//     nicht Lauffähigkeit — plpgsql prüft Funktionsrümpfe nicht beim Anlegen.
// (5) DIE HERKUNFT MUSS EXISTIEREN, BEVOR SIE GEBRAUCHT WIRD. `leads.first_source_key` ist ein
//     Fremdschlüssel; fehlt die Zeile, könnte die Landingpage gar keinen Lead anlegen — und der
//     Fehler fiele erst beim ersten echten Aufruf auf, also im Betrieb, nicht im CI.

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

/** Bindestriche, keine Unterstriche — der CHECK auf `platform.partners.slug` verlangt es. */
function newSlug(prefix = 'landing'): string {
  return `${prefix}-${randomUUID()}`
}

async function newAdmin(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

/** Legt einen Partner über den ECHTEN Admin-Wrapper an (nicht per direktem INSERT). */
async function createPartner(
  admin: TestUser,
  slug: string,
  displayName = 'Elektro Musterbetrieb',
  contact: { first: string; last: string } = { first: 'Maximilian', last: 'Musterhuber' },
): Promise<void> {
  const res = await runAs({ role: 'authenticated', userId: admin.id, commit: true }, async (c) => {
    const { rows } = await c.query<{ r: { status: string } }>(
      `select public.admin_create_partner(
         p_slug => $1, p_display_name => $2,
         p_contact_first_name => $3, p_contact_last_name => $4
       ) as r`,
      [slug, displayName, contact.first, contact.last],
    )
    return rows[0]!.r
  })
  expect(res.status, `Partner ${slug} anlegen`).toBe('created')
  spawnedPartners.push(slug)
}

/** Der Aufruf, den die Landingpage macht: service_role, wie `lib/leads/store.ts`. */
async function getActivePartner(slug: unknown): Promise<Record<string, unknown>> {
  return runAs({ role: 'service_role', commit: false }, async (c) => {
    const { rows } = await c.query<{ r: Record<string, unknown> }>(
      `select public.get_active_partner($1) as r`,
      [slug],
    )
    return rows[0]!.r
  })
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

// ── (1) Datensparsamkeit ─────────────────────────────────────────────────────────────────────────
describe('(1) get_active_partner: was nach aussen gelangt', () => {
  it('DER KERNFALL: die Rückgabe trägt AUSSCHLIESSLICH status, slug und display_name', async () => {
    /*
     * Gemessen wird auf den SCHLÜSSELN, nicht auf einem Feld, das man erwartet hätte: Eine
     * zusätzliche Spalte im Wrapper wäre sonst unsichtbar, solange die Oberfläche sie nicht
     * anzeigt — und genau das ist der Fehler, den diese Prüfung fangen soll. Was hier steht, steht
     * potenziell im ausgelieferten HTML einer öffentlichen Seite.
     */
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug, 'Raymann Elektrotechnik GmbH', {
      first: 'Isolde',
      last: 'Geheimhalt',
    })

    const res = await getActivePartner(slug)

    expect(Object.keys(res).sort()).toEqual(['display_name', 'slug', 'status'])
    expect(res.status).toBe('ok')
    expect(res.slug).toBe(slug)
    expect(res.display_name).toBe('Raymann Elektrotechnik GmbH')
  })

  it('die Ansprechperson erscheint NIRGENDS in der Antwort — auch nicht als Wert', async () => {
    /*
     * Die Gegenprobe zum Schlüssel-Test: Ein Name könnte auch unter einem harmlosen Schlüssel
     * mitfahren (etwa in einem zusammengesetzten `label`). Geprüft wird deshalb der VOLLSTÄNDIGE
     * serialisierte Rückgabewert.
     */
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug, 'Elektro Musterbetrieb', {
      first: 'Kunigunde',
      last: 'Sonderzeichenlos',
    })

    const raw = JSON.stringify(await getActivePartner(slug))

    expect(raw).not.toContain('Kunigunde')
    expect(raw).not.toContain('Sonderzeichenlos')
    // Und ebenso wenig die internen Angaben, die die Seite nichts angehen.
    expect(raw).not.toContain('is_active')
    expect(raw).not.toContain('created_at')
  })
})

// ── (2) Auffindbarkeit ───────────────────────────────────────────────────────────────────────────
describe('(2) get_active_partner: wer gefunden wird', () => {
  it('EIN STILLGELEGTER PARTNER IST NICHT AUFFINDBAR — dieselbe Antwort wie bei einem erfundenen Slug', async () => {
    /*
     * Die Wirkung, an der `is_active` für den öffentlichen Rand hängt. Ohne sie bliebe die
     * Landingpage eines beendeten Fachbetriebs erreichbar, während `capture_lead` seine Leads
     * bereits nicht mehr zuordnet — die Seite funktionierte, die Attribution liefe ins Leere, und
     * niemand bemerkte es.
     *
     * „Nicht auffindbar" heisst hier ausdrücklich UNUNTERSCHEIDBAR von unbekannt: ein eigener
     * Status verriete die Existenz einer beendeten Geschäftsbeziehung an jeden, der Slugs
     * durchprobiert.
     */
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    expect((await getActivePartner(slug)).status).toBe('ok')

    await runAs({ role: 'authenticated', userId: admin.id, commit: true }, async (c) => {
      await c.query(`select public.admin_set_partner_active($1, false)`, [slug])
    })

    const stillgelegt = await getActivePartner(slug)
    const erfunden = await getActivePartner(newSlug('gibtsnicht'))

    expect(stillgelegt).toEqual({ status: 'not_found' })
    expect(stillgelegt).toEqual(erfunden)
  })

  it('reaktiviert wird er wieder gefunden — die Stilllegung ist umkehrbar', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    await runAs({ role: 'authenticated', userId: admin.id, commit: true }, async (c) => {
      await c.query(`select public.admin_set_partner_active($1, false)`, [slug])
      await c.query(`select public.admin_set_partner_active($1, true)`, [slug])
    })

    expect((await getActivePartner(slug)).status).toBe('ok')
  })

  it('Grossschreibung trifft — der Slug wird kleingeschrieben VERGLICHEN', async () => {
    /*
     * Der CHECK garantiert, dass jeder GESPEICHERTE Slug kleingeschrieben ist. Das Kleinschreiben
     * der Anfrage kann deshalb nur einen Nicht-Treffer in den richtigen Treffer verwandeln, niemals
     * in einen falschen. Dieselbe Nachsicht wie in `public.capture_lead` (B16-1) — die beiden
     * Funktionen sollen denselben Slug gleich behandeln.
     *
     * DIE ROUTE IST TROTZDEM STRENG: `/partner/RAYMANN` antwortet mit 404, nicht mit der Seite
     * (`lib/leads/partner.ts`). Der Unterschied ist beabsichtigt und liegt an der Rolle des Slugs:
     * hier ist er ein VERGLEICHSWERT, dort eine ADRESSE — und von einer Adresse soll es genau eine
     * Form geben. Die Nachsicht der Datenbank ist die zweite Verteidigungslinie, nicht die erste.
     */
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    expect((await getActivePartner(slug.toUpperCase())).status).toBe('ok')
  })

  it('leer, nur Leerzeichen und NULL sind kein Treffer, sondern not_found', async () => {
    for (const input of ['', '   ', null]) {
      expect(await getActivePartner(input)).toEqual({ status: 'not_found' })
    }
  })

  it('ein formatverletzender Slug findet per Konstruktion nichts', async () => {
    // Ein Unterstrich kann den CHECK nicht passiert haben — es KANN keine solche Zeile geben.
    expect(await getActivePartner('elektro_muster')).toEqual({ status: 'not_found' })
  })
})

// ── (3) Rechtefläche ─────────────────────────────────────────────────────────────────────────────
describe('(3) get_active_partner: Rechte', () => {
  it('EXECUTE hat ausschliesslich service_role — anon und authenticated NICHT', async () => {
    /*
     * `anon` bekommt in `platform` nirgends etwas (T4-1/B1-1/B14-1/B16-1), und ein anon-Grant
     * machte diesen Wrapper zum Verzeichnisdienst über alle aktiven Fachbetriebe: wer ihn in einer
     * Schleife aufruft, hat die Liste. Die Seite braucht ihn nicht — sie rendert serverseitig.
     *
     * Introspektion statt Aufruf: ein `select` als `anon` ohne Recht wirft, und die Grant-Fläche
     * ist genau die Frage.
     */
    const rows = await sql<{ rolname: string; can: boolean }>(
      `select r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can
         from pg_proc p, unnest(array['anon','authenticated','service_role']) as r(rolname)
        where p.proname = 'get_active_partner' and p.pronamespace = 'public'::regnamespace`,
    )

    const grants = Object.fromEntries(rows.map((r) => [r.rolname, r.can]))
    expect(grants).toEqual({ anon: false, authenticated: false, service_role: true })
  })

  it('`anon` kann `platform.partners` auch direkt nicht lesen', async () => {
    await expect(
      runAs({ role: 'anon', commit: false }, (c) => c.query('select 1 from platform.partners')),
    ).rejects.toThrow()
  })
})

// ── (4)+(5) Die Herkunft der Landingpage ─────────────────────────────────────────────────────────
describe('(4) Die Herkunft partner-empfehlung', () => {
  it('die lead_sources-Zeile existiert und ist aktiv', async () => {
    const rows = await sql<{ key: string; label: string; is_active: boolean }>(
      `select key, label, is_active from platform.lead_sources where key = 'partner-empfehlung'`,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.is_active).toBe(true)
    expect(rows[0]!.label).toBeTruthy()
  })

  it('der Schlüssel schreibt sich mit BINDESTRICH — der CHECK lässt nichts anderes zu', async () => {
    /*
     * Kein Formalismus: In B10-5 ist genau dieser CHECK mit SQLSTATE 23514 aufgeschlagen, weil ein
     * Herkunftsschlüssel mit Unterstrich vorgesehen war. Der Test hält die Regel an dem Wert fest,
     * der jetzt tatsächlich im Bestand steht.
     */
    expect('partner-empfehlung').toMatch(/^[a-z0-9-]+$/)

    await expect(
      sql(`insert into platform.lead_sources (key, label) values ('partner_test', 'x')`),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('DER VOLLE WEG DER LANDINGPAGE: Herkunft und Zuordnung entstehen gemeinsam', async () => {
    /*
     * Arbeitsregel 2 in ihrer schärfsten Form: nicht nur „der Wrapper läuft", sondern „die zwei
     * Teile dieses Bauabschnitts greifen ineinander". Die Landingpage schlägt den Slug nach
     * (get_active_partner) und reicht ihn zusammen mit der neuen Herkunft an capture_lead durch.
     *
     * Die zwei Angaben sind VERSCHIEDENE Dinge und werden hier auch getrennt geprüft: Die HERKUNFT
     * sagt „kam über eine Partner-Landingpage", die ZUORDNUNG sagt, über welchen Fachbetrieb.
     */
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug, 'Raymann Elektrotechnik GmbH')

    const partner = await getActivePartner(slug)
    expect(partner.status).toBe('ok')

    const email = `partner-landing-${randomUUID()}@test.local`
    const captured = await runAs({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ r: { outcome: string; lead_id: string } }>(
        `select public.capture_lead(
           p_email => $1,
           p_source_key => 'partner-empfehlung',
           p_first_name => 'Anna',
           p_last_name => 'Gruber',
           p_partner_slug => $2
         ) as r`,
        [email, partner.slug],
      )
      return rows[0]!.r
    })
    spawnedLeads.push(captured.lead_id)

    const rows = await sql<{
      first_source_key: string
      partner_slug: string | null
      referred_by_text: string | null
    }>(
      `select first_source_key, partner_slug, referred_by_text
         from platform.leads where id = $1`,
      [captured.lead_id],
    )

    expect(rows[0]!.first_source_key).toBe('partner-empfehlung')
    expect(rows[0]!.partner_slug).toBe(slug)
    // Der Freitext bleibt leer: Auf der Landingpage gibt es das Feld bewusst nicht — der
    // Fachbetrieb ist über den Pfad bekannt.
    expect(rows[0]!.referred_by_text).toBeNull()
  })

  it('der Freitext-Weg schreibt referred_by_text und NICHT partner_slug', async () => {
    /*
     * Die fachliche Achse von B16-1, hier am zweiten Erfassungsweg (`/kontakt`, Feld „Empfohlen
     * durch"): Die Kundenangabe ist eine BEOBACHTUNG. Ein Freitext, der zufällig wie ein Slug
     * aussieht, darf keine Zuordnung erzeugen — sonst entschiede eine Schreibweise darüber, wer ein
     * Montageprojekt bekommt.
     */
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    const email = `partner-freitext-${randomUUID()}@test.local`
    const captured = await runAs({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ r: { lead_id: string } }>(
        `select public.capture_lead(
           p_email => $1,
           p_source_key => 'kontaktformular',
           p_referred_by_text => $2
         ) as r`,
        [email, slug],
      )
      return rows[0]!.r
    })
    spawnedLeads.push(captured.lead_id)

    const rows = await sql<{ partner_slug: string | null; referred_by_text: string | null }>(
      `select partner_slug, referred_by_text from platform.leads where id = $1`,
      [captured.lead_id],
    )

    expect(rows[0]!.referred_by_text).toBe(slug)
    expect(rows[0]!.partner_slug).toBeNull()
  })
})
