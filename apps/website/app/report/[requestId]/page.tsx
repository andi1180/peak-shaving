import type { Metadata } from 'next'

import { ReportRenderView } from './report-client'

/**
 * D12 Abschluss — `/report/<requestId>`: der Leseweg für eine Report-Übergabe.
 *
 * ── WAS DIESE ROUTE IST ────────────────────────────────────────────────────────────────────────
 * Der Ort, an dem eine im Admin-Bereich gerechnete Analyse (`apps/web`, D12 Teil 2) zu einem PDF
 * wird. Sie ist `noindex` und nirgends verlinkt — erreichbar ist sie ausschliesslich über die
 * Kennung, die die auslösende Aktion ausgibt.
 *
 * ── ⚠ DIE HÜLLE IST SERVERSEITIG, DER INHALT NICHT ────────────────────────────────────────────
 * Derselbe Schnitt wie beim Prüfstand (`/pdf-report-probe`): Metadaten und Rahmen hier, alles
 * Weitere in der Client-Komponente. Das ist keine Formalie — die Übergabe wird mit dem ANON-Zugang
 * aus dem BROWSER gelesen und das PDF dort erzeugt. Serverseitig gelesen landete der vollständige
 * Lastgang eines Geschäftskunden im ausgelieferten HTML, auch wenn niemand ihn rendert.
 *
 * ⚠ KEINE eigene Prüfung der Kennung. Eine hier vorgeschaltete Gültigkeitsprüfung könnte nur
 * dasselbe leisten wie der Wrapper — und sie müsste, um etwas zu leisten, zwischen „unbekannt" und
 * „abgelaufen" unterscheiden können. Genau das tut die Datenbank bewusst nicht.
 */
export const metadata: Metadata = {
  title: 'Report — COOLiN ENERGY',
  robots: { index: false, follow: false },
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = await params

  return (
    <main className="min-h-screen bg-surface-alt py-10">
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
        <ReportRenderView requestId={requestId} />
      </div>
    </main>
  )
}
