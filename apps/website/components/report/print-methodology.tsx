import { HINDSIGHT_NOTE } from '@/lib/report-copy'

/**
 * Methodik & Vorbehalte — der Kapitel-Abschnitt des erweiterten Druck-Reports (Delta 16a).
 *
 * ── WARUM ES IHN NUR IM DRUCK GIBT ──────────────────────────────────────────────────────────────
 * Am Bildschirm ist die Rechenweise INTERAKTIV nachvollziehbar: aufklappbare Annahmen, editierbares
 * Panel, Infobuttons an den Feldern (Prinzip 5). Ein ausgedrucktes Blatt hat nichts davon — es wird
 * weitergereicht und ohne Rückfragemöglichkeit gelesen. Was am Bildschirm ein Klick ist, muss auf
 * Papier ein Absatz sein, sonst ist der Report zwar hübsch, aber nicht mehr überprüfbar.
 *
 * ── ER ERFINDET KEINE AUSSAGE ───────────────────────────────────────────────────────────────────
 * Jeder Punkt gibt eine bereits geltende Regel des Systems wieder (Prinzipien 1–4, §3.5–§3.7) oder
 * einen bereits dokumentierten Vorbehalt. Der Hindsight-Hinweis kommt WÖRTLICH aus derselben
 * Konstante wie die Ersparnis-Aufschlüsselung (`lib/report-copy.ts`) — er darf zwischen Karte und
 * Kapitel nicht auseinanderlaufen.
 *
 * ── DIE DEGRADATION IST DER EINZIGE NEUE SATZ, UND SIE WAR ÜBERFÄLLIG ───────────────────────────
 * Delta 11 verlangt ausdrücklich, die konstant angenommene Kapazität/Wirkungsgrad über den
 * ROI-Horizont „als Vereinfachung im Report zu kennzeichnen, falls das dort noch nicht steht". Es
 * stand dort nicht (gemessen: keine Fundstelle im gesamten Report). Ein Vorbehalt, den nur das
 * Pflichtenheft kennt, schützt niemanden, der das Blatt in der Hand hält.
 *
 * ── KEINE ZAHLEN AUS DEM ARBEITSPAPIER ──────────────────────────────────────────────────────────
 * Dieser Abschnitt beschreibt METHODE, nicht Ergebnisse. Er trägt bewusst keine Vergleichs- oder
 * Studienzahl: der LP-Spike (Delta 14 Punkt 1) ist offen, und bis er gelaufen ist, gehören die
 * Zahlen aus der Ladeoptimierungs-Studie an keine Stelle der Kundenkommunikation (Delta 11).
 */
function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="break-inside-avoid">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-0.5 max-w-prose text-sm leading-relaxed text-text-muted">{children}</p>
    </div>
  )
}

export function PrintMethodology() {
  return (
    <div className="hidden print:block print:break-before-page">
      <h2 className="text-lg font-semibold text-ink">Methodik &amp; Vorbehalte</h2>
      <p className="mt-1 max-w-prose text-sm text-text-muted">
        Wie diese Zahlen entstanden sind — und wo ihre Grenzen liegen.
      </p>

      <div className="mt-5 flex flex-col gap-4">
        <Item title="Grundlage ist Ihr echter Lastgang">
          Gerechnet wird auf den Viertelstundenwerten, die Sie hochgeladen haben, und auf den
          Tarifwerten Ihrer Netzrechnung. Wo uns ein Wert fehlt, weisen wir das aus, statt ihn zu
          schätzen — eine geratene Zahl fällt später niemandem als Fehler auf, sondern als Ergebnis.
        </Item>

        <Item title="Ein Fahrplan, keine addierten Einzelrechnungen">
          Spitzenkappung, Eigenverbrauch und tarifbewusstes Laden konkurrieren um dieselbe
          Batteriekapazität. Sie werden deshalb in einer einzigen Simulation gemeinsam gefahren und
          anschliessend aufgeschlüsselt — nie getrennt gerechnet und addiert. Die Teilbeträge in der
          Empfehlung ergeben zusammen genau die ausgewiesene Gesamtersparnis, keine Kilowattstunde
          zählt doppelt.
        </Item>

        <Item title="Physikalische Simulation, kein Hochrechnen von Spitzen">
          Die Batterie wird über den gesamten Zeitraum chronologisch mit Ladestand, Leistungsgrenze
          und Wirkungsgrad durchgerechnet. Der Ladestand bleibt dabei jederzeit innerhalb der
          nutzbaren Kapazität; eine Spitze gilt nur dann als abgefangen, wenn zu diesem Zeitpunkt
          tatsächlich genug Energie und Leistung vorhanden waren.
        </Item>

        <Item title="Bestmarke, nicht Alltagsbetrieb">{HINDSIGHT_NOTE}</Item>

        <Item title="Konstante Batterieeigenschaften über den Betrachtungszeitraum">
          Nutzbare Kapazität und Wirkungsgrad werden über den gesamten Horizont als unverändert
          angenommen. Reale Speicher verlieren mit den Jahren an Kapazität. Diese Alterung ist hier
          bewusst nicht modelliert — eine erfundene Alterungskurve wäre schlechter als eine
          offengelegte Vereinfachung. Die ausgewiesene Ersparnis der späteren Jahre ist dadurch eher
          optimistisch.
        </Item>

        <Item title="Ihre Verbrauchsdaten haben Ihren Rechner nicht verlassen">
          Lastgang und Messwerte wurden vollständig in Ihrem Browser verarbeitet; sie wurden nicht
          übertragen und nicht gespeichert. Auch dieses Dokument ist lokal auf Ihrem Gerät
          entstanden.
        </Item>
      </div>
    </div>
  )
}
