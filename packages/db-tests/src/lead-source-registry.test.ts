// DB-Gate für den Abgleich Registry ↔ platform.lead_sources (B3-2).
//
// DIE EINE FRAGE, DIE DIESER TEST BEANTWORTET: Kennt der Anwendungscode genau die Einstiegspunkte,
// die es in der Datenbank gibt — und umgekehrt?
//
// Warum das ein Test sein muss und keine Sorgfalt: `platform.lead_sources` ist bewusst eine TABELLE
// und kein Enum (B1-1), weil laufend Einstiegspunkte dazukommen. Der Preis dafür ist, dass die
// Datenbank NICHT verhindert, dass Code und Bestand auseinanderdriften. Fehlt ein Schlüssel im Code,
// lässt sich der Einstiegspunkt nicht bauen — das fällt auf. Fehlt er umgekehrt in der Datenbank
// oder ist er inaktiv, scheitert erst der erste echte Aufruf am Fremdschlüssel; und trägt ein
// Eintrag einen Schlüssel, der zu einem ANDEREN Einstiegspunkt gehört, schreibt er still unter
// falscher Herkunft in den Bestand. Der Lead ist dann da, aber die Auswertung, welcher Kanal ihn
// gebracht hat, ist falsch — und das merkt niemand.
//
// ── WARUM DER RELATIVE IMPORT ────────────────────────────────────────────────────────────────────
// `apps/web/lib/leads/registry.ts` ist bewusst abhängigkeitsfrei (keine `@/`-Aliasse, kein `next/*`,
// kein zod) — genau damit dieser Test sie direkt lesen kann. Eine Abschrift der Schlüsselliste hier
// wäre eine dritte Quelle und würde den Zweck des Tests aufheben.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assertStackReachable, pool, runAs, sql } from './client'
import {
  LEAD_CAPTURE_FORM_KEYS,
  LEAD_CAPTURE_REGISTRY,
  LEAD_SOURCE_KEYS,
  LEAD_SOURCE_KEYS_WITHOUT_FORM,
} from '../../../apps/web/lib/leads/registry'

beforeAll(async () => {
  await assertStackReachable()
})

afterAll(async () => {
  await pool.end()
})

async function activeSourceKeys(): Promise<string[]> {
  const rows = await sql<{ key: string }>(
    `select key from platform.lead_sources where is_active order by key`,
  )
  return rows.map((row) => row.key)
}

