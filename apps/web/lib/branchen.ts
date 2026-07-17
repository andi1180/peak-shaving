/**
 * Die 5 Branchen als DATENQUELLE (Pflichtenheft §5.3).
 *
 * Exakt nach dem Muster von `lib/leistungen.ts` gebaut: Genau EIN Template
 * rendert alle 5 Unterseiten und die Übersicht (`components/branche/`). Hier
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

import { Factory, HardHat, Tractor, UtensilsCrossed, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BRANCHEN_FLAT, type NavLeaf } from './nav'
import { LEISTUNG_ICONS, resolveCrossLink, type CrossLink } from './leistungen'

/**
 * ICONS je Branche — schlichte, einfarbige lucide-Line-Icons, KEINE Emoji
 * (§7.3), gleiche Rolle und Platzierung wie `LEISTUNG_ICONS`.
 *
 * Bewusst die sachlichen Motive: `Wrench` (Werkzeug) statt `Hammer`, `Tractor`
 * statt `Sprout`. Die Leistungs-Icons sind funktional (Gauge, Coins,
 * ClipboardCheck) — ein verspieltes Motiv daneben wäre genau der Ton, den §7.3
 * abstellt.
 */
export const BRANCHE_ICONS: Record<string, LucideIcon> = {
  bau: HardHat,
  hotellerieGastronomie: UtensilsCrossed,
  handwerk: Wrench,
  industrie: Factory,
  landForstwirtschaft: Tractor,
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
 * Die FORM je Branche folgt dem Mechanismus, der die Spitze erzeugt (Hotel:
 * gleichzeitige Last aus Küche + HLK + Wäscherei; Gastro: Stoßzeiten; Handwerk:
 * gleichzeitiger Maschinenanlauf; Industrie: Schichtwechsel/Chargenprozesse;
 * Bau: unregelmäßige Großgeräte; Land/Forst: saisonal) und ist qualitativ —
 * nicht aus Messdaten abgeleitet und nicht als Benchmark verwendbar.
 *
 * Pflichtenheft §5.3 nennt als Beispiele noch Bäckerei und Handel. Beide sind
 * seit Prompt 25 keine eigenen Branchenseiten mehr (Bäckerei ist im Handwerk
 * aufgegangen, der Handel ersatzlos entfallen) — der dort beschriebene
 * MECHANISMUS gilt unverändert, nur nicht mehr unter diesen Überschriften.
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
   * Ein Profil ohne verlässlich wiederkehrende Spitze hat nichts, was sich
   * sinnvoll kappen ließe. Wo `capHint` fehlt, zeichnet das Diagramm KEINE
   * Schwelle — die Land- und Forstwirtschaft bekommt so auch grafisch kein
   * Peak-Shaving-Versprechen, das ihr Lastprofil nicht hergibt.
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
  // Ausrüstungsgetrieben und UNREGELMÄSSIG: Was gerade gebraucht wird, läuft —
  // Kompressor, Schweißgerät, Betonpumpe, Kran. Die Zacken sind kein Zufall der
  // Zeichnung, sondern die Aussage: Es gibt kein wiederkehrendes Tagesmuster,
  // nur mehrere Momente, in denen Großgeräte zusammenfallen. Bezogen auf einen
  // FESTEN Standort (Bauhof/Betriebsstandort), nicht auf eine Baustelle — s.
  // `CAP_HINT` und den Seitentext.
  bau: [
    20, 19, 19, 18, 18, 24, 56, 84, 100, 70, 88, 58, 44, 72, 94, 64, 56, 40, 30, 26, 24, 22, 21, 20,
  ],
  // Der Merge trägt BEIDE Geschichten in einer Kurve: die Gleichzeitigkeit des
  // Hotels (Frühstücksküche + HLK + erste Wäschecharge, morgens) UND die
  // Stoßzeiten der Gastronomie (Mittag, Abend). Deshalb DREI Erhebungen statt
  // einer — genau das unterscheidet dieses Profil von den anderen vier.
  hotellerieGastronomie: [
    34, 32, 30, 30, 32, 42, 72, 90, 84, 64, 56, 62, 86, 74, 52, 48, 52, 66, 88, 100, 92, 72, 50, 38,
  ],
  // Das klassische Einzel-Peak-Profil: ein einziger, kurzer, sehr hoher
  // Ausschlag beim gleichzeitigen Anlaufen mehrerer Maschinen über einem
  // NIEDRIGEN Sockel. Der stärkste Peak-Shaving-Fit der fünf — und der Grund,
  // warum die Kurve hier so eindeutig aussieht.
  handwerk: [
    22, 21, 21, 20, 20, 22, 30, 48, 100, 62, 54, 52, 50, 52, 56, 50, 42, 30, 25, 23, 22, 22, 22, 22,
  ],
  // Höhere Grundlast (Produktionslinien laufen auch nachts an) mit einem
  // breiten Tagesplateau, aus dem einzelne prozessgetriebene Spitzen
  // herausragen: Anlauf am Morgen, Schichtwechsel am Nachmittag. Gleicher
  // Mechanismus wie beim Handwerk, nur auf höherem Niveau und ohne den
  // niedrigen Sockel darunter.
  industrie: [
    48, 47, 46, 46, 47, 62, 92, 78, 76, 80, 78, 74, 86, 72, 74, 76, 100, 78, 72, 60, 52, 50, 49, 48,
  ],
  // WETTER- UND SAISONABHÄNGIG: Bewässerung, Trocknung, Erntekühlung laufen,
  // wenn die Saison es verlangt — nicht nach Uhrzeit. Die Kurve ist deshalb
  // bewusst sprunghaft und ohne wiedererkennbare Ordnung; sie zeigt EINEN Tag,
  // und der nächste sieht anders aus. Genau deshalb steht dieses Profil OHNE
  // `capHint` (s. u.) — aber aus einem anderen Grund als früher der Handel.
  landForstwirtschaft: [
    30, 28, 28, 27, 46, 68, 74, 52, 48, 86, 100, 78, 62, 58, 70, 92, 66, 44, 58, 40, 32, 30, 29, 29,
  ],
}

