/**
 * B19 — die Aufnahme einer telefonischen Anfrage: Prüfung und Ablaufplan, ohne Datenbank.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client, kein zod-fremder Seiteneffekt —
 * und, das ist der Punkt dieses Bauabschnitts, KEIN MAILMODUL. Dieselbe Aufteilung wie
 * `lib/admin/analysis-upload.ts` (B14-2): hier stehen die Entscheidungen, die Server Action
 * (`lead-intake-actions.ts`) ist nur noch Verdrahtung.
 *
 * ── ⚠ DIESER WEG VERSENDET KEINE E-MAIL. NIRGENDS. ──────────────────────────────────────────────
 * Der öffentliche Weg (`lib/kontakt/submit.ts`) stellt die Anfrage per `deliverKontakt` intern zu
 * und kann bei angekreuzter Marketing-Einwilligung eine Bestätigungsmail an den Interessenten
 * auslösen. Beides passiert hier NICHT und darf hier nicht passieren: Wer anruft, hat um keine Mail
 * gebeten, und eine unangekündigte Nachricht auf einen Anruf hin ist genau die Art von Kontakt, die
 * dieses System nicht führen soll.
 *
 * Die Zusage ist nicht bloss eine Absicht, sondern an drei Stellen abgesichert:
 *   1. Dieses Modul und die Server Action importieren kein Mailmodul (`lead-intake.test.ts` liest
 *      die Importe BEIDER Dateien und wird rot, sobald eines dazukommt).
 *   2. Der einzige erzeugte Effekt ist eine Liste von `capture_lead`-Aufrufen — `capture_lead` ist
 *      eine reine SQL-Funktion und versendet selbst nichts.
 *   3. Es gibt keinen bestätigungspflichtigen Zweck im Plan (s. „Marketing" unten), also auch
 *      keinen Zweig, der je eine Bestätigungsmail bräuchte.
 *
 * ── WARUM ES HIER KEIN MARKETING-HÄKCHEN GIBT ───────────────────────────────────────────────────
 * Es wäre nicht baubar, ohne entweder die Mailfreiheit oder die Wahrheit aufzugeben.
 * `platform.purpose_requires_double_opt_in('marketing_email')` ist `true`; `capture_lead` legt die
 * Einwilligung deshalb als `status='pending'` an, und `platform.has_confirmed_consent` verlangt
 * ausdrücklich `'confirmed'`. Der EINZIGE Weg von `pending` nach `confirmed` ist der Token-Link aus
 * der Bestätigungsmail — die dieser Weg nicht versenden darf. Ein Marketing-Häkchen hier erzeugte
 * also eine Einwilligung, die NIE bestätigt werden kann: im Admin-Bereich sichtbar wie eine
 * Zustimmung, rechtlich wertlos, und niemandem fiele der Unterschied auf. Wer Werbung möchte,
 * trägt sich über die öffentlichen Wege selbst ein und durchläuft dort das Double-Opt-in.
 *
 * ── WARUM ES KEIN FELD FÜR THEMA UND NACHRICHT GIBT ─────────────────────────────────────────────
 * Für beides existiert keine Spalte. `platform.leads` speichert ausschliesslich Identitätsfelder
 * (B1-2, Regel 2: „DER NACHRICHTENTEXT WIRD NICHT GESPEICHERT") — im öffentlichen Formular leben
 * Thema und Nachricht allein in der internen Benachrichtigungsmail, und genau die entsteht hier
 * nicht. Zwei Felder anzubieten, deren Inhalt beim Absenden ersatzlos verschwindet, wäre eine
 * Requisite: Sie sähe aus wie eine Notiz und wäre keine. Das Anliegen gehört bis auf Weiteres in
 * die Gesprächsnotiz ausserhalb dieses Systems.
 */

import { z } from 'zod'
import type { LeadConsentPurpose, LeadSourceKey } from '@/lib/leads/registry'
import { LEAD_SOURCE_TELEFONANFRAGE } from '@/lib/leads/config'
import { toFieldErrors } from './schema'

/*
 * Max-Längen wortgleich aus `lib/kontakt/schema.ts`. Bewusst KOPIERT und nicht importiert: Das
 * Kontaktschema trägt Fehler-KEYS (`vornameRequired`), die eine next-intl-Ebene auflöst; der
 * Admin-Bereich liegt ausserhalb dieser Struktur und braucht fertige deutsche Sätze
 * (s. `lib/admin/schema.ts`). Ein gemeinsames Schema müsste beide Fehlerformen tragen — die
 * Kopplung wäre teurer als diese Tabelle. Die GRENZEN sind dieselben, weil dieselbe Spalte
 * dahinterliegt.
 */
const MAX = {
  vorname: 100,
  nachname: 100,
  email: 254, // RFC 5321: die längste zustellbare Adresse
  unternehmen: 120,
  telefon: 60,
  empfehlung: 200,
} as const

