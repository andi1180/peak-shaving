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
import { LEAD_SOURCE_PARTNER, normalizePartnerSlug } from './partner'
import { sendConsentConfirmationMail } from './mail'
import { captureLead, getActiveConsentText, getActivePartner } from './store'
import { createConfirmationToken } from './tokens'

/**
 * DIE AUFLÖSUNG DER PARTNER-ZUORDNUNG (B16-2) — eine Stelle für beide Wege.
 *
 * ── DER PFAD SCHLÄGT DEN RUMPF, UND ZWAR OHNE AUSNAHME ───────────────────────────────────────────
 * Kommt die Absendung von der Landingpage, steht der Slug im PFAD des Endpunkts
 * (`/api/partner/<slug>/kontakt`). Ein `partner` im Rumpf wird dann NICHT etwa bevorzugt oder
 * gemischt, sondern gar nicht erst gelesen. Der Grund ist nicht Ordnungsliebe: An der Zuordnung
 * hängt später, wer ein Montageprojekt bekommt — ein Wert, den der Browser stellt, darf darüber
 * nicht entscheiden.
 *
 * ── EIN UNBRAUCHBARER SLUG KOSTET NIE EINEN LEAD ─────────────────────────────────────────────────
 * Unbekannt, stillgelegt, formatverletzend, Datenbank nicht erreichbar: In allen vier Fällen
 * entsteht der Lead trotzdem, nur ohne Zuordnung. Dieselbe Abwägung, die B16-1 in
 * `public.capture_lead` getroffen hat („ein Link mit Tippfehler darf keinen Lead kosten").
 *
 * ── ABER DIE HERKUNFT WIRD DANN AUCH NICHT BEHAUPTET ────────────────────────────────────────────
 * Scheitert die Auflösung auf der LANDINGPAGE, fällt die Herkunft auf 'kontaktformular' zurück,
 * nicht auf 'partner-empfehlung'. Sonst stünde im Bestand eine Partner-Aussendung, zu der es keinen
 * Partner gibt — eine Zeile, die eine Auswertung still verfälscht (`first_source_key` ist seit B1-1
 * unveränderlich, der Fehler wäre nicht mehr zu bereinigen). Der Fall tritt real ein: ein
 * Fachbetrieb wird stillgelegt, während seine Mail noch in Postfächern liegt.
 */
export type PartnerAttribution = {
  /** Die Herkunft, unter der der Lead entsteht (`platform.lead_sources.key`). */
  sourceKey: string
  /** Der bestätigte Slug — oder `null`, wenn keine Zuordnung zustande kam. */
  partnerSlug: string | null
  /** Der Anzeigename des Fachbetriebs, für die interne Benachrichtigungsmail. */
  partnerDisplayName: string | null
}

export type PartnerAttributionInput = {
  /** Slug aus dem PFAD der Landingpage. Ist er gesetzt, wird `querySlug` ignoriert. */
  pathSlug?: string | null
  /** Slug aus `?partner=` auf `/kontakt` — vom Client geliefert und deshalb nur ein Vorschlag. */
  querySlug?: string | null
}

export async function resolvePartnerAttribution(
  input: PartnerAttributionInput,
): Promise<PartnerAttribution> {
  const fromPath = input.pathSlug != null
  const candidate = normalizePartnerSlug(fromPath ? input.pathSlug : input.querySlug)

  let partner = null
  if (candidate) {
    try {
      partner = await getActivePartner(candidate)
    } catch (cause) {
      /*
       * LAUT loggen, still weitermachen. Der Slug steht im Log (er ist eine Firmenkennung, kein
       * Personenbezug) — ohne ihn liesse sich eine wiederkehrende Fehlzuordnung nicht nachvollziehen.
       */
      console.error(`[leads] Partner-Auflösung fehlgeschlagen (slug=${candidate}):`, cause)
    }
  }

  if (partner) {
    return {
      sourceKey: fromPath ? LEAD_SOURCE_PARTNER : LEAD_SOURCE_KONTAKTFORMULAR,
      partnerSlug: partner.slug,
      partnerDisplayName: partner.displayName,
    }
  }

  if (fromPath) {
    console.warn(
      `[leads] Partner-Landingpage ohne auflösbaren Fachbetrieb (slug=${String(input.pathSlug)}) — ` +
        'der Lead entsteht unter der Herkunft des Kontaktformulars, ohne Zuordnung.',
    )
  }

  return {
    sourceKey: LEAD_SOURCE_KONTAKTFORMULAR,
    partnerSlug: null,
    partnerDisplayName: null,
  }
}

export type KontaktLeadInput = {
  email: string
  /** Getrennt erfasst — das Kontaktformular verlangt beide (§5.5). */
  firstName?: string
  lastName?: string
  company?: string
  phone?: string
  /** Hat die Person die (nicht vorausgewählte) Marketing-Einwilligung angekreuzt? */
  wantsMarketingEmail: boolean
  /** Nachweisfelder der Einwilligung (B1-1: nur Nachweis, keine Profilbildung, kein Index). */
  sourceIp?: string | null
  userAgent?: string | null
  /**
   * B16-2: Herkunft und Zuordnung, wie `resolvePartnerAttribution` sie ermittelt hat. Ohne Angabe
   * bleibt es beim Kontaktformular ohne Partner — genau das Verhalten von vor B16-2.
   */
  sourceKey?: string
  partnerSlug?: string | null
  /** Freitext „Empfohlen durch" — BEOBACHTUNG, landet nie in `partner_slug` (B16-1). */
  referredByText?: string | null
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
      sourceKey: input.sourceKey ?? LEAD_SOURCE_KONTAKTFORMULAR,
      purpose: input.wantsMarketingEmail ? 'marketing_email' : null,
      tokenHash: confirmation?.tokenHash ?? null,
      tokenExpiresAt: confirmation?.expiresAt ?? null,
      company: input.company ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      phone: input.phone ?? null,
      sourceIp: input.sourceIp ?? null,
      userAgent: input.userAgent ?? null,
      locale,
      partnerSlug: input.partnerSlug ?? null,
      referredByText: input.referredByText ?? null,
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
