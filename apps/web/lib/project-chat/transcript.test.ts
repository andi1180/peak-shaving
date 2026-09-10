import { describe, expect, it } from 'vitest'

import type { StoredChatMessage } from './ports'
import { visibleTranscript } from './transcript'

/**
 * B24 achter Bauschritt — der Wächter gegen die eine Sorte Leck, die diese Oberfläche haben kann:
 * interne Verdrahtung im sichtbaren Gespräch.
 *
 * Der Verlauf unten ist der ECHTE Ablauf eines Turns mit Werkzeugbenutzung (die Reihenfolge, die
 * `agent.ts` erzeugt: Nutzer → Text → `tool_call` → `tool_result` → Text), und die
 * Werkzeug-Zeilen tragen absichtlich genau das, was ein Kunde nie lesen soll: einen internen
 * Feldnamen und einen Fehlercode.
 */
const HISTORY: StoredChatMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'Hallo, ich habe eine Bäckerei.' }] },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Segment ist offenbar Betrieb.', signature: 'sig-1' },
      { type: 'text', text: 'Guten Tag! Ich sehe Ihre Rechnung — einen Moment.' },
    ],
  },
  {
    role: 'tool_call',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'extract_invoice',
        input: { document_ids: ['11111111-1111-4111-8111-111111111111'] },
      },
    ],
  },
  {
    role: 'tool_result',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: [
          {
            type: 'text',
            text: '{"energyPriceCtPerKwh":24.4,"_provenance":{"source":"measured"},"error":"unreadable"}',
          },
        ],
      },
    ],
  },
  { role: 'assistant', content: [{ type: 'text', text: 'Ihr Arbeitspreis liegt bei 24,4 ct/kWh.' }] },
]

describe('visibleTranscript', () => {
  it('zeigt ausschliesslich user- und assistant-Text — tool_call und tool_result kommen NICHT vor', () => {
    const entries = visibleTranscript(HISTORY)

    expect(entries.map((entry) => entry.role)).toEqual(['user', 'assistant', 'assistant'])

    /*
     * ⚠ Die Rollen allein genügen als Nachweis NICHT: ein Filter, der die Werkzeug-Zeilen
     * versehentlich als `assistant` durchreichte, ergäbe dieselbe Zahl von Einträgen wie ein
     * kaputter Filter, der die Blöcke einer Werkzeug-Zeile in eine Sprechblase kippt. Geprüft wird
     * deshalb der ausgelieferte TEXT: keine Kennung, kein Werkzeugname, kein Feldname, kein
     * Fehlercode.
     */
    const rendered = entries.map((entry) => entry.text).join('\n')
    for (const forbidden of [
      'extract_invoice',
      'toolu_1',
      'energyPriceCtPerKwh',
      '_provenance',
      'unreadable',
      '11111111-1111-4111-8111-111111111111',
    ]) {
      expect(rendered).not.toContain(forbidden)
    }
  })

  it('lässt Denk-Blöcke weg, behält aber den Text derselben Zeile', () => {
    const texts = visibleTranscript(HISTORY).map((entry) => entry.text)
    expect(texts[1]).toBe('Guten Tag! Ich sehe Ihre Rechnung — einen Moment.')
    expect(texts[1]).not.toContain('Segment ist offenbar Betrieb.')
  })

  it('erzeugt keine leere Sprechblase für eine Zeile ohne sichtbaren Text', () => {
    const entries = visibleTranscript([
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'nur gedacht', signature: 's' }] },
      { role: 'assistant', content: [] },
      { role: 'user', content: [{ type: 'text', text: '   ' }] },
    ])
    expect(entries).toEqual([])
  })

  it('verschmilzt aufeinanderfolgende Zeilen derselben Seite NICHT', () => {
    // Der reale Fall: das Modell sagt etwas, ruft ein Werkzeug, sagt danach etwas anderes.
    const texts = visibleTranscript(HISTORY).map((entry) => entry.text)
    expect(texts[1]).not.toContain('24,4')
    expect(texts[2]).toBe('Ihr Arbeitspreis liegt bei 24,4 ct/kWh.')
  })

  it('zeigt vom Anhang-Vermerk NICHTS — Kennung, Dateiname und Marker bleiben aus dem Gespräch', () => {
    /*
     * Der Vertrag aus `agent.ts`: Block 0 sind die Worte des Menschen, Block 1 ist der maschinell
     * angehängte Kontext dieses Turns. Geprüft wird beides — dass die Worte ANKOMMEN und dass der
     * Vermerk NICHT ankommt; ein Test nur auf das Zweite bliebe auch dann grün, wenn die Zeile
     * ganz verschwände.
     */
    const entries = visibleTranscript([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hier ist meine Jahresrechnung.' },
          {
            type: 'text',
            text:
              '[Neu hochgeladen in diesem Turn]\n' +
              '  - 22222222-2222-4222-8222-222222222222 · rechnung-2025.pdf (application/pdf)',
          },
        ],
      },
    ])

    expect(entries).toEqual([{ role: 'user', text: 'Hier ist meine Jahresrechnung.' }])
    const rendered = entries.map((entry) => entry.text).join('\n')
    expect(rendered).not.toContain('22222222-2222-4222-8222-222222222222')
    expect(rendered).not.toContain('rechnung-2025.pdf')
    expect(rendered).not.toContain('Neu hochgeladen')
  })

  it('kürzt eine ASSISTENTEN-Zeile mit mehreren Textblöcken NICHT', () => {
    // Die Ein-Block-Regel gilt ausschliesslich für `user`. Ein Modell darf seine Antwort auf
    // mehrere Blöcke verteilen — verschwände der zweite, fehlte dem Kunden die halbe Auskunft.
    const entries = visibleTranscript([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Erster Teil. ' },
          { type: 'text', text: 'Zweiter Teil.' },
        ],
      },
    ])
    expect(entries).toEqual([{ role: 'assistant', text: 'Erster Teil. Zweiter Teil.' }])
  })

  it('ist eine ERLAUBNISLISTE — eine unbekannte Rolle erscheint nicht von selbst', () => {
    const entries = visibleTranscript([
      // Es gibt heute keine fünfte Rolle. Käme eine dazu, soll sie NICHT stillschweigend im
      // Gespräch des Kunden landen, nur weil sie Text trägt.
      { role: 'system_note' as never, content: [{ type: 'text', text: 'interner Vermerk' }] },
      { role: 'user', content: [{ type: 'text', text: 'sichtbar' }] },
    ])
    expect(entries).toEqual([{ role: 'user', text: 'sichtbar' }])
  })
})
