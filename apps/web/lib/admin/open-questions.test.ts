import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  OPEN_QUESTIONS_PROJECT_HREF,
  OPEN_QUESTION_FILTER_ALL,
  QUESTION_ANCHOR,
  hasStandingAssumption,
  questionAgeInDays,
  readAdminProject,
  readOpenQuestionQueue,
  readProjectMessages,
  readProjectQuestions,
} from './open-questions'

/**
 * B24 (zehnter Bauschritt) — die Leser und Regeln des Rückfragen-Eingangs.
 *
 * Was hier geprüft wird, ist ausschliesslich das, was sich OHNE Datenbank und OHNE Renderer
 * entscheiden lässt. Das Verhalten der Wrapper selbst (Sortierung, `is_admin()`, `invalid_filter`,
 * dass eine Annahme beim Beantworten stehen bleibt) ist B24 zweiter Bauschritt und liegt im
 * DB-Gate (`packages/db-tests/src/project-chat-state.test.ts`) — dort läuft es gegen eine echte
 * Datenbank statt gegen eine Behauptung über sie.
 */

describe('B24 — Leser des Rückfragen-Eingangs', () => {
  it('unterscheidet „nicht geladen" von „nichts offen" — die teuerste Verwechslung dieser Seite', () => {
    // Eine LEERE Warteschlange ist der erwünschte Normalzustand („nichts liegt an"). Ein
    // gescheiterter Lesevorgang ist das Gegenteil. Gleich dargestellt wäre ein Ausfall unsichtbar.
    expect(readOpenQuestionQueue({ status: 'ok', total: 0, questions: [] })).toEqual({
      total: 0,
      questions: [],
    })
    expect(readOpenQuestionQueue(null)).toBeNull()
    expect(readOpenQuestionQueue({ status: 'error' })).toBeNull()
    expect(readOpenQuestionQueue('kaputt')).toBeNull()
  })

  it('meldet einen abgewiesenen Statusfilter als eigenen Zustand', () => {
    // Sonst hielte man ein ungefiltertes Ergebnis für ein gefiltertes.
    expect(readOpenQuestionQueue({ status: 'invalid_filter', filter: 'status' })).toBe(
      'invalid_filter',
    )
  })

  it('⚠ sortiert die Warteschlange NICHT nach — der Wrapper liefert älteste zuerst', () => {
    /*
     * `admin_list_open_questions` sortiert `created_at` AUFSTEIGEND, entgegen der Gewohnheit jedes
     * anderen `admin_list_*` dieses Repos. Ein `sort()` im Leser nähme diese Entscheidung zurück —
     * und zwar unbemerkt, weil beide Reihenfolgen plausibel aussehen.
     */
    const queue = readOpenQuestionQueue({
      status: 'ok',
      total: 3,
      questions: [
        { id: 'alt', created_at: '2026-01-01T00:00:00Z' },
        { id: 'mittel', created_at: '2026-06-01T00:00:00Z' },
        { id: 'neu', created_at: '2026-09-01T00:00:00Z' },
      ],
    })

    expect(queue).not.toBeNull()
    expect(queue).not.toBe('invalid_filter')
    if (queue === null || queue === 'invalid_filter') return
    expect(queue.questions.map((q) => q.id)).toEqual(['alt', 'mittel', 'neu'])
  })

  it('trennt „gibt es nicht" von „nicht geladen" bei Projekt, Fragen und Verlauf', () => {
    expect(readAdminProject({ status: 'not_found' })).toBe('not_found')
    expect(readAdminProject({ status: 'boom' })).toBeNull()
    expect(readProjectQuestions({ status: 'not_found' })).toBe('not_found')
    expect(readProjectQuestions({ status: 'boom' })).toBeNull()
    expect(readProjectMessages({ status: 'not_found' })).toBe('not_found')
    expect(readProjectMessages({ status: 'boom' })).toBeNull()
  })

  it('liest den Projektkopf aus dem verschachtelten Feld', () => {
    const head = readAdminProject({
      status: 'ok',
      project: { id: 'p1', customer_label: 'Hotel Alpenblick', account_id: null },
    })
    expect(head).not.toBeNull()
    if (head === null || head === 'not_found') return
    expect(head.customer_label).toBe('Hotel Alpenblick')
  })
})