/**
 * Angedeutete Kappungsschwelle je Branche — bewusst NICHT für alle.
 *
 * Bau, Hotellerie & Gastronomie, Handwerk und Industrie haben ausgeprägte
 * Spitzen über einem niedrigeren Tagesniveau; dort ist die Schwelle die halbe
 * Erklärung. Die Höhe der Schwelle folgt der Deutlichkeit des Fits: Beim
 * Handwerk liegt sie am tiefsten (der Sockel ist niedrig, es gibt viel
 * abzuschneiden), beim Bau höher (die Zacken sind unregelmäßig, ein Teil davon
 * bleibt).
 *
 * LAND- UND FORSTWIRTSCHAFT FEHLT HIER ABSICHTLICH — und aus einem ANDEREN
 * Grund als früher der Handel: Nicht weil das Profil flach wäre (es ist im
 * Gegenteil sehr bewegt), sondern weil es SAISONAL und wetterabhängig ist. Eine
 * Schwelle, die an einem Tag im Juli passt, ist im Februar bedeutungslos. Eine
 * eingezeichnete Linie würde eine Wiederholbarkeit behaupten, die es nicht gibt
 * (§5.3, gleiche Vorsicht wie beim Kühlhaus, andere Begründung). Der Hebel steht
 * dort auf Energiemanagement, PV und Eigenverbrauch — das sagt der Text, und das
 * sagt auch das Bild.
 */
