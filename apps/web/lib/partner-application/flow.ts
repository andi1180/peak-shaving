/**
 * DER ABLAUF EINER PARTNER-BEWERBUNG (B16-3).
 *
 * Diese Datei enthält die Entscheidungen; sie führt sie nicht selbst aus. Kontoanlage, Datenbank und
 * Mailversand kommen als `PartnerApplicationEffects` herein. Zwei Gründe — dieselben wie bei
 * `lib/leads/capture-flow.ts` (B3-2):
 *
 *   1. Sie bleibt REIN (kein `server-only`, kein Supabase-Client, kein Resend) und damit ohne
 *      laufende Datenbank prüfbar. Genau die Eigenschaften, die dieser Bauabschnitt zusichert —
 *      kein Lead, identische Rückmeldung bei bestehendem Konto, Antrag überlebt Mailausfall,
 *      Honeypot erzeugt nichts —, lassen sich NUR hier messen.
 *   2. Die Server Action (`actions.ts`) bleibt Verdrahtung.
 *
 * ── VIER REGELN, DIE HIER UND NUR HIER STEHEN ────────────────────────────────────────────────────
 *
 * 1. ES ENTSTEHT KEIN LEAD. Der Registrierungsweg schreibt seit B10-5 automatisch einen
 *    (`captureRegistrationLead`); dieser Ablauf ruft ihn ausdrücklich NICHT auf, und es gibt in
 *    `PartnerApplicationEffects` gar kein Feld dafür. Ein Fachbetrieb, der Vertriebspartner werden
 *    will, ist kein Peak-Shaving-Interessent — mitgezählt verfälschte er genau die Kennzahl, an der
 *    die Marktnachfrage gemessen wird (Ziel 500 Kontakte), und zwar unbemerkt, weil die Zeile
 *    plausibel aussieht.
 *
 * 2. DIE RÜCKMELDUNG KENNT GENAU ZWEI AUSGÄNGE, UND KEINER VON BEIDEN NENNT EINEN GRUND.
 *    Bestehendes Konto, frische Adresse, zweite Bewerbung derselben Firma, gescheiterter
 *    Mailversand, gefüllter Honeypot: immer `ACCEPTED`. Entsteht KEIN Antrag (Datenbank nicht
 *    erreichbar oder kein Konto auflösbar, s. Regel 3), immer dieselbe neutrale
 *    Wiederholungsmeldung — ohne Nennung von Ratenlimit, Konto, Adresse oder technischem Grund.
 *    Unterschieden wird darüber hinaus ausschliesslich, was der Absender selbst sieht und ändern
 *    kann: seine eigenen Feldeingaben.
 *
 * 3. ⚠ EINE BEWERBUNG ENTSTEHT NIE OHNE AUFGELÖSTES KONTO (Nachbesserung, 26.07.2026). Jeder
 *    Fehler von `createAccount` wird weiterhin verschluckt und geloggt — dieser Ablauf wertet ihn
 *    NICHT aus. GEMESSEN gegen den lokalen Stack (nicht aus der Doku abgeleitet): GoTrue antwortet
 *    auf einen `signUp` mit einer bereits registrierten, bestätigten Adresse mit **HTTP 422
 *    `user_already_exists`** und auf einen Versuch innerhalb der Sperrfrist des Mailversands mit
 *    **HTTP 429 `over_email_send_rate_limit`**. Beide Antworten VERRATEN die Existenz; hier sind
 *    sie zudem gar nicht auseinanderzuhalten — in beiden Fällen meldet `createAccount` schlicht
 *    `false`.
 *
 *    Die Unterscheidung, auf die es ankommt, trifft deshalb die DATENBANK: `storeApplication` löst
 *    die Adresse auf und meldet `no_account`, wenn dabei kein Konto herauskommt. Genau dann
 *    entsteht KEIN Antrag. Vorher entstand er unverknüpft — und war damit ein Antrag, der zu keinem
 *    Login führt, in B16-4a nicht genehmigbar ist und dem Bewerber trotzdem „Danke, wir melden
 *    uns" gemeldet hat (in Produktion real aufgetreten, Ursache das Rate-Limit oben).
 *
 *    AUSDRÜCKLICH UNVERÄNDERT: Hat die Adresse BEREITS ein Konto, wird es aufgelöst, der Antrag
 *    entsteht und hängt daran; das Passwort des bestehenden Kontos bleibt unangetastet (ebenfalls
 *    gemessen: die Anmeldung mit dem alten Passwort funktioniert danach unverändert, die mit dem
 *    neu eingegebenen nicht). Das ist kein Fehlerfall und darf nicht mit dem Abbruch vermischt
 *    werden.
 *
 * 4. EIN GESCHEITERTER MAILVERSAND KOSTET KEINE BEWERBUNG. Erst speichern, dann senden. Eine
 *    verlorene Benachrichtigung ist ärgerlich; eine verlorene Bewerbung ist ein Betrieb, der nie
 *    wieder anfragt.
 */

