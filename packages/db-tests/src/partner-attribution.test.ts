// DB-Gate für die Partner-Attribution
// (Migration 20260724190000_create_partner_attribution.sql, B16-1).
//
// Modell A: Ein Fachbetrieb verweist seine Bestandskunden per personalisiertem Link an COOLiN.
// COOLiN führt Analyse und Kundenbeziehung; der Partner bekommt das erste Zugriffsrecht auf die
// Montage. B16-1 ist REIN DATENBANK — keine Route, kein UI (B16-2/B16-3).
//
// ── WORAN DIESER ABSCHNITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ──────────────────────
// (1) DER SLUG. Er steht in einem Link, den ein Fachbetrieb an hunderte Bestandskunden verschickt,
//     und ist unwiderruflich, sobald die Mail raus ist. Der Format-CHECK (^[a-z0-9-]+$) ist
//     dieselbe Regel wie bei platform.lead_sources.key, an der B10-5 real mit SQLSTATE 23514
//     aufgeschlagen ist; und eine nachträgliche Umbenennung muss auch dann scheitern, wenn noch
//     KEIN Lead daran hängt (der Fremdschlüssel allein schützt diesen Fall nicht).
// (2) EIN LINK MIT TIPPFEHLER DARF KEINEN LEAD KOSTEN. capture_lead verwirft einen unbekannten oder
//     inaktiven Slug, statt die Erfassung scheitern zu lassen — und der Freitext bleibt stehen.
// (3) DIE ERSTE NENNUNG GILT. Ein zweiter Aufruf über den Link eines ANDEREN Fachbetriebs darf die
//     ursprüngliche Zuordnung nicht überschreiben; sonst entschiede die zufällige Reihenfolge
//     zweier Formularabsendungen darüber, wer ein Montageprojekt bekommt.
// (4) DIE ZWEI SPALTEN WERDEN BEI DER ANONYMISIERUNG UNTERSCHIEDLICH BEHANDELT. referred_by_text
//     (Freitext einer Person, kann Namen Dritter enthalten) wird genullt und ist danach
//     unveränderlich — auch für service_role UND postgres. partner_slug ÜBERLEBT, damit die
//     Partner-Statistik die 24-Monats-Frist überdauert.
// (5) DER DROP HAT GRANTS ENTFERNT. capture_lead, admin_list_leads, admin_export_leads und
//     admin_update_lead sind neu angelegt worden; die Rechtefläche wird NACHGEMESSEN, nicht
//     vorausgesetzt (in B3-1 schon einmal passiert).
// (6) JEDER NEUE WRAPPER WIRD TATSÄCHLICH AUFGERUFEN (Arbeitsregel 2): Introspektion beweist
//     Existenz, nicht Lauffähigkeit. plpgsql prüft Funktionsrümpfe nicht beim Anlegen.
// (7) FILTER UND ZÄHLUNG DÜRFEN NICHT AUSEINANDERLAUFEN. Der Partner-Filter geht über
//     platform.leads_matching und wird von admin_list_leads UND admin_export_leads benutzt; eine
//     auf einen Fachbetrieb gefilterte Sicht, aus der eine Datei mit dem Gesamtbestand fiele, ist
//     genau die Divergenz, gegen die B2-1 diese Schicht gebaut hat.
//
// ── ISOLATION GEGEN DEN ÜBRIGEN BESTAND ─────────────────────────────────────────────────────────
// admin_list_leads/admin_export_leads zählen BESTANDSWEIT, und in derselben Datenbank liegen die
// Fixtures aller übrigen Gates. Jeder Partner-Slug dieses Gates trägt deshalb eine zufällige
// Kennung, und die bestandsweiten Prüfungen filtern über genau diesen Slug.

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
  return `partner-${randomUUID()}@test.local`
}

/** Ein eindeutiger, formatgültiger Slug — Bindestriche, keine Unterstriche (der CHECK verlangt es). */
function newSlug(prefix = 'gate'): string {
  return `${prefix}-${randomUUID()}`
}

