import type { ReportBaukastenId } from './registry'

/**
 * Stufe D — ein Text, der auf einen anderen Baustein zeigt, ohne dessen Ort auszuschreiben.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DIESE DATEI ÜBERHAUPT EXISTIERT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * 29 Textstellen in den sechs Kapitel-Erzeugern zeigen heute auf einen Nachbarn und schreiben
 * seinen Ort als Wort hin: „in der Zahl oben", „im Kapitel „Empfehlung und Lastverlauf"", „wie im
 * Datenqualitäts-Hinweis oben" (vollständige Liste: `Report_Baukasten_Stufe_D_Plan.md` §1). Sie
 * sind damit für GENAU EINE Reihenfolge geschrieben. Verschiebt ein Umbau einen Baustein oder
 * wählt die Admin-Auswahl ihn ab, zeigt der Satz auf etwas, das nicht (mehr) dort steht — viermal
 * nachweislich geschehen, behoben mit PR #273.
 *
 * ── ⚠ EIN GETIPPTER VERWEIS UND KEINE MARKE IN DER ZEICHENKETTE ───────────────────────────────
 * Naheliegend wäre `'…steckt nicht in {{ref:savings}}…'` mit einer Ersetzung vor dem Rendern. Ein
 * Tippfehler in der Kennung stünde dann als `{{ref:savngs}}` im ausgelieferten PDF. `ReportRef`
 * trägt die Kennung deshalb als `ReportBaukastenId` — aus demselben Grund, aus dem die Registry
 * einen Literal-Union führt und kein `string` (`registry.ts`).
 *
 * ── ⚠ DER VERWEIS TRÄGT SEINE ALTERNATIVE MIT, UND DAS IST DER KERN ───────────────────────────
 * Fehlt das Ziel, darf NICHT bloss der Verweis verschwinden: der Restsatz behauptete dann etwas
 * anderes („Dieser Betrag ist in der Gesamtersparnis bereits als erste Zeile enthalten" — in
 * welcher?). Jeder Verweis sagt deshalb auch, wie es ohne sein Ziel heisst; `absent: null` heisst
 * „dann gibt es diesen Text gar nicht".
 *
 * ── ⚠ KEINE SEITENZAHLEN ──────────────────────────────────────────────────────────────────────
 * Die Ortsangabe wird aus der LESEORDNUNG gebildet, nie aus einer Seitenzahl. Zwei gemessene
 * Gründe stehen im Kopf von `page-numbers.ts`: Bausteine innerhalb einer umbrechenden `<Page>`
 * sind gar nicht seitengenau messbar (Aufbau C), und eine aufgelöste Seitenzahl im Fliesstext
 * änderte die Zeilenlänge und damit den Umbruch, auf den sie zeigt — `measurementsAgree` ERKENNT
 * das, löst es aber nicht.
 */

/**
 * Worauf ein Verweis zeigt.
 *
 * ⚠ Ein Verweis zeigt auf einen Baustein ODER auf ein FELD darin. Das ist keine Feinheit: von den
 * 29 Fundstellen zeigen zehn auf eine einzelne Zeile eines fremden Bausteins und drei auf dessen
 * Kopfzahl. „Der Baustein steht da" ist für sie die falsche Frage — die Kassen-Fassung von
 * `savings` trägt eine Zeile „Wert der Ladesteuerung", die §3.7-Fassung nicht (s.
 * `SavingsPlacement` in `summary.ts`).
 */
export type ReportRefTarget =
  | { kind: 'block'; id: ReportBaukastenId }
  /** Die eine grosse Zahl des Bausteins (`ReportStatement.amount`). */
  | { kind: 'amount'; id: ReportBaukastenId }
  /** Eine Zeile seiner Aufschlüsselung, über ihren stabilen Schlüssel (`ReportRow.key`). */
  | { kind: 'row'; id: ReportBaukastenId; row: string }
  /** Eine SPALTE einer Tabelle, über ihren stabilen Schlüssel (`ReportTableColumn.key`). */
  | { kind: 'column'; id: ReportBaukastenId; column: string }

/**
 * Die zwei Platzhalter, die ein Verweis-Wortlaut kennt.
 *
 * ⚠ DER WORTLAUT IST DATEN UND KEINE FUNKTION, und das ist eine gemessene Entscheidung: mit einer
 * Rückruffunktion trägt jeder erzeugte Baustein eine Closure, und zwei strukturgleiche Bausteine
 * sind nicht mehr strukturgleich. `registry.test.ts` vergleicht genau das — Registry gegen
 * Rendering-Pfad, `toEqual` — und schlug in 14 Fällen fehl, obwohl beide Wege denselben Text
 * ergaben. Als Zeichenkette bleibt ein Verweis vergleichbar, druckbar und später archivierbar.
 */
