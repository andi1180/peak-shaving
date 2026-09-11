/**
 * Die Stationen der Dateneingabe — Reihenfolge, Auflösung und Adressen (B24, Teil 1).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client. Die Seite liest den Zustand aus der
 * Datenbank und reicht ihn als zwei Zahlen herein; alles Weitere ist Rechnung. Gleiche Aufteilung
 * wie `lib/admin/projects.ts` und `lib/admin/open-questions.ts` — und hier mit einem eigenen Gewicht,
 * weil `apps/web` kein Renderer-Setup hat (`vitest.config.ts`): was hier steht, ist der einzige Teil
 * des Wizards, der sich ohne Browser prüfen lässt.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE POSITION STEHT IN DER URL UND NIRGENDWO SONST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Kein Client-Router, kein Schritt-Zähler im State, kein `useState` über die Stationen. Weiter und
 * Zurück sind gewöhnliche Links bzw. Umleitungen, und die Seite wird bei jedem Schritt neu vom
 * Server gerendert. Das ist nicht Sparsamkeit, sondern die Bedingung dafür, dass die Reihenfolge
 * aus dem ECHTEN Datenbankstand folgt: ein Wizard-State im Browser könnte behaupten, man stehe bei
 * „Zählpunkt 2", nachdem der zweite Zählpunkt in einem anderen Tab entfernt wurde.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE STATIONEN SIND ABGELEITET, NICHT GESPEICHERT — UND DAS HAT EINE FOLGE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Es gibt keine Spalte „aktueller Schritt". Die Liste entsteht aus zwei Angaben, die es wirklich
 * gibt: ob ein Segment gesetzt ist (`platform.projects.segment`) und wie viele Zeilen in
 * `platform.metering_points` stehen. Die fünf Stationen je Zählpunkt tragen in diesem Bauschritt
 * KEINEN Zustand — sie sind Platzhalter. Daraus folgt unmittelbar, dass sich „wo hat jemand
 * aufgehört?" nicht beantworten lässt, und `defaultStationIndex` erfindet deshalb auch keine
 * Antwort darauf (s. dort).
 */
import { projectDataEntryHref } from './projects'

/** Der URL-Parameter, der die Position trägt. Ein Name, eine Stelle. */
export const STATION_PARAM = 'station'

// ── Die fünf Schritte je Zählpunkt ───────────────────────────────────────────────────────────────
/**
 * Die Reihenfolge ist fachlich und nicht beliebig: der LASTGANG steht vorn, weil alles Weitere ihn
 * voraussetzt — die Rechnung wird gegen seinen Zeitraum gehalten (`check_data_consistency`,
 * B24 Teil 1 Schritt 3), und Batterie, PV und Tarif beschreiben eine Anlage an genau diesem
 * Zählpunkt. Wer die Liste umsortiert, ändert damit die Abfolge der Dateneingabe, nicht nur eine
 * Anzeige.
 */
export const METERING_POINT_STEPS = [
  { id: 'lastgang', label: 'Lastgang' },
  { id: 'rechnung', label: 'Rechnung' },
  { id: 'batterie', label: 'Batterie' },
  { id: 'pv', label: 'PV' },
  { id: 'tarif', label: 'Tarif' },
] as const

export type MeteringPointStepId = (typeof METERING_POINT_STEPS)[number]['id']

// ── Stationen ────────────────────────────────────────────────────────────────────────────────────
/**
 * Die Kennungen der beiden Stationen, die wirklich etwas speichern.
 *
 * Als Konstanten und nicht als getippte Zeichenketten, weil sie an DREI Stellen gebraucht werden:
 * beim Aufbau der Liste, beim Verzweigen der Seite und als Umleitungsziel der beiden Server
 * Actions. Dreimal ausgeschrieben liefe eine Umbenennung an einer davon vorbei — und zwar still:
 * die Action leitete auf eine Station um, die es nicht gibt, `resolveStation` klemmte sie auf die
 * letzte, und der Wizard spränge nach dem Speichern ans Ende statt einen Schritt weiter.
 */
export const SEGMENT_STATION_ID = 'segment'
export const METERING_POINT_COUNT_STATION_ID = 'zaehlpunkte'

export type StationKind =
  | 'segment'
  | 'zaehlpunkte'
  | 'zaehlpunkt-schritt'
  | 'ki-check'
  | 'abbruchpruefung'
  | 'ende'

export type Station = {
  /** Der Wert, der in `?station=` steht. */
  id: string
  kind: StationKind
  /** Überschrift der Station — fertiger deutscher Text, wie überall im Admin-Bereich. */
  title: string
  /** Nur bei `kind === 'zaehlpunkt-schritt'`: die 1-basierte Nummer und der Schritt. */
  meteringPoint?: { number: number; step: MeteringPointStepId }
}

/** Mindestens eine Station — die Segment-Station gibt es in jedem Projekt. */
export type StationList = [Station, ...Station[]]

