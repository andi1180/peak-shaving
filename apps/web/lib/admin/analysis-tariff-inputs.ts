/**
 * Die beiden Preisseiten des Drei-Wege-Vergleichs für einen Analyse-Lauf in `apps/web` lesen.
 *
 * ── WARUM ES DIESES MODUL GIBT, OBWOHL ES DAS SCHON GIBT ───────────────────────────────────────
 * `apps/website` liest dieselben zwei Tabellen (`lib/tariff-data/grid-tariffs.ts` und
 * `.../spot-prices.ts`, B21-3a) — aber über einen eigenen, aus `NEXT_PUBLIC_*` gebauten Client für
 * den öffentlichen Rechner. Eine App importiert die andere nicht, und der Weg dorthin zöge die
 * halbe Datenschicht von `apps/website` mit. Portiert ist deshalb die ABFRAGE-LOGIK (welche Zeilen,
 * welche Bedingung, seitenweise), nicht der Client: hier läuft alles über den angemeldeten
 * Admin-Client, wie in `grid-tariff-lookup.ts` etabliert (B21-1: `authenticated` darf lesen, es
 * gibt für keine Rolle ein Schreib-Grant).
 *
 * ⚠ ZWEI REGELN LEBEN DAMIT AN ZWEI STELLEN: die Lückenprüfung (`findMissingRanges`) und der
 * Aufschlag der Intervalldauer auf das Abfrage-Ende. Beide stehen wortgleich in
 * `apps/website/lib/tariff-data/spot-prices.ts`; sie dorthin zu teilen hiesse, die Datenschicht der
 * öffentlichen App anzufassen, und die ist in diesem Schritt ausdrücklich unberührt zu lassen. Wer
 * eine der beiden Regeln ändert, ändert sie an BEIDEN Stellen — sonst rechnen Rechner und
 * Admin-Lauf mit verschiedenen Lückenbefunden über denselben Daten.
 *
 * ── VERDRAHTET SEIT DEM DREI-WEGE-VERGLEICH ────────────────────────────────────────────────────
 * `readTariffPricingForAnalysis` (unten) ist die Implementierung des `fetchTariffPricing`-Ports von
 * `runAnalysisFromMeteringPointDraft`; eingehängt wird sie in `report-render-actions.ts`.
 */
import 'server-only'

import { buildLevySchedule } from 'shared'
import type {
  GridTariffRowInput,
  SpotPricePointInput,
  SpotPriceSeriesInput,
  TariffPriceRange,
  TariffPricingInputs,
} from 'shared'

import type { createClient } from '@/lib/supabase/server'

/** Der angemeldete Admin-Client — wie in `grid-tariff-lookup.ts`, es gibt keinen service_role-Weg. */
type AdminClient = Awaited<ReturnType<typeof createClient>>

/**
 * Das Analysefenster (Delta 15 Regel A): BEIDE Grenzen inklusiv und auf den BEGINN einer
 * Viertelstunde bezogen — dasselbe, was `analysisWindow(loadProfile)` in `shared` liefert.
 */
export type AnalysisPeriod = { startIso: string; endIso: string }

/** Heute die einzige Quelle. Spiegel von `SPOT_PRICE_PROVIDER` in `apps/website`. */
const SPOT_PRICE_PROVIDER = 'awattar_at'

/** PostgREST liefert ohne `range()` höchstens 1.000 Zeilen — s. den Warnblock in `readSpotPricesForAnalysis`. */
const PAGE_SIZE = 1000

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Netzentgelte
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/*
 * ⚠ EIN Zeichenketten-LITERAL, nicht zusammengesetzt. supabase-js leitet die Ergebnistypen aus dem
 * TEXT dieser Auswahl ab; `'a' + 'b'` ergibt in TypeScript den Typ `string`, und die Ableitung
 * fällt dann auf `GenericStringError` zurück — die Abfrage liefe, aber jedes Feld wäre untypisiert
 * (in `apps/website/lib/tariff-data/grid-tariffs.ts` beim Bauen real passiert, 13 Typfehler).
 *
 * `grid_tariff_rate_windows(...)` ist die EINGEBETTETE Kind-Tabelle über den Fremdschlüssel. Anders
 * als der Vorschlag in `grid-tariff-lookup.ts` braucht der Rechenkern sie: sie tragen den
 * Arbeitspreis je Zeitfenster. Die Auswahl führt genau die Felder von `GridTariffRowInput` — die
 * Identitätsfelder (id, operator_id, netzebene) sind bewusst NICHT dabei, der Rechenkern kennt sie
 * nicht und mitgelesen wären sie Fracht ohne Konsumenten.
 */
