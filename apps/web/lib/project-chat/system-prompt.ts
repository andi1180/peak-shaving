import {
  DRAFT_PROVENANCE_KEY,
  type DraftProvenance,
  readDraftProvenance,
} from './draft'
import type {
  MeteringPointRow,
  OpenQuestionRow,
  ProjectDocumentRow,
  ProjectSnapshot,
} from './ports'
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
 *
 * ── DIE ADMIN-ERWEITERUNG WIRD ANGEHÄNGT, NIE EINGEWOBEN ──────────────────────────────────────
 * `composeSystemPrompt` hängt den gepflegten Text (Delta §4.3) HINTER den Kern-Prompt in DENSELBEN
 * ersten Block. Der Kern bleibt dabei byte-gleich erhalten — er trägt die vier
 * Verhaltensanforderungen aus §3.1–§3.4, und die sind nicht zur Disposition eines Textfelds.
 * Gibt es keine Erweiterung (der Normalzustand, solange niemand eine gepflegt hat), ist das
 * Ergebnis BIT-IDENTISCH zu `PROJECT_CHAT_SYSTEM_PROMPT`.
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
  'Bei einem Betrieb halte ausserdem die Branche mit set_industry fest, sobald sie im Gespräch klar',
  'wird — davon hängt ab, welche zusätzlichen Fragen zu diesem Fall gehören. Auch hier gilt: nicht',
  'raten. Ein Privathaushalt hat keine Branche; frag dort nicht danach.',
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
 * Die eine Zeile, die den Kern von der Erweiterung trennt.
 *
 * ⚠ Sie ist nicht Dekoration: der angehängte Text ist ADMIN-VERFASST und soll für das Modell
 * erkennbar eine Ergänzung sein und keine Fortsetzung der Regeln darüber. Ohne die Trennlinie
 * verschmölzen beide zu einem Fliesstext, in dem eine Zeile der Erweiterung wie ein Widerruf einer
 * Kernregel gelesen werden könnte.
 */
const EXTENSION_HEADING = [
  '',
  '── Ergänzungen von COOLiN ─────────────────────────────────────────────────────────────────────',
  '',
  'Die folgenden Hinweise pflegt COOLiN selbst. Sie ERGÄNZEN die Regeln oben und heben keine davon',
  'auf — bei einem Widerspruch gilt, was oben steht.',
  '',
].join('\n')

/**
 * Setzt den Anweisungs-Block dieses Turns zusammen: Kern, dann (falls vorhanden) die Erweiterung.
 *
 * ⚠ REIHENFOLGE IST DIE ZUSAGE. Der Kern steht IMMER zuerst und IMMER vollständig; die Erweiterung
 * kann ihn nur verlängern, nie ersetzen oder ihm vorangehen. Deshalb ist das eine Funktion und
 * keine Zeile am Aufrufort — dort liesse sich die Reihenfolge beim nächsten Umbau versehentlich
 * drehen, und niemand sähe es an der Ausgabe.
 *
 * Ein leerer oder nur aus Leerzeichen bestehender Text zählt als „keine Erweiterung": eine
 * Überschrift ohne Inhalt wäre eine Ankündigung, der nichts folgt.
 */
export function composeSystemPrompt(extension: string | null): string {
  const text = extension?.trim() ?? ''
  if (text === '') return PROJECT_CHAT_SYSTEM_PROMPT
  return `${PROJECT_CHAT_SYSTEM_PROMPT}\n${EXTENSION_HEADING}${text}`
}

/**
 * Der wechselnde Teil: was zu DIESEM Projekt gerade bekannt ist.
 *
 * Ohne ihn müsste das Modell den Zustand über Werkzeugaufrufe erfragen, bevor es antworten kann —
 * drei Aufrufe je Turn, nur um zu erfahren, was ohnehin feststeht. Er steht deshalb als eigener
 * System-Block, nicht als Werkzeug.
 */