/**
 * Die Kennung einer Zählpunkt-Station.
 *
 * Die Nummer ist 1-basiert und meint die REIHENFOLGE DER ANLAGE — `list_metering_points` sortiert
 * „älteste zuerst", und das ist die einzige Ordnung, die ein Mensch wiedererkennt („der erste, den
 * wir angelegt haben"). Es gibt bewusst KEINE Zählpunktnummer in der Datenbank (Migration
 * 20260911090000, TEIL 6); die Nummer hier ist eine Position in einer sortierten Liste und keine
 * Eigenschaft der Zeile. Deshalb steht in der URL auch nicht die UUID: sie würde eine Stabilität
 * behaupten, die die Anzeige nicht hat.
 */
export function meteringPointStationId(number: number, step: MeteringPointStepId): string {
  return `zp${number}-${step}`
}

/**
 * Der Stand, aus dem die Stationen folgen.
 *
 * ⚠ `meteringPointCount` ist eine ZAHL und darf nicht `null` sein. Die Seite muss den Fall „nicht
 * gelesen" vorher abfangen — er ist NICHT dasselbe wie 0, und die Verwechslung wäre hier teuer:
 * bei 0 zeigt der Wizard den Zählpunkt-Schritt, und dessen Formular kann eine bestehende Zahl
 * VERKLEINERN. Ein Lesefehler dürfte damit im schlimmsten Fall einen Zählpunkt entfernen.
 * `readMeteringPointCount` (`lib/admin/metering-points.ts`) unterscheidet die beiden deshalb.
 */
export type DataEntryState = {
  segmentSet: boolean
  meteringPointCount: number
}

/**
 * Die vollständige, geordnete Liste der Stationen dieses Projekts.
 *
 * ⚠ SIE BRICHT AB, WO DIE ANGABEN AUFHÖREN — und genau das ist der Zugriffsschutz des Wizards.
 * Ohne Segment gibt es GENAU EINE Station; ohne Zählpunkte deren zwei. Es ist damit keine zweite
 * Prüfung nötig, die „darf ich hier schon sein?" beantwortet: was nicht in der Liste steht, gibt es
 * nicht, und `resolveStation` leitet darauf um.
 */
export function buildStations({
  segmentSet,
  meteringPointCount,
}: DataEntryState): StationList {
  /*
   * ⚠ DER RÜCKGABETYP IST EIN NICHT-LEERES TUPEL, und das ist keine Typ-Kosmetik.
   * `resolveStation` muss IMMER eine Station liefern können — es gibt keinen sinnvollen
   * „nirgendwo". Mit `Station[]` wäre jeder Zugriff `Station | undefined`
   * (`noUncheckedIndexedAccess`), und die Seite müsste einen Fall behandeln, den diese Funktion
   * per Konstruktion nicht erzeugen kann. Das Tupel macht die Zusage im TYP, statt sie an jeder
   * Verwendungsstelle mit einem `!` zu behaupten.
   */
  const first: Station = { id: SEGMENT_STATION_ID, kind: 'segment', title: 'Segment' }
  const stations: StationList = [first]
  if (!segmentSet) return stations

  stations.push({ id: METERING_POINT_COUNT_STATION_ID, kind: 'zaehlpunkte', title: 'Zählpunkte' })
  if (meteringPointCount < 1) return stations

  for (let number = 1; number <= meteringPointCount; number += 1) {
    for (const step of METERING_POINT_STEPS) {
      stations.push({
        id: meteringPointStationId(number, step.id),
        kind: 'zaehlpunkt-schritt',
        title: `Zählpunkt ${number} — ${step.label}`,
        meteringPoint: { number, step: step.id },
      })
    }
  }

  /*
   * Die drei Abschluss-Stationen hängen an der GESAMTHEIT der Zählpunkte, nicht an einem einzelnen
   * — deshalb stehen sie hinter der Schleife und nicht darin. Der Auftrag nennt die erste
   * „AI-Check"; sie heisst hier `ki-check`, weil jede andere Kennung dieses Wizards deutsch ist
   * (`zaehlpunkte`, `abbruchpruefung`) und eine einzelne englische Ausnahme beim Lesen der URL
   * jedes Mal stolpern liesse. Gemeint ist dieselbe Station.
   */
  stations.push({ id: 'ki-check', kind: 'ki-check', title: 'KI-Check' })
  stations.push({ id: 'abbruchpruefung', kind: 'abbruchpruefung', title: 'Abbruchprüfung' })
  stations.push({ id: 'ende', kind: 'ende', title: 'Fertig' })

  return stations
}

/**
 * Wo der Wizard startet, wenn die Adresse keine Station nennt.
 *
 * ⚠ DIE ERSTE ZÄHLPUNKT-STATION, SONST DIE LETZTE — und die Begründung ist eine Fehlanzeige:
 * Segment und Zählpunkt-Zahl SIND gespeichert, an ihnen wäre nichts mehr zu tun; die fünf
 * Stationen je Zählpunkt tragen dagegen keinerlei Zustand (sie sind Platzhalter). Wie weit jemand
 * darin gekommen ist, weiss niemand — und ein Wizard, der bei „Zählpunkt 2 — Tarif" aufmachte,
 * weil das die letzte Station ist, behauptete einen Fortschritt, den er nicht kennt. Er beginnt
 * deshalb am Anfang dessen, was er nicht weiss.
 *
 * Für die beiden kurzen Listen fällt die Regel mit „die letzte" zusammen: ohne Segment steht nur
 * `segment` da, ohne Zählpunkte endet sie bei `zaehlpunkte` — also genau bei der Angabe, die als
 * Nächstes fehlt.
 */
