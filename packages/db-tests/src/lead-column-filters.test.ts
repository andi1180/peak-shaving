// DB-Gate für die spaltenweisen Filter der Lead-Liste
// (Migration 20260805210000_lead_column_filters.sql).
//
// Die Lead-Liste bekommt eine Excel-artige Bedienung: je Spalte ein Popover statt einer grossen
// Filtersektion. Dafür braucht `platform.leads_matching` dreizehn neue Parameter — sechs
// Textfilter, drei Mengen, ein „ohne Thema", ein Zeitraum — und `public.admin_list_leads`
// zusätzlich die formlose Firmenerwähnung in der Antwort.
//
// ── WORAN DIESER ABSCHNITT SCHEITERN KÖNNTE, UND WAS DESHALB GEMESSEN WIRD ──────────────────────
// (1) EIN FILTER GREIFT NUR IN DER LISTE. Der Export übernimmt die Filter der Sicht; fehlte ein
//     Parameter dort, fiele aus einer eingegrenzten Ansicht eine Datei mit dem GESAMTBESTAND.
//     Beide Zahlen wären plausibel, und die Abweichung fiele erst an der Datei auf, wenn sie das
//     System bereits verlassen hat. Deshalb wird JEDER neue Filter in BEIDEN Wrappern gemessen.
// (2) DIE MASKIERUNG FEHLT ODER IST DOPPELT. Ein getipptes `%` würde sonst alles treffen (der
//     Admin sucht eine Firma, er schreibt kein Muster) — oder eine doppelt maskierte Eingabe fände
//     ausgerechnet die Zeilen nicht, die das Sonderzeichen wirklich tragen.
// (3) DER ZEITRAUM RECHNET IN UTC. Ein Lead, der um 00:30 Wiener Zeit hereinkommt, steht in der
//     Liste unter dem 5. — fiele aber aus einem Filter „ab dem 5." heraus. Der Fehler träfe
//     ausgerechnet die Nachtstunden, in denen niemand nachsieht, und wäre an einer Zeile nicht zu
//     erkennen. Gemessen wird mit einem Lead, dessen UTC-Tag und Wiener Tag AUSEINANDERFALLEN.
// (4) „NUR ohne Thema" TRIFFT AUCH LEADS MIT THEMA. Die zweite Hälfte der ODER-Verknüpfung müsste
//     dafür gar nicht kaputt sein — es genügt, dass die erste greift, wenn sie nicht soll.
// (5) DIE ZUORDNUNGSSUCHE FINDET NUR EINE DER DREI QUELLEN. Die Spalte zeigt je nach Herkunft
//     Fachbetrieb, formlos genannte Firma ODER Freitext; ein Filter über nur eine davon fände die
//     Zeilen nicht, die den Suchbegriff sichtbar tragen — die Liste widerspräche ihrem Filter.
// (6) `mentioned_business` FEHLT IN DER ANTWORT. Dann bliebe die Zuordnungsspalte ausgerechnet bei
//     intern aufgenommenen Anfragen leer, obwohl dort eine Zuordnung erfasst wurde.
// (7) DER DROP HAT GRANTS ENTFERNT. Vier Funktionen sind neu angelegt worden; die Rechtefläche
//     wird NACHGEMESSEN, nicht vorausgesetzt (in B3-1 real einmal passiert). Über
//     `has_function_privilege` und NICHT über einen Aufruf als Rolle ohne Grant — ein solcher
//     Aufruf hat im CI-Image bereits einmal den Postgres-Prozess abgeschossen (Arbeitsregel 5).
// (8) DIE BESTEHENDEN FILTER SIND MITGEWANDERT UND KAPUTT. `leads_matching` wurde vollständig neu
//     angelegt; jede bestehende Bedingung ist damit potenziell betroffen.
//
// ── ISOLATION GEGEN DEN ÜBRIGEN BESTAND ─────────────────────────────────────────────────────────
// `admin_list_leads`/`admin_export_leads` zählen BESTANDSWEIT, und in derselben Datenbank liegen die
// Fixtures aller übrigen Gates. Jeder Test klammert deshalb über einen eindeutigen FIRMENnamen
// (`p_company`) — was zugleich beweist, dass der neue Filter mit einem bestehenden zusammenwirkt
// (Schnittmenge, nicht Vereinigung).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
  assertStackReachable,
  createUser,
  pool,
  runAs,
  sql,
  type TestUser,
} from './client'

const spawnedUsers: string[] = []
const spawnedLeads: string[] = []

