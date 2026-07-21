// DB-Gate für den Erfassungs-, Bestätigungs- und Abmeldepfad (B1-2)
// (Migration 20260721150000_create_lead_capture_wrappers.sql).
//
// Beweist auf DB-Ebene, worauf sich der Anwendungscode verlässt: (1) die sechs Wrapper sind
// AUSSCHLIESSLICH für service_role aufrufbar; (2) wiederholtes Absenden legt weder einen zweiten
// Lead noch eine zweite offene Bestätigung an — der Schutz davor, dass jemand fremde Adressen mit
// Bestätigungsmails zudeckt; (3) eine gesperrte Adresse erzeugt KEINE Einwilligung; (4) ein
// abgelaufener Token bestätigt nicht, sondern räumt sich selbst ab (lazy, ohne Hintergrundjob);
// (5) Bestätigen ist idempotent und schreibt den Nachweiszeitpunkt nicht um; (6) die vollständige
// Abmeldung widerruft alle Zwecke und hinterlässt den Adress-Hash in der Sperrliste; (7) der
// Lese-Wrapper des Bestätigungs-GET verändert NACHWEISLICH nichts.
//
// ── WARUM (7) HIER UND NICHT IN apps/web STEHT ───────────────────────────────────────────────────
// „Der GET verändert nichts" ist eine Aussage über die DATENBANK, nicht über eine React-Seite. Sie
// lässt sich nur hier beweisen: Zeilenzustand vorher festhalten, den Lesepfad aufrufen, Zustand
// danach vergleichen. Ein Renderer-Test könnte allenfalls zeigen, dass die Seite keinen POST
// absetzt — die eigentliche Gefahr (ein schreibender Lesepfad) bliebe unberührt.
//
// ── AUFRÄUMEN ────────────────────────────────────────────────────────────────────────────────────
// Wie im B1-1-Gate: Leads hängen nicht an auth.users, es gibt keinen Cascade von aussen. Jeder Test
// räumt seine Leads (Cascade nimmt die Einwilligungen mit) und Sperrlisten-Einträge selbst ab,
// privilegiert als postgres — service_role hat bewusst kein delete-Grant.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Die sechs public-Wrapper dieses Bauabschnitts. */
const CAPTURE_WRAPPERS = [
  'capture_lead',
  'get_active_consent_text',
  'get_pending_consent_by_token',
  'confirm_consent',
  'withdraw_consent',
  'suppress_email_and_withdraw_all',
] as const

const spawnedLeads: string[] = []
const spawnedSuppressionHashes: string[] = []

type Outcome = { outcome: string; lead_id?: string; consent_id?: string; withdrawn_count?: number }

function newEmail(): string {
  return `capture-${randomUUID()}@test.local`
}

/** So bildet der Anwendungscode Klartext-Token → gespeicherter Wert ab (lib/leads/token-crypto.ts). */
function tokenHash(token: string = randomUUID()): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Ruft einen Wrapper auf dem REALEN Weg auf: als service_role, committed. */
async function callWrapper<T = Outcome>(text: string, params: unknown[] = []): Promise<T> {
  return runAs({ role: 'service_role', commit: true }, async (c) => {
    const { rows } = await c.query<{ r: T }>(text, params)
    return rows[0]!.r
  })
}

async function capture(
  email: string,
  opts: {
    purpose?: string | null
    tokenHash?: string | null
    expiresIn?: string
    sourceKey?: string
  } = {},
): Promise<Outcome> {
  const result = await callWrapper<Outcome>(
    `select public.capture_lead(
       $1, $2, $3::platform.consent_purpose, $4,
       case when $5::text is null then null else now() + $5::interval end,
       -- Vor- und Nachname stehen an der Stelle, an der frueher EIN p_contact_name stand. Der
       -- Aufruf ist bewusst POSITIONAL: er ist damit der Test, dass die Parameterreihenfolge nach
       -- der Auftrennung genau so ist, wie sie sein soll — ein verrutschter Parameter schriebe
       -- sonst die Telefonnummer in den Nachnamen, und zwar ohne Fehler.
       'DB-Gate GmbH', 'Test', 'Person', '+43 1 0000', '203.0.113.9'::inet, 'db-gate/1.0'
     ) as r`,
    [
      email,
      opts.sourceKey ?? 'kontaktformular',
      opts.purpose === undefined ? 'marketing_email' : opts.purpose,
      opts.tokenHash === undefined ? tokenHash() : opts.tokenHash,
      opts.expiresIn === undefined ? '7 days' : opts.expiresIn,
    ],
  )
  if (result.lead_id && !spawnedLeads.includes(result.lead_id)) spawnedLeads.push(result.lead_id)
  return result
}

