/**
 * B11 — Die Tarifsatz-Datenschicht: Vorgabewerte für Leistungspreis, Abrechnungsmodell und
 * Mindestbemessung, nach Netzbetreiber und Netzebene, mit Gültigkeitszeitraum und Fundstelle.
 *
 * ── WARUM DIE SÄTZE IM CODE STEHEN UND NICHT IN DER DATENBANK ───────────────────────────────────
 * Was eine Datenbanklösung hier leisten müsste — Versionierung, Entwurf und Veröffentlichung,
 * Unveränderlichkeit nach der ersten Verwendung, Nachvollziehbarkeit der Quelle, Prüfung durch eine
 * zweite Person — leistet die Versionsverwaltung bereits vollständig: jede Fassung dieser Datei ist
 * datiert, signiert, kommentiert und über den PR von einem zweiten Menschen freigegeben worden, und
 * eine einmal ausgelieferte Fassung lässt sich nicht rückwirkend ändern, ohne dass es im Verlauf
 * steht.
 *
 * Zudem bliebe die Engine nur dann rein, wenn die Sätze AUSSERHALB von ihr geladen werden. Eine
 * Datenbanklösung machte den öffentlichen Rechner entweder von einem Netzaufruf abhängig — er
 * rechnet heute vollständig im Browser, ohne dass Verbrauchsdaten ihn verlassen (Prinzip 4) — oder
 * gäbe `anon` erstmals Zugriff auf das `platform`-Schema, das bisher ausschliesslich
 * `service_role` und `authenticated` kennt.
 *
 * Eine Satzänderung ist dadurch ein PR mit EINER Datei, kein Umbau. Genau das bezweckt B11: wenn
 * die Tarifverordnung im November/Dezember 2026 erscheint, soll eine Konfigurationsänderung
 * genügen — unter Zeitdruck, ohne Schemamigration, ohne Deployment-Reihenfolge.
 *
 * ── KONFIGURATION AN DEN RÄNDERN, DETERMINISMUS IM KERN ─────────────────────────────────────────
 * `packages/engine` liest diese Datei NICHT und darf es nie tun (abgesichert durch
 * `packages/engine/src/tariff/no-catalog-dependency.test.ts`). Werte reisen als PARAMETER in die
 * Engine hinein. Eine Engine, die ihre eigenen Sätze holt, ist nicht mehr allein aus ihren Eingaben
 * nachvollziehbar — und genau diese Nachvollziehbarkeit ist die Voraussetzung dafür, dass eine
 * eingefrorene Baseline (B14) 2027 überhaupt etwas belegt.
 *
 * ── EIN VORGABEWERT SCHLÄGT NIE DIE ECHTE NETZRECHNUNG ──────────────────────────────────────────
 * Prinzip 1 bleibt unangetastet: „Die Rechnung ist die Wahrheit." Was hier steht, ist eine
 * Vorbelegung, damit niemand vor einem leeren Feld sitzt — kein Ersatz für die Netzrechnung des
 * Kunden. Jedes Feld bleibt in der Oberfläche editierbar, und das Analyse-Bündel führt die
 * tatsächlich gerechneten Werte DENORMALISIERT mit (B14-1, Regel (b)); `tariffSetId` ist dort eine
 * zusätzliche Herkunftsangabe, niemals ein Ersatz für den Wert.
 *
 * ── EINEN NEUEN TARIFSATZ-STAND NACHTRAGEN ──────────────────────────────────────────────────────
 * Die Anleitung steht in `DEPLOYMENT.md` §4 („Tarifsätze nachtragen"). Sie wird im November unter
 * Zeitdruck gelesen; deshalb dort und nicht verteilt über Kommentare.
 *
 * Rein und ohne Seiteneffekte: kein I/O, kein globaler Zustand, keine Uhr — der Stichtag wird
 * übergeben.
 */
import type { BillingModel } from './tariff'

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Typen
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Die Netzbetreiber, die der Kalkulator benennt. Stabile Schlüssel — sie stehen als
 * `tariffProfileKey` in archivierten Analyse-Bündeln und dürfen nicht umbenannt werden.
 */
