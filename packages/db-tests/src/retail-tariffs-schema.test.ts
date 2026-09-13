// DB-Gate für die Tabelle des Lieferanten-Tarifkatalogs
// (Migration 20260913120000_create_retail_tariffs.sql).
//
// `public.retail_tariffs` ist die Lieferanten-Seite neben den Netzentgelten aus B21-1 — dieselbe
// Art Referenzdaten (veröffentlicht, ohne Personenbezug, anon-lesbar), und damit auch dieselben
// zwei Fallen, die dort gemessen statt abgeleitet werden:
//
// ── (1) DIE RECHTEFLÄCHE ENTSTEHT VON SELBST, UND ZWAR FALSCH ──────────────────────────────────
//     Supabase vergibt per ALTER DEFAULT PRIVILEGES auf jede NEUE Tabelle im `public`-Schema
//     automatisch alle Tabellenrechte an `anon`, `authenticated` und `service_role`. „Kein
//     Schreib-Grant" ist nicht dadurch erfüllt, dass die Migration keinen schreibt — es verlangt
//     ein ausdrückliches `revoke all`. Vergisst eine künftige Migration das, entsteht ein
//     öffentlich beschreibbarer Preiskatalog, und zwar lautlos: der Lesepfad funktioniert
//     unverändert, und keine Oberfläche zeigt einen Unterschied.
//     Deshalb wird die Fläche hier auf `information_schema.role_table_grants` GEMESSEN.
//
// ── (2) RLS ALLEIN GENÜGT NICHT, UND GRANTS ALLEIN AUCH NICHT ──────────────────────────────────
//     Beide Schichten werden getrennt geprüft: dass RLS aktiv ist und ausschliesslich eine
//     SELECT-Policy trägt, UND dass ein echter Schreibversuch der Client-Rollen abgewiesen wird.
//     Ein Tabellenzugriff ohne Grant wird von PostgreSQL regulär mit 42501 abgelehnt — die
//     Segfault-Vorsicht aus Arbeitsregel 5 betrifft den direkten Aufruf einer SECURITY-Funktion
//     ohne EXECUTE-Grant, nicht dies hier.
//
// ── (3) DREI CHECKS, UND EINER DAVON IST DER GRUND, WARUM ES IHN GIBT ──────────────────────────
//     `segment` und `price_basis` grenzen Wertemengen ab. `source_url` dagegen setzt eine PFLICHT
//     durch, die `not null` allein NICHT leistet: der Leerstring läuft durch. Ein Listenpreis ohne
//     Quellenbeleg ist eine Behauptung — besonders, weil dieser Katalog absehbar teilweise aus
//     einer KI-Websuche gefüllt wird. Beide Richtungen werden gemessen: leer und nur Leerzeichen
//     werden abgewiesen, ein Freitext-Beleg („Preisblatt per E-Mail vom …") wird angenommen. Der
//     zweite Teil ist der wichtigere — eine Formatprüfung auf eine URL wäre hier falsch.
//
// ── (4) DIE TABELLE IST UND BLEIBT LEER ────────────────────────────────────────────────────────
//     Die Migration legt keine Zeile an. Ein Lesezugriff mit LEEREM Ergebnis ist deshalb das
//     erwartete Verhalten — und muss vom Fall „Zugriff verweigert" unterscheidbar sein. Genau das
//     prüfen die Lesetests: leeres Array, KEIN Fehler.
//
// Alle Schreibvorgänge laufen in zurückgerollten Transaktionen (`runAs` ohne `commit`) — die
// Tabelle bleibt auch während des Laufs leer, und parallel laufende Testdateien sehen nichts.

import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import { assertStackReachable, pool, runAs, sql } from './client'

/** Rechte, deren Vorhandensein für `anon`/`authenticated` an dieser Tabelle ein Fehler wäre. */
const WRITE_PRIVILEGES = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const

/**
 * Die Rollen, die hier dauerhaft NUR lesen dürfen.
 *
 * `service_role` steht bewusst nicht in dieser Liste: Sie bekommt mit dem Schreibweg
 * (Migration …120100) genau INSERT/SELECT/UPDATE, und diese Fläche wird vollständig in
 * `retail-tariff-write-path.test.ts` gemessen — dort, wo auch der Weg steht, der sie verlangt.
 */