function newEmail(prefix = 'cf'): string {
  return `${prefix}-${randomUUID()}@test.local`
}

function newSlug(prefix = 'cf'): string {
  return `${prefix}-${randomUUID()}`
}

/** Die Klammer eines Testlaufs: ein Firmenname, den kein anderes Fixture trägt. */
function newMarker(): string {
  return `CF-${randomUUID()}`
}

async function newAdmin(): Promise<TestUser> {
  const u = await createUser()
  spawnedUsers.push(u.id)
  await sql(`insert into platform.user_roles (user_id, role) values ($1, 'admin')`, [u.id])
  return u
}

type Outcome = { outcome: string; lead_id?: string }

async function capture(args: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(args)
  const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ')
  const result = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: Outcome }>(
      `select public.capture_lead(${named}) as r`,
      keys.map((k) => args[k]),
    )
    return rows[0]!.r
  })
  const id = result.lead_id!
  if (!spawnedLeads.includes(id)) spawnedLeads.push(id)
  return id
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

type LeadRow = Record<string, unknown> & { id: string; email: string }
type ListResult = { status: string; total: number; leads: LeadRow[]; filter?: string }
type ExportResult = {
  status: string
  row_count: number
  filter_summary: string
  rows: LeadRow[]
  filter?: string
}

/**
 * Liste UND Ausfuhr mit DENSELBEN Filtern — der Vergleich ist der eigentliche Zweck des Gates.
 *
 * Zurück kommen die Lead-Kennungen beider Wege. Sie müssen übereinstimmen; tun sie es nicht, zeigt
 * die Sicht etwas anderes als die Datei, die aus ihr entsteht.
 */
async function bothWays(
  admin: TestUser,
  marker: string,
  filters: Record<string, unknown>,
): Promise<{ listIds: string[]; exportIds: string[]; summary: string }> {
  const args = { p_company: marker, ...filters }
  const list = await callNamed<ListResult>(admin, 'public.admin_list_leads', args)
  const exp = await callNamed<ExportResult>(admin, 'public.admin_export_leads', args)
  expect(list.status, `Liste antwortet ok (${JSON.stringify(filters)})`).toBe('ok')
  expect(exp.status, `Ausfuhr antwortet ok (${JSON.stringify(filters)})`).toBe('ok')
  expect(list.total, 'total zählt dieselbe Menge wie die Zeilen').toBe(list.leads.length)
  return {
    listIds: list.leads.map((l) => l.id).sort(),
    exportIds: exp.rows.map((r) => r.id).sort(),
    summary: exp.filter_summary,
  }
}

/** Die Kennungen, die BEIDE Wege liefern — mit der Zusicherung, dass sie identisch sind. */
async function matching(
  admin: TestUser,
  marker: string,
  filters: Record<string, unknown>,
): Promise<string[]> {
  const { listIds, exportIds } = await bothWays(admin, marker, filters)
  expect(exportIds, 'Liste und Ausfuhr liefern dieselbe Menge').toEqual(listIds)
  return listIds
}

let admin: TestUser

