/**
 * Netzbetreiber-Tarifzeilen für einen Analyse-Zeitraum lesen (B21-3a, Delta 5).
 *
 * Liest `public.grid_tariffs` samt zugehörigen `grid_tariff_rate_windows` — nur SELECT, wie es der
 * `anon`-Rolle allein zusteht (B21-1: RLS mit genau einer SELECT-Policy, kein Schreib-Grant für
 * irgendeine Rolle; der Schreibweg ist das Admin-UI aus B21-2b).
 */
import {
  NOT_CONFIGURED,
  createTariffDataClient,
  requestFailed,
  type TariffDataFailure,
} from './client'

/** Eine Tarifzeile samt ihren Zeitfenstern — die Einheit, mit der die Engine rechnen kann. */
export type GridTariffWithWindows = {
  id: string
  operatorId: string
  operatorName: string
  netzebene: number
  /** `null` bei Netzebenen ohne Varianten (NE 3–6) — s. `nulls not distinct` in B21-1. */
  meteringVariant: string | null
  grundpreisAmount: number
  /** `eur_per_kw_year` = Leistungspreis · `eur_per_year` = Jahrespauschale (Leistungspreis 0). */
  grundpreisUnit: string
  netzverlustCtPerKwh: number
  priceBasis: string
  /** ISO-Datum (inklusiv). */
  validFrom: string
  /** ISO-Datum, INKLUSIV letzter Gültigkeitstag. `null` = weiterhin gültig. */
  validUntil: string | null
  windows: GridTariffRateWindow[]
}

export type GridTariffRateWindow = {
  id: string
  label: string
  /** 'MM-DD', jahreslos. `null` = ganzjährig. */
  monthDayFrom: string | null
  monthDayTo: string | null
  timeFrom: string
  timeTo: string
  ctPerKwh: number
}

/*
 * ⚠ EIN Zeichenketten-LITERAL, nicht zusammengesetzt. supabase-js leitet die Ergebnistypen aus dem
 * Text dieser Auswahl ab; `'a' + 'b'` ergibt in TypeScript den Typ `string`, und die Ableitung
 * fällt dann auf `GenericStringError` zurück — die Abfrage liefe, aber jedes Feld wäre untypisiert
 * (beim Bauen dieser Datei tatsächlich passiert, 13 Typfehler).
 *
 * `grid_tariff_rate_windows(...)` ist die EINGEBETTETE Kind-Tabelle über den Fremdschlüssel.
 */
const GRID_TARIFF_SELECT =
  'id, operator_id, operator_name, netzebene, metering_variant, grundpreis_amount, grundpreis_unit, netzverlust_ct_per_kwh, price_basis, valid_from, valid_until, grid_tariff_rate_windows(id, label, month_day_from, month_day_to, time_from, time_to, ct_per_kwh)'

export type GridTariffFetchResult =
  { ok: true; tariffs: GridTariffWithWindows[] } | TariffDataFailure

/**
 * Alle Tarifzeilen, deren Gültigkeit den angefragten Zeitraum ÜBERSCHNEIDET.
 *
 * ── WARUM ALLE UND NICHT EINE ──────────────────────────────────────────────────────────────────
 * Ein Lastgang läuft typischerweise zwölf Monate und kann dabei einen Tarifwechsel überqueren
 * (Preisblätter gelten kalenderjahrweise). Nur den zum Startdatum gültigen Stand zu holen hiesse,
 * den Rest des Jahres mit den Preisen des Vorjahres zu rechnen — eine Abweichung, die niemandem
 * als Fehler auffiele, sondern als Ergebnis (dieselbe Gefahr wie beim Faktor 10 in B21-2a). Die
 * Zuordnung Intervall → Tarifzeile trifft die Engine (B21-3b); diese Funktion liefert ihr das
 * vollständige Material.
 *
 * ── ⚠ `valid_until` IST INKLUSIV — gemessen, nicht angenommen ──────────────────────────────────
 * `public.create_grid_tariff` schliesst die Vorgängerin mit `valid_until := p_valid_from - 1`
 * (Migration 20260828090000). Der letzte Gültigkeitstag STEHT also in der Spalte; die Kette lautet
 * `… → 2026-12-31` / `2027-01-01 → offen`, ohne Lücke und ohne Überschneidung. Die Bedingung muss
 * deshalb `valid_until >= periodStart` lauten und nicht `> periodStart` — halboffen gelesen fiele
 * genau der letzte Tag jedes Stands aus dem Ergebnis, und bei einem Lastgang, der am 31.12. endet,
 * wäre das der ganze Treffer.
 *
 * Die Überschneidungsbedingung ist damit:
 *   valid_from <= periodEnd  UND  (valid_until IS NULL ODER valid_until >= periodStart)
 *
 * @param operatorId       Kennung des Netzbetreibers, wie in `grid_tariffs.operator_id` gepflegt
 *                         (`wiener_netze`, …). Kein Fremdschlüssel, keine Vorschlagsliste in der DB.
 * @param netzebene        3–7.
 * @param meteringVariant  `null` bei Netzebenen ohne Varianten — und dann wird ausdrücklich auf
 *                         `IS NULL` gefiltert, nicht auf „egal": beides zugleich zu liefern brächte
 *                         zwei gleichzeitig gültige Zeilen, und welche in die Analyse einginge,
 *                         entschiede die Sortierreihenfolge (genau der Zustand, den der
 *                         `nulls not distinct`-Constraint aus B21-1 ausschliesst).
 * @param periodStart      ISO-Datum oder -Zeitstempel (Beginn des Lastgangs, Delta 15 Regel A).
 * @param periodEnd        ISO-Datum oder -Zeitstempel (Ende des Lastgangs).
 */
