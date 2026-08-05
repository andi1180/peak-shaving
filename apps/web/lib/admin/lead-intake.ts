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
 * ── WARUM ES KEIN FREITEXTFELD „EMPFOHLEN DURCH" MEHR GIBT (B19-Nachbesserung) ──────────────────
 * Es hat Text gesammelt, kein Wissen. Wer beim zweiten Anruf denselben Betrieb nennt, wurde erneut
 * abgetippt — „Elektro Huber", „E. Huber GmbH", „huber elektro" — und hinterher liess sich nicht
 * mehr sagen, wie oft dieser Betrieb jemanden geschickt hat. An seine Stelle tritt EIN Auswahlfeld,
 * das echte Fachbetriebe und formlos erfasste Firmen nebeneinander anbietet und eine neue Firma in
 * derselben Handlung anlegt (`platform.mentioned_businesses`).
 *
 * ⚠ Die formlose Firma landet NIE in `partner_slug` und NIE in `platform.partners`. Jene Spalte ist
 * seit B18-6 ein ZUGRIFFSRECHT: Über sie zeigt `public.get_my_partner_leads` einem angemeldeten
 * Fachbetrieb SEINE Anfragen mit Namen. Ein Name, den jemand am Telefon hört, hat weder Bewerbung
 * noch Prüfung noch Genehmigung durchlaufen — ihn dorthin zu schreiben wäre eine Partnerschaft
 * durch Zuhören. `referred_by_text`, `capture_lead`, der öffentliche Kontaktweg und die
 * Partner-Landingpage sind davon UNBERÜHRT; nur dieser eine Aufrufort schreibt den Freitext nicht
 * mehr.
 *
 * ── DAS THEMA GIBT ES JETZT, DIE NACHRICHT WEITERHIN NICHT ──────────────────────────────────────
 * Hier stand bis zuletzt, es gebe für BEIDES keine Spalte. Für das Thema stimmt das nicht mehr:
 * `platform.leads.thema` existiert seit der Migration `20260805150000`, und der öffentliche
 * Kontaktweg befüllt sie. Damit fällt der Grund weg, der das Feld hier ausgeschlossen hat — es ist
 * keine Requisite mehr, sondern eine Angabe mit Speicherort, und sie ist auf der Detailseite
 * lesbar (`admin_get_lead`, Migration `20260805180000`).
 *
 * OPTIONAL, nicht Pflicht — und das ist der Unterschied zum öffentlichen Formular. Dort wählt der
 * Absender aus einer Liste, die er vor sich sieht; hier ordnet ein Mensch ein Telefonat ein, und
 * nicht jedes Gespräch lässt sich sauber einem Thema zuschlagen. Ein Pflichtfeld erzwänge in genau
 * diesen Fällen eine erfundene Zuordnung — und die Auswertung dahinter wäre still falsch, weil
 * „Sonstiges" dann sowohl „passt nirgends" als auch „wollte niemand entscheiden" hiesse.
 *
 * ⚠ DIE WERTE KOMMEN AUS `lib/kontakt/themen.ts`, NICHT AUS EINER LISTE IN DIESER DATEI. Jenes
 * Modul leitet sie datengetrieben aus `LEISTUNGEN` ab, damit ein Leistungs-Rename nicht still
 * abdriftet; eine zweite Aufzählung hier wäre genau die Drift, gegen die es gebaut ist. Geprüft
 * wird über `isThemaKey` — derselbe Wächter, den auch der Deep-Link benutzt.
 *
 * FÜR DIE NACHRICHT GILT DER ALTE SATZ UNVERÄNDERT: `platform.leads` speichert keinen Freitext des
 * Anliegens (B1-2, Regel 2: „DER NACHRICHTENTEXT WIRD NICHT GESPEICHERT"), im öffentlichen
 * Formular lebt er allein in der internen Benachrichtigungsmail — und die entsteht hier nicht. Ein
 * Feld dafür wäre weiterhin eine Requisite: Es sähe aus wie eine Notiz und wäre keine. Das
 * Anliegen gehört bis auf Weiteres in die Gesprächsnotiz ausserhalb dieses Systems. Auch ein
 * Freitextfeld NEBEN der Auswahl entsteht hier bewusst nicht — es bräuchte eine eigene Spalte und
 * eine eigene Begründung.
 */

import { z } from 'zod'
import type { LeadConsentPurpose, LeadSourceKey } from '@/lib/leads/registry'
import { LEAD_SOURCE_TELEFONANFRAGE } from '@/lib/leads/config'
import { isThemaKey } from '@/lib/kontakt/themen'
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
  /*
   * Der Name eines formlos genannten Betriebs. Dieselbe Grenze wie `unternehmen` — es ist dieselbe
   * Art von Angabe, nur über einen Dritten. Die Datenbank zieht bei 200 Zeichen eine zweite,
   * weitere Grenze (`platform.mentioned_businesses`); die engere steht hier, damit die Ablehnung
   * am Feld erscheint und nicht als Fehler einer Transaktion.
   */
  firma: 120,
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

  /*
   * ── DAS THEMA: OPTIONAL, ABER NICHT BELIEBIG ───────────────────────────────────────────────────
   * Leer heisst „nicht eingeordnet" und ist ein zulässiger Zustand (Begründung im Kopf). Ein
   * GESETZTER Wert muss dagegen aus der Taxonomie stammen — geprüft über `isThemaKey`, also gegen
   * dieselbe Liste, die das Formular rendert und die das öffentliche Kontaktschema mit
   * `z.enum(THEMA_KEYS)` benutzt. Kein `z.enum` hier, weil das die Werte ein zweites Mal
   * aufzählte; die Prüfung soll aus der Liste FOLGEN, nicht sie wiederholen.
   *
   * Abgewiesen statt still verworfen — dieselbe Regel wie bei `zuordnung`: Ein Wert, der aus
   * keinem gerenderten Auswahlfeld stammen kann, ist ein Fehler und keine Angabe. Still verworfen
   * stünde am Ende ein Lead ohne Thema da, obwohl jemand eines ausgewählt hat.
   *
   * ⚠ Die Datenbank kann das NICHT abfangen: `platform.leads.thema` trägt bewusst keinen CHECK
   * (die Werteliste ist datengetrieben, ein Constraint wäre eine zweite und liesse die Erfassung
   * beim ersten Leistungs-Rename mit 23514 scheitern). Diese Prüfung hier ist die einzige.
   */
  thema: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => value === undefined || value === '' || isThemaKey(value),
      'Dieses Thema kennen wir nicht. Bitte die Seite neu laden und noch einmal wählen.',
    ),

  /*
   * ── EIN FELD, ZWEI SEHR VERSCHIEDENE WIRKUNGEN ─────────────────────────────────────────────────
   * Für die aufnehmende Person ist es EINE Frage: „Wer hat Sie geschickt?" Technisch führen die
   * Antworten an zwei verschiedene Orte, und deshalb trägt der Wert ein Präfix:
   *
   *   `partner:<slug>` → `platform.leads.partner_slug`          — das URTEIL (B16-1). Ein echter,
   *                      geprüfter, aktiver Fachbetrieb; die Zuordnung entscheidet über den Zugriff
   *                      im Partner-Portal (B18-6) und über die Vergabe eines Montageprojekts.
   *   `firma:<uuid>`   → `platform.leads.mentioned_business_id` — die BEOBACHTUNG. Ein formlos
   *                      genannter Betrieb ohne Bewerbung, Prüfung und Konto; er bewirkt nichts
   *                      ausser Wiederfindbarkeit beim nächsten Anruf.
   *   `neu`            → wie `firma:`, nur dass der Betrieb in derselben Handlung entsteht.
   *
   * Das Präfix ist keine Kosmetik: Ohne es entschiede die Form einer Kennung darüber, welche der
   * beiden Wirkungen eintritt — und ein Fehlgriff hiesse, jemandem den Blick auf fremde
   * Kundenkontakte zu öffnen. Slugs (`^[a-z0-9-]+$`) und uuids enthalten beide keinen Doppelpunkt,
   * die Zerlegung ist damit eindeutig.
   */
  zuordnung: z.string().trim().optional(),

  /* Nur bei `zuordnung === 'neu'` gefüllt — der Name der Firma, die dabei angelegt wird. */
  neueFirma: optionalText(MAX.firma, 'Höchstens 120 Zeichen.'),

  /*
   * `literal(true)`: „nicht angehakt" ist kein gültiger Wert, sondern eine fehlende Einwilligung.
   * Dieselbe Rechtsgrundlage wie im öffentlichen Formular — nur der Kanal ist ein anderer, und wer
   * am Telefon nicht zustimmt, dessen Daten werden nicht gespeichert.
   */
  datenschutz: z.literal(true, {
    errorMap: () => ({
      message: 'Ohne Zustimmung zur Datenschutzerklärung dürfen wir den Kontakt nicht speichern.',
    }),
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
  /**
   * Der SCHLÜSSEL des Themas (`peakShaving`, …) oder `null`. Nie das übersetzte Label: das steht in
   * `messages/*.json`, ist sprachabhängig und wäre im Bestand eine zweite, veraltende Kopie.
   */
  thema: string | null
  /*
   * `referredByText` steht hier bewusst NICHT MEHR. Die Spalte `platform.leads.referred_by_text`
   * und der öffentliche Weg dorthin bleiben unverändert bestehen — dieser Aufrufort schreibt sie
   * nur nicht. Das Feld ganz aus dem Typ zu nehmen (statt es auf `null` zu setzen) ist Absicht:
   * so lässt es sich nicht versehentlich wieder befüllen, ohne dass jemand diesen Kommentar liest.
   */
}

/**
 * Die formlose Firmenerwähnung, die NACH dem Lead zugeordnet wird — oder `null`.
 *
 * Zwei Formen, weil es zwei Aufrufe von `public.admin_attach_mentioned_business` sind: eine bereits
 * erfasste Firma wird über ihre Kennung ausgewählt, eine neue über ihren Namen angelegt. Für die
 * aufnehmende Person ist beides derselbe Vorgang.
 */
export type LeadIntakeMention =
  { kind: 'existing'; businessId: string } | { kind: 'new'; name: string }

export type LeadIntakePlan =
  | { ok: true; calls: LeadIntakeCall[]; mention: LeadIntakeMention | null }
  | { ok: false; fieldErrors: Record<string, string> }

/** Leerstring ist keine Angabe (dieselbe Normalisierung wie `capture_lead` selbst). */
function orNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

/** Die drei Formen, die `zuordnung` annehmen kann — mehr gibt es nicht. */
export const PARTNER_OPTION_PREFIX = 'partner:'
export const MENTION_OPTION_PREFIX = 'firma:'
export const NEW_MENTION_OPTION = 'neu'

const ZUORDNUNG_UNGUELTIG =
  'Diese Auswahl kennen wir nicht. Bitte die Seite neu laden und noch einmal wählen.'

/**
 * Prüft die Eingabe und stellt den Ablauf zusammen — die EINZIGE Stelle, an der entschieden wird,
 * wie viele `capture_lead`-Aufrufe entstehen, mit welchen Argumenten, und ob danach eine formlose
 * Firmenerwähnung zugeordnet wird.
 *
 * `activePartnerSlugs` sind die Slugs, die das Formular tatsächlich angeboten hat. Die Prüfung
 * dagegen ist keine Förmlichkeit: Ein Fachbetrieb kann zwischen Aufbau der Seite und Klick
 * stillgelegt worden sein, und dann darf keine Freigabe an ihn entstehen.
 *
 * `knownBusinessIds` ist dasselbe für die formlos erfassten Firmen. Hier steht zwar kein
 * Zugriffsrecht auf dem Spiel, aber dieselbe Überlegung: eine Kennung, die es nicht gibt, würde von
 * `admin_attach_mentioned_business` mit 22023 abgewiesen — und das wäre ein technischer Fehler
 * NACH dem Anlegen des Leads statt eine Feldmeldung davor.
 */
export function planLeadIntake(
  input: LeadIntakeInput,
  activePartnerSlugs: readonly string[],
  knownBusinessIds: readonly string[] = [],
): LeadIntakePlan {
  const parsed = leadIntakeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, fieldErrors: toFieldErrors(parsed.error.issues) }

  const values = parsed.data
  const zuordnung = orNull(values.zuordnung)

  let partnerSlug: string | null = null
  let mention: LeadIntakeMention | null = null

  if (zuordnung !== null) {
    if (zuordnung.startsWith(PARTNER_OPTION_PREFIX)) {
      partnerSlug = zuordnung.slice(PARTNER_OPTION_PREFIX.length) || null
      if (partnerSlug === null || !activePartnerSlugs.includes(partnerSlug)) {
        return {
          ok: false,
          fieldErrors: {
            zuordnung:
              'Diesen Fachbetrieb gibt es nicht mehr oder er ist stillgelegt. Bitte neu wählen.',
          },
        }
      }
    } else if (zuordnung.startsWith(MENTION_OPTION_PREFIX)) {
      const businessId = zuordnung.slice(MENTION_OPTION_PREFIX.length) || null
      if (businessId === null || !knownBusinessIds.includes(businessId)) {
        return {
          ok: false,
          fieldErrors: {
            zuordnung: 'Diese Firma kennen wir nicht mehr. Bitte neu wählen oder neu eintragen.',
          },
        }
      }
      mention = { kind: 'existing', businessId }
    } else if (zuordnung === NEW_MENTION_OPTION) {
      /*
       * Der Name ist hier PFLICHT — aber nur in diesem Zweig. Wer „neue Firma eintragen" wählt und
       * das Feld leer lässt, hat sich vertan; still auf „keine Zuordnung" zurückzufallen sähe aus
       * wie eine gespeicherte Angabe und wäre keine.
       */
      const name = orNull(values.neueFirma)
      if (name === null) {
        return {
          ok: false,
          fieldErrors: {
            neueFirma:
              'Bitte den Namen der Firma eintragen — oder oben eine andere Auswahl treffen.',
          },
        }
      }
      mention = { kind: 'new', name }
    } else {
      /*
       * Weder Präfix noch bekannter Wert: das kann aus keinem gerenderten Auswahlfeld stammen.
       * Abweisen statt verwerfen — dieselbe Regel wie beim stillgelegten Fachbetrieb.
       */
      return { ok: false, fieldErrors: { zuordnung: ZUORDNUNG_UNGUELTIG } }
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
  /*
   * Eine formlos genannte Firma ist ausdrücklich KEIN Gegenstand dieser Freigabe: Sie hat kein
   * Konto, kein Portal und keinen Anspruch — `public.get_my_partner_leads` kennt sie nicht und soll
   * sie nie kennen. Der Zweig oben fängt den Fall bereits ab (`partnerSlug` bleibt dann null); der
   * Hinweis steht hier, damit ihn niemand als vergessene Bedingung „ergänzt".
   */

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
    thema: orNull(values.thema),
  }

  if (!wantsDisclosure) return { ok: true, calls: [base], mention }

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
        /*
         * Das Thema fährt aus demselben Grund nicht mit: Der zweite Aufruf schreibt eine
         * EINWILLIGUNG, nicht die Angaben. `capture_lead` führt das Thema zwar mit
         * `coalesce(neu, Bestand)` zusammen (der jüngere Wert gewinnt) — derselbe Wert ein zweites
         * Mal geschickt änderte also nichts, liesse den Aufruf aber so aussehen, als trüge er die
         * Angabe. Dieselbe Entscheidung wie in `lib/leads/capture.ts` für den öffentlichen Weg.
         */
        thema: null,
      },
    ],
    mention,
  }
}