export const NETZBETREIBER_IDS = ['wiener_netze', 'netz_noe', 'salzburg_netz'] as const
export type NetzbetreiberId = (typeof NETZBETREIBER_IDS)[number]

/** Anzeigenamen, an EINER Stelle — die Oberfläche erfindet sie nicht ein zweites Mal. */
export const NETZBETREIBER_LABELS: Record<NetzbetreiberId, string> = {
  wiener_netze: 'Wiener Netze',
  netz_noe: 'Netz Niederösterreich',
  salzburg_netz: 'Salzburg Netz',
}

/**
 * Netzebenen, auf denen Gewerbebetriebe hängen. NE 1/2 (Übertragungsnetz, Umspannung) kommen für
 * einen Kalkulator-Kunden nicht vor und stehen deshalb bewusst nicht zur Auswahl — eine Auswahl,
 * die niemand trifft, ist eine Falle, keine Vollständigkeit.
 */
export const NETZEBENEN = [3, 4, 5, 6, 7] as const
export type Netzebene = (typeof NETZEBENEN)[number]

/**
 * Warum zu einer Kombination kein Satz vorliegt. Die Unterscheidung ist KEINE Kosmetik: sie
 * entscheidet, was der Oberfläche zu sagen bleibt.
 *
 * `awaiting_tariff_regulation` — es GIBT den Satz noch nicht. Die SNE-G-V regelt die Grundsätze,
 * die Preise kommen erst mit der Tarifverordnung (SNE-T-V), und die ist nicht erlassen. Hier ist
 * jede Zahl erfunden, auch eine vorsichtige.
 *
 * `not_yet_recorded` — es gibt ihn, wir haben ihn nur noch nicht belegbar hinterlegt. Das ist eine
 * redaktionelle Lücke, kein Verordnungsstand, und sie darf nicht mit dem anderen Fall verwechselt
 * werden: der Kunde hat den Wert auf seiner Rechnung stehen.
 */
export type PendingReason = 'awaiting_tariff_regulation' | 'not_yet_recorded'

type TariffProfileIdentity = {
  netzbetreiber: NetzbetreiberId
  netzebene: Netzebene
}

/** Ein Profil MIT belegbaren Sätzen. Alle Preisfelder sind Pflicht — es gibt kein halbes Profil. */
export type AvailableTariffProfile = TariffProfileIdentity & {
  availability: 'available'
  billingModel: BillingModel
  leistungspreisEurPerKwYear: number
  /**
   * Mindestbemessung (Sockel). `0` heisst „kein Sockel angesetzt" und ist der einzige Wert, der
   * nichts behauptet: der Sockel kann den abgerechneten Leistungswert nur ANHEBEN
   * (`billedKw = max(berechnet, minBillableKw)`, §3.5), ein fehlender Sockel erfindet also weder
   * Kosten noch Ersparnis. Eine erfundene positive Zahl täte beides.
   */
  minBillableKw: number
}

/**
 * Ein Profil OHNE Sätze — und zwar typseitig ohne.
 *
 * Die `?: never`-Felder sind der eigentliche Zweck dieses Entwurfs: sie machen es unmöglich, ein
 * `pending_regulation`-Profil versehentlich mit einem Preis anzulegen. Ohne sie wäre ein fehlender
 * Satz eine Null — und eine Null rechnet an dieser Stelle STILL eine Ersparnis von null, statt zu
 * sagen, dass nicht gerechnet werden kann. Genau dieser Unterschied entscheidet, ob ein fehlender
 * Tarifsatz im November laut oder still ausfällt.
 */
export type PendingTariffProfile = TariffProfileIdentity & {
  availability: 'pending_regulation'
  reason: PendingReason
  /** Was fehlt und woher es kommen wird — für den Menschen, der die Datei im November öffnet. */
  note: string
  billingModel?: never
  leistungspreisEurPerKwYear?: never
  minBillableKw?: never
}

