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
  /**
   * EAG-Förderbeitrag, verbrauchsabhängiger Teil in ct/kWh netto — netzebenen- UND
   * messvariantenabhängig. Es ist die SUMME aus „Netznutzung Verbrauchspreis" und
   * „Netzverlustentgelt" des Preisblatts: beide hängen an der bezogenen Kilowattstunde und an
   * derselben Bemessungsgrundlage, und der Rechenkern hat für sie eine Multiplikation. Getrennt
   * geführt wären es zwei Felder mit identischer Behandlung; die Einzelwerte stehen in `sourceNote`.
   */
  eagFoerderbeitragCtPerKwh: number
  /**
   * EAG-Förderbeitrag, GRUNDPREIS-Teil — der dritte Bestandteil des Preisblatts (EX104).
   *
   * ⚠ Die Einheit gehört zwingend dazu und ist deshalb ein eigenes Feld, genau wie bei
   * `GridTariffRowInput.grundpreisUnit`: auf Netzebene 3–6 und auf NE 7 MIT Leistungsmessung ist
   * der Satz ein LEISTUNGSpreis (€ je kW und Jahr), auf NE 7 OHNE Leistungsmessung ein fixer
   * Jahresbetrag je Zählpunkt. Die beiden unterscheiden sich um den Faktor der Anschlussleistung —
   * eine geratene Deutung wäre hier besonders teuer.
   */
  eagFoerderbeitragGrundpreisAmount: number
  eagFoerderbeitragGrundpreisUnit: 'eur_per_kw_year' | 'eur_per_year'
  /**
   * Erneuerbaren-FÖRDERPAUSCHALE, €/Jahr netto je Zählpunkt — verbrauchsunabhängig, tagesanteilig.
   *
   * ⚠ NICHT dasselbe wie der Grundpreis des Förderbeitrags oben, auch wenn beide ein Jahresbetrag
   * sein können: die Pauschale steht im EAG 2021 und wird von der Förderpauschale-Verordnung für
   * mehrere Jahre im Voraus festgesetzt, der Förderbeitrag jährlich neu. Sie werden getrennt
   * geführt, weil sie getrennt gelten — und weil genau diese Verwechslung der Fehler war, den
   * dieser Nachtrag behebt.
   */
  eagPauschaleEurPerYear: number
  /**
   * Gebrauchsabgabe als ANTEIL (0,07 = 7 %) auf die Netto-Einnahmen von Netzbetreiber UND
   * Lieferant: Netznutzung, Netzverlust, Netz-Grundpreis, Messpreis, Energie-Arbeitspreis und
   * Lieferanten-Grundgebühr (Wiener GAG Tarif C Post 1 und 1a). Nicht auf Elektrizitätsabgabe oder
   * die EAG-Beiträge (§ 10 Abs. 1 lit. b). Bis 24.09.2026 stand hier „nur Netzpreis“.
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
      eagFoerderbeitragGrundpreisAmount: 0,
      eagFoerderbeitragGrundpreisUnit: 'eur_per_year',
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
 * Die Kundenkategorie, an der ein Abgabensatz hängen kann — dieselben zwei Werte wie die
 * Katalog-Kategorie (`BatteryCatalogCategory`), damit beide Pfade sie ohne Umrechnung durchreichen.
 */
export type LevyCustomerCategory = 'heim' | 'gewerbe'

/** Was ausser Netzbetreiber, Netzebene und Zeitraum über die Sätze entscheidet. */
export type LevyContext = {
  /** Entscheidet über die Elektrizitätsabgabe 2026 (ElAbgG § 7 Abs. 16). */
  category: LevyCustomerCategory
}

