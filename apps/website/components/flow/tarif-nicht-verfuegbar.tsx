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
 *
 * ── DELTA 9a: EIN DRITTER FALL, DER KEINE VERWEIGERUNG IST ──────────────────────────────────────
 * Bis hierher hiess „kein Leistungspreis" immer: uns fehlt eine Zahl. Mit der Messvarianten-Auswahl
 * (Delta 5) kommt ein Fall dazu, in dem gar keine Zahl fehlt — ein Anschluss OHNE Leistungsmessung
 * hat schlicht keine Leistungspreis-Komponente. Das ist der normale Zustand dieses Anschlusses und
 * kein Mangel unserer Daten.
 *
 * Ihn mit demselben Text zu beantworten wäre gleich doppelt falsch: er behauptete einen Mangel, den
 * es nicht gibt, und er sperrte eine Analyse, die sehr wohl möglich ist — die Spitzenkappung
 * entfällt, der Arbeitspreis-Teil (Tarifoptimierung, Delta 4) bleibt vollständig rechenbar. Deshalb
 * steht dieser Fall GANZ OBEN, blockiert nichts und trägt einen eigenen Ton.
 */
/**
 * Delta 9a — der gültige Fall, und deshalb eine EIGENE Komponente neben der Verweigerung.
 *
 * Sie steht hier und nicht in `step-tariff.tsx`, weil genau diese Datei die Frage beantwortet „was
 * sagen wir, wenn kein Leistungspreis gilt" — und die Antwort hat seit Delta 9 zwei grundverschiedene
 * Ausprägungen. Getrennte Komponenten statt eines Zweigs mit einem `reason`, der dann nichts
 * bedeutet: dieser Fall hat kein `reason`, weil ihm nichts fehlt.
 *
 * Bewusst die NEUTRALE Alert-Variante, nicht Bernstein: Warnfarbe ist Information und kein Dekor
 * (DESIGN.md). Hier ist nichts zu warnen.
 */