beforeAll(async () => {
  await assertStackReachable()
  admin = await newAdmin()
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Rechte nach dem DROP ─────────────────────────────────────────────────────────────────────
describe('(1) Grants und Überladungen — nach dem DROP nachgemessen, nicht vorausgesetzt', () => {
  it('die zwei public-Wrapper sind weiterhin authenticated-only, mit je EINER Überladung', async () => {
    /*
     * Arbeitsregel 5: KEIN Aufruf als Rolle ohne Grant. Eine SECURITY-DEFINER-Funktion so
     * aufzurufen hat im CI-Image bereits einmal den Postgres-Prozess abgeschossen (Signal 11)
     * statt sauber mit 42501 abzulehnen. `has_function_privilege` beantwortet dieselbe Frage.
     *
     * Die Zahl der Überladungen ist der zweite Teil: Ein CREATE ohne vorheriges DROP hätte eine
     * ZWEITE Fassung erzeugt, und jeder bestehende Aufruf wäre mit „function is not unique"
     * gescheitert — der gesamte Lead-Bereich läge lahm.
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

  it('die vier platform-Funktionen sind von aussen gar nicht aufrufbar', async () => {
    const rows = await sql<{ proname: string; role: string; can: boolean }>(
      `select p.proname, r.role, has_function_privilege(r.role, p.oid, 'execute') as can
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace,
              (values ('anon'), ('authenticated'), ('service_role')) as r(role)
        where n.nspname = 'platform'
          and p.proname in ('leads_matching', 'lead_filter_summary', 'like_pattern',
                            'invalid_lead_filter')`,
    )
    expect(rows.length, 'vier Funktionen × drei Rollen, je eine Überladung').toBe(12)
    for (const row of rows) {
      expect(row.can, `platform.${row.proname} für ${row.role}`).toBe(false)
    }
  })
})

// ── (2) Die sechs Textfilter ─────────────────────────────────────────────────────────────────────
describe('(2) die sechs spaltenweisen Textfilter', () => {
  it('jede Spalte trifft NUR ihre eigene — die Verwechslung wäre am Ergebnis nicht erkennbar', async () => {
    /*
     * DER KERNTEST DIESES ABSCHNITTS. Vier Leads, bei denen derselbe Suchbegriff („MUSTER") in je
     * einem ANDEREN Feld steht. Ein Filter, der auf das falsche Feld greift, liefert dann trotzdem
     * genau eine Zeile — nur eben die falsche. Ohne diesen Aufbau wäre eine vertauschte Zuweisung
     * in `leads_matching` von aussen nicht zu sehen.
     */
    const marker = newMarker()
    const byFirst = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_first_name: 'Muster',
    })
    const byLast = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_last_name: 'Muster',
    })
    const byPhone = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_phone: '+43 1 MUSTER 99',
    })
    const byEmail = await capture({
      p_email: `muster-${randomUUID()}@test.local`,
      p_source_key: 'kontaktformular',
      p_company: marker,
    })

    expect(await matching(admin, marker, { p_first_name: 'muster' })).toEqual([byFirst])
    expect(await matching(admin, marker, { p_last_name: 'muster' })).toEqual([byLast])
    expect(await matching(admin, marker, { p_phone: 'muster' })).toEqual([byPhone])
    expect(await matching(admin, marker, { p_email: 'muster' })).toEqual([byEmail])
  })

  it('die Suche ist ein TEILtreffer und ignoriert Gross-/Kleinschreibung', async () => {
    const marker = newMarker()
    const id = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_last_name: 'von der Gruber',
    })
    for (const needle of ['gruber', 'GRUBER', 'der Gru', 'von der Gruber']) {
      expect(await matching(admin, marker, { p_last_name: needle }), needle).toEqual([id])
    }
    expect(await matching(admin, marker, { p_last_name: 'Grubner' })).toEqual([])
  })

  it('ein leeres Feld trifft keinen Suchbegriff', async () => {
    // `x ilike y` ist bei x = NULL selbst NULL. Ohne die coalesce-Behandlung verhielte sich die
    // Bedingung zwar richtig, aber ein späterer Umbau auf `not (…)` kippte sie still.
    const marker = newMarker()
    await capture({ p_email: newEmail(), p_source_key: 'kontaktformular', p_company: marker })
    expect(await matching(admin, marker, { p_phone: 'irgendwas' })).toEqual([])
  })

  it('LIKE-Sonderzeichen suchen, statt alles zu treffen', async () => {
    /*
     * B1-3: „der Admin sucht eine Adresse, er schreibt kein Muster." Ohne Maskierung träfe ein
     * getipptes `%` JEDE Zeile — der Filter sähe aus, als hätte er nichts eingegrenzt, und genau
     * das wäre der Fall. Die Gegenprobe darunter ist die wichtigere Hälfte: doppelt maskiert fände
     * die Suche ausgerechnet die Zeile nicht, die das Zeichen wirklich trägt.
     */
    const marker = newMarker()
    const withPercent = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_last_name: '50% Rabatt',
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_last_name: 'ohne Zeichen',
    })

    expect(await matching(admin, marker, { p_last_name: '%' }), '„%" trifft nicht alles').toEqual([
      withPercent,
    ])
    expect(await matching(admin, marker, { p_last_name: '50%' })).toEqual([withPercent])
    // `_` ist das zweite LIKE-Sonderzeichen: unmaskiert trifft es JEDES einzelne Zeichen.
    expect(await matching(admin, marker, { p_last_name: '_' }), '„_" trifft nicht alles').toEqual([])
  })
})