export type TariffProfile = AvailableTariffProfile | PendingTariffProfile

/**
 * COMPILE-TIME-WÄCHTER über die `?: never`-Sperre oben. Steht ABSICHTLICH hier und nicht in der
 * Testdatei: `tsconfig.json` dieses Pakets schliesst `src/**\/*.test.ts` vom Typecheck aus, ein
 * `@ts-expect-error` dort wäre also nie geprüft worden und hätte eine Sicherheit nur vorgetäuscht.
 *
 * Er bricht `pnpm typecheck` in BEIDE Richtungen:
 *   – verschwindet eines der Felder aus `PendingTariffProfile`, schlägt schon der Zugriff
 *     `PendingTariffProfile[K]` fehl;
 *   – wird eines auf einen echten Typ gesetzt (`leistungspreisEurPerKwYear?: number`), verletzt der
 *     Eintrag die Schranke `Record<…, true>`.
 *
 * Der Fehlerzweig ist bewusst ein String-Literal und NICHT `never`: `never` ist der Bodentyp und
 * wäre `true` gegenüber zuweisbar — in dieser Richtung hätte der Wächter stumm durchgelassen
 * (gemessen, nicht angenommen).
 *
 * `export` nur, weil `noUnusedLocals` einen ungenutzten Typ sonst als Fehler meldet und der
 * Wächter damit wieder aus der Datei fiele. Er ist nicht zum Benutzen gedacht.
 */
type AssertAllTrue<T extends Record<TariffOverridableField, true>> = T
export type PendingProfileHasNoPriceFields = AssertAllTrue<{
  [K in TariffOverridableField]: PendingTariffProfile[K] extends undefined
    ? true
    : 'FEHLER: ein ausstehendes Profil darf kein Preisfeld tragen'
}>

/**
 * Ein Satz von Profilen mit gemeinsamer Gültigkeit und gemeinsamer Fundstelle.
 *
 * `validUntil` fehlt, solange der Stand gilt. Wird ein neuer Stand nachgetragen, bekommt der alte
 * sein `validUntil` — die Prüfung unten besteht darauf, dass sich zwei Stände für dieselbe
 * Kombination nicht überschneiden. Eine archivierte Analyse aus 2026 muss auch 2028 noch sagen
 * können, welcher Stand ihr zugrunde lag.
 */
