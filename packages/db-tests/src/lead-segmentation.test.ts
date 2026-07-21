// DB-Gate für die Segmentierungsspalten und den erweiterten Erfassungspfad (B3-1)
// (Migration 20260721210000_create_lead_segmentation_columns.sql).
//
// B1 hat den Lead-Bestand gebaut, B3-1 gibt ihm die Dimensionen, auf denen B2 segmentiert. Drei
// Dinge daran sind still fehlbar und werden deshalb hier gepinnt:
//
//   (1) DIE CHECKS — eine PLZ wie „1100 Wien" oder ein Jahresverbrauch von 0 fällt in keiner
//       Auswertung auf, sondern nur aus ihr heraus. Die Datenbank muss beides ablehnen, nicht die
//       Oberfläche.
//   (2) DIE ZUSAMMENFÜHRUNG — dieselbe Person wird über mehrere Einstiegspunkte erfasst, die
//       unterschiedliche Felder erheben. Ohne die Regel „ein null-Wert lässt den bestehenden
//       unberührt" löscht der ZWEITE Kontakt still, was der erste erbracht hat. Das ist der
//       wahrscheinlichste stille Datenverlust im gesamten Erfassungspfad: kein Fehler, kein Log,
//       sichtbar erst beim ersten Segmentierungslauf an einer unerklärlich kleinen Menge.
//   (3) DIE ZWECKBINDUNG — Versorger und Vertragsende werden für GENAU EINEN Zweck erhoben. Fällt
//       er weg, müssen die Daten fallen; ein technisch abgelaufener Token darf das NICHT auslösen.
//
// Die Anonymisierungs-Seite von B3-1 (welche der sechs Spalten überleben, und dass keine davon an
// einem anonymisierten Lead noch änderbar ist) steht bewusst im B1-3-Gate
// `lead-admin-wrappers.test.ts` — dort, wo die übrigen Anonymisierungs-Invarianten schon liegen.
//
// ── AUFRÄUMEN ────────────────────────────────────────────────────────────────────────────────────
// Wie in den B1-Gates: Leads hängen nicht an auth.users, es gibt keinen Cascade von aussen. Jeder
// Test räumt seine Leads selbst ab (Cascade nimmt die Einwilligungen mit), privilegiert als postgres
// — service_role hat bewusst kein delete-Grant.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Die fünf Einstiegspunkte, die B3-1 ergänzt — B3-2 kommt dadurch ohne eigene Migration aus. */
const B3_1_SOURCES = [
  'betroffenheits-check',
  'rechnerergebnis',
  'artikel-inline',
  'branchenseite',
  'vertragsablauf-landing',
] as const

/** Die fünf Zeilen aus B1-1. An ihnen hängt die Herkunft bestehender Leads (FK) — sie sind tabu. */
const B1_1_SOURCES = [
  'kontaktformular',
  'schnellrechner',
  'wko-postaktion-qr',
  'fachvortrag',
  'direktkontakt',
] as const

const spawnedLeads: string[] = []

type Outcome = { outcome: string; lead_id?: string; consent_id?: string }

function newEmail(): string {
  return `b31-${randomUUID()}@test.local`
}

/** So bildet der Anwendungscode Klartext-Token → gespeicherter Wert ab (lib/leads/token-crypto.ts). */
function tokenHash(token: string = randomUUID()): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Ruft `capture_lead` mit BENANNTEN Parametern auf — genauso, wie supabase-js es tut
 * (`lib/leads/store.ts`). Damit prüft der Test zugleich, dass die sechs neuen Parameter wirklich
 * angehängt sind und kein bestehender Aufruf über die Position verrutscht.
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

/** Der Segmentierungs-Ausschnitt einer Lead-Zeile. `date` als TEXT — sonst vergleicht der Test
 *  zwei Date-Objekte statt zweier Datumsangaben (dieselbe Falle wie beim B1-3-Gate). */
async function segments(leadId: string) {
  const rows = await sql<{
    industry: string | null
    postal_code: string | null
    annual_consumption_kwh: number | null
    metering_type: string | null
    supplier: string | null
    contract_end_date: string | null
  }>(
    `select industry, postal_code, annual_consumption_kwh, metering_type, supplier,
            contract_end_date::text as contract_end_date
       from platform.leads where id = $1`,
    [leadId],
  )
  return rows[0]!
}