// ── (3) Die Zuordnungssuche über drei Quellen ────────────────────────────────────────────────────
describe('(3) p_assignment — EIN Suchbegriff über die drei Quellen der Zuordnungsspalte', () => {
  it('trifft Fachbetrieb, formlos genannte Firma UND den Freitext', async () => {
    /*
     * Die Spalte zeigt je nach Herkunft Verschiedenes. Ein Filter über nur eine der drei Quellen
     * fände die Zeilen nicht, die den Suchbegriff sichtbar tragen — die Liste widerspräche ihrem
     * eigenen Filter. Alle drei Leads tragen denselben Namen an je anderer Stelle.
     */
    const marker = newMarker()
    const name = `Elektro-${randomUUID().slice(0, 8)}`
    const slug = newSlug()

    const created = await callNamed<{ status: string }>(admin, 'public.admin_create_partner', {
      p_slug: slug,
      p_display_name: name,
    })
    expect(created.status).toBe('created')

    const viaPartner = await capture({
      p_email: newEmail(),
      p_source_key: 'partner-empfehlung',
      p_company: marker,
      p_partner_slug: slug,
    })
    const viaFreetext = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_referred_by_text: `Firma ${name}, glaube ich`,
    })
    const viaMentioned = await capture({
      p_email: newEmail(),
      p_source_key: 'telefonanfrage',
      p_company: marker,
    })
    const attached = await callNamed<{ status: string }>(
      admin,
      'public.admin_attach_mentioned_business',
      { p_lead_id: viaMentioned, p_name: name },
    )
    expect(attached.status, 'formlose Firma zugeordnet').toBe('ok')

    // Ein vierter Lead ohne jede Zuordnung — er darf NICHT mitkommen.
    await capture({ p_email: newEmail(), p_source_key: 'kontaktformular', p_company: marker })

    expect(await matching(admin, marker, { p_assignment: name })).toEqual(
      [viaPartner, viaFreetext, viaMentioned].sort(),
    )
  })

  it('ist etwas ANDERES als p_partner_assignment — Beobachtung ist nicht Urteil (B16-1)', async () => {
    /*
     * Ein Lead, der einen Betrieb nur im FREITEXT nennt, gilt weiterhin als „ohne Fachbetrieb":
     * genau der Fall, den ein Mensch noch entscheiden muss. Die Textsuche findet ihn trotzdem —
     * sie fragt nach dem angezeigten Text, nicht nach der bestätigten Zuordnung. Würden die beiden
     * zusammengelegt, verlöre die Liste die Fälle, an denen zu arbeiten ist.
     */
    const marker = newMarker()
    const name = `Huber-${randomUUID().slice(0, 8)}`
    const freetextOnly = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_referred_by_text: name,
    })

    expect(await matching(admin, marker, { p_assignment: name })).toEqual([freetextOnly])
    expect(
      await matching(admin, marker, { p_partner_assignment: 'assigned' }),
      'der Freitext macht daraus KEINE Zuordnung',
    ).toEqual([])
    expect(await matching(admin, marker, { p_partner_assignment: 'unassigned' })).toEqual([
      freetextOnly,
    ])
  })
})

// ── (4) Herkunfts-Auswahl ────────────────────────────────────────────────────────────────────────
describe('(4) p_source_keys — die Mengenform der Herkunft', () => {
  it('mehrere Schlüssel ergeben die Vereinigung, und p_source_key wirkt weiter daneben', async () => {
    const marker = newMarker()
    const viaForm = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
    })
    const viaPhone = await capture({
      p_email: newEmail(),
      p_source_key: 'telefonanfrage',
      p_company: marker,
    })
    const viaList = await capture({
      p_email: newEmail(),
      p_source_key: 'warteliste',
      p_company: marker,
    })

    expect(await matching(admin, marker, { p_source_keys: ['telefonanfrage'] })).toEqual([viaPhone])
    expect(
      await matching(admin, marker, { p_source_keys: ['kontaktformular', 'warteliste'] }),
    ).toEqual([viaForm, viaList].sort())

    // Beide Formen sind eigenständige UND-Bedingungen — die Schnittmenge, nicht die Vereinigung.
    expect(
      await matching(admin, marker, {
        p_source_keys: ['kontaktformular', 'warteliste'],
        p_source_key: 'warteliste',
      }),
    ).toEqual([viaList])
  })

  it('ein LEERES Array ist kein Filter, sondern die Abwesenheit eines Filters', async () => {
    /*
     * Nicht die leere Menge. „0 Treffer, weil nichts angekreuzt ist" wäre eine Sackgasse, aus der
     * die Liste selbst nicht mehr herausführt — man sähe keine Zeile und keinen Grund dafür.
     */
    const marker = newMarker()
    const id = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
    })
    expect(await matching(admin, marker, { p_source_keys: [] })).toEqual([id])
  })

  it('ein unbekannter Schlüssel wird ABGELEHNT, nicht still verworfen', async () => {
    for (const fn of ['public.admin_list_leads', 'public.admin_export_leads']) {
      const res = await callNamed<{ status: string; filter: string }>(admin, fn, {
        p_source_keys: ['kontaktformular', 'gibtsnicht'],
      })
      expect(res.status, fn).toBe('invalid_filter')
      expect(res.filter, fn).toBe('source_keys')
    }
  })
})