describe('B24 — der Verlauf ist erkennbar gekürzt, statt still', () => {
  it('führt `total` getrennt von der Zahl der gelieferten Zeilen', () => {
    /*
     * `list_project_messages` deckelt bei 500 und liefert die ÄLTESTEN zuerst — ein längeres
     * Gespräch verlöre also sein ENDE, ausgerechnet die Turns, aus denen die Rückfrage entstand.
     * Ohne diese zwei getrennten Zahlen könnte die Seite das nicht sagen.
     */
    const transcript = readProjectMessages({
      status: 'ok',
      total: 800,
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hallo' }] }],
    })

    expect(transcript).not.toBeNull()
    if (transcript === null || transcript === 'not_found') return
    expect(transcript.total).toBe(800)
    expect(transcript.messages).toHaveLength(1)
    expect(transcript.total).toBeGreaterThan(transcript.messages.length)
  })

  it('reicht nur Rolle und Inhalt durch — nicht Kennung, Projekt und Zeitstempel', () => {
    const transcript = readProjectMessages({
      status: 'ok',
      total: 1,
      messages: [
        {
          id: 'm1',
          project_id: 'p1',
          created_at: '2026-09-01T10:00:00Z',
          role: 'assistant',
          content: [{ type: 'text', text: 'Guten Tag' }],
        },
      ],
    })

    if (transcript === null || transcript === 'not_found') throw new Error('nicht gelesen')
    expect(Object.keys(transcript.messages[0]!).sort()).toEqual(['content', 'role'])
  })
})

describe('B24 — Weg (b): eine Annahme lässt die Frage OFFEN (Delta §3.3)', () => {
  /*
   * ⚠ DIE REGEL, DIE DIESE OBERFLÄCHE ERSTMALS SICHTBAR MACHT — und die einzige, die man beim
   * Lesen des Status falsch versteht: `resolve_open_question('assumed')` lässt `status` auf `open`
   * STEHEN. Der Chat rechnet mit der Annahme weiter UND die Frage wartet trotzdem auf Martin.
   */
  it('erkennt eine stehende Annahme an offener Frage', () => {
    expect(hasStandingAssumption({ status: 'open', resolution_kind: 'assumed' })).toBe(true)
  })

  it('ist NICHT bloss eine Prüfung auf `resolution_kind` — beantwortet zählt nicht mehr', () => {
    // Nach Martins Antwort bleibt die Annahme in der Zeile stehen (der Wrapper fasst
    // `assumption_note` nicht an). Sie ist dann Beleg, kein laufender Zustand.
    expect(hasStandingAssumption({ status: 'answered', resolution_kind: 'assumed' })).toBe(false)
    expect(hasStandingAssumption({ status: 'answered', resolution_kind: 'answered' })).toBe(false)
  })

  it('meldet eine schlicht unbeantwortete Frage NICHT als Annahme', () => {
    expect(hasStandingAssumption({ status: 'open', resolution_kind: null })).toBe(false)
  })
})

describe('B24 — Alter einer Rückfrage', () => {
  const now = new Date('2026-09-10T12:00:00Z')

  it('rechnet in ganzen Tagen gegen einen ÜBERGEBENEN Stichtag', () => {
    // `now` ist Pflichtparameter: eine Funktion, die selbst auf die Uhr sieht, lässt sich nicht
    // gegen einen Stichtag prüfen (Regel aus `standardProfileYear`, B21-3a).
    expect(questionAgeInDays('2026-09-10T11:00:00Z', now)).toBe(0)
    expect(questionAgeInDays('2026-09-07T12:00:00Z', now)).toBe(3)
    expect(questionAgeInDays('2026-08-11T12:00:00Z', now)).toBe(30)
  })

  it('liefert bei unlesbarem Zeitstempel `null` und nicht 0 — das hiesse „heute"', () => {
    expect(questionAgeInDays('gestern', now)).toBeNull()
  })

  it('macht aus einem Zeitstempel in der Zukunft kein negatives Alter', () => {
    expect(questionAgeInDays('2026-12-01T00:00:00Z', now)).toBe(0)
  })
})

