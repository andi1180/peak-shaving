'use server'

/**
 * DIE SERVER ACTION DER KALKULATOR-ANFRAGE (B18-4, Portal-Oberfläche).
 *
 * Reine Verdrahtung: Formularwert einlesen, `submitCalculatorRequest` aufrufen (das ist der Ablauf
 * samt interner Benachrichtigung, B18-4-Schreibweg), das Ergebnis in einen Anzeigezustand
 * übersetzen. Es entsteht KEIN zweiter Weg in die Datenbank und keine zweite Fehlerpolitik.
 *
 * ── ⚠ `already_pending` IST KEIN FEHLER DES BETRIEBS ────────────────────────────────────────────
 * Er entsteht real ohne jedes Fehlverhalten: zwei offene Tabs, ein Doppelklick, oder die Seite
 * wurde geladen, bevor eine Anfrage aus einem anderen Tab durch war. Ihn als generischen Fehler
 * anzuzeigen („hat nicht geklappt") wäre die falsche Auskunft — es HAT geklappt, nur nicht durch
 * diesen Klick. Die Antwort trägt deshalb den eigenen Zustand samt Zeitpunkt der BESTEHENDEN
 * Anfrage (den liefert der Wrapper mit, genau dafür), und die Seite sagt, seit wann sie offen ist.
 *
 * ── ⚠ HIER STEHT NUR DIE ASYNC FUNKTION, SONST NICHTS ──────────────────────────────────────────
 * Zustandstyp und Startwert liegen in `calculator-request-form-state.ts`: Eine `'use server'`-Datei
 * darf ausschliesslich async Funktionen exportieren, und ein Wert daneben bricht ERST ZUR LAUFZEIT
 * (Build, Typecheck und Lint laufen durch) — gemessen, Begründung dort.
 *
 * ── DIE PARTNER-ANGABEN KOMMEN AUS `readPortal()` DERSELBEN ANFRAGE ─────────────────────────────
 * Sie wandern NUR in die interne Benachrichtigungsmail; die Zuordnung der Anfrage entsteht in der
 * Datenbank aus `auth.uid()` (der Wrapper hat gar keinen Parameter dafür). Ein manipulierter Wert
 * kann also die Zeile nicht umhängen — er könnte höchstens die Betreffzeile einer internen Mail
 * verfälschen. Deshalb wird er trotzdem nicht aus dem Formular gelesen, sondern hier serverseitig
 * neu bestimmt: was die Datenbank schreibt und was in der Mail steht, soll aus derselben Sitzung
 * stammen.
 */
import { revalidatePath } from 'next/cache'
import { PORTAL_KALKULATOR_PATH } from '@/lib/portal-host'
import { readPortal } from './read'
import { submitCalculatorRequest } from './calculator-request-server'
import type { CalculatorRequestFormState } from './calculator-request-form-state'

export async function submitCalculatorRequestAction(
  _prev: CalculatorRequestFormState,
  formData: FormData,
): Promise<CalculatorRequestFormState> {
  const message = String(formData.get('begruendung') ?? '')

  const portal = await readPortal()
  /*
   * Ohne Sitzung oder ohne aktive Partnerzeile gibt es nichts einzureichen — und der Wrapper
   * antwortete ohnehin `none`. Hier abzubrechen spart den Rundlauf und, wichtiger: es verhindert
   * einen Mailversand mit leeren Partner-Angaben.
   */
  if (!portal || portal.state.state !== 'partner') return { status: 'none' }

  const outcome = await submitCalculatorRequest({
    message,
    partnerSlug: portal.state.partner.slug,
    partnerDisplayName: portal.state.partner.displayName,
    accountEmail: portal.email,
  })

  switch (outcome.status) {
    case 'ok':
      // Die Seite liest ihren Zustand beim nächsten Rendern neu (`get_my_calculator_request`) und
      // zeigt dann den Wartezustand — es gibt bewusst keine zweite, hier zusammengebaute Fassung
      // davon, seit wann die Anfrage offen ist.
      revalidatePath(PORTAL_KALKULATOR_PATH)
      return { status: 'ok' }
    case 'already_pending':
      /*
       * Kein Fehler (s. Kopf) — und ebenfalls neu rendern: Im Browserlauf gemessen zeigt der
       * zweite Tab danach den WARTEZUSTAND mit Zeitpunkt und eigener Begründung. Das ist die
       * vollständigere Auskunft als jeder Hinweis im Formular; der Rückgabewert dient nur noch
       * dazu, den Fall NICHT als Fehler zu behandeln.
       */
      revalidatePath(PORTAL_KALKULATOR_PATH)
      return { status: 'already_pending', createdAt: outcome.createdAt }
    case 'missing_fields':
      return { status: 'missing_fields', message }
    case 'message_too_long':
      return { status: 'message_too_long', maxLength: outcome.maxLength, message }
    case 'none':
      return { status: 'none' }
    case 'error':
      // Der getippte Text fährt zurück — er ist das Einzige, was hier verloren gehen kann.
      return { status: 'error', message }
  }
}