const CAP_HINT: Record<string, number> = {
  bau: 72,
  hotellerieGastronomie: 84,
  handwerk: 64,
  industrie: 82,
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
 *   Bau         → Finanzierung: investitionsintensiv, Förderung entscheidet mit.
 *   Hotel/Gastro→ ESG: Firmenkunden und Buchungsplattformen fragen danach.
 *   Handwerk    → Smart Heating: die Hallenheizung ist eine steuerbare Wärmelast
 *                 neben der Maschinenspitze.
 *   Industrie   → PPA: größere Mengen, standortübergreifende Beschaffung.
 *   Land/Forst  → Finanzierung: Agrarförderung ist hier ein eigener Hebel.
 *
 * Das FLAGGSCHIFF ist hier bewusst NICHT gelistet — es steht auf jeder
 * Branchenseite in einem eigenen, hervorgehobenen Block (s. `FLAGSHIP_LINKS`),
 * nicht als vierte Kachel zwischen den Leistungen. Gleiche Entscheidung wie in
 * der Leistungs-Übersicht (§4.2).
 */
const HEBEL: Record<string, string[]> = {
  bau: ['energiemanagement', 'pvSpeicher', 'finanzierung'],
  hotellerieGastronomie: ['energiemanagement', 'pvSpeicher', 'esg'],
  handwerk: ['energiemanagement', 'smartHeating', 'pvSpeicher'],
  industrie: ['energiemanagement', 'pvSpeicher', 'ppa'],
  landForstwirtschaft: ['energiemanagement', 'pvSpeicher', 'finanzierung'],
}

/**
 * Der hervorgehobene Verweis aufs Flaggschiff (§4.2/§6.4) — auf JEDER
 * Branchenseite dieselben zwei Ziele: die Methode (`/peak-shaving`) und das
 * Werkzeug (`/peak-shaving/kalkulator`). Zwei Intents, zwei Ziele (§6.2).
 *
 * Die Ziele kommen aus `lib/leistungen.ts` (CROSS_TARGETS) — nicht getippt.
 * Was sich je Branche unterscheidet, ist der ERKLÄRTEXT in den Messages
 * (`Branchen.Pages.<key>.hebel.flagshipText`): In der Land- und Forstwirtschaft
 * steht dort bewusst, dass Peak Shaving hier selten der erste Hebel ist.
 */
export const FLAGSHIP_LINKS: CrossLink[] = ['peakShaving', 'kalkulator'].map(resolveCrossLink)

/**
 * Ein Hebel trägt DAS Icon seiner Leistung — dieselbe Kachel zeigt auf
 * `/leistungen`, auf der Startseite und hier dasselbe Zeichen (§ gleiche
 * Begründung wie `LEISTUNG_ICONS` selbst: drei Kopien wären drei Gelegenheiten
 * zum Auseinanderlaufen).
 */
export type BrancheHebel = CrossLink & { icon: LucideIcon }

/**
 * Zwei Branchen mit einem KONKRETEN Verweis auf den Flaggschiff-Artikel
 * „Leistungstarif 2027" (SEO-Nacharbeit, Prompt 13c/§6.4).
 *
 * NUR Handwerk und Hotellerie & Gastronomie: Ihre Tageskurve (s. `HOURLY` oben)
 * ist eine kurze, unmittelbare Anlauf-/Stoßzeiten-Spitze über einer niedrigen
 * Grundlast — exakt der Mechanismus, den der Artikel durchrechnet („drei
 * Geräte, die gleichzeitig anlaufen"). Das Handwerk IST dieser Fall in
 * Reinform; die Gastronomie-Hälfte des Merges trägt ihn über die Stoßzeiten.
 *
 * NICHT dabei, jeweils mit Grund: Die Industrie kennt den Leistungspreis
 * bereits (der Artikel richtet sich ausdrücklich an die bisher NICHT gemessenen
 * KMU); der Bau hat kein wiederkehrendes Anlaufmuster, sondern unregelmäßige
 * Gerätespitzen; Land- und Forstwirtschaft steht bewusst ohne `capHint` und
 * damit außerhalb des Kernfalls. Ein erzwungener Verweis dort wäre
 * Vollständigkeit ohne inhaltlichen Bezug (dieselbe Zurückhaltung wie bei
 * `CAP_HINT`/`HEBEL` oben).
 *
 * BEWUSST EIN LITERALER SLUG, KEIN GENERISCHES ARTIKEL-VOKABULAR: Es gibt
 * genau einen Artikel. Ein `relatedArticles: string[]` mit eigener Auflösung
 * wäre Infrastruktur für n Artikel, gebaut für n=1 — Over-Engineering, das
 * erst beim zweiten Artikel gerechtfertigt wäre. Der Titel/Teaser der Karte
 * kommt zur Laufzeit aus `lib/wissen.ts` (`findArticle`) — nicht hier
 * zweitgetippt, sonst könnte die Karte vom echten Artikeltitel abweichen.
 */
const RELATED_ARTICLE_SLUG = 'leistungstarif-2027'
const ARTICLE_LINK_BRANCHEN = ['handwerk', 'hotellerieGastronomie']

export type Branche = {
  /** Schlüssel in `Nav`, `Pages` und `Branchen.Pages` der Message-Datei. */
  key: string
  href: string
  icon: LucideIcon
  profile: BrancheProfile
  /** Die passenden Leistungen. Das Flaggschiff steht separat (FLAGSHIP_LINKS). */
  hebel: BrancheHebel[]
  /** Slug des zugehörigen Wissen-Artikels, s. `ARTICLE_LINK_BRANCHEN` oben. */
  relatedArticleSlug?: string
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
 * Die 5 Branchen in Menü-Reihenfolge. Aus `BRANCHEN_FLAT` abgeleitet: Reihenfolge
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
    relatedArticleSlug: ARTICLE_LINK_BRANCHEN.includes(leaf.labelKey)
      ? RELATED_ARTICLE_SLUG
      : undefined,
  }
})

export function findBranche(key: string): Branche {
  const branche = BRANCHEN.find((b) => b.key === key)
  if (!branche) throw new Error(`Branche "${key}" fehlt in BRANCHEN (lib/nav.ts?)`)
  return branche
}