/**
 * Elektrizitätsabgabe — bundesweit, unabhängig von Netzbetreiber und Netzebene, aber seit 2026
 * abhängig von der Kundenkategorie.
 *
 * ⚠ 2026 gibt es ZWEI Sätze (ElAbgG § 7 Abs. 16, eingefügt durch BGBl. I Nr. 95/2025): Z 1
 * 0,1 ct/kWh für natürliche Personen, die § 4 Abs. 1 Stromkostenzuschussgesetz erfüllen
 * (Haushalts-Standardlastprofil H0/HA/HF), Z 2 0,82 ct/kWh für alle sonstigen Lieferungen.
 * `heim` steht für Z 1, `gewerbe` für Z 2. Bis 24.09.2026 stand hier 0,1 ct für JEDEN Kunden.
 *
 * ⚠ Ab 2027 steht hier nichts: die Befristung endet „vor dem 1. Jänner 2027“, der Satz danach ist
 * Phase 2b (`Abgaben_Bestandsaufnahme_NOE_SBG_2027.md`).
 */
const ELEKTRIZITAETSABGABE: (DatedEntry & { ctPerKwh: Record<LevyCustomerCategory, number> })[] = [
  {
    validFrom: '2025-01-01',
    validUntil: '2025-12-31',
    ctPerKwh: { heim: 1.5, gewerbe: 1.5 },
    sourceNote:
      'Elektrizitätsabgabe 1,50 ct/kWh netto für das Kalenderjahr 2025 ' +
      '(Elektrizitätsabgabegesetz § 4 Abs. 2, „0,015 Euro je kWh"; die Absenkung nach § 7 Abs. 11 ' +
      'galt nur „vor dem 1. Jänner 2025"). Gegenprobe: Wiener Netze, wn-ex0106. Im Repo ' +
      'festgehalten am 22.09.2026.',
  },
  {
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    ctPerKwh: { heim: 0.1, gewerbe: 0.82 },
    sourceNote:
      'Elektrizitätsabgabe 2026, ElAbgG § 7 Abs. 16 (BGBl. I Nr. 95/2025): Z 1 0,001 €/kWh für ' +
      'natürliche Personen nach § 4 Abs. 1 SKZG (Haushaltsprofil), Z 2 0,0082 €/kWh für sonstige ' +
      'Lieferungen. Gegenprobe: Netz NÖ Preisblatt B410 (Ausgabe 01.01.2026) „Alle Ebenen 0,82 / ' +
      'Für Haushaltskunden 0,1". Abgerufen 24.09.2026.',
  },
]

/**
 * Fundstelle beider EAG-Tabellen — EIN Ort, weil es EIN Preisblatt ist.
 *
 * ⚠ Bis zum 21.09.2026 stand hier für Netzebene 7 ein Satzpaar OHNE Fundstelle
 * (0,620 ct/kWh + 3,80 €/Jahr). Nachgemessen am Preisblatt war der ct/kWh-Wert richtig
 * (0,583 + 0,037, Variante „ohne Leistungsmessung"), der Jahresbetrag aber der GRUNDPREIS des
 * Förderbeitrags (3,796 €/Zählpunkt·Jahr) — und die eigentliche Förderpauschale von 19,02 €/Jahr
 * fehlte damit vollständig. Deshalb trägt hier ab jetzt jeder Satz seine Herkunft.
 */
const EAG_SOURCE_DOC =
  'Quelle: Wiener Netze, Preisblatt EX104 „Erneuerbaren-Förderpauschale und ' +
  'Erneuerbaren-Förderbeitrag", Vers. 1/2026. Im Repo festgehalten am 21.09.2026.'

const EAG_PAUSCHALE_SOURCE =
  'Erneuerbaren-Förderpauschale je Zählpunkt und Kalenderjahr, netto, festgesetzt für die ' +
  'Kalenderjahre 2025 bis 2027 (Erneuerbaren-Ausbau-Gesetz 2021 i. V. m. ' +
  `Erneuerbaren-Förderpauschale-Verordnung 2025). ${EAG_SOURCE_DOC}`

/**
 * Der Schlüssel, unter dem ein EAG-Förderbeitrag steht.
 *
 * ⚠ Die MESSVARIANTE gehört dazu, nicht nur die Netzebene. EX104 führt für Netzebene 7 drei
 * verschiedene Zeilen (mit Leistungsmessung / ohne / unterbrechbare Nutzung), und sie
 * unterscheiden sich um mehr als ein Drittel im Verbrauchspreis. Auf den Netzebenen 3–6 gibt es
 * die Unterscheidung nicht — dort steht `null`, wie in `grid_tariffs.metering_variant` und aus
 * demselben Grund.
 */