async function newAdmin(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

/** Nicht-Admin: echter Nutzer OHNE Rolleneintrag. */
async function newPlainUser(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
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

/** Legt einen Partner über den ECHTEN Admin-Wrapper an (nicht per direktem INSERT). */
async function createPartner(
  admin: TestUser,
  slug: string,
  displayName = 'Elektro Musterbetrieb',
): Promise<void> {
  const res = await callNamed<{ status: string }>(admin, 'public.admin_create_partner', {
    p_slug: slug,
    p_display_name: displayName,
  })
  expect(res.status, `Partner ${slug} anlegen`).toBe('created')
  spawnedPartners.push(slug)
}

async function attributionOf(leadId: string) {
  const rows = await sql<{ partner_slug: string | null; referred_by_text: string | null }>(
    `select partner_slug, referred_by_text from platform.leads where id = $1`,
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
  // Partner NACH den Leads: der Fremdschlüssel ist `on delete restrict`, ein zugeordneter Lead
  // hielte die Zeile fest. Aufgeräumt wird hier als `postgres` — ein delete-Grant gibt es bewusst
  // für keine Rolle, und genau das ist weiter unten ein eigener Test.
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

// ── (1) Der Slug ─────────────────────────────────────────────────────────────────────────────────
describe('(1) platform.partners: der Slug', () => {
  it('DER KERNFALL: Unterstrich, Grossbuchstabe und Umlaut werden abgelehnt', async () => {
    /*
     * Derselbe CHECK wie auf platform.lead_sources.key. In B10-5 ist er real mit SQLSTATE 23514
     * aufgeschlagen, und das Aufweichen wäre der schlechtere Handel gewesen: der Schlüssel wandert
     * in eine URL, und ein Bestand mit zwei Schreibkonventionen liesse sich nicht mehr
     * vereinheitlichen, ohne bereits verschickte Links zu brechen.
     *
     * Geprüft wird gegen die TABELLE (nicht den Wrapper): der Wrapper beantwortet dieselbe Regel
     * freundlicher, aber die harte Grenze muss in der Datenbank liegen — sonst schriebe ein
     * künftiger zweiter Schreibpfad daran vorbei.
     */
    for (const bad of ['gate_unterstrich', 'Gate-Gross', 'gate-müller', 'gate elektro', '']) {
      await expect(
        sql(`insert into platform.partners (slug, display_name) values ($1, 'X')`, [bad]),
        `Slug "${bad}" darf nicht einfügbar sein`,
      ).rejects.toThrow(/partners_slug_check|violates check constraint/i)
    }
  })

  it('ein gültiger Slug geht durch — die Gegenprobe', async () => {
    const slug = newSlug()
    spawnedPartners.push(slug)
    await sql(`insert into platform.partners (slug, display_name) values ($1, 'Elektro Muster')`, [
      slug,
    ])

    const rows = await sql<{ is_active: boolean }>(
      `select is_active from platform.partners where slug = $1`,
      [slug],
    )
    expect(rows[0]!.is_active, 'neue Partner sind per Vorgabewert aktiv').toBe(true)
  })

  it('ein leerer Anzeigename wird abgelehnt — Leerstring erfüllt NOT NULL, ist aber kein Name', async () => {
    await expect(
      sql(`insert into platform.partners (slug, display_name) values ($1, '   ')`, [newSlug()]),
    ).rejects.toThrow(/violates check constraint/i)
  })

  it('der Slug ist unveränderlich — auch ohne einen einzigen zugeordneten Lead', async () => {
    const slug = newSlug()
    spawnedPartners.push(slug)
    await sql(`insert into platform.partners (slug, display_name) values ($1, 'Elektro Muster')`, [
      slug,
    ])

    /*
     * Der Fremdschlüssel allein schützt diesen Fall NICHT: er blockiert nur die Änderung eines
     * bereits referenzierten Slugs. Ausgerechnet ohne Leads ist der Schaden aber am grössten — die
     * verschickten Links zeigten ins Leere, und der Fehler äusserte sich als AUSBLEIBEN von Leads,
     * was niemand bemerkt. Deshalb der Trigger, und deshalb dieser Test ohne Lead.
     *
     * ZWEI UNABHÄNGIGE SCHICHTEN, und der Test hält beide getrennt fest — GEMESSEN, nicht vermutet:
     *   service_role scheitert schon am GRANT (sie hat auf platform.partners nur select, weil
     *     public.capture_lead lediglich prüft, ob es den Slug gibt). Der Trigger kommt gar nicht
     *     erst zum Zug.
     *   postgres hat alle Rechte — dort greift der TRIGGER. Er ist die Schicht, die auch dann noch
     *     hält, wenn jemand später versehentlich ein update-Grant vergibt.
     * Beide Meldungen hier gleich zu behandeln würde verdecken, dass die zweite Schicht die
     * eigentliche Zusage ist.
     */
    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query(`update platform.partners set slug = 'gate-umbenannt' where slug = $1`, [slug]),
      ),
      'service_role scheitert bereits am fehlenden update-Grant',
    ).rejects.toThrow(/permission denied/i)

    await expect(
      runAs({ role: 'postgres' }, (c) =>
        c.query(`update platform.partners set slug = 'gate-umbenannt' where slug = $1`, [slug]),
      ),
      'postgres hat das Recht — und scheitert am Trigger',
    ).rejects.toThrow(/unveränderlich/)

    // Der Anzeigename dagegen SCHON — das ist der Unterschied, den der Guard machen muss.
    await sql(`update platform.partners set display_name = 'Elektro Muster GmbH' where slug = $1`, [
      slug,
    ])
    const rows = await sql<{ display_name: string }>(
      `select display_name from platform.partners where slug = $1`,
      [slug],
    )
    expect(rows[0]!.display_name).toBe('Elektro Muster GmbH')
  })
})

// ── (2) Kein Löschweg ────────────────────────────────────────────────────────────────────────────
describe('(2) ein Partner lässt sich nicht löschen, nur stilllegen', () => {
  it('KEINE Rolle hat ein delete-Grant auf platform.partners', async () => {
    const rows = await sql<{ role: string; can: boolean }>(
      `select r.role, has_table_privilege(r.role, 'platform.partners', 'delete') as can
         from (values ('anon'), ('authenticated'), ('service_role')) as r(role)`,
    )
    for (const row of rows) {
      expect(row.can, `${row.role} darf platform.partners NICHT löschen`).toBe(false)
    }

    // Gegenprobe, damit der Test nicht durch einen Tippfehler im Tabellennamen grün wird:
    // service_role DARF lesen (capture_lead prüft den Slug).
    const read = await sql<{ can: boolean }>(
      `select has_table_privilege('service_role', 'platform.partners', 'select') as can`,
    )
    expect(read[0]!.can).toBe(true)
  })

  it('service_role scheitert beim DELETE, kann den Partner aber deaktivieren', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    await expect(
      runAs({ role: 'service_role' }, (c) =>
        c.query('delete from platform.partners where slug = $1', [slug]),
      ),
    ).rejects.toThrow(/permission denied/i)

    const res = await callNamed<{ status: string; is_active: boolean }>(
      admin,
      'public.admin_set_partner_active',
      { p_slug: slug, p_is_active: false },
    )
    expect(res).toMatchObject({ status: 'ok', is_active: false })

    const rows = await sql<{ is_active: boolean }>(
      `select is_active from platform.partners where slug = $1`,
      [slug],
    )
    expect(rows[0]!.is_active).toBe(false)
  })
})

// ── (3) capture_lead: Zuordnung, Verwerfen, Zusammenführung ──────────────────────────────────────
describe('(3) public.capture_lead', () => {
  it('gültiger Slug → die Zuordnung steht, der Freitext steht daneben', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
      p_referred_by_text: 'Fa. Raymann Elektro',
    })

    /*
     * ZWEI Spalten, nicht eine: die Kundenangabe ist BEOBACHTUNG, die Zuordnung ist URTEIL. In
     * einem Feld vermischt liesse sich später nicht mehr feststellen, ob der Wert dort steht, weil
     * der Kunde ihn geschrieben hat oder weil jemand ihn zugeordnet hat.
     */
    expect(await attributionOf(lead.lead_id!)).toEqual({
      partner_slug: slug,
      referred_by_text: 'Fa. Raymann Elektro',
    })
  })

  it('DER KERNFALL: ein UNBEKANNTER Slug kostet keinen Lead — er wird verworfen, der Freitext bleibt', async () => {
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: 'gate-gibt-es-nicht',
      p_referred_by_text: 'mein Elektriker aus Wiener Neustadt',
    })

    /*
     * Die Erfassung ist der teuerste Moment im Trichter. Ein harter Fehler an dieser Stelle verlöre
     * einen echten Interessenten wegen eines fremden Schreibfehlers im Link — dieselbe Abwägung wie
     * überall sonst hier.
     */
    expect(lead.outcome).toBe('lead_only')
    expect(await attributionOf(lead.lead_id!)).toEqual({
      partner_slug: null,
      // Der verworfene Slug wird ausdrücklich NICHT ersatzweise in den Freitext geschrieben: das
      // Feld ist per Definition, was der INTERESSENT eingegeben hat.
      referred_by_text: 'mein Elektriker aus Wiener Neustadt',
    })
  })

  it('ein INAKTIVER Partner wird wie ein unbekannter behandelt', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)
    await callNamed(admin, 'public.admin_set_partner_active', {
      p_slug: slug,
      p_is_active: false,
    })

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
    })

    /*
     * Die Deaktivierung IST die Ansage, dass Links dieses Fachbetriebs nicht mehr attributieren
     * sollen. Wäre es anders, hätte `is_active` für den einzigen Pfad, der im Betrieb Zuordnungen
     * erzeugt, gar keine Wirkung.
     */
    expect(await attributionOf(lead.lead_id!)).toEqual({
      partner_slug: null,
      referred_by_text: null,
    })
  })

  it('der Slug wird kleingeschrieben verglichen — ein abgetippter Link mit Grossbuchstaben trifft', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug.toUpperCase(),
    })

    /*
     * Der CHECK garantiert, dass JEDER gespeicherte Slug kleingeschrieben ist — das Kleinschreiben
     * der Eingabe kann deshalb nur einen Nicht-Treffer in den RICHTIGEN Treffer verwandeln,
     * niemals in einen falschen.
     */
    expect((await attributionOf(lead.lead_id!)).partner_slug).toBe(slug)
  })

  it('DER KERNFALL: ein zweiter Aufruf mit ANDEREM Partner überschreibt den ersten NICHT', async () => {
    const admin = await newAdmin()
    const first = newSlug('erst')
    const second = newSlug('zweit')
    await createPartner(admin, first, 'Elektro Erster')
    await createPartner(admin, second, 'Elektro Zweiter')

    const email = newEmail()
    const created = await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_partner_slug: first,
      p_referred_by_text: 'Elektro Erster',
    })

    const again = await capture({
      p_email: email,
      p_source_key: 'fachvortrag',
      p_partner_slug: second,
      p_referred_by_text: 'Elektro Zweiter',
    })
    expect(again.lead_id, 'derselbe Lead, kein zweiter').toBe(created.lead_id)

    /*
     * `coalesce(Bestand, neu)` — dieselbe Vorrangregel wie company/first_name/last_name/phone und
     * bewusst die UMGEKEHRTE der sechs Segmentierungsfelder aus B3-1. Ohne sie entschiede die
     * zufällige Reihenfolge zweier Formularabsendungen darüber, wer das Montageprojekt bekommt.
     */
    expect(await attributionOf(created.lead_id!)).toEqual({
      partner_slug: first,
      referred_by_text: 'Elektro Erster',
    })
  })

  it('die zwei Felder werden EINZELN zusammengeführt, nicht als Paar', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    const email = newEmail()
    // Erster Kontakt: NUR der Freitext (jemand tippt eine Empfehlung, ohne über einen Link zu kommen).
    const created = await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_referred_by_text: 'Fa. Raymann Elektro',
    })
    expect(await attributionOf(created.lead_id!)).toEqual({
      partner_slug: null,
      referred_by_text: 'Fa. Raymann Elektro',
    })

    // Zweiter Kontakt kommt über einen echten Link — er darf den bestehenden Freitext nicht anfassen.
    await capture({
      p_email: email,
      p_source_key: 'fachvortrag',
      p_partner_slug: slug,
      p_referred_by_text: 'irgendetwas anderes',
    })
    expect(await attributionOf(created.lead_id!)).toEqual({
      partner_slug: slug,
      referred_by_text: 'Fa. Raymann Elektro',
    })
  })

  it('Leerstring und Leerzeichen werden zu null und überschreiben nichts', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    // (a) Leer erfasst → beide Spalten null, kein '' im Bestand.
    const blank = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: '   ',
      p_referred_by_text: '',
    })
    /*
     * Ein '' ist kein null: es überlebt jedes COALESCE und überschriebe damit später eine echte
     * Angabe. Beim Slug käme erschwerend hinzu, dass '' den Format-CHECK des Fremdschlüsselziels
     * gar nicht erfüllen kann — die Erfassung stürbe an einer Fremdschlüsselverletzung.
     */
    expect(await attributionOf(blank.lead_id!)).toEqual({
      partner_slug: null,
      referred_by_text: null,
    })

    // (b) Leer NACH einer echten Angabe → die echte Angabe bleibt.
    const email = newEmail()
    const created = await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
      p_referred_by_text: 'Fa. Raymann Elektro',
    })
    await capture({
      p_email: email,
      p_source_key: 'direktkontakt',
      p_partner_slug: '  ',
      p_referred_by_text: '   ',
    })
    expect(await attributionOf(created.lead_id!)).toEqual({
      partner_slug: slug,
      referred_by_text: 'Fa. Raymann Elektro',
    })
  })

  it('umgebende Leerzeichen werden entfernt, der Freitext selbst bleibt unangetastet', async () => {
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_referred_by_text: '  Fa. Raymann Elektro, Herr Huber  ',
    })
    // Getrimmt wird nur AUSSEN — der Freitext ist die Angabe des Kunden und wird nicht bereinigt.
    expect((await attributionOf(lead.lead_id!)).referred_by_text).toBe(
      'Fa. Raymann Elektro, Herr Huber',
    )
  })

  it('bestehende Aufrufer laufen unverändert: ein POSITIONALER Aufruf ohne die neuen Parameter', async () => {
    /*
     * Die zwei Parameter hängen mit Vorgabewert null HINTEN an — genau das Muster, mit dem p_locale
     * (B1-2) und die sechs Segmentierungsfelder (B3-1) ergänzt wurden. Dieser Aufruf ist bewusst
     * POSITIONAL und wortgleich der Form, die das B1-2-Gate führt: er ist der Beweis, dass ein
     * bestehender Aufrufer weder mehrdeutig wird („function is not unique") noch verrutscht.
     */
    const email = newEmail()
    const result = await runAs({ role: 'service_role', commit: true }, async (c) => {
      const { rows } = await c.query<{ r: Outcome }>(
        `select public.capture_lead(
           $1, 'kontaktformular', null, null, null,
           'DB-Gate GmbH', 'Test', 'Person', '+43 1 0000', '203.0.113.9'::inet, 'db-gate/1.0'
         ) as r`,
        [email],
      )
      return rows[0]!.r
    })
    if (result.lead_id) spawnedLeads.push(result.lead_id)

    expect(result.outcome).toBe('lead_only')
    expect(await attributionOf(result.lead_id!)).toEqual({
      partner_slug: null,
      referred_by_text: null,
    })

    // Und die Kontaktangaben stehen weiterhin an ihrer Stelle — ein verrutschter Parameter schriebe
    // sonst die Telefonnummer in den Nachnamen, und zwar ohne Fehler.
    const rows = await sql<{ first_name: string; last_name: string; phone: string }>(
      `select first_name, last_name, phone from platform.leads where id = $1`,
      [result.lead_id],
    )
    expect(rows[0]).toEqual({ first_name: 'Test', last_name: 'Person', phone: '+43 1 0000' })
  })

  it('GENAU EINE Überladung, die zwei Parameter hängen am ENDE', async () => {
    const rows = await sql<{ args: string[] }>(
      `select p.proargnames as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'capture_lead'`,
    )
    // Eine zweite Überladung machte jeden bestehenden Aufruf mehrdeutig und legte den gesamten
    // Erfassungspfad lahm (der Grund für DROP + CREATE statt eines blossen CREATE).
    expect(rows).toHaveLength(1)
    const args = rows[0]!.args
    expect(args.slice(-2)).toEqual(['p_partner_slug', 'p_referred_by_text'])
  })
})

