/**
 * DER ABLAUF EINER PARTNER-BENACHRICHTIGUNG (B16-4b).
 *
 * Diese Datei enthält die Entscheidungen; sie führt sie nicht selbst aus. Nachschlagen, Mailversand
 * und Vermerk kommen als `PartnerNotificationEffects` herein — dieselbe Aufteilung und dieselben
 * zwei Gründe wie bei `lib/partner-application/flow.ts` (B16-3) und `lib/leads/capture-flow.ts`
 * (B3-2): Sie bleibt REIN (kein `server-only`, kein Supabase-Client, kein Resend) und damit ohne
 * laufende Datenbank prüfbar, und die Aufrufer bleiben Verdrahtung.
 *
 * Genau die Eigenschaften, die dieser Bauabschnitt zusichert, lassen sich NUR hier messen:
 *
 * ── 1. ⚠ DIESER ABLAUF WIRFT NIE. DAS IST DIE ZUSAGE, NICHT EIN NEBENEFFEKT ─────────────────────
 * Er hängt an einem Vorgang, der nicht scheitern darf: Die Genehmigung (B16-4a) ist eine einzige,
 * unumkehrbare Transaktion — sie legt den Fachbetrieb an, verknüpft Konto und Antrag und setzt den
 * Status. Ist sie durch, ist sie durch; ein Kurz-Key ist danach unveränderlich und ein zweiter
 * Versuch gäbe `already_reviewed`. Ein Fehler beim Mailversand darf deshalb unter keinen Umständen
 * als Fehler der Genehmigung zurückkommen — der Admin läse „hat nicht geklappt", der Betrieb wäre
 * trotzdem angelegt, und die naheliegende Reaktion (nochmal versuchen) führte ins Leere.
 *
 * Jeder Fehlschlag wird deshalb zu einem ZUSTAND, den der Aufrufer benennen kann. Es gibt hier
 * keinen `throw` und kein `catch`, das etwas verschluckt — die Effekte selbst sind so gebaut, dass
 * sie nicht werfen (s. `notify-server.ts`).
 *
 * ── 2. OHNE KONTO GEHT KEINE MAIL RAUS ──────────────────────────────────────────────────────────
 * Die Nachricht verweist auf ein Portal, das eine Anmeldung verlangt. Ohne verknüpftes Konto gibt es
 * diese Anmeldung nicht — und es gibt nicht einmal eine Adresse, an die zu senden wäre
 * (`account_email` kommt aus `auth.users` über `user_id`). Der Fall ist real: von Hand angelegte
 * Betriebe (Raymann) haben zunächst keins, und ein gelöschtes Konto nullt die Spalte
 * (`on delete set null`, B16-4a). Die Datenbank weist denselben Fall ein zweites Mal ab
 * (`admin_mark_partner_notified` → `no_account`); das ist keine Verdopplung, sondern die Schicht,
 * die auch dann hält, wenn jemand den Vermerk anders auslöst.
 *
 * ── 3. ERST SENDEN, DANN VERMERKEN — NIE UMGEKEHRT ──────────────────────────────────────────────
 * `notified_at` behauptet eine ZUGESTELLTE Nachricht. Vor dem Versand gesetzt stünde der Vermerk
 * ausgerechnet dann auf „benachrichtigt", wenn der Versand gleich darauf scheitert — und genau die
 * Unterscheidung, für die die Spalte existiert („wurde informiert und meldet sich nicht" gegen „hat
 * nie eine Mail bekommen"), wäre verloren.
 *
 * ── 4. „MAIL RAUS, VERMERK NICHT GESETZT" IST EIN EIGENER ZUSTAND ───────────────────────────────
 * Er sieht im Bestand aus wie „nie benachrichtigt", ist es aber nicht: Die Nachricht liegt bereits
 * im Postfach des Betriebs. Ihn mit `send_failed` zusammenzufassen wäre die eine Zusammenfassung,
 * die real Schaden anrichtet — die Oberfläche riete zum erneuten Senden, und der Betrieb bekäme
 * dieselbe Mail ein zweites Mal. Er bekommt deshalb einen eigenen Wert und einen eigenen Satz.
 */