// ── (5) Thema ────────────────────────────────────────────────────────────────────────────────────
describe('(5) p_thema_keys und p_thema_none', () => {
  it('die Auswahl trifft die gewählten Themen, „ohne Thema" NUR die themenlosen', async () => {
    const marker = newMarker()
    const peak = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_thema: 'peakShaving',
    })
    const esg = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_thema: 'esg',
    })
    const none = await capture({
      p_email: newEmail(),
      p_source_key: 'warteliste',
      p_company: marker,
    })

    expect(await matching(admin, marker, { p_thema_keys: ['peakShaving'] })).toEqual([peak])
    expect(await matching(admin, marker, { p_thema_keys: ['peakShaving', 'esg'] })).toEqual(
      [peak, esg].sort(),
    )
    /*
     * DIE WICHTIGERE HÄLFTE: „ohne Thema" darf die beiden mit Thema NICHT mitnehmen. Die
     * ODER-Verknüpfung müsste dafür nicht kaputt sein — es genügt, dass ihr erster Zweig greift,
     * wenn er nicht soll.
     */
    expect(await matching(admin, marker, { p_thema_none: true })).toEqual([none])
    // Beides zusammen ist die Vereinigung — genau das, was eine Ankreuzliste bedeutet.
    expect(await matching(admin, marker, { p_thema_keys: ['esg'], p_thema_none: true })).toEqual(
      [esg, none].sort(),
    )
  })

  it('ein unbekannter Themenschlüssel trifft nichts — und wird NICHT abgelehnt', async () => {
    /*
     * `platform.leads.thema` trägt bewusst KEINEN CHECK (die Werteliste ist datengetrieben aus der
     * Leistungs-Taxonomie). Die Datenbank hat damit gar kein Vokabular, gegen das sie prüfen
     * könnte — „trifft nichts" ist hier die richtige Antwort, nicht `invalid_filter`.
     */
    const marker = newMarker()
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_thema: 'peakShaving',
    })
    const { listIds } = await bothWays(admin, marker, { p_thema_keys: ['gibtsNichtMehr'] })
    expect(listIds).toEqual([])
  })
})

// ── (6) Einwilligungen als Mehrfachauswahl ───────────────────────────────────────────────────────
describe('(6) p_consent_purposes und p_consent_states', () => {
  it('mehrere Zustände ergeben die Vereinigung, „none" bleibt die Umkehrung', async () => {
    const marker = newMarker()
    const confirmed = await capture({
      p_email: newEmail(),
      p_source_key: 'rechnerergebnis',
      p_company: marker,
      p_purpose: 'result_delivery',
    })
    const pending = await capture({
      p_email: newEmail(),
      p_source_key: 'warteliste',
      p_company: marker,
      p_purpose: 'marketing_email',
      p_token_hash: randomUUID(),
      p_token_expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    })
    const without = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
    })

    expect(await matching(admin, marker, { p_consent_states: ['confirmed'] })).toEqual([confirmed])
    expect(await matching(admin, marker, { p_consent_states: ['pending'] })).toEqual([pending])
    expect(await matching(admin, marker, { p_consent_states: ['confirmed', 'pending'] })).toEqual(
      [confirmed, pending].sort(),
    )
    expect(await matching(admin, marker, { p_consent_states: ['none'] })).toEqual([without])
    /*
     * „keine ODER bestätigt" — der Fall, der die Struktur der Bedingung prüft: BEIDE Zweige müssen
     * greifen. Wäre `none` bloss ein weiterer Vergleichswert, käme hier nur `confirmed` zurück.
     */
    expect(await matching(admin, marker, { p_consent_states: ['none', 'confirmed'] })).toEqual(
      [without, confirmed].sort(),
    )
  })

  it('der Zweck grenzt zusätzlich ein, und „none" heisst dann „keine für DIESEN Zweck"', async () => {
    const marker = newMarker()
    const marketing = await capture({
      p_email: newEmail(),
      p_source_key: 'warteliste',
      p_company: marker,
      p_purpose: 'marketing_email',
      p_token_hash: randomUUID(),
      p_token_expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    })
    const delivery = await capture({
      p_email: newEmail(),
      p_source_key: 'rechnerergebnis',
      p_company: marker,
      p_purpose: 'result_delivery',
    })

    expect(await matching(admin, marker, { p_consent_purposes: ['marketing_email'] })).toEqual([
      marketing,
    ])
    expect(
      await matching(admin, marker, {
        p_consent_purposes: ['marketing_email'],
        p_consent_states: ['none'],
      }),
      'der Lead mit NUR result_delivery hat keine Marketing-Einwilligung',
    ).toEqual([delivery])
  })

  it('unbekannte Zwecke und Zustände werden ABGELEHNT', async () => {
    for (const [args, filter] of [
      [{ p_consent_purposes: ['quatsch'] }, 'consent_purposes'],
      [{ p_consent_states: ['confirmed', 'quatsch'] }, 'consent_states'],
    ] as const) {
      for (const fn of ['public.admin_list_leads', 'public.admin_export_leads']) {
        const res = await callNamed<{ status: string; filter: string }>(admin, fn, args)
        expect(res.status, `${fn} ${JSON.stringify(args)}`).toBe('invalid_filter')
        expect(res.filter).toBe(filter)
      }
    }
  })
})

