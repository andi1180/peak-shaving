// DB-Gate für den Einfach-Opt-in-Abschluss (B3-2)
// (Migration 20260722090000_lead_capture_single_opt_in.sql).
//
// Beweist auf DB-Ebene genau das, worauf der neue Erfassungspfad baut:
//   (1) eine 'result_delivery'-Einwilligung entsteht SOFORT als confirmed, mit gesetztem
//       confirmed_at und dem neuen outcome 'consent_confirmed';
//   (2) platform.has_confirmed_consent liefert dafür true, OHNE dass ein Bestätigungsschritt
//       stattgefunden hat — genau die Versandprüfung, die vorher blockierte;
//   (3) ein trotzdem übergebener Token wird NICHT gespeichert (weder Hash noch Ablauf);
//   (4) 'marketing_email' entsteht unverändert als pending mit Token (B1-2-Regression);
//   (5) der Backfill stellt bestehende pending-Zeilen nicht bestätigungspflichtiger Zwecke um und
//       lässt alle anderen unberührt — idempotent.
//
// ── WARUM (5) DIE SQL-ANWEISUNG ERNEUT AUSFÜHRT ──────────────────────────────────────────────────
// Der Backfill der Migration ist längst gelaufen, wenn dieser Test startet, und `capture_lead` kann
// die Alt-Zeilen, die er aufräumt, gar nicht mehr erzeugen. Der Test stellt den Alt-Zustand deshalb
// PRIVILEGIERT her (direkter Insert als postgres, wie ihn die alte Funktion geschrieben hätte) und
// führt danach WÖRTLICH dieselbe Anweisung aus. Geprüft wird damit die Anweisung selbst — ihre
// Wirkung, ihre Abgrenzung und ihre Wiederholbarkeit. Zusätzlich wird bestandsweit geprüft, dass
// der Lauf der Migration keine solche Zeile übrig gelassen hat.
//
// ── AUFRÄUMEN ────────────────────────────────────────────────────────────────────────────────────
// Wie im B1-2-Gate: Leads hängen nicht an auth.users. Jeder Test räumt seine Leads selbst ab
// (Cascade nimmt die Einwilligungen mit), privilegiert als postgres.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'

import { assertStackReachable, pool, runAs, sql } from './client'

/** WÖRTLICH die Anweisung aus der Migration — eine Abschrift wäre eine zweite Auslegung. */
const BACKFILL_SQL = `
update platform.consents c
   set status       = 'confirmed',
       confirmed_at = c.granted_at
  from platform.consent_texts ct
 where ct.id = c.consent_text_id
   and c.status = 'pending'
   and not platform.purpose_requires_double_opt_in(ct.purpose)`

const spawnedLeads: string[] = []

type Outcome = { outcome: string; lead_id?: string; consent_id?: string }

function newEmail(): string {
  return `b32-${randomUUID()}@test.local`
}

/** So bildet der Anwendungscode Klartext-Token → gespeicherter Wert ab (lib/leads/token-crypto.ts). */
function tokenHash(token: string = randomUUID()): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Ruft den Wrapper auf dem REALEN Weg auf: als service_role, committed. */
async function capture(
  email: string,
  opts: { purpose: string | null; sourceKey: string; tokenHash?: string | null },
): Promise<Outcome> {
  const result = await runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: Outcome }>(
      `select public.capture_lead(
         $1, $2, $3::platform.consent_purpose, $4,
         case when $4::text is null then null else now() + interval '7 days' end
       ) as r`,
      [email, opts.sourceKey, opts.purpose, opts.tokenHash === undefined ? tokenHash() : opts.tokenHash],
    )
    return rows[0]!.r
  })
  if (result.lead_id && !spawnedLeads.includes(result.lead_id)) spawnedLeads.push(result.lead_id)
  return result
}

type ConsentRow = {
  purpose: string
  status: string
  confirmed_at: string | null
  granted_at: string
  token_hash: string | null
  token_expires_at: string | null
}

async function consentsOf(leadId: string): Promise<ConsentRow[]> {
  return sql<ConsentRow>(
    `select ct.purpose, c.status, c.confirmed_at, c.granted_at, c.token_hash, c.token_expires_at
       from platform.consents c
       join platform.consent_texts ct on ct.id = c.consent_text_id
      where c.lead_id = $1
      order by c.granted_at`,
    [leadId],
  )
}

