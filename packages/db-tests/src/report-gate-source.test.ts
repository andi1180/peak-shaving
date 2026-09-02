// DB-Gate für das Name/Firma-Gate vor dem Report-Download (Delta 16b).
//
// DIE EINE FRAGE, DIE DIESE DATEI BEANTWORTET: Kann `apps/website` unter der neuen Herkunft und mit
// dem neuen Zweck tatsächlich einen Lead samt BESTÄTIGTER Einwilligung anlegen — und stimmen die
// drei Orte überein, an denen der Schlüssel steht?
//
// ── WARUM DER SCHLÜSSEL DREIMAL EXISTIERT UND EIN TEST IHN ZUSAMMENHÄLT ──────────────────────────
// `packages/shared/src/report-gate.ts` (was `apps/website` benutzt), `platform.lead_sources` (der
// Fremdschlüssel) und `apps/web/lib/leads/registry.ts` (`LEAD_SOURCE_KEYS_WITHOUT_FORM`, das der
// bestehende Registry-Abgleich in BEIDE Richtungen prüft). Ein Import zwischen den beiden
// TypeScript-Orten ist versperrt: `registry.ts` ist ausdrücklich abhängigkeitsfrei gehalten, damit
// genau dieses Gate sie relativ lesen kann („Bitte so lassen." steht in ihrem Kopf). Statt die Regel
// aufzuweichen, misst dieser Test die Gleichheit — und macht damit dieselbe Zusage, die
// `lead-source-registry.test.ts` für die Menge aller Herkünfte macht.
//
// ── ARBEITSREGEL 2: DER WRAPPER WIRD TATSÄCHLICH AUFGERUFEN ─────────────────────────────────────
// Introspektion (Enum-Wert da, Zeile da, Text da) beweist ausschliesslich Existenz. Dass unter
// dieser Kombination ein Lead ENTSTEHEN kann, beweist nur der Aufruf — in einer Transaktion mit
// `rollback`, der Bestand bleibt unangetastet.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REPORT_GATE_CONSENT_PURPOSE, REPORT_GATE_SOURCE_KEY } from 'shared'

import { assertStackReachable, pool, runAs, sql } from './client'
import { LEAD_SOURCE_KEYS_WITHOUT_FORM } from '../../../apps/web/lib/leads/registry'

beforeAll(async () => {
  await assertStackReachable()
})

afterAll(async () => {
  await pool.end()
})

describe('Delta 16b — Herkunft, Zweck und Wortlaut existieren', () => {
  it('der Herkunftsschlüssel steht AKTIV und mit Bezeichnung in platform.lead_sources', async () => {
    const rows = await sql<{ key: string; label: string; is_active: boolean }>(
      `select key, label, is_active from platform.lead_sources where key = $1`,
      [REPORT_GATE_SOURCE_KEY],
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.is_active).toBe(true)
    // Ohne Bezeichnung zeigte die Herkunftsauswertung im Admin-Bereich einen rohen Schlüssel.
    expect(rows[0]?.label?.trim()).toBeTruthy()
  })

  it('der Einwilligungszweck ist ein Wert des DB-Enums platform.consent_purpose', async () => {
    const rows = await sql<{ value: string }>(
      `select unnest(enum_range(null::platform.consent_purpose))::text as value`,
    )
    expect(rows.map((row) => row.value)).toContain(REPORT_GATE_CONSENT_PURPOSE)
  })

  /*
   * DIE EIGENSCHAFT, AUF DER DER GANZE ABLAUF RUHT. Wäre der Zweck bestätigungspflichtig, legte
   * `capture_lead` die Einwilligung als 'pending' an und meldete 'consent_created' — der Nutzer
   * müsste dann eine Bestätigungsmail anklicken, bevor die Einwilligung wirkt. `apps/website` hat
   * aber überhaupt keinen Mailversand: die Mail käme nie, und der Report wäre gegen eine
   * Einwilligung getauscht, die dauerhaft unbestätigt bliebe.
   */
  it('der Zweck ist NICHT bestätigungspflichtig — sonst hinge der Download an einer Mail', async () => {
    const rows = await sql<{ requires: boolean }>(
      `select platform.purpose_requires_double_opt_in($1::platform.consent_purpose) as requires`,
      [REPORT_GATE_CONSENT_PURPOSE],
    )
    expect(rows[0]?.requires).toBe(false)
  })

  it('die jüngste deutsche Textfassung trägt KEINE interne Review-Markierung mehr', async () => {
    const rows = await sql<{ version: number; body: string }>(
      `select version, body from platform.consent_texts
        where purpose = $1::platform.consent_purpose and locale = 'de'
        order by version desc`,
      [REPORT_GATE_CONSENT_PURPOSE],
    )

    expect(rows.length).toBeGreaterThanOrEqual(2)
    /*
     * ⚠ DIESE PRÜFUNG HAT IHR VORZEICHEN GEWECHSELT, UND ZWAR BEWUSST.
     *
     * Bis 02.09.2026 stand hier das Gegenteil: die Fassung MUSSTE „[MARTIN: Copy / rechtlich" im
     * Body tragen, damit ein ungeprüfter Platzhalter im append-only-Bestand als solcher erkennbar
     * bleibt. Gemessen wurde damit aber die falsche Stelle: der Body ist KUNDENTEXT — er steht im
     * Report-Download-Dialog neben der Ankreuzmöglichkeit. Die Markierung war also nicht für uns
     * sichtbar, sondern für den Kunden, und sie stand mitten in seiner Einwilligungserklärung.
     *
     * Der Vorbehalt ist damit nicht verschwunden, er steht jetzt dort, wo er hingehört: im Kopf der
     * Migration und in `Fahrplan_2026.md` §7 (Owner Martin). Kommt die geprüfte Fassung, ist sie
     * eine version 3 — und diese Prüfung bleibt dann unverändert richtig.
     */
    expect(rows[0]?.body).not.toContain('[MARTIN')
    expect(rows[0]?.body.startsWith('Ich willige ein, dass die COOLiN ENERGY GmbH')).toBe(true)
  })

  it('die ältere Fassung bleibt unangetastet — append-only ist der Nachweis', async () => {
    /*
     * Fassung 1 belegt weiterhin korrekt, was denjenigen angezeigt wurde, die sie gesehen haben.
     * Ein UPDATE darauf änderte rückwirkend den Wortlaut, dem bereits erfasste Leads zugestimmt
     * haben — genau das verhindert `reject_consent_text_mutation` (B1-1). Der Test hält fest, dass
     * die Korrektur als NEUE Zeile kam und nicht als Bearbeitung.
     */
    const rows = await sql<{ body: string }>(
      `select body from platform.consent_texts
        where purpose = $1::platform.consent_purpose and locale = 'de' and version = 1`,
      [REPORT_GATE_CONSENT_PURPOSE],
    )
    expect(rows[0]?.body).toContain('[MARTIN: Copy / rechtlich')
  })
})