/**
 * Wer benachrichtigt werden soll — so, wie `public.admin_list_partners` es liefert.
 *
 * `accountEmail` ist die Adresse des VERKNÜPFTEN KONTOS, nicht die aus dem Bewerbungsformular. Das
 * ist eine Entscheidung: Die Mail führt zu einem Portal, das an genau diesem Konto hängt, und eine
 * Einladung an eine Adresse zu schicken, die nicht die Anmeldung ist, wäre die verwirrendste
 * denkbare Auskunft („melden Sie sich an" — womit?). Sie hat ausserdem die angenehme Folge, dass
 * beide Wege (Genehmigung und erneutes Senden im Admin-Bereich) dieselbe Quelle benutzen.
 */
export type PartnerNotificationTarget = {
  slug: string
  displayName: string
  /** Für die Anrede. `null` ist zulässig — die Mail kommt dann ohne Namen aus. */
  contactFirstName: string | null
  /** `null` = kein verknüpftes Konto → es geht nichts raus (s. Regel 2 oben). */
  accountEmail: string | null
  /**
   * Ist dieser Betrieb aus einer BEWERBUNG entstanden (`application_id`), oder von Hand angelegt?
   *
   * Der Unterschied betrifft genau einen Satz der Mail — den über das Passwort. Wer sich beworben
   * hat, hat dabei eines gesetzt; Raymann, der von Hand aufgenommen wurde und dessen Konto
   * nachträglich verknüpft ist, hat das nicht. Ihm zu schreiben, er solle „das bei der Bewerbung
   * gesetzte Passwort" verwenden, wäre eine Aussage über einen Vorgang, den es nie gab — und die
   * naheliegende Folge ein Anruf, weil ein Passwort nicht funktioniert, das niemand vergeben hat.
   * Dieselbe Sorte Fallunterscheidung wie `accountCreated` in der Eingangsbestätigung (B16-3).
   */
  fromApplication: boolean
  /**
   * Die Kennung des verknüpften Kontos (B18-2a) — gebraucht, um den Aktivierungstoken der RICHTIGEN
   * Zeile zuzuordnen.
   *
   * `null` heisst dasselbe wie eine fehlende `accountEmail`: kein Konto, keine Mail. Beide Felder
   * kommen aus derselben Zeile von `admin_list_partners` und werden gemeinsam gesetzt oder
   * gemeinsam genullt (`on delete set null`, B16-4a).
   */
  userId: string | null
}

/**
 * Was am Ende herausgekommen ist. Fünf Werte, weil fünf verschiedene Handlungen folgen:
 *
 *   `sent`             Nichts zu tun.
 *   `unknown_partner`  Den Betrieb gibt es nicht (mehr) — Seite neu laden.
 *   `no_account`       Erst ein Konto verknüpfen, dann erneut senden.
 *   `send_failed`      Erneut senden (die Mail ist NICHT raus).
 *   `not_recorded`     ⚠ NICHT erneut senden — die Mail IST raus, nur der Vermerk fehlt.
 */
export type PartnerNotificationOutcome =
  | { status: 'sent' }
  | { status: 'unknown_partner' }
  | { status: 'no_account' }
  | { status: 'send_failed' }
  | { status: 'not_recorded' }

