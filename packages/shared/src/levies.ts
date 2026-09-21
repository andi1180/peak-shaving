/**
 * Die gesetzlichen Abgaben auf den Strombezug — Elektrizitätsabgabe, EAG-Förderbeitrag,
 * EAG-Pauschale und Gebrauchsabgabe.
 *
 * ── WARUM CODE UND NICHT `public.grid_tariffs` ─────────────────────────────────────────────────
 * Es sind Verordnungssätze, keine Preisblattzeilen: sie ändern sich durch einen Gesetzgebungsakt,
 * nicht durch einen Netzbetreiber-Nachtrag, und sie gelten für jeden Lieferanten gleich. Dieselbe
 * Ablage und dieselbe Begründung wie bei `supplier-tariffs.ts` und der B11-Tarifschicht: eine
 * Satzänderung ist ein PR mit einer Datei, samt Fundstelle und Gegenlesen.
 *
 * ── ⚠ WAS NICHT BELEGT IST, WIRD NICHT GERECHNET ──────────────────────────────────────────────
 * Hinterlegt sind ausschliesslich Sätze mit Fundstelle. Für jede Kombination aus Netzbetreiber,
 * Netzebene und Zeitraum, für die hier nichts steht, entsteht schlicht KEIN Abgabenzeitraum — der
 * Rechenkern meldet das als Lücke und verweigert den Tarifvergleich, statt mit einer zu niedrigen
 * Summe weiterzurechnen (Delta 15 Regel C, dieselbe Haltung wie `pending_regulation` in B11).
 *
 * Rein und ohne Seiteneffekte: kein I/O, kein globaler Zustand, keine Uhr.
 */

import { findGridTariffRow } from './grid-tariff-row'

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Der Übergabetyp — was der Rechenkern liest
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Ein Zeitraum, in dem alle vier Abgabensätze unverändert gelten.
 *
 * ⚠ `validUntil` ist INKLUSIV — dieselbe Lesart wie bei `GridTariffRowInput`, damit an beiden
 * datierten Reihen dieselbe Regel gilt und `findGridTariffRow` für beide taugt.
 */
export type LevyPeriodInput = {
  /** ISO-Datum, inklusiv. */
  validFrom: string
  /** ISO-Datum, INKLUSIV letzter Gültigkeitstag. `null` = weiterhin gültig. */
  validUntil: string | null
  /** Elektrizitätsabgabe, ct/kWh netto — auf jede bezogene Kilowattstunde. */
  elektrizitaetsabgabeCtPerKwh: number
  /** EAG-Förderbeitrag, ct/kWh netto — netzebenenabhängig. */
  eagFoerderbeitragCtPerKwh: number
  /** EAG-Pauschale, €/Jahr netto — verbrauchsunabhängig, tagesanteilig zu rechnen. */
  eagPauschaleEurPerYear: number
  /**
   * Gebrauchsabgabe als ANTEIL (0,07 = 7 %), und zwar AUSSCHLIESSLICH auf den Netto-NETZPREIS:
   * Netznutzung, Netzverlust, Netz-Grundpreis und Messpreis. Nicht auf Arbeitspreis,
   * Lieferanten-Grundgebühr, Elektrizitätsabgabe oder die EAG-Beiträge (Quelle s. unten).
   */
  gebrauchsabgabeRate: number
}

/**
 * Die Abgabensätze über den Analysezeitraum.
 *
 * Eine LISTE und kein einzelner Satz, weil der Gebrauchsabgabe-Satz mitten im Jahr springt
 * (Wien: 6 % bis 28.02.2026, danach 7 %). Einmal am Zeitraumbeginn ausgewertet bekäme der ganze
 * Lastgang den falschen Satz — dieselbe Falle, gegen die `findGridTariffRow` gebaut ist.
 *
 * Deckt die Liste einen Tag des Lastgangs NICHT ab, ist das eine Lücke und kein Nullsatz.
 */
export type LevySchedule = { periods: LevyPeriodInput[] }

/**
 * Der Abgabenzeitraum, der einen Kalendertag abdeckt — `null`, wenn keiner ihn abdeckt.
 *
 * Delegiert an die Datierungsregel der Tarifzeilen, statt sie nachzubauen: beide Reihen sind
 * effektiv datiert mit inklusivem Ende, und zwei Fassungen derselben Auswahl liefen auseinander.
 */
export function findLevyPeriod(
  periods: readonly LevyPeriodInput[],
  localDate: string,
): LevyPeriodInput | null {
  return findGridTariffRow(periods, localDate)
}