describe('B3-2 — Registry und lead_sources stimmen überein', () => {
  it('jeder aktive Einstiegspunkt der Datenbank hat einen Registry-Eintrag', async () => {
    const inDb = await activeSourceKeys()
    const inCode = new Set<string>(LEAD_SOURCE_KEYS)

    const fehlendImCode = inDb.filter((key) => !inCode.has(key))
    expect(
      fehlendImCode,
      'Diese aktiven lead_sources kennt die Registry nicht — ein Einstiegspunkt, der in der ' +
        'Datenbank existiert, aber im Code fehlt, kann nirgends platziert werden.',
    ).toEqual([])
  })

  it('jeder Registry-Schlüssel existiert als AKTIVE Zeile in lead_sources', async () => {
    const inDb = new Set(await activeSourceKeys())

    const fehlendInDb = [...LEAD_SOURCE_KEYS].filter((key) => !inDb.has(key))
    expect(
      fehlendInDb,
      'Diese Registry-Schlüssel gibt es in der Datenbank nicht (oder sie sind inaktiv) — ' +
        'first_source_key ist ein Fremdschlüssel, der Einstiegspunkt könnte also gar keinen Lead ' +
        'anlegen. Der Fehler fiele erst beim ersten echten Aufruf auf.',
    ).toEqual([])
  })

  it('die Registry ist in sich schlüssig: jeder Eintrag trägt seinen eigenen Schlüssel', () => {
    for (const key of LEAD_CAPTURE_FORM_KEYS) {
      const entry = LEAD_CAPTURE_REGISTRY[key]
      expect(entry, `Kein Registry-Eintrag zu "${key}"`).toBeDefined()
      // Ein vertauschter `key` im Eintrag wäre der stillste denkbare Fehler: die Komponente zeigte
      // die Texte des einen und schriebe die Herkunft des anderen.
      expect(entry.key).toBe(key)
    }
    // Die Formular-Registry deckt GENAU die Formular-Schlüssel ab — nicht alle Herkünfte: seit
    // B10-5 gibt es Einstiegspunkte ohne Erfassungsformular (die Registrierung).
    expect(Object.keys(LEAD_CAPTURE_REGISTRY).sort()).toEqual([...LEAD_CAPTURE_FORM_KEYS].sort())
  })

  it('jeder Zweck der Registry ist ein Wert des DB-Enums platform.consent_purpose', async () => {
    const rows = await sql<{ value: string }>(
      `select unnest(enum_range(null::platform.consent_purpose))::text as value`,
    )
    const bekannt = new Set(rows.map((row) => row.value))

    for (const key of LEAD_CAPTURE_FORM_KEYS) {
      const purpose = LEAD_CAPTURE_REGISTRY[key].purpose
      if (purpose === null) continue
      expect(bekannt.has(purpose), `Unbekannter Zweck "${purpose}" am Eintrag "${key}"`).toBe(true)
    }
  })

  it('ein Eintrag bietet die Marketing-Einwilligung nie zusätzlich zu sich selbst an', () => {
    // 'marketing_email' als Zweck UND als Ankreuzmöglichkeit wäre dieselbe Einwilligung zweimal —
    // die Person würde zweimal gefragt und bekäme zwei Bestätigungsmails für dasselbe.
    for (const key of LEAD_CAPTURE_FORM_KEYS) {
      const entry = LEAD_CAPTURE_REGISTRY[key]
      if (entry.purpose === 'marketing_email') {
        expect(entry.offersMarketingConsent, `Eintrag "${key}"`).toBe(false)
      }
    }
  })
})

