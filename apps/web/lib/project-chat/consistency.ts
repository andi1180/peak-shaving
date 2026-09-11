import type { MeteringPointRow } from './ports'

/**
 * B24 — DER ZEITRAUM-ABGLEICH: DECKT DIE RECHNUNG DEN LASTGANG AB?
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ EIN VOLLSTÄNDIGER ENTWURF IST NICHT DASSELBE WIE EIN STIMMIGER
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `check_draft_completeness` fragt FELDWEISE: steht in jedem Pflichtfeld etwas? Diese Datei fragt
 * ZEITLICH: beschreiben die zwei Quellen, aus denen der Entwurf gefüllt wurde, überhaupt denselben
 * Zeitraum? Ein Entwurf kann jedes Feld tragen und trotzdem einen Arbeitspreis aus 2024 neben einem
 * Lastgang aus 2026 stellen — vollständig, und trotzdem eine Rechnung, die niemand so aufstellen
 * würde. Genau dieser Fall ist real (der Referenzkunde bringt eine Jahresrechnung 2024/2025 und
 * einen Lastgang ab Februar 2026 mit) und in keiner der beiden Quellen sichtbar: jede für sich ist
 * einwandfrei.
 *
 * ── ⚠ DIESE DATEI LÖST NICHTS AUF ─────────────────────────────────────────────────────────────
 * Sie stellt FEST und entscheidet nicht. Was mit einer Lücke geschieht — warten, bis Martin die
 * Tarifwerte für den Lastgang-Zeitraum bestätigt, oder mit einer begründeten Annahme weiterrechnen
 * — ist eine Fachfrage, und die entscheidet der Kunde (Delta §3.3). Der Weg dorthin sind die
 * bestehenden Werkzeuge `flag_open_question` und `set_draft_field`; hier wird keiner davon
 * angefasst und keine Annahme vorbereitet.
 *
 * ── REINE FUNKTIONEN, KEIN I/O ────────────────────────────────────────────────────────────────
 * Alles hier bekommt eine bereits gelesene Zählpunkt-Zeile und gibt Befunde zurück. Kein Port,
 * keine Datenbank, keine Uhr: derselbe Zählpunkt ergibt morgen denselben Befund.
 */

/**
 * Die zwei Entwurfs-Schlüssel, unter denen der Rechnungszeitraum liegt.
 *
 * ⚠ SIE STEHEN HIER UND NICHT NUR IM WERKZEUGTEXT VON `extract_invoice`. Die Namen sind eine
 * VEREINBARUNG zwischen jener Anweisung („trag ihn mit set_draft_field als zwei Felder ein") und
 * diesem Leser. Zweimal ausgeschrieben liefen sie beim nächsten Umformulieren auseinander — und der
 * Fehler wäre lautlos: der Abgleich fände dann nie wieder einen Rechnungszeitraum und meldete für
 * jeden Kunden „nichts zu vergleichen", obwohl die Werte im Entwurf stehen. `tools.ts` baut seinen
 * Werkzeugtext deshalb aus genau diesen Konstanten.
 *
 * ⚠ Sie sind KEINE Felder von `tariffParamsSchema` — `check_draft_completeness` führt sie folglich
 * unter `unknown_fields`. Das ist der Stand seit dem Schritt, der den Rechnungszeitraum eingeführt
 * hat, und wird hier bewusst nicht geändert: der Eingabe-Contract ist der Vertrag mit der Engine,
 * und der Rechnungszeitraum geht die Engine nichts an.
 */
export const INVOICE_PERIOD_FROM_KEY = 'invoicePeriodFrom'
export const INVOICE_PERIOD_TO_KEY = 'invoicePeriodTo'

/**
 * Ab welchem Abstand zwischen Rechnungs- und Lastgang-Zeitraum ein Befund entsteht.
 *
 * ⚠ EINE GESETZTE ZAHL, KEINE ABGELEITETE. Sie trennt die normale Verschiebung eines
 * Abrechnungszyklus von einer echten Diskrepanz: zwischen dem Ende einer Abrechnungsperiode und dem
 * Beginn eines später beim Netzbetreiber angeforderten Lastgangs liegen regelmässig einige Wochen,
 * ohne dass irgendetwas nicht zusammenpasst. Bei sechzig Tagen ist die Grenze so gesetzt, dass ein
 * voller Zwei-Monats-Versatz noch durchgeht und ein ganzes fehlendes Quartal nicht mehr.
 *
 * Enger gesetzt stünde der Befund im Regelbetrieb dauernd da und wäre bald ein Möbelstück; weiter
 * gesetzt verschwiege er den Fall, für den er gebaut ist. Wer sie ändert, ändert sie HIER — sie
 * steht als Konstante, damit es genau einen Ort dafür gibt.
 */
export const COVERAGE_GAP_TOLERANCE_DAYS = 60

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Ein Befund. Zwei Arten, und sie sagen Verschiedenes:
 *
 * - `internal_gap`  — im Lastgang selbst fehlen Messwerte. Eine Frage der Datenqualität; die
 *   Grenzen sind die GESPEICHERTEN (s. `gapsOf` unten).
 * - `coverage_gap`  — Rechnung und Lastgang beschreiben verschiedene Zeiträume. Eine fachliche
 *   Frage, und die teurere von beiden: die Tarifwerte gelten dann womöglich gar nicht für den
 *   Zeitraum, der gerechnet wird.
 */