/** Optionales Textfeld: leer bedeutet „nicht angegeben", nicht „Fehler". */
function optionalText(max: number, tooLong: string) {
  return z.string().trim().max(max, tooLong).optional()
}

export const leadIntakeSchema = z.object({
  /*
   * Beide Pflicht, wie im Kontaktformular — und aus demselben Grund getrennt erhoben: Auf eine
   * Anfrage folgt Korrespondenz, und die beginnt mit einer Anrede. `min(1)`, weil es
   * einbuchstabige Vornamen gibt.
   */
  vorname: z
    .string()
    .trim()
    .min(1, 'Bitte den Vornamen angeben.')
    .max(MAX.vorname, 'Höchstens 100 Zeichen.'),
  nachname: z
    .string()
    .trim()
    .min(1, 'Bitte den Nachnamen angeben.')
    .max(MAX.nachname, 'Höchstens 100 Zeichen.'),

  /*
   * Formatprüfung, keine Existenzprüfung — sie fängt den Tippfehler, nicht die falsch verstandene
   * Adresse. Am Telefon ist genau das der häufige Fehler; deshalb steht am Feld der Hinweis, die
   * Adresse zurückzulesen. Eine Prüfmail wäre der naheliegende Ausweg und ist hier ausgeschlossen.
   */
  email: z
    .string()
    .trim()
    .min(1, 'Bitte die E-Mail-Adresse angeben.')
    .email('Das sieht nicht nach einer E-Mail-Adresse aus.')
    .max(MAX.email, 'Höchstens 254 Zeichen.'),

  unternehmen: optionalText(MAX.unternehmen, 'Höchstens 120 Zeichen.'),

  /* Keine Formatprüfung — jede Regex lehnt irgendwann eine echte Nummer ab (s. Kontaktschema). */
  telefon: optionalText(MAX.telefon, 'Höchstens 60 Zeichen.'),

  /* Freitext „Empfohlen durch" — BEOBACHTUNG, landet in `referred_by_text`, nie in `partner_slug`. */
  empfehlung: optionalText(MAX.empfehlung, 'Höchstens 200 Zeichen.'),

  /*
   * DIE ZUORDNUNG (B16-1) — das URTEIL, getrennt von der Beobachtung darüber. Optional: die meisten
   * Anrufer kommen über niemanden. Gegen die Liste der AKTIVEN Fachbetriebe geprüft, nicht gegen
   * ein Format: `capture_lead` verwürfe einen unbekannten Slug still, und eine still verworfene
   * Zuordnung sähe hier aus wie eine erfolgte (dieselbe Unterscheidung, die `admin_update_lead`
   * mit SQLSTATE 22023 trifft).
   */
  partnerSlug: z.string().trim().optional(),

  /*
   * `literal(true)`: „nicht angehakt" ist kein gültiger Wert, sondern eine fehlende Einwilligung.
   * Dieselbe Rechtsgrundlage wie im öffentlichen Formular — nur der Kanal ist ein anderer, und wer
   * am Telefon nicht zustimmt, dessen Daten werden nicht gespeichert.
   */
  datenschutz: z.literal(true, {
    errorMap: () => ({ message: 'Ohne Zustimmung zur Datenschutzerklärung dürfen wir den Kontakt nicht speichern.' }),
  }),

  /* Die Freigabe an den Fachbetrieb (B18-6). Nie vorausgewählt, nie erforderlich. */
  partnerFreigabe: z.boolean().optional(),
})

export type LeadIntakeInput = z.input<typeof leadIntakeSchema>
export type LeadIntakeValues = z.output<typeof leadIntakeSchema>

/**
 * Ein einzelner `capture_lead`-Aufruf, wie ihn `lib/leads/store.ts` erwartet — ohne die
 * Nachweisfelder, die erst die Server Action aus dem Request kennt (IP, User-Agent, Locale).
 */
export type LeadIntakeCall = {
  email: string
  sourceKey: LeadSourceKey
  purpose: LeadConsentPurpose | null
  company: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  partnerSlug: string | null
  referredByText: string | null
}

export type LeadIntakePlan =
  | { ok: true; calls: LeadIntakeCall[] }
  | { ok: false; fieldErrors: Record<string, string> }

/** Leerstring ist keine Angabe (dieselbe Normalisierung wie `capture_lead` selbst). */
function orNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/**
 * Prüft die Eingabe und stellt den Ablauf zusammen — die EINZIGE Stelle, an der entschieden wird,
 * wie viele `capture_lead`-Aufrufe entstehen und mit welchen Argumenten.
 *
 * `activePartnerSlugs` sind die Slugs, die das Formular tatsächlich angeboten hat. Die Prüfung
 * dagegen ist keine Förmlichkeit: Ein Fachbetrieb kann zwischen Aufbau der Seite und Klick
 * stillgelegt worden sein, und dann darf keine Freigabe an ihn entstehen.
 */