export const REF_PLACE = '{place}'
export const REF_LABEL = '{label}'

/**
 * Der Verweisname des Kapitels, in dem das Ziel steht — heute nur Kapitel 1
 * (`ReportSection.reference`, `content.ts`).
 *
 * ⚠ ER IST KEINE ORTSANGABE, SONDERN EIN NOMEN: der Artikel steht im Satz, weil die fünf
 * Verwendungen Nominativ, Genitiv und Dativ brauchen.
 *
 * ⚠ UND ER IST AN EINE BEDINGUNG GEKNÜPFT: trägt das Kapitel des Ziels keinen Verweisnamen, nimmt
 * der Verweis seine ERSATZFORMULIERUNG — als stünde das Ziel gar nicht da. Ohne diese Regel
 * entstünde beim Umzug eines Ziels „auf der Kapitel „Ladeverhalten"": ein Satz, der grammatisch
 * falsch ist und den niemand mehr als Verweisfehler erkennt. Ein Kapitel, das nicht in jedem
 * Report steht, bekommt deshalb bewusst keinen Namen (s. `content.ts`).
 */
export const REF_SECTION = '{section}'

export type ReportRef = {
  target: ReportRefTarget
  /**
   * Der Wortlaut, wenn das Ziel im Dokument steht. `{place}` wird durch die Ortsangabe ersetzt,
   * `{label}` durch den Namen des Ziels.
   */
  present: string
  /** Der Wortlaut, wenn nicht. `null` = der GANZE Text, der diesen Verweis trägt, entfällt. */
  absent: string | null
}

/**
 * B3-2a — ein Textstück, das im Dokument farblich ausgezeichnet wird.
 *
 * ⚠ ES TRÄGT KEINE FARBE, NUR DIE AUSZEICHNUNG. Welche daraus wird, entscheidet `document.tsx` am
 * Ton der Aussage — eine Palette in der Ableitung wäre die Trennung, die `statement.ts` im Kopf
 * beschreibt, von der falschen Seite her aufgehoben.
 *
 * ⚠ UND ES IST EIN GETIPPTES TEIL UND KEINE MARKE IM TEXT (s. Kopf): die naheliegende Fassung
 * wäre ein Teilstring, den der Renderer im aufgelösten Satz sucht — ein Tippfehler darin bliebe
 * dann eine stumme Nicht-Auszeichnung statt eines Übersetzungsfehlers.
 */
export type ReportAccent = { readonly accent: string }

export function accent(text: string): ReportAccent {
  return { accent: text }
}

/** Ein Text, der noch Verweise enthält. */
export type ReportTextParts = {
  readonly reportText: readonly (string | ReportRef | ReportAccent)[]
}

/**
 * Ein Textfeld des Baukastens.
 *
 * ⚠ Eine blosse Zeichenkette ist weiterhin gültig und bleibt die Regel: nur Texte MIT Verweis
 * werden zu `ReportTextParts`. Eine Umstellung aller 29 Stellen auf einmal wäre ein Umbau ohne
 * Rückfalllinie; migriert wird stellenweise (`Report_Baukasten_Stufe_D_Plan.md` §5).
 */
export type ReportText = string | ReportTextParts

/**
 * Das Tagged Template: `t\`… ${ref(…)} …\``
 *
 * ⚠ Ein eingesetzter `ReportTextParts` wird EINGEEBNET und bleibt kein eigener Text. Das ist der
 * Preis dafür, dass ein Satzteil als Variable gebaut werden kann (`relation` in `summary.ts`):
 * `absent: null` eines eingebetteten Verweises löscht danach den GANZEN Text, nicht nur seinen
 * Satzteil. Wer einen Satzteil für sich fallen lassen will, gibt dem Verweis eine Ersatzformulierung.
 */
export function t(
  strings: TemplateStringsArray,
  ...values: (string | ReportRef | ReportAccent | ReportTextParts)[]
): ReportTextParts {
  const parts: (string | ReportRef | ReportAccent)[] = []
  strings.forEach((literal, index) => {
    if (literal !== '') parts.push(literal)
    const value = values[index]
    if (value === undefined || value === '') return
    if (typeof value === 'string' || 'target' in value || 'accent' in value) parts.push(value)
    else parts.push(...value.reportText)
  })
  return { reportText: parts }
}

export function block(id: ReportBaukastenId): ReportRefTarget {
  return { kind: 'block', id }
}

export function amount(id: ReportBaukastenId): ReportRefTarget {
  return { kind: 'amount', id }
}

export function row(id: ReportBaukastenId, key: string): ReportRefTarget {
  return { kind: 'row', id, row: key }
}