/** Legt eine Einwilligung auf dem realen Schreibpfad an (service_role, committed). */
async function insertConsent(fields: {
  leadId: string
  purpose: string
  status?: string
  confirmedAt?: string | null
  tokenExpiresIn?: string | null
}): Promise<string> {
  const textRows = await sql<{ id: string }>(
    `select id from platform.consent_texts where purpose = $1 and version = 1 and locale = 'de'`,
    [fields.purpose],
  )
  return runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `insert into platform.consents
         (lead_id, consent_text_id, source_key, status, confirmed_at, token_hash, token_expires_at)
       values ($1, $2, 'kontaktformular', $3, $4, $5,
               case when $6::text is null then null else now() + $6::interval end)
       returning id`,
      [
        fields.leadId,
        textRows[0]!.id,
        fields.status ?? 'pending',
        fields.confirmedAt ?? null,
        fields.tokenExpiresIn === undefined ? null : tokenHash(),
        fields.tokenExpiresIn ?? null,
      ],
    )
    return rows[0]!.id
  })
}

async function callWrapper<T = Outcome>(text: string, params: unknown[] = []): Promise<T> {
  return runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(text, params)
    return rows[0]!.r
  })
}

/** Ein Lead MIT allen sechs Merkmalen, angelegt über den echten Erfassungspfad. */
async function captureFullLead(): Promise<{ id: string; email: string }> {
  const email = newEmail()
  const res = await capture({
    p_email: email,
    p_source_key: 'betroffenheits-check',
    p_industry: 'kuehlhaus',
    p_postal_code: '1100',
    p_annual_consumption_kwh: 180_000,
    p_metering_type: 'netzebene_7',
    p_supplier: 'Wien Energie',
    p_contract_end_date: '2027-03-31',
  })
  return { id: res.lead_id!, email }
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
})

afterAll(async () => {
  await pool.end()
})

// ── (0) Vokabular ────────────────────────────────────────────────────────────────────────────────
describe('Vokabular', () => {
  it('platform.industry trägt genau die zehn vereinbarten Werte', async () => {
    const rows = await sql<{ label: string }>(
      `select e.enumlabel as label
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'platform' and t.typname = 'industry'
        order by e.enumsortorder`,
    )
    expect(rows.map((r) => r.label)).toEqual([
      'baeckerei',
      'gastronomie',
      'handel',
      'hotellerie',
      'tischlerei',
      'landwirtschaft',
      'kuehlhaus',
      'metallverarbeitung',
      'buero_dienstleistung',
      'sonstige',
    ])
  })

  it('die fünf neuen Einstiegspunkte sind da — und die fünf aus B1-1 unverändert', async () => {
    const rows = await sql<{ key: string }>(`select key from platform.lead_sources`)
    const keys = new Set(rows.map((r) => r.key))
    for (const key of B3_1_SOURCES) {
      expect(keys.has(key), `${key} fehlt — B3-2 könnte damit keinen Lead anlegen (FK)`).toBe(true)
    }
    for (const key of B1_1_SOURCES) {
      expect(keys.has(key), `${key} aus B1-1 darf nicht verschwinden (FK bestehender Leads)`).toBe(
        true,
      )
    }
  })
})

// ── (1)/(2) Die CHECKs ───────────────────────────────────────────────────────────────────────────
describe('Wertebereiche', () => {
  it('die PLZ muss aus GENAU vier Ziffern bestehen', async () => {
    // Leerstring und reine Leerzeichen fehlen hier bewusst: die normalisiert der Wrapper zu null
    // („keine Angabe"), sie sind kein ungültiger Wert. Der Fall wird unten eigens geprüft.
    for (const bad of ['110', '11000', '1100 Wien', 'A-1100', '1a00']) {
      await expect(
        capture({
          p_email: newEmail(),
          p_source_key: 'betroffenheits-check',
          p_postal_code: bad,
        }),
        `„${bad}" darf nicht durchgehen`,
      ).rejects.toThrow(/postal_code/)
    }
  })

  it('ein leer abgesendetes PLZ-Feld ist keine Angabe, sondern null', async () => {
    // Ohne diese Normalisierung stünde ein '' im Bestand: kein null, überlebt jedes COALESCE und
    // überschriebe damit eine früher erhobene, echte Angabe.
    const lead = await captureFullLead()
    await capture({
      p_email: lead.email,
      p_source_key: 'rechnerergebnis',
      p_postal_code: '   ',
      p_supplier: '',
    })

    const after = await segments(lead.id)
    expect(after.postal_code).toBe('1100')
    expect(after.supplier).toBe('Wien Energie')
  })

  it('ein Jahresverbrauch von 0 oder weniger wird abgewiesen', async () => {
    for (const bad of [0, -1, -180_000]) {
      await expect(
        capture({
          p_email: newEmail(),
          p_source_key: 'betroffenheits-check',
          p_annual_consumption_kwh: bad,
        }),
        `${bad} kWh ist keine sparsame, sondern eine fehlende Angabe`,
      ).rejects.toThrow(/annual_consumption_kwh/)
    }
  })

  it('eine unbekannte Messart wird abgewiesen statt still bereinigt', async () => {
    await expect(
      capture({
        p_email: newEmail(),
        p_source_key: 'betroffenheits-check',
        p_metering_type: 'vielleicht',
      }),
    ).rejects.toThrow(/metering_type/)
  })
})