export function TarifOhneLeistungsmessung() {
  return (
    <Alert data-testid="tarif-ohne-leistungsmessung">
      <Info className="h-4 w-4" />
      <AlertTitle>
        Ohne Leistungsmessung gibt es keinen Leistungspreis — das ist kein Fehler
      </AlertTitle>
      <AlertDescription>
        <p className="mb-3 text-text">
          Anschlüsse ohne Leistungsmessung zahlen kein Entgelt auf die höchste Viertelstunde. Damit
          entfällt für Sie genau der Posten, den die Spitzenkappung senken würde — eine Ersparnis
          daraus wäre erfunden, und wir weisen sie deshalb nicht aus. Der Leistungspreis unten steht
          deshalb auf 0; wie jedes Feld bleibt er editierbar.
        </p>
        <p className="text-text">
          Alles Übrige rechnet weiter: Eigenverbrauch, Lastverschiebung und der Vergleich mit den
          Börsen-Strompreisen hängen am Arbeitspreis, nicht an der Leistungsmessung. Sie können die
          Analyse ganz normal starten.
        </p>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Delta 9a, Nachtrag — der Zustand VOR der Messvarianten-Wahl.
 *
 * Auf einer Netzebene mit Messvarianten (heute NE 7) entscheidet die Anschlussart darüber, welche
 * der beiden anderen Meldungen gilt: ohne Leistungsmessung fehlt gar nichts, mit Leistungsmessung
 * fehlt der Satz aus der noch nicht erlassenen Tarifverordnung. Solange die Variante nicht gewählt
 * ist, wissen WIR nicht, welcher der beiden Fälle vorliegt — und dürfen deshalb keinen der beiden
 * behaupten.
 *
 * Bis hierher stand an dieser Stelle sofort die Regulierungslücke samt Warteliste. Das war für die
 * Hälfte der Besucher schlicht falsch: wer ohne Leistungsmessung angeschlossen ist, bekam eine
 * Verweigerung zu lesen, die ihn nichts angeht, und einen Warteliste-Link auf eine Verordnung, auf
 * die er nicht wartet. Ein Teil davon klickt an dieser Stelle weg — kein Test fängt das.
 *
 * Deshalb NEUTRAL: kein Bernstein (Warnfarbe ist Information, kein Dekor — DESIGN.md), kein
 * Warteliste-Link, kein Wort zum Verordnungsstand. Der Hinweis sagt genau eine Sache: es fehlt noch
 * eine Angabe, und sie steht auf der Netzrechnung des Kunden.
 */
export function TarifMessvarianteOffen({ netzebene }: { netzebene: number }) {
  return (
    <Alert data-testid="tarif-messvariante-offen">
      <Info className="h-4 w-4" />
      <AlertTitle>Bitte noch die Leistungsmessungs-Variante wählen</AlertTitle>
      <AlertDescription>
        <p className="text-text">
          Auf Netzebene {netzebene} hängt vom Anschluss ab, ob überhaupt ein Leistungspreis anfällt.
          Wählen Sie oben die Variante, die auf Ihrer Netzrechnung steht — dann sehen Sie, ob und wie
          sich das auf Ihren Fall auswirkt.
        </p>
      </AlertDescription>
    </Alert>
  )
}

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

/**
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 * B21-3d — die Meldungen des DATENBANK-Wegs (Netzebenen 3–6)
 * ════════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Seit dem 07.09.2026 fragt der Rechner für die Netzebenen 3–6 nicht mehr den statischen Katalog
 * (B11), sondern die gepflegten Tarifzeilen in `public.grid_tariffs` (B21-2b). Damit ändern sich
 * die Antworten, die es zu geben gibt — und zwar in beide Richtungen:
 *
 *   – Ein Preisblatt, das im Admin-Bereich eingetragen wurde, ist ab sofort SICHTBAR. Vorher stand
 *     dort „bei uns noch kein Leistungspreis hinterlegt", obwohl der Satz eine Abfrage entfernt in
 *     der Datenbank lag.
 *   – Dafür gibt es zu einer fehlenden Zeile KEINEN Grund mehr. Der statische Katalog trug je
 *     Kombination einen `reason` und einen `note` — eine Datenbankzeile, die es nicht gibt, sagt
 *     nichts über sich selbst. Der Text darf deshalb keine Begründung erfinden, die niemand kennt.
 *
 * ⚠ NETZEBENE 7 LÄUFT NICHT HIER DURCH. Sie bleibt am statischen Katalog und an
 * `TarifNichtVerfuegbar` oben — die fehlende Tarifverordnung (SNE-T-V) ist eine regulatorische
 * Tatsache und kein Zustand unserer Datenpflege. Sie gilt auch dann noch, wenn jemand eine
 * NE-7-Zeile in die Tabelle einträgt.
 */

/**
 * Solange die Abfrage läuft.
 *
 * ⚠ Der Zustand MUSS sichtbar sein und der Knopf gesperrt: ein Formular, das während der Abfrage
 * aussieht wie ein bedienbares, ist die gefährlichere Variante — es zeigt den Vorgabewert 90 €/kW·a
 * aus `initial`, und wer in dieser Sekunde auf „Analyse starten" drückt, rechnet mit einer Zahl, die
 * nie jemand für ihn nachgeschlagen hat.
 */
export function NetzentgeltWirdGeprueft() {
  return (
    <Alert data-testid="netzentgelt-wird-geprueft">
      <Info className="h-4 w-4" />
      <AlertTitle>Preisblatt wird geprüft …</AlertTitle>
      <AlertDescription>
        <p className="text-text">
          Wir sehen gerade nach, ob für diese Kombination ein Netzentgelt-Stand hinterlegt ist. Einen
          Moment — die Felder unten werden danach vorbelegt.
        </p>
      </AlertDescription>
    </Alert>
  )
}

/**
 * Die Abfrage lief, es gibt für diese Kombination keine Tarifzeile.
 *
 * ⚠ KEINE ERFUNDENE BEGRÜNDUNG. Der statische Katalog konnte sagen, WARUM ein Satz fehlt
 * (`awaiting_tariff_regulation` gegen `not_yet_recorded`), weil dort jemand den Grund
 * hingeschrieben hat. Eine fehlende Datenbankzeile sagt nur, dass sie fehlt. Der Text stellt das
 * fest und nennt den Weg weiter — mehr wäre geraten.
 *
 * Gesperrt wird trotzdem, und aus demselben Grund wie in B11: Ohne belegten Satz stünde im Feld der
 * Vorgabewert aus `initial`, und der sähe aus wie eine Angabe. Der Ausweg steht im Text und ist
 * einen Klick entfernt.
 */
export function NetzentgeltNichtHinterlegt({
  netzbetreiber,
  netzebene,
}: {
  netzbetreiber: NetzbetreiberId
  netzebene: number
}) {
  return (
    <Alert data-testid="netzentgelt-nicht-hinterlegt">
      <Info className="h-4 w-4" />
      <AlertTitle>
        {NETZBETREIBER_LABELS[netzbetreiber]}, Netzebene {netzebene}: noch kein Tarifsatz hinterlegt
      </AlertTitle>
      <AlertDescription>
        <p className="mb-3 text-text">
          Wir tragen die Netzentgelte je Netzbetreiber aus den Preisblättern nach; für diese
          Kombination liegt noch keiner vor. Einen Näherungswert setzen wir hier nicht ein — er sähe
          aus wie eine Angabe.
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

/**
 * Die Abfrage ist gar nicht durchgekommen — ein anderer Zustand als „es gibt keinen Satz".
 *
 * ── ⚠ ZWEI FEHLERARTEN, ZWEI MELDUNGEN — die Delta-15-Haltung, hier auf die Netzentgelt-Seite ──
 * `request_failed` ist VORÜBERGEHEND und liegt am Netz bzw. bei uns: ein zweiter Versuch kann ihn
 * beheben, deshalb steht ein Knopf daneben. `not_configured` ist ein EINRICHTUNGSFEHLER auf unserer
 * Seite: ein zweiter Versuch ändert daran nichts, und ein Wiederholen-Knopf, der nie hilft, ist eine
 * Requisite. Zusammengelegt bekäme der Nutzer für den einen Zustand die Antwort des anderen.
 *
 * ── ⚠ ES WIRD NICHT STILL FREIGESCHALTET UND NICHT AUF DEN KATALOG ZURÜCKGEFALLEN ──────────────
 * Ein Rückfall auf den statischen Katalog wäre die gefährlichste der drei Möglichkeiten: er lieferte
 * eine Zahl, die ihren Stand nicht kennt und die niemandem als veraltet auffiele — sondern als
 * Ergebnis. Dieselbe Begründung wie bei Delta 15 Regel C und bei Netzebene 7. Der Ausweg ist
 * derselbe wie oben: „Nicht angeben" wählen und die Werte von der Rechnung eintragen.
 */
export function NetzentgeltNichtAbrufbar({
  reason,
  onRetry,
}: {
  reason: 'not_configured' | 'request_failed'
  onRetry: () => void
}) {
  if (reason === 'not_configured') {
    return (
      <Alert variant="warning" data-testid="netzentgelt-nicht-eingerichtet">
        <Info className="h-4 w-4" />
        <AlertTitle>Die Netzentgelt-Daten sind gerade nicht eingerichtet</AlertTitle>
        <AlertDescription>
          <p className="mb-3 text-text">
            Wir können das Preisblatt zu Ihrem Netzbetreiber im Moment nicht nachschlagen. Das liegt
            an uns, nicht an Ihrer Eingabe — und ein zweiter Versuch ändert daran nichts. Einen
            Vorgabewert setzen wir hier nicht ein: er sähe aus wie ein nachgeschlagener Satz.
          </p>
          <p className="text-text">
            Sie kommen trotzdem weiter: Wählen Sie oben bei „Netzbetreiber“ den Eintrag „Nicht
            angeben — Werte aus meiner Netzrechnung“ und tragen Sie Leistungspreis und
            Abrechnungsmodell direkt von Ihrer Rechnung ein.
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert variant="warning" data-testid="netzentgelt-nicht-abrufbar">
      <Info className="h-4 w-4" />
      <AlertTitle>Das Preisblatt liess sich gerade nicht abrufen</AlertTitle>
      <AlertDescription>
        <p className="mb-3 text-text">
          Die Abfrage ist nicht durchgekommen — das ist etwas anderes als „für diese Kombination gibt
          es keinen Satz", und wir raten deshalb nicht. Versuchen Sie es noch einmal.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mb-3 inline-flex items-center gap-1 font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
          data-testid="netzentgelt-erneut-versuchen"
        >
          Erneut versuchen
        </button>
        <p className="text-text">
          Bleibt es dabei: Wählen Sie oben bei „Netzbetreiber“ den Eintrag „Nicht angeben — Werte aus
          meiner Netzrechnung“ und tragen Sie die Werte direkt von Ihrer Rechnung ein.
        </p>
      </AlertDescription>
    </Alert>
  )
}
