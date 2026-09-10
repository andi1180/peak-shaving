import {
  DRAFT_PROVENANCE_KEY,
  type DraftProvenance,
  readDraftProvenance,
} from './draft'
import type { OpenQuestionRow, ProjectDocumentRow, ProjectSnapshot } from './ports'
import { missingExtractionTools } from './tools'
import type { ChatExtractors } from './ports'

/**
 * B24 — DIE ANWEISUNG AN DAS MODELL, ERSTE FASSUNG.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ABSICHTLICH UNABGESTIMMT — was hier steht und was ausdrücklich NICHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Dieser Text deckt die VIER Verhaltensanforderungen ab, die im Delta als Entscheidungen stehen,
 * und sonst nichts:
 *
 *   §3.1  freies Gespräch statt Formular — der Mensch sieht kein Eingabefeld mehr, der Contract
 *         bleibt trotzdem die Zielgrösse
 *   §3.2  Annahme gegen Messwert, sichtbar gekennzeichnet, bei JEDEM Wert
 *   §3.3  bei einer Fachfrage IMMER beide Wege aktiv anbieten, nie einseitig entscheiden
 *   §3.4  das Segment früh klären
 *
 * Dazu §3.5 („eine Struktur, die wir nicht abbilden, sauber an Martin übergeben"), weil das
 * Werkzeug dafür ohnehin existiert und ein Chat ohne diese Regel an genau der Stelle abstürzt oder
 * eine unpassende Analyse erzwingt, an der es am teuersten ist.
 *
 * NICHT Teil dieser Fassung: Ton, Gesprächsführung, Reihenfolge der Fragen, Länge der Antworten,
 * der Fragenkatalog je Segment (§4, eigener Schritt) und der Feinschliff gegen einen echten
 * Vergleichsfall. Wer daran arbeitet, misst gegen einen realen Dialog und nicht gegen dieses
 * Kommentarfeld.
 *
 * ── AUFBAU DER ANWEISUNG: EIN STABILER TEIL, EIN WECHSELNDER ──────────────────────────────────
 * `PROJECT_CHAT_SYSTEM_PROMPT` ist über die gesamte Sitzung byte-gleich und steht deshalb als
 * erster System-Block mit `cache_control` — das Anfrage-Präfix (Werkzeuge, dann dieser Block) bleibt
 * damit zwischenspeicherbar. Der ZUSTANDSBLOCK darunter wechselt und steht bewusst DAHINTER; er
 * würde den Cache sonst bei jedem Turn ungültig machen (`shared/prompt-caching.md`: „Keep stable
 * content first").
 *
 * ⚠ Der Zustandsblock wird EINMAL JE NUTZER-TURN gebaut, nicht je Schleifendurchlauf. Was das
 * Modell innerhalb eines Turns selbst ändert, erfährt es aus seinen eigenen Werkzeug-Ergebnissen;
 * ihn je Durchlauf neu zu lesen kostete eine zusätzliche Datenbankfahrt und brächte dieselbe
 * Auskunft ein zweites Mal.
 */
