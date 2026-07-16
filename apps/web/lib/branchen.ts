/**
 * Die 4 Start-Branchen als DATENQUELLE (Pflichtenheft §5.3).
 *
 * Exakt nach dem Muster von `lib/leistungen.ts` gebaut: Genau EIN Template
 * rendert alle 4 Unterseiten und die Übersicht (`components/branche/`). Hier
 * steht nur, was die Seiten voneinander unterscheidet und NICHT aus einem Text
 * besteht: Slug, Icon, die schematische Tageskurve und die Cross-Link-Ziele.
 * Alle sichtbaren Texte kommen über `messages/de.json` (§8.7 — keine Strings
 * hart im JSX); Reihenfolge/Slugs kommen aus `lib/nav.ts` (die IA hat genau
 * einen Fundort, §4.1).
 *
 * Eine neue Branche ist damit: ein Eintrag in `lib/nav.ts` + ein Icon/Profil/
 * Cross-Link hier + ein Message-Block. Keine neue Seiten-Datei mit kopiertem
 * Layout.
 *
 * §5.3 mahnt ausdrücklich „wenige starke statt vieler dünner Seiten" — die
 * Leichtigkeit, mit der hier eine fünfte Branche entsteht, ist kein Auftrag,
 * es auch zu tun.
 */

import { Hotel, Store, UtensilsCrossed, Wheat } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BRANCHEN_FLAT, type NavLeaf } from './nav'
import { LEISTUNG_ICONS, resolveCrossLink, type CrossLink } from './leistungen'

/**
 * ICONS je Branche — schlichte, einfarbige lucide-Line-Icons, KEINE Emoji
 * (§7.3), gleiche Rolle und Platzierung wie `LEISTUNG_ICONS`.
 *
 * Bewusst die sachlichen Motive: `Wheat` (Ähre) statt `Croissant`, `Store`
 * statt `ShoppingCart`. Die Leistungs-Icons sind funktional (Gauge, Coins,
 * ClipboardCheck) — ein Croissant neben einem Manometer wäre genau der
 * verspielte Ton, den §7.3 abstellt.
 */
export const BRANCHE_ICONS: Record<string, LucideIcon> = {
  hotellerie: Hotel,
  gastronomie: UtensilsCrossed,
  baeckerei: Wheat,
  handel: Store,
}

/**
 * SCHEMATISCHER TAGESLASTVERLAUF (§5.3 Nr. 2).
 *
 * §9.5 — KEINE ERFUNDENEN ZAHLEN: Diese Kurven sind SCHEMATISCH und tragen
 * bewusst KEINE Einheit. Die Werte sind RELATIV zur jeweils eigenen Tagesspitze
 * (100 = Spitze desselben Tages) — sie sagen nur etwas über die FORM des Tages
 * aus, nie über kW, kWh oder Euro. Deshalb rendert das Diagramm auch keine
 * Y-Achse und keinen Tooltip: Es gibt keinen Wert zum Ablesen, und ein
 * ablesbarer Wert wäre eine Messung, die es nicht gibt. Die Kennzeichnung steht
 * sichtbar am Diagramm (Titel „(schematisch)" + Caption „Illustratives Schema,
 * keine Messdaten."), nicht nur hier im Code.
 *
 * Die FORM je Branche folgt Pflichtenheft §5.3 („Hotel: gleichzeitige Last aus
 * Küche + HLK + Wäscherei; Bäckerei: Ofen-Spitzen früh; Gastro: Stoßzeiten;
 * Handel: Kälte/Beleuchtung/Klima") und ist qualitativ — nicht aus Messdaten
 * abgeleitet und nicht als Benchmark verwendbar.
 *
 * BEWUSST NICHT über `packages/engine` gerechnet — gleiche Begründung wie bei
 * `components/peak-shaving/load-curve-chart.tsx`: Das ist eine Zeichnung, kein
 * Rechenergebnis. Die Engine gehört dem Pro-Kalkulator (§5.4).
 */
export type LoadPoint = { hour: number; relativeLoad: number }

export type BrancheProfile = {
  points: LoadPoint[]
  /** Stunde des Tagesmaximums — trägt den Spitzen-Marker im Diagramm. */
  peakHour: number
  /** Wert an `peakHour`. Per Vertrag 100 (s. `toProfile`) — der Marker soll sich
   *  trotzdem aus den Daten setzen und nicht aus einer Konstante im Chart. */
  peakLoad: number
  /**
   * Höhe einer angedeuteten Kappungsschwelle (relativ, wie `relativeLoad`).
   *
   * OPTIONAL, und das ist der fachliche Kern (§5.3 „Kühlhaus mit Vorsicht"):
   * Ein Profil ohne ausgeprägte Spitze hat nichts, was sich sinnvoll kappen
   * ließe. Wo `capHint` fehlt, zeichnet das Diagramm KEINE Schwelle — der
   * Handel bekommt so auch grafisch kein Peak-Shaving-Versprechen, das sein
   * Lastprofil nicht hergibt.
   */
  capHint?: number
}