describe('B10-5 — die Registrierung als Einstiegspunkt', () => {
  /*
   * Die beiden Zeilen sind vom Abgleich oben bereits mit abgedeckt (er läuft über
   * LEAD_SOURCE_KEYS, das sie enthält). Dieser Block steht zusätzlich, weil der Abgleich eine
   * MENGE prüft und diese zwei Schlüssel eine ZUSAGE sind: ohne sie kann die Registrierung wegen
   * des Fremdschlüssels `leads.first_source_key` gar keinen Lead anlegen — und das fiele erst beim
   * ersten echten Registrierungsversuch auf, also im Betrieb.
   */
  it('beide Herkünfte existieren als AKTIVE Zeile mit Bezeichnung', async () => {
    const rows = await sql<{ key: string; label: string; is_active: boolean }>(
      `select key, label, is_active from platform.lead_sources
        where key = any($1::text[]) order by key`,
      [[...LEAD_SOURCE_KEYS_WITHOUT_FORM]],
    )

    expect(rows.map((row) => row.key).sort()).toEqual([...LEAD_SOURCE_KEYS_WITHOUT_FORM].sort())
    for (const row of rows) {
      expect(row.is_active, `${row.key} ist inaktiv`).toBe(true)
      // Ohne Bezeichnung zeigte die Herkunftsauswertung im Admin-Bereich einen rohen Schlüssel.
      expect(row.label?.trim(), `${row.key} ohne Bezeichnung`).toBeTruthy()
    }
  })

  /*
   * Der eigentliche Beweis läuft über einen ECHTEN Aufruf (Arbeitsregel 2: Introspektion zeigt nur,
   * dass eine Zeile da ist — nicht, dass ein Lead darunter entstehen kann). In EINER Transaktion
   * mit `rollback`, der Bestand bleibt unangetastet.
   */
  it('unter beiden Herkünften entsteht ein Lead OHNE Einwilligung (Vertragsanbahnung)', async () => {
    for (const key of LEAD_SOURCE_KEYS_WITHOUT_FORM) {
      await runAs({ role: 'service_role' }, async (client) => {
        const { rows } = await client.query<{ outcome: string; lead_id: string }>(
          `select r ->> 'outcome' as outcome, r ->> 'lead_id' as lead_id
             from public.capture_lead(
                    p_email => $1,
                    p_source_key => $2,
                    p_company => 'B10-5 Testbetrieb',
                    p_first_name => 'Test',
                    p_last_name => 'Person'
                  ) as r`,
          [`b10-5-${key}@example.invalid`, key],
        )

        // 'lead_only' heisst: Lead ja, Einwilligungszeile nein — genau die Rechtsgrundlage, die
        // dieser Einstiegspunkt hat. Ein anderer Ausgang hiesse, die Registrierung sammelte
        // stillschweigend eine Einwilligung ein.
        expect(rows[0]?.outcome, key).toBe('lead_only')
        expect(rows[0]?.lead_id, key).toBeTruthy()

        const { rows: consents } = await client.query<{ count: string }>(
          `select count(*)::text as count from platform.consents where lead_id = $1`,
          [rows[0]?.lead_id],
        )
        expect(consents[0]?.count, key).toBe('0')

        const { rows: lead } = await client.query<{
          first_source_key: string
          retention_basis: string
          company: string
          first_name: string
          last_name: string
        }>(
          `select first_source_key, retention_basis::text, company, first_name, last_name
             from platform.leads where id = $1`,
          [rows[0]?.lead_id],
        )
        expect(lead[0]?.first_source_key, key).toBe(key)
        // Bewusste Nicht-Eskalation: der Vorgabewert bleibt stehen (24 Monate).
        expect(lead[0]?.retention_basis, key).toBe('marketing')
        expect(lead[0]?.company, key).toBe('B10-5 Testbetrieb')
        expect(lead[0]?.first_name, key).toBe('Test')
        expect(lead[0]?.last_name, key).toBe('Person')
      })
    }
  })

  it('eine zweite Registrierung derselben Adresse legt KEINEN zweiten Lead an', async () => {
    /*
     * Der Fall, der im Betrieb am häufigsten vorkommt und am stillsten schiefgeht: dieselbe Person
     * ist bereits als Lead bekannt (etwa aus einer früheren /kontakt-Anfrage) und registriert sich
     * später. Entstünde dabei ein zweiter Lead, hätte der Bestand zwei Zeilen für einen Betrieb —
     * mit geteilter Historie und zwei Löschfristen.
     */
    await runAs({ role: 'service_role' }, async (client) => {
      const email = 'b10-5-merge@example.invalid'

      const erste = await client.query<{ lead_id: string }>(
        `select r ->> 'lead_id' as lead_id
           from public.capture_lead(
                  p_email => $1,
                  p_source_key => 'kontaktformular',
                  p_company => 'Zuerst erfasst GmbH',
                  p_first_name => 'Anna',
                  p_last_name => 'Gruber'
                ) as r`,
        [email],
      )

      const zweite = await client.query<{ lead_id: string }>(
        `select r ->> 'lead_id' as lead_id
           from public.capture_lead(
                  p_email => $1,
                  p_source_key => 'kalkulator-registrierung',
                  p_company => 'Spaeter getippt GmbH',
                  p_first_name => 'A.',
                  p_last_name => 'Gruber'
                ) as r`,
        [email],
      )

      expect(zweite.rows[0]?.lead_id).toBe(erste.rows[0]?.lead_id)

      const { rows } = await client.query<{ count: string }>(
        `select count(*)::text as count from platform.leads
          where platform.normalize_email(email) = platform.normalize_email($1)`,
        [email],
      )
      expect(rows[0]?.count).toBe('1')

      const { rows: lead } = await client.query<{
        first_source_key: string
        company: string
        first_name: string
      }>(`select first_source_key, company, first_name from platform.leads where id = $1`, [
        erste.rows[0]?.lead_id,
      ])
      // Die Herkunft bleibt beim ZUERST erfassten Wert (unveränderlich seit B1-1), und die
      // Identitätsfelder folgen der bestehenden Regel „Bestand gewinnt" — B10-5 ändert an beidem
      // nichts und darf es auch nicht.
      expect(lead[0]?.first_source_key).toBe('kontaktformular')
      expect(lead[0]?.company).toBe('Zuerst erfasst GmbH')
      expect(lead[0]?.first_name).toBe('Anna')
    })
  })
})