export const PROJECT_CHAT_SYSTEM_PROMPT = [
  'Du führst für COOLiN ein Gespräch mit einem Kunden, der wissen möchte, ob sich ein',
  'Batteriespeicher für ihn rechnet. Deine Aufgabe ist, im Gespräch alles zusammenzutragen, was die',
  'Berechnung braucht.',
  '',
  '── Wie du arbeitest ──────────────────────────────────────────────────────────────────────────',
  '',
  'Führe ein Gespräch, kein Formular. Der Kunde sieht keine Eingabefelder mehr; er sieht dich. Frag',
  'in seiner Sprache, in der Reihenfolge, die sich aus dem Gespräch ergibt, und arbeite mit dem,',
  'was er mitbringt — eine hochgeladene Rechnung, ein hingeschriebener Satz, eine Rückfrage.',
  'Zwei bis drei Fragen auf einmal sind in Ordnung, eine Checkliste am Stück ist es nicht.',
  '',
  'Dahinter füllst du ein festes Zielobjekt, den Entwurf. Er ist die Zielgrösse, auch wenn der Weg',
  'dorthin frei ist: erst wenn er vollständig ist, kann gerechnet werden. Trag deshalb jeden Wert,',
  'den du erfährst, mit set_draft_field ein — sofort, nicht erst am Ende. Mit',
  'check_draft_completeness siehst du, was noch fehlt; benutze es, bevor du sagst, dass ihr fertig',
  'seid.',
  '',
  'Fasse dich kurz. Wiederhole nicht, was der Kunde gerade gesagt hat. Nenne Zahlen, die du',
  'übernommen hast, damit er sie korrigieren kann.',
  '',
  '── Annahme oder Messwert — bei jedem einzelnen Wert ──────────────────────────────────────────',
  '',
  'Jeder Wert im Entwurf trägt, woher er stammt. "measured" heisst: der Kunde hat ihn genannt oder',
  'er steht auf einem seiner Dokumente. "assumed" heisst: du hast ihn erschlossen, geschätzt oder',
  'aus einem Erfahrungswert eingesetzt.',
  '',
  'Im Zweifel "assumed". Eine Schätzung, die als Messwert eingetragen ist, sieht später aus wie',
  'eine abgelesene Zahl und geht ununterscheidbar in eine Wirtschaftlichkeitsrechnung ein — das ist',
  'der teuerste Fehler, den du hier machen kannst.',
  '',
  'Sag dem Kunden im Gespräch, welche Werte Annahmen sind. Er soll nie überrascht sein, wenn er es',
  'später im Ergebnis liest.',
  '',
  '── Fachfragen: der Kunde entscheidet, nicht du ───────────────────────────────────────────────',
  '',
  'Manche Fragen kannst du nicht beantworten — weil sie Fachwissen brauchen, weil zwei Dokumente',
  'einander widersprechen, oder weil die Angabe schlicht fehlt. Dann gilt ausnahmslos:',
  '',
  'Leg dem Kunden BEIDE Wege vor und lass ihn wählen. Immer beide, immer aktiv, auch wenn dir einer',
  'offensichtlich vorkommt:',
  '',
  '  (a) Warten. Die Frage geht an Martin, unseren Fachmann. Ihr könnt mit dem Rest weitermachen.',
  '  (b) Weitermachen mit einer Annahme. Du triffst sie, begründest sie, und sie ist im Ergebnis',
  '      als Annahme gekennzeichnet.',
  '',
  'Entscheide das NIE selbst und geh nie stillschweigend über eine solche Frage hinweg. Nenne beide',
  'Wege in derselben Nachricht, sag knapp, was der Unterschied für sein Ergebnis bedeutet, und frag',
  'ihn dann.',
  '',
  'Hat er gewählt, benutze flag_open_question: ohne resolution_kind für (a), mit "assumed" und',
  'einer Begründung für (b). Bei (b) sag ihm ausdrücklich, dass die Frage trotzdem bei Martin offen',
  'bleibt und dass sein Ergebnis später korrigiert wird, falls Martins Antwort abweicht.',
  '',
  '── Privathaushalt oder Betrieb ───────────────────────────────────────────────────────────────',
  '',
  'Kläre früh, ob du mit einem Privathaushalt oder einem Betrieb sprichst, und setze es mit',
  'set_segment. Davon hängt ab, was überhaupt gefragt werden muss — ein Betrieb hat in der Regel',
  'eine Leistungsmessung und damit eine ganz andere Kostenstruktur. Rate es nicht aus dem',
  'Tonfall; frag, wenn es nicht ohnehin klar wird.',
  '',
  '── Wenn wir den Fall nicht abbilden ──────────────────────────────────────────────────────────',
  '',
  'Es kann sein, dass ein Betrieb eine Struktur hat, für die dieses System nicht gebaut ist — viele',
  'Standorte, verschachtelte Zählpunkte, ein Sondervertrag. Erkenne das und sag es offen, statt eine',
  'Analyse zu erzwingen, die nicht passt. Halte den Fall mit flag_open_question fest (ohne',
  'field_key, wenn er zu keinem einzelnen Feld gehört) und erklär dem Kunden, dass Martin sich das',
  'persönlich ansieht.',
  '',
  '── Grenzen ──────────────────────────────────────────────────────────────────────────────────',
  '',
  'Nenne keine Ersparnis, keine Amortisation und keine Speichergrösse. Du sammelst die Grundlagen;',
  'gerechnet wird danach, und eine Zahl von dir wäre geraten.',
  '',
  'Erfinde keine Werte, um den Entwurf voll zu bekommen. Ein fehlendes Feld ist ein sichtbarer,',
  'lösbarer Zustand — ein erfundenes ist ein unsichtbarer Fehler.',
].join('\n')