export function buildProjectStateBlock(input: {
  project: ProjectSnapshot
  meteringPoints: readonly MeteringPointRow[]
  documents: readonly ProjectDocumentRow[]
  openQuestions: readonly OpenQuestionRow[]
  extractors: Partial<ChatExtractors>
}): string {
  const { project, meteringPoints, documents, openQuestions, extractors } = input

  const lines: string[] = ['── Stand dieses Projekts ──']

  lines.push(
    project.segment === null
      ? 'Segment: noch nicht bestimmt — das ist eine deiner ersten Aufgaben.'
      : `Segment: ${project.segment}`,
  )

  /*
   * ⚠ EINE GESETZTE BRANCHE WIRD IMMER GENANNT, auch wenn sie nicht zum Segment passt.
   *
   * Der Fall entsteht real: die Branche wird gesetzt, solange das Projekt `betrieb` ist, und
   * überlebt eine spätere Korrektur auf `privat` (die Datenbank nullt sie bewusst nicht — das wäre
   * eine stille Löschung, s. Migration 20260910150000). Verschwiegen sähe der Zustand aus wie „keine
   * Branche"; benannt und als Widerspruch gekennzeichnet kann das Modell ihn ansprechen.
   */
  if (project.segment === 'betrieb') {
    lines.push(
      project.industry === null
        ? 'Branche: noch nicht bestimmt — mit set_industry festhalten, sobald sie im Gespräch klar wird.'
        : `Branche: ${project.industry}`,
    )
  } else if (project.industry !== null) {
    lines.push(
      `Branche: ${project.industry} (⚠ passt nicht zum Segment ${project.segment ?? 'unbestimmt'} —` +
        ' aus einer früheren Einordnung als Betrieb)',
    )
  }

  /*
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * ⚠ DER ENTWURF STEHT JE ZÄHLPUNKT, NICHT EINMAL FÜRS PROJEKT
   * ══════════════════════════════════════════════════════════════════════════════════════════════
   * Seit der Migration 20260911150000 hat jeder Zählpunkt seinen eigenen Entwurf — Tarif und
   * Vertrag hängen am Anschluss, nicht am Betrieb. Hier zu EINEM Block zusammengefasst sähe das
   * Modell einen Entwurf, den es so nirgends schreiben kann: `set_draft_field` verlangt eine
   * `metering_point_id`, und zwei Anschlüsse mit zwei Arbeitspreisen ergäben in einer Liste zwei
   * einander widersprechende Zeilen ohne Hinweis darauf, dass beide stimmen.
   *
   * Die Kennung steht deshalb an JEDER Überschrift: sie ist das Argument, das der nächste Aufruf
   * braucht, und ohne sie müsste das Modell erst `check_draft_completeness` rufen, um sie zu
   * erfahren.
   */
  lines.push('', 'Zählpunkte und ihre Entwürfe:')
  if (meteringPoints.length === 0) {
    /*
     * ⚠ Der Satz sagt ausdrücklich, dass das Modell das NICHT beheben kann. Es gibt kein Werkzeug,
     * das einen Zählpunkt anlegt (die Zahl der Zählpunkte entscheidet ein Mensch,
     * `admin_set_metering_point_count`) — ohne diesen Hinweis versuchte das Modell es und sagte dem
     * Kunden etwas zu, was es nicht einlösen kann.
     */
    lines.push(
      '  (noch keine angelegt — ohne Zählpunkt gibt es keinen Entwurf, den du füllen könntest.',
      '   Du kannst selbst keinen anlegen: sag es dem Kunden und halte es mit flag_open_question fest.)',
    )
  } else {
    meteringPoints.forEach((row, index) => {
      const coverage =
        row.interval_minutes === null
          ? 'noch kein Lastgang eingelesen'
          : `${row.interval_minutes}-min-Werte, ${row.covered_from} bis ${row.covered_to}` +
            `, ${row.gaps.length} Lücke(n)`
      lines.push(`  Zählpunkt ${index + 1} (${row.id}) — ${coverage}`)
      const draftLines = describeDraft(row.draft, readDraftProvenance(row.draft))
      lines.push(...(draftLines.length > 0 ? draftLines.map((line) => `  ${line}`) : ['    (noch leer)']))
    })
  }

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