const GRID_TARIFF_SELECT =
  'netzverlust_ct_per_kwh, grundpreis_amount, grundpreis_unit, messpreis_amount, messpreis_unit, price_basis, valid_from, valid_until, grid_tariff_rate_windows(label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh)'

export type GridTariffReadParams = {
  /** Kennung wie in `grid_tariffs.operator_id` gepflegt (`wiener_netze`, …). Ohne Fremdschlüssel, ohne CHECK. */
  operatorId: string
  /** 3–7. */
  netzebene: number
  /** `null` bei Netzebenen ohne Varianten (NE 3–6) — und dann wird auf `IS NULL` gefiltert, nicht auf „egal". */
  meteringVariant: string | null
  window: AnalysisPeriod
}

/**
 * Alle Tarifzeilen, deren Gültigkeit das Analysefenster ÜBERSCHNEIDET — in der Form, die der
 * Rechenkern liest (`TariffPricingInputs.gridTariffRows`).
 *
 * ── WARUM ALLE UND NICHT EINE ──────────────────────────────────────────────────────────────────
 * Ein Lastgang läuft typischerweise zwölf Monate und kann dabei einen Tarifwechsel überqueren
 * (Preisblätter gelten kalenderjahrweise). Nur den zum Startdatum gültigen Stand zu holen hiesse,
 * den Rest des Jahres mit den Preisen des Vorjahres zu rechnen — eine Abweichung, die niemandem als
 * Fehler auffiele, sondern als Ergebnis. Die Zuordnung Intervall → Tarifzeile trifft die Engine;
 * diese Funktion liefert ihr das vollständige Material.
 *
 * ── ⚠ `valid_until` IST INKLUSIV ───────────────────────────────────────────────────────────────
 * `public.create_grid_tariff` schliesst die Vorgängerin mit `valid_until := p_valid_from - 1`
 * (Migration 20260828090000). Der letzte Gültigkeitstag STEHT also in der Spalte; die Bedingung
 * lautet deshalb `valid_until >= periodStart` und nicht `> periodStart` — halboffen gelesen fiele
 * genau der letzte Tag jedes Stands aus dem Ergebnis, und bei einem Lastgang, der am 31.12. endet,
 * wäre das der ganze Treffer.
 *
 * Ein LEERES Ergebnis ist eine zulässige Antwort („für diese Kombination ist nichts gepflegt").
 * Bei einem Datenbankfehler wird dagegen GEWORFEN — „wir konnten nicht nachsehen" ist eine andere
 * Aussage als „es gibt nichts", und als leere Liste zurückgegeben sähe ein Ausfall aus wie ein
 * Pflegestand. Dieselbe Trennung wie in `lookupGridTariffDefaults`.
 */
export async function readGridTariffRowsForAnalysis(
  supabase: AdminClient,
  { operatorId, netzebene, meteringVariant, window }: GridTariffReadParams,
): Promise<GridTariffRowInput[]> {
  const base = supabase
    .from('grid_tariffs')
    .select(GRID_TARIFF_SELECT)
    .eq('operator_id', operatorId)
    .eq('netzebene', netzebene)
    .lte('valid_from', toDateOnly(window.endIso))
    .or(`valid_until.is.null,valid_until.gte.${toDateOnly(window.startIso)}`)
    .order('valid_from', { ascending: true })

  /*
   * ⚠ `.is(..., null)` statt `.eq(..., null)`: SQL vergleicht NULL nie per `=`. Ein `.eq` lieferte
   * für JEDE Netzebene 3–6 null Treffer, und der Hebel fiele mit „keine Netzentgelt-Daten" aus,
   * obwohl die Zeile gepflegt ist. Weglassen darf man die Variante ebensowenig: bei NE 7 kämen
   * sonst alle drei Zeilen zurück, und welche in die Analyse einginge, entschiede die
   * Sortierreihenfolge (genau der Zustand, den `nulls not distinct` aus B21-1 ausschliesst).
   */
  const { data, error } = await (meteringVariant === null
    ? base.is('metering_variant', null)
    : base.eq('metering_variant', meteringVariant))

  if (error) {
    throw new Error(`grid_tariffs konnte nicht gelesen werden: ${error.message}`)
  }

  return (data ?? []).map((row) => ({
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    netzverlustCtPerKwh: Number(row.netzverlust_ct_per_kwh),
    grundpreisAmount: Number(row.grundpreis_amount),
    grundpreisUnit: row.grundpreis_unit,
    // ⚠ `null` bleibt `null` und wird NICHT zu 0: `Number(null)` wäre 0, und ein Messpreis von 0
    // behauptete „es gibt keinen", wo in Wahrheit keiner gepflegt ist.
    messpreisAmount: row.messpreis_amount == null ? undefined : Number(row.messpreis_amount),
    messpreisUnit: row.messpreis_unit ?? undefined,
    priceBasis: row.price_basis,
    windows: (row.grid_tariff_rate_windows ?? []).map((w) => ({
      label: w.label,
      monthDayFrom: w.month_day_from,
      monthDayTo: w.month_day_to,
      timeFrom: w.time_from,
      timeTo: w.time_to,
      ctPerKwh: Number(w.ct_per_kwh),
    })),
  }))
}