// ── (7) Zeitraum ─────────────────────────────────────────────────────────────────────────────────
describe('(7) p_created_from / p_created_to', () => {
  it('beide Grenzen zählen mit, und der Zeitraum rechnet in WIENER Ortszeit', async () => {
    /*
     * DER KERNTEST DIESES ABSCHNITTS, und er lässt sich nur mit einem Lead führen, dessen UTC-Tag
     * und Wiener Tag AUSEINANDERFALLEN: 22:30 UTC am 4. ist in Wien bereits der 5. (Sommerzeit,
     * UTC+2). Die Liste ZEIGT den 5. — ein Filter, der in UTC rechnet, würde ihn unter „ab dem 5."
     * nicht liefern und unter „bis zum 4." fälschlich schon. Beide Richtungen werden gemessen.
     */
    const marker = newMarker()
    const early = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
    })
    const late = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
    })
    await sql(`update platform.leads set created_at = $2 where id = $1`, [
      early,
      '2026-08-04 12:00:00+00',
    ])
    await sql(`update platform.leads set created_at = $2 where id = $1`, [
      late,
      '2026-08-04 22:30:00+00', // = 5.8. 00:30 Wiener Zeit
    ])

    // Gegenprobe, dass das Fixture wirklich die Zeitzonenfalle stellt.
    const shown = await sql<{ wien: string; utc: string }>(
      `select (created_at at time zone 'Europe/Vienna')::date::text as wien,
              created_at::date::text as utc
         from platform.leads where id = $1`,
      [late],
    )
    expect(shown[0]!.wien, 'in Wien der 5.').toBe('2026-08-05')
    expect(shown[0]!.utc, 'in UTC noch der 4.').toBe('2026-08-04')

    expect(
      await matching(admin, marker, { p_created_from: '2026-08-05' }),
      'ab dem 5. — der Lead, den die Liste unter dem 5. zeigt',
    ).toEqual([late])
    expect(
      await matching(admin, marker, { p_created_to: '2026-08-04' }),
      'bis zum 4. — der Lead vom 5. gehört NICHT dazu',
    ).toEqual([early])
    expect(
      await matching(admin, marker, { p_created_from: '2026-08-04', p_created_to: '2026-08-04' }),
      'ein einzelner Tag, beide Grenzen einschliessend',
    ).toEqual([early])
    expect(
      await matching(admin, marker, { p_created_from: '2026-08-04', p_created_to: '2026-08-05' }),
    ).toEqual([early, late].sort())
  })

  it('ein verdrehter Zeitraum wird ABGELEHNT statt leer beantwortet', async () => {
    /*
     * „ab 10.8. bis 1.8." ergibt per Konstruktion eine leere Menge, und die läse sich als „in
     * diesem Zeitraum kam nichts herein". Dieselbe Überlegung wie beim widersprüchlichen
     * Partner-Paar (B18-5).
     */
    for (const fn of ['public.admin_list_leads', 'public.admin_export_leads']) {
      const res = await callNamed<{ status: string; filter: string }>(admin, fn, {
        p_created_from: '2026-08-10',
        p_created_to: '2026-08-01',
      })
      expect(res.status, fn).toBe('invalid_filter')
      expect(res.filter, fn).toBe('created_range')
    }
  })
})