import {
  partnerApplicationSchema,
  toFieldErrors,
  type PartnerApplicationFieldErrors,
} from './schema'
import { PARTNER_APPLICATION_PASSWORD_MIN } from './config'

/* ─── Rückmeldung ─────────────────────────────────────────────────────────────────────────────── */

export type PartnerApplicationResponse =
  | { ok: true }
  /** Der Absender kann es selbst beheben — deshalb feldgenau. */
  | { ok: false; error: 'validation'; fieldErrors: PartnerApplicationFieldErrors }
  /** Bot-Prüfung oder ein Ausfall, den der Absender nicht beheben kann. Neutral. */
  | { ok: false; error: 'turnstile' | 'unavailable' }

/**
 * DIE EINE ERFOLGSANTWORT — als Konstante, damit kein Pfad versehentlich eine zweite Form erfindet.
 * Sie ist der Kern des Enumerationsschutzes: Wer sie an sechs Stellen neu schriebe, könnte an einer
 * davon ein zusätzliches Feld mitgeben.
 */
const ACCEPTED: PartnerApplicationResponse = { ok: true }

/**
 * DIE EINE ABBRUCH-ANTWORT — aus demselben Grund eine Konstante.
 *
 * Sie steht für ZWEI Ursachen, die der Absender beide nicht zu verantworten hat und beide nicht
 * unterscheiden können soll: die Datenbank war nicht erreichbar, ODER es liess sich kein Konto zu
 * seiner Adresse auflösen (weil die Kontoanlage scheiterte). Zwei Antworten wären zwei Signale —
 * und das zweite wäre eine Auskunft darüber, ob es zu einer Adresse ein Konto gibt. Der Unterschied
 * gehört ins Server-Log, nicht in die Rückgabe.
 */
const UNAVAILABLE: PartnerApplicationResponse = { ok: false, error: 'unavailable' }

/* ─── Effekte ─────────────────────────────────────────────────────────────────────────────────── */

export type PartnerApplicationSubmission = {
  company?: string
  firstName?: string
  lastName?: string
  email?: string
  password?: string
  phone?: string
  websiteUrl?: string
  message?: string
  datenschutz?: boolean
  /** Honeypot — s. `components/partner/partner-application-form.tsx`. */
  website?: string
  turnstileToken?: string
}

export type PartnerApplicationSession = {
  /** Die laufende Sitzung, falls es eine gibt. */
  userId: string
  /** Die Adresse des angemeldeten Kontos — die Bewerbung läuft dann darüber. */
  email: string
}

export type StoredApplication =
  | { stored: true; applicationId: string }
  /**
   * Es liess sich kein Konto zur Adresse auflösen — es ist KEIN Antrag entstanden.
   *
   * Die Unterscheidung trifft die Datenbank und nicht dieser Ablauf: `createAccount` meldet bei
   * „Adresse hat schon ein Konto" und bei „Kontoanlage fehlgeschlagen" denselben Wert (`false`),
   * und genau das soll so bleiben (Regel 3). Was die beiden Fälle trennt, ist allein, ob am Ende
   * ein Konto DA ist — und das weiss nur, wer die Adresse nachschlägt.
   */
  | { stored: false; reason: 'no_account' }

