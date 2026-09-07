/**
 * Die Vorbelegung des Tarifformulars aus einer GEPFLEGTEN Netzbetreiber-Tarifzeile (B21-2b).
 *
 * ── WARUM ES DIESE DATEI GIBT ───────────────────────────────────────────────────────────────────
 * Bis hierher kam die Vorbelegung ausschliesslich aus dem statischen Katalog
 * (`tariff-catalog.ts`, B11). Der kennt die über `/admin/netzbetreiber-tarife` eingetragenen Sätze
 * nicht — er ist ein Codemodul und wird nur durch einen PR verändert. Ein Preisblatt, das Martin
 * oder Andreas dort einträgt, blieb im Rechner damit unsichtbar, und der Kunde bekam „bei uns noch
 * kein Leistungspreis hinterlegt" zu lesen, obwohl der Satz eine Abfrage entfernt in der Datenbank
 * stand. Genau das ist die Umstellung, für die diese Datei gebaut wurde.
 *
 * ── SIE LIEGT IN `shared`, WEIL `apps/website` KEINEN TESTLAUF HAT ─────────────────────────────
 * Was hier entschieden wird, ist eine ÜBERSETZUNG mit fachlicher Wirkung — aus einer Zeile mit
 * Grundpreis und Einheit wird der Leistungspreis, an dem die gesamte Peak-Shaving-Rechnung hängt.
 * In der Oberfläche abgelegt wäre sie ungeprüft. Dieselbe Aufteilung und dieselbe Begründung wie
 * bei `report-gate.ts` (Delta 16b) und `tariff-window-rules.ts`.
 *
 * ── ⚠ WAS EINE TARIFZEILE NICHT HERGIBT — und deshalb hier NICHT erfunden wird ─────────────────
 * `public.grid_tariffs` trägt Grundpreis, Netzverlust, Preisbasis, Gültigkeit und Zeitfenster.
 * Sie trägt WEDER ein Abrechnungsmodell NOCH eine Mindestbemessung — beides sind keine Angaben
 * eines Preisblatts, sondern Regeln bzw. Vertragsgrössen. Ein Preisblatt nennt Preise, nicht die
 * Regel dahinter; dieselbe Feststellung, mit der Delta 9b-2a das Abrechnungsmodell aus dem
 * Rechnungs-Scan heraushält („eine Rechnung zeigt einen abgerechneten Wert, nicht die Regel").
 *
 *   – `billingModel` wird deshalb NICHT vorbelegt. Es bleibt, was im Formular steht.
 *   – `minBillableKw` wird mit **0** vorbelegt, und das ist keine erfundene Zahl, sondern die
 *     einzige, die nichts behauptet: der Sockel kann den abgerechneten Leistungswert nur ANHEBEN
 *     (`billedKw = max(berechnet, minBillableKw)`, §3.5) — eine 0 erfindet also weder Kosten noch
 *     Ersparnis, eine positive Zahl täte beides. Es ist zugleich exakt der Wert, den B11 für
 *     DASSELBE Preisblatt führt (Wiener Netze NE 3, `minBillableKw: 0`).
 */
import type { BillingModel } from './tariff'
import type { GridTariffRowInput } from './tariff-pricing'
import {
  tariffProfileKey,
  type Netzebene,
  type NetzbetreiberId,
  type TariffSelection,
} from './tariff-catalog'

/**
 * Die Felder einer Tarifzeile, die für die Vorbelegung gelesen werden.
 *
 * Strukturell eine Erweiterung von `GridTariffRowInput` um den Anzeigenamen — `fetchGridTariffs`
 * liefert ihn ohnehin mit, und die Herkunftszeile im Formular soll den Betreiber nennen, wie er im
 * Preisblatt steht, statt ihn aus einer zweiten Tabelle zu holen.
 */
export type GridTariffPrefillRow = GridTariffRowInput & { operatorName?: string }