const READ_ONLY_ROLES = ['anon', 'authenticated'] as const

type Row = {
  provider_id?: string
  segment?: string
  price_basis?: string
  source_url?: string
  valid_from?: string
}

/** Ein vollständiger, gültiger INSERT — Abweichungen je Test über `over`. */
function insertSql(over: Row = {}): { text: string; values: unknown[] } {
  return {
    text: `insert into public.retail_tariffs
             (provider_id, provider_name, segment, energy_price_ct_per_kwh,
              base_fee_eur_per_month, price_basis, source_url, valid_from, created_by)
           values ($1, 'Gate Energie', $2, 24.1, 3.9, $3, $4, $5::date, 'gate@test.local')`,
    values: [
      over.provider_id ?? 'gate-retail-schema',
      over.segment ?? 'privat',
      over.price_basis ?? 'net',
      over.source_url ?? 'https://example.invalid/preise',
      over.valid_from ?? '2026-01-01',
    ],
  }
}

/** Führt den INSERT als Eigentümer aus und liefert den SQLSTATE (oder `null` bei Erfolg). */
async function insertCode(over: Row = {}, extra?: Row): Promise<string | null> {
  return runAs({ role: 'postgres' }, async (c) => {
    const first = insertSql(over)
    await c.query(first.text, first.values)
    if (!extra) return null
    const second = insertSql(extra)
    try {
      await c.query(second.text, second.values)
      return null
    } catch (e) {
      return (e as { code?: string }).code ?? null
    }
  }).catch((e: { code?: string }) => e.code ?? null)
}

beforeAll(assertStackReachable)
afterAll(async () => {
  await pool.end()
})

describe('retail_tariffs — Lesezugriff: anon und authenticated dürfen lesen (leer, KEIN Fehler)', () => {
  for (const role of READ_ONLY_ROLES) {
    it(`${role} liest public.retail_tariffs — leeres Ergebnis statt 42501`, async () => {
      const rows = await runAs({ role }, async (c) => {
        const res = await c.query('select * from public.retail_tariffs')
        return res.rows
      })
      expect(rows).toEqual([])
    })
  }
})

describe('retail_tariffs — Schreibzugriff: anon und authenticated werden abgewiesen', () => {
  for (const role of READ_ONLY_ROLES) {
    it(`${role} INSERT auf public.retail_tariffs scheitert mit 42501`, async () => {
      const err = await runAs({ role }, async (c) => {
        const q = insertSql()
        try {
          await c.query(q.text, q.values)
          return null
        } catch (e) {
          return e as { code?: string }
        }
      }).catch((e: { code?: string }) => e)
      // 42501 und nicht die RLS-Meldung: der Abbruch kommt auf GRANT-Ebene, also vom `revoke all`.
      expect(err?.code).toBe('42501')
    })
  }
})

