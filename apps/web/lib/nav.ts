/**
 * Die Informationsarchitektur an EINER Stelle (Pflichtenheft §4.1/§4.3).
 * Header, Mobile-Menü und Footer lesen alle von hier — eine neue Seite wird
 * einmal eingetragen und erscheint überall konsistent.
 *
 * Hier stehen nur Struktur + Slugs. Die sichtbaren Texte kommen über `labelKey`
 * aus `messages/de.json` (§8.7: keine Strings hart im JSX).
 */

export type NavLeaf = {
  /** Schlüssel in der `Nav`-Namespace der Message-Datei. */
  labelKey: string
  href: string
}

export type NavGroup = {
  /** Gruppen-Überschrift im Mega-Menü. */
  labelKey: string
  items: NavLeaf[]
}

export type NavItem = {
  labelKey: string
  href: string
  /** Gruppiertes Mega-Menü (Leistungen) … */
  groups?: NavGroup[]
  /** … oder eine flache Liste (Peak Shaving, Branchen). */
  items?: NavLeaf[]
  /** „Alle …"-Eintrag, der auf die Übersichtsseite führt. */
  overviewKey?: string
  /**
   * Abschluss-Einträge, die als LETZTE Punkte des Menüs erscheinen (Header-Mega-Menü +
   * Mobile-Accordion), aber bewusst NICHT in die Gruppen/`*_FLAT`-Listen (und damit nicht in den
   * Footer) fließen.
   *
   * WARUM NICHT IN EINE GRUPPE: Alles, was in `LEISTUNGEN_FLAT` landet, wird von
   * `lib/leistungen.ts` zu einer LEISTUNG erklärt — mit Icon, Übersichtskachel, Cross-Link-Tabelle
   * und einem eigenen `Leistungen.Pages.<key>`-Textblock. Der Strom-Monitor (B4-1-Vorgeschichte)
   * und die Vertragsablauf-Erinnerung (B4-2) sind aber keine Beratungsleistungen, sondern
   * kostenlose Quereinstiege; als Gruppen-Eintrag würden sie beim Bauen hart brechen
   * („hat kein Icon"). Der Abschluss-Slot ist genau dafür da.
   *
   * B4-2 macht daraus eine LISTE (vorher genau ein Eintrag) — die Vertragsablauf-Erinnerung ist
   * der zweite Fall derselben Art, und zwei Sonderfelder für dieselbe Rolle wären eine Kopie.
   */
  trailingLeaves?: NavLeaf[]
}

/**
 * Monitor-Gratis-Check (Route `/strom-check`, T3). Steht hier in der IA-Datei, damit alle
 * Konsumenten denselben Slug lesen: MAIN_NAV (als Abschluss-Eintrag `trailingLeaf` des
 * Leistungen-Menüs → Header + Mobile-Nav) UND `lib/routes.ts` (noindex-/sitemap-Entscheidung,
 * importiert diesen Wert von hier) — ohne `lib/routes.ts` (`fs`/`path`) in ein Client-Bundle zu
 * ziehen. Genau EIN Fundort für den Pfad. (Muss VOR MAIN_NAV stehen, da dort referenziert.)
 */
export const MONITOR_GRATIS_CHECK_HREF = '/strom-check'

/**
 * Vertragsablauf-Erinnerung (Route `/vertragsende-erinnerung`, B4-2). Steht aus demselben Grund
 * hier wie `MONITOR_GRATIS_CHECK_HREF`: `MAIN_NAV` (Abschluss-Eintrag des Leistungen-Menüs) UND
 * `lib/routes.ts` (sitemap) lesen denselben Slug, ohne dass eine der beiden Dateien die andere
 * ziehen muss.
 *
 * ANDERS ALS DER STROM-MONITOR IST DIESE SEITE INDEXIERBAR — sie ist eine öffentliche
 * Leistungsbeschreibung mit Formular, kein WIP-Datenpipe-Beweis. `lib/routes.ts` nimmt sie deshalb
 * NICHT in die noindex-Ausnahmen auf.
 */