/**
 * Was die Vorbelegung dem Formular liefert.
 *
 * `netzArbeitspreisCtPerKwh` und `netzverlustCtPerKwh` sind AUSDRÜCKLICH KEINE Formularfelder,
 * sondern reine Anzeigewerte für die Herkunftszeile (Prinzip 5: nachvollziehbar, was gilt).
 *
 * ⚠ Sie gehören NICHT in `energyPriceCtPerKwh`. Das ist der Arbeitspreis des STROMLIEFERANTEN;
 * ein Netz-Arbeitspreis dort wäre eine Zahl an der falschen Stelle und ginge als Eigenverbrauchs-
 * wert in jede Ersparnis ein. Ihren richtigen Weg in die Rechnung nehmen die beiden bereits seit
 * B21-3b: über `loadTariffPricing` → `intervalTariffRates` in den kombinierten Intervallpreis
 * (Delta 4). Sie hier zusätzlich in ein Feld zu schreiben hiesse, sie doppelt zu zählen.
 */
export type GridTariffPrefill = {
  /** Die zwei Formularfelder, die eine Tarifzeile belegen darf — mehr gibt sie nicht her. */
  fields: {
    leistungspreisEurPerKwYear: number
    minBillableKw: number
  }
  /** Die Herkunftsangabe, die durch Report und Analyse-Bündel reist (B14, Fassung 2). */
  selection: TariffSelection
  /**
   * Der Preis des Fensters mit der WEITESTEN Abdeckung — der Grundsatz-Arbeitspreis der Zeile.
   * `null`, wenn die Zeile gar kein Fenster trägt (ein Zustand, den `create_grid_tariff` nicht
   * entstehen lässt, ein Eingriff von Hand aber schon).
   */
  netzArbeitspreisCtPerKwh: number | null
  /** Die Zahl der Zeitfenster — mehr als eines heisst: der Preis wechselt über den Tag/das Jahr. */
  windowCount: number
  netzverlustCtPerKwh: number
  /** Anzeigename aus der Zeile, sonst die Kennung — für die Herkunftszeile. */
  operatorLabel: string
  validFrom: string
  /**
   * ⚠ Nur `'eur_per_kw_year'` ist ein Leistungspreis. `'eur_per_year'` ist eine JAHRESPAUSCHALE und
   * bedeutet Leistungspreis 0 €/kW·a — also den Pfad ganz OHNE Spitzenkappung (Delta 3). Steht hier
   * mit, damit die Oberfläche den Unterschied benennen kann statt ihn als 0 zu verschweigen.
   */
  grundpreisIsLeistungspreis: boolean
  grundpreisAmount: number
}

/**
 * Die Tarifzeile, die einen Kalendertag abdeckt — oder `null`.
 *
 * ⚠ Bewusst NICHT eine zweite Umsetzung der Datierungsregel: die massgebliche steht in
 * `packages/engine/src/simulation/grid-tariff-window.ts` (`findGridTariffRow`) und wird von der
 * Oberfläche von dort importiert. Diese Funktion gibt es hier NICHT.
 */

/**
 * Aus einer Tarifzeile die Vorbelegung bilden.
 *
 * ── ⚠ `currentBillingModel` IST EIN PARAMETER, UND DAS IST DER KERN DER EHRLICHKEIT HIER ───────
 * `TariffSelection.defaults` trägt alle drei überschreibbaren Felder, weil `deriveTariffOverrides`
 * daraus ableitet, was der Nutzer GEÄNDERT hat — und diese Ableitung steht später im Report
 * („Selbst eingetragen und damit massgeblich: …") und im Analyse-Bündel.
 *
 * Ein Abrechnungsmodell, das die Tarifzeile gar nicht kennt, darf dort weder erfunden noch
 * weggelassen werden:
 *   – erfunden (etwa fest `monthly_max_average`) wäre es eine Aussage über ein Preisblatt, die das
 *     Preisblatt nicht macht — und hätte der Nutzer ein anderes Modell gewählt, erschiene es
 *     fälschlich als „überschrieben" gegenüber einem Vorgabewert, den nie jemand gesetzt hat;
 *   – weggelassen ginge nicht, ohne `TariffDefaults` aufzuweichen, und damit jede bestehende
 *     Ableitung samt Bündelformat.
 *
 * Übergeben wird deshalb das Modell, das im Formular STEHT. Damit sagt `overriddenFields` genau
 * das Wahre: der Nutzer hat es gegenüber dem Stand bei der Vorbelegung nicht mehr verändert. Dass
 * es nicht AUS dem Preisblatt stammt, sagt die Herkunftszeile im Formular im Klartext.
 */
