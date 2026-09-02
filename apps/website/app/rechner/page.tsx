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
/**
 * B22b — die Laufzeitgrenze für den PVGIS-Proxy (Pflichtenheft §3(a), letzter Absatz).
 *
 * ── ⚠ WARUM SIE HIER STEHT UND NICHT IN `lib/pvgis/actions.ts` ─────────────────────────────────
 * Der Bau-Auftrag sah sie an der Server Action vor. **Gemessen (02.09.2026): dort wirkt sie
 * nicht.** Next liest `maxDuration` in `build/analysis/get-page-static-info.js` aus den EXPORTEN
 * einer Seiten-/Route-Datei; ein `'use server'`-Modul wird dabei gar nicht betrachtet. Der Build
 * bricht deshalb auch nicht ab — er nimmt den Export kommentarlos hin und ignoriert ihn. Genau die
 * Sorte Zusage, die man für erfüllt hält, bis der erste echte Aufruf abgeschnitten wird.
 *
 * Eine Server Action läuft in der Funktion der Route, die sie auslöst; die einzige Route, die den
 * Rechner rendert, ist diese hier.
 *
 * ── WARUM 60 UND NICHT DAS MINIMUM ─────────────────────────────────────────────────────────────
 * Gemessen (B22a, gegen den echten Dienst von einem Wohnanschluss): ein Wetterjahr 1,41 s, alle
 * zehn in EINEM Aufruf 7,80 s bei 8,2 MB. Dazu kommt das Auswerten von 87.600 Stundenwerten.
 * `PVGIS_TIMEOUT_MS` in `lib/pvgis/client.ts` bricht bei 25 s selbst ab — 60 s liegt bewusst
 * darüber, damit dieser Abbruch greift und der Kunde die benannte Meldung `pvgis_error` bekommt,
 * statt dass die Plattform die Anfrage vorher wegschneidet und daraus ein unerklärter Fehler wird.
 *
 * ⚠ 60 s ist zugleich die Obergrenze, die JEDER Vercel-Tarif zulässt; ein höherer Wert wäre auf
 * einem kleineren Tarif ein Deployment-Fehler. Die übrigen Server Actions dieser Route (Rechnungs-
 * Scan, Report-Anfrage, …) erben die Grenze — für sie ist sie grosszügiger als bisher und
 * unschädlich: sie brechen alle selbst früher ab.
 */
export const maxDuration = 60

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