/** Alle Einwilligungen eines Leads mit Zweck und Status. */
async function consentsOf(leadId: string) {
  return sql<{ purpose: string; status: string; confirmed_at: string | null }>(
    `select ct.purpose, c.status, c.confirmed_at
       from platform.consents c
       join platform.consent_texts ct on ct.id = c.consent_text_id
      where c.lead_id = $1
      order by c.granted_at`,
    [leadId],
  )
}

/** Der vollständige, vergleichbare Zeilenzustand einer Einwilligung (für den „ändert nichts"-Test). */
async function consentSnapshot(hash: string) {
  const rows = await sql<Record<string, unknown>>(
    `select id, lead_id, consent_text_id, source_key, status, granted_at, confirmed_at,
            withdrawn_at, source_ip, user_agent, token_hash, token_expires_at
       from platform.consents where token_hash = $1`,
    [hash],
  )
  return rows[0]!
}

async function leadCount(email: string): Promise<number> {
  const rows = await sql<{ n: number }>(
    `select count(*)::int as n from platform.leads
      where platform.normalize_email(email) = platform.normalize_email($1)`,
    [email],
  )
  return rows[0]!.n
}

async function suppress(email: string): Promise<void> {
  const hash = (await sql<{ h: string }>(`select platform.email_hash($1) as h`, [email]))[0]!.h
  await sql(
    `insert into platform.email_suppressions (email_hash, reason) values ($1, 'manual')
     on conflict (email_hash) do nothing`,
    [hash],
  )
  spawnedSuppressionHashes.push(hash)
}

/** Execute-Recht per Katalog-Introspektion (Muster wie alle bisherigen Wrapper-Gates). */
async function canExecute(role: string, funcName: string): Promise<boolean> {
  const rows = await sql<{ can: boolean }>(
    `select has_function_privilege($1, p.oid, 'execute') as can
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $2`,
    [role, funcName],
  )
  return rows[0]?.can ?? false
}

beforeAll(async () => {
  await assertStackReachable()
})

afterEach(async () => {
  for (const id of spawnedLeads.splice(0)) {
    await sql('delete from platform.leads where id = $1', [id])
  }
  for (const h of spawnedSuppressionHashes.splice(0)) {
    await sql('delete from platform.email_suppressions where email_hash = $1', [h])
  }
})

afterAll(async () => {
  await pool.end()
})

// ── (1) Zugriffsgrenze ───────────────────────────────────────────────────────────────────────────
// WARUM PER KATALOG UND NICHT PER AUFRUF: das gepinnte Postgres-Image segfaultet bei einem
// Nicht-Owner-Aufruf einer public-Funktion OHNE Execute-Grant (dokumentiert in allen bisherigen
// Wrapper-Gates). has_function_privilege ist dieselbe Wahrheit, nur ohne Absturz.
describe('Zugriffsgrenze — nur service_role', () => {
  for (const fn of CAPTURE_WRAPPERS) {
    it(`anon darf public.${fn} nicht aufrufen`, async () => {
      expect(await canExecute('anon', fn)).toBe(false)
    })

    it(`authenticated darf public.${fn} nicht aufrufen`, async () => {
      expect(await canExecute('authenticated', fn)).toBe(false)
    })

    it(`service_role darf public.${fn} aufrufen`, async () => {
      expect(await canExecute('service_role', fn)).toBe(true)
    })
  }
})