// ── (4) Anonymisierung ───────────────────────────────────────────────────────────────────────────
describe('(4) Anonymisierung: das eine Feld weg, das andere bleibt', () => {
  it('DER KERNFALL: referred_by_text wird genullt, partner_slug BLEIBT', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
      p_referred_by_text: 'mein Schwager, der Elektriker Huber',
    })

    const res = await callAs<{ status: string; outcome: string }>(
      admin,
      'select public.admin_anonymize_lead($1) as r',
      [lead.lead_id],
    )
    expect(res).toMatchObject({ status: 'ok', outcome: 'anonymized' })

    /*
     * Der Freitext kann Namen Dritter enthalten („Elektriker Huber") — genau die Angaben, die eine
     * Anonymisierung entfernen soll. Die Zuordnung dagegen ist ohne E-Mail, Name und PLZ keine
     * personenbezogene Angabe mehr, und die Partner-Statistik muss die 24-Monats-Frist ÜBERLEBEN:
     * sonst verlöre ein Fachbetrieb rückwirkend den Nachweis über die von ihm gebrachten Kontakte.
     */
    expect(await attributionOf(lead.lead_id!)).toEqual({
      partner_slug: slug,
      referred_by_text: null,
    })
  })

  it('referred_by_text ist danach nicht mehr setzbar — auch nicht für service_role und postgres', async () => {
    const admin = await newAdmin()
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_referred_by_text: 'Fa. Raymann Elektro',
    })
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.lead_id])

    for (const role of ['service_role', 'postgres'] as const) {
      await expect(
        runAs({ role }, (c) =>
          c.query(`update platform.leads set referred_by_text = 'Nachtrag' where id = $1`, [
            lead.lead_id,
          ]),
        ),
        `${role} darf referred_by_text eines anonymisierten Leads nicht setzen`,
      ).rejects.toThrow(/anonymisiert/)
    }

    expect((await attributionOf(lead.lead_id!)).referred_by_text).toBeNull()
  })

  it('partner_slug steht bewusst NICHT im Guard — die Zuordnung bleibt technisch beweglich', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    const other = newSlug('anders')
    await createPartner(admin, slug)
    await createPartner(admin, other, 'Elektro Anders')

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
    })
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.lead_id])

    /*
     * Diese Beweglichkeit ist die KEHRSEITE der Ausnahme und wird hier bewusst festgehalten statt
     * verschwiegen: der Guard schützt partner_slug nicht, weil er die Zuordnung ERHALTEN soll —
     * nicht, weil sie nachträglich geändert werden dürfte. Der Weg dorthin bleibt trotzdem eng:
     * public.admin_update_lead beantwortet einen anonymisierten Lead mit {status: anonymized},
     * bevor es irgendetwas schreibt (nächster Test).
     */
    await sql(`update platform.leads set partner_slug = $2 where id = $1`, [lead.lead_id, other])
    expect((await attributionOf(lead.lead_id!)).partner_slug).toBe(other)
  })

  it('der Admin-Weg bleibt trotzdem zu: admin_update_lead liefert {status: anonymized}', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    const lead = await capture({ p_email: newEmail(), p_source_key: 'kontaktformular' })
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [lead.lead_id])

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_lead', {
      p_lead_id: lead.lead_id,
      p_partner_slug: slug,
    })
    expect(res.status).toBe('anonymized')
    expect((await attributionOf(lead.lead_id!)).partner_slug).toBeNull()
  })
})

