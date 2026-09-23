import { Info } from 'lucide-react'

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
          Rechnen Sie stattdessen mit einem echten Viertelstunden-Lastgang Ihres Netzbetreibers
          (Schritt 1, „Lastgang-Datei") — für gewerbliche Anschlüsse ist der Katalog gefüllt.
        </p>
      </AlertDescription>
    </Alert>
  )
}