export type ConsistencyIssue =
  | {
      kind: 'internal_gap'
      /** Beginn der Lücke, ISO/UTC — wortgleich aus `metering_points.gaps`. */
      from: string
      /** Obere, AUSSCHLIESSENDE Kante der Lücke, ISO/UTC — wortgleich aus `metering_points.gaps`. */
      to: string
    }
  | {
      kind: 'coverage_gap'
      /** Die vier Randdaten, wie sie GESPEICHERT sind — nicht wie sie hier normalisiert wurden. */
      invoiceFrom: string
      invoiceTo: string
      loadProfileFrom: string
      loadProfileTo: string
      /** Der Abstand in ganzen Tagen, gerundet. Verglichen wird exakt (s. `checkMeteringPointConsistency`). */
      gapDays: number
    }

/**
 * Ein Zeitraum in beiden Formen: so wie er dasteht, und so wie sich mit ihm rechnen lässt.
 *
 * ⚠ BEIDES IN EINEM TYP, damit es keine zweite Auslegung gibt. Der Abstand wird über `startMs`/
 * `endMs` gebildet, die Antwort an das Modell nennt `from`/`to` — hätte der Aufrufer nur die
 * rohen Zeichenketten, müsste er sie ein zweites Mal auslegen, und die zwei Auslegungen könnten
 * voneinander abweichen (genau die Falle, die `covered_to` mit seiner halboffenen Kante stellt).
 */
export interface PeriodBounds {
  /** Der gespeicherte Beginn, unverändert. */
  from: string
  /** Das gespeicherte Ende, unverändert. */
  to: string
  /** Beginn als UTC-Millisekunden, EINSCHLIESSEND. */
  startMs: number
  /** Ende als UTC-Millisekunden, AUSSCHLIESSEND — halboffen `[startMs, endMs)`. */
  endMs: number
}

/**
 * Liest den Zeitraum, den der LASTGANG abdeckt.
 *
 * `covered_from`/`covered_to` sind bereits halboffen (`covered_to` ist der letzte Zeitstempel plus
 * ein Intervall, s. den Kommentar an `MeteringPointGap` in `ports.ts`) — hier ist also nichts zu
 * normalisieren, nur zu prüfen.
 *
 * ⚠ Gelesen wird an den ZEITSTEMPELN, nicht an `interval_minutes`. Die Migration lässt beide
 * Grenzen nur gemeinsam zu oder gar nicht; welches Intervall dahinterstand, ist für die Frage
 * „welchen Zeitraum deckt das ab" ohne Belang.
 */
export function readLoadProfilePeriod(point: MeteringPointRow): PeriodBounds | null {
  const from = point.covered_from
  const to = point.covered_to
  if (typeof from !== 'string' || typeof to !== 'string') return null

  const startMs = Date.parse(from)
  const endMs = Date.parse(to)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  if (endMs <= startMs) return null

  return { from, to, startMs, endMs }
}

/**
 * Liest den Zeitraum, den die RECHNUNG abdeckt — aus dem Entwurf des Zählpunkts.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DAS ENDE WIRD UM EINEN TAG WEITERGESCHOBEN, UND DAS IST KEINE SCHLAMPEREI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die zwei Quellen benutzen VERSCHIEDENE Konventionen: `invoicePeriodTo` ist der letzte
 * abgerechnete TAG (eine Rechnung über „01.01.–31.12.2025" trägt hier `2025-12-31`, und dieser Tag
 * gehört dazu), `covered_to` dagegen ist die obere, AUSSCHLIESSENDE Kante. Unverändert gegeneinander
 * gerechnet wäre jeder Abstand um einen Tag zu gross — und ein Lastgang, der nahtlos am Tag nach
 * der Rechnung beginnt, zeigte einen Abstand von einem Tag, wo keiner ist. Das Ende wird deshalb auf
 * den Beginn des FOLGETAGS gesetzt; danach sind beide Zeiträume halboffen und direkt vergleichbar.
 *
 * Nach aussen bleibt der gespeicherte Wert stehen (`to`): das Modell soll dem Kunden das Datum
 * nennen, das in seinem Entwurf steht, und nicht eines, das nur diese Datei kennt.
 *
 * ⚠ Es wird NICHT geraten. Ein fehlendes, leeres oder unplausibles Feld ergibt `null` — also „kein
 * Rechnungszeitraum bekannt", eine andere Aussage als „der Zeitraum passt". Das eine ist
 * Unvollständigkeit (Sache von `check_draft_completeness`), das andere ein Befund.
 */
export function readInvoicePeriod(draft: Record<string, unknown>): PeriodBounds | null {
  const from = readDayString(draft[INVOICE_PERIOD_FROM_KEY])
  const to = readDayString(draft[INVOICE_PERIOD_TO_KEY])
  if (from === null || to === null) return null

  const startMs = parseUtcDay(from)
  const lastDayMs = parseUtcDay(to)
  if (startMs === null || lastDayMs === null) return null

  const endMs = lastDayMs + MS_PER_DAY
  if (endMs <= startMs) return null

  return { from, to, startMs, endMs }
}