describe('Delta 16b — die drei Orte des Schlüssels stimmen überein', () => {
  it('shared und die Registry von apps/web nennen denselben Schlüssel', () => {
    /*
     * Ohne diese Zeile könnte `apps/website` unter einem Schlüssel schreiben, den der
     * Registry-Abgleich gar nicht kennt — der Aufruf scheiterte dann am Fremdschlüssel, und zwar
     * erst beim ersten echten Download-Versuch im Betrieb.
     */
    expect([...LEAD_SOURCE_KEYS_WITHOUT_FORM]).toContain(REPORT_GATE_SOURCE_KEY)
  })

  it('der Schlüssel steht NICHT in der Formular-Registry von apps/web', async () => {
    /*
     * Stünde er dort, akzeptierte `findLeadCaptureEntry` ihn am GENERISCHEN, öffentlichen
     * Erfassungs-Endpunkt von coolin.at — und es entstünde ein Lead, der einen heruntergeladenen
     * Report behauptet, den es nie gab. Dieselbe Gefahr wie bei 'partner-empfehlung' (B16-2) und
     * 'telefonanfrage' (B19); dort ist sie im Kopf von `registry.ts` ausformuliert.
     *
     * Der Import steht IM Test und nicht oben, damit diese Datei ohne ihn läuft, falls die
     * Formular-Registry je umzieht — die Aussage hängt an `isLeadCaptureFormKey`, nicht am Modul.
     */
    const { isLeadCaptureFormKey } = await import('../../../apps/web/lib/leads/registry')
    expect(isLeadCaptureFormKey(REPORT_GATE_SOURCE_KEY)).toBe(false)
  })
})

