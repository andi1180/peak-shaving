import type { LoadProfile } from 'shared'

import { utcMsToLocalFields } from '../parser/datetime'

/**
 * D5 — Monate, in denen eine VORHANDENE PV-Anlage im Lastgang keinen Mittagseinbruch zeigt.
 *
 * ── DAS SIGNAL IST EINE ABWESENHEIT, UND DAS IST DER GANZE PUNKT ───────────────────────────────
 * Eine laufende PV-Anlage drückt den Netzbezug um die Mittagszeit gegen null und, sobald sie mehr
 * erzeugt als der Betrieb gerade braucht, darunter (`gridPowerKw` ist signiert, − = Einspeisung).
 * Gesucht wird deshalb nicht ein Ausschlag, sondern sein FEHLEN: ein Monat, in dem der kleinste
 * im Tagfenster gemessene Wert die Nahe-Null-Schwelle an KEINEM Zeitpunkt unterschreitet.
 *
 * ⚠ DAS IST EINE BEOBACHTUNG AM LASTGANG UND KEINE DIAGNOSE. Die Funktion weiss nicht, ob ein
 * Wechselrichter stand, ein Schnee auf den Modulen lag, ein Zähler falsch lieferte oder die Anlage
 * in diesem Zeitraum schlicht noch nicht in Betrieb war. Sie sagt, was in den Daten nicht zu sehen
 * war; welchen Schluss das trägt, entscheidet der Mensch, der die Anlage kennt.
 *
 * ⚠ KEIN `hasPv`-PARAMETER. Ob es überhaupt eine Anlage gibt, weiss der Aufrufer und nicht der
 * Rechenkern — dieselbe Arbeitsteilung wie bei `annualizationFactor` (das nicht fragt, ob
 * hochgerechnet werden SOLL). Ohne PV ist das Ergebnis dieser Funktion bedeutungslos, nicht falsch:
 * ein Betrieb ohne Anlage hat in jedem Monat einen Treffer, und das ist die richtige Antwort auf
 * eine Frage, die niemand hätte stellen sollen.
 *
 * ⚠ SIE FASST DIE LÜCKEN-ERKENNUNG DES PARSERS NICHT AN (`LoadProfileGap`, `prepare.ts`). Dort geht
 * es um FEHLENDE Messwerte; hier um vorhandene Messwerte, die etwas nicht zeigen. Zwei Signale,
 * die zufällig beide „da ist nichts" heissen und nichts miteinander zu tun haben.
 */

/**
 * Das Tagfenster, in dem eine Anlage ihren Einbruch zeigen müsste: 10–16 Uhr Ortszeit.
 *
 * ⚠ DIE ZAHLEN SIND DIESELBEN WIE IM SNAP-FENSTER DER WIENER NETZE (Sommerhalbjahr, 10–16 Uhr,
 * Preisblatt WN-EX0105) — GETEILT WIRD DER WERT TROTZDEM NICHT, und das ist kein Versehen. Das
 * SNAP-Fenster ist DATEN: es steht als Zeile in der gepflegten Tarifschicht
 * (`GridTariffWindowInput`, `packages/shared/src/tariff-pricing.ts`) und kann sich mit der nächsten
 * Verordnung ändern, ohne dass die Sonne davon anders scheint. Es gibt im Produktionscode auch gar
 * keine Konstante dafür — die 10/16 stehen ausschliesslich in Testfixtures, abgeschrieben aus dem
 * Preisblatt. Diese Konstante hier ist eine PHYSIKALISCHE Annahme über die Ertragskurve einer
 * Anlage in Mitteleuropa. Beide an dieselbe Zahl zu binden hiesse, dass eine geänderte
 * Netzentgelt-Verordnung still die PV-Erkennung verstellt.
 *
 * `[ANNAHME]` — enger als die tatsächliche Ertragszeit gewählt: auch im Dezember liegt die
 * Mittagsspitze innerhalb dieser sechs Stunden, und ein zu weites Fenster nähme im Sommer
 * Randstunden mit hohem Verbrauch und wenig Erzeugung auf, in denen eine gesunde Anlage den Bezug
 * nicht gegen null zieht.
 */
export const PV_DAY_WINDOW_FROM_HOUR = 10
export const PV_DAY_WINDOW_TO_HOUR = 16

/**
 * Ab wann ein Messwert als „nahe null" gilt, in kW.
 *
 * `[ANNAHME]` — ein Zehntel Kilowatt. Der Wert hat KEINE Toleranz nach oben nötig: eine Anlage, die
 * arbeitet, unterschreitet ihn an irgendeinem Tag des Monats deutlich (bei ausreichender
 * Dimensionierung sogar negativ). Er ist bewusst knapp über null statt exakt null, weil ein
 * Lastgang, dem eine Erzeugungsreihe rechnerisch abgezogen wurde, den Nullpunkt um
 * Rundungsbeträge verfehlen kann.
 *
 * ⚠ ⚠ DIE GRENZE DIESER SCHWELLE — UND SIE IST DIE WICHTIGSTE EIGENSCHAFT DIESER DATEI:
 * sie ist ABSOLUT und nicht am Verbrauchsniveau des Betriebs gemessen. Eine 30-kWp-Anlage auf einem
 * Betrieb mit 80 kW Grundlast senkt den Bezug mittags spürbar, bringt ihn aber NIE nahe null — ein
 * solcher Lastgang sähe für diese Funktion aus wie eine ausgefallene Anlage. Genau davor schützt die
 * Referenzbedingung unten (s. `detectPvOutageMonths`): ohne einen einzigen Monat, der den Einbruch
 * zeigt, wird gar nichts gemeldet.
 */