/** Ein Entwurfswert, der als Datum in Frage kommt. Alles andere (Zahl, Objekt, Leerstring) ist `null`. */
function readDayString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const ISO_DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * Wertet `JJJJ-MM-TT` als UTC-Mitternacht aus — oder gibt `null`.
 *
 * ⚠ MIT RÜCKWEG, nicht nur mit Muster. `2026-02-31` passt auf das Muster und ist kein Tag; `Date`
 * rollt es still auf den 3. März weiter, und der Abstand daraus sähe plausibel aus. Dieselbe
 * Vorkehrung wie beim Tarifblatt-Scan (B21-2b).
 *
 * Ein angehängter Zeitanteil (`2025-12-31T00:00:00Z`) wird geduldet und ignoriert: der Werkzeugtext
 * verlangt ein reines Datum, aber ein sonst gültiger Zeitstempel soll nicht daran scheitern, dass
 * er genauer ist als nötig.
 */
function parseUtcDay(value: string): number | null {
  const match = ISO_DAY_PREFIX.exec(value)
  if (match === null) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const ms = Date.UTC(year, month - 1, day)
  if (!Number.isFinite(ms)) return null

  const back = new Date(ms)
  if (back.getUTCFullYear() !== year) return null
  if (back.getUTCMonth() !== month - 1) return null
  if (back.getUTCDate() !== day) return null
  return ms
}

/**
 * Prüft EINEN Zählpunkt auf zeitliche Unstimmigkeiten. Read-only, ohne Seiteneffekt.
 *
 * ── REIHENFOLGE IST ABSICHT ───────────────────────────────────────────────────────────────────
 * Der `coverage_gap` steht ZUERST. Es gibt höchstens einen, und er ist der Befund, der eine
 * Entscheidung des Kunden verlangt; die internen Lücken können zu Hunderten auftreten und werden in
 * der Antwort an das Modell gekürzt (`MAX_REPORTED_GAPS` im Ausführer). Stünde er hinter ihnen,
 * könnte ausgerechnet er der Kürzung zum Opfer fallen.
 *
 * ── FEHLT EINE DER ZWEI QUELLEN, GIBT ES KEINEN `coverage_gap` ────────────────────────────────
 * Und zwar KEINEN, nicht einen mit halben Daten: „ich kenne den Rechnungszeitraum nicht" ist
 * Unvollständigkeit und keine Diskrepanz. Wer daraus einen Befund machte, meldete jedem Kunden
 * etwas, sobald er seinen Lastgang hochgeladen und seine Rechnung noch nicht — also im ersten
 * Moment jedes Gesprächs.
 *
 * ⚠ DER ABSTAND WIRD EXAKT VERGLICHEN UND GERUNDET BERICHTET. `covered_from` ist ein beliebiger
 * Zeitstempel (in Österreich regelmässig 23:00Z des Vortags, weil der Lastgang an der lokalen
 * Mitternacht beginnt) — der Abstand ist also fast nie eine ganze Zahl. Gerundet verglichen
 * verschöbe sich die Schwelle um bis zu einen halben Tag; gerundet berichtet liest sich die Zahl
 * so, wie ein Mensch sie nennen würde.
 */
export function checkMeteringPointConsistency(point: MeteringPointRow): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []

  const load = readLoadProfilePeriod(point)
  const invoice = readInvoicePeriod(point.draft)

  if (load !== null && invoice !== null) {
    /*
     * Der Abstand zweier halboffener Zeiträume: positiv nur, wenn einer ganz vor dem anderen liegt.
     * Überlappen sie einander (der Regelfall), sind beide Differenzen negativ und `gapMs` ist 0 —
     * ohne dass hier eine eigene Überlappungs-Prüfung stünde, die man falsch schreiben könnte.
     */
    const gapMs = Math.max(0, invoice.startMs - load.endMs, load.startMs - invoice.endMs)
    if (gapMs > COVERAGE_GAP_TOLERANCE_DAYS * MS_PER_DAY) {
      issues.push({
        kind: 'coverage_gap',
        invoiceFrom: invoice.from,
        invoiceTo: invoice.to,
        loadProfileFrom: load.from,
        loadProfileTo: load.to,
        gapDays: Math.round(gapMs / MS_PER_DAY),
      })
    }
  }

  /*
   * ⚠ DIE GRENZEN WERDEN DURCHGEREICHT, NICHT NEU GEBILDET. `metering_points.gaps` ist der
   * Datensatz; ein hier umgerechnetes oder umbenanntes Format wäre eine zweite Beschreibung
   * derselben Lücke, und der Kunde bekäme je nach Werkzeug andere Grenzen für dasselbe Loch
   * genannt.
   */
  for (const gap of point.gaps) {
    if (typeof gap?.from !== 'string' || typeof gap?.to !== 'string') continue
    issues.push({ kind: 'internal_gap', from: gap.from, to: gap.to })
  }

  return issues
}