export async function fetchGridTariffs(
  operatorId: string,
  netzebene: number,
  meteringVariant: string | null,
  periodStart: string,
  periodEnd: string,
): Promise<GridTariffFetchResult> {
  const client = createTariffDataClient()
  if (!client) return NOT_CONFIGURED

  const startDate = toDateOnly(periodStart)
  const endDate = toDateOnly(periodEnd)

  /*
   * Die Zeitfenster kommen EINGEBETTET mit (PostgREST-Beziehung über den Fremdschlüssel), nicht in
   * einer zweiten Abfrage. Zwei Abfragen wären zwei Zeitpunkte: zwischen ihnen könnte ein neuer
   * Stand entstehen, und dann trüge eine Tarifzeile die Fenster einer anderen. Eine Tarifzeile ohne
   * ihre Fenster ist ausserdem keine halbe Antwort, sondern eine falsche (B21-2b: „keine
   * Berechnungsgrundlage ist ein sicherer Zustand, eine halbe ist es nicht").
   */
  const base = client
    .from('grid_tariffs')
    .select(GRID_TARIFF_SELECT)
    .eq('operator_id', operatorId)
    .eq('netzebene', netzebene)
    .lte('valid_from', endDate)
    .or(`valid_until.is.null,valid_until.gte.${startDate}`)
    .order('valid_from', { ascending: true })

  const { data, error } = await (meteringVariant === null
    ? base.is('metering_variant', null)
    : base.eq('metering_variant', meteringVariant))
  if (error) return requestFailed(`Tarifzeilen konnten nicht gelesen werden: ${error.message}`)

  return {
    ok: true,
    tariffs: (data ?? []).map((row) => ({
      id: row.id,
      operatorId: row.operator_id,
      operatorName: row.operator_name,
      netzebene: row.netzebene,
      meteringVariant: row.metering_variant,
      grundpreisAmount: Number(row.grundpreis_amount),
      grundpreisUnit: row.grundpreis_unit,
      netzverlustCtPerKwh: Number(row.netzverlust_ct_per_kwh),
      priceBasis: row.price_basis,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      windows: (row.grid_tariff_rate_windows ?? []).map((w) => ({
        id: w.id,
        label: w.label,
        monthDayFrom: w.month_day_from,
        monthDayTo: w.month_day_to,
        timeFrom: w.time_from,
        timeTo: w.time_to,
        ctPerKwh: Number(w.ct_per_kwh),
      })),
    })),
  }
}

/**
 * `valid_from`/`valid_until` sind `date`, das Analysefenster dagegen ein Zeitstempel. Der Vergleich
 * läuft deshalb auf Tagesebene — ein Zeitstempel würde von PostgreSQL zwar auch akzeptiert, aber
 * `2025-06-01T22:00:00Z` gegen ein `date` verglichen schneidet die Uhrzeit ohnehin ab, und dieser
 * Schnitt soll hier sichtbar stattfinden statt still in der Datenbank.
 */
function toDateOnly(iso: string): string {
  return iso.slice(0, 10)
}
