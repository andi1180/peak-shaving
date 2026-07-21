/**
 * DER ABLAUF EINER ERFASSUNG (B3-2) — für alle Einstiegspunkte derselbe.
 *
 * Diese Datei enthält die Entscheidungen; sie führt sie nicht selbst aus. Datenbank, Mailversand
 * und Token-Erzeugung kommen als `LeadCaptureEffects` herein. Zwei Gründe:
 *
 *   1. Sie bleibt damit REIN (kein `server-only`, kein Supabase-Client, kein Resend) und ist ohne
 *      laufende Datenbank prüfbar — die drei anwendungsseitigen Pflichttests aus B3-2 (unbekannter
 *      Einstiegspunkt · mitgeschickter Zweck · identische Rückmeldung bei gesperrter und bei
 *      unbekannter Adresse) laufen genau hier, mit Attrappen statt Stack.
 *   2. Die Server Action (`capture-action.ts`) bleibt das, was sie sein soll: Verdrahtung.
 *
 * ── DREI REGELN, DIE HIER UND NUR HIER STEHEN ────────────────────────────────────────────────────
 *
 * 1. DER ZWECK KOMMT AUSSCHLIESSLICH AUS DER REGISTRY, geschlüsselt über den übergebenen
 *    `source_key`. Es gibt keinen Pfad, auf dem ein Zweck vom Client hereinkommt — der Contract
 *    (`LeadCaptureSubmission`) hat gar kein solches Feld. Andernfalls erzeugte ein manipulierter
 *    Aufruf eine Marketing-Einwilligung von einem Einstiegspunkt, der den Marketing-Text nie
 *    angezeigt hat; der Nachweis wäre wertlos, und zwar rückwirkend auch für die echten (weil ab
 *    dann keiner mehr von einem untergeschobenen unterscheidbar ist).
 *
 * 2. DIE RÜCKMELDUNG IST IN ALLEN FÄLLEN IDENTISCH — bei gesperrter Adresse, bei bereits laufender
 *    Bestätigung, bei einem Fehler der Datenbank und beim glatten Erfolg. Sie darf nie verraten, ob
 *    eine Adresse bekannt ist; sonst wäre jedes eingebettete Formular ein Auskunftsdienst über
 *    fremde Kontakte. Unterschieden wird ausschliesslich das, was der Absender selbst sieht und
 *    ändern kann: seine eigenen Feldeingaben.
 *
 * 3. VERZWEIGT WIRD STRIKT AM `outcome`, nie am Zweck. 'consent_created' heisst Bestätigungsmail,
 *    'consent_confirmed' heisst sofortige Lieferung — beides Aussagen der Datenbank über den
 *    Zustand, den sie gerade hergestellt hat. Eine zweite Auslegung von
 *    `purpose_requires_double_opt_in` in TypeScript wäre genau die Doppelung, die B3-2 abschafft.
 */

import type { CaptureResult } from './config'
import type { LeadConsentPurpose, LeadIndustry, LeadSourceKey } from './registry'
import type { QuickCalculatorInputs, QuickCalculatorResult } from '@/lib/schnellrechner'
import { computeQuickSaving } from '@/lib/schnellrechner'
import {
  parseLeadCapture,
  type LeadCaptureSubmission,
  type LeadCaptureValues,
  type LeadFieldErrors,
} from './capture-request'

/* ─── Rückmeldung ─────────────────────────────────────────────────────────────────────────────── */

export type LeadCaptureResponse =
  | { ok: true }
  /** Der Absender kann es selbst beheben — deshalb feldgenau. */
  | { ok: false; error: 'validation'; fieldErrors: LeadFieldErrors }
  /** Unbekannter/nicht vorgesehener Einstiegspunkt, Honeypot, Bot-Prüfung. Neutral. */
  | { ok: false; error: 'unavailable' | 'spam' | 'turnstile' }

/** Die EINE Erfolgsantwort. Als Konstante, damit kein Pfad versehentlich eine zweite Form erfindet. */
const ACCEPTED: LeadCaptureResponse = { ok: true }

/* ─── Effekte ─────────────────────────────────────────────────────────────────────────────────── */

export type ConfirmationToken = { token: string; tokenHash: string; expiresAt: Date }

export type CaptureLeadCall = {
  email: string
  sourceKey: LeadSourceKey
  purpose: LeadConsentPurpose | null
  tokenHash: string | null
  tokenExpiresAt: Date | null
  company?: string | null
  contactName?: string | null
  phone?: string | null
  industry?: LeadIndustry | null
  postalCode?: string | null
  annualConsumptionKwh?: number | null
  supplier?: string | null
  contractEndDate?: string | null
  sourceIp: string | null
  userAgent: string | null
  locale: string
}

