import type { ReportSection } from './content'

/**
 * B23a — die Agenda mit Seitenverweisen: der Zwei-Pass-Mechanismus.
 *
 * ── WARUM ES ÜBERHAUPT ZWEI DURCHLÄUFE BRAUCHT ─────────────────────────────────────────────────
 * `<Text render={({ pageNumber }) => …} />` löst JE ELEMENT zur Renderzeit auf und beantwortet
 * damit „auf welcher Seite steht DIESES Element". Es beantwortet NICHT „auf welcher Seite beginnt
 * Abschnitt X" — und die Agenda steht weiter VORNE als die Abschnitte, auf die sie verweist. Der
 * Spike hat diesen Punkt ausdrücklich als offen und als den härtesten benannt
 * (`PDF_RENDERING_SPIKE_…` §6 (a)).
 *
 * Der Weg ist deshalb: EINMAL rendern und dabei die Seitenzahlen einsammeln (das erzeugte PDF wird
 * verworfen), dann ein ZWEITES Mal mit den eingesammelten Zahlen in der Agenda.
 *
 * ── ⚠ DIE GEMESSENE GRENZE, UND SIE BESTIMMT DEN GANZEN DOKUMENTAUFBAU ─────────────────────────
 * Am 03.09.2026 gegen `@react-pdf/renderer` 4.9.0 in drei Läufen gemessen (Node, `renderToBuffer`,
 * Seitenzahl je über `/Count` im Seitenbaum gegengeprüft):
 *
 *   Aufbau A — EINE `<Page>`, Kapitel per `<View break>`:
 *     Dokument hat nachweislich 4 Seiten (`/Count 4`), die vier Sentinels melden aber
 *     `1, 1, 1, 1`.  ⇒ UNBRAUCHBAR.
 *
 *   Aufbau B — eine `<Page>` je Kapitel:
 *     Sentinels melden `2, 3, 5` bei `/Count 5` — inklusive des Falls, dass ein Kapitel über zwei
 *     Seiten läuft und das folgende dadurch verschiebt.  ⇒ TRÄGT.
 *
 *   Aufbau C — Sentinels für UNTERPUNKTE innerhalb einer umbrechenden `<Page>`:
 *     drei Unterpunkte, von denen zwei tatsächlich auf der Folgeseite landen, melden alle `2`.
 *     ⇒ UNBRAUCHBAR für Unterpunkte.
 *
 * Daraus folgen zwei bindende Regeln für alles, was diese Agenda künftig anfasst:
 *
 *   1. **Jedes Kapitel, das in der Agenda mit einer Seitenzahl steht, ist eine eigene `<Page>`.**
 *      Ein Kapitel per Seitenumbruch innerhalb einer bestehenden Seite bekäme still die Zahl der
 *      Seite, auf der jene Seite BEGANN — eine plausibel aussehende, falsche Zahl.
 *   2. **Unterpunkte (`level: 2`) bekommen KEINE Seitenzahl.** Sie stehen eingerückt unter ihrem
 *      Kapitel. Die Zahl des Kapitels für sie zu wiederholen wäre für jeden Unterpunkt falsch, der
 *      eine Seite weiter beginnt — und genau das ist der Regelfall bei sechs Absätzen.
 *
 * Eine Navigation über PDF-Outlines (`bookmark`-Prop, im Spike als Alternative genannt) ersetzt das
 * NICHT: sie erzeugt eine Klick-Navigation im Betrachter, aber keine gedruckte Seitenzahl — und der
 * Report wird ausgedruckt weitergereicht.
 */

/** Was ein Durchlauf einsammelt. */
export type PageNumberSink = {
  /** Abschnitts-Kennung → Seite, auf der der Abschnitt beginnt. */
  pages: Record<string, number>
  /** Gesamtseitenzahl, wie sie die Fusszeile gesehen hat. `0`, solange nichts gerendert wurde. */
  totalPages: number
}

export function createPageNumberSink(): PageNumberSink {
  return { pages: {}, totalPages: 0 }
}

/**
 * Nimmt die ERSTE Meldung je Kennung.
 *
 * Ein Sentinel kann mehrfach aufgerufen werden (react-pdf wertet `render` beim Umbrechen erneut
 * aus); massgeblich ist der Beginn des Abschnitts, also der kleinste Wert — und der kommt zuerst.
 * Ein blosses Überschreiben ergäbe bei einem umbrechenden Kapitel die LETZTE Seite statt der
 * ersten.
 */
export function recordSectionPage(sink: PageNumberSink, id: string, pageNumber: number): void {
  const seen = sink.pages[id]
  if (seen === undefined || pageNumber < seen) sink.pages[id] = pageNumber
}

export function recordTotalPages(sink: PageNumberSink, totalPages: number): void {
  sink.totalPages = totalPages
}

/**
 * Die Seitenzahlen für die Agenda — ODER `null`.
 *
 * `null` heisst: die Agenda wird OHNE Seitenzahlen gerendert. Das ist der dokumentierte Rückfall
 * und ausdrücklich kein zweiter Mechanismus daneben — dieselbe Agenda, nur ohne Zahlenspalte.
 */
export type AgendaPageNumbers = Record<string, number> | null

/**
 * Prüft, ob zwei Durchläufe DASSELBE gemessen haben.
 *
 * ── WARUM DAS NICHT ÜBERFLÜSSIG IST ───────────────────────────────────────────────────────────
 * Die Agenda des zweiten Durchlaufs trägt Zahlen, die der erste gemessen hat. Änderte deren
 * Anwesenheit den Umbruch (eine Zahlenspalte, die eine Zeile umbrechen lässt; eine Agenda, die
 * dadurch auf zwei Seiten läuft), verschöben sich alle folgenden Kapitel — und die gedruckten
 * Zahlen zeigten auf die Seiten VOR der Verschiebung. Das sähe niemandem als Fehler an, weil die
 * Zahlen plausibel bleiben.
 *
 * Die Zahlenspalte ist deshalb in fester Breite und einzeilig ausgelegt (s. `document.tsx`), und
 * diese Funktion misst, ob das gehalten hat. Weicht etwas ab, wird ohne Zahlen ausgeliefert: keine
 * Zahl ist besser als eine falsche.
 */
export function measurementsAgree(first: PageNumberSink, second: PageNumberSink): boolean {
  if (first.totalPages !== second.totalPages) return false
  const ids = new Set([...Object.keys(first.pages), ...Object.keys(second.pages)])
  for (const id of ids) {
    if (first.pages[id] !== second.pages[id]) return false
  }
  return true
}

/** Kapitel (`level: 1`) tragen eine Seitenzahl, Unterpunkte nicht — s. Regel 2 im Kopf. */
export function sectionHasPageNumber(section: ReportSection): boolean {
  return section.level === 1
}