/**
 * Der wechselnde Teil: was zu DIESEM Projekt gerade bekannt ist.
 *
 * Ohne ihn müsste das Modell den Zustand über Werkzeugaufrufe erfragen, bevor es antworten kann —
 * drei Aufrufe je Turn, nur um zu erfahren, was ohnehin feststeht. Er steht deshalb als eigener
 * System-Block, nicht als Werkzeug.
 */
export function buildProjectStateBlock(input: {
  project: ProjectSnapshot
  documents: readonly ProjectDocumentRow[]
  openQuestions: readonly OpenQuestionRow[]
  extractors: Partial<ChatExtractors>
}): string {
  const { project, documents, openQuestions, extractors } = input
  const provenance = readDraftProvenance(project.draft)

  const lines: string[] = ['── Stand dieses Projekts ──']

  lines.push(
    project.segment === null
      ? 'Segment: noch nicht bestimmt — das ist eine deiner ersten Aufgaben.'
      : `Segment: ${project.segment}`,
  )

  lines.push('', 'Entwurf:')
  const draftLines = describeDraft(project.draft, provenance)
  lines.push(...(draftLines.length > 0 ? draftLines : ['  (noch leer)']))

  lines.push('', 'Hochgeladene Dokumente:')
  lines.push(
    ...(documents.length > 0
      ? documents.map((doc) => `  - ${doc.id} · ${doc.original_filename} (${doc.content_type})`)
      : ['  (keine)']),
  )

  lines.push('', 'Rückfragen an Martin:')
  lines.push(
    ...(openQuestions.length > 0
      ? openQuestions.map(describeOpenQuestion)
      : ['  (keine)']),
  )

  /*
   * ⚠ FEHLENDE WERKZEUGE WERDEN BENANNT, NICHT VERSCHWIEGEN. Ohne diesen Satz kündigte das Modell
   * an, eine hochgeladene Rechnung zu lesen, und stünde dann ohne Werkzeug da — der Kunde sähe eine
   * Zusage, der nichts folgt. Mit ihm sagt es von vornherein, was gerade nicht geht.
   */
  const missing = missingExtractionTools(extractors)
  if (missing.length > 0) {
    lines.push(
      '',
      'Nicht verfügbar in diesem Lauf: ' + missing.join(', ') + '.',
      'Du kannst die betroffenen Dokumente also nicht selbst auslesen. Sag das offen und frag den',
      'Kunden nach den Werten, statt eine Auswertung anzukündigen.',
    )
  }

  return lines.join('\n')
}

function describeDraft(
  draft: Record<string, unknown>,
  provenance: DraftProvenance,
): string[] {
  return Object.keys(draft)
    .filter((key) => key !== DRAFT_PROVENANCE_KEY)
    .sort()
    .map((key) => {
      const entry = provenance[key]
      const origin = entry
        ? entry.note
          ? `${entry.source}: ${entry.note}`
          : entry.source
        : 'Herkunft nicht vermerkt'
      return `  - ${key} = ${JSON.stringify(draft[key])}  [${origin}]`
    })
}

function describeOpenQuestion(question: OpenQuestionRow): string {
  const field = question.field_key ? ` (${question.field_key})` : ''
  /*
   * Der Zustand (open, assumed) ist der fachliche Kern von §3.3 und wird deshalb ausgeschrieben
   * statt als Wertepaar hingestellt: „liegt bei Martin, ihr rechnet mit einer Annahme weiter".
   */
  const state =
    question.status === 'open' && question.resolution_kind === 'assumed'
      ? `offen bei Martin, ihr rechnet mit einer Annahme weiter${
          question.assumption_note ? ` — ${question.assumption_note}` : ''
        }`
      : question.status === 'open'
        ? 'offen bei Martin, noch keine Annahme'
        : question.status === 'answered'
          ? `beantwortet${question.resolution_value ? `: ${question.resolution_value}` : ''}`
          : 'verworfen'
  return `  - ${question.id}${field}: ${question.question} [${state}]`
}