// ── (5) Die Rechtefläche nach dem DROP ───────────────────────────────────────────────────────────
describe('(5) Grants — nach dem DROP nachgemessen, nicht vorausgesetzt', () => {
  it('capture_lead bleibt service_role-only, die vier Admin-Wrapper authenticated-only', async () => {
    const can = async (role: string, fn: string) => {
      const rows = await sql<{ can: boolean }>(
        `select has_function_privilege($1, p.oid, 'execute') as can
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $2`,
        [role, fn],
      )
      expect(rows, `public.${fn} existiert genau einmal`).toHaveLength(1)
      return rows[0]!.can
    }

    /*
     * Ein DROP entfernt bestehende Grants. VIER Wrapper wurden in dieser Migration neu angelegt
     * (capture_lead, admin_list_leads, admin_export_leads, admin_update_lead) — die Rechtefläche
     * musste also erneut gesetzt werden. Genau das wird hier nachgemessen; in B3-1 ist derselbe
     * Schritt schon einmal aufgefallen.
     */
    expect(await can('service_role', 'capture_lead')).toBe(true)
    expect(await can('anon', 'capture_lead')).toBe(false)
    expect(await can('authenticated', 'capture_lead')).toBe(false)

    for (const fn of [
      'admin_list_leads',
      'admin_export_leads',
      'admin_update_lead',
      'admin_create_partner',
      'admin_update_partner',
      'admin_set_partner_active',
      'admin_list_partners',
    ]) {
      expect(await can('authenticated', fn), `${fn} für authenticated`).toBe(true)
      expect(await can('anon', fn), `${fn} für anon`).toBe(false)
      // service_role bekommt bewusst KEIN Grant: diese Wrapper leiten ihre Autorisierung aus
      // auth.uid() ab, das dort NULL ist — sie wären funktionslos und stets abgelehnt.
      expect(await can('service_role', fn), `${fn} für service_role`).toBe(false)
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
    expect(rows.length, 'je Funktion genau eine Überladung × drei Rollen').toBe(6)
    for (const row of rows) {
      expect(row.can, `${row.proname} für ${row.role}`).toBe(false)
    }
  })
})

// ── (6) Die vier Partner-Wrapper ─────────────────────────────────────────────────────────────────
describe('(6) die Partner-Wrapper', () => {
  it('ohne Adminrolle WIRFT jeder der vier (42501) — „kein Zugriff" ist nicht „keine Partner"', async () => {
    const plain = await newPlainUser()
    const slug = newSlug()

    const calls: [string, Record<string, unknown>][] = [
      ['public.admin_create_partner', { p_slug: slug, p_display_name: 'Elektro Muster' }],
      ['public.admin_update_partner', { p_slug: slug, p_display_name: 'Elektro Muster' }],
      ['public.admin_set_partner_active', { p_slug: slug, p_is_active: false }],
      ['public.admin_list_partners', {}],
    ]

    for (const [fn, args] of calls) {
      await expect(
        args && Object.keys(args).length > 0
          ? callNamed(plain, fn, args)
          : callAs(plain, `select ${fn}() as r`),
        `${fn} muss werfen statt leer zu antworten`,
      ).rejects.toThrow(/Adminrolle erforderlich/)
    }

    // Und es ist wirklich nichts entstanden — eine Ablehnung, die nebenbei schreibt, wäre keine.
    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.partners where slug = $1`,
      [slug],
    )
    expect(rows[0]!.n).toBe(0)
  })

  it('admin_create_partner: legt an, lehnt Format und Dublette als STATUS ab', async () => {
    const admin = await newAdmin()
    const slug = newSlug()

    const created = await callNamed<{ status: string; slug: string }>(
      admin,
      'public.admin_create_partner',
      {
        p_slug: slug,
        p_display_name: '  Elektro Musterbetrieb GmbH ',
        p_contact_first_name: ' Erika ',
        p_contact_last_name: 'Muster',
      },
    )
    expect(created).toMatchObject({ status: 'created', slug })
    spawnedPartners.push(slug)

    const row = (
      await sql<{
        display_name: string
        contact_first_name: string
        contact_last_name: string
      }>(
        `select display_name, contact_first_name, contact_last_name
           from platform.partners where slug = $1`,
        [slug],
      )
    )[0]!
    expect(row).toEqual({
      display_name: 'Elektro Musterbetrieb GmbH',
      // Vor- und Nachname GETRENNT. Ein zweites contact_name anzulegen hiesse, den Defekt, den
      // platform.leads eine Migration zuvor gekostet hat, sofort neu einzuführen.
      contact_first_name: 'Erika',
      contact_last_name: 'Muster',
    })

    // Ein Slug mit Unterstrich wird als lesbarer STATUS abgelehnt, nicht als 23514: der Slug ist
    // die einzige Eingabe dieses Formulars mit einer Regel, und ein Constraint-Text ist für die
    // tippende Person keine Auskunft.
    expect(
      await callNamed<{ status: string }>(admin, 'public.admin_create_partner', {
        p_slug: 'gate_unterstrich',
        p_display_name: 'Elektro Muster',
      }),
    ).toMatchObject({ status: 'invalid_slug' })

    expect(
      await callNamed<{ status: string }>(admin, 'public.admin_create_partner', {
        p_slug: slug,
        p_display_name: 'Ein anderer Name',
      }),
      'kein Upsert — ein doppelt abgeschicktes Formular darf nicht umbenennen',
    ).toMatchObject({ status: 'duplicate_slug' })

    expect(
      await callNamed<{ status: string }>(admin, 'public.admin_create_partner', {
        p_slug: newSlug(),
        p_display_name: '   ',
      }),
    ).toMatchObject({ status: 'missing_fields' })

    // Der Anzeigename der bestehenden Zeile ist durch die Dublette NICHT verändert worden.
    const after = await sql<{ display_name: string }>(
      `select display_name from platform.partners where slug = $1`,
      [slug],
    )
    expect(after[0]!.display_name).toBe('Elektro Musterbetrieb GmbH')
  })

  it('admin_create_partner nimmt Grossbuchstaben an und legt sie kleingeschrieben ab', async () => {
    const admin = await newAdmin()
    const slug = newSlug()

    const res = await callNamed<{ status: string; slug: string }>(
      admin,
      'public.admin_create_partner',
      { p_slug: slug.toUpperCase(), p_display_name: 'Elektro Muster' },
    )
    expect(res).toMatchObject({ status: 'created', slug })
    spawnedPartners.push(slug)

    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.partners where slug = $1`,
      [slug],
    )
    expect(rows[0]!.n).toBe(1)
  })

  it('admin_update_partner korrigiert Namen — und hat KEINEN Parameter für den Slug', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_partner', {
      p_slug: slug,
      p_display_name: 'Elektro Muster GmbH & Co KG',
      p_contact_first_name: 'Erika',
      p_contact_last_name: 'Muster',
    })
    expect(res.status).toBe('ok')

    // NULL heisst LÖSCHEN (Bearbeitungsformular-Regel wie in admin_update_lead) — je Feld einzeln.
    await callNamed(admin, 'public.admin_update_partner', {
      p_slug: slug,
      p_display_name: 'Elektro Muster GmbH & Co KG',
      p_contact_last_name: 'Muster',
    })
    const row = (
      await sql<{
        display_name: string
        contact_first_name: string | null
        contact_last_name: string | null
      }>(
        `select display_name, contact_first_name, contact_last_name
           from platform.partners where slug = $1`,
        [slug],
      )
    )[0]!
    expect(row).toEqual({
      display_name: 'Elektro Muster GmbH & Co KG',
      contact_first_name: null,
      contact_last_name: 'Muster',
    })

    // Der Anzeigename ist Pflicht und kann nicht geleert werden.
    expect(
      await callNamed<{ status: string }>(admin, 'public.admin_update_partner', {
        p_slug: slug,
        p_display_name: '  ',
      }),
    ).toMatchObject({ status: 'missing_fields' })

    // Ein unbekannter Partner ist ein FACHLICHER Zustand, kein Autorisierungsfehler.
    expect(
      await callNamed<{ status: string }>(admin, 'public.admin_update_partner', {
        p_slug: 'gate-gibt-es-nicht',
        p_display_name: 'X',
      }),
    ).toMatchObject({ status: 'not_found' })

    /*
     * Der Slug ist BEZEICHNER, nicht bearbeitbares Feld — genau wie email in admin_update_lead
     * keinen Parameter hat. Er steht in bereits verschickten Links und kann nicht zurückgeholt
     * werden.
     */
    const args = (
      await sql<{ args: string[] }>(
        `select p.proargnames as args
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'admin_update_partner'`,
      )
    )[0]!.args
    expect(args).toEqual([
      'p_slug',
      'p_display_name',
      'p_contact_first_name',
      'p_contact_last_name',
    ])
    expect(args).not.toContain('p_new_slug')
  })

  it('admin_set_partner_active: reaktiviert, und ein unbekannter Slug ist not_found', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    await callNamed(admin, 'public.admin_set_partner_active', { p_slug: slug, p_is_active: false })
    const on = await callNamed<{ status: string; is_active: boolean }>(
      admin,
      'public.admin_set_partner_active',
      { p_slug: slug, p_is_active: true },
    )
    expect(on).toMatchObject({ status: 'ok', is_active: true })

    // Und danach attributiert der Link wieder — die Stilllegung ist umkehrbar, die Löschung wäre es
    // nicht.
    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
    })
    expect((await attributionOf(lead.lead_id!)).partner_slug).toBe(slug)

    expect(
      await callNamed<{ status: string }>(admin, 'public.admin_set_partner_active', {
        p_slug: 'gate-gibt-es-nicht',
        p_is_active: false,
      }),
    ).toMatchObject({ status: 'not_found' })
  })

  it('DER KERNFALL admin_list_partners: der lead_count zählt anonymisierte Leads MIT', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug, `Elektro Zähltest ${slug}`)

    const bleibt = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
    })
    const wirdAnonym = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
    })
    await callAs(admin, 'select public.admin_anonymize_lead($1) as r', [wirdAnonym.lead_id])

    // Einer der beiden ist Kunde geworden — „gebracht" und „geworden" sind verschiedene Zahlen.
    await callAs(admin, `select public.admin_set_lead_status($1, 'customer') as r`, [
      bleibt.lead_id,
    ])

    const res = await callAs<{
      status: string
      partners: { slug: string; lead_count: number; customer_count: number; is_active: boolean }[]
    }>(admin, 'select public.admin_list_partners() as r')

    expect(res.status).toBe('ok')
    const row = res.partners.find((p) => p.slug === slug)!
    /*
     * ZWEI, nicht EINER. Genau dafür ist partner_slug aus platform.guard_anonymized_lead
     * herausgehalten und wird von platform.anonymize_lead nicht genullt: eine Zahl, die nach 24
     * Monaten schrumpft, nähme einem Fachbetrieb rückwirkend den Nachweis über die von ihm
     * gebrachten Kontakte.
     */
    expect(row.lead_count).toBe(2)
    expect(row.customer_count).toBe(1)
    expect(row.is_active).toBe(true)
  })
})

