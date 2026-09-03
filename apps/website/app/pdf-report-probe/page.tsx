import type { Metadata } from 'next'

import { PdfReportProbe } from './probe-client'

/**
 * B23a — der Prüfstand für das Dokumentgerüst des neuen PDF-Reports.
 *
 * ── WAS DIESE ROUTE IST ────────────────────────────────────────────────────────────────────────
 * Der einzige Ort, an dem der react-pdf-Weg dieser PR überhaupt erreichbar ist. Sie ist
 * `noindex`, nirgends im Repo verlinkt (gemessen) und in keiner Sitemap — diese App führt gar
 * keine (`app/` hat weder `sitemap.ts` noch `robots.ts`). Dasselbe Muster wie `/strom-check` in
 * `apps/web`: erreichbar, unverlinkt, nicht indexiert, ausdrücklich keine Produktseite.
 *
 * ── WAS SIE NICHT IST ──────────────────────────────────────────────────────────────────────────
 * KEIN zweiter Ausgabeweg für Kunden. Der Export im Rechner löst unverändert `window.print()`
 * gegen das Print-Stylesheet aus (`step-result.tsx`); umgeschaltet wird erst, wenn der neue Weg
 * inhaltlich vollständig ist (B23c). Bis dahin wäre ein zweiter Knopf im Flow ein Angebot, das
 * weniger liefert als das bestehende.
 *
 * ⚠ SIE ENTHÄLT BEWUSST NICHT DEN GATE-DIALOG. Der schreibt einen echten Lead nach
 * `platform.leads` (Delta 16b) — eine Prüfroute, die das kann, verfälscht genau die Statistik, für
 * die die Herkunft `rechner-report` existiert. „Ich klicke es schon nicht" ist keine Sperre. Die
 * zwei neuen Felder des Dialogs sind deshalb hier NACHGEBILDET und dort separat gemessen worden
 * (s. Handover).
 */
export const metadata: Metadata = {
  title: 'PDF-Report-Prüfstand (WIP) — COOLiN ENERGY',
  description: 'Interner Prüfstand für das Dokumentgerüst des PDF-Reports (B23a).',
  robots: { index: false, follow: false },
}

export default function PdfReportProbePage() {
  return (
    <main className="min-h-screen bg-surface-alt py-10">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <PdfReportProbe />
      </div>
    </main>
  )
}