// ── (2) Erfassung ────────────────────────────────────────────────────────────────────────────────
describe('capture_lead', () => {
  it('legt Lead und unbestätigte Einwilligung an — genau einmal je Adresse', async () => {
    const email = newEmail()

    const first = await capture(email)
    expect(first.outcome).toBe('consent_created')
    expect(first.lead_id).toBeTruthy()

    const consents = await consentsOf(first.lead_id!)
    expect(consents).toHaveLength(1)
    expect(consents[0]).toMatchObject({ purpose: 'marketing_email', status: 'pending' })
    // Unbestätigt ist rechtlich wertlos — B1-1s has_confirmed_consent muss hier false sagen.
    const may = await sql<{ ok: boolean }>(
      `select platform.has_confirmed_consent($1, 'marketing_email') as ok`,
      [first.lead_id],
    )
    expect(may[0]!.ok).toBe(false)
  })

  it('zweiter Aufruf: kein zweiter Lead UND keine zweite offene Bestätigung', async () => {
    const email = newEmail()
    const first = await capture(email)
    const second = await capture(email)

    expect(second.outcome).toBe('consent_already_pending')
    expect(second.lead_id).toBe(first.lead_id)
    expect(await leadCount(email)).toBe(1)
    expect(await consentsOf(first.lead_id!)).toHaveLength(1)
  })

  it('erkennt dieselbe Adresse in anderer Schreibweise als denselben Lead', async () => {
    const email = newEmail()
    const first = await capture(email)
    const again = await capture(`  ${email.toUpperCase()}  `)

    expect(again.lead_id).toBe(first.lead_id)
    expect(await leadCount(email)).toBe(1)
  })

  it('ohne Zweck entsteht KEINE Einwilligung (Vertragsanbahnung, nicht Einwilligung)', async () => {
    const email = newEmail()
    const result = await capture(email, { purpose: null, tokenHash: null, expiresIn: undefined })

    expect(result.outcome).toBe('lead_only')
    expect(await consentsOf(result.lead_id!)).toHaveLength(0)
  })

  it('gesperrte Adresse: outcome suppressed, KEINE Einwilligung', async () => {
    const email = newEmail()
    await suppress(email)

    const result = await capture(email)

    expect(result.outcome).toBe('suppressed')
    // Der Lead entsteht trotzdem — eine Anfrage ist keine Einwilligung, und die Sperre betrifft nur
    // den Versand. Aber es darf keine Einwilligungszeile geben.
    expect(result.lead_id).toBeTruthy()
    expect(await consentsOf(result.lead_id!)).toHaveLength(0)
  })

  it('bestätigungspflichtiger Zweck ohne Token wird hart abgelehnt', async () => {
    await expect(capture(newEmail(), { tokenHash: null })).rejects.toThrow(/bestätigungspflichtig/i)
  })

  it('nach Ablauf der offenen Bestätigung ist eine neue Erfassung wieder möglich', async () => {
    const email = newEmail()
    const first = await capture(email, { expiresIn: '-1 minute' })
    expect(first.outcome).toBe('consent_created')

    const second = await capture(email)
    expect(second.outcome).toBe('consent_created')
    expect(second.lead_id).toBe(first.lead_id)
    expect(await consentsOf(first.lead_id!)).toHaveLength(2)
  })
})

// ── (3) Bestätigungs-GET verändert nichts ────────────────────────────────────────────────────────
describe('get_pending_consent_by_token', () => {
  it('liefert Zweck, Wortlaut und Ablauf — und ändert die Zeile NACHWEISLICH nicht', async () => {
    const email = newEmail()
    const hash = tokenHash()
    await capture(email, { tokenHash: hash })

    const before = await consentSnapshot(hash)

    const view = await callWrapper<Record<string, unknown>>(
      `select public.get_pending_consent_by_token($1) as r`,
      [hash],
    )
    expect(view.outcome).toBe('valid')
    expect(view.purpose).toBe('marketing_email')
    expect(String(view.consent_text_body)).toContain('COOLiN')
    expect(view.expires_at).toBeTruthy()

    // Zweiter Aufruf (so wie ein Mailscanner den Link mehrfach abruft) — Zustand identisch.
    await callWrapper(`select public.get_pending_consent_by_token($1) as r`, [hash])

    expect(await consentSnapshot(hash)).toEqual(before)
  })

  it('meldet einen abgelaufenen Token als abgelaufen, OHNE ihn abzuräumen', async () => {
    const email = newEmail()
    const hash = tokenHash()
    await capture(email, { tokenHash: hash, expiresIn: '-1 minute' })

    const view = await callWrapper<Record<string, unknown>>(
      `select public.get_pending_consent_by_token($1) as r`,
      [hash],
    )
    expect(view.outcome).toBe('expired')
    // Der Status bleibt 'pending' — das Abräumen gehört dem POST-Pfad, nicht dem Lesepfad.
    expect((await consentSnapshot(hash)).status).toBe('pending')
  })

  it('unbekannter Token: not_found ohne jede weitere Angabe', async () => {
    const view = await callWrapper<Record<string, unknown>>(
      `select public.get_pending_consent_by_token($1) as r`,
      [tokenHash('nie-vergeben')],
    )
    expect(view).toEqual({ outcome: 'not_found' })
  })
})