export type PartnerApplicationEffects = {
  /**
   * Legt ein Konto an. Gibt `true` zurück, wenn eines ENTSTANDEN ist — sonst `false`.
   *
   * ⚠ DER RÜCKGABEWERT DARF NICHT ZUR UNTERSCHEIDUNG NACH AUSSEN BENUTZT WERDEN. Er dient
   * ausschliesslich dem Log und dem Wortlaut der Eingangsbestätigung („bestehendes Passwort"). Wer
   * daraus eine sichtbare Verzweigung baute, hätte den Enumerationsschutz aufgegeben.
   */
  createAccount: (input: { email: string; password: string }) => Promise<boolean>
  /** Schreibt den Antrag. WIRFT bei einem Infrastrukturfehler. */
  storeApplication: (input: {
    company: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
    website: string | null
    message: string
    /** Die laufende Sitzung — sonst löst die Datenbank über die Adresse auf. */
    userId: string | null
  }) => Promise<StoredApplication>
  /** Interne Benachrichtigung an COOLiN. Wirft nicht. */
  notifyTeam: (input: {
    applicationId: string
    company: string
    firstName: string
    lastName: string
    email: string
    phone: string | null
    website: string | null
    message: string
    hasSession: boolean
  }) => Promise<unknown>
  /** Eingangsbestätigung an den Bewerber. Wirft nicht. */
  acknowledgeApplicant: (input: {
    to: string
    firstName: string
    /**
     * War der Bewerber schon angemeldet ODER besteht die Adresse bereits? Dann wurde KEIN neues
     * Passwort gesetzt, und die Mail sagt das — sonst wartete jemand auf eine Bestätigungsmail, die
     * nie kommt, und probierte ein Passwort, das nie gesetzt wurde.
     */
    accountCreated: boolean
  }) => Promise<unknown>
}

/* ─── Ablauf ──────────────────────────────────────────────────────────────────────────────────── */

/**
 * Nimmt eine Bewerbung entgegen. Wirft NIE.
 *
 * @param session Die laufende Sitzung, falls angemeldet. Dann entsteht KEIN zweites Konto und die
 *   Bewerbung wird mit diesem Konto verknüpft — auch wenn eine abweichende Kontaktadresse im
 *   Formular steht (die Zuordnung folgt der Sitzung, die Korrespondenz der Angabe).
 */
