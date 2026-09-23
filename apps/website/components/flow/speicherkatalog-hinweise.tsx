import { Info } from 'lucide-react'
import type { NoRecommendationReason } from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * Die Zustände des Speicherkatalogs, sichtbar gemacht (K3b) — dieselbe Haltung wie B21-3d für die
 * Netzentgelte (`tarif-nicht-verfuegbar.tsx`), und aus denselben Gründen.
 *
 * ── ⚠ ES WIRD NICHT AUF DEN PLATZHALTER-KATALOG ZURÜCKGEFALLEN ─────────────────────────────────
 * `DEMO_BATTERY_CATALOG` sind sechs frei erfundene Geräte mit erfundenen Preisen. Sie in einem
 * Störfall einzusetzen wäre die gefährlichste der Möglichkeiten: der Report nennte Hersteller,
 * Kapazität, Investition und Amortisation — und niemandem fiele auf, dass es die Geräte nicht
 * gibt. Eine Empfehlung, die ihren Katalog nicht kennt, sieht aus wie ein Ergebnis.
 *
 * ── ZWEI FEHLERARTEN, ZWEI MELDUNGEN ───────────────────────────────────────────────────────────
 * `request_failed` ist vorübergehend (Netz, Zeitüberschreitung) — ein zweiter Versuch kann ihn
 * beheben, deshalb steht ein Knopf daneben. `not_configured` ist ein Einrichtungsfehler auf
 * unserer Seite; ein Wiederholen-Knopf, der nie hilft, ist eine Requisite.
 */
export function SpeicherkatalogNichtAbrufbar({
  reason,
  onRetry,
}: {
  reason: 'not_configured' | 'request_failed'
  onRetry: () => void
}) {
  if (reason === 'not_configured') {
    return (
      <Alert variant="warning" data-testid="speicherkatalog-nicht-eingerichtet">
        <Info className="h-4 w-4" />
        <AlertTitle>Der Speicherkatalog ist gerade nicht eingerichtet</AlertTitle>
        <AlertDescription>
          <p className="text-text">
            Wir können die verfügbaren Speicher im Moment nicht nachschlagen. Das liegt an uns,
            nicht an Ihrer Eingabe — und ein zweiter Versuch ändert daran nichts. Einen
            Beispielspeicher setzen wir hier nicht ein: er sähe aus wie ein Vorschlag aus unserem
            Katalog. Bitte versuchen Sie es später noch einmal.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="warning" data-testid="speicherkatalog-nicht-abrufbar">
      <Info className="h-4 w-4" />
      <AlertTitle>Der Speicherkatalog liess sich gerade nicht abrufen</AlertTitle>
      <AlertDescription>
        <p className="mb-3 text-text">
          Die Abfrage ist nicht durchgekommen. Ohne den Katalog rechnen wir nicht — ein
          Beispielspeicher wäre eine Empfehlung für ein Gerät, das es nicht gibt.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
          data-testid="speicherkatalog-erneut-versuchen"
        >
          Erneut versuchen
        </button>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Für diese Kategorie ist kein Gerät freigegeben — eine gültige Antwort, kein Fehler.
 *
 * Heute ist das der reale Stand für `heim`: der Katalog führt Heimspeicher, aber keiner davon ist
 * freigeschaltet (K1: die Freigabe verlangt vollständige Kenndaten). Deshalb steht hier auch keine
 * Fehlermeldung und kein Wiederholen-Knopf, sondern die Ansage, woran es liegt.
 *
 * ⚠ K3b-2: Der Knopf daneben ist NICHT mehr gesperrt. Der Text sagt deshalb, was die Analyse
 * trotzdem leistet, statt den Leser auf einen anderen Weg zu schicken — „rechnen Sie stattdessen"
 * wäre neben einem benutzbaren Knopf eine falsche Auskunft.
 */
export function SpeicherkatalogImAufbau() {
  return (
    <Alert data-testid="speicherkatalog-im-aufbau">
      <Info className="h-4 w-4" />
      <AlertTitle>Speicherkatalog für Privathaushalte im Aufbau</AlertTitle>
      <AlertDescription>
        <p className="mb-3 text-text">
          Für Privathaushalte ist derzeit kein Speicher freigegeben — wir prüfen die Geräte gerade
          und geben sie einzeln frei, sobald ihre Kenndaten vollständig belegt sind. Bis dahin
          schlagen wir Ihnen hier keinen Speicher vor; ein Beispielgerät wäre eine Empfehlung ohne
          Grundlage.
        </p>
        <p className="text-text">
          Die Analyse können Sie trotzdem starten: Sie bekommen Ihren Lastgang, Ihre Stromkosten
          heute und den Vergleich mit den Börsenpreisen — nur eben keinen Speichervorschlag. Für
          gewerbliche Anschlüsse ist der Katalog gefüllt (Schritt 1, „Lastgang-Datei").
        </p>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Im REPORT: die Analyse steht, aber es gab kein Gerät zu bewerten (K3b-2).
 *
 * ── WARUM EIN ZWEITER, KÜRZERER TEXT UND NICHT DERSELBE WIE IN SCHRITT 2 ───────────────────────
 * `SpeicherkatalogImAufbau` steht VOR der Rechnung und schickt den Leser auf einen anderen Weg
 * („rechnen Sie stattdessen mit einem echten Lastgang"). Hier ist die Rechnung bereits da; dieselbe
 * Aufforderung läse sich wie „das hier war umsonst". Der Report sagt deshalb, was er zeigt und was
 * er nicht zeigt — und lässt die Tarifzahlen stehen, die vollständig belegt sind.
 */
/* Je Grund ein Wortlaut — ein neuer Enum-Wert ist damit ein Typfehler und kein stiller Leerlauf. */
export const NO_RECOMMENDATION_TITLE = 'Speicherkatalog für Privathaushalte im Aufbau'
export const NO_RECOMMENDATION_TEXT: Record<NoRecommendationReason, string> = {
  no_candidates:
    'Für Privathaushalte ist derzeit kein Speicher freigegeben — deshalb enthält dieser Report ' +
    'keinen Speichervorschlag und keine Wirtschaftlichkeitsrechnung dazu. Ein Beispielgerät wäre ' +
    'eine Empfehlung ohne Grundlage. Alles, was ohne Speicher belegbar ist, steht unverändert ' +
    'darin: Ihr Lastgang, Ihre Stromkosten heute und der Vergleich mit den Börsenpreisen.',
}

export function KeinSpeichervorschlag({ reason }: { reason: NoRecommendationReason }) {
  return (
    <Alert data-testid="kein-speichervorschlag">
      <Info className="h-4 w-4" />
      <AlertTitle>{NO_RECOMMENDATION_TITLE}</AlertTitle>
      <AlertDescription>
        <p className="text-text">{NO_RECOMMENDATION_TEXT[reason]}</p>
      </AlertDescription>
    </Alert>
  )
}