export type TariffSet = {
  /** Stabiler Schlüssel, z. B. `at-2026`. Steht in archivierten Bündeln — nicht umbenennen. */
  id: string
  label: string
  /** ISO-Datum `YYYY-MM-DD`, einschliesslich. */
  validFrom: string
  /** ISO-Datum `YYYY-MM-DD`, einschliesslich. Fehlt, solange der Stand gilt. */
  validUntil?: string
  /** Woher die Zahlen stammen: Verordnung/Preisblatt, Fundstelle, Abrufdatum. */
  sourceNote: string
  profiles: TariffProfile[]
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Die Daten
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Der Stand 2026.
 *
 * ── HIER STEHEN NUR BELEGBARE ZAHLEN ────────────────────────────────────────────────────────────
 * Wo im Repo keine belegbare Fundstelle vorliegt, steht `pending_regulation` mit dem Vermerk, dass
 * der Wert nachzutragen ist — KEINE geschätzte Zahl. Ein erfundener Vorgabewert ist schlimmer als
 * ein fehlender: er sieht aus wie eine Aussage, und niemand kann ihm ansehen, dass er geraten ist.
 * Dasselbe Prinzip trägt bereits die Artikel-Grafiken der Website
 * (`components/wissen/charts/arbeit-leistung-chart.tsx`: „Wer hier ‚Y €/kW' hinschreibt, erfindet.").
 *
 * ── WARUM NETZEBENE 7 ÜBERALL AUSSTEHT, OBWOHL ES HEUTE EINEN NE-7-SATZ GIBT ────────────────────
 * Für NE 7 MIT Leistungsmessung existiert heute ein Grundpreis (Wiener Netze, Preisblatt WN-EX0105
 * Vers. 1/2026: rund 82,92 €/kW·a). Er wird hier BEWUSST NICHT als NE-7-Vorgabewert geführt: er
 * gilt für die kleine Minderheit der bereits lastprofilgemessenen Anschlüsse (ElWOG-Schwelle 50 kW
 * UND 100.000 kWh). Die Zielgruppe dieses Rechners auf NE 7 ist die Mehrheit, die ab 2027 ERSTMALS
 * leistungsabhängig abgerechnet wird — und deren Sätze regelt die noch nicht erlassene
 * Tarifverordnung (SNE-T-V). Den RLM-Satz als Vorbelegung anzubieten hiesse, einem
 * nicht-gemessenen Betrieb den Preis eines gemessenen unterzuschieben. Das ist genau die Art von
 * Zahl, die aussieht wie eine Angabe und keine ist.
 */
export const TARIFF_SET_AT_2026: TariffSet = {
  id: 'at-2026',
  label: 'Netznutzung Österreich, Stand 2026',
  validFrom: '2026-01-01',
  sourceNote:
    'Wiener Netze, Preisblatt WN-EX0105, Version 1/2026 (Grundpreis Netznutzung, gültig seit ' +
    '01.01.2026), im Repo festgehalten am 03.07.2026. Nur die dort belegten Ebenen sind hier ' +
    'gesetzt; alle übrigen Kombinationen stehen bewusst aus. Netz NÖ und Salzburg Netz sind noch ' +
    'nicht erfasst — es liegt kein Preisblatt vor, und geraten wird nicht.',
  profiles: [
    // ── Wiener Netze ────────────────────────────────────────────────────────────────────────────
    {
      netzbetreiber: 'wiener_netze',
      netzebene: 3,
      availability: 'available',
      /*
       * [ANNAHME, §3.5/OP#3] `monthly_max_average` ist der bisherige AT-Vorgabewert des Rechners
       * (Wiener-Netze-Lesart). Er ist NICHT abschliessend belegt: dasselbe Preisblatt spricht beim
       * Grundpreis von einem „Abrechnungszeitraum von einem Jahr, sofern nicht anders angegeben",
       * was eher auf `annual_max` deutet. Bis Martins Tarif-Systematik vorliegt (OP#3) bleibt der
       * bisherige Vorgabewert stehen — ihn hier still umzustellen hiesse, eine offene fachliche
       * Frage über eine Vorbelegung zu entscheiden. Das Abrechnungsmodell ist in Schritt 2 UND im
       * Annahmen-Panel frei wählbar; die Netzrechnung des Kunden entscheidet.
       */
      billingModel: 'monthly_max_average',
      leistungspreisEurPerKwYear: 38.52,
      minBillableKw: 0,
    },
    {
      netzbetreiber: 'wiener_netze',
      netzebene: 4,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Satz aus Preisblatt WN-EX0105 nachzutragen (im Repo ist nur NE 3 festgehalten).',
    },
    {
      netzbetreiber: 'wiener_netze',
      netzebene: 5,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Satz aus Preisblatt WN-EX0105 nachzutragen (im Repo ist nur NE 3 festgehalten).',
    },
    {
      netzbetreiber: 'wiener_netze',
      netzebene: 6,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Satz aus Preisblatt WN-EX0105 nachzutragen (im Repo ist nur NE 3 festgehalten).',
    },
    {
      netzbetreiber: 'wiener_netze',
      netzebene: 7,
      availability: 'pending_regulation',
      reason: 'awaiting_tariff_regulation',
      note: 'Leistungspreise für Netzebene 7 kommen mit der Tarifverordnung (SNE-T-V) zum Tarifjahr 2027.',
    },

    // ── Netz Niederösterreich ───────────────────────────────────────────────────────────────────
    {
      netzbetreiber: 'netz_noe',
      netzebene: 3,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Preisblatt Netz NÖ liegt nicht vor — Satz nachzutragen.',
    },
    {
      netzbetreiber: 'netz_noe',
      netzebene: 4,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Preisblatt Netz NÖ liegt nicht vor — Satz nachzutragen.',
    },
    {
      netzbetreiber: 'netz_noe',
      netzebene: 5,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Preisblatt Netz NÖ liegt nicht vor — Satz nachzutragen.',
    },
    {
      netzbetreiber: 'netz_noe',
      netzebene: 6,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Preisblatt Netz NÖ liegt nicht vor — Satz nachzutragen.',
    },
    {
      netzbetreiber: 'netz_noe',
      netzebene: 7,
      availability: 'pending_regulation',
      reason: 'awaiting_tariff_regulation',
      note: 'Leistungspreise für Netzebene 7 kommen mit der Tarifverordnung (SNE-T-V) zum Tarifjahr 2027.',
    },

    // ── Salzburg Netz ───────────────────────────────────────────────────────────────────────────
    {
      netzbetreiber: 'salzburg_netz',
      netzebene: 3,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Preisblatt Salzburg Netz liegt nicht vor — Satz nachzutragen.',
    },
    {
      netzbetreiber: 'salzburg_netz',
      netzebene: 4,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Preisblatt Salzburg Netz liegt nicht vor — Satz nachzutragen.',
    },
    {
      netzbetreiber: 'salzburg_netz',
      netzebene: 5,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Preisblatt Salzburg Netz liegt nicht vor — Satz nachzutragen.',
    },
    {
      netzbetreiber: 'salzburg_netz',
      netzebene: 6,
      availability: 'pending_regulation',
      reason: 'not_yet_recorded',
      note: 'Preisblatt Salzburg Netz liegt nicht vor — Satz nachzutragen.',
    },
    {
      netzbetreiber: 'salzburg_netz',
      netzebene: 7,
      availability: 'pending_regulation',
      reason: 'awaiting_tariff_regulation',
      note: 'Leistungspreise für Netzebene 7 kommen mit der Tarifverordnung (SNE-T-V) zum Tarifjahr 2027.',
    },
  ],
}

/** Alle bekannten Stände. Ein neuer Stand kommt HIER dazu — s. `DEPLOYMENT.md` §4. */
export const TARIFF_SETS: readonly TariffSet[] = [TARIFF_SET_AT_2026]

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Nachschlagen
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Stabiler Schlüssel einer Kombination, wie er im Analyse-Bündel steht.
 *
 * Bewusst aus den beiden Kennungen zusammengesetzt und nicht aus Anzeigenamen: ein umbenannter
 * Netzbetreiber („Netz Niederösterreich" → „Netz NÖ") darf ein 2026 archiviertes Bündel nicht
 * unlesbar machen.
 */
export function tariffProfileKey(netzbetreiber: NetzbetreiberId, netzebene: Netzebene): string {
  return `${netzbetreiber}:NE${netzebene}`
}

export type TariffLookupResult =
  | { status: 'available'; set: TariffSet; profile: AvailableTariffProfile }
  | { status: 'pending_regulation'; set: TariffSet; profile: PendingTariffProfile }
  /** Die Kombination ist nicht geführt. KEIN Rückfall auf ein anderes Profil, keine Näherung. */
  | { status: 'not_available' }

function coversDate(set: TariffSet, on: string): boolean {
  if (on < set.validFrom) return false
  return set.validUntil == null || on <= set.validUntil
}

/**
 * Liefert zu Netzbetreiber, Netzebene und Stichtag genau EIN Profil — oder ein eindeutiges „nicht
 * verfügbar".
 *
 * Es gibt bewusst keinen Rückfall auf die nächstgelegene Ebene, auf einen anderen Netzbetreiber
 * oder auf einen abgelaufenen Stand. Eine Näherung wäre hier nicht hilfsbereit, sondern eine Zahl
 * ohne Deckung — und niemand könnte ihr ansehen, dass sie von woanders stammt.
 *
 * `on` ist ein ISO-Datum `YYYY-MM-DD` und wird ÜBERGEBEN, nicht gelesen: die Funktion bleibt damit
 * rein und ihr Ergebnis reproduzierbar (dieselbe Regel wie im Rechenkern).
 */
export function lookupTariffProfile(args: {
  netzbetreiber: NetzbetreiberId
  netzebene: Netzebene
  on: string
}): TariffLookupResult {
  for (const set of TARIFF_SETS) {
    if (!coversDate(set, args.on)) continue
    const profile = set.profiles.find(
      (p) => p.netzbetreiber === args.netzbetreiber && p.netzebene === args.netzebene,
    )
    if (!profile) continue
    return profile.availability === 'available'
      ? { status: 'available', set, profile }
      : { status: 'pending_regulation', set, profile }
  }
  return { status: 'not_available' }
}

/**
 * Beantwortet für eine Netzebene OHNE gewählten Netzbetreiber, ob sie bei ALLEN geführten
 * Netzbetreibern aussteht — und aus welchem Grund.
 *
 * Der Fall ist nicht konstruiert, er ist der wichtigste: Netzebene 7 steht überall aus, weil die
 * Tarifverordnung fehlt. Diese Aussage hängt nicht am Netzbetreiber, und sie erst zu machen,
 * nachdem jemand zusätzlich einen Netzbetreiber ausgewählt hat, wäre eine Hürde ohne Ertrag.
 *
 * `null`, sobald irgendein Netzbetreiber einen Satz hat oder die Gründe auseinandergehen — dann ist
 * eine gemeinsame Aussage nicht mehr wahr.
 */
export function pendingAcrossAllBetreiber(netzebene: Netzebene, on: string): PendingReason | null {
  let common: PendingReason | null = null
  for (const id of NETZBETREIBER_IDS) {
    const result = lookupTariffProfile({ netzbetreiber: id, netzebene, on })
    if (result.status !== 'pending_regulation') return null
    if (common == null) common = result.profile.reason
    else if (common !== result.profile.reason) return null
  }
  return common
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Vorgabewerte und Überschreibungen
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Die drei Felder, die ein Profil vorbelegt — und die der Nutzer überschreiben kann. */
export const TARIFF_OVERRIDABLE_FIELDS = [
  'leistungspreisEurPerKwYear',
  'billingModel',
  'minBillableKw',
] as const
export type TariffOverridableField = (typeof TARIFF_OVERRIDABLE_FIELDS)[number]

export type TariffDefaults = {
  leistungspreisEurPerKwYear: number
  billingModel: BillingModel
  minBillableKw: number
}

/** Die Vorbelegung eines verfügbaren Profils — genau die drei Felder, nichts weiter. */
export function tariffDefaultsFromProfile(profile: AvailableTariffProfile): TariffDefaults {
  return {
    leistungspreisEurPerKwYear: profile.leistungspreisEurPerKwYear,
    billingModel: profile.billingModel,
    minBillableKw: profile.minBillableKw,
  }
}

/**
 * Welche der drei Felder der Nutzer gegenüber dem Vorgabewert geändert hat.
 *
 * Landet als `tariffOverriddenFields` im Analyse-Bündel. Ohne diese Angabe wäre 2027 nicht mehr zu
 * unterscheiden, ob eine Analyse mit unserem Vorgabewert oder mit der echten Netzrechnung des
 * Kunden gerechnet wurde — und genau darauf kommt es an, wenn eine Baseline zu erklären ist.
 *
 * Zahlen werden mit einer schmalen Toleranz verglichen: das Formular reicht Gleitkommazahlen
 * durch, und eine unveränderte Vorbelegung soll nicht wegen der letzten Nachkommastelle als
 * Eingriff gelten.
 */
export function deriveTariffOverrides(
  actual: TariffDefaults,
  defaults: TariffDefaults,
): TariffOverridableField[] {
  const EPSILON = 1e-9
  const changed: TariffOverridableField[] = []
  if (Math.abs(actual.leistungspreisEurPerKwYear - defaults.leistungspreisEurPerKwYear) > EPSILON) {
    changed.push('leistungspreisEurPerKwYear')
  }
  if (actual.billingModel !== defaults.billingModel) changed.push('billingModel')
  if (Math.abs(actual.minBillableKw - defaults.minBillableKw) > EPSILON) {
    changed.push('minBillableKw')
  }
  return changed
}

/**
 * Was der Nutzer im Rechner gewählt hat, in einer Form, die durch die ganze Kette reist: flach,
 * serialisierbar, ohne Verweis auf den lebenden Katalog.
 *
 * `defaults` fährt bewusst MIT. Ohne die Vorgabewerte von damals liesse sich später nicht mehr
 * sagen, ob ein Wert überschrieben wurde — man müsste den Stand der Datenschicht nachschlagen, und
 * genau das ist der Verweis, den B14-1 verbietet.
 */
export type TariffSelection = {
  tariffSetId: string
  tariffSetLabel: string
  tariffSetValidFrom: string
  tariffProfileKey: string
  netzbetreiber: NetzbetreiberId
  netzebene: Netzebene
  defaults: TariffDefaults
}

export function tariffSelectionFrom(set: TariffSet, profile: AvailableTariffProfile): TariffSelection {
  return {
    tariffSetId: set.id,
    tariffSetLabel: set.label,
    tariffSetValidFrom: set.validFrom,
    tariffProfileKey: tariffProfileKey(profile.netzbetreiber, profile.netzebene),
    netzbetreiber: profile.netzbetreiber,
    netzebene: profile.netzebene,
    defaults: tariffDefaultsFromProfile(profile),
  }
}

/**
 * Die Herkunftsangabe, die mit dem ERGEBNIS mitreist: welcher Stand, welche Kombination, und was
 * der Nutzer davon überschrieben hat.
 *
 * Sie steht dauerhaft im Report und im Analyse-Bündel (B14, Fassung 2). Die PREISE selbst stehen
 * dort weiterhin denormalisiert als Werte — diese Angabe tritt daneben, nicht an ihre Stelle.
 */
export type TariffSourceRef = Omit<TariffSelection, 'defaults'> & {
  overriddenFields: TariffOverridableField[]
}

/**
 * Bildet die Herkunftsangabe zu den TATSÄCHLICH gerechneten Werten.
 *
 * `actual` sind die Werte des ANGEZEIGTEN Laufs, nicht die aus Schritt 2: das Annahmen-Panel (§6.2)
 * kann das Abrechnungsmodell nach der ersten Rechnung noch ändern, und dann ist es überschrieben —
 * auch wenn es beim Absenden des Formulars noch dem Vorgabewert entsprach.
 */
export function buildTariffSourceRef(
  selection: TariffSelection,
  actual: TariffDefaults,
): TariffSourceRef {
  const { defaults, ...rest } = selection
  return { ...rest, overriddenFields: deriveTariffOverrides(actual, defaults) }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Die Prüfung der Datei selbst
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Prüft die Datenschicht auf ihre Invarianten und liefert die Beanstandungen im Klartext.
 *
 * DAS IST DER EIGENTLICHE SCHUTZ BEIM NACHTRAGEN UNTER ZEITDRUCK. Wer im November die
 * Verordnungssätze einträgt, wird kopieren, einfügen und Zeilen verschieben. Diese Prüfung läuft im
 * Test und sagt sofort, wenn dabei ein Preisfeld verloren geht, eine Kombination doppelt steht oder
 * sich zwei Stände überschneiden — Fehler, die sonst erst auffielen, wenn ein Kunde einen falschen
 * Vorgabewert vor sich hat.
 *
 * Nimmt die Sätze als Argument (statt `TARIFF_SETS` direkt zu lesen), damit der Test auch absichtlich
 * kaputte Sätze durchschicken kann — eine Prüfung, deren Fehlschlag nie beobachtet wurde, ist keine.
 */
export function validateTariffSets(sets: readonly TariffSet[]): string[] {
  const problems: string[] = []
  const seenIds = new Set<string>()

  const isIsoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)

  for (const set of sets) {
    if (seenIds.has(set.id)) problems.push(`Doppelte Tarifsatz-Kennung „${set.id}".`)
    seenIds.add(set.id)

    if (!isIsoDate(set.validFrom)) {
      problems.push(`„${set.id}": validFrom „${set.validFrom}" ist kein Datum (YYYY-MM-DD).`)
    }
    if (set.validUntil != null && !isIsoDate(set.validUntil)) {
      problems.push(`„${set.id}": validUntil „${set.validUntil}" ist kein Datum (YYYY-MM-DD).`)
    }
    if (set.validUntil != null && set.validUntil < set.validFrom) {
      problems.push(`„${set.id}": validUntil liegt vor validFrom.`)
    }
    if (set.sourceNote.trim() === '') {
      problems.push(`„${set.id}": ohne Fundstelle (sourceNote) — woher stammen die Zahlen?`)
    }

    const seenCombos = new Set<string>()
    for (const profile of set.profiles) {
      const key = tariffProfileKey(profile.netzbetreiber, profile.netzebene)
      if (seenCombos.has(key)) {
        problems.push(`„${set.id}": Kombination ${key} steht doppelt.`)
      }
      seenCombos.add(key)

      if (profile.availability === 'available') {
        // Ein „available"-Profil ohne vollständige Preisfelder ist der gefährlichste Zustand: es
        // belegt die Oberfläche vor und sieht aus wie eine Angabe.
        if (!Number.isFinite(profile.leistungspreisEurPerKwYear)) {
          problems.push(`„${set.id}"/${key}: leistungspreisEurPerKwYear fehlt oder ist keine Zahl.`)
        } else if (profile.leistungspreisEurPerKwYear < 0) {
          problems.push(`„${set.id}"/${key}: leistungspreisEurPerKwYear ist negativ.`)
        }
        if (!Number.isFinite(profile.minBillableKw)) {
          problems.push(`„${set.id}"/${key}: minBillableKw fehlt oder ist keine Zahl.`)
        } else if (profile.minBillableKw < 0) {
          problems.push(`„${set.id}"/${key}: minBillableKw ist negativ.`)
        }
        if (typeof profile.billingModel !== 'string' || profile.billingModel.trim() === '') {
          problems.push(`„${set.id}"/${key}: billingModel fehlt.`)
        }
      } else {
        // Die Gegenrichtung: ein ausstehendes Profil DARF keinen Preis tragen. Der Typ verbietet es
        // bereits; diese Prüfung fängt den Fall ab, in dem die Daten von aussen kommen (JSON aus
        // einem Preisblatt-Import) und der Typ nur behauptet wird.
        const stray = TARIFF_OVERRIDABLE_FIELDS.filter(
          (field) => (profile as Record<string, unknown>)[field] !== undefined,
        )
        if (stray.length > 0) {
          problems.push(
            `„${set.id}"/${key}: ausstehendes Profil trägt Preisfelder (${stray.join(', ')}).`,
          )
        }
        if (profile.note.trim() === '') {
          problems.push(`„${set.id}"/${key}: ausstehendes Profil ohne Vermerk, was nachzutragen ist.`)
        }
      }
    }
  }

  // Überschneidende Gültigkeitszeiträume je Kombination: zwei Stände, die zur selben Zeit für
  // dieselbe Kombination gelten, machen das Ergebnis von der Reihenfolge im Array abhängig — und
  // die ist keine fachliche Aussage.
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i]!
      const b = sets[j]!
      const aEnd = a.validUntil ?? '9999-12-31'
      const bEnd = b.validUntil ?? '9999-12-31'
      if (a.validFrom > bEnd || b.validFrom > aEnd) continue

      const aKeys = new Set(a.profiles.map((p) => tariffProfileKey(p.netzbetreiber, p.netzebene)))
      for (const p of b.profiles) {
        const key = tariffProfileKey(p.netzbetreiber, p.netzebene)
        if (aKeys.has(key)) {
          problems.push(
            `Überschneidende Gültigkeit für ${key}: „${a.id}" und „${b.id}" gelten gleichzeitig.`,
          )
        }
      }
    }
  }

  return problems
}