export function planLeadIntake(
  input: LeadIntakeInput,
  activePartnerSlugs: readonly string[],
): LeadIntakePlan {
  const parsed = leadIntakeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) }

  const values = parsed.data
  const partnerSlug = orNull(values.partnerSlug)

  if (partnerSlug !== null && !activePartnerSlugs.includes(partnerSlug)) {
    return {
      ok: false,
      fieldErrors: {
        partnerSlug: 'Diesen Fachbetrieb gibt es nicht mehr oder er ist stillgelegt. Bitte neu wählen.',
      },
    }
  }

  /*
   * ── DIE FREIGABE BRAUCHT EINEN GEGENSTAND ──────────────────────────────────────────────────────
   * `partner_lead_disclosure` erlaubt, die Anfrage EINEM BESTIMMTEN Fachbetrieb offenzulegen; ihre
   * Wirkung (`public.get_my_partner_leads`) greift ausschliesslich über `partner_slug`. Ohne
   * Zuordnung entstünde eine bestätigte Einwilligung zu einer Weitergabe, die nicht stattfinden
   * kann — eine gespeicherte Willenserklärung ohne Gegenstand. Das öffentliche Formular schliesst
   * genau diesen Fall aus (`lib/kontakt/submit.ts`, Bedingung 3); hier gilt dieselbe Regel.
   *
   * Es ist ein FEHLER und kein stilles Verwerfen: Am Telefon hat jemand „ja" gesagt, und dass die
   * Zusage nirgends ankommt, muss der aufnehmenden Person auffallen — nicht erst dem Fachbetrieb,
   * der die Anfrage nie zu sehen bekommt.
   */
  const wantsDisclosure = values.partnerFreigabe === true
  if (wantsDisclosure && partnerSlug === null) {
    return {
      ok: false,
      fieldErrors: {
        partnerFreigabe:
          'Eine Freigabe braucht einen Fachbetrieb. Bitte oben einen auswählen — oder das Häkchen entfernen.',
      },
    }
  }

  const base: LeadIntakeCall = {
    email: values.email,
    sourceKey: LEAD_SOURCE_TELEFONANFRAGE,
    /*
     * KEIN Zweck beim ersten Aufruf. Das blosse Aufnehmen der Anfrage schreibt einen Lead —
     * Rechtsgrundlage ist VERTRAGSANBAHNUNG, nicht Einwilligung; es entsteht bewusst keine
     * Einwilligungszeile daraus (B1-2, Regel 1). Das Datenschutz-Häkchen ist die Voraussetzung
     * dafür, überhaupt speichern zu dürfen, und kein eigener Zweck: `platform.consent_purpose`
     * kennt keinen solchen, und B19 legt ausdrücklich keinen an.
     */
    purpose: null,
    company: orNull(values.unternehmen),
    firstName: orNull(values.vorname),
    lastName: orNull(values.nachname),
    phone: orNull(values.telefon),
    partnerSlug,
    referredByText: orNull(values.empfehlung),
  }

  if (!wantsDisclosure) return { ok: true, calls: [base] }

  /*
   * ── ZWEI EINWILLIGUNGEN SIND ZWEI AUFRUFE ──────────────────────────────────────────────────────
   * `capture_lead` schreibt je Aufruf GENAU EINE Einwilligung, jede mit eigener Textfassung,
   * eigenem Zeitpunkt und eigenen Nachweisfeldern (B1-1: die Historie IST der Nachweis). Das
   * etablierte Muster seit B3-2 (`lib/leads/capture-flow.ts`) und B18-6 (`lib/leads/capture.ts`);
   * `capture_lead` selbst bleibt unverändert. Der zweite Aufruf findet denselben Lead über die
   * normalisierte Adresse und legt keinen zweiten an.
   *
   * Die Identitätsfelder fahren NICHT noch einmal mit: `capture_lead` führt sie mit
   * `coalesce(Bestand, neu)` zusammen — sie erneut zu schicken änderte nichts und liesse den Aufruf
   * so aussehen, als könnte er es.
   *
   * KEIN Versand und kein `outcome`-Zweig: `partner_lead_disclosure` ist nicht
   * bestätigungspflichtig, entsteht sofort als `confirmed` und löst an niemanden eine Mail aus.
   * Genau deshalb ist es die einzige Einwilligung, die dieser Weg überhaupt einsammeln kann.
   */
  return {
    ok: true,
    calls: [
      base,
      {
        ...base,
        purpose: 'partner_lead_disclosure',
        company: null,
        firstName: null,
        lastName: null,
        phone: null,
        referredByText: null,
      },
    ],
  }
}
