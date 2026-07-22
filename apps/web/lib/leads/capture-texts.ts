/**
 * Die Einwilligungs-WORTLAUTE, die ein Einstiegspunkt anzeigen muss (B3-2) — serverseitig geladen
 * und ins eingebettete Formular gereicht.
 *
 * Muster exakt wie `/kontakt` (B1-2): der Text kommt aus `platform.consent_texts` und NICHT aus
 * `messages/de.json`, weil `public.capture_lead` anschliessend genau diesen Wortlaut archiviert.
 * Eine zweite Kopie im Nachrichtenkatalog liesse den Nachweis irgendwann einen Satz behaupten, den
 * die Person nie gesehen hat (B1-1, append-only).
 *
 * FÄLLT DAS LESEN AUS (fehlende Env im CI-Build, Datenbank nicht erreichbar), kommen `null`-Werte
 * zurück und die Komponente rendert den Eintrag NICHT — laut geloggt, fail-closed. Ohne Wortlaut
 * darf keine Einwilligung eingesammelt werden; der Rest der Seite funktioniert unverändert weiter.
 */
import 'server-only'
import { LEAD_CAPTURE_REGISTRY, type LeadCaptureFormKey } from './registry'
import { getActiveConsentText } from './store'

export type LeadCaptureConsentTexts = {
  /** Wortlaut zum Zweck des Eintrags — `null`, wenn der Eintrag keinen Zweck hat oder er fehlt. */
  primary: string | null
  /** Wortlaut der zusätzlichen, nie vorausgewählten Marketing-Einwilligung. */
  marketing: string | null
}

const NONE: LeadCaptureConsentTexts = { primary: null, marketing: null }

export async function loadLeadCaptureTexts(
  key: LeadCaptureFormKey,
  locale: string,
): Promise<LeadCaptureConsentTexts> {
  const entry = LEAD_CAPTURE_REGISTRY[key]

  try {
    const [primary, marketing] = await Promise.all([
      entry.purpose ? getActiveConsentText(entry.purpose, locale) : Promise.resolve(null),
      entry.offersMarketingConsent
        ? getActiveConsentText('marketing_email', locale)
        : Promise.resolve(null),
    ])
    return { primary: primary?.body ?? null, marketing: marketing?.body ?? null }
  } catch (cause) {
    console.warn(
      `[leads] Einwilligungstexte für den Einstiegspunkt "${key}" nicht lesbar — das Formular ` +
        'wird ausgelassen:',
      cause,
    )
    return NONE
  }
}