// ── (8) Die formlose Firmenerwähnung in der Antwort ──────────────────────────────────────────────
describe('(8) admin_list_leads liefert mentioned_business_id und -name', () => {
  it('beide Felder stehen je Zeile — ohne sie bliebe die Zuordnungsspalte leer', async () => {
    /*
     * Bis zu dieser Migration stand die formlose Firmenerwähnung NUR in `admin_get_lead`, also nur
     * auf der Detailseite. Die Zuordnungsspalte der Liste zeigt sie bei intern aufgenommenen
     * Anfragen — ohne diese zwei Felder wäre die Zelle ausgerechnet dort leer, wo eine Zuordnung
     * tatsächlich erfasst wurde.
     */
    const marker = newMarker()
    const name = `Formlos-${randomUUID().slice(0, 8)}`
    const id = await capture({
      p_email: newEmail(),
      p_source_key: 'telefonanfrage',
      p_company: marker,
    })
    await callNamed(admin, 'public.admin_attach_mentioned_business', {
      p_lead_id: id,
      p_name: name,
    })

    const list = await callNamed<ListResult>(admin, 'public.admin_list_leads', {
      p_company: marker,
    })
    const row = list.leads.find((l) => l.id === id)!
    expect(row.mentioned_business_id, 'die Kennung fährt mit').toBeTruthy()
    expect(row.mentioned_business_name, 'und der Name, ohne zweiten Aufruf').toBe(name)
  })

  it('ohne Zuordnung sind beide null — „nichts erfasst" ist eine eigene Aussage', async () => {
    const marker = newMarker()
    const id = await capture({
      p_email: newEmail(),
      p_source_key: 'telefonanfrage',
      p_company: marker,
    })
    const list = await callNamed<ListResult>(admin, 'public.admin_list_leads', { p_company: marker })
    const row = list.leads.find((l) => l.id === id)!
    expect(row.mentioned_business_id).toBeNull()
    expect(row.mentioned_business_name).toBeNull()
  })

  it('der EXPORT bekommt sie bewusst NICHT — ein Filter ändert Zeilen, eine Spalte das Format', async () => {
    /*
     * Die Entscheidung der B19-Nachbesserung, wörtlich übernommen: „eine zusätzliche Spalte im
     * Export änderte ein Dateiformat, auf das ausserhalb dieses Repos jemand baut." Der Test hält
     * die Abwesenheit fest, damit sie beim nächsten Umbau eine Entscheidung bleibt und nicht
     * beiläufig kippt.
     */
    const marker = newMarker()
    const id = await capture({
      p_email: newEmail(),
      p_source_key: 'telefonanfrage',
      p_company: marker,
    })
    await callNamed(admin, 'public.admin_attach_mentioned_business', {
      p_lead_id: id,
      p_name: `Formlos-${randomUUID().slice(0, 8)}`,
    })
    const exp = await callNamed<ExportResult>(admin, 'public.admin_export_leads', {
      p_company: marker,
    })
    const row = exp.rows[0]!
    expect(Object.keys(row)).not.toContain('mentioned_business_id')
    expect(Object.keys(row)).not.toContain('mentioned_business_name')
  })
})

// ── (9) Das Ausfuhrprotokoll ─────────────────────────────────────────────────────────────────────
describe('(9) lead_filter_summary benennt die neuen Filter', () => {
  it('jeder gesetzte Spaltenfilter erscheint im Protokoll', async () => {
    /*
     * Ein Protokoll, das den angewandten Filter nicht nennt, ist bei einer Datei, die das System
     * verlässt, schlimmer als keines: Es behauptet Vollständigkeit. Geprüft wird über den ECHTEN
     * Ausfuhrweg, nicht über einen direkten Aufruf der Funktion — der Eintrag entsteht dort.
     */
    const marker = newMarker()
    await capture({ p_email: newEmail(), p_source_key: 'kontaktformular', p_company: marker })

    const { summary } = await bothWays(admin, marker, {
      p_last_name: 'Gruber',
      p_phone: '+43',
      p_assignment: 'Raymann',
      p_source_keys: ['kontaktformular'],
      p_thema_none: true,
      p_created_from: '2026-08-01',
      p_created_to: '2026-08-31',
      p_consent_states: ['confirmed'],
    })

    for (const needle of [
      'Name enthält: Gruber',
      'Telefon enthält: +43',
      'Zuordnung enthält: Raymann',
      'Herkunft (Auswahl): kontaktformular',
      'ohne Thema',
      'Eingegangen ab 01.08.2026',
      'Eingegangen bis 31.08.2026',
      'Einwilligungszustände: confirmed',
    ]) {
      expect(summary, `„${needle}" steht im Protokoll`).toContain(needle)
    }
  })

  it('ohne jeden Filter bleibt es bei „alle (kein Filter gesetzt)"', async () => {
    const summary = (
      await sql<{ s: string }>(`select platform.lead_filter_summary() as s`)
    )[0]!.s
    expect(summary).toBe('alle (kein Filter gesetzt) — ohne gesperrte und anonymisierte Zeilen')
  })
})

