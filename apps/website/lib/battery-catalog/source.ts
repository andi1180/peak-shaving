import {
  BATTERY_CATALOG_SELECT,
  loadBatteryCatalog,
  type BatteryCatalogCategory,
  type BatteryCatalogResult,
  type BatteryCatalogRow,
} from 'shared'

import { createTariffDataClient } from '@/lib/tariff-data/client'

/**
 * Wie lange auf den Speicherkatalog gewartet wird, bevor die Meldung samt Wiederholen-Knopf steht.
 *
 * Drei Sekunden: lang genug für eine träge Mobilverbindung (die Abfrage holt heute 31 Zeilen),
 * kurz genug, dass niemand vor einer Oberfläche sitzt, die nichts sagt. Begründung der Zahl und
 * warum sie nur HIER gilt: s. der Kommentar an der Abfrage unten.
 */
export const BATTERY_CATALOG_TIMEOUT_MS = 3_000

/**
 * Der Datenbank-Port des K3a-Loaders (K3b) — `anon`, nur lesend, im Browser.
 *
 * Es entsteht KEIN zweiter Supabase-Client: `createTariffDataClient` ist derselbe, den B21-3a für
 * die Netzentgelte und Marktpreise angelegt hat (kein `persistSession`, also kein Eintrag auf dem
 * Endgerät und kein Cookie-Banner — §165 TKG, s. Kopf jener Datei). `battery_catalog` ist wie
 * `grid_tariffs` eine VERÖFFENTLICHTE Referenztabelle ohne Personenbezug; RLS gibt ausschliesslich
 * Zeilen mit `active = true` frei (K1).
 *
 * ⚠ DIE ABFRAGE FILTERT SELBST AUF `active` UND KATEGORIE, obwohl RLS das erste bereits tut und
 * der Loader beides nochmals prüft. Das ist keine Verdopplung, sondern die Reihenfolge, in der die
 * Prüfungen wirken: RLS ist die harte Grenze, der Filter hält die Antwort klein, und der Loader
 * BENENNT eine Zeile, die trotzdem durchkommt (`skipped`), statt sie mitzurechnen.
 */
export function fetchBatteryCatalog(
  category: BatteryCatalogCategory,
): Promise<BatteryCatalogResult> {
  return loadBatteryCatalog(category, async (requested) => {
    const client = createTariffDataClient()
    if (!client) {
      return {
        ok: false,
        reason: 'not_configured',
        message:
          'Die Verbindung zum Speicherkatalog ist nicht eingerichtet ' +
          '(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY fehlen).',
      }
    }

    /*
     * ⚠ DAS `try` IST NICHT VORSORGLICH — es ist gemessen. supabase-js gibt einen Datenbank- oder
     * RLS-Fehler als `{ error }` zurück, aber ein NETZFEHLER (Verbindung weg, Abbruch, CORS) lässt
     * das zugrunde liegende `fetch` WERFEN, und die Zusage „gibt `{error}` zurück" gilt dafür
     * nicht. Ohne `try` verliesse der Wurf den Loader, die Zustandsmaschine bliebe auf `loading`
     * stehen — und der Nutzer sähe dauerhaft „Speicherkatalog wird geladen …" statt der Meldung
     * samt Wiederholen-Knopf. Im Browser mit abgeschnittener Abfrage nachgewiesen.
     */
    let data: unknown[] | null = null
    try {
      const response = await client
        .from('battery_catalog')
        .select(BATTERY_CATALOG_SELECT)
        .eq('kategorie', requested)
        .eq('active', true)
        .order('usable_capacity_kwh', { ascending: true })
        /*
         * ── ⚠ K3b-2: WARUM DIESE ZWEI ZEILEN — DIE ZEHN SEKUNDEN SIND GEMESSEN, NICHT GERATEN ──
         * `@supabase/postgrest-js` 2.110.7 wiederholt einen gescheiterten GET von sich aus bis zu
         * `DEFAULT_MAX_RETRIES = 3` mal, mit exponentiellem Abstand `getRetryDelay` = 1 s, 2 s,
         * 4 s (Quelle: `PostgrestBuilder`, `executeWithRetry`). Vier Versuche plus sieben Sekunden
         * reines Warten — die Meldung samt Wiederholen-Knopf erschien deshalb erst nach rund zehn
         * Sekunden, und in dieser Zeit stand die Oberfläche auf „Speicherkatalog wird geladen …".
         *
         * ⚠ BEIDE ZEILEN SIND NÖTIG, EINE ALLEIN REICHT NICHT. `retry(false)` nimmt die drei
         * Pausen weg, aber nicht einen EINZELNEN Versuch, der gar nicht antwortet (blockierte
         * Verbindung, hängender Proxy) — dort liefe die Abfrage bis zum Zeitlimit des Browsers.
         * `abortSignal` deckt genau diesen Fall; der Wurf landet im `catch` darunter.
         *
         * ⚠ EIN KURZER NETZHÄNGER KIPPT DAMIT NICHT IN `failed`: unterhalb der drei Sekunden
         * ändert sich gar nichts, und der Knopf „Erneut versuchen" steht unmittelbar daneben.
         * Die Zahl gilt AUSSCHLIESSLICH für diesen einen Abruf — Netzentgelte und Marktpreise
         * (`tariff-data/**`) sind unberührt: sie laden bis zu 35.040 Preiszeilen seitenweise, und
         * drei Sekunden wären dort keine Störung, sondern die Regel.
         */
        .retry(false)
        .abortSignal(AbortSignal.timeout(BATTERY_CATALOG_TIMEOUT_MS))

      if (response.error) {
        return {
          ok: false,
          reason: 'request_failed',
          message: `Der Speicherkatalog liess sich nicht abrufen (${response.error.message}).`,
        }
      }
      data = response.data
    } catch (cause) {
      return {
        ok: false,
        reason: 'request_failed',
        message: `Der Speicherkatalog liess sich nicht abrufen (${
          cause instanceof Error ? cause.message : String(cause)
        }).`,
      }
    }

    /*
     * Die Zuordnung auf `BatteryCatalogRow` ist eine Zusicherung, keine Prüfung — geprüft wird
     * Zeile für Zeile im Loader (`batteryCatalogRowToCandidate`), und der wirft nicht, sondern
     * lässt eine unbrauchbare Zeile BENANNT ausfallen. Die eingebetteten Kostenbausteine kommen
     * von PostgREST je nach Beziehung als Objekt oder als Array; der Loader liest ein Objekt,
     * deshalb wird hier auf das erste Element normalisiert statt im `shared`-Paket eine zweite
     * Form zu erlauben.
     */
    const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      ...row,
      foundation_component: firstOrNull(row.foundation_component),
      installation_component: firstOrNull(row.installation_component),
    })) as BatteryCatalogRow[]

    return { ok: true, rows }
  })
}

function firstOrNull(value: unknown): unknown {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}