// ── (3)/(4)/(5) Zusammenführung ──────────────────────────────────────────────────────────────────
describe('capture_lead — Zusammenführung bei wiederholter Erfassung', () => {
  it('schreibt alle sechs neuen Felder', async () => {
    const lead = await captureFullLead()

    expect(await segments(lead.id)).toEqual({
      industry: 'kuehlhaus',
      postal_code: '1100',
      annual_consumption_kwh: 180_000,
      metering_type: 'netzebene_7',
      supplier: 'Wien Energie',
      contract_end_date: '2027-03-31',
    })
  })

  it('DER KERNFALL: ein zweiter Aufruf mit null-Werten löscht NICHTS', async () => {
    const lead = await captureFullLead()
    const before = await segments(lead.id)

    // Zweiter Einstiegspunkt, der nur die E-Mail erhebt — exakt der Fall, in dem ohne die
    // COALESCE-Semantik alles verlorenginge, was der erste Kontakt erbracht hat.
    const second = await capture({ p_email: lead.email, p_source_key: 'artikel-inline' })
    expect(second.lead_id, 'derselbe Lead, kein zweiter').toBe(lead.id)

    expect(await segments(lead.id)).toEqual(before)
  })

  it('ergänzt sich über verschiedene Einstiegspunkte, statt sich zu überschreiben', async () => {
    // Der Betroffenheits-Check liefert Branche + Verbrauch, die Vertragsablauf-Seite Versorger +
    // Ablaufdatum. Am Ende muss BEIDES am selben Lead stehen.
    const email = newEmail()
    const first = await capture({
      p_email: email,
      p_source_key: 'betroffenheits-check',
      p_industry: 'tischlerei',
      p_annual_consumption_kwh: 42_000,
      p_metering_type: 'netzebene_7',
    })
    await capture({
      p_email: email,
      p_source_key: 'vertragsablauf-landing',
      p_supplier: 'EVN',
      p_contract_end_date: '2027-09-30',
    })

    expect(await segments(first.lead_id!)).toEqual({
      industry: 'tischlerei',
      postal_code: null,
      annual_consumption_kwh: 42_000,
      metering_type: 'netzebene_7',
      supplier: 'EVN',
      contract_end_date: '2027-09-30',
    })
  })

  it('ein übergebener Wert überschreibt den bestehenden', async () => {
    const lead = await captureFullLead()

    await capture({
      p_email: lead.email,
      p_source_key: 'vertragsablauf-landing',
      p_industry: 'metallverarbeitung',
      p_postal_code: '4020',
      p_annual_consumption_kwh: 250_000,
      p_metering_type: 'leistungsgemessen',
      p_supplier: 'Energie AG',
      p_contract_end_date: '2028-01-31',
    })

    expect(await segments(lead.id)).toEqual({
      industry: 'metallverarbeitung',
      postal_code: '4020',
      annual_consumption_kwh: 250_000,
      metering_type: 'leistungsgemessen',
      supplier: 'Energie AG',
      contract_end_date: '2028-01-31',
    })
  })

  it('die bestehenden B1-2-Parameter verhalten sich unverändert', async () => {
    // Regression: die sechs neuen Parameter hängen HINTEN an — Position und Semantik der alten
    // dürfen sich nicht verschoben haben. Identitätsfelder folgen weiter der UMGEKEHRTEN
    // Vorrangregel (Bestand gewinnt), und der Erfassungs-Ablauf ist derselbe.
    const email = newEmail()
    const hash = tokenHash()
    const first = await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_purpose: 'marketing_email',
      p_token_hash: hash,
      p_token_expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      p_company: 'Kühlhaus Muster GmbH',
      p_phone: '+43 1 0000',
    })
    expect(first.outcome).toBe('consent_created')

    const second = await capture({
      p_email: email,
      p_source_key: 'kontaktformular',
      p_purpose: 'marketing_email',
      p_token_hash: tokenHash(),
      p_token_expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      p_company: 'Tippfehler GmbH',
    })
    expect(second.outcome, 'keine zweite offene Bestätigung').toBe('consent_already_pending')

    const row = await sql<{ company: string; phone: string }>(
      `select company, phone from platform.leads where id = $1`,
      [first.lead_id],
    )
    expect(row[0]!.company, 'Bestand gewinnt bei Identitätsfeldern').toBe('Kühlhaus Muster GmbH')
    expect(row[0]!.phone).toBe('+43 1 0000')
  })
})

