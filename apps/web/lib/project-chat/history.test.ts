import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'

import { assistantText, splitAssistantTurn, toApiMessages } from './history'
import type { StoredChatMessage } from './ports'

/**
 * B24 — DAS WIEDEREINSPIELEN DES VERLAUFS.
 *
 * Die Migration stellt an diesen Schritt eine ausdrückliche Auflage („aufeinanderfolgende Zeilen
 * müssen wieder zu API-Nachrichten ZUSAMMENGEFASST werden"), und sie ist keine Formsache: die
 * Messages-API verlangt, dass auf `tool_use` im selben Zug die passenden `tool_result` folgen.
 * Zerlegt man sie, lehnt die API ab — und weil es in dieser Ablage kein `update` und kein `delete`
 * gibt, wäre das Projekt danach dauerhaft unbenutzbar.
 */

function text(t: string): Anthropic.ContentBlockParam[] {
  return [{ type: 'text', text: t }]
}

const TOOL_USE: Anthropic.ContentBlockParam[] = [
  { type: 'tool_use', id: 'tu_1', name: 'set_segment', input: { segment: 'betrieb' } },
]

const TOOL_RESULT: Anthropic.ContentBlockParam[] = [
  { type: 'tool_result', tool_use_id: 'tu_1', content: '{"segment":"betrieb"}' },
]

describe('toApiMessages', () => {
  it('⚠ fasst assistant + tool_call zu EINER Assistenten-Nachricht zusammen', () => {
    const rows: StoredChatMessage[] = [
      { role: 'user', content: text('Wir sind eine Bäckerei.') },
      { role: 'assistant', content: text('Verstanden, ich trage das ein.') },
      { role: 'tool_call', content: TOOL_USE },
      { role: 'tool_result', content: TOOL_RESULT },
      { role: 'assistant', content: text('Erledigt. Wie hoch ist Ihr Arbeitspreis?') },
    ]

    const messages = toApiMessages(rows)

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    // Text UND Aufruf in EINER Nachricht, in Zeilenreihenfolge.
    expect(messages[1]?.content).toEqual([...text('Verstanden, ich trage das ein.'), ...TOOL_USE])
    // Und das Ergebnis steht als Nutzer-Nachricht dahinter — genau das verlangt die API.
    expect(messages[2]?.content).toEqual(TOOL_RESULT)
  })

  it('⚠ verschmilzt ein tool_result mit der DARAUFFOLGENDEN Nutzer-Eingabe, Ergebnis zuerst', () => {
    /*
     * Der Fall entsteht real nach einem Abbruch an der Werkzeug-Obergrenze: der Verlauf endet mit
     * Ergebnissen, und der nächste Turn hängt eine Nutzer-Nachricht an. Die API verlangt, dass die
     * tool_result-Blöcke vorn stehen — das ergibt sich aus der Sortierung („älteste zuerst") von
     * selbst, und genau das wird hier gemessen.
     */
    const rows: StoredChatMessage[] = [
      { role: 'tool_call', content: TOOL_USE },
      { role: 'tool_result', content: TOOL_RESULT },
      { role: 'user', content: text('Und weiter?') },
    ]

    const messages = toApiMessages(rows)

    expect(messages.map((m) => m.role)).toEqual(['assistant', 'user'])
    expect(messages[1]?.content).toEqual([...TOOL_RESULT, ...text('Und weiter?')])
  })

  it('überspringt Zeilen ohne Blöcke, statt eine leere Nachricht zu bauen', () => {
    const messages = toApiMessages([
      { role: 'user', content: [] },
      { role: 'user', content: text('Hallo') },
    ])
    expect(messages).toEqual([{ role: 'user', content: text('Hallo') }])
  })

  it('lässt mehrere Werkzeugergebnisse in EINER Nachricht', () => {
    const two: Anthropic.ContentBlockParam[] = [
      { type: 'tool_result', tool_use_id: 'a', content: '{}' },
      { type: 'tool_result', tool_use_id: 'b', content: '{}' },
    ]
    const messages = toApiMessages([{ role: 'tool_result', content: two }])
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toHaveLength(2)
  })
})

describe('splitAssistantTurn', () => {
  it('⚠ gibt alles ausser tool_use als assistant zurück — Denk-Blöcke inbegriffen', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig-abc' },
      { type: 'text', text: 'Ich trage das ein.' },
      { type: 'tool_use', id: 'tu_1', name: 'set_segment', input: {} },
    ] as unknown as Anthropic.ContentBlock[]

    const rows = splitAssistantTurn(content)

    expect(rows.map((r) => r.role)).toEqual(['assistant', 'tool_call'])
    // Der Denk-Block reist VERBATIM mit, samt Signatur — er wird nicht aussortiert und nicht neu
    // gebaut; die API verlangt ihn auf demselben Modell unverändert zurück.
    expect(rows[0]?.content).toHaveLength(2)
    expect(rows[0]?.content[0]).toEqual(content[0])
    expect(rows[1]?.content).toEqual([content[2]])
  })

  it('erzeugt keine Zeile ohne Blöcke — der Wrapper wiese sie ab', () => {
    const onlyTool = [
      { type: 'tool_use', id: 'tu_1', name: 'x', input: {} },
    ] as unknown as Anthropic.ContentBlock[]
    expect(splitAssistantTurn(onlyTool).map((r) => r.role)).toEqual(['tool_call'])
    expect(splitAssistantTurn([])).toEqual([])
  })
})

describe('assistantText', () => {
  it('liefert nur den sichtbaren Text, nie die Gedankenführung', () => {
    const content = [
      { type: 'thinking', thinking: 'nicht für den Kunden', signature: 's' },
      { type: 'text', text: 'Guten Tag. ' },
      { type: 'text', text: 'Wie kann ich helfen?' },
    ] as unknown as Anthropic.ContentBlock[]
    expect(assistantText(content)).toBe('Guten Tag. Wie kann ich helfen?')
  })
})
