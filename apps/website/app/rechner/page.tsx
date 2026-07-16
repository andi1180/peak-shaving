import { Calculator } from '@/components/flow/calculator'
import { SiteHeader } from '@/components/marketing/site-header'

/**
 * EMBED-MODUS (`?embed=1`) — die einzige Zutat, die diese App für die
 * Einbettung in die coolin.at-Hülle (`apps/web`, Route
 * /peak-shaving/kalkulator/rechner) braucht.
 *
 * WAS er tut: NUR das App-eigene Chrome ausblenden — hier der `SiteHeader`
 * („Peak Shaving Kalkulator" + „Analyse starten"). Im iframe trägt die
 * coolin.at-Hülle bereits Header und Footer; die App-Headline daneben wäre
 * eine zweite, konkurrierende Marke im selben Bild. Einen App-Footer gibt es
 * auf dieser Route nicht (nur Header + Calculator) — deshalb ist hier auch
 * nichts weiter auszublenden.
 *
 * WAS er NICHT tut: den Rechner-Flow selbst anfassen. Kein Zweig in
 * `Calculator`, kein Prop, keine Engine-/Worker-Änderung. Der Modus endet an
 * dieser Datei.
 *
 * OHNE den Parameter ist das Standalone-Verhalten unverändert: `isEmbed`
 * ist dann `false` und es rendert exakt derselbe Baum wie zuvor.
 *
 * BEWUSSTER TRADE-OFF (gemessen, nicht geschätzt): `searchParams` zu lesen
 * nimmt dieser Route das statische Prerendering (`○ Static` -> `ƒ Dynamic`).
 * Der Preis ist eine Server-Funktion pro Aufruf für eine HTML-Hülle, die für
 * alle gleich ist — der Rechner selbst läuft ohnehin vollständig im Client.
 * Die Alternative (Inline-Skript im Root-Layout, das eine Klasse auf <html>
 * setzt) hielte die Route statisch, kostet aber ein CSP-unfreundliches
 * Inline-Skript auf ALLEN Seiten der App; das ist der teurere Handel für eine
 * Route, deren TTFB hinter einem Klick liegt. Wenn das je stört, ist die
 * saubere Auflösung eine eigene statische Route, kein Query-Parameter.
 */
export default async function RechnerPage({
  searchParams,
}: {
  searchParams: Promise<{ embed?: string }>
}) {
  const { embed } = await searchParams
  const isEmbed = embed === '1'

  // Öffentlicher Rechner (§5). Der Flow-State lebt client-seitig; kein Upload, kein Login.
  return (
    <div className="flex min-h-screen flex-col bg-surface-alt print:bg-surface">
      {!isEmbed && (
        <div className="print:hidden">
          <SiteHeader />
        </div>
      )}
      <main className="flex-1">
        <Calculator />
      </main>
    </div>
  )
}