function eagKey(netzebene: number, meteringVariant: string | null): string {
  return `${netzebene}:${meteringVariant ?? '-'}`
}

/**
 * Erneuerbaren-FÖRDERPAUSCHALE je Netzebene, € pro Kalenderjahr und Zählpunkt.
 *
 * Sie hängt NICHT an der Messvariante (EX104 führt sie je Netzebene, einwertig) und gilt
 * ausdrücklich für die Kalenderjahre 2025 bis 2027 — die Erneuerbaren-Förderpauschale-Verordnung
 * 2025 setzt sie für drei Jahre im Voraus fest, anders als den jährlich neu festgesetzten
 * Förderbeitrag. Deshalb eine eigene Tabelle mit eigener Datierung statt eines Felds neben ihm.
 *
 * ⚠ Die Beträge der oberen Netzebenen sind KEIN Tippfehler: NE 3/4 stehen bei 60.524,03 € im Jahr.
 * Es sind Industrieanschlüsse, und die Pauschale ist dort nach Anschlussgrösse gestaffelt.
 */
const EAG_PAUSCHALE_BY_NETZEBENE: Record<number, (DatedEntry & { eurPerYear: number })[]> = {
  3: [{ validFrom: '2025-01-01', validUntil: '2027-12-31', eurPerYear: 60524.03, sourceNote: EAG_PAUSCHALE_SOURCE }],
  4: [{ validFrom: '2025-01-01', validUntil: '2027-12-31', eurPerYear: 60524.03, sourceNote: EAG_PAUSCHALE_SOURCE }],
  5: [{ validFrom: '2025-01-01', validUntil: '2027-12-31', eurPerYear: 8992.14, sourceNote: EAG_PAUSCHALE_SOURCE }],
  6: [{ validFrom: '2025-01-01', validUntil: '2027-12-31', eurPerYear: 553.36, sourceNote: EAG_PAUSCHALE_SOURCE }],
  7: [{ validFrom: '2025-01-01', validUntil: '2027-12-31', eurPerYear: 19.02, sourceNote: EAG_PAUSCHALE_SOURCE }],
}

/**
 * Erneuerbaren-FÖRDERBEITRAG je (Netzebene, Messvariante) und Tarifjahr.
 *
 * Drei Bestandteile je Zeile, so wie das Preisblatt sie führt: „Netznutzung Grundpreis"
 * (€/kW·Jahr, auf NE 7 ohne Leistungsmessung €/Zählpunkt·Jahr), „Netznutzung Verbrauchspreis"
 * (ct/kWh) und „Netzverlustentgelt" (ct/kWh). Die beiden ct/kWh-Teile werden beim Zusammensetzen
 * addiert (s. `eagFoerderbeitragCtPerKwh`); der Grundpreis reist mit seiner Einheit weiter.
 *
 * Die Höhe wird jährlich neu festgesetzt — jeder Eintrag ist deshalb auf SEIN Kalenderjahr
 * befristet, und für 2027 steht hier nichts. Ein fortgeschriebener Satz sähe aus wie eine Angabe.
 */
type FoerderbeitragEntry = DatedEntry & {
  grundpreisAmount: number
  grundpreisUnit: 'eur_per_kw_year' | 'eur_per_year'
  verbrauchspreisCtPerKwh: number
  netzverlustCtPerKwh: number
}