export function gridTariffPrefill(args: {
  netzbetreiber: NetzbetreiberId
  netzebene: Netzebene
  row: GridTariffPrefillRow
  currentBillingModel: BillingModel
}): GridTariffPrefill {
  const { netzbetreiber, netzebene, row, currentBillingModel } = args

  /*
   * Delta 3: NUR `eur_per_kw_year` ist ein Leistungspreis. Eine Jahrespauschale (`eur_per_year`)
   * als Leistungspreis übernommen wäre der teuerste denkbare Lesefehler dieser Datei — sie ginge
   * mit `€/kW·a` multipliziert in die Spitzenkappungs-Ersparnis ein und ergäbe eine völlig
   * plausibel aussehende, frei erfundene Zahl. Ein UNBEKANNTER Wert wird wie eine Pauschale
   * behandelt: 0, nicht geraten.
   */
  const grundpreisIsLeistungspreis = row.grundpreisUnit === 'eur_per_kw_year'
  const grundpreisAmount = row.grundpreisAmount ?? 0
  const leistungspreisEurPerKwYear = grundpreisIsLeistungspreis ? grundpreisAmount : 0

  const fields = { leistungspreisEurPerKwYear, minBillableKw: 0 }

  return {
    fields,
    selection: {
      /*
       * Der Datensatz-Schlüssel der Zeile, mit einer Vorsilbe, die die HERKUNFT benennt. Er steht
       * in archivierten Bündeln (B14) und muss 2028 noch sagen können, welcher Stand galt — die
       * Kennung der Zeile ist dafür die stärkste verfügbare Angabe, und die Vorsilbe hält ihn von
       * den Katalog-Kennungen (`at-2026`) unterscheidbar.
       */
      tariffSetId: `grid_tariffs:${row.validFrom}`,
      tariffSetLabel: `Preisblatt ${operatorLabelOf(row, netzbetreiber)}, Netzebene ${netzebene}`,
      tariffSetValidFrom: row.validFrom,
      // Dieselbe Schlüsselform wie B11 — ein Bündel von vorher und eines von nachher bleiben
      // vergleichbar, statt an zwei Schreibweisen derselben Kombination auseinanderzufallen.
      tariffProfileKey: tariffProfileKey(netzbetreiber, netzebene),
      netzbetreiber,
      netzebene,
      defaults: { ...fields, billingModel: currentBillingModel },
    },
    netzArbeitspreisCtPerKwh: baseWindowPrice(row),
    windowCount: row.windows.length,
    netzverlustCtPerKwh: row.netzverlustCtPerKwh,
    operatorLabel: operatorLabelOf(row, netzbetreiber),
    validFrom: row.validFrom,
    grundpreisIsLeistungspreis,
    grundpreisAmount,
  }
}

function operatorLabelOf(row: GridTariffPrefillRow, fallback: string): string {
  const name = row.operatorName?.trim()
  return name ? name : fallback
}

/**
 * Der Preis des Fensters mit der WEITESTEN Abdeckung — also der Grundsatz-Arbeitspreis der Zeile.
 *
 * ⚠ Das ist ausdrücklich eine ANZEIGE-Grösse und nicht die Auswahlregel, nach der die Engine
 * rechnet: dort entscheidet je Viertelstunde `selectRateWindow` (die ENGSTE Abdeckung gewinnt,
 * `tariff-window-rules.ts`). Ein Preisblatt führt typischerweise ein ganztägiges Grundfenster und
 * darin ausgeschnittene Hochlastfenster; für eine Herkunftszeile ist das Grundfenster die richtige
 * Zahl, und dass es weitere gibt, sagt `windowCount` daneben.
 */
function baseWindowPrice(row: GridTariffPrefillRow): number | null {
  let best: { span: number; ctPerKwh: number } | null = null
  for (const w of row.windows) {
    const span = clockSpanMinutes(w.timeFrom, w.timeTo) * (w.monthDayFrom == null ? 366 : 1)
    if (best === null || span > best.span) best = { span, ctPerKwh: w.ctPerKwh }
  }
  return best?.ctPerKwh ?? null
}

/** Länge eines Uhrzeit-Fensters in Minuten; über Mitternacht laufende Fenster zählen ihren Rest. */
function clockSpanMinutes(from: string, to: string): number {
  const a = parseClock(from)
  const b = parseClock(to)
  if (a == null || b == null) return 0
  return b > a ? b - a : 24 * 60 - a + b
}

function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}