/**
 * Ein Plan OHNE Abgaben, ganzjährig gültig.
 *
 * ⚠ AUSSCHLIESSLICH für Tests, die etwas anderes messen und ihre Erwartungswerte nicht um die
 * Abgaben verschieben wollen. In einem Produktionspfad benutzt wäre er eine still zu niedrige
 * Rechnung — genau der Fall, den die Verweigerung oben ausschliesst. Ein Wächter hält das fest
 * (`levies.test.ts`).
 */
export const LEVIES_NONE: LevySchedule = {
  periods: [
    {
      validFrom: '1970-01-01',
      validUntil: null,
      elektrizitaetsabgabeCtPerKwh: 0,
      eagFoerderbeitragCtPerKwh: 0,
      eagPauschaleEurPerYear: 0,
      gebrauchsabgabeRate: 0,
    },
  ],
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Die Sätze
// ═══════════════════════════════════════════════════════════════════════════════════════════════

type DatedEntry = { validFrom: string; validUntil: string | null; sourceNote: string }

/**
 * Elektrizitätsabgabe — bundesweit, unabhängig von Netzbetreiber und Netzebene.
 *
 * ⚠ Der Satz für 2026 ist BEFRISTET. Ab 2027 steht hier nichts, und das ist die richtige Aussage:
 * ob die Absenkung verlängert wird, entscheidet der Gesetzgeber. Ein fortgeschriebener Satz sähe
 * aus wie eine Angabe.
 */
const ELEKTRIZITAETSABGABE: (DatedEntry & { ctPerKwh: number })[] = [
  {
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    ctPerKwh: 0.1,
    sourceNote:
      'Elektrizitätsabgabe 0,10 ct/kWh netto, befristet auf das Kalenderjahr 2026 ' +
      '(BGBl. I Nr. 95/2025). Im Repo festgehalten am 21.09.2026.',
  },
]

/**
 * EAG-Förderbeitrag und EAG-Pauschale — bundesweit, aber nach NETZEBENE gestaffelt.
 *
 * Belegt ist bislang nur die Netzebene 7. Für NE 3–6 steht hier bewusst nichts: die Sätze
 * existieren, sind aber nicht belegbar hinterlegt, und geraten wird nicht (B11, `not_yet_recorded`).
 */
const EAG_BY_NETZEBENE: Record<
  number,
  (DatedEntry & { foerderbeitragCtPerKwh: number; pauschaleEurPerYear: number })[]
> = {
  7: [
    {
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      foerderbeitragCtPerKwh: 0.62,
      pauschaleEurPerYear: 3.8,
      sourceNote:
        'EAG-Förderbeitrag 0,620 ct/kWh und EAG-Förderpauschale 3,80 €/Jahr, jeweils netto, ' +
        'Netzebene 7, Tarifjahr 2026. Im Repo festgehalten am 21.09.2026.',
    },
  ],
}

/**
 * Gebrauchsabgabe — eine Gemeinde-/Landesabgabe und deshalb als EINZIGE der vier nach
 * Netzbetreiber geschlüsselt.
 *
 * ⚠ Hinterlegt ist nur Wien. Für `netz_noe` und `salzburg_netz` steht hier nichts — sie liegen in
 * anderen Bundesländern mit eigener Regelung, und ein übernommener Wiener Satz wäre eine erfundene
 * Zahl. Ein Netzbereich OHNE Gebrauchsabgabe (Burgenland, Vorarlberg) bekäme hier einen
 * ausdrücklichen Eintrag mit `rate: 0` — „nicht erfasst" und „fällt nicht an" sind zwei
 * verschiedene Aussagen und dürfen nicht dieselbe Wirkung haben.
 */
const GEBRAUCHSABGABE_BY_OPERATOR: Record<string, (DatedEntry & { rate: number })[]> = {
  wiener_netze: [
    {
      validFrom: '2026-01-01',
      validUntil: '2026-02-28',
      rate: 0.06,
      sourceNote:
        'Gebrauchsabgabe Wien 6 % vom Netto-Netzpreis bis 28.02.2026 (wienernetze.at). ' +
        'Im Repo festgehalten am 21.09.2026.',
    },
    {
      validFrom: '2026-03-01',
      validUntil: null,
      rate: 0.07,
      sourceNote:
        'Gebrauchsabgabe Wien 7 % vom Netto-Netzpreis ab 01.03.2026 (wienernetze.at). ' +
        'Bemessungsgrundlage sind Netznutzung, Netzverlust, Netz-Grundpreis und Messpreis — ' +
        'ausdrücklich NICHT Arbeitspreis, Lieferanten-Grundgebühr oder die übrigen Abgaben.',
    },
  ],
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Zusammensetzen
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Ein ISO-Datum um `days` verschieben. Rein über `Date.UTC` — ein Datum hat keine Zeitzone. */
function shiftDate(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function pick<T extends DatedEntry>(entries: readonly T[], date: string): T | null {
  return findGridTariffRow(entries, date)
}

/**
 * Den Abgabenplan für eine Kombination und einen Zeitraum bilden.
 *
 * ── ⚠ DIE SATZWECHSEL WERDEN GESCHNITTEN, NICHT EINMAL AUSGEWERTET ────────────────────────────
 * Gesammelt werden ALLE Gültigkeitsgrenzen aller drei Quellen im Zeitraum; zwischen zwei Grenzen
 * entsteht je ein Zeitabschnitt. Nur am Zeitraumbeginn nachzusehen träfe den Sprung 6 % → 7 %
 * nicht — dieselbe Falle wie beim Netzentgelt-Backfill, der `min(valid_from)` über ALLE Zeilen
 * bildet statt nur die offene zu prüfen.
 *
 * ── ⚠ EIN ABSCHNITT OHNE VOLLSTÄNDIGEN BELEG ENTFÄLLT ─────────────────────────────────────────
 * Fehlt auch nur eine der drei Quellen, entsteht für diesen Abschnitt KEIN Eintrag. Der Rechenkern
 * findet dort keinen Abgabenzeitraum und verweigert den Hebel mit benanntem Zeitraum — statt den
 * Abschnitt still mit null Abgaben zu rechnen.
 *
 * @param fromDate ISO-Datum des Zeitraumbeginns (UTC-Sicht des Lastgangs).
 * @param toDate   ISO-Datum des Zeitraumendes (UTC-Sicht des Lastgangs).
 */
export function buildLevySchedule(
  operatorId: string,
  netzebene: number,
  fromDate: string,
  toDate: string,
): LevySchedule {
  /*
   * ⚠ Der Plan wird auf die BERÜHRTEN KALENDERJAHRE geweitet, nicht auf den übergebenen Zeitraum
   * beschnitten — aus zwei Gründen, die beide sonst eine stille Lücke erzeugen:
   *   (a) Der Rechenkern gruppiert nach LOKALER Wanduhr, das Analysefenster kommt in UTC. In
   *       Europe/Vienna liegt der letzte lokale Kalendertag regelmässig hinter dem UTC-Ende.
   *   (b) Die Jahres-Hochrechnung (D6) bewertet Tage AUSSERHALB des gemessenen Zeitraums mit
   *       demselben Plan; auf das Messfenster beschnitten fände sie dort keinen Satz.
   *
   * Geweitet wird nur der ABGEFRAGTE Bereich, nicht die Belegbarkeit: wo kein Satz hinterlegt ist,
   * entsteht weiterhin kein Zeitraum, und der Rechenkern verweigert.
   */
  const from = `${fromDate.slice(0, 4)}-01-01`
  const to = `${toDate.slice(0, 4)}-12-31`

  const sources = [
    ...ELEKTRIZITAETSABGABE,
    ...(EAG_BY_NETZEBENE[netzebene] ?? []),
    ...(GEBRAUCHSABGABE_BY_OPERATOR[operatorId] ?? []),
  ]

  const starts = new Set<string>([from])
  for (const entry of sources) {
    if (entry.validFrom > from && entry.validFrom <= to) starts.add(entry.validFrom)
    if (entry.validUntil != null) {
      const next = shiftDate(entry.validUntil, 1)
      if (next > from && next <= to) starts.add(next)
    }
  }

  const ordered = [...starts].sort()
  const periods: LevyPeriodInput[] = []
  for (let i = 0; i < ordered.length; i++) {
    const start = ordered[i]!
    const end = i + 1 < ordered.length ? shiftDate(ordered[i + 1]!, -1) : to

    const strom = pick(ELEKTRIZITAETSABGABE, start)
    const eag = pick(EAG_BY_NETZEBENE[netzebene] ?? [], start)
    const gebrauch = pick(GEBRAUCHSABGABE_BY_OPERATOR[operatorId] ?? [], start)
    if (!strom || !eag || !gebrauch) continue

    periods.push({
      validFrom: start,
      validUntil: end,
      elektrizitaetsabgabeCtPerKwh: strom.ctPerKwh,
      eagFoerderbeitragCtPerKwh: eag.foerderbeitragCtPerKwh,
      eagPauschaleEurPerYear: eag.pauschaleEurPerYear,
      gebrauchsabgabeRate: gebrauch.rate,
    })
  }

  return { periods }
}
