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
 * 2. DIE RÜCKMELDUNG IST IN ALLEN FÄLLEN IDENTISCH. Bestehendes Konto, frische Adresse, zweite
 *    Bewerbung derselben Firma, gescheiterte Kontoanlage, gescheiterter Mailversand, gefüllter
 *    Honeypot: immer `ACCEPTED`. Unterschieden wird ausschliesslich, was der Absender selbst sieht
 *    und ändern kann — seine eigenen Feldeingaben.
 *
 * 3. DIE KONTOANLAGE DARF DIE BEWERBUNG NIE UMWERFEN. Jeder Fehler von `createAccount` wird
 *    verschluckt und geloggt; der Antrag entsteht trotzdem. GEMESSEN gegen den lokalen Stack (nicht
 *    aus der Doku abgeleitet): GoTrue antwortet auf einen `signUp` mit einer bereits registrierten,
 *    bestätigten Adresse mit **HTTP 422 `user_already_exists`** und auf einen zweiten Versuch
 *    innerhalb der Sperrfrist mit **HTTP 429 `over_email_send_rate_limit`**. Beide Antworten
 *    VERRATEN die Existenz — sie werden deshalb nicht ausgewertet, sondern verworfen. Das
 *    Passwort des bestehenden Kontos bleibt dabei unangetastet (ebenfalls gemessen: die Anmeldung
 *    mit dem alten Passwort funktioniert danach unverändert, die mit dem neu eingegebenen nicht).
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

export type StoredApplication = { applicationId: string }

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
       * Regel 3: Die Kontoanlage darf die Bewerbung nie umwerfen. Die Adresse steht bewusst NICHT
       * im Log-Text — ein Fehlerlog ist kein zulässiger zweiter Speicherort für Personenbezug.
       */
      console.error(
        '[partner-application] Kontoanlage fehlgeschlagen — Antrag entsteht trotzdem:',
        cause,
      )
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
     * DER EINZIGE FALL, IN DEM DIE SEITE KEINEN ERFOLG MELDET. Er ist kein Enumerationssignal: Er
     * hängt an der Erreichbarkeit der Datenbank, nicht an der Adresse — dieselbe Eingabe liefe
     * eine Minute später durch. Und die Alternative wäre die schlimmere: ein „Danke, wir melden
     * uns" für eine Bewerbung, die nirgends steht.
     */
    console.error('[partner-application] Antrag konnte nicht gespeichert werden:', cause)
    return { ok: false, error: 'unavailable' }
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