async function hasConfirmedConsent(leadId: string, purpose: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }>(
    `select platform.has_confirmed_consent($1, $2::platform.consent_purpose) as ok`,
    [leadId, purpose],
  )
  return rows[0]!.ok
}

/** Ein Lead ohne Einwilligung — Ausgangspunkt für die privilegiert gesetzten Alt-Zeilen. */
async function bareLead(sourceKey = 'rechnerergebnis'): Promise<string> {
  const rows = await sql<{ id: string }>(
    `insert into platform.leads (email, first_source_key) values ($1, $2) returning id`,
    [newEmail(), sourceKey],
  )
  const id = rows[0]!.id
  spawnedLeads.push(id)
  return id
}

/** Eine Einwilligung so einfügen, wie sie VOR B3-2 entstanden wäre: immer pending. */
async function legacyPendingConsent(leadId: string, purpose: string): Promise<void> {
  await sql(
    `insert into platform.consents (lead_id, consent_text_id, source_key, status, granted_at, token_hash)
     select $1,
            (select id from platform.consent_texts
              where purpose = $2::platform.consent_purpose and locale = 'de'
              order by version desc limit 1),
            'rechnerergebnis',
            'pending',
            now() - interval '30 days',
            $3`,
    [leadId, purpose, purpose === 'result_delivery' ? null : tokenHash()],
  )
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

describe('B3-2 — Einfach-Opt-in', () => {
  it('(1) eine result_delivery-Einwilligung entsteht SOFORT als confirmed mit confirmed_at', async () => {
    const email = newEmail()
    const result = await capture(email, { purpose: 'result_delivery', sourceKey: 'rechnerergebnis' })

    // Der neue, eigene Ausgang: der Anwendungscode kann daran nicht falsch abzweigen.
    expect(result.outcome).toBe('consent_confirmed')

    const consents = await consentsOf(result.lead_id!)
    expect(consents).toHaveLength(1)
    expect(consents[0]!.purpose).toBe('result_delivery')
    expect(consents[0]!.status).toBe('confirmed')
    expect(consents[0]!.confirmed_at).not.toBeNull()
  })

  it('(2) has_confirmed_consent liefert dafür true — ohne jeden Bestätigungsschritt', async () => {
    const email = newEmail()
    const result = await capture(email, { purpose: 'result_delivery', sourceKey: 'rechnerergebnis' })

    // Genau die Frage, die vor jedem Versand gestellt wird (B1-1). Vor B3-2 war sie hier false,
    // und die Zusendung, um die die Person gebeten hatte, unterblieb.
    expect(await hasConfirmedConsent(result.lead_id!, 'result_delivery')).toBe(true)

    // Gegenprobe: es GAB keinen Bestätigungsvorgang — es existiert kein Token, über den einer hätte
    // laufen können.
    const confirmable = await sql<{ n: number }>(
      `select count(*)::int as n from platform.consents
        where lead_id = $1 and token_hash is not null`,
      [result.lead_id],
    )
    expect(confirmable[0]!.n).toBe(0)
  })

  it('(3) ein trotzdem übergebener Token wird für result_delivery NICHT gespeichert', async () => {
    const email = newEmail()
    const hash = tokenHash()
    const result = await capture(email, {
      purpose: 'result_delivery',
      sourceKey: 'rechnerergebnis',
      tokenHash: hash,
    })

    const consents = await consentsOf(result.lead_id!)
    expect(consents[0]!.token_hash).toBeNull()
    expect(consents[0]!.token_expires_at).toBeNull()

    // Und der Hash steht auch sonst nirgends: ein einlösbares Geheimnis ohne Einlösestelle darf
    // keine Spur hinterlassen.
    const anywhere = await sql<{ n: number }>(
      `select count(*)::int as n from platform.consents where token_hash = $1`,
      [hash],
    )
    expect(anywhere[0]!.n).toBe(0)
  })

  it('(4) marketing_email entsteht unverändert als pending MIT Token (B1-2-Regression)', async () => {
    const email = newEmail()
    const hash = tokenHash()
    const result = await capture(email, {
      purpose: 'marketing_email',
      sourceKey: 'artikel-inline',
      tokenHash: hash,
    })

    expect(result.outcome).toBe('consent_created')

    const consents = await consentsOf(result.lead_id!)
    expect(consents[0]!.status).toBe('pending')
    expect(consents[0]!.confirmed_at).toBeNull()
    expect(consents[0]!.token_hash).toBe(hash)
    expect(consents[0]!.token_expires_at).not.toBeNull()
    expect(await hasConfirmedConsent(result.lead_id!, 'marketing_email')).toBe(false)
  })

  it('(4b) ein bestätigungspflichtiger Zweck OHNE Token wird weiterhin hart abgelehnt', async () => {
    await expect(
      capture(newEmail(), {
        purpose: 'marketing_email',
        sourceKey: 'artikel-inline',
        tokenHash: null,
      }),
    ).rejects.toThrow(/bestätigungspflichtig/)
  })

  it('(5) der Backfill stellt nur nicht bestätigungspflichtige pending-Zeilen um — idempotent', async () => {
    const leadA = await bareLead()
    const leadB = await bareLead('artikel-inline')
    await legacyPendingConsent(leadA, 'result_delivery')
    await legacyPendingConsent(leadB, 'marketing_email')

    // Ausgangslage: beide stehen auf pending, so wie die alte Fassung sie geschrieben hätte.
    expect((await consentsOf(leadA))[0]!.status).toBe('pending')
    expect((await consentsOf(leadB))[0]!.status).toBe('pending')

    await sql(BACKFILL_SQL)

    const [umgestellt] = await consentsOf(leadA)
    expect(umgestellt!.status).toBe('confirmed')
    // confirmed_at = granted_at, NICHT now(): die Person hat damals eingewilligt, und für diesen
    // Zweck war die Erteilung immer schon der vollständige Vorgang. Ein Zeitstempel von heute
    // behauptete eine Handlung, die heute niemand vorgenommen hat.
    expect(umgestellt!.confirmed_at).toEqual(umgestellt!.granted_at)
    expect(await hasConfirmedConsent(leadA, 'result_delivery')).toBe(true)

    // Der bestätigungspflichtige Zweck bleibt UNBERÜHRT — sonst wäre der Backfill eine gefälschte
    // Bestätigung.
    const [unberuehrt] = await consentsOf(leadB)
    expect(unberuehrt!.status).toBe('pending')
    expect(unberuehrt!.confirmed_at).toBeNull()

    // Idempotent: ein zweiter Lauf ändert nichts, insbesondere schreibt er confirmed_at nicht um.
    await sql(BACKFILL_SQL)
    const [nochmal] = await consentsOf(leadA)
    expect(nochmal!.status).toBe('confirmed')
    expect(nochmal!.confirmed_at).toEqual(umgestellt!.confirmed_at)
  })

  it('(5b) nach dem Lauf der Migration gibt es bestandsweit keine solche Alt-Zeile mehr', async () => {
    const rows = await sql<{ n: number }>(
      `select count(*)::int as n
         from platform.consents c
         join platform.consent_texts ct on ct.id = c.consent_text_id
        where c.status = 'pending'
          and not platform.purpose_requires_double_opt_in(ct.purpose)`,
    )
    expect(rows[0]!.n).toBe(0)
  })

  it('(6) ein widerrufener oder abgelaufener Zustand wird vom Backfill NICHT angefasst', async () => {
    const lead = await bareLead()
    await sql(
      `insert into platform.consents (lead_id, consent_text_id, source_key, status, withdrawn_at)
       select $1,
              (select id from platform.consent_texts
                where purpose = 'result_delivery' and locale = 'de' order by version desc limit 1),
              'rechnerergebnis', 'withdrawn', now()`,
      [lead],
    )

    await sql(BACKFILL_SQL)

    // Ein Widerruf ist eine Handlung der Person und wird nicht durch eine Migration zurückgenommen.
    expect((await consentsOf(lead))[0]!.status).toBe('withdrawn')
    expect(await hasConfirmedConsent(lead, 'result_delivery')).toBe(false)
  })
})
