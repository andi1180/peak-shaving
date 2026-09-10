/**
 * Der Gesprächsverlauf eines Projekts, READ-ONLY, für den Admin-Bereich (B24, zehnter Bauschritt).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE REGEL WIRD IMPORTIERT, NICHT NACHGEBAUT — und das ist der Kern dieser Datei
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WAS sichtbar ist, entscheidet `visibleTranscript` (`lib/project-chat/transcript.ts`) — dieselbe
 * Funktion, die die Kundenoberfläche benutzt. Sie ist eine ERLAUBNISLISTE auf zwei Ebenen (nur
 * `user`/`assistant`, und daraus nur `text`-Blöcke), und genau das ist der Grund, sie hier nicht
 * ein zweites Mal auszuschreiben:
 *
 *   – `tool_call`/`tool_result` tragen interne Feldnamen, Fehlercodes der Extraktoren und ROHWERTE
 *     aus Kundendokumenten — unbestätigt und ohne die Einordnung, die das Modell daneben daraus
 *     macht. Eine zweite, hier ausgeschriebene Fassung liefe beim nächsten Umbau auseinander, und
 *     dann sähe Martin eine Zahl, die der Kunde nie gesehen hat, oder umgekehrt.
 *   – Eine fünfte Rolle erschiene in einer Sperrliste von selbst. In der Erlaubnisliste nicht.
 *
 * ⚠ FOLGE, DIE BEIM LESEN MITZUDENKEN IST: Martin sieht hier GENAU DAS, WAS DER KUNDE SIEHT — und
 * bewusst nicht mehr. Das ist die richtige Grundlage, um eine Rückfrage zu beantworten (er soll auf
 * denselben Stand antworten, den der Kunde vor sich hat). Wer die interne Verdrahtung eines
 * Gesprächs untersuchen will, liest die Tabelle; eine Ansicht dafür ist ein eigener Vorgang mit
 * eigener Begründung und ausdrücklich nicht Teil dieses Schritts.
 *
 * ── WARUM NICHT `components/kalkulator/project-chat.tsx` WIEDERVERWENDET WIRD ───────────────────
 * Jene Komponente IST die Kundenoberfläche: `'use client'`, Eingabefeld, Datei-Upload,
 * Server-Action-Aufruf, optimistischer Zustand. Davon wird hier nichts gebraucht und nichts davon
 * darf hier passieren — ein Admin, der versehentlich in ein fremdes Gespräch schreibt, wäre die
 * teuerste denkbare Nebenwirkung dieser Seite. Wiederverwendet ist deshalb genau das, was
 * WIEDERVERWENDBAR ist und bereits herausgelöst war: die Regel (oben) und der Markdown-Renderer
 * (`ChatMarkdown`, seit PR #180 eine eigene Datei). Die Kunden-Chat-Oberfläche ist mit 0 Zeilen
 * Diff unangetastet.
 *
 * ── SERVER-KOMPONENTE ──────────────────────────────────────────────────────────────────────────
 * Kein `'use client'`: der Verlauf ist hier fertig und wächst nicht (es gibt kein Eingabefeld).
 * `ChatMarkdown` ist eine Client-Komponente und wird von hier aus gerendert — nur ihr Bündel geht
 * an den Browser, die Auswahl der sichtbaren Zeilen bleibt auf dem Server.
 */
import { ChatMarkdown } from '@/components/kalkulator/chat-markdown'
import { visibleTranscript } from '@/lib/project-chat/transcript'
import type { StoredChatMessage } from '@/lib/project-chat/ports'

export function ChatTranscript({ rows }: { rows: readonly StoredChatMessage[] }) {
  const entries = visibleTranscript(rows)

  if (entries.length === 0) {
    return (
      <p className="text-small text-text-muted">
        In diesem Projekt wurde noch nichts geschrieben — oder der Verlauf besteht ausschliesslich
        aus internen Schritten (Werkzeugaufrufe), die hier bewusst nicht gezeigt werden.
      </p>
    )
  }

  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry, index) => (
        /*
          Der Index ist hier der richtige Schlüssel: die Liste ist fertig und wird nie umsortiert —
          anders als in der Kundenoberfläche entsteht hier auch nichts hinzu.
        */
        <li
          key={index}
          className={entry.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
        >
          <div
            className={
              entry.role === 'user'
                ? 'max-w-[85%] rounded-lg bg-accent-subtle px-4 py-3'
                : 'max-w-[85%] rounded-lg bg-surface-sunken px-4 py-3'
            }
          >
            <p className="text-caption font-medium uppercase text-text-muted">
              {entry.role === 'user' ? 'Kunde' : 'Assistent'}
            </p>
            {/*
              ⚠ ZWEI DARSTELLUNGEN, WIE AUF DER KUNDENSEITE — und aus denselben Gründen.
              Die Antwort des Modells IST Markdown (es formatiert von sich aus, der System-Prompt
              sagt dazu nichts) und wird als solches gerendert. Die Nachricht des Kunden bleibt
              Plaintext mit `whitespace-pre-wrap`: er schreibt kein Markdown, und seine eigenen
              Zeichen — ein `*` in „3*5 kWh", eine Zeile, die mit „1." beginnt — würden seinen Satz
              sonst umformatieren. Was er getippt hat, muss dastehen, wie er es getippt hat; für
              eine Auskunft, auf die Martin gleich antwortet, ist genau das die Voraussetzung.
            */}
            {entry.role === 'user' ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-body text-ink">
                {entry.text}
              </p>
            ) : (
              <div className="mt-1">
                <ChatMarkdown text={entry.text} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