export const PV_NEAR_ZERO_KW = 0.1

/**
 * Wie viele Tage mit Messwerten IM TAGFENSTER ein Monat braucht, um überhaupt beurteilt zu werden.
 *
 * `[ANNAHME]` — 20 Tage. Ein angebrochener Rand-Monat (Lastgang beginnt am 20.) trägt zu wenig
 * Mittage, um aus ihrem Verhalten etwas zu schliessen: ein paar trübe Tage genügten dort für einen
 * Treffer. Bewusst hoch angesetzt, weil die Fehlerrichtung nicht symmetrisch ist — ein übersehener
 * Ausfall kostet einen Hinweis, ein erfundener kostet die Glaubwürdigkeit des ganzen Reports.
 *
 * ⚠ GEZÄHLT WERDEN TAGE MIT WERTEN IM FENSTER, nicht Tage mit irgendwelchen Werten. Ein Monat, von
 * dem nur die Nächte vorliegen, hat zur Mittagsfrage nichts beizutragen, so vollständig er sonst
 * auch sein mag.
 */
export const PV_OUTAGE_MIN_DAYS_PER_MONTH = 20

/**
 * Ab wie vielen Tagen mit einem Tagesminimum unter `PV_NEAR_ZERO_KW` ein beurteilter Monat als
 * „stark" gilt — als Nachbar belegt er, dass die Anlage unmittelbar davor oder danach sichtbar lief.
 *
 * `[ANNAHME, wenige Beobachtungen]` — 10 Tage. Kalibrierbasis: in einem Gewerbe-Lastgang mit PV
 * zeigten November und Januar je 3 Tage (Winter-Randereignisse), der Oktober 12; in einem
 * Privat-Lastgang der Mai 28 Tage; im Test-Muster Feb–Apr tragen Jan und Mai alle Tage. Jeder Wert
 * von 4 bis 27 trennt diese Fälle gleich, 10 ist gewählt. Es sind drei echte Lastgänge — der Wert
 * ist an mehr Fällen zu prüfen, bevor man ihm mehr Gewicht gibt.
 */
export const PV_STRONG_MONTH_MIN_DAYS = 10

/** Ein Monat ohne erkennbaren Mittagseinbruch — chronologisch, mit dem Beleg dafür. */
export type PvOutageMonth = {
  /** Kalenderjahr in Ortszeit des Lastgangs. */
  year: number
  /** 1–12, Ortszeit. */
  month: number
  /** Tage dieses Monats mit mindestens einem Messwert im Tagfenster. */
  daysWithDayWindowData: number
  /**
   * Der KLEINSTE im Tagfenster gemessene Netzbezug dieses Monats, in kW — der Beleg der Aussage.
   * Er liegt konstruktionsbedingt über `PV_NEAR_ZERO_KW`; wie weit darüber, sagt, ob die Anlage
   * schwach lieferte oder gar nicht.
   */
  minDayWindowKw: number
}

type MonthTally = {
  year: number
  month: number
  /** Tag → kleinster Messwert dieses Tages im Tagfenster. */
  dayMinKw: Map<number, number>
}

/** Fortlaufender Monatsindex — der Jahreswechsel ist damit eine gewöhnliche Nachbarschaft. */
function monthIndex(tally: Pick<MonthTally, 'year' | 'month'>): number {
  return tally.year * 12 + (tally.month - 1)
}

function minKwOf(tally: MonthTally): number {
  return Math.min(...tally.dayMinKw.values())
}

function isJudged(tally: MonthTally): boolean {
  return tally.dayMinKw.size >= PV_OUTAGE_MIN_DAYS_PER_MONTH
}

/** Beurteilt UND an genug Tagen mit sichtbarem Einbruch. Ein fehlender Monat ist nie stark. */
function isStrong(tally: MonthTally | undefined): boolean {
  if (!tally || !isJudged(tally)) return false
  let daysBelow = 0
  for (const kw of tally.dayMinKw.values()) if (kw < PV_NEAR_ZERO_KW) daysBelow += 1
  return daysBelow >= PV_STRONG_MONTH_MIN_DAYS
}

function monthKey(year: number, month: number): string {
  return `${year}-${month}`
}

