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

/** Ein Text, der noch Verweise enthält. */
export type ReportTextParts = { readonly reportText: readonly (string | ReportRef)[] }

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
  ...values: (string | ReportRef | ReportTextParts)[]
): ReportTextParts {
  const parts: (string | ReportRef)[] = []
  strings.forEach((literal, index) => {
    if (literal !== '') parts.push(literal)
    const value = values[index]
    if (value === undefined || value === '') return
    if (typeof value === 'string' || 'target' in value) parts.push(value)
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
  /** Wie das Ziel heisst. Leer, wo es keinen Namen trägt. */
  label: (target: ReportRefTarget) => string
}

/**
 * Löst einen Text gegen die Beschreibung auf.
 *
 * ⚠ `from` ist der Baustein, in dem der Text STEHT — ohne ihn gibt es kein „oben": eine
 * Ortsangabe ist eine Aussage über zwei Bausteine, nicht über einen.
 */
export function resolveReportText(text: ReportText, layout: ReportLayout, from: string): string {
  if (typeof text === 'string') return text

  let out = ''
  for (const part of text.reportText) {
    if (typeof part === 'string') {
      out += part
      continue
    }
    if (!layout.present(part.target)) {
      /* `null` heisst: ohne dieses Ziel gibt es den ganzen Text nicht — s. Kopf. */
      if (part.absent === null) return ''
      out += part.absent
      continue
    }
    out += part.present
      .split(REF_PLACE)
      .join(layout.place(from, part.target))
      .split(REF_LABEL)
      .join(layout.label(part.target))
  }
  return out
}