export type LeadCaptureEffects = {
  captureLead: (input: CaptureLeadCall) => Promise<CaptureResult>
  /** Der jüngste Wortlaut aus `platform.consent_texts` — `null`, wenn keine Fassung existiert. */
  getConsentText: (purpose: LeadConsentPurpose, locale: string) => Promise<string | null>
  createToken: () => ConfirmationToken
  sendConfirmationMail: (input: {
    to: string
    consentText: string
    token: string
    locale: string
  }) => Promise<unknown>
  sendResultMail: (input: {
    to: string
    locale: string
    inputs: QuickCalculatorInputs
    result: QuickCalculatorResult
  }) => Promise<unknown>
}

export type LeadCaptureContext = {
  locale: string
  sourceIp: string | null
  userAgent: string | null
}

/* ─── Ablauf ──────────────────────────────────────────────────────────────────────────────────── */

/** Nutzereingabe → die Parameter, die `capture_lead` versteht. */
function fieldsToCall(values: LeadCaptureValues): Partial<CaptureLeadCall> {
  return {
    company: values.company,
    contactName: values.contactName,
    phone: values.phone,
    industry: values.industry as LeadIndustry | undefined,
    postalCode: values.postalCode,
    // Die Prüfung hat bereits eine Ziffernfolge > 0 garantiert (`consumptionInvalid` sonst).
    annualConsumptionKwh: values.annualConsumptionKwh
      ? Number(values.annualConsumptionKwh)
      : undefined,
    supplier: values.supplier,
    contractEndDate: values.contractEndDate,
  }
}

/**
 * Schreibt Lead und Einwilligung(en) und stösst den passenden Versand an.
 *
 * Wirft NIE. Jeder Fehlschlag wird laut geloggt und verschluckt — die Rückmeldung bleibt dieselbe
 * (Regel 2 oben). Die Adresse steht in keinem Log-Text: ein Fehlerlog ist kein zulässiger zweiter
 * Speicherort für Personenbezug.
 */
export async function runLeadCapture(
  submission: LeadCaptureSubmission,
  effects: LeadCaptureEffects,
  context: LeadCaptureContext,
): Promise<LeadCaptureResponse> {
  /*
   * HONEYPOT — wie im Kontaktformular (`app/api/kontakt/route.ts`) ABGELEHNT und nicht still als
   * Erfolg quittiert: ein falscher Erfolg zeigt „Danke", und niemand meldet sich je. Träfe die Falle
   * einen echten Menschen (Autofill), wäre der Lead unwiederbringlich weg, ohne dass eine Seite
   * davon weiss.
   */
  if (typeof submission.website === 'string' && submission.website.trim() !== '') {
    console.warn('[leads] Honeypot gefüllt — Erfassung abgelehnt.')
    return { ok: false, error: 'spam' }
  }

  const parsed = parseLeadCapture(submission)
  if (!parsed.ok) {
    if (parsed.reason === 'validation') {
      return { ok: false, error: 'validation', fieldErrors: parsed.fieldErrors }
    }
    /*
     * Unbekannter (oder nicht vorgesehener) Einstiegspunkt: neutrale Meldung, KEIN Ersatzwert.
     * Passiert im Normalbetrieb nicht — die Komponente reicht immer einen Registry-Schlüssel
     * herein. Ein Aufruf mit fremdem Schlüssel ist deshalb entweder ein Fehler beim Einbetten oder
     * ein manipulierter Aufruf; beides darf keinen Lead erzeugen.
     */
    console.warn('[leads] Erfassung mit unbekanntem Einstiegspunkt abgelehnt.')
    return { ok: false, error: 'unavailable' }
  }

  const { entry, values, marketing } = parsed
  const email = values.email
  if (!email) return { ok: false, error: 'unavailable' }

  try {
    /*
     * ZWEI EINWILLIGUNGEN SIND ZWEI AUFRUFE, nicht ein Aufruf mit zwei Zwecken: `capture_lead`
     * schreibt je Aufruf genau eine Einwilligung, und jede trägt ihre eigene Textfassung, ihren
     * eigenen Zeitpunkt und ggf. ihren eigenen Token (B1-1: die Historie IST der Nachweis). Der
     * zweite Aufruf findet denselben Lead über die normalisierte Adresse und legt keinen zweiten an.
     */
    const primaryPurpose = entry.purpose ?? (marketing ? 'marketing_email' : null)
    const needsSeparateMarketing =
      marketing && primaryPurpose !== null && primaryPurpose !== 'marketing_email'

    const primary = await capture(effects, entry.key, email, primaryPurpose, values, context)
    await deliver(effects, primary, primaryPurpose, email, context, submission)

    if (needsSeparateMarketing) {
      const secondary = await capture(effects, entry.key, email, 'marketing_email', {}, context)
      await deliver(effects, secondary, 'marketing_email', email, context, submission)
    }
  } catch (cause) {
    console.error('[leads] Erfassung fehlgeschlagen:', cause)
  }

  return ACCEPTED
}