// ── (6)/(7) Zweckbindung ─────────────────────────────────────────────────────────────────────────
describe('Zweckbindung von Versorger und Vertragsende', () => {
  it('der Widerruf von contract_expiry_reminder nullt supplier und contract_end_date', async () => {
    const lead = await captureFullLead()
    await insertConsent({
      leadId: lead.id,
      purpose: 'contract_expiry_reminder',
      status: 'confirmed',
      confirmedAt: 'now()',
    })

    await callWrapper(`select public.withdraw_consent($1, 'contract_expiry_reminder') as r`, [
      lead.id,
    ])

    const after = await segments(lead.id)
    expect(after.supplier, 'ohne Zweck keine Grundlage für die Daten').toBeNull()
    expect(after.contract_end_date).toBeNull()
    // Alles andere bleibt: der Widerruf betrifft DIESE Daten, nicht den Lead.
    expect(after.industry).toBe('kuehlhaus')
    expect(after.postal_code).toBe('1100')
    expect(after.annual_consumption_kwh).toBe(180_000)
    expect(after.metering_type).toBe('netzebene_7')
  })

  it('der Widerruf von marketing_email lässt beide Felder unberührt', async () => {
    const lead = await captureFullLead()
    await insertConsent({
      leadId: lead.id,
      purpose: 'marketing_email',
      status: 'confirmed',
      confirmedAt: 'now()',
    })

    await callWrapper(`select public.withdraw_consent($1, 'marketing_email') as r`, [lead.id])

    const after = await segments(lead.id)
    // „Keine Werbung" heisst nicht „vergesst meinen Vertrag" — anderer Zweck, andere Rechtsfolge.
    expect(after.supplier).toBe('Wien Energie')
    expect(after.contract_end_date).toBe('2027-03-31')
  })

  it('ein ABGELAUFENER Token räumt die Felder NICHT ab', async () => {
    // Der Unterschied ist fachlich: ein verfallener Bestätigungs-Token ist ein technischer Zustand
    // (B1-2 setzt expired lazy), kein Widerruf. Die Person hat nichts zurückgenommen und kann die
    // Bestätigung erneut anfordern — dann wären die Daten weg, die sie gerade angegeben hat.
    const email = newEmail()
    const hash = tokenHash()
    const res = await capture({
      p_email: email,
      p_source_key: 'vertragsablauf-landing',
      p_purpose: 'contract_expiry_reminder',
      p_token_hash: hash,
      p_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
      p_supplier: 'Wien Energie',
      p_contract_end_date: '2027-03-31',
    })
    expect(res.outcome).toBe('consent_created')

    const confirm = await callWrapper<{ outcome: string }>(
      `select public.confirm_consent($1) as r`,
      [hash],
    )
    expect(confirm.outcome).toBe('expired')

    const after = await segments(res.lead_id!)
    expect(after.supplier).toBe('Wien Energie')
    expect(after.contract_end_date).toBe('2027-03-31')
  })

  it('der vollständige Rückzug räumt die Felder ebenfalls ab — ohne zweiten Mechanismus', async () => {
    // suppress_email_and_withdraw_all widerruft ALLE Zwecke, also auch contract_expiry_reminder.
    // Der Trigger greift dadurch von selbst; es braucht keine zweite Sonderbehandlung.
    const lead = await captureFullLead()
    await insertConsent({
      leadId: lead.id,
      purpose: 'contract_expiry_reminder',
      status: 'confirmed',
      confirmedAt: 'now()',
    })

    await callWrapper(`select public.suppress_email_and_withdraw_all($1) as r`, [lead.id])
    await sql(
      `delete from platform.email_suppressions where email_hash = platform.email_hash($1)`,
      [lead.email],
    )

    const after = await segments(lead.id)
    expect(after.supplier).toBeNull()
    expect(after.contract_end_date).toBeNull()
  })
})
