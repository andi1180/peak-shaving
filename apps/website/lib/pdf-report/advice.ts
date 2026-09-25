import { NETZBETREIBER_LABELS, displayedPriceLabel } from 'shared'

import { formatEur } from '@/lib/format'
import { ANNUALIZED_LABEL, catalogStorageNote, CONTROLLED_WAY_LABEL, isAnnualized } from '@/lib/report-copy'
import { formatIsoDate } from './basis'
import { comparisonSelection, hasComparisonChapter } from './comparison'
import { BASIS_SECTION, PV_VALUE_SECTION } from './content'
import { hasPvValueChapter } from './pv-value'
import { block, ref, t, REF_PLACE } from './report-text'
import type { ReportPoint, ReportStatement } from './statement'
import {
  recommendationVerdictOf,
  summaryWaysOf,
  unknownTariffWaysOf,
  type SummaryWay,
  type SummaryWays,
} from './summary'
import type { PdfReportInput } from './types'

/**
 * Das Kapitel „Unser Vorschlag", zwischen „Methodik & Vorbehalte" und „Annahmen und
 * Datengrundlage" — nach dem Vorbild von Seite 11 des Urbanz-Zielbildes.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ HIER WIRD NICHTS GERECHNET UND NICHTS NEU ENTSCHIEDEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Jeder Betrag dieses Kapitels ist ein VERWEIS auf eine Zahl, die weiter vorne bereits ausgewiesen
 * ist: die Wege kommen aus `summaryWaysOf` (derselben Ableitung, aus der die Spanne der
 * Zusammenfassung und die Balken des Wege-Kapitels entstehen), die Speicher-Antwort aus
 * `comparisonSelection` (derselben Auswahl, aus der die Gerätewahl ihr „Nein" bildet). Eine
 * zweite Ableitung hier liefe beim nächsten Umbau von ihr weg und ergäbe ein Dokument, dessen
 * Schlussseite etwas anderes empfiehlt als seine Kapitel (#295).
 *
 * ── ⚠ ES ENTSTEHT KEINE NEUE, KONKURRIERENDE SUMME (D8) ───────────────────────────────────────
 * Die Punkte nennen je EINEN Weg mit je EINEM Betrag und seiner Bezugsgrösse; sie werden nicht
 * addiert und nicht zu einer eigenen Spanne zusammengefasst. Die Ein-Spanne-Regel bleibt damit
 * unberührt: die eine Kern-Ersparnis-Aussage steht weiterhin in der Zusammenfassung.
 *
 * ── ⚠ JEDER PUNKT STEHT FÜR SICH, UND KEINER HAT EINEN PLATZHALTER ────────────────────────────
 * Trifft ein Punkt nicht zu, entfällt er ersatzlos — kein „kein günstigerer Tarif bekannt", keine
 * 0, kein Strich. Die Nummern stehen deshalb NICHT in dieser Datei, sondern entstehen beim
 * Rendern aus der Reihenfolge der übriggebliebenen Punkte (`statementPoints`, `statement.ts`);
 * eine hier vergebene Nummer risse beim nächsten entfallenden Punkt eine Lücke in die Zählung.
 *
 * ── ⚠ DER ZWEITE ABSCHNITT IST EIN VERWEIS, KEINE ZWEITE DATENQUELLEN-TABELLE ──────────────────
 * Er nennt keine Herkunftsangaben mehr selbst, sondern zeigt auf das Kapitel, das sie ausführlich
 * trägt (`basis.ts`, „Annahmen und Datengrundlage") — Abrechnungszeitraum, Preisblatt-Stand,
 * Abgabensätze, aWATTar-Stundenpreise und die PV-Rekonstruktion stehen dort bereits, eine zweite
 * Aufzählung hier liefe beim nächsten Ausbau von ihr weg. Er steht trotzdem nur, wenn ÜBERHAUPT
 * etwas Nachverfolgbares vorliegt (`provenanceSentences`) — sonst zeigte er auf ein Kapitel, das
 * für diesen Report nichts zu belegen hat.
 *
 * ── ⚠ DIESE DATEI DARF `@react-pdf/renderer` NICHT ANFASSEN — dieselbe Regel wie überall sonst in
 * diesem Verzeichnis. Gerendert wird in `document.tsx`.
 */

