/**
 * DER ANZEIGEZUSTAND DES ANFRAGEFORMULARS (B18-4, Portal-Oberfläche).
 *
 * ── ⚠ WARUM DAS NICHT IN DER ACTION-DATEI STEHT — GEMESSEN, NICHT VERMUTET ──────────────────────
 * Eine Datei mit `'use server'` darf AUSSCHLIESSLICH async Funktionen exportieren. Ein daneben
 * exportierter Wert (hier: der Startzustand) lässt `build`, `typecheck` UND `lint` unbeeindruckt
 * durchlaufen und wirft erst zur LAUFZEIT — beim ersten Rendern der Seite:
 *
 *     Error: A "use server" file can only export async functions, found object.
 *
 * Beobachtet gegen den Production-Build: Die Seite antwortete mit 500 und „Application error",
 * sobald das Formular abgesendet wurde. Ein TYP-Export wäre unbedenklich (er verschwindet beim
 * Kompilieren), der Wert ist es nicht. Beides liegt hier, damit die Trennlinie nicht davon abhängt,
 * dass jemand sie kennt.
 */

/**
 * Was die Seite nach dem Absenden anzeigt.
 *
 * `maxLength`/`createdAt` fahren nur dort mit, wo der Text sie braucht — die Zahl kommt aus der
 * ANTWORT der Datenbank und nicht aus einer Konstante (B18-4-Schreibweg), der Zeitpunkt aus der
 * bestehenden Anfrage.
 *
 * `already_pending` ist ein EIGENER Zustand und kein Fehler: Er entsteht real ohne Fehlverhalten
 * (zwei Tabs, Doppelklick) — als generischer Fehler angezeigt wäre er die falsche Auskunft.
 */
export type CalculatorRequestFormState =
  | { status: 'idle' }
  | { status: 'ok' }
  | { status: 'already_pending'; createdAt: string | null }
  | { status: 'missing_fields'; message: string }
  | { status: 'message_too_long'; maxLength: number; message: string }
  | { status: 'none' }
  | { status: 'error'; message: string }

export const CALCULATOR_REQUEST_INITIAL_STATE: CalculatorRequestFormState = { status: 'idle' }