// ── (7) Der Partner-Filter: eine Definition, zwei Konsumenten ────────────────────────────────────
describe('(7) der Partner-Filter in Liste und Ausfuhr', () => {
  it('DER KERNFALL: Liste und Ausfuhr liefern dieselbe Menge, und das Protokoll nennt den Filter', async () => {
    const admin = await newAdmin()
    const mine = newSlug('meiner')
    const other = newSlug('fremder')
    await createPartner(admin, mine, `Elektro Meiner ${mine}`)
    await createPartner(admin, other, `Elektro Fremder ${other}`)

    const a = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: mine,
      p_referred_by_text: 'Fa. Raymann Elektro',
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: mine,
    })
    // Ein dritter Lead beim ANDEREN Partner — er darf in keiner der beiden Antworten auftauchen.
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: other,
    })

    const list = await callNamed<{
      status: string
      total: number
      export_total: number
      leads: Record<string, unknown>[]
      partners: { slug: string }[]
    }>(admin, 'public.admin_list_leads', { p_partner_slug: mine })

    expect(list.status).toBe('ok')
    expect(list.total, 'nur die zwei Leads dieses Partners').toBe(2)
    expect(list.leads.map((l) => l.partner_slug)).toEqual([mine, mine])
    // Beide Felder fahren in der Liste mit — erst ihr Nebeneinander zeigt die zu entscheidenden Fälle.
    expect(list.leads.find((l) => l.id === a.lead_id)!.referred_by_text).toBe('Fa. Raymann Elektro')
    // Die Partner-Auswahlliste fährt mit (Tabelle, die der Anwendungscode nicht spiegeln kann).
    expect(list.partners.map((p) => p.slug)).toContain(mine)

    const exp = await callNamed<{
      status: string
      row_count: number
      filter_summary: string
      rows: Record<string, unknown>[]
    }>(admin, 'public.admin_export_leads', { p_partner_slug: mine })

    /*
     * DIE EIGENTLICHE AUSSAGE DIESES TESTS: derselbe Filter, dieselbe Menge. Ohne den
     * durchgereichten Parameter fiele aus einer auf EINEN Fachbetrieb gefilterten Sicht eine Datei
     * mit dem GESAMTBESTAND — beide Zahlen wären plausibel, und die Abweichung fiele erst an der
     * Datei auf, wenn sie das System bereits verlassen hat.
     */
    expect(exp.status).toBe('ok')
    expect(exp.row_count).toBe(list.export_total)
    expect(exp.row_count).toBe(2)
    expect(exp.rows.map((r) => r.partner_slug)).toEqual([mine, mine])
    // Der Anzeigename fährt mit (eine Spalte mit Schlüsseln wäre in einem fremden Werkzeug nutzlos),
    // der Freitext als Beleg ebenso.
    expect(exp.rows[0]!.partner_display_name).toBe(`Elektro Meiner ${mine}`)
    expect(exp.rows.map((r) => r.referred_by_text)).toContain('Fa. Raymann Elektro')

    // Das Protokoll nennt den SLUG, nicht den Anzeigenamen: der Slug ist unveränderlich, der
    // Anzeigename korrigierbar — ein Protokoll, dessen Aussage sich mit einer Umbenennung ändert,
    // ist keins.
    expect(exp.filter_summary).toContain(`Partner: ${mine}`)

    await sql('delete from platform.admin_exports where exported_by = $1', [admin.id])
  })

  it('ein UNBEKANNTER Partner-Slug wird abgelehnt statt eine leere Menge zu liefern', async () => {
    const admin = await newAdmin()

    /*
     * Eine leere Menge läse sich als „dieser Partner hat niemanden gebracht" — die schlechteste
     * Auskunft, die man einem Fachbetrieb geben kann. Anders als in capture_lead wird hier NICHT
     * verworfen: dort steht ein echter Interessent auf dem Spiel, hier nur eine Ansicht.
     */
    for (const fn of ['public.admin_list_leads', 'public.admin_export_leads']) {
      expect(
        await callNamed<{ status: string; filter: string }>(admin, fn, {
          p_partner_slug: 'gate-gibt-es-nicht',
        }),
        fn,
      ).toMatchObject({ status: 'invalid_filter', filter: 'partner_slug' })
    }

    // Und es ist KEIN Ausfuhrprotokoll entstanden — eine abgelehnte Ausfuhr ist keine Ausfuhr.
    const rows = await sql<{ n: number }>(
      `select count(*)::int as n from platform.admin_exports where exported_by = $1`,
      [admin.id],
    )
    expect(rows[0]!.n).toBe(0)
  })

  it('ein INAKTIVER Partner bleibt filterbar — seine Leads existieren weiter', async () => {
    const admin = await newAdmin()
    const slug = newSlug('stillgelegt')
    await createPartner(admin, slug)

    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
    })
    await callNamed(admin, 'public.admin_set_partner_active', { p_slug: slug, p_is_active: false })

    const list = await callNamed<{ status: string; total: number }>(
      admin,
      'public.admin_list_leads',
      { p_partner_slug: slug },
    )
    expect(list).toMatchObject({ status: 'ok', total: 1 })
  })

  it('gefiltert wird über die ZUORDNUNG, nicht über den Freitext', async () => {
    const admin = await newAdmin()
    const slug = newSlug('nurfreitext')
    await createPartner(admin, slug)

    // Ein Lead, der den Partnernamen NUR im Freitext trägt — ohne Zuordnung.
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_referred_by_text: slug,
    })

    /*
     * Die Frage lautet „welche Leads sind diesem Fachbetrieb ZUGESCHRIEBEN", nicht „wer hat seinen
     * Namen erwähnt". Ein Filter, der zusätzlich den Freitext durchsuchte, vermischte Beobachtung
     * und Urteil genau dort, wo die Trennung zählt — und ein Partner sähe Leads, die ihm niemand
     * zugeschrieben hat.
     */
    const list = await callNamed<{ status: string; total: number }>(
      admin,
      'public.admin_list_leads',
      { p_partner_slug: slug },
    )
    expect(list).toMatchObject({ status: 'ok', total: 0 })
  })
})

