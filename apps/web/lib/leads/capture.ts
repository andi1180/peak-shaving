/**
 * Die Erfassung aus dem Kontaktformular (B1-2, Fahrplan_2026.md B1) — der EINE Einstiegspunkt, den
 * dieser Bauabschnitt verdrahtet. Weitere Einstiegspunkte (Artikel, Branchenseiten,
 * Rechnerergebnisse) sind ausdrücklich B3 und bauen auf denselben Wrappern auf.
 *
 * ── DREI REGELN, DIE HIER UND NUR HIER STEHEN ────────────────────────────────────────────────────
 *
 * 1. ZWEI VERSCHIEDENE RECHTSGRUNDLAGEN IN EINEM FORMULAR. Das blosse Absenden schreibt einen Lead
 *    (`first_source_key='kontaktformular'`) — Rechtsgrundlage ist VERTRAGSANBAHNUNG, nicht
 *    Einwilligung. Es entsteht bewusst KEINE Einwilligungszeile daraus. Nur die zusätzliche, NICHT
 *    vorausgewählte Ankreuzmöglichkeit erzeugt eine `pending`-Einwilligung für 'marketing_email'.
 *    Beides in einem Aufruf, aber getrennt in der Wirkung.
 *
 * 2. DER NACHRICHTENTEXT WIRD NICHT GESPEICHERT. Nur Identitätsfelder (Adresse, Firma, Name,
 *    Telefon) gehen in `platform.leads`. Das Anliegen selbst steht in der internen Mail und sonst
 *    nirgends — es ist der Teil, der am ehesten Vertrauliches enthält, und er wird für die
 *    Leadverwaltung nicht gebraucht. (`platform.leads` hat dafür auch gar keine Spalte, B1-1.)
 *
 * 3. DER SCHREIBVORGANG BLOCKIERT DEN VERSAND NIE. Er läuft NACH erfolgreicher Zustellung, und jeder
 *    Fehler wird laut geloggt, aber verschluckt: eine verlorene Kundenanfrage wiegt schwerer als ein
 *    verlorener Lead. Deshalb gibt diese Funktion auch nichts zurück, das die Route in einen
 *    Fehlerzustand übersetzen könnte.
 */
import 'server-only'
import { getLocale } from 'next-intl/server'
import { absoluteUrl } from '@/lib/site'
import {
  CONFIRM_TOKEN_PARAM,
  EINWILLIGUNG_BESTAETIGEN_HREF,
  LEAD_SOURCE_KONTAKTFORMULAR,
} from './config'
import { sendConsentConfirmationMail } from './mail'
import { captureLead, getActiveConsentText } from './store'
import { createConfirmationToken } from './tokens'

export type KontaktLeadInput = {
  email: string
  contactName?: string
  company?: string
  phone?: string
  /** Hat die Person die (nicht vorausgewählte) Marketing-Einwilligung angekreuzt? */
  wantsMarketingEmail: boolean
  /** Nachweisfelder der Einwilligung (B1-1: nur Nachweis, keine Profilbildung, kein Index). */
  sourceIp?: string | null
  userAgent?: string | null
}

/**
 * Schreibt den Lead und — falls angekreuzt — die unbestätigte Marketing-Einwilligung, und stösst in
 * genau diesem Fall die Bestätigungsmail an.
 *
 * Wirft NIE. Die Route meldet dem Nutzer in ALLEN Fällen denselben Erfolg — auch bei gesperrter
 * Adresse und auch, wenn hier alles schiefgeht: die Rückmeldung darf nie verraten, ob eine Adresse
 * bereits bekannt oder gesperrt ist.
 */
export async function captureKontaktLead(input: KontaktLeadInput): Promise<void> {
  try {
    const locale = await getLocale()

    /*
     * Token NUR erzeugen, wenn tatsächlich eine Einwilligung entstehen soll. Der Klartext lebt
     * ausschliesslich in dieser Funktion und in der Mail — in die Datenbank geht nur der SHA-256.
     */
    const confirmation = input.wantsMarketingEmail ? createConfirmationToken() : null

    const result = await captureLead({
      email: input.email,
      sourceKey: LEAD_SOURCE_KONTAKTFORMULAR,
      purpose: input.wantsMarketingEmail ? 'marketing_email' : null,
      tokenHash: confirmation?.tokenHash ?? null,
      tokenExpiresAt: confirmation?.expiresAt ?? null,
      company: input.company ?? null,
      contactName: input.contactName ?? null,
      phone: input.phone ?? null,
      sourceIp: input.sourceIp ?? null,
      userAgent: input.userAgent ?? null,
      locale,
    })

    /*
     * NUR bei 'consent_created' geht eine Mail raus. 'consent_already_pending' bedeutet, dass für
     * dieselbe Adresse und denselben Zweck bereits eine unbestätigte Einwilligung läuft — eine
     * zweite Mail wäre genau die Verstärkung, gegen die die Prüfung in der Datenbank gebaut ist.
     * 'suppressed' und 'lead_only' erzeugen ohnehin keine Einwilligung.
     */
    if (result.outcome !== 'consent_created' || !confirmation) return

    const consentText = await getActiveConsentText('marketing_email', locale)
    if (!consentText) {
      // Kann nur passieren, wenn zwischen Erfassung und Versand die Textfassung verschwindet — dann
      // wäre die Mail ohne den Wortlaut, dem zugestimmt wurde, und damit wertlos.
      console.error('[leads] Kein Einwilligungstext für die Bestätigungsmail — nicht versendet.')
      return
    }

    const confirmUrl = absoluteUrl(
      `${EINWILLIGUNG_BESTAETIGEN_HREF}?${CONFIRM_TOKEN_PARAM}=${encodeURIComponent(confirmation.token)}`,
    )

    await sendConsentConfirmationMail({
      to: input.email,
      consentText: consentText.body,
      confirmUrl,
      locale,
    })
  } catch (cause) {
    /*
     * LAUT loggen, still weitermachen (Regel 3 oben). Die Adresse steht bewusst NICHT im Log-Text —
     * ein Fehlerlog ist kein zulässiger zweiter Speicherort für Personenbezug.
     */
    console.error('[leads] Lead-Erfassung aus dem Kontaktformular fehlgeschlagen:', cause)
  }
}