export function column(id: ReportBaukastenId, key: string): ReportRefTarget {
  return { kind: 'column', id, column: key }
}

export function ref(target: ReportRefTarget, present: string, absent: string | null): ReportRef {
  return { target, present, absent }
}

/**
 * Die Beschreibung des zusammengestellten Dokuments, so weit ein Verweis sie braucht.
 *
 * ⚠ Sie wird EINMAL je Erzeugung gebildet (`layout.ts` → `render.tsx`) und ist über alle
 * Renderdurchläufe dieselbe — dieselbe Zusage wie bei Kontext, Bildern und Registry. Eine je
 * Durchlauf neu gebildete Beschreibung wäre dieselbe, solange niemand eine Ableitung ergänzt, die
 * nicht allein am Ergebnis hängt.
 */
export type ReportLayout = {
  /** Steht dieses Ziel in diesem Dokument? Bei `row`/`amount`: trägt der Baustein dieses Feld? */
  present: (target: ReportRefTarget) => boolean
  /** Die Ortsangabe, aus Sicht des verweisenden Bausteins `from`. */
  place: (from: string, target: ReportRefTarget) => string
  /**
   * Der Verweisname des Kapitels, in dem das Ziel steht — `null`, wenn es keinen trägt. S.
   * `REF_SECTION`.
   */
  section: (target: ReportRefTarget) => string | null
  /** Wie das Ziel heisst. Leer, wo es keinen Namen trägt. */
  label: (target: ReportRefTarget) => string
}

/**
 * Ein Stück aufgelösten Texts — B3-2a.
 *
 * ⚠ `accent` ist eine AUSZEICHNUNG und keine Farbe: was daraus wird, entscheidet der Renderer
 * (s. `ReportAccent`).
 */
export type ReportTextSegment = { text: string; accent: boolean }

/**
 * Löst einen Text gegen die Beschreibung auf und behält dabei die Auszeichnungen.
 *
 * ⚠ `from` ist der Baustein, in dem der Text STEHT — ohne ihn gibt es kein „oben": eine
 * Ortsangabe ist eine Aussage über ZWEI Bausteine, nicht über einen.
 */
export function resolveReportSegments(
  text: ReportText,
  layout: ReportLayout,
  from: string,
): ReportTextSegment[] {
  if (typeof text === 'string') return text === '' ? [] : [{ text, accent: false }]

  const out: ReportTextSegment[] = []
  /* Angrenzende Stücke gleicher Auszeichnung wachsen zusammen: sonst zerfiele ein Satz in so
     viele `<Text>` wie er Verweise hat, und react-pdf umbricht an jeder dieser Grenzen. */
  const push = (piece: string, marked: boolean) => {
    if (piece === '') return
    const last = out.at(-1)
    if (last && last.accent === marked) last.text += piece
    else out.push({ text: piece, accent: marked })
  }

  for (const part of text.reportText) {
    if (typeof part === 'string') {
      push(part, false)
      continue
    }
    if ('accent' in part) {
      push(part.accent, true)
      continue
    }
    /*
     * ⚠ ZWEI GRÜNDE FÜR DIE ERSATZFORMULIERUNG, UND DER ZWEITE IST DER LEISERE: das Ziel steht
     * nicht im Dokument — oder es steht da, aber nicht mehr in einem Kapitel, das der Satz beim
     * Namen nennen darf. Beides macht denselben Satz falsch, und beides führt deshalb zur selben
     * Ausweichfassung (s. `REF_SECTION`).
     */
    const named = layout.section(part.target)
    const nameable = !part.present.includes(REF_SECTION) || named !== null
    if (!layout.present(part.target) || !nameable) {
      /* `null` heisst: ohne dieses Ziel gibt es den ganzen Text nicht — s. Kopf. */
      if (part.absent === null) return []
      push(part.absent, false)
      continue
    }
    push(
      part.present
        .split(REF_PLACE)
        .join(layout.place(from, part.target))
        .split(REF_LABEL)
        .join(layout.label(part.target))
        .split(REF_SECTION)
        .join(named ?? ''),
      false,
    )
  }
  return out
}

/**
 * Derselbe Text als eine Zeichenkette — für alles, was ihn misst, vergleicht oder prüft.
 *
 * ⚠ Er läuft über dieselbe Auflösung und nicht über eine zweite daneben: zwei Fassungen liefen
 * beim nächsten Nachtrag auseinander, und die Abweichung fiele ausgerechnet dort auf, wo ein
 * Prüflauf grün bliebe und das Dokument anders aussähe.
 */
export function resolveReportText(text: ReportText, layout: ReportLayout, from: string): string {
  return resolveReportSegments(text, layout, from)
    .map((segment) => segment.text)
    .join('')
}