/**
 * Die Tageskurven, je 24 Stundenwerte (Index = Stunde).
 *
 * 24 Stützstellen und `stepAfter` im Chart: grob genug, dass niemand sie für
 * einen gemessenen Viertelstunden-Lastgang hält, fein genug, dass die Form
 * stimmt. Der echte Lastgang mit 96 Slots steht auf `/peak-shaving` — dort ist
 * er die Aussage, hier ist er der Kontext.
 */
const HOURLY: Record<string, number[]> = {
  // Gleichzeitigkeit: Morgenspitze (Frühstücksküche + Duschen + erste
  // Wäschecharge + HLK), zweite Erhebung am Abend (Küche + Wellness + belegte
  // Zimmer). Dazwischen fällt der Betrieb deutlich ab.
  hotellerie: [
    34, 32, 31, 31, 33, 42, 74, 92, 100, 78, 58, 56, 64, 62, 52, 48, 50, 62, 80, 86, 78, 62, 48, 38,
  ],
  // Zwei Stoßzeiten, Abend stärker als Mittag. Die Kälte läuft als Grundlast
  // durch und kommt nie auf null.
  gastronomie: [
    28, 26, 25, 25, 25, 26, 28, 32, 40, 50, 62, 80, 88, 76, 52, 42, 46, 60, 84, 100, 94, 70, 46, 34,
  ],
  // Das klassische Einzel-Peak-Profil: eine einzige, sehr frühe Ofen-Anfahrspitze
  // über einer durchlaufenden Kälte-/Froster-Grundlast. Der stärkste
  // Peak-Shaving-Fit der vier — und der Grund, warum die Kurve hier so
  // eindeutig aussieht.
  baeckerei: [
    30, 32, 72, 100, 88, 66, 58, 54, 50, 46, 42, 42, 44, 42, 38, 36, 36, 34, 32, 31, 30, 30, 29, 29,
  ],
  // Quasi-Dauerlast: hohe Kälte-Grundlast rund um die Uhr, breites Plateau
  // während der Öffnungszeit (Beleuchtung + Klima), kein einzelner teurer
  // Moment. Deshalb steht dieses Profil OHNE `capHint` (s. u.).
  handel: [
    54, 52, 51, 50, 50, 52, 60, 78, 90, 94, 95, 96, 97, 98, 100, 99, 96, 95, 94, 90, 76, 62, 57, 55,
  ],
}

/**
 * Angedeutete Kappungsschwelle je Branche — bewusst NICHT für alle.
 *
 * Hotellerie/Gastronomie/Bäckerei haben ausgeprägte Spitzen über einem
 * niedrigeren Tagesniveau; dort ist die Schwelle die halbe Erklärung.
 * DER HANDEL FEHLT HIER ABSICHTLICH: Sein Profil ist ein breites Plateau —
 * eine eingezeichnete Schwelle würde suggerieren, es gäbe eine Spitze zum
 * Abschneiden, und genau diese Zusage gibt der Handel nicht her (§5.3, gleiche
 * Vorsicht wie beim Kühlhaus). Der Hebel steht dort auf Energiemanagement, PV
 * und Eigenverbrauch — das sagt der Text, und das sagt jetzt auch das Bild.
 */
const CAP_HINT: Record<string, number> = {
  hotellerie: 84,
  gastronomie: 82,
  baeckerei: 62,
}

/**
 * Passende Hebel je Branche — Referenzen auf bestehende Leistungs-Slugs
 * (§5.3 Nr. 3). Inhaltlich gewählt, nicht „alle mit allen": dieselbe Logik wie
 * `CROSS_LINKS` in `lib/leistungen.ts` — eine Liste, die jede Seite auf jede
 * andere zeigt, trägt keine Information mehr.
 *
 * Energiemanagement und PV/Speicher stehen überall, weil sie überall zuerst
 * greifen (der Lastgang ist die Datengrundlage, der Speicher der Hebel). Der
 * dritte Eintrag ist je Branche der, der wirklich unterscheidet:
 *   Hotellerie  → ESG: Firmenkunden und Buchungsplattformen fragen danach.
 *   Gastronomie → Finanzierung: kleinere Betriebe, die Förderung entscheidet mit.
 *   Bäckerei    → Smart Heating: eine steuerbare Wärmelast neben der Ofenspitze.
 *   Handel      → PPA: Filialketten beschaffen standortübergreifend.
 *
 * Das FLAGGSCHIFF ist hier bewusst NICHT gelistet — es steht auf jeder
 * Branchenseite in einem eigenen, hervorgehobenen Block (s. `FLAGSHIP_LINKS`),
 * nicht als vierte Kachel zwischen den Leistungen. Gleiche Entscheidung wie in
 * der Leistungs-Übersicht (§4.2).
 */
const HEBEL: Record<string, string[]> = {
  hotellerie: ['energiemanagement', 'pvSpeicher', 'esg'],
  gastronomie: ['energiemanagement', 'pvSpeicher', 'finanzierung'],
  baeckerei: ['energiemanagement', 'smartHeating', 'pvSpeicher'],
  handel: ['energiemanagement', 'pvSpeicher', 'ppa'],
}