// ── (4) Bestätigung ──────────────────────────────────────────────────────────────────────────────
describe('confirm_consent', () => {
  it('bestätigt und setzt den Nachweiszeitpunkt', async () => {
    const email = newEmail()
    const hash = tokenHash()
    const created = await capture(email, { tokenHash: hash })

    const result = await callWrapper<Outcome>(`select public.confirm_consent($1) as r`, [hash])
    expect(result.outcome).toBe('confirmed')

    const [consent] = await consentsOf(created.lead_id!)
    expect(consent!.status).toBe('confirmed')
    expect(consent!.confirmed_at).toBeTruthy()

    const may = await sql<{ ok: boolean }>(
      `select platform.has_confirmed_consent($1, 'marketing_email') as ok`,
      [created.lead_id],
    )
    expect(may[0]!.ok).toBe(true)
  })

  it('ist idempotent — der zweite Klick schreibt confirmed_at NICHT um', async () => {
    const email = newEmail()
    const hash = tokenHash()
    await capture(email, { tokenHash: hash })

    const first = await callWrapper<Outcome>(`select public.confirm_consent($1) as r`, [hash])
    const afterFirst = await consentSnapshot(hash)

    const second = await callWrapper<Outcome>(`select public.confirm_consent($1) as r`, [hash])

    expect(first.outcome).toBe('confirmed')
    expect(second.outcome).toBe('already_confirmed')
    expect(await consentSnapshot(hash)).toEqual(afterFirst)
  })

  it('abgelaufener Token: bestätigt NICHT, setzt stattdessen expired (lazy)', async () => {
    const email = newEmail()
    const hash = tokenHash()
    const created = await capture(email, { tokenHash: hash, expiresIn: '-1 minute' })

    const result = await callWrapper<Outcome>(`select public.confirm_consent($1) as r`, [hash])

    expect(result.outcome).toBe('expired')
    const [consent] = await consentsOf(created.lead_id!)
    expect(consent!.status).toBe('expired')
    expect(consent!.confirmed_at).toBeNull()

    const may = await sql<{ ok: boolean }>(
      `select platform.has_confirmed_consent($1, 'marketing_email') as ok`,
      [created.lead_id],
    )
    expect(may[0]!.ok).toBe(false)
  })

  it('unbekannter Token: not_found, keine Wirkung', async () => {
    const result = await callWrapper<Outcome>(`select public.confirm_consent($1) as r`, [
      tokenHash('nie-vergeben'),
    ])
    expect(result.outcome).toBe('not_found')
  })
})

// ── (5) Abmeldung ────────────────────────────────────────────────────────────────────────────────
describe('withdraw_consent', () => {
  it('widerruft nur den übergebenen Zweck und ist idempotent', async () => {
    const email = newEmail()
    const hash = tokenHash()
    const created = await capture(email, { tokenHash: hash })
    await callWrapper(`select public.confirm_consent($1) as r`, [hash])

    // Zweiter Zweck derselben Person — er darf vom Widerruf NICHT betroffen sein.
    const otherHash = tokenHash()
    await callWrapper(
      `select public.capture_lead($1, 'kontaktformular', 'contract_expiry_reminder', $2,
                                  now() + interval '7 days') as r`,
      [email, otherHash],
    )

    const first = await callWrapper<Outcome>(
      `select public.withdraw_consent($1, 'marketing_email') as r`,
      [created.lead_id],
    )
    expect(first).toMatchObject({ outcome: 'withdrawn', withdrawn_count: 1 })

    const second = await callWrapper<Outcome>(
      `select public.withdraw_consent($1, 'marketing_email') as r`,
      [created.lead_id],
    )
    expect(second).toMatchObject({ outcome: 'withdrawn', withdrawn_count: 0 })

    const consents = await consentsOf(created.lead_id!)
    expect(consents.find((c) => c.purpose === 'marketing_email')!.status).toBe('withdrawn')
    expect(consents.find((c) => c.purpose === 'contract_expiry_reminder')!.status).toBe('pending')
  })

  it('unbekannter Lead: neutrale Rückgabe ohne Fehler (kein Auskunfts-Orakel)', async () => {
    const result = await callWrapper<Outcome>(
      `select public.withdraw_consent($1, 'marketing_email') as r`,
      [randomUUID()],
    )
    expect(result).toEqual({ outcome: 'withdrawn', withdrawn_count: 0 })
  })
})