/** Ein `capture_lead`-Aufruf samt Token, falls der Zweck eine Bestätigung verlangt. */
async function capture(
  effects: LeadCaptureEffects,
  sourceKey: LeadSourceKey,
  email: string,
  purpose: LeadConsentPurpose | null,
  values: LeadCaptureValues,
  context: LeadCaptureContext,
): Promise<CaptureResult & { token: string | null }> {
  /*
   * Ein Token wird IMMER erzeugt, wenn ein Zweck im Spiel ist, und der Klartext lebt nur hier und
   * in der Mail. Ob er gespeichert wird, entscheidet die DATENBANK: bei einem Zweck ohne
   * Bestätigungspflicht verwirft `capture_lead` ihn seit B3-2 ausdrücklich (weder Hash noch
   * Ablauf). Diese Zuordnung ein zweites Mal hier zu treffen, wäre genau die Doppelung, gegen die
   * `platform.purpose_requires_double_opt_in` gebaut ist.
   */
  const confirmation = purpose ? effects.createToken() : null

  const result = await effects.captureLead({
    email,
    sourceKey,
    purpose,
    tokenHash: confirmation?.tokenHash ?? null,
    tokenExpiresAt: confirmation?.expiresAt ?? null,
    ...fieldsToCall(values),
    sourceIp: context.sourceIp,
    userAgent: context.userAgent,
    locale: context.locale,
  })

  return { ...result, token: confirmation?.token ?? null }
}

/**
 * Der Versand — ausschliesslich am `outcome` entschieden (Regel 3 oben).
 *
 * Alles andere ('lead_only', 'consent_already_pending', 'suppressed') löst KEINEN Versand aus:
 * es gibt nichts zu bestätigen, es läuft bereits eine Bestätigung (eine zweite Mail wäre genau die
 * Verstärkung, gegen die die Prüfung in der Datenbank gebaut ist), oder die Adresse ist gesperrt.
 */
async function deliver(
  effects: LeadCaptureEffects,
  captured: CaptureResult & { token: string | null },
  purpose: LeadConsentPurpose | null,
  email: string,
  context: LeadCaptureContext,
  submission: LeadCaptureSubmission,
): Promise<void> {
  if (!purpose) return

  if (captured.outcome === 'consent_created') {
    /*
     * Bestätigungspflichtiger Zweck: es geht NUR die Bestätigungsmail raus — nichts Werbliches und
     * auch nicht die eigentliche Leistung. Die Einwilligung ist unbestätigt und damit rechtlich
     * wertlos (B1-1: `has_confirmed_consent` ist bei `pending` ausdrücklich false).
     */
    if (!captured.token) return

    const consentText = await effects.getConsentText(purpose, context.locale)
    if (!consentText) {
      // Kann nur passieren, wenn zwischen Erfassung und Versand die Textfassung verschwindet — dann
      // wäre die Mail ohne den Wortlaut, dem zugestimmt wurde, und damit wertlos.
      console.error('[leads] Kein Einwilligungstext für die Bestätigungsmail — nicht versendet.')
      return
    }

    try {
      await effects.sendConfirmationMail({
        to: email,
        consentText,
        token: captured.token,
        locale: context.locale,
      })
    } catch (cause) {
      console.error('[leads] Bestätigungsmail konnte nicht versendet werden:', cause)
    }
    return
  }

  if (captured.outcome !== 'consent_confirmed') return

  /*
   * Sofort wirksame Einwilligung. Die angeforderte Leistung geht jetzt raus — bislang gibt es
   * genau eine: die Zusendung des Schnellrechner-Ergebnisses.
   */
  if (purpose !== 'result_delivery' || !submission.calculator) return

  const result = computeQuickSaving(submission.calculator)
  if (!result) {
    // Kein endliches Ergebnis (Eingaben ausserhalb des darstellbaren Bereichs). Eine Mail mit
    // „Infinity" wäre schlimmer als keine; der Lead und die Einwilligung bleiben bestehen.
    console.warn('[leads] Rechenergebnis nicht darstellbar — keine Ergebnis-Mail versendet.')
    return
  }

  /*
   * Ein Fehlversand wird laut geloggt und bricht den Vorgang NICHT ab; der Nutzer sieht dieselbe
   * Erfolgsmeldung. Ein verlorenes Ergebnis wiegt leichter als ein verlorener Lead — die Adresse
   * und die Einwilligung stehen bereits in der Datenbank, die Zusendung lässt sich nachholen.
   */
  try {
    await effects.sendResultMail({
      to: email,
      locale: context.locale,
      inputs: submission.calculator,
      result,
    })
  } catch (cause) {
    console.error('[leads] Ergebnis-Mail konnte nicht versendet werden:', cause)
  }
}
