/**
 * DER ABLAUF DER FREISCHALTUNGS-NACHRICHT EINER KALKULATOR-ANFRAGE (B18-4).
 *
 * Diese Datei enthält die Entscheidungen; sie führt sie nicht selbst aus. Nachschlagen, Mailversand
 * und Vermerk kommen als `CalculatorRequestNotificationEffects` herein — dieselbe Aufteilung und
 * dieselben zwei Gründe wie bei `lib/partner-portal/notify.ts` (B16-4b): Sie bleibt REIN (kein
 * `server-only`, kein Supabase-Client, kein Resend) und damit ohne laufende Datenbank prüfbar, und
 * die Aufrufer bleiben Verdrahtung.
 *
 * Genau die Eigenschaften, die dieser Bauabschnitt zusichert, lassen sich NUR hier messen:
 *
 * ── 1. ⚠ DIESER ABLAUF WIRFT NIE. DAS IST DIE ZUSAGE, NICHT EIN NEBENEFFEKT ─────────────────────
 * Er hängt an einem Vorgang, der bereits vollzogen ist: `public.admin_decide_calculator_request`
 * setzt Status UND Entitlement in EINER Transaktion. Ist sie durch, ist sie durch — der Betrieb hat
 * den Kalkulator, ein zweiter Versuch gäbe `already_reviewed`. Ein Fehler beim Mailversand darf
 * deshalb unter keinen Umständen als Fehler der FREIGABE zurückkommen: Der Admin läse „hat nicht
 * geklappt", der Zugang bestünde trotzdem, und die naheliegende Reaktion (nochmal freigeben) führte
 * ins Leere.
 *
 * Jeder Fehlschlag wird deshalb zu einem ZUSTAND, den der Aufrufer benennen kann. Es gibt hier
 * keinen `throw` und kein `catch`, das etwas verschluckt — die Effekte selbst sind so gebaut, dass
 * sie nicht werfen (s. `calculator-request-notify-server.ts`).
 *
 * ── 2. OHNE KONTO GEHT KEINE MAIL RAUS ──────────────────────────────────────────────────────────
 * Ohne verknüpftes Konto gibt es keine Adresse, an die zu senden wäre. Der Fall ist real: von Hand
 * angelegte Betriebe haben zunächst keins, und ein gelöschtes Konto nullt die Spalte
 * (`on delete set null`, B16-4a). Er ist hier allerdings NICHT der Regelfall — die Datenbank weist
 * eine Freigabe ohne Konto bereits mit `no_account` ab, dieser Ablauf läuft also nur an, wenn es
 * eines gab. Dass er den Fall trotzdem kennt, ist die Schicht darunter: Zwischen Freigabe und
 * Versand kann ein Konto gelöscht werden.
 *
 * ── 3. ERST SENDEN, DANN VERMERKEN — NIE UMGEKEHRT ──────────────────────────────────────────────
 * `notified_at` behauptet eine ZUGESTELLTE Nachricht. Vor dem Versand gesetzt stünde der Vermerk
 * ausgerechnet dann auf „benachrichtigt", wenn der Versand gleich darauf scheitert — und genau die
 * Unterscheidung, für die die Spalte existiert („weiss Bescheid" gegen „hat nie eine Mail
 * bekommen"), wäre verloren.
 *
 * ── 4. „MAIL RAUS, VERMERK NICHT GESETZT" IST EIN EIGENER ZUSTAND ───────────────────────────────
 * Er sieht im Bestand aus wie „nie benachrichtigt", ist es aber nicht: Die Nachricht liegt bereits
 * im Postfach des Betriebs. Ihn mit `send_failed` zusammenzufassen wäre die eine Zusammenfassung,
 * die real Schaden anrichtet — die Oberfläche riete zum erneuten Senden, und der Betrieb bekäme
 * dieselbe Mail ein zweites Mal.
 */

/**
 * Wer benachrichtigt werden soll — so, wie `public.admin_list_partners` es liefert.
 *
 * Der Empfänger wird NACHGESCHLAGEN und nicht übergeben (dieselbe Entscheidung wie in
 * `notify-server.ts`, B16-4b): Die Adresse kommt aus der Datenbank und nie aus einem Formularfeld.
 * Eine mitgeschickte Adresse könnte zu einem anderen Betrieb gehören als der Kurz-Key, und
 * `notified_at` stünde danach an der falschen Anfrage.
 */
export type CalculatorRequestTarget = {
  displayName: string
  /** Für die Anrede. `null` ist zulässig — die Mail kommt dann ohne Namen aus. */
  contactFirstName: string | null
  /** `null` = kein verknüpftes Konto → es geht nichts raus (s. Regel 2 oben). */
  accountEmail: string | null
}

/**
 * Was am Ende herausgekommen ist. Vier Werte, weil vier verschiedene Handlungen folgen:
 *
 *   `sent`             Nichts zu tun.
 *   `unknown_partner`  Den Betrieb gibt es nicht (mehr) — Seite neu laden.
 *   `no_account`       Erst ein Konto verknüpfen, dann erneut senden. Der ZUGANG besteht bereits.
 *   `send_failed`      Erneut senden (die Mail ist NICHT raus).
 *   `not_recorded`     ⚠ NICHT erneut senden — die Mail IST raus, nur der Vermerk fehlt.
 */
export type CalculatorRequestNotificationOutcome =
  | { status: 'sent' }
  | { status: 'unknown_partner' }
  | { status: 'no_account' }
  | { status: 'send_failed' }
  | { status: 'not_recorded' }

export type CalculatorRequestNotificationEffects = {
  /** Schlägt den Fachbetrieb nach. `null` = gibt es nicht (mehr). Wirft nicht. */
  loadTarget: (partnerSlug: string) => Promise<CalculatorRequestTarget | null>
  /** Versendet die Freischaltungsmail. Wirft nicht. */
  sendMail: (input: {
    to: string
    firstName: string | null
    displayName: string
  }) => Promise<{ ok: boolean }>
  /**
   * Hält den erfolgten Versand an der ANFRAGE fest
   * (`public.admin_mark_calculator_request_notified`). Wirft nicht.
   *
   * Der Rückgabewert wird bewusst nicht ausdifferenziert: Ob der Vermerk an einer fehlenden
   * Anfrage, an einem unpassenden Status oder an der Erreichbarkeit scheiterte, ändert für den
   * Aufrufer nichts — die Mail ist in jedem dieser Fälle bereits unterwegs, und genau das ist die
   * Auskunft, die zählt.
   */
  markNotified: (requestId: string) => Promise<boolean>
}

/**
 * Benachrichtigt einen Fachbetrieb über seinen freigeschalteten Kalkulator-Zugang. WIRFT NIE.
 */
export async function notifyCalculatorRequest(
  input: { requestId: string; partnerSlug: string },
  effects: CalculatorRequestNotificationEffects,
): Promise<CalculatorRequestNotificationOutcome> {
  const target = await effects.loadTarget(input.partnerSlug)
  if (!target) return { status: 'unknown_partner' }

  const to = target.accountEmail?.trim()
  if (!to) return { status: 'no_account' }

  const sent = await effects.sendMail({
    to,
    firstName: target.contactFirstName?.trim() || null,
    displayName: target.displayName,
  })
  // Regel 3: der Vermerk entsteht NUR nach erfolgreicher Zustellung.
  if (!sent.ok) return { status: 'send_failed' }

  // Regel 4: ab hier ist die Mail draussen — jeder weitere Fehlschlag ändert daran nichts mehr.
  const recorded = await effects.markNotified(input.requestId)
  return recorded ? { status: 'sent' } : { status: 'not_recorded' }
}