describe('suppress_email_and_withdraw_all', () => {
  it('widerruft ALLE Zwecke und schreibt den Adress-Hash in die Sperrliste', async () => {
    const email = newEmail()
    const hash = tokenHash()
    const created = await capture(email, { tokenHash: hash })
    await callWrapper(`select public.confirm_consent($1) as r`, [hash])
    await callWrapper(
      `select public.capture_lead($1, 'kontaktformular', 'contract_expiry_reminder', $2,
                                  now() + interval '7 days') as r`,
      [email, tokenHash()],
    )

    const result = await callWrapper<Outcome>(
      `select public.suppress_email_and_withdraw_all($1) as r`,
      [created.lead_id],
    )
    expect(result.outcome).toBe('suppressed')
    expect(result.withdrawn_count).toBe(2)

    for (const consent of await consentsOf(created.lead_id!)) {
      expect(consent.status).toBe('withdrawn')
    }

    const suppressed = await sql<{ ok: boolean }>(`select platform.is_suppressed($1) as ok`, [
      email,
    ])
    expect(suppressed[0]!.ok).toBe(true)

    // NUR der Hash steht in der Liste — nie die Adresse (B1-1: die Sperrliste darf selbst keine
    // benutzbare Verteilerliste sein).
    const rows = await sql<{ email_hash: string; reason: string }>(
      `select email_hash, reason from platform.email_suppressions
        where email_hash = platform.email_hash($1)`,
      [email],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.reason).toBe('unsubscribed')
    expect(rows[0]!.email_hash).toMatch(/^[0-9a-f]{64}$/)
    spawnedSuppressionHashes.push(rows[0]!.email_hash)
  })

  it('die Sperre überlebt die Löschung des Leads', async () => {
    const email = newEmail()
    const created = await capture(email)
    await callWrapper(`select public.suppress_email_and_withdraw_all($1) as r`, [created.lead_id])

    const hash = (await sql<{ h: string }>(`select platform.email_hash($1) as h`, [email]))[0]!.h
    spawnedSuppressionHashes.push(hash)

    await sql('delete from platform.leads where id = $1', [created.lead_id])
    spawnedLeads.splice(spawnedLeads.indexOf(created.lead_id!), 1)

    const suppressed = await sql<{ ok: boolean }>(`select platform.is_suppressed($1) as ok`, [
      email,
    ])
    expect(suppressed[0]!.ok).toBe(true)
  })

  it('unbekannter Lead: neutrale Rückgabe ohne Fehler', async () => {
    const result = await callWrapper<Outcome>(
      `select public.suppress_email_and_withdraw_all($1) as r`,
      [randomUUID()],
    )
    expect(result).toEqual({ outcome: 'suppressed', withdrawn_count: 0 })
  })
})

// ── (6) Einwilligungstext ────────────────────────────────────────────────────────────────────────
describe('get_active_consent_text', () => {
  it('liefert die jüngste Fassung je Zweck und Sprache', async () => {
    const result = await callWrapper<Record<string, unknown>>(
      `select public.get_active_consent_text('marketing_email', 'de') as r`,
    )
    expect(result.status).toBe('ok')
    expect(result.version).toBe(1)
    expect(result.locale).toBe('de')
    expect(String(result.body)).toContain('COOLiN')
  })

  it('meldet not_found für eine Sprache ohne Fassung — statt eine fremdsprachige zu liefern', async () => {
    const result = await callWrapper<Record<string, unknown>>(
      `select public.get_active_consent_text('marketing_email', 'fr') as r`,
    )
    expect(result).toEqual({ status: 'not_found' })
  })

  it('archiviert wird GENAU die Fassung, die dieser Wrapper anzeigt', async () => {
    const shown = await callWrapper<Record<string, unknown>>(
      `select public.get_active_consent_text('marketing_email', 'de') as r`,
    )
    const created = await capture(newEmail())

    const rows = await sql<{ id: string }>(
      `select c.consent_text_id as id from platform.consents c where c.lead_id = $1`,
      [created.lead_id],
    )
    expect(rows[0]!.id).toBe(shown.id)
  })
})
