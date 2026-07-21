import { ArrowUpRight, Info } from 'lucide-react'
import { NETZBETREIBER_LABELS, type NetzbetreiberId, type PendingReason } from 'shared'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { WARTELISTE_URL } from '@/lib/constants'

/**
 * B11, TEIL 4 — Was zu sagen bleibt, wenn zu einer Kombination kein Leistungspreis vorliegt.
 *
 * ── HIER WIRD NICHT GERECHNET, UND DAS IST DIE PRODUKTAUSSAGE ───────────────────────────────────
 * Für Netzebene 7 gibt es bis zur Tarifverordnung keine Leistungspreise. Eine Zahl an dieser Stelle
 * wäre erfunden — auch eine vorsichtige, auch eine als „Schätzung" bezeichnete. Der Rechner
 * verweigert die Berechnung deshalb, statt eine Grössenordnung anzubieten.
 *
 * Das ist der einzige ehrliche Weg aus dem Rechner in den Bestand. Eine geschätzte Zahl wäre
 * bequemer: sie liesse den Besucher weiterklicken, erzeugte ein Ergebnis, und niemand müsste einen
 * Verzicht erklären. Sie würde genau das Vertrauen kosten, auf dem das gesamte Produkt aufbaut —
 * dieselbe Zusage, die der Flaggschiff-Artikel mit „Die Beträge stehen noch nicht fest" schliesst
 * und die die Artikel-Grafiken bereits tragen („Wer hier ‚Y €/kW' hinschreibt, erfindet.").
 *
 * KEINE ZAHL, KEIN BETRAG, KEINE GRÖSSENORDNUNG, KEIN „BIS ZU". Wer diesen Text ändert, prüft das
 * bitte Satz für Satz nach.
 *
 * ── DER VERWEIS IST EIN ANGEBOT, KEINE HÜRDE ────────────────────────────────────────────────────
 * Die Warteliste steht als Möglichkeit daneben, nicht als Bedingung. Der Rechner bleibt für jede
 * andere Kombination vollständig benutzbar, und wer den Leistungspreis auf seiner Netzrechnung
 * stehen hat, kommt ohne Netzbetreiber-Auswahl weiter — der Weg dorthin steht im Text.
 */
export function TarifNichtVerfuegbar({
  reason,
  netzbetreiber,
  netzebene,
  note,
}: {
  reason: PendingReason
  /** `null`, wenn nur die Netzebene gewählt wurde (die Aussage gilt dann für alle Netzbetreiber). */
  netzbetreiber: NetzbetreiberId | null
  netzebene: number
  /** Der Vermerk aus der Datenschicht — nur beim redaktionellen Fall gezeigt. */
  note?: string
}) {
  const betreiber = netzbetreiber ? NETZBETREIBER_LABELS[netzbetreiber] : null

  if (reason === 'awaiting_tariff_regulation') {
    return (
      <Alert variant="warning" data-testid="tarif-nicht-verfuegbar">
        <Info className="h-4 w-4" />
        <AlertTitle>
          Für Netzebene {netzebene} gibt es noch keine Leistungspreise
          {betreiber ? ` (${betreiber})` : ''}
        </AlertTitle>
        <AlertDescription>
          <p className="mb-3 text-text">
            Die SNE-G-V regelt die Grundsätze der neuen Systematik. Die Preise kommen erst mit der
            darauf aufbauenden Tarifverordnung (SNE-T-V) — und die ist noch nicht erlassen. Eine
            Berechnung wäre an dieser Stelle erfunden, deshalb rechnen wir hier nicht.
          </p>
          <p className="mb-3 text-text">
            Alles, was Sie über Ihren Lastgang lernen, gilt unabhängig davon, welcher Betrag am Ende
            in der Verordnung steht.
          </p>
          <a
            className="inline-flex items-center gap-1 font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
            href={WARTELISTE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Warteliste zum Leistungstarif 2027
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
          <p className="mt-1 text-xs text-text-muted">
            Einmal eintragen — wir melden uns, sobald die Tarifverordnung da ist und sich Ihr Fall
            rechnen lässt.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  /*
   * Der zweite Fall sieht dem ersten ähnlich und ist fachlich das Gegenteil: der Satz EXISTIERT,
   * wir haben ihn nur noch nicht belegbar hinterlegt. Ihn mit dem Verordnungsstand zu begründen
   * wäre eine Ausrede — und den Besucher auf eine Warteliste zu schicken, obwohl der Wert auf
   * seiner Rechnung steht, wäre eine Hürde ohne Ertrag. Deshalb anderer Text, kein Warteliste-Link,
   * und ein konkreter Weg weiter.
   */
  return (
    <Alert data-testid="tarif-nicht-hinterlegt">
      <Info className="h-4 w-4" />
      <AlertTitle>
        {betreiber ? `${betreiber}, ` : ''}Netzebene {netzebene}: bei uns noch kein Leistungspreis
        hinterlegt
      </AlertTitle>
      <AlertDescription>
        <p className="mb-3 text-text">
          Wir tragen die Sätze je Netzbetreiber aus den Preisblättern nach; für diese Kombination
          fehlt er noch. Einen Näherungswert setzen wir hier nicht ein — er sähe aus wie eine Angabe.
          {note ? ` (${note})` : ''}
        </p>
        <p className="text-text">
          Ihr Leistungspreis steht auf Ihrer Netzrechnung. Wählen Sie oben bei „Netzbetreiber“ den
          Eintrag „Nicht angeben — Werte aus meiner Netzrechnung“ und tragen Sie ihn direkt ein; die
          Rechnung des Kunden ist ohnehin massgeblich.
        </p>
      </AlertDescription>
    </Alert>
  )
}