export function defaultStationIndex(stations: StationList): number {
  const first = stations.findIndex((station) => station.kind === 'zaehlpunkt-schritt')
  return first === -1 ? stations.length - 1 : first
}

export type StationResolution = {
  /** Die aufgelöste Station — es gibt immer eine (s. `StationList`). */
  station: Station
  /** Ihre Position in `stations`, für „Schritt X von Y" und die Zurück-/Weiter-Nachbarn. */
  index: number
  /**
   * `true` = die Adresse nannte eine Station, die es für dieses Projekt nicht gibt. Die Seite
   * leitet dann auf die aufgelöste Station um, damit die URL nicht weiter etwas Falsches behauptet.
   */
  redirectRequired: boolean
}

/**
 * Löst den URL-Parameter gegen die tatsächlich vorhandenen Stationen auf.
 *
 * ⚠ EINE UNBEKANNTE STATION IST KEIN FEHLER, SONDERN EINE UMLEITUNG — auf die LETZTE vorhandene.
 * Das deckt den Regelfall genau: „zu weit vorn" ist die einzige Art, wie eine Station fehlen kann
 * (die Liste wächst nur nach hinten), und die letzte vorhandene ist dann das Tor, an dem es
 * weitergeht — ohne Segment `segment`, ohne Zählpunkte `zaehlpunkte`.
 *
 * OFFENGELEGTE KEHRSEITE, damit sie jemand bewusst ändern kann: Wer bei EINEM Zählpunkt
 * `zp2-tarif` aufruft, landet auf `ende` und nicht auf `zp1-tarif` — die letzte vorhandene Station
 * liegt dann hinter dem Zählpunkt-Block. Eine Sonderregel „nächstgelegener Zählpunkt" wäre
 * denkbar, müsste aber die Kennung zerlegen und verdeckte damit einen echten kaputten Link.
 * Gestrandet ist niemand: jede Station ausser der ersten hat einen Zurück-Weg.
 *
 * Der angefragte Wert wird NICHT weiterverwendet und nirgends angezeigt — er kommt aus der
 * Adresszeile, und was nicht in der Liste steht, existiert für diese Seite nicht.
 */
export function resolveStation(stations: StationList, requested: string | null): StationResolution {
  // `at` kann hier nicht danebengreifen: jeder Index stammt aus dieser Liste, und sie ist nie
  // leer. Der Rückfall auf die erste Station ist reine Typ-Hygiene, kein erreichbarer Zweig.
  const pick = (index: number, redirectRequired: boolean): StationResolution => ({
    station: stations[index] ?? stations[0],
    index,
    redirectRequired,
  })

  if (requested === null || requested === '') return pick(defaultStationIndex(stations), false)

  const index = stations.findIndex((station) => station.id === requested)
  if (index !== -1) return pick(index, false)

  return pick(stations.length - 1, true)
}

/**
 * Der erste Wert eines Suchparameters als Zeichenkette.
 *
 * Next liefert bei mehrfach gesetztem Parameter ein Array. Ihn dann als „nicht gesetzt" zu lesen
 * schickte den Wizard auf die Startstation zurück; der erste Wert ist die naheliegende Lesart, und
 * eine unbekannte Station kostet ohnehin nur eine Umleitung.
 */
export function firstParamValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** Adresse einer Station. Die Position IST die URL — es gibt keinen zweiten Ort dafür. */
export function stationHref(projectId: string, stationId: string): string {
  return `${projectDataEntryHref(projectId)}?${STATION_PARAM}=${encodeURIComponent(stationId)}`
}

/**
 * Die Station, auf die nach dem Speichern des Segments weitergeleitet wird.
 *
 * Sie ist per Definition von `buildStations` die zweite — sobald ein Segment gesetzt ist, gibt es
 * sie immer. Die Action kann das nicht selbst ableiten (sie kennt den Zählpunkt-Stand nicht und
 * soll ihn nicht extra lesen), deshalb steht die Zusage hier neben der Liste, die sie einhält.
 */
export function stationAfterSegment(): string {
  return METERING_POINT_COUNT_STATION_ID
}

/**
 * Die Station, auf die nach dem Setzen der Zählpunkt-Zahl weitergeleitet wird: der erste Schritt
 * des ersten Zählpunkts. `admin_set_metering_point_count` lässt nur Werte ab 1 zu — es gibt nach
 * einem erfolgreichen Aufruf also immer mindestens einen Zählpunkt und damit diese Station.
 */
export function stationAfterMeteringPointCount(): string {
  return meteringPointStationId(1, METERING_POINT_STEPS[0].id)
}