export const VERTRAGSENDE_ERINNERUNG_HREF = '/vertragsende-erinnerung'

/** Die 5 Top-Level-Punkte. Mehr verträgt keine saubere Mobile-Nav (§4.1). */
export const MAIN_NAV: NavItem[] = [
  {
    labelKey: 'leistungen',
    href: '/leistungen',
    overviewKey: 'leistungenAll',
    // Die zwei kostenlosen Quereinstiege als LETZTE Punkte des Leistungen-Menüs (Header + Mobile).
    // Fließen NICHT in LEISTUNGEN_FLAT → erscheinen bewusst NICHT im Footer und sind keine
    // „Leistung" im Sinne von lib/leistungen.ts.
    trailingLeaves: [
      { labelKey: 'stromCheck', href: MONITOR_GRATIS_CHECK_HREF },
      { labelKey: 'vertragsendeErinnerung', href: VERTRAGSENDE_ERINNERUNG_HREF },
    ],
    groups: [
      {
        labelKey: 'leistungenGroupErzeugen',
        items: [
          { labelKey: 'pvSpeicher', href: '/leistungen/pv-speicher' },
          { labelKey: 'energiemanagement', href: '/leistungen/energiemanagement' },
          { labelKey: 'smartHeating', href: '/leistungen/smart-heating' },
        ],
      },
      {
        labelKey: 'leistungenGroupBeschaffen',
        items: [
          { labelKey: 'ppa', href: '/leistungen/ppa' },
          { labelKey: 'finanzierung', href: '/leistungen/finanzierung-foerderung' },
        ],
      },
      {
        labelKey: 'leistungenGroupNachweisen',
        items: [{ labelKey: 'esg', href: '/leistungen/esg' }],
      },
    ],
  },
  {
    // Flaggschiff — bewusst NICHT unter „Leistungen" (§4.2).
    labelKey: 'peakShaving',
    href: '/peak-shaving',
    items: [
      { labelKey: 'peakShavingWhat', href: '/peak-shaving' },
      { labelKey: 'peakShavingCalculator', href: '/peak-shaving/kalkulator' },
    ],
  },
  {
    labelKey: 'branchen',
    href: '/branchen',
    overviewKey: 'branchenAll',
    items: [
      { labelKey: 'bau', href: '/branchen/bau-baunebengewerbe' },
      { labelKey: 'hotellerieGastronomie', href: '/branchen/hotellerie-gastronomie' },
      { labelKey: 'handwerk', href: '/branchen/handwerk' },
      { labelKey: 'industrie', href: '/branchen/industrie-verarbeitendes-gewerbe' },
      { labelKey: 'landForstwirtschaft', href: '/branchen/land-forstwirtschaft' },
    ],
  },
  { labelKey: 'wissen', href: '/wissen' },
  { labelKey: 'ueberUns', href: '/ueber-uns' },
]

/** Rechte Aktionen, Reihenfolge = Hierarchie leise → laut (§4.1). */
export const LOGIN_HREF = '/login'
export const KONTAKT_HREF = '/kontakt'
export const CTA_HREF = '/peak-shaving/kalkulator'

/**
 * Der laufende Kalkulator INNERHALB der coolin.at-Hülle (Rechner im iframe).
 *
 * Bewusst KEIN Eintrag in MAIN_NAV/dem Mega-Menü: Das ist kein Navigationsziel
 * zum Stöbern, sondern der Absprung AUS der Produktseite — er gehört an den CTA,
 * nicht in die Menüstruktur. Die Produktseite (`CTA_HREF`) bleibt der Weg dorthin.
 *
 * Steht trotzdem hier und nicht im JSX: Routen dieser App gehören in die IA-Datei,
 * damit ein Slug-Wechsel einen Fundort hat (dieselbe Regel wie oben). Die EXTERNE
 * iframe-Quelle ist davon getrennt und steht in `lib/config.ts`.
 */
export const CALCULATOR_RUN_HREF = '/peak-shaving/kalkulator/rechner'