describe('B24 — Pfade', () => {
  it('verlinkt eine Frage über ihr PROJEKT plus Sprungmarke', () => {
    // Die Warteschlange ist nach Fragen sortiert, die Detailseite nach Projekt geschlüsselt (es
    // gibt keinen Wrapper, der EINE Frage liest). Der Anker schliesst die Lücke.
    expect(OPEN_QUESTIONS_PROJECT_HREF('p1', 'q7')).toBe('/admin/rueckfragen/p1#frage-q7')
    expect(OPEN_QUESTIONS_PROJECT_HREF('p1')).toBe('/admin/rueckfragen/p1')
  })

  it('bildet die Sprungmarke an EINER Stelle — Link und Ziel können nicht auseinanderlaufen', () => {
    expect(OPEN_QUESTIONS_PROJECT_HREF('p1', 'q7')).toContain(`#${QUESTION_ANCHOR('q7')}`)
  })

  it('⚠ hält „Alle" als LEEREN Filterwert fest, nicht als weggelassenen', () => {
    /*
     * `admin_list_open_questions(p_status text default 'open', …)`: ein weggelassener Parameter
     * heisst dort „nur offene", NICHT „alle". Der Rumpf macht aus dem leeren String über
     * `nullif(btrim(…), '')` den fehlenden Filter. Die Konstante hält diese Unterscheidung fest.
     */
    expect(OPEN_QUESTION_FILTER_ALL).toBe('')
  })
})

/**
 * ⚠ DER KONTEXT-VERLAUF BENUTZT DIE GETEILTE REGEL — er baut sie nicht nach.
 *
 * `apps/web` hat bewusst KEIN Renderer-Setup (`vitest.config.ts`: „ein Renderer-Setup ist hier
 * NICHT eingerichtet und soll es auch nicht beiläufig werden"), das gerenderte Ergebnis lässt sich
 * hier also nicht prüfen — dafür gibt es den Live-Lauf. Prüfbar und hier wichtiger ist die
 * Eigenschaft des QUELLTEXTS: dass die Auswahl der sichtbaren Zeilen aus
 * `lib/project-chat/transcript.ts` kommt und nicht ein zweites Mal ausgeschrieben ist.
 *
 * Was `visibleTranscript` selbst leistet (Erlaubnisliste auf zwei Ebenen, keine `tool_call`/
 * `tool_result`, kein Anhang-Vermerk, keine Denk-Blöcke), ist in `lib/project-chat/transcript.test.ts`
 * gemessen — dieselbe Funktion, dieselben Tests, kein zweiter Beweis nötig. Genau darum geht es.
 */
describe('B24 — die Verlaufs-Regel wird importiert, nicht nachgebaut', () => {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '..', '..', 'components', 'admin', 'chat-transcript.tsx'),
    'utf8',
  )

  /*
   * Kommentare raus, BEVOR der Quelltext geprüft wird. Ohne das entstünde ein Test, der das
   * ERKLÄREN der Regel bestraft — die Datei begründet ja ausführlich, warum `tool_call` und
   * `tool_result` nicht gezeigt werden, und nennt beide dabei wörtlich. Genau diese Falle ist in
   * B11 schon einmal zugeschlagen (`packages/engine/src/tariff/no-catalog-dependency.test.ts`).
   */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('zieht `visibleTranscript` aus dem geteilten Modul', () => {
    expect(code).toMatch(/import\s*\{\s*visibleTranscript\s*\}\s*from\s*'@\/lib\/project-chat\/transcript'/)
  })

  it('filtert nirgends selbst nach Rollen — die Erlaubnisliste hat genau EINEN Ort', () => {
    // Eine zweite, hier ausgeschriebene Fassung liefe beim nächsten Umbau auseinander: dann sähe
    // der Admin eine Zeile, die der Kunde nie gesehen hat, oder umgekehrt.
    expect(code).not.toContain('tool_call')
    expect(code).not.toContain('tool_result')
  })

  it('rendert den Antworttext über denselben Markdown-Baustein wie die Kundenseite', () => {
    expect(code).toMatch(/from\s*'@\/components\/kalkulator\/chat-markdown'/)
  })

  it('ist KEINE Client-Komponente — die Auswahl der Zeilen bleibt auf dem Server', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(false)
  })
})