export async function runPartnerApplication(
  submission: PartnerApplicationSubmission,
  effects: PartnerApplicationEffects,
  session: PartnerApplicationSession | null,
): Promise<PartnerApplicationResponse> {
  /*
   * HONEYPOT — immer aktiv, unabhängig von Turnstile.
   *
   * ⚠ BEWUSSTE ABWEICHUNG VOM KONTAKTFORMULAR: Dort wird ein gefüllter Honeypot mit HTTP 400
   * ABGELEHNT, ausdrücklich gegen die Lehrbuch-Empfehlung („nie verraten, dass die Falle
   * zuschnappte") — weil ein stiller Erfolg einen echten Menschen, den ein Autofill erwischt hat,
   * unwiederbringlich verlöre.
   *
   * Hier gilt das Gegenteil, und zwar aus einem Grund, den es dort nicht gibt: Diese Seite darf
   * NIEMALS eine Antwort geben, die sich von der Erfolgsantwort unterscheidet — sonst hat ein
   * Angreifer ein Signal, an dem er Verhalten festmachen kann. Der Preis (ein fälschlich
   * gefangener Mensch sieht Erfolg) wird an zwei Stellen bezahlt: Die Erfolgsmeldung auf der Seite
   * UND die Eingangsbestätigung nennen die Kontaktadresse, unter der man sich melden kann, wenn
   * binnen weniger Minuten keine Mail eintrifft. Das ausbleibende Echo ist damit die Rückmeldung.
   */
  if (typeof submission.website === 'string' && submission.website.trim() !== '') {
    console.warn('[partner-application] Honeypot gefüllt — Bewerbung verworfen.')
    return ACCEPTED
  }

  /*
   * Angemeldet? Dann kommt die Adresse aus der Sitzung und es gibt weder Passwortfeld noch
   * Kontoanlage. Der Wert wird eingesetzt, BEVOR geprüft wird: Das Formular sendet in diesem Fall
   * gar keine Adresse, und eine Pflichtfeldmeldung zu einem Feld, das niemand sieht, wäre eine
   * Sackgasse.
   */
  const parsed = partnerApplicationSchema.safeParse(
    session ? { ...submission, email: session.email, password: undefined } : submission,
  )
  if (!parsed.success) {
    return { ok: false, error: 'validation', fieldErrors: toFieldErrors(parsed.error.issues) }
  }

  const data = parsed.data

  /*
   * Das Passwort ist NUR im anonymen Fall Pflicht. Die Prüfung steht hier und nicht im Schema, weil
   * das Schema nicht weiss, ob eine Sitzung läuft — und ein zweites Schema für denselben Vorgang
   * wäre genau die Doppelung, die `schema.ts` vermeidet.
   */
  if (
    !session &&
    (data.password === undefined || data.password.length < PARTNER_APPLICATION_PASSWORD_MIN)
  ) {
    return { ok: false, error: 'validation', fieldErrors: { password: 'passwordTooShort' } }
  }

  let accountCreated = false
  if (!session && data.password) {
    try {
      accountCreated = await effects.createAccount({ email: data.email, password: data.password })
    } catch (cause) {
      /*
       * Der Fehler wird weiterhin NICHT ausgewertet — er verriete, ob es die Adresse schon gibt
       * (Regel 3). Ob die Bewerbung entstehen kann, entscheidet gleich die Datenbank daran, ob am
       * Ende ein Konto DA ist; nicht daran, warum die Anlage schiefging. Die Adresse steht bewusst
       * NICHT im Log-Text — ein Fehlerlog ist kein zulässiger zweiter Speicherort für Personenbezug.
       */
      console.error('[partner-application] Kontoanlage fehlgeschlagen:', cause)
    }
  }

  let stored: StoredApplication
  try {
    stored = await effects.storeApplication({
      company: data.company,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone?.trim() || null,
      website: data.websiteUrl?.trim() || null,
      message: data.message,
      /*
       * Die Sitzung wird durchgereicht, die Auflösung über die Adresse macht die DATENBANK
       * (`public.submit_partner_application`). Sie gehört dorthin, weil ihr Ergebnis hier nichts
       * verloren hat: Was der Anwendungscode nicht erfährt, kann er auch nicht nach aussen geben.
       */
      userId: session?.userId ?? null,
    })
  } catch (cause) {
    /*
     * Der erste der beiden Abbruchgründe: die Datenbank war nicht erreichbar. Kein
     * Enumerationssignal — er hängt an der Erreichbarkeit, nicht an der Adresse, dieselbe Eingabe
     * liefe eine Minute später durch. Und die Alternative wäre die schlimmere: ein „Danke, wir
     * melden uns" für eine Bewerbung, die nirgends steht.
     */
    console.error('[partner-application] Antrag konnte nicht gespeichert werden:', cause)
    return UNAVAILABLE
  }

  if (!stored.stored) {
    /*
     * ⚠ DER ZWEITE ABBRUCHGRUND, UND DER EIGENTLICHE ANLASS DIESER NACHBESSERUNG: Es liess sich
     * kein Konto zur Adresse auflösen, also ist die Kontoanlage gescheitert (bei einer bereits
     * bestehenden Adresse hätte die Datenbank das vorhandene Konto gefunden — dieser Fall läuft
     * unverändert durch). Es ist KEIN Antrag entstanden, und es geht auch keine Mail raus: eine
     * Eingangsbestätigung für eine Bewerbung, die nirgends steht, wäre genau die falsche Zusage.
     *
     * Der Bewerber sieht dieselbe neutrale Wiederholungsmeldung wie beim Datenbankausfall. Der
     * UNTERSCHIED steht hier im Log, weil er für den Betrieb wesentlich ist: Häufen sich diese
     * Zeilen, hängt der Mailversand am Rate-Limit (Auth-SMTP), und das ist eine Konfiguration, die
     * jemand ändern muss — nichts, was ein Wiederholungsversuch im Code beheben könnte.
     *
     * Die Adresse steht bewusst NICHT im Log (kein zweiter Speicherort für Personenbezug); die
     * Firma des Betriebs auch nicht — sie identifiziert ihn genauso.
     */
    console.error(
      '[partner-application] KEIN Antrag entstanden: kein Konto zur Adresse auflösbar. Die ' +
        'Kontoanlage ist gescheitert — häufigste Ursache ist das Rate-Limit des Auth-Mailversands ' +
        '(429 over_email_send_rate_limit). Der Bewerber wurde auf einen erneuten Versuch verwiesen.',
    )
    return UNAVAILABLE
  }

  /*
   * Regel 4: erst gespeichert, dann benachrichtigt. Beide Versandwege werfen nicht; ein Fehlschlag
   * steht laut im Log und ändert an der Rückmeldung nichts.
   */
  await effects.notifyTeam({
    applicationId: stored.applicationId,
    company: data.company,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email,
    phone: data.phone?.trim() || null,
    website: data.websiteUrl?.trim() || null,
    message: data.message,
    hasSession: Boolean(session),
  })

  await effects.acknowledgeApplicant({
    to: data.email,
    firstName: data.firstName,
    accountCreated,
  })

  return ACCEPTED
}