// ── (10) Regression der bestehenden Filter ───────────────────────────────────────────────────────
describe('(10) die bestehenden Filter sind mitgewandert und wirken unverändert', () => {
  it('Status, Branche, PLZ-Präfix, Freitext und die Partner-Zuordnung greifen weiter', async () => {
    /*
     * `leads_matching` wurde vollständig neu angelegt — jede bestehende Bedingung ist damit
     * potenziell betroffen. Die Probe läuft über mehrere Bauabschnitte hinweg (B1-3, B2-1, B3-1,
     * B16-1, B18-5), weil ein Abschreibfehler beim Neuanlegen genau eine Zeile treffen würde.
     */
    const marker = newMarker()
    const slug = newSlug()
    await callNamed(admin, 'public.admin_create_partner', {
      p_slug: slug,
      p_display_name: `Elektro ${slug}`,
    })

    const target = await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_industry: 'kuehlhaus',
      p_postal_code: '1100',
      p_partner_slug: slug,
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_industry: 'handel',
      p_postal_code: '5020',
    })

    expect(await matching(admin, marker, { p_industry: 'kuehlhaus' })).toEqual([target])
    expect(await matching(admin, marker, { p_postal_prefix: '11' })).toEqual([target])
    expect(await matching(admin, marker, { p_partner_slug: slug })).toEqual([target])
    expect(await matching(admin, marker, { p_partner_assignment: 'assigned' })).toEqual([target])
    expect(await matching(admin, marker, { p_search: marker })).toHaveLength(2)
    expect(await matching(admin, marker, { p_status: 'new' })).toHaveLength(2)
  })

  it('unbekannte Werte der BESTEHENDEN Filter werden weiterhin abgelehnt', async () => {
    for (const [args, filter] of [
      [{ p_status: 'quatsch' }, 'status'],
      [{ p_metering_type: 'quatsch' }, 'metering_type'],
      [{ p_postal_prefix: '11a' }, 'postal_prefix'],
      [{ p_partner_slug: 'gibtsnicht' }, 'partner_slug'],
      [{ p_partner_assignment: 'quatsch' }, 'partner_assignment'],
      [{ p_consent_status: 'quatsch' }, 'consent_status'],
    ] as const) {
      const res = await callNamed<{ status: string; filter: string }>(
        admin,
        'public.admin_list_leads',
        args,
      )
      expect(res.status, JSON.stringify(args)).toBe('invalid_filter')
      expect(res.filter, JSON.stringify(args)).toBe(filter)
    }
  })
})

// ── (11) Kombination ─────────────────────────────────────────────────────────────────────────────
describe('(11) mehrere Spaltenfilter zugleich', () => {
  it('ergeben die Schnittmenge, nicht die Vereinigung', async () => {
    /*
     * Die Frage, die ein Mensch an eine Excel-artige Tabelle stellt: „Firma X UND Herkunft Y UND
     * Thema Z". Eine ODER-Verknüpfung lieferte eine GRÖSSERE Menge — und die sähe plausibel aus.
     */
    const marker = newMarker()
    const hit = await capture({
      p_email: newEmail(),
      p_source_key: 'telefonanfrage',
      p_company: marker,
      p_last_name: 'Gruber',
      p_thema: 'peakShaving',
    })
    // Je ein Lead, der GENAU EINE Bedingung verfehlt.
    await capture({
      p_email: newEmail(),
      p_source_key: 'kontaktformular',
      p_company: marker,
      p_last_name: 'Gruber',
      p_thema: 'peakShaving',
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'telefonanfrage',
      p_company: marker,
      p_last_name: 'Huber',
      p_thema: 'peakShaving',
    })
    await capture({
      p_email: newEmail(),
      p_source_key: 'telefonanfrage',
      p_company: marker,
      p_last_name: 'Gruber',
      p_thema: 'esg',
    })

    expect(
      await matching(admin, marker, {
        p_source_keys: ['telefonanfrage'],
        p_last_name: 'gruber',
        p_thema_keys: ['peakShaving'],
      }),
    ).toEqual([hit])
  })
})