/**
 * Der hervorgehobene Verweis aufs Flaggschiff (§4.2/§6.4) — auf JEDER
 * Branchenseite dieselben zwei Ziele: die Methode (`/peak-shaving`) und das
 * Werkzeug (`/peak-shaving/kalkulator`). Zwei Intents, zwei Ziele (§6.2).
 *
 * Die Ziele kommen aus `lib/leistungen.ts` (CROSS_TARGETS) — nicht getippt.
 * Was sich je Branche unterscheidet, ist der ERKLÄRTEXT in den Messages
 * (`Branchen.Pages.<key>.hebel.flagshipText`): Im Handel steht dort bewusst,
 * dass Peak Shaving hier selten der erste Hebel ist.
 */
export const FLAGSHIP_LINKS: CrossLink[] = ['peakShaving', 'kalkulator'].map(resolveCrossLink)

/**
 * Ein Hebel trägt DAS Icon seiner Leistung — dieselbe Kachel zeigt auf
 * `/leistungen`, auf der Startseite und hier dasselbe Zeichen (§ gleiche
 * Begründung wie `LEISTUNG_ICONS` selbst: drei Kopien wären drei Gelegenheiten
 * zum Auseinanderlaufen).
 */
export type BrancheHebel = CrossLink & { icon: LucideIcon }

export type Branche = {
  /** Schlüssel in `Nav`, `Pages` und `Branchen.Pages` der Message-Datei. */
  key: string
  href: string
  icon: LucideIcon
  profile: BrancheProfile
  /** Die passenden Leistungen. Das Flaggschiff steht separat (FLAGSHIP_LINKS). */
  hebel: BrancheHebel[]
}

/**
 * `peakHour` wird ABGELEITET, nicht danebengeschrieben: Eine zweite, von Hand
 * gepflegte Stundenangabe neben der Kurve wäre eine Stelle, an der der Marker
 * still auf die falsche Stunde zeigt, sobald jemand einen Wert ändert.
 *
 * Der Check auf das Maximum 100 hält zugleich den Vertrag der Datenquelle ein:
 * Die Werte sind relativ ZUR EIGENEN TAGESSPITZE. Ohne ihn könnten zwei Kurven
 * unbemerkt auf verschiedenen Maßstäben liegen — und weil es keine Y-Achse
 * gibt, würde das niemand sehen. Ein Vergleich der Branchen untereinander ist
 * damit ausdrücklich NICHT gemeint und wäre auch nicht belegbar.
 */
function toProfile(key: string): BrancheProfile {
  const hourly = HOURLY[key]
  if (!hourly) throw new Error(`Branche "${key}" hat kein Lastprofil in HOURLY`)
  if (hourly.length !== 24) {
    throw new Error(`Lastprofil "${key}" hat ${hourly.length} statt 24 Stundenwerte`)
  }

  const peakLoad = Math.max(...hourly)
  if (peakLoad !== 100) {
    throw new Error(
      `Lastprofil "${key}" hat sein Maximum bei ${peakLoad} statt 100 — die Werte sind relativ zur eigenen Tagesspitze`,
    )
  }

  return {
    points: hourly.map((relativeLoad, hour) => ({ hour, relativeLoad })),
    peakHour: hourly.indexOf(peakLoad),
    peakLoad,
    capHint: CAP_HINT[key],
  }
}

/**
 * Die 4 Branchen in Menü-Reihenfolge. Aus `BRANCHEN_FLAT` abgeleitet: Reihenfolge
 * und Slugs der Übersicht folgen so automatisch dem Menü — eine zweite,
 * handgepflegte Liste würde davon abdriften (gleiche Mechanik wie `LEISTUNGEN`).
 */
export const BRANCHEN: Branche[] = BRANCHEN_FLAT.map((leaf: NavLeaf) => {
  const icon = BRANCHE_ICONS[leaf.labelKey]
  if (!icon) throw new Error(`Branche "${leaf.labelKey}" hat kein Icon in BRANCHE_ICONS`)
  return {
    key: leaf.labelKey,
    href: leaf.href,
    icon,
    profile: toProfile(leaf.labelKey),
    // Der Icon-Lookup ist zugleich der Vertrag: Ein Hebel MUSS eine Leistung
    // sein. Stünde hier je „peakShaving", fiele es hier auf — statt still als
    // Kachel ohne Zeichen zwischen den Leistungen zu landen, wo §4.2 es
    // ausdrücklich nicht haben will.
    hebel: (HEBEL[leaf.labelKey] ?? []).map((key) => {
      const icon = LEISTUNG_ICONS[key]
      if (!icon) {
        throw new Error(
          `Hebel "${key}" der Branche "${leaf.labelKey}" ist keine Leistung mit Icon (LEISTUNG_ICONS)`,
        )
      }
      return { ...resolveCrossLink(key), icon }
    }),
  }
})

export function findBranche(key: string): Branche {
  const branche = BRANCHEN.find((b) => b.key === key)
  if (!branche) throw new Error(`Branche "${key}" fehlt in BRANCHEN (lib/nav.ts?)`)
  return branche
}
