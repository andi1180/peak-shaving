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

import { assertStackReachable, pool, sql } from './client'
import {
  LEAD_CAPTURE_REGISTRY,
  LEAD_SOURCE_KEYS,
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
    for (const key of LEAD_SOURCE_KEYS) {
      const entry = LEAD_CAPTURE_REGISTRY[key]
      expect(entry, `Kein Registry-Eintrag zu "${key}"`).toBeDefined()
      // Ein vertauschter `key` im Eintrag wäre der stillste denkbare Fehler: die Komponente zeigte
      // die Texte des einen und schriebe die Herkunft des anderen.
      expect(entry.key).toBe(key)
    }
    expect(Object.keys(LEAD_CAPTURE_REGISTRY).sort()).toEqual([...LEAD_SOURCE_KEYS].sort())
  })

  it('jeder Zweck der Registry ist ein Wert des DB-Enums platform.consent_purpose', async () => {
    const rows = await sql<{ value: string }>(
      `select unnest(enum_range(null::platform.consent_purpose))::text as value`,
    )
    const bekannt = new Set(rows.map((row) => row.value))

    for (const key of LEAD_SOURCE_KEYS) {
      const purpose = LEAD_CAPTURE_REGISTRY[key].purpose
      if (purpose === null) continue
      expect(bekannt.has(purpose), `Unbekannter Zweck "${purpose}" am Eintrag "${key}"`).toBe(true)
    }
  })

  it('ein Eintrag bietet die Marketing-Einwilligung nie zusätzlich zu sich selbst an', () => {
    // 'marketing_email' als Zweck UND als Ankreuzmöglichkeit wäre dieselbe Einwilligung zweimal —
    // die Person würde zweimal gefragt und bekäme zwei Bestätigungsmails für dasselbe.
    for (const key of LEAD_SOURCE_KEYS) {
      const entry = LEAD_CAPTURE_REGISTRY[key]
      if (entry.purpose === 'marketing_email') {
        expect(entry.offersMarketingConsent, `Eintrag "${key}"`).toBe(false)
      }
    }
  })
})