export type PartnerNotificationEffects = {
  /** Schlägt den Fachbetrieb nach. `null` = gibt es nicht (mehr). Wirft nicht. */
  loadTarget: (slug: string) => Promise<PartnerNotificationTarget | null>
  /**
   * Erzeugt den Aktivierungslink (B18-2a). `null` = konnte nicht erzeugt werden. Wirft nicht.
   *
   * `alreadyConfirmed` sagt, ob das Konto überhaupt noch freizuschalten IST — der Link entsteht
   * trotzdem und wird bei einem bestätigten Konto schlicht nicht in die Mail genommen (er würde
   * dort einen Schritt ankündigen, den es für diesen Empfänger nicht gibt).
   */
  createActivationLink: (input: {
    email: string
    userId: string
  }) => Promise<{ url: string; alreadyConfirmed: boolean } | null>
  /** Versendet die Benachrichtigung. Wirft nicht. */
  sendMail: (input: {
    to: string
    firstName: string | null
    displayName: string
    slug: string
    fromApplication: boolean
    /** `null` = das Konto ist bereits bestätigt; die Mail lässt den Aktivierungsblock dann weg. */
    activationUrl: string | null
  }) => Promise<{ ok: boolean }>
  /**
   * Hält den erfolgten Versand fest (`public.admin_mark_partner_notified`). Wirft nicht.
   *
   * Der Rückgabewert wird bewusst nicht ausdifferenziert: Ob der Vermerk an einem fehlenden
   * Fachbetrieb, an einem fehlenden Konto oder an der Erreichbarkeit scheiterte, ändert für den
   * Aufrufer nichts — die Mail ist in jedem dieser Fälle bereits unterwegs, und genau das ist die
   * Auskunft, die zählt.
   */
  markNotified: (slug: string) => Promise<boolean>
}

/**
 * Benachrichtigt einen Fachbetrieb über seinen Portalzugang. WIRFT NIE (Regel 1).
 */
export async function notifyPartner(
  slug: string,
  effects: PartnerNotificationEffects,
): Promise<PartnerNotificationOutcome> {
  const target = await effects.loadTarget(slug)
  if (!target) return { status: 'unknown_partner' }

  const to = target.accountEmail?.trim()
  if (!to || !target.userId) return { status: 'no_account' }

  /*
   * ⚠ DER AKTIVIERUNGSLINK ENTSTEHT VOR DER MAIL — UND SEIN FEHLSCHLAG VERHINDERT SIE (B18-2a).
   *
   * Seit die Bewerbung das Konto UNBESTÄTIGT anlegt (`lib/auth/admin-api.ts`), ist dieser Link der
   * einzige Weg hinein. Eine Freischaltungsmail ohne ihn wäre die Einladung in einen Zugang, der
   * sich nicht öffnen lässt: Der Fachbetrieb probierte sein Passwort, bekäme „E-Mail nicht
   * bestätigt" und hätte nichts in der Hand — und weil die Mail nun einmal draussen wäre, sähe der
   * Admin-Bereich anschliessend „benachrichtigt".
   *
   * Deshalb `send_failed` und ausdrücklich KEIN eigener sechster Status: Für den Admin ist die
   * Handlung dieselbe wie bei einem fehlgeschlagenen Versand — erneut senden. Ein zusätzlicher Wert
   * wäre eine Unterscheidung, die niemand anders benutzt. Was die beiden Fälle trennt, steht im
   * Server-Log (`lib/auth/admin-api.ts` loggt den Grund).
   */
  const activation = await effects.createActivationLink({ email: to, userId: target.userId })
  if (!activation) return { status: 'send_failed' }

  const sent = await effects.sendMail({
    to,
    firstName: target.contactFirstName?.trim() || null,
    displayName: target.displayName,
    slug: target.slug,
    fromApplication: target.fromApplication,
    /*
     * Bei einem BEREITS bestätigten Konto fährt der Link nicht mit. Das ist kein Sonderfall der
     * Bequemlichkeit: „Bitte schalten Sie Ihren Zugang frei" an jemanden, der längst hineinkommt,
     * ist eine Aufforderung zu einem Schritt, den es für ihn nicht gibt — und der naheliegende
     * Anruf käme ausgerechnet von dem Betrieb, bei dem alles in Ordnung ist.
     */
    activationUrl: activation.alreadyConfirmed ? null : activation.url,
  })
  // Regel 3: der Vermerk entsteht NUR nach erfolgreicher Zustellung.
  if (!sent.ok) return { status: 'send_failed' }

  // Regel 4: ab hier ist die Mail draussen — jeder weitere Fehlschlag ändert daran nichts mehr.
  const recorded = await effects.markNotified(target.slug)
  return recorded ? { status: 'sent' } : { status: 'not_recorded' }
}