/**
 * Die Monate ohne erkennbaren Mittagseinbruch, chronologisch.
 *
 * ── ⚠ DIE REFERENZBEDINGUNG: OHNE EINEN BELEGTEN EINBRUCH WIRD NICHTS GEMELDET ─────────────────
 * Zeigt KEIN ausreichend abgedeckter Monat des Lastgangs einen Wert unter der Schwelle, liefert die
 * Funktion eine leere Liste — auch dann, wenn damit jeder einzelne Monat als Treffer durchginge.
 * Der Grund ist, dass zwei sehr verschiedene Lagen in den Daten identisch aussehen: eine Anlage, die
 * das ganze Jahr stand, und eine Anlage, die für diesen Betrieb schlicht zu klein ist, um den Bezug
 * je nahe null zu bringen (s. `PV_NEAR_ZERO_KW`). Wo der Lastgang selbst nicht beweist, dass diese
 * Anlage einen sichtbaren Einbruch überhaupt erzeugen KANN, ist „hier fehlt er" eine Behauptung und
 * keine Beobachtung.
 *
 * ⚠ DER PREIS DAFÜR IST BENANNT: ein ganzjähriger Totalausfall wird dadurch NICHT erkannt. Das ist
 * die gewollte Richtung — er fällt einem Menschen, der die Jahresabrechnung sieht, ohnehin auf; eine
 * falsch beschuldigte Anlage fällt niemandem auf.
 *
 * ── ⚠ DIE KONTINUITÄTSREGEL: EINE FOLGE ZÄHLT NUR MIT EINEM STARKEN NACHBARN ────────────────────
 * Die Schwelle kennt KEINE Jahreszeit. Ein Betrieb, dessen Anlage im Juli bis auf −20 kW einspeist,
 * im Dezember aber auch bei bester Funktion nur von 40 auf 30 kW drückt, bekam den Dezember als
 * Treffer gemeldet; im Winter qualifizieren sich zudem nur wenige Tage je Monat, ein Monat mit null
 * ist dort kein starkes Signal. Statt eines Ertragsmodells (Standort, Neigung, Nennleistung — Eingaben,
 * die diese reine Funktion nicht hat, B22) verlangt die Funktion deshalb eine Stufe im Verlauf:
 * die Treffer-Monate werden zu Folgen aufeinanderfolgender Kalendermonate gruppiert, und eine Folge
 * wird nur gemeldet, wenn der Monat direkt davor ODER direkt danach „stark" ist
 * (`PV_STRONG_MONTH_MIN_DAYS`). Fehlt der Nachbar oder ist er unbeurteilt, ist er nicht stark.
 *
 * ⚠ DER PREIS DAFÜR IST BENANNT: ein Ausfall, der erst im letzten (oder erst im ersten) Datenmonat
 * beginnt, hat keinen starken Nachbarn und wird nicht gemeldet — dieselbe gewollte Richtung wie bei
 * der Referenzbedingung. Die Schwelle selbst bleibt absolut; ein schwacher Sommermonat NEBEN einem
 * starken wird weiterhin gemeldet.
 */
export function detectPvOutageMonths(loadProfile: LoadProfile): PvOutageMonth[] {
  const tallies = new Map<string, MonthTally>()

  for (const reading of loadProfile.readings) {
    const { year, month, day, hour } = utcMsToLocalFields(
      Date.parse(reading.ts),
      loadProfile.timezoneMeta,
    )
    /* Halboffen: 16:00 gehört nicht mehr dazu — dieselbe Kante wie bei den Tarif-Fenstern. */
    if (hour < PV_DAY_WINDOW_FROM_HOUR || hour >= PV_DAY_WINDOW_TO_HOUR) continue

    const key = monthKey(year, month)
    let tally = tallies.get(key)
    if (!tally) {
      tally = { year, month, dayMinKw: new Map() }
      tallies.set(key, tally)
    }
    const known = tally.dayMinKw.get(day)
    if (known === undefined || reading.gridPowerKw < known) {
      tally.dayMinKw.set(day, reading.gridPowerKw)
    }
  }

  const byIndex = new Map([...tallies.values()].map((tally) => [monthIndex(tally), tally]))
  const judged = [...tallies.values()].filter(isJudged)

  /* Die Referenzbedingung — s. Kopf. Ein einziger belegter Einbruch genügt. */
  const hasReference = judged.some((tally) => minKwOf(tally) < PV_NEAR_ZERO_KW)
  if (!hasReference) return []

  const candidates = judged
    .filter((tally) => minKwOf(tally) >= PV_NEAR_ZERO_KW)
    .sort((a, b) => monthIndex(a) - monthIndex(b))

  /* Maximale Folgen aufeinanderfolgender Kalendermonate; die Kontinuitätsregel — s. Kopf. */
  const runs: MonthTally[][] = []
  for (const tally of candidates) {
    const run = runs[runs.length - 1]
    if (run && monthIndex(run[run.length - 1]!) + 1 === monthIndex(tally)) run.push(tally)
    else runs.push([tally])
  }

  return runs
    .filter((run) => {
      const before = byIndex.get(monthIndex(run[0]!) - 1)
      const after = byIndex.get(monthIndex(run[run.length - 1]!) + 1)
      return isStrong(before) || isStrong(after)
    })
    .flat()
    .map((tally) => ({
      year: tally.year,
      month: tally.month,
      daysWithDayWindowData: tally.dayMinKw.size,
      minDayWindowKw: minKwOf(tally),
    }))
}