describe('retail_tariffs — RLS und Rechtefläche', () => {
  it('RLS ist aktiv', async () => {
    const rows = await sql<{ relrowsecurity: boolean }>(
      `select c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'retail_tariffs'`,
    )
    expect(rows[0]?.relrowsecurity).toBe(true)
  })

  it('es gibt AUSSCHLIESSLICH eine SELECT-Policy', async () => {
    const rows = await sql<{ cmd: string }>(
      `select cmd from pg_policies
        where schemaname = 'public' and tablename = 'retail_tariffs'`,
    )
    // Kein INSERT/UPDATE/DELETE-Pfad — auch nicht als Policy, die eine spätere Migration
    // versehentlich aufweichen könnte.
    expect(rows.map((r) => r.cmd)).toEqual(['SELECT'])
  })

  it('anon und authenticated haben KEIN INSERT/UPDATE/DELETE/TRUNCATE', async () => {
    const rows = await sql<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'retail_tariffs'
          and privilege_type = any($1::text[])
          and grantee = any($2::text[])
        order by grantee, privilege_type`,
      [WRITE_PRIVILEGES as unknown as string[], READ_ONLY_ROLES as unknown as string[]],
    )
    // Ein Treffer hier heisst: das `revoke all` fehlt (oder wurde zurückgenommen) — und ein blosser
    // Schreibversuch finge das NICHT, weil RLS ihn ohnehin abweist.
    expect(rows).toEqual([])
  })

  it('anon und authenticated haben exakt SELECT', async () => {
    const rows = await sql<{ grantee: string; privs: string }>(
      `select grantee, string_agg(privilege_type, ',' order by privilege_type) privs
         from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'retail_tariffs'
          and grantee = any($1::text[])
        group by grantee order by grantee`,
      [READ_ONLY_ROLES as unknown as string[]],
    )
    expect(rows).toEqual([
      { grantee: 'anon', privs: 'SELECT' },
      { grantee: 'authenticated', privs: 'SELECT' },
    ])
  })
})

describe('retail_tariffs — die CHECKs grenzen ab, was fachlich zulässig ist', () => {
  it('segment nimmt privat und betrieb an', async () => {
    expect(await insertCode({ segment: 'privat' })).toBeNull()
    expect(await insertCode({ segment: 'betrieb' })).toBeNull()
  })

  it('segment weist einen dritten Wert ab (23514)', async () => {
    // Die beiden Werte sind wortgleich zu `platform.projects.segment`. Ein dritter Wert hier wäre
    // ein Vergleichstarif, den kein Projekt je finden könnte.
    expect(await insertCode({ segment: 'gewerbe' })).toBe('23514')
  })

  it('price_basis nimmt net und gross an, weist alles andere ab (23514)', async () => {
    expect(await insertCode({ price_basis: 'net' })).toBeNull()
    expect(await insertCode({ price_basis: 'gross' })).toBeNull()
    expect(await insertCode({ price_basis: 'brutto' })).toBe('23514')
  })

  it('source_url: leer und nur Leerzeichen werden abgewiesen (23514)', async () => {
    // Das ist die Pflicht, die `not null` allein NICHT durchsetzt: der Leerstring liefe durch.
    expect(await insertCode({ source_url: '' })).toBe('23514')
    expect(await insertCode({ source_url: '   ' })).toBe('23514')
  })

  it('source_url: ein Freitext-Beleg ist zulässig — es gibt KEINE Formatprüfung', async () => {
    // Die wichtigere Richtung. Ein Beleg muss keine URL sein; wer das erzwänge, machte den
    // manuell eingetragenen Stand („Preisblatt per E-Mail vom …") unmöglich.
    expect(await insertCode({ source_url: 'Preisblatt per E-Mail vom 12.09.2026' })).toBeNull()
    expect(await insertCode({ source_url: '  https://example.invalid/x  ' })).toBeNull()
  })

  it('checked_at und created_at werden ohne Zutun gesetzt, valid_until bleibt offen', async () => {
    const row = await runAs({ role: 'postgres' }, async (c) => {
      const q = insertSql()
      await c.query(q.text, q.values)
      const res = await c.query(
        `select valid_until, checked_at is not null ca, created_at is not null cr
           from public.retail_tariffs`,
      )
      return res.rows[0] as { valid_until: unknown; ca: boolean; cr: boolean }
    })
    // `valid_until is null` heisst „weiterhin gültig" — der Normalzustand eines frischen Stands.
    expect(row).toEqual({ valid_until: null, ca: true, cr: true })
  })
})

describe('retail_tariffs — der Unique-Constraint trennt die Kombinationen', () => {
  it('dieselbe Kombination zu demselben Stand wird abgewiesen (23505)', async () => {
    expect(await insertCode({}, {})).toBe('23505')
  })

  it('dieselbe Kombination zu einem ANDEREN Stand bleibt erlaubt', async () => {
    // Effektiv-datierte Zeilen sind der ganze Zweck: ein neuer Preis ist eine NEUE Zeile, kein
    // UPDATE. Verböte der Constraint das, wäre die Nachfolge unmöglich.
    expect(await insertCode({}, { valid_from: '2027-01-01' })).toBeNull()
  })

  it('dasselbe Datum in einem ANDEREN Segment ist eine andere Kombination', async () => {
    // Derselbe Anbieter hat für Privat und Betrieb getrennte Listenpreise — und sie gelten
    // gleichzeitig. Fehlte `segment` im Schlüssel, schlösse der eine den anderen aus.
    expect(await insertCode({ segment: 'privat' }, { segment: 'betrieb' })).toBeNull()
  })

  it('derselbe Stand bei einem ANDEREN Anbieter ist eine andere Kombination', async () => {
    expect(await insertCode({}, { provider_id: 'gate-retail-schema-2' })).toBeNull()
  })
})