// ── (8) Der Admin-Korrekturweg auf dem Lead ──────────────────────────────────────────────────────
describe('(8) public.admin_update_lead: aus dem Freitext wird eine Zuordnung', () => {
  it('DER KERNFALL: ein Admin ordnet einen Freitext einer echten Partnerzeile zu', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug, 'Raymann Elektro GmbH')

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_referred_by_text: 'Fa. Raymann Elektro',
    })

    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_lead', {
      p_lead_id: lead.lead_id,
      p_partner_slug: slug,
    })
    expect(res.status).toBe('ok')

    /*
     * Die BEOBACHTUNG bleibt unangetastet, das URTEIL kommt daneben. Genau deshalb sind es zwei
     * Spalten: den Freitext an die Zuordnung anzugleichen vernichtete den Beleg, auf den sich die
     * Zuordnung stützt.
     */
    expect(await attributionOf(lead.lead_id!)).toEqual({
      partner_slug: slug,
      referred_by_text: 'Fa. Raymann Elektro',
    })
  })

  it('eine falsche Zuordnung ist zurücknehmbar — NULL heisst hier LÖSCHEN', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_partner_slug: slug,
      p_referred_by_text: 'Fa. Raymann Elektro',
    })

    // Aufruf OHNE p_partner_slug: die Bearbeitungsformular-Regel (alle Felder werden geschickt, ein
    // geleertes ist eine Aussage) — bewusst gegenläufig zu capture_lead.
    await callNamed(admin, 'public.admin_update_lead', { p_lead_id: lead.lead_id })

    expect((await attributionOf(lead.lead_id!)).partner_slug).toBeNull()
    /*
     * Der Freitext überlebt: er hat in admin_update_lead GAR KEINEN Parameter und wird deshalb von
     * der „null heisst löschen"-Regel nicht erfasst. Das ist die eigentliche Aussage dieses
     * Testfalls — das Urteil ist revidierbar, die Beobachtung nicht angreifbar.
     */
    expect((await attributionOf(lead.lead_id!)).referred_by_text).toBe('Fa. Raymann Elektro')
  })

  it('ein unbekannter Slug WIRFT (22023) statt still verworfen zu werden', async () => {
    const admin = await newAdmin()
    const lead = await capture({ p_email: newEmail(), p_source_key: 'kontaktformular' })

    await expect(
      callNamed(admin, 'public.admin_update_lead', {
        p_lead_id: lead.lead_id,
        p_partner_slug: 'gate-gibt-es-nicht',
      }),
    ).rejects.toThrow(/existiert nicht/)

    // Nichts geschrieben — auch nicht die übrigen Felder desselben Aufrufs.
    expect((await attributionOf(lead.lead_id!)).partner_slug).toBeNull()
  })

  it('ein INAKTIVER Partner ist hier zulässig — eine historische Feststellung ist kein Fehler', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug)
    await callNamed(admin, 'public.admin_set_partner_active', { p_slug: slug, p_is_active: false })

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_referred_by_text: 'Fa. Raymann Elektro',
    })

    /*
     * Die bewusste Asymmetrie zu capture_lead: dort wird ein inaktiver Partner wie ein unbekannter
     * behandelt (ein alter Link soll nicht weiter attributieren), hier entscheidet ein Mensch über
     * einen zurückliegenden Vorgang.
     */
    const res = await callNamed<{ status: string }>(admin, 'public.admin_update_lead', {
      p_lead_id: lead.lead_id,
      p_partner_slug: slug,
    })
    expect(res.status).toBe('ok')
    expect((await attributionOf(lead.lead_id!)).partner_slug).toBe(slug)
  })
})