function foerderbeitrag(
  year: number,
  grundpreisAmount: number,
  grundpreisUnit: 'eur_per_kw_year' | 'eur_per_year',
  verbrauchspreisCtPerKwh: number,
  netzverlustCtPerKwh: number,
  label: string,
): FoerderbeitragEntry {
  return {
    validFrom: `${year}-01-01`,
    validUntil: `${year}-12-31`,
    grundpreisAmount,
    grundpreisUnit,
    verbrauchspreisCtPerKwh,
    netzverlustCtPerKwh,
    sourceNote:
      `Erneuerbaren-Förderbeitrag ${label}, Tarifjahr ${year}: Grundpreis ${grundpreisAmount} ` +
      `${grundpreisUnit === 'eur_per_kw_year' ? '€/kW·Jahr' : '€/Zählpunkt·Jahr'}, ` +
      `Verbrauchspreis ${verbrauchspreisCtPerKwh} ct/kWh, Netzverlustentgelt ` +
      `${netzverlustCtPerKwh} ct/kWh, jeweils netto. ${EAG_SOURCE_DOC}`,
  }
}

const EAG_FOERDERBEITRAG: Record<string, FoerderbeitragEntry[]> = {
  [eagKey(3, null)]: [
    foerderbeitrag(2025, 5.774, 'eur_per_kw_year', 0.114, 0.02, 'Netzebene 3'),
    foerderbeitrag(2026, 3.87, 'eur_per_kw_year', 0.073, 0.01, 'Netzebene 3'),
  ],
  [eagKey(4, null)]: [
    foerderbeitrag(2025, 7.54, 'eur_per_kw_year', 0.15, 0.02, 'Netzebene 4'),
    foerderbeitrag(2026, 5.564, 'eur_per_kw_year', 0.108, 0.011, 'Netzebene 4'),
  ],
  [eagKey(5, null)]: [
    foerderbeitrag(2025, 6.796, 'eur_per_kw_year', 0.179, 0.02, 'Netzebene 5'),
    foerderbeitrag(2026, 4.918, 'eur_per_kw_year', 0.127, 0.013, 'Netzebene 5'),
  ],
  [eagKey(6, null)]: [
    foerderbeitrag(2025, 7.358, 'eur_per_kw_year', 0.271, 0.018, 'Netzebene 6'),
    foerderbeitrag(2026, 5.252, 'eur_per_kw_year', 0.198, 0.011, 'Netzebene 6'),
  ],
  [eagKey(7, 'mit_leistungsmessung')]: [
    foerderbeitrag(2025, 7.102, 'eur_per_kw_year', 0.457, 0.059, 'Netzebene 7 mit Leistungsmessung'),
    foerderbeitrag(2026, 5.619, 'eur_per_kw_year', 0.364, 0.037, 'Netzebene 7 mit Leistungsmessung'),
  ],
  [eagKey(7, 'ohne_leistungsmessung')]: [
    foerderbeitrag(2025, 4.695, 'eur_per_year', 0.737, 0.059, 'Netzebene 7 ohne Leistungsmessung'),
    foerderbeitrag(2026, 3.796, 'eur_per_year', 0.583, 0.037, 'Netzebene 7 ohne Leistungsmessung'),
  ],
  [eagKey(7, 'unterbrechbar')]: [
    foerderbeitrag(2025, 0, 'eur_per_kw_year', 0.435, 0.059, 'Netzebene 7 unterbrechbare Nutzung'),
    foerderbeitrag(2026, 0, 'eur_per_kw_year', 0.347, 0.037, 'Netzebene 7 unterbrechbare Nutzung'),
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
      validFrom: '2025-01-01',
      validUntil: '2025-12-31',
      rate: 0.06,
      sourceNote:
        'Gebrauchsabgabe Wien 6 % im Kalenderjahr 2025 (Wiener Gebrauchsabgabegesetz 1966 Tarif C ' +
        'Post 1 und 1a — Netz und Energie). Netzseite: Wiener Netze wn-ex0106 „6 % vom ' +
        'Netto-Netzpreis"; Energieseite bestätigt die Urbanz-Rechnung 2024/25. Stand 24.09.2026.',
    },
    {
      validFrom: '2026-01-01',
      validUntil: '2026-02-28',
      rate: 0.06,
      sourceNote:
        'Gebrauchsabgabe Wien 6 % bis 28.02.2026: Wiener Gebrauchsabgabegesetz 1966 Tarif C Post 1 ' +
        'und 1a, RIS-Fassung vom 28.02.2026 („6 vH"). Bemessung: Netz- und Energieentgelte. ' +
        'Abgerufen 24.09.2026.',
    },
    {
      validFrom: '2026-03-01',
      validUntil: null,
      rate: 0.07,
      sourceNote:
        'Gebrauchsabgabe Wien 7 % ab 01.03.2026: Wiener Gebrauchsabgabegesetz 1966 Tarif C Post 1 ' +
        '(Netzbetreiber) und Post 1a (Lieferant), je „7 vH der Einnahmen", Novelle LGBl. für Wien ' +
        'Nr. 3/2026, Inkrafttreten § 18 Abs. 18 Z 1. Bemessung: Netz- UND Energieentgelte samt ' +
        'Grundgebühren, ohne Elektrizitätsabgabe/EAG (§ 10 Abs. 1 lit. b). Abgerufen 24.09.2026.',
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
 * Gesammelt werden ALLE Gültigkeitsgrenzen aller vier Quellen im Zeitraum; zwischen zwei Grenzen
 * entsteht je ein Zeitabschnitt. Nur am Zeitraumbeginn nachzusehen träfe den Sprung 6 % → 7 %
 * nicht — dieselbe Falle wie beim Netzentgelt-Backfill, der `min(valid_from)` über ALLE Zeilen
 * bildet statt nur die offene zu prüfen.
 *
 * ── ⚠ EIN ABSCHNITT OHNE VOLLSTÄNDIGEN BELEG ENTFÄLLT ─────────────────────────────────────────
 * Fehlt auch nur eine der vier Quellen, entsteht für diesen Abschnitt KEIN Eintrag. Der Rechenkern
 * findet dort keinen Abgabenzeitraum und verweigert den Hebel mit benanntem Zeitraum — statt den
 * Abschnitt still mit null Abgaben zu rechnen.
 *
 * @param fromDate ISO-Datum des Zeitraumbeginns (UTC-Sicht des Lastgangs).
 * @param toDate   ISO-Datum des Zeitraumendes (UTC-Sicht des Lastgangs).
 * @param meteringVariant Messvariante der Netzebene (`grid_tariffs.metering_variant`), sonst
 *                 `null`. Auf NE 7 entscheidet sie über den Förderbeitrag; auf NE 3–6 gibt es
 *                 keine Variante und der Schlüssel trägt `null`.
 * @param context  Kundenkategorie — Pflicht, damit kein Aufrufer den Satz still erbt.
 */
export function buildLevySchedule(
  operatorId: string,
  netzebene: number,
  fromDate: string,
  toDate: string,
  meteringVariant: string | null,
  context: LevyContext,
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

  const foerderbeitraege = EAG_FOERDERBEITRAG[eagKey(netzebene, meteringVariant)] ?? []
  const pauschalen = EAG_PAUSCHALE_BY_NETZEBENE[netzebene] ?? []

  const sources = [
    ...ELEKTRIZITAETSABGABE,
    ...foerderbeitraege,
    ...pauschalen,
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
    const beitrag = pick(foerderbeitraege, start)
    const pauschale = pick(pauschalen, start)
    const gebrauch = pick(GEBRAUCHSABGABE_BY_OPERATOR[operatorId] ?? [], start)
    if (!strom || !beitrag || !pauschale || !gebrauch) continue

    periods.push({
      validFrom: start,
      validUntil: end,
      elektrizitaetsabgabeCtPerKwh: strom.ctPerKwh[context.category],
      // Verbrauchspreis + Netzverlustentgelt: beide ct/kWh auf dieselbe Bemessungsgrundlage.
      eagFoerderbeitragCtPerKwh: beitrag.verbrauchspreisCtPerKwh + beitrag.netzverlustCtPerKwh,
      eagFoerderbeitragGrundpreisAmount: beitrag.grundpreisAmount,
      eagFoerderbeitragGrundpreisUnit: beitrag.grundpreisUnit,
      eagPauschaleEurPerYear: pauschale.eurPerYear,
      gebrauchsabgabeRate: gebrauch.rate,
    })
  }

  return { periods }
}