export type AdviceChapter = {
  /** „Was wir vorschlagen" — `null`, wenn kein einziger Punkt zutrifft. */
  proposal: ReportStatement | null
  /** Die Kurzfassung der Datengrundlage — `null`, wenn nichts davon belegt ist. */
  provenance: ReportStatement | null
}

/**
 * Gibt es dieses Kapitel in diesem Dokument?
 *
 * ⚠ ES IST BEDINGT, UND DIE BEDINGUNG IST „ES GIBT ETWAS ZU SAGEN". Ohne zutreffenden Punkt und
 * ohne belegte Herkunftsangabe bliebe eine Seite mit Überschrift, Vorspann und nichts darunter —
 * samt Agenda-Eintrag, der genau dorthin verweist (D14). Gemessen wird am ERGEBNIS und nicht an
 * seinen Vorbedingungen: eine zweite Fassung der neun Bedingungen darin liefe von ihr weg.
 */
export function hasAdviceChapter(input: PdfReportInput): boolean {
  const chapter = buildAdviceChapter(input)
  return chapter.proposal !== null || chapter.provenance !== null
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Abschnitt 1 — „Was wir vorschlagen"
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Der bessere der beiden EINFACHEN Wege — Vergleichstarif (Weg 2) oder aWATTar ohne Steuerung
 * (Weg 3). `null` heisst: keiner der beiden spart etwas, und dann entfällt der Punkt.
 *
 * ⚠ „Einfach" heisst hier „ohne Umstellung an Speicher oder Verbrauch", und das ist genau die
 * Trennlinie, die das Wege-Kapitel zwischen Weg 3 und Weg 4 zieht. Die Ladesteuerung ist deshalb
 * ausgeschlossen, auch wenn sie mehr brächte — sie ist der eigene Punkt darunter.
 */
function simpleWay(ways: SummaryWays): SummaryWay | null {
  const candidates = ways.ways.filter((way) => way.id !== 'controlled' && way.eur > 0)
  if (candidates.length === 0) return null
  return candidates.reduce((best, way) => (way.eur > best.eur ? way : best))
}

function simplePoint(ways: SummaryWays, way: SummaryWay, days: string): ReportPoint {
  /* ⚠ Der Weg wird BENANNT und nicht bloss beziffert: stehen beide zur Wahl, sagt der Punkt, von
     welchem der genannte Betrag stammt — sonst suchte der Leser ihn beim falschen Balken. */
  const what =
    way.id === 'comparison_tariff'
      ? ways.comparisonSupplier
        ? `Wechseln Sie zu dem Tarif, den Sie selbst gefunden haben (${ways.comparisonSupplier})`
        : 'Wechseln Sie zu dem Vergleichstarif, den Sie uns genannt haben'
      : 'Wechseln Sie zu aWATTar, ohne sonst etwas zu ändern'

  return {
    title: 'Wollen Sie es einfach halten',
    text:
      `${what} — ${formatEur(way.eur)} weniger über die ${days} gemessenen Tage, ohne Umstellung ` +
      'an Speicher oder Verbrauch.',
  }
}

/**
 * Der Punkt zur Ladesteuerung.
 *
 * ── ⚠ WEICH FORMULIERT, UND DAS IST KEINE STILFRAGE ───────────────────────────────────────────
 * Das Zielbild sagt an dieser Stelle „Wir bieten diese Steuerung als eigenes Service an und
 * richten sie für Ihre Batterie ein" — eine Zusage über ein Produkt, das es so noch nicht gibt.
 * Ein Report, der sie druckt, verspricht eine Leistung, die niemand bestätigt hat. Der Punkt lädt
 * deshalb zum Gespräch ein, statt eine Einrichtung anzukündigen.
 *
 * ⚠ Kein „bis zu": der Betrag ist die Zahl des Fahrplans selbst, nicht eine Obergrenze. Beim
 * Katalog-Gerät stehen Investition und Urteil daneben (#378, `catalogStorageNote`); der
 * Bestandsspeicher ist bezahlt.
 */
function maximumPoint(way: SummaryWay, days: string, input: PdfReportInput): ReportPoint {
  const storage = catalogStorageNote(input.analysis)
  return {
    title: 'Wollen Sie das Maximum',
    text:
      `${CONTROLLED_WAY_LABEL} — ${formatEur(way.eur)} weniger über dieselben ${days} Tage.` +
      (storage ? ` ${storage}` : '') +
      ' Sprechen Sie uns an, wenn Sie dabei Unterstützung möchten.',
  }
}

/**
 * Der Punkt zum zusätzlichen Speicher — und er hängt an der Bedingung, unter der das Kapitel
 * „Speichergrösse und Gerätewahl" die Frage überhaupt stellt.
 *
 * ⚠ DIE ANTWORT WIRD NICHT NEU ABGELEITET. `comparisonSelection` ist die eine Stelle, an der die
 * Schwelle `netSavingOverHorizon > 0` steht; `variant === 'addon'` ist dort bereits der
 * Bestandsfall (`candidatesOf` verzweigt allein an `existingBatteryAnalysis`). Ohne
 * Bestandsspeicher gibt es die Frage nicht — dann entfällt der Punkt, und der Katalog-Fall wird
 * hier ausdrücklich nicht nachgebaut: seine Empfehlung steht als eigenes Kapitel im Dokument.
 *
 * ⚠ `hasComparisonChapter` gehört dazu: ohne das Kapitel steht die Antwort nirgends, und ein
 * Verweis darauf zeigte ins Leere.
 */
function storagePoint(input: PdfReportInput): ReportPoint | null {
  const analysis = input.analysis
  const { variant, shown, horizonYears } = comparisonSelection(analysis)
  if (variant !== 'addon' || !hasComparisonChapter(analysis)) return null

  const best = shown[0]
  if (!best) {
    return {
      title: 'Zusätzlicher Speicher',
      text: t`Nicht nötig — das ist bereits geklärt: ${ref(
        block('addon_none'),
        `die Antwort samt Begründung steht ${REF_PLACE}`,
        'kein geprüftes Zusatzgerät rechnet sich über den Betrachtungszeitraum',
      )}.`,
    }
  }

  return {
    title: 'Zusätzlicher Speicher',
    /* ⚠ Gerät und Betrag werden ZITIERT, nicht neu gerechnet: beide stehen als Zeile in der
       Kandidatentabelle des Kapitels, auf das der Halbsatz daneben zeigt. */
    text: t`Ja — ${best.battery.name} bringt über ${String(horizonYears)} Jahre ${formatEur(
      best.netSavingOverHorizon,
    )} ${displayedPriceLabel(input.analysis)}${isAnnualized(best) ? `, aus der ${ANNUALIZED_LABEL}en Ersparnis` : ''}${ref(block('addon_table'), `; die Geräte im Vergleich stehen ${REF_PLACE}`, '')}.`,
  }
}

/**
 * Der Punkt zur Datenlücke.
 *
 * ── ⚠ DIE LÜCKE WIRD AM BEREITS GEFALLENEN URTEIL ABGELESEN ───────────────────────────────────
 * `hasPvValueChapter` ist wahr für GENAU die Lage, die dieser Punkt beschreibt: eine bestehende
 * Anlage in einem reinen Bezugslastgang (`pv_already_in_grid_profile`), deren Beitrag deshalb
 * rekonstruiert statt gemessen wurde. Ein eigenes `hasPv && source === 'import_only'` hier wäre
 * die dritte Fassung derselben Regel (`run-from-draft.ts` benennt die ersten beiden) und liefe
 * beim nächsten Umbau von ihr weg. Bei gemessener Einspeisung und bei einer geplanten Anlage gibt
 * es die Lücke nicht — dann entfällt der Punkt.
 *
 * ⚠ DAS KAPITEL WIRD ÜBER `REPORT_SECTIONS` BENANNT und nicht ausgeschrieben — dasselbe Muster
 * wie `RESULTS_FOOTNOTE` (`content.ts`). Ein Querverweis über `ref(...)` ginge hier nicht: die
 * Rekonstruktions-Aussage des PV-Kapitels steht nicht im Katalog, und der einzige Baustein, der
 * dort steht, hängt am BEFUND und nicht am Kapitel (`pv_value_finding`, `registry.ts`).
 */
function accuracyPoint(input: PdfReportInput): ReportPoint | null {
  if (!hasPvValueChapter(input.analysis)) return null

  return {
    title: 'Für eine noch genauere Zahl',
    text:
      'Reichen Sie uns einen Lastgang mit Einspeisedaten nach, sobald Ihr Netzbetreiber ihn ' +
      `bereitstellt. Was Ihre PV-Anlage beiträgt, ist heute rekonstruiert (Kapitel ` +
      `„${PV_VALUE_SECTION.title}"); mit viertelstundengenauen Einspeisedaten liesse sich ` +
      'derselbe Beitrag direkt aus Messwerten rechnen.',
  }
}

/**
 * Die zwei Punkte bei unbekanntem Liefertarif (§3.1a): das Speicher-Urteil, zitiert aus dem
 * Gerätekapitel, und die fehlende Rechnung. Ohne heutigen Tarif gibt es keinen Tarifweg, der
 * gegen ihn „spart" — die Punkte „einfach"/„Maximum" entfallen deshalb.
 */
function unknownTariffPoints(input: PdfReportInput): ReportPoint[] {
  const points: ReportPoint[] = []
  const verdict = recommendationVerdictOf(input.analysis)
  if (verdict) {
    points.push({
      title: 'Speicher',
      text: t`${verdict}${ref(block('recommendation'), ` Die Einzelheiten stehen ${REF_PLACE}.`, '')}`,
    })
  }
  points.push({
    title: 'Für den Vergleich mit Ihrem heutigen Tarif',
    text:
      'Reichen Sie uns Ihre Stromrechnung nach. Ohne sie kennen wir Ihren heutigen Arbeitspreis ' +
      'und Ihre Grundgebühr nicht; mit ihr rechnen wir jeden Weg dieses Reports gegen das, was ' +
      'Sie heute tatsächlich zahlen.',
  })
  return points
}

export function buildProposal(input: PdfReportInput): ReportStatement | null {
  const ways = summaryWaysOf(input.analysis)
  const points: ReportPoint[] = unknownTariffWaysOf(input.analysis)
    ? unknownTariffPoints(input)
    : []

  if (ways) {
    const days = String(ways.coveredDays)
    const simple = simpleWay(ways)
    if (simple) points.push(simplePoint(ways, simple, days))

    /*
     * ⚠ DER PUNKT STEHT NUR, WENN ER DEN EINFACHEN WEG ÜBERTRIFFT. Ohne Punkt 1 ist die Schwelle
     * die Bezugsgrösse selbst (eine Ersparnis über null). Gleichstand zählt nicht: „X"
     * neben demselben X eine Zeile darüber wäre zweimal dieselbe Zahl unter zwei Vorschlägen.
     */
    const controlled = ways.ways.find((way) => way.id === 'controlled')
    const threshold = simple ? simple.eur : 0
    if (controlled && controlled.eur > threshold) points.push(maximumPoint(controlled, days, input))
  }

  const storage = storagePoint(input)
  if (storage) points.push(storage)

  const accuracy = accuracyPoint(input)
  if (accuracy) points.push(accuracy)

  if (points.length === 0) return null

  return {
    id: 'advice_proposal',
    title: 'Was wir vorschlagen',
    /* ⚠ KEINE KOPFZAHL: jeder Betrag hier gehört zu genau einem Punkt, und eine Zahl darüber
       läse sich als deren Summe — genau die Addition, die das Dokument sonst überall ausschliesst. */
    amount: null,
    rows: [],
    /* Der Fliesstext bleibt leer, wo die Listenform steht — s. `ReportStatement.points`. */
    body: '',
    points,
  }
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Abschnitt 2 — woher die Zahlen stammen
 * ──────────────────────────────────────────────────────────────────────────────────────────── */

/** Woher der Arbeitspreis der Energieseite kommt — `null`, wenn es dazu keine belegte Angabe gibt. */
function energyPriceSentence(input: PdfReportInput): string | null {
  const period = (input.tariffProvenance?.invoicePeriods ?? []).find(
    (entry) => entry.from !== null || entry.to !== null,
  )

  if (period) {
    const from = period.from ? (formatIsoDate(period.from) ?? period.from) : null
    const to = period.to ? (formatIsoDate(period.to) ?? period.to) : null
    const span = from && to ? `${from} – ${to}` : (from ?? to)
    /* ⚠ Ein ABGELEITETER Zeitraum ist eine Annahme und darf nicht wie eine abgelesene Angabe
       dastehen — dieselbe Unterscheidung wie in der Datenquellen-Tabelle. */
    const origin = period.assumed ? ', aus der Jahresrechnung abgeleitet' : ''
    return `Ihr heutiger Energiepreis stammt aus Ihrer Kundenrechnung (Abrechnungszeitraum ${span}${origin}).`
  }

  /* Unbekannter Liefertarif: es gibt keinen heutigen Energiepreis, über dessen Herkunft zu reden wäre. */
  if (input.analysis.assumptions.energyPriceCtPerKwh === null) return null

  /* ⚠ `null` ist eine AUSSAGE und keine Leerstelle: der Kunde hat die Werte selbst eingetragen,
     und das ist die bessere Grundlage (Prinzip 1). Der dritte Zustand („nicht nachverfolgt")
     schweigt hier dagegen — er hat nichts zu belegen. */
  if (input.tariffSource === null) {
    return 'Ihr heutiger Energiepreis stammt unverändert aus Ihren eigenen Angaben.'
  }
  return null
}

/** Auf welchem Preisblatt-Stand die Netzseite beruht — `null`, wenn keiner nachverfolgt ist. */
function gridCostSentence(input: PdfReportInput): string | null {
  const source = input.tariffSource

  if (typeof source === 'object' && source !== null) {
    const validFrom = formatIsoDate(source.tariffSetValidFrom) ?? source.tariffSetValidFrom
    return (
      `Die Netzkosten beruhen auf den Sätzen von ${NETZBETREIBER_LABELS[source.netzbetreiber]}, ` +
      `Netzebene ${source.netzebene} — Stand „${source.tariffSetLabel}", gültig ab ${validFrom}.`
    )
  }

  const dates = (input.tariffProvenance?.gridTariffValidFrom ?? [])
    .map((iso) => formatIsoDate(iso))
    .filter((value): value is string => value !== null)
  if (dates.length === 0) return null

  const operator = input.netzbetreiber
    ? NETZBETREIBER_LABELS[input.netzbetreiber]
    : 'Ihres Netzbetreibers'
  /* ⚠ MEHRERE STÄNDE WERDEN ALLE GENANNT: ein langer Lastgang kann einen Tarifwechsel überqueren,
     und nur den ersten zu nennen wäre eine Angabe, die für den halben Zeitraum nicht stimmt. */
  const head =
    dates.length === 1
      ? `der hinterlegten Preisblatt-Zeile ${operator}, gültig ab ${dates[0]}`
      : `zwei hinterlegten Preisblatt-Ständen ${operator}, gültig ab ${dates.join(' bzw. ')}`
  return `Die Netzkosten beruhen auf ${head}.`
}

/**
 * Die Kurzfassung der Datengrundlage, Satz für Satz.
 *
 * ⚠ ZWEI SÄTZE HÄNGEN AM BERECHENBAREN TARIFVERGLEICH, und das ist keine Vorsichtsmassnahme: ohne
 * ihn gibt es weder eine Börsenpreis-Reihe noch einen aufgelösten Abgabenzeitraum im Dokument
 * (fehlt für eine Kombination ein Verordnungssatz, fällt der ganze Vergleich mit benannter Lücke
 * aus — `side: 'levy'`). Beides zu erwähnen, wo es nicht gerechnet wurde, wäre eine Aussage über
 * Zahlen, die dieser Report nicht enthält.
 */
function provenanceSentences(input: PdfReportInput): string[] {
  const analysis = input.analysis
  const computable = analysis.tariffOptimization?.computable === true
  const sentences: string[] = []

  const energy = energyPriceSentence(input)
  if (energy) sentences.push(energy)

  const grid = gridCostSentence(input)
  if (grid) sentences.push(grid)

  if (computable) {
    sentences.push(
      'Elektrizitätsabgabe, EAG-Förderbeitrag, EAG-Pauschale und Gebrauchsabgabe sind mit den ' +
        'Verordnungssätzen gerechnet, die für Ihren Netzbetreiber und Ihre Netzebene im ' +
        'ausgewerteten Zeitraum galten.',
      'Die aWATTar-Preise sind die echten, historischen Stundenpreise genau dieses Zeitraums — ' +
        'keine Prognose und kein Durchschnittswert.',
    )
  }

  const pvValue = analysis.pvValue
  if (hasPvValueChapter(analysis) && pvValue) {
    const outage = pvValue.months.some((month) => month.outage)
    sentences.push(
      'Der Vergleich „mit und ohne PV-Anlage" ist eine Rekonstruktion und keine zweite Messung: ' +
        'Ihr echter Netzbezug zuzüglich einer aus Wetterdaten (PVGIS) und Ihren Anlagendaten ' +
        'geschätzten Erzeugung.' +
        /* ⚠ Welche Monate das sind, steht im PV-Kapitel — hier stünde die Liste ein zweites Mal
           und könnte beim nächsten Umbau eine andere sein. */
        (outage
          ? ' Für die Monate, in denen Ihr Lastgang keine Erzeugung zeigt, ist dabei bewusst gar ' +
            'keine angesetzt.'
          : ''),
    )
  }

  return sentences
}

export function buildProvenance(input: PdfReportInput): ReportStatement | null {
  if (provenanceSentences(input).length === 0) return null

  return {
    id: 'advice_provenance',
    /*
     * ⚠ DER TITEL WEICHT VOM ZIELBILD AB („Wie diese Zahlen entstanden sind"), UND ZWAR BEWUSST:
     * genau dieser Satz steht als Vorspann des Kapitels davor („Methodik & Vorbehalte",
     * `METHODOLOGY_INTRO`). Zwei aufeinanderfolgende Seiten mit derselben Überschriftszeile lesen
     * sich wie ein Doppeldruck.
     */
    title: 'Woher diese Zahlen stammen',
    amount: null,
    rows: [],
    body: `Abrechnungszeitraum, Preisblatt-Stand, Abgabensätze, aWATTar-Stundenpreise und — sofern ` +
      `zutreffend — die PV-Rekonstruktion sind ausführlich im Kapitel „${BASIS_SECTION.title}" ` +
      'nachvollziehbar.',
  }
}

export function buildAdviceChapter(input: PdfReportInput): AdviceChapter {
  return {
    proposal: buildProposal(input),
    provenance: buildProvenance(input),
  }
}
