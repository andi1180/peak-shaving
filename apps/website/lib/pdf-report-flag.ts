/**
 * Cutover Teil 1 — der Schalter zwischen den ZWEI Rendering-Wegen des Reports.
 *
 * ── WAS ER SCHALTET ───────────────────────────────────────────────────────────────────────────
 * AUS (Vorgabe): der Knopf im Ergebnisbereich löst `window.print()` gegen das Print-Stylesheet aus
 * — der Weg, der seit U2 Prompt D / Delta 16a produktiv ist.
 * AN: derselbe Knopf ruft `downloadReportPdf` (`lib/pdf-report/download.ts`) und erzeugt das
 * react-pdf-Dokument vollständig im Browser (D1–D20).
 *
 * ── ⚠ DIE PRÜFUNG IST FAIL-CLOSED, UND ZWAR AUF GENAU EINE ZEICHENKETTE ───────────────────────
 * Eingeschaltet ist der neue Weg ausschliesslich bei dem exakten Wert `react-pdf`. Jeder andere
 * Wert — nicht gesetzt, leer, `print`, `false`, ein Tippfehler — bedeutet AUS. Das ist bewusst
 * nicht `!== undefined` oder eine Wahrheitswert-Prüfung: `NEXT_PUBLIC_PDF_REPORT_ENGINE=false`
 * wäre dabei eine nicht-leere Zeichenkette und damit wahr, und der neue Weg ginge live, weil
 * jemand ihn abschalten wollte. Ein Schalter, den ein Tippfehler EINschaltet, ist keiner.
 *
 * Der Rückfall auf den alten Weg ist damit auch der Rückfallschalter im Betrieb: die Variable in
 * Vercel auf `print` setzen (oder entfernen) und neu ausrollen — mehr ist nicht zu tun, weil der
 * CSS-Weg samt `print-*.tsx` und `@media print` unangetastet bestehen bleibt (D21).
 *
 * ── ⚠ DER ZUGRIFF MUSS WÖRTLICH SO STEHEN BLEIBEN ─────────────────────────────────────────────
 * Next ersetzt `process.env.NEXT_PUBLIC_*` beim Bauen TEXTUELL an der Fundstelle. Über einen
 * Zwischenschritt gelesen (`process.env[NAME]`, ein Objekt-Spread, eine Hilfsfunktion mit dem
 * Namen als Parameter) findet die Ersetzung NICHT statt, und der Wert ist im Browser schlicht
 * `undefined` — der Schalter stünde dann dauerhaft auf AUS, ohne dass irgendetwas fehlschlüge.
 *
 * Genau dieselbe Eigenschaft macht den Schalter zu einem BAUZEIT-Wert: ein- wie ausschalten
 * verlangt ein neues Deployment, ein bereits gebautes ändert sich durch das Setzen der Variable
 * nicht.
 *
 * ⚠ GEMESSEN, gegen die naheliegende Annahme: die Ersetzung findet nur statt, WENN die Variable
 * beim Bauen gesetzt IST. Ohne sie bleibt der Zugriff als Laufzeit-Nachschlag stehen und liefert
 * `undefined` — richtig (AUS), aber eben nicht wegoptimiert. Der ausgeschaltete Bau trägt die
 * neuen Zweige deshalb mit (+3.438 Bytes roh auf `/rechner`, 19 Chunks unverändert); der
 * EINGESCHALTETE ist mit gefaltetem Vergleich sogar 100 Bytes kleiner. Was in beiden Fällen gilt
 * und der eigentliche Punkt ist: `@react-pdf` kommt im First Load 0× vor — die Bibliothek hängt
 * am dynamischen Import in `step-result.tsx`, nicht an diesem Schalter.
 */
export const REACT_PDF_REPORT_ENABLED = process.env.NEXT_PUBLIC_PDF_REPORT_ENGINE === 'react-pdf'