/**
 * Flache Listen für den Footer. Bewusst über `labelKey` gesucht statt über einen
 * Index (`MAIN_NAV[0]`): eine Umsortierung der Hauptnavigation darf den Footer
 * nicht still auf die falsche Liste zeigen lassen.
 */
function findNav(labelKey: string): NavItem {
  const item = MAIN_NAV.find((i) => i.labelKey === labelKey)
  if (!item) throw new Error(`Nav-Eintrag "${labelKey}" fehlt in MAIN_NAV`)
  return item
}

export const LEISTUNGEN_FLAT: NavLeaf[] = (findNav('leistungen').groups ?? []).flatMap(
  (g) => g.items,
)
export const PEAK_SHAVING_FLAT: NavLeaf[] = findNav('peakShaving').items ?? []
export const BRANCHEN_FLAT: NavLeaf[] = findNav('branchen').items ?? []

/**
 * Die Adresse in ihren EINZELTEILEN.
 *
 * Sie stand bis zum JSON-LD (§6.4) nur als fertige Zeile „1100 Wien, Österreich"
 * hier — das genügte, solange sie ausschließlich gelesen wurde. Ein
 * `PostalAddress` braucht die Teile aber getrennt (`postalCode`,
 * `addressLocality`, `addressCountry`), und Google liest genau diese Felder für
 * den lokalen Bezug.
 *
 * Die ANZEIGEZEILE wird deshalb jetzt aus den Teilen ZUSAMMENGESETZT statt
 * danebengeschrieben (s. `COMPANY.city`): Der Ausweg wäre gewesen, die fertige
 * Zeile für die Anzeige zu behalten und die Teile fürs Markup danebenzulegen —
 * dann stünde dieselbe Adresse zweimal im Repo und könnte auseinanderlaufen.
 * Ein Markup, das eine andere Adresse behauptet als die sichtbare, ist genau der
 * Fehler, den §6.4 nicht machen darf.
 */
const ADDRESS = {
  street: 'Karl-Popper-Straße 22',
  postalCode: '1100',
  locality: 'Wien',
  /** ISO 3166-1 alpha-2 — die Form, die `PostalAddress.addressCountry` erwartet. */
  countryCode: 'AT',
  countryName: 'Österreich',
} as const

/**
 * Firmendaten — VERBATIM aus `reference/coolin-legacy.html` (Kontakt-Block:
 * „COOLiN ENERGY · energy@coolin.at · Karl-Popper-Straße 22 · 1100 Wien,
 * Österreich"), bestätigt durch `coolin-legacy-impressum.md` (Live-Abruf).
 * Nicht erfunden, nicht geraten. Deckt sich mit der Adresse in Pflichtenheft
 * §6.4 (LocalBusiness-JSON-LD).
 *
 * WAS HIER FEHLT, FEHLT MIT ABSICHT: Rechtsform, Inhaber/Geschäftsführung,
 * Firmenbuchnummer, UID, Gewerbebehörde und Kammer stehen im Bestands-Impressum
 * selbst nur als „[ergänzen]" (OP#13, Pflichtenheft §9.1) — sie sind UNBEKANNT,
 * nicht bloß unerfasst. Eine Telefonnummer und Social-Profile trägt der Bestand
 * ebenfalls nicht (geprüft). Solange das so ist, dürfen sie weder auf der Seite
 * noch im JSON-LD auftauchen: Ein geratenes `legalName` oder eine erfundene
 * `vatID` wären eine Falschangabe an Google — schlimmer als eine fehlende.
 */
export const COMPANY = {
  name: 'COOLiN ENERGY',
  street: ADDRESS.street,
  /** Die sichtbare zweite Adresszeile („1100 Wien, Österreich") — abgeleitet, s. `ADDRESS`. */
  city: `${ADDRESS.postalCode} ${ADDRESS.locality}, ${ADDRESS.countryName}`,
  email: 'energy@coolin.at',
  /** Die Einzelteile fürs `PostalAddress`-JSON-LD (`lib/json-ld.ts`). */
  address: ADDRESS,
} as const