// ── (9) admin_get_lead ───────────────────────────────────────────────────────────────────────────
describe('(9) public.admin_get_lead liefert die Attribution', () => {
  it('Slug, Anzeigename, Aktivzustand und Freitext', async () => {
    const admin = await newAdmin()
    const slug = newSlug()
    await createPartner(admin, slug, 'Raymann Elektro GmbH')
    await callNamed(admin, 'public.admin_set_partner_active', { p_slug: slug, p_is_active: false })

    const lead = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_referred_by_text: 'Fa. Raymann Elektro',
    })
    await callNamed(admin, 'public.admin_update_lead', {
      p_lead_id: lead.lead_id,
      p_partner_slug: slug,
    })

    const res = await callAs<{ status: string; lead: Record<string, unknown> }>(
      admin,
      'select public.admin_get_lead($1) as r',
      [lead.lead_id],
    )

    expect(res.status).toBe('ok')
    expect(res.lead.partner_slug).toBe(slug)
    // Ohne den Anzeigenamen bräuchte die Detailansicht einen zweiten Aufruf, nur um einen Namen
    // statt eines Schlüssels zu zeigen.
    expect(res.lead.partner_display_name).toBe('Raymann Elektro GmbH')
    // „zugeordnet zu einem stillgelegten Fachbetrieb" ist ein Zustand, den man SEHEN muss, statt ihn
    // aus dem Ausbleiben zu schliessen.
    expect(res.lead.partner_is_active).toBe(false)
    expect(res.lead.referred_by_text).toBe('Fa. Raymann Elektro')
  })

  it('ohne Zuordnung sind Slug, Anzeigename und Aktivzustand null — kein erfundener Platzhalter', async () => {
    const admin = await newAdmin()
    const lead = await capture({ p_email: newEmail(), p_source_key: 'kontaktformular' })

    const res = await callAs<{ lead: Record<string, unknown> }>(
      admin,
      'select public.admin_get_lead($1) as r',
      [lead.lead_id],
    )
    expect(res.lead.partner_slug).toBeNull()
    expect(res.lead.partner_display_name).toBeNull()
    expect(res.lead.partner_is_active).toBeNull()
    expect(res.lead.referred_by_text).toBeNull()
  })
})