describe('Delta 16b — der Aufruf (Arbeitsregel 2)', () => {
  it('legt Lead UND SOFORT BESTÄTIGTE Einwilligung an', async () => {
    await runAs({ role: 'service_role' }, async (client) => {
      const { rows } = await client.query<{ outcome: string; lead_id: string }>(
        `select r ->> 'outcome' as outcome, r ->> 'lead_id' as lead_id
           from public.capture_lead(
                  p_email       => $1,
                  p_source_key  => $2,
                  p_purpose     => $3::platform.consent_purpose,
                  p_company     => 'Bäckerei Gruber GmbH',
                  p_first_name  => 'Anna',
                  p_last_name   => 'Gruber',
                  p_locale      => 'de'
                ) as r`,
        ['delta16b-gate@example.invalid', REPORT_GATE_SOURCE_KEY, REPORT_GATE_CONSENT_PURPOSE],
      )

      /*
       * 'consent_confirmed' — NICHT 'consent_created'. Das ist die Aussage der Datenbank darüber,
       * dass die Einwilligung bereits wirkt: der Download darf sofort freigegeben werden. Der
       * Anwendungscode verzweigt strikt am `outcome`, nie am Zweck (B3-2, Regel 3).
       */
      expect(rows[0]?.outcome).toBe('consent_confirmed')
      const leadId = rows[0]?.lead_id
      expect(leadId).toBeTruthy()

      const { rows: lead } = await client.query<{
        first_source_key: string
        company: string
        first_name: string
        last_name: string
      }>(
        `select first_source_key, company, first_name, last_name
           from platform.leads where id = $1`,
        [leadId],
      )
      expect(lead[0]?.first_source_key).toBe(REPORT_GATE_SOURCE_KEY)
      expect(lead[0]?.company).toBe('Bäckerei Gruber GmbH')
      // Vor- und Nachname stehen GETRENNT — nur die Anzeige auf dem Deckblatt setzt sie zusammen.
      expect(lead[0]?.first_name).toBe('Anna')
      expect(lead[0]?.last_name).toBe('Gruber')

      const { rows: consents } = await client.query<{
        status: string
        confirmed_at: string | null
        purpose: string
        source_key: string
        token_hash: string | null
      }>(
        `select c.status, c.confirmed_at, ct.purpose::text as purpose, c.source_key, c.token_hash
           from platform.consents c
           join platform.consent_texts ct on ct.id = c.consent_text_id
          where c.lead_id = $1`,
        [leadId],
      )
      expect(consents).toHaveLength(1)
      expect(consents[0]?.status).toBe('confirmed')
      expect(consents[0]?.confirmed_at).toBeTruthy()
      expect(consents[0]?.purpose).toBe(REPORT_GATE_CONSENT_PURPOSE)
      // Die Einwilligung trägt die Herkunft, an der sie erteilt wurde — die Grundlage der
      // Kanalauswertung in `admin_lead_source_stats`.
      expect(consents[0]?.source_key).toBe(REPORT_GATE_SOURCE_KEY)
      // Ohne Bestätigungspflicht wird ein übergebener Token verworfen (B3-2) — hier wird ohnehin
      // keiner erzeugt, aber die Spalte muss leer sein.
      expect(consents[0]?.token_hash).toBeNull()
    })
  })

  it('die archivierte Fassung ist die, die auch angezeigt wird', async () => {
    /*
     * Angezeigter und archivierter Wortlaut MÜSSEN dieselbe Quelle haben (§5.1). Die Anwendung holt
     * den Text über `public.get_active_consent_text`, `capture_lead` löst ihn beim Archivieren
     * selbst auf — beide benutzen dieselbe Auswahlregel. Dieser Test misst, dass sie tatsächlich
     * beim selben Text landen; ohne ihn könnte die Anzeige eine andere Fassung zeigen als der
     * Nachweis trägt, und der Nachweis wäre wertlos.
     */
    await runAs({ role: 'service_role' }, async (client) => {
      const { rows: shown } = await client.query<{ body: string }>(
        `select r ->> 'body' as body
           from public.get_active_consent_text($1::platform.consent_purpose, 'de') as r`,
        [REPORT_GATE_CONSENT_PURPOSE],
      )

      const { rows: captured } = await client.query<{ lead_id: string }>(
        `select r ->> 'lead_id' as lead_id
           from public.capture_lead(
                  p_email      => $1,
                  p_source_key => $2,
                  p_purpose    => $3::platform.consent_purpose,
                  p_locale     => 'de'
                ) as r`,
        ['delta16b-text@example.invalid', REPORT_GATE_SOURCE_KEY, REPORT_GATE_CONSENT_PURPOSE],
      )

      const { rows: archived } = await client.query<{ body: string }>(
        `select ct.body from platform.consents c
           join platform.consent_texts ct on ct.id = c.consent_text_id
          where c.lead_id = $1`,
        [captured[0]?.lead_id],
      )

      expect(archived[0]?.body).toBe(shown[0]?.body)
    })
  })

  /*
   * DIE RECHTEKANTE. Der Schlüssel liegt jetzt in einem ZWEITEN Vercel-Projekt
   * (`peak-shaving-website`) — die Wrapper dürfen deshalb weiterhin ausschliesslich `service_role`
   * offenstehen. Ein Grant an `anon` machte das Report-Gate zu einem offenen Schreibzugang auf den
   * Lead-Bestand; einer an `authenticated` gälte für jedes angemeldete Konto der Plattform.
   *
   * Geprüft über `has_function_privilege` und NICHT über einen Aufruf als Rolle ohne Grant
   * (Arbeitsregel 5: ein solcher Aufruf hat den Postgres-Prozess schon einmal mit Signal 11
   * abgeschossen).
   */
  it('capture_lead und get_active_consent_text bleiben service_role-only', async () => {
    const rows = await sql<{ fn: string; role: string; allowed: boolean }>(
      `select fn, role, has_function_privilege(role, fn, 'EXECUTE') as allowed
         from unnest(array[
                'public.capture_lead(text, text, platform.consent_purpose, text, timestamptz, ' ||
                'text, text, text, text, inet, text, text, platform.industry, text, integer, ' ||
                'text, text, date, text, text, text)',
                'public.get_active_consent_text(platform.consent_purpose, text)'
              ]) as fn,
              unnest(array['anon', 'authenticated', 'service_role']) as role`,
    )

    // Zwei Funktionen × drei Rollen. Ohne diese Zeile liefe die Schleife darunter bei einer leeren
    // Antwort (Tippfehler in einer Signatur) durch, ohne etwas zu prüfen.
    expect(rows).toHaveLength(6)
    for (const row of rows) {
      expect(row.allowed, `${row.role} → ${row.fn}`).toBe(row.role === 'service_role')
    }
  })
})