/**
 * `valid_from`/`valid_until` sind `date`, das Analysefenster dagegen ein Zeitstempel. Der Vergleich
 * läuft deshalb auf Tagesebene — die Datenbank schnitte die Uhrzeit ohnehin ab, und dieser Schnitt
 * soll sichtbar hier stattfinden statt still dort.
 */
function toDateOnly(iso: string): string {
  return iso.slice(0, 10)
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Marktpreise
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Die Marktpreis-Reihe des Analysefensters, samt Lückenbefund (Delta 15 Regel C).
 *
 * ── ⚠ SEITENWEISE LESEN IST PFLICHT, NICHT VORSORGE — in B21-3a gemessen ───────────────────────
 * PostgREST begrenzt eine Antwort ohne ausdrücklichen Bereich auf **1.000 Zeilen**. Ein Jahres-
 * Lastgang braucht 8.760 Stundenpreise. Eine einzelne Abfrage lieferte also die ersten 1.000 und
 * meldete den Rest als LÜCKE — der Vergleich wäre „nicht berechenbar", und der wahre Grund stünde
 * nirgends: die Lückenmeldung sähe aus wie ein stehengebliebener Cron. Deshalb wird in Seiten zu
 * 1.000 gelesen, bis eine Seite nicht mehr voll ist.
 *
 * ── ⚠ DER AUFSCHLAG DER INTERVALLDAUER IST KEIN DETAIL ─────────────────────────────────────────
 * Das Analysefenster endet mit dem BEGINN seiner letzten Viertelstunde; der zugehörige Preis ist
 * der der Stunde, in der sie liegt. Deshalb verlangt diese Funktion `intervalMinutes` und bildet
 * das exklusive Abfrage-Ende selbst — ein Aufrufer, der den Aufschlag vergässe, bekäme für JEDEN
 * vollständigen Lastgang eine Lücke am Ende gemeldet.
 *
 * `complete: false` ist KEIN Fehler, sondern ein Betriebszustand („gelesen, aber unvollständig").
 * Geworfen wird nur, wenn gar nicht gelesen werden konnte.
 */
export async function readSpotPricesForAnalysis(
  supabase: AdminClient,
  window: AnalysisPeriod,
  intervalMinutes: number,
): Promise<SpotPriceSeriesInput> {
  const periodStart = window.startIso
  const periodEnd = iso(Date.parse(window.endIso) + intervalMinutes * 60 * 1000)

  const prices: SpotPricePointInput[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('spot_prices')
      .select('ts_start, ts_end, ct_per_kwh, price_basis')
      /*
       * Heute die einzige Quelle. Der Filter ist trotzdem gesetzt: käme eine zweite dazu (die
       * `provider`-Spalte existiert seit B21-1 genau dafür), lieferte eine ungefilterte Abfrage
       * jede Stunde doppelt — die Preiskurve wäre still verfälscht und die Lückenprüfung
       * gleichzeitig zufrieden.
       */
      .eq('provider', SPOT_PRICE_PROVIDER)
      .gte('ts_start', periodStart)
      .lt('ts_start', periodEnd)
      .order('ts_start', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      throw new Error(`spot_prices konnte nicht gelesen werden: ${error.message}`)
    }

    const page = data ?? []
    for (const row of page) {
      prices.push({
        tsStart: row.ts_start,
        tsEnd: row.ts_end,
        ctPerKwh: Number(row.ct_per_kwh),
        priceBasis: row.price_basis,
      })
    }
    if (page.length < PAGE_SIZE) break
  }

  const missingRanges = findMissingRanges(prices, periodStart, periodEnd)
  return { prices, complete: missingRanges.length === 0, missingRanges }
}

/**
 * Wo fehlen Preise? Drei Arten von Lücke, alle drei zählen gleich:
 *   1. am Anfang   — der erste Preis beginnt nach `periodStart`
 *   2. in der Mitte — zwischen zwei Einträgen klafft mehr als die Dauer des ersten
 *   3. am Ende     — der letzte Preis endet vor `periodEnd`
 *
 * Gemessen wird gegen `ts_end` des jeweils vorigen Eintrags statt gegen ein angenommenes
 * Stundenraster. Damit bleibt die Prüfung richtig, wenn eine Quelle einmal viertelstündlich
 * liefert — und über die Zeitumstellung hinweg, weil `timestamptz` in UTC verglichen wird.
 *
 * Exportiert, damit die Regel eine benannte Stelle hat und nicht in der Abfrage verschwindet.
 * Zwilling von `findMissingRanges` in `apps/website/lib/tariff-data/spot-prices.ts` — s. Kopf.
 */
export function findMissingRanges(
  prices: SpotPricePointInput[],
  periodStart: string,
  periodEnd: string,
): TariffPriceRange[] {
  const startMs = Date.parse(periodStart)
  const endMs = Date.parse(periodEnd)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return []

  const gaps: TariffPriceRange[] = []
  let coveredUntil = startMs

  for (const p of prices) {
    const from = Date.parse(p.tsStart)
    const to = Date.parse(p.tsEnd)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    if (from > coveredUntil) gaps.push({ fromIso: iso(coveredUntil), toIso: iso(from) })
    // `Math.max`, weil sich Einträge überlappen dürfen (eine feinere Quelle neben einer gröberen).
    // Ein Rückschritt würde sonst eine Lücke erfinden, die es nicht gibt.
    if (to > coveredUntil) coveredUntil = to
  }

  if (coveredUntil < endMs) gaps.push({ fromIso: iso(coveredUntil), toIso: iso(endMs) })
  return gaps
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Beide Seiten zusammen — der Port des Analyse-Laufs
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Beide Preisseiten für einen Analyse-Lauf holen — die Implementierung des `fetchTariffPricing`-
 * Ports aus `packages/extractors`.
 *
 * ── ⚠ JEDE SEITE SCHEITERT FÜR SICH ───────────────────────────────────────────────────────────
 * `Promise.allSettled` und nicht `Promise.all`: ein `all` liesse den Fehler der einen Seite die
 * andere mitreissen, und ein unlesbarer Spotpreis-Bestand brächte dann eine komplette Analyse zu
 * Fall — samt Peak Shaving und Eigenverbrauch, die von den Vergleichspreisen gar nicht abhängen.
 * Wo eine Seite scheitert, steht `null`, und die Engine kennzeichnet den Hebel als nicht
 * berechenbar (Delta 15 Regel C). Kein Rückfall, keine Ersatzwerte — dieselbe Arbeitsteilung wie
 * `loadTariffPricing` im öffentlichen Rechner (`apps/website/lib/tariff-pricing.ts`).
 *
 * ⚠ DER GRUND WIRD PROTOKOLLIERT. `null` erreicht den Report als „nicht berechenbar"; WARUM nicht,
 * steht dann nur noch hier — ohne die Zeile im Log sähe ein abgelaufener Zugriff genauso aus wie
 * ein leerer Pflegestand.
 *
 * Ohne Netzbetreiber oder Netzebene wird die Netzentgelt-Seite gar nicht erst angefragt: eine
 * Abfrage mit erfundenen Parametern lieferte entweder nichts oder die Zeile eines fremden
 * Betreibers.
 */
export async function readTariffPricingForAnalysis(
  supabase: AdminClient,
  request: {
    operatorId: string | null
    netzebene: number | null
    meteringVariant: string | null
    window: AnalysisPeriod
    intervalMinutes: number
  },
): Promise<TariffPricingInputs> {
  const { operatorId, netzebene, meteringVariant, window, intervalMinutes } = request

  const [grid, spot] = await Promise.allSettled([
    operatorId !== null && netzebene !== null
      ? readGridTariffRowsForAnalysis(supabase, { operatorId, netzebene, meteringVariant, window })
      : Promise.resolve(null),
    readSpotPricesForAnalysis(supabase, window, intervalMinutes),
  ])

  if (grid.status === 'rejected') {
    console.error('[admin/analysis] Netzentgelte nicht lesbar:', grid.reason)
  }
  if (spot.status === 'rejected') {
    console.error('[admin/analysis] Börsen-Strompreise nicht lesbar:', spot.reason)
  }

  return {
    gridTariffRows: grid.status === 'fulfilled' ? grid.value : null,
    spotPrices: spot.status === 'fulfilled' ? spot.value : null,
    /*
     * Die Abgaben stammen aus der versionierten Code-Schicht (`shared/levies.ts`), nicht aus der
     * Datenbank — dieselbe Auflösung wie im öffentlichen Rechner, damit beide Wege dieselbe
     * Rechnung ergeben. Ohne Netzbetreiber/Netzebene nicht auflösbar.
     */
    levies:
      operatorId !== null && netzebene !== null
        ? buildLevySchedule(
            operatorId,
            netzebene,
            toDateOnly(window.startIso),
            toDateOnly(window.endIso),
          )
        : null,
  }
}
