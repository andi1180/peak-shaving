'use client'

/**
 * B19 — das Formular für eine telefonisch hereingekommene Anfrage.
 *
 * ── ES IST BEWUSST NICHT DAS ÖFFENTLICHE KONTAKTFORMULAR ────────────────────────────────────────
 * `components/kontakt/kontakt-form.tsx` wiederzuverwenden wäre naheliegend und falsch: Es trägt
 * Turnstile, einen Honeypot, eine Nachricht, ein Marketing-Häkchen und next-intl-Texte. Nichts
 * davon passt. Der Honeypot fängt Bots — hier ist die Anmeldung die Prüfung. Die Nachricht lebt
 * dort in der internen Benachrichtigungsmail, die hier nicht entsteht. Und das Marketing-Häkchen
 * ist ohne Bestätigungsmail nicht einlösbar (ausführlich in `lib/admin/lead-intake.ts`).
 *
 * ── DIE FEHLENDEN FELDER SIND DIE AUSSAGE DIESES FORMULARS ──────────────────────────────────────
 * Keine Nachricht, kein Marketing — beides wäre eine Requisite, die aussähe, als bewirkte sie
 * etwas. Die Oberfläche sagt an Ort und Stelle, warum sie fehlen, statt es dem nächsten Leser als
 * Lücke zu überlassen.
 *
 * DAS THEMA GEHÖRTE BIS ZULETZT IN DIESE AUFZÄHLUNG und tut es nicht mehr: `platform.leads.thema`
 * existiert, der Wert ist auf der Detailseite lesbar, und damit ist das Feld keine Requisite mehr.
 * Es bleibt OPTIONAL — anders als im öffentlichen Formular, wo der Absender selbst wählt: Hier
 * ordnet ein Mensch ein Telefonat ein, und nicht jedes Gespräch lässt sich sauber zuschlagen.
 *
 * ⚠ DIE OPTIONEN KOMMEN ALS PROP HEREIN, NICHT AUS EINER LISTE IN DIESER DATEI. Sie stammen aus
 * `lib/kontakt/themen.ts` (datengetrieben aus `LEISTUNGEN`); die Beschriftungen löst die Seite
 * serverseitig auf. Acht Wörter hier abzutippen wäre die zweite Liste, gegen die jenes Modul
 * gebaut ist.
 */

import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Label } from '@/components/ui/input'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from '@/components/admin/ui'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { createLeadAction } from '@/lib/admin/lead-intake-actions'
import {
  MENTION_OPTION_PREFIX,
  NEW_MENTION_OPTION,
  PARTNER_OPTION_PREFIX,
} from '@/lib/admin/lead-intake'
import type { ThemaOption } from '@/lib/admin/lead-thema'

export type PartnerOption = { slug: string; displayName: string }
export type MentionedBusinessOption = { id: string; name: string }

export function LeadIntakeForm({
  partners,
  mentionedBusinesses,
  themen,
  partnerDisclosureConsentText,
}: {
  /** Nur AKTIVE Fachbetriebe — die Server Action prüft die Auswahl unabhängig davon erneut. */
  partners: PartnerOption[]
  /**
   * Die formlos erfassten Firmen (`platform.mentioned_businesses`). Sie stehen im SELBEN Auswahlfeld
   * wie die Fachbetriebe, weil die Frage am Telefon dieselbe ist („wer hat Sie geschickt?") — was
   * die beiden Antworten BEWIRKEN, ist allerdings grundverschieden, und genau deshalb tragen die
   * Optionswerte ein Präfix (s. `lib/admin/lead-intake.ts`).
   */
  mentionedBusinesses: MentionedBusinessOption[]
  /**
   * Die Themen aus `lib/kontakt/themen.ts`, Beschriftungen serverseitig aufgelöst — dieselbe Liste
   * und dieselbe Reihenfolge wie im öffentlichen Formular. Ist sie leer, entfällt das Feld: eine
   * Auswahl ohne Optionen wäre ein Bedienelement ohne Wirkung.
   */
  themen: ThemaOption[]
  /**
   * Der WORTLAUT der Freigabe aus `platform.consent_texts`. Ist er `null`, wird die
   * Ankreuzmöglichkeit gar nicht erst gerendert: Ohne den Text, dem zugestimmt wird, darf keine
   * Einwilligung entstehen — angezeigter und archivierter Wortlaut müssen dieselbe Quelle haben
   * (B1-1, append-only). Dieselbe Regel wie auf der Partner-Landingpage.
   */
  partnerDisclosureConsentText: string | null
}) {
  const [state, formAction, isPending] = useActionState(createLeadAction, ADMIN_INITIAL_STATE)

  /*
   * Nur die Zuordnung ist kontrolliert: An ihr hängen ZWEI Dinge — ob die Freigabe ankreuzbar ist
   * (nur bei einem echten Fachbetrieb) und ob das Feld für eine neue Firma erscheint. Der Rest
   * läuft unkontrolliert über `defaultValue`; nach einer beanstandeten Eingabe kommen die Werte
   * über `state.values` zurück, damit niemand alles neu tippen muss.
   */
  const [zuordnung, setZuordnung] = React.useState(state.values?.zuordnung ?? '')
  const isPartner = zuordnung.startsWith(PARTNER_OPTION_PREFIX)
  const isNewBusiness = zuordnung === NEW_MENTION_OPTION
  const fieldError = (name: string) => state.fieldErrors?.[name]

  return (
    /*
     * `key` auf der Erfolgsmeldung: Nach dem Speichern wird das Formular neu aufgebaut und ist
     * leer. Am Telefon folgt der nächste Anruf, und ein Formular, das noch die Daten des vorigen
     * Anrufers trägt, ist die Vorlage für einen falsch zusammengesetzten Datensatz.
     */
    <form key={state.success ?? 'neu'} action={formAction} className="space-y-6">
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
      {state.formError && <AdminError>{state.formError}</AdminError>}

      {/*
       * DIE ZUSAGE STEHT ÜBER DEM FORMULAR, NICHT IM KLEINGEDRUCKTEN. Wer hier tippt, hat den
       * Anrufer in der Leitung und muss wissen, was gleich passiert — und vor allem, was NICHT
       * passiert: Es geht keine Nachricht raus, weder an den Interessenten noch intern.
       */}
      <div className="rounded-lg border border-border bg-surface-subtle p-4 text-body-sm text-text">
        <p className="font-medium text-ink">Dieser Weg versendet keine E-Mail.</p>
        <p className="mt-1 text-text-muted">
          Weder an die eingetragene Adresse noch intern. Der Kontakt wird ausschliesslich
          gespeichert — die Adresse deshalb am Telefon zurücklesen lassen, eine Prüfmail gibt es
          nicht.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id="lead-vorname"
          name="vorname"
          label="Vorname"
          required
          defaultValue={state.values?.vorname}
          error={fieldError('vorname')}
        />
        <AdminField
          id="lead-nachname"
          name="nachname"
          label="Nachname"
          required
          defaultValue={state.values?.nachname}
          error={fieldError('nachname')}
        />
      </div>

      <AdminField
        id="lead-email"
        name="email"
        label="E-Mail"
        type="email"
        required
        defaultValue={state.values?.email}
        error={fieldError('email')}
        hint="Bitte zurücklesen lassen — eine falsch verstandene Adresse fällt sonst nie auf."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id="lead-unternehmen"
          name="unternehmen"
          label="Unternehmen"
          defaultValue={state.values?.unternehmen}
          error={fieldError('unternehmen')}
        />
        <AdminField
          id="lead-telefon"
          name="telefon"
          label="Telefon"
          defaultValue={state.values?.telefon}
          error={fieldError('telefon')}
        />
      </div>

      {/*
       * ── DAS THEMA: OPTIONAL, UND DAS IST DER UNTERSCHIED ZUM ÖFFENTLICHEN FORMULAR ────────────
       * Dort ist es Pflicht, weil der Absender selbst aus einer Liste wählt, die er vor sich sieht.
       * Hier ordnet ein Mensch ein Telefonat ein — und nicht jedes Gespräch lässt sich sauber
       * einem Thema zuschlagen. Ein Pflichtfeld erzwänge dann eine erfundene Zuordnung, und
       * „Sonstiges" hiesse hinterher sowohl „passt nirgends" als auch „wollte niemand entscheiden".
       *
       * Die Optionen sind dieselben wie im öffentlichen Dropdown (aus `lib/kontakt/themen.ts`,
       * datengetrieben aus den Leistungen) — es gibt hier keine eigene Liste, die abdriften könnte.
       */}
      {themen.length > 0 && (
        <AdminSelect
          id="lead-thema"
          name="thema"
          label="Thema (optional)"
          defaultValue={state.values?.thema ?? ''}
          error={fieldError('thema')}
          hint="Worum ging es im Gespräch? Dieselbe Einteilung wie im Kontaktformular auf der Website. Leer lassen, wenn sich das Anliegen nicht sauber zuordnen lässt — eine erfundene Zuordnung verfälscht die Auswertung mehr, als eine fehlende sie kostet."
        >
          <option value="">— keine Angabe —</option>
          {themen.map((thema) => (
            <option key={thema.key} value={thema.key}>
              {thema.label}
            </option>
          ))}
        </AdminSelect>
      )}

      {/*
       * ── EIN FELD, ZWEI SEHR VERSCHIEDENE WIRKUNGEN ────────────────────────────────────────────
       * Am Telefon ist es EINE Frage: „Wer hat Sie geschickt?" Der ausgewählte Wert entscheidet
       * aber darüber, ob eine ZUORDNUNG entsteht (echter Fachbetrieb — er sieht die Anfrage später
       * in seinem Portal und bekommt das erste Zugriffsrecht auf die Montage) oder nur eine NOTIZ
       * (formlos genannte Firma — sie bewirkt nichts ausser Wiederfindbarkeit beim nächsten Anruf).
       * Deshalb sind die Optionen in zwei benannte Gruppen geteilt, statt in einer Liste zu stehen.
       */}
      <AdminSelect
        id="lead-zuordnung"
        name="zuordnung"
        label="Empfohlen durch"
        defaultValue={zuordnung}
        error={fieldError('zuordnung')}
        hint="Nur ein Fachbetrieb aus der ersten Gruppe sieht die Anfrage später in seinem Portal. Formlos erfasste Firmen sind eine reine Notiz."
        /*
         * Der Select bleibt UNKONTROLLIERT (`defaultValue` trägt die Wiederanzeige); der Beobachter
         * liest den Wert nur mit, weil Freigabe und Firmen-Feld daran hängen.
         */
        onValueChange={setZuordnung}
      >
        <option value="">— keine Angabe —</option>
        {partners.length > 0 && (
          <optgroup label="Fachbetriebe (Partner)">
            {partners.map((partner) => (
              <option key={partner.slug} value={`${PARTNER_OPTION_PREFIX}${partner.slug}`}>
                {partner.displayName}
              </option>
            ))}
          </optgroup>
        )}
        {mentionedBusinesses.length > 0 && (
          <optgroup label="Formlos erfasste Firmen">
            {mentionedBusinesses.map((business) => (
              <option key={business.id} value={`${MENTION_OPTION_PREFIX}${business.id}`}>
                {business.name}
              </option>
            ))}
          </optgroup>
        )}
        <option value={NEW_MENTION_OPTION}>+ Neue Firma eintragen …</option>
      </AdminSelect>

      {/*
       * Erscheint nur, wenn „neue Firma" gewählt ist. Ein dauerhaft sichtbares Feld neben der Liste
       * wäre die Einladung, denselben Betrieb beim nächsten Anruf erneut zu tippen — genau das, was
       * dieser Abschnitt abschafft.
       */}
      {isNewBusiness && (
        <AdminField
          id="lead-neue-firma"
          name="neueFirma"
          label="Name der Firma"
          required
          defaultValue={state.values?.neueFirma}
          error={fieldError('neueFirma')}
          hint="Wird beim Speichern angelegt und steht ab dem nächsten Anruf in der Auswahl. Gleiche Schreibweise findet den bestehenden Eintrag — es entsteht kein Duplikat."
        />
      )}

      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-caption font-medium text-text-muted">Einwilligungen</legend>

        <div className="flex items-start gap-2">
          <Checkbox
            id="lead-datenschutz"
            name="datenschutz"
            defaultChecked={state.values?.datenschutz === 'on'}
          />
          <Label htmlFor="lead-datenschutz" className="font-normal text-text">
            Der Anrufer hat der Verarbeitung seiner Daten nach unserer Datenschutzerklärung
            zugestimmt.
          </Label>
        </div>
        {fieldError('datenschutz') && (
          <p role="alert" className="pl-7 text-caption text-negative">
            {fieldError('datenschutz')}
          </p>
        )}

        {partnerDisclosureConsentText && (
          <>
            <div className="flex items-start gap-2 border-t border-border pt-3">
              <Checkbox
                id="lead-partner-freigabe"
                name="partnerFreigabe"
                defaultChecked={state.values?.partnerFreigabe === 'on'}
                disabled={!isPartner}
              />
              <Label htmlFor="lead-partner-freigabe" className="font-normal text-text">
                {partnerDisclosureConsentText}
              </Label>
            </div>
            <p className="pl-7 text-caption text-text-muted">
              {isPartner
                ? 'Wirkt sofort: Der Betrieb sieht die Anfrage mit Namen in seinem Portal. Ohne Freigabe zählt sie dort nur mit.'
                : 'Erst wählbar, wenn oben ein Fachbetrieb (erste Gruppe) zugeordnet ist — eine formlos erfasste Firma hat kein Portal, die Freigabe hätte dort keinen Gegenstand.'}
            </p>
            {fieldError('partnerFreigabe') && (
              <p role="alert" className="pl-7 text-caption text-negative">
                {fieldError('partnerFreigabe')}
              </p>
            )}
          </>
        )}
      </fieldset>

      {/*
       * WAS DIESES FORMULAR NICHT ERHEBT, und warum — an Ort und Stelle statt nur im Handover.
       * Ohne diesen Absatz liest sich das Fehlen von Nachricht und Marketing wie eine Lücke, die
       * jemand „nur noch schnell" schliesst; genau dabei entstünden entweder ein Feld ohne
       * Speicherort oder eine Einwilligung ohne Rechtswert.
       *
       * Das THEMA stand hier bis zuletzt mit drin und ist herausgenommen — es hat jetzt eine
       * Spalte und steht oben als Auswahlfeld. Ein Absatz, der sein Fehlen erklärt, während es
       * daneben zu sehen ist, wäre schlimmer als keiner.
       */}
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-body-sm font-medium text-ink">
          Warum es hier kein Feld für die Nachricht und keine Werbe-Einwilligung gibt
        </summary>
        <div className="mt-3 space-y-2 text-body-sm text-text-muted">
          <p>
            <span className="font-medium text-text">Nachricht:</span> Dafür gibt es keine Spalte.
            Der Lead-Bestand speichert ausschliesslich Identitätsfelder und die Einordnung; im
            öffentlichen Formular lebt der Nachrichtentext allein in der internen
            Benachrichtigungsmail — und die entsteht hier nicht. Ein Feld, dessen Inhalt beim
            Speichern verschwindet, sähe aus wie eine Notiz und wäre keine. Das Anliegen gehört bis
            auf Weiteres in die Gesprächsnotiz; für die grobe Einordnung ist das Thema oben da.
          </p>
          <p>
            <span className="font-medium text-text">Werbe-Einwilligung:</span> Sie verlangt eine
            Bestätigung per E-Mail (Double-Opt-in). Ohne die bliebe sie dauerhaft unbestätigt und
            damit rechtlich wertlos — sie sähe hier aus wie eine Zustimmung und wäre keine. Wer
            Werbung möchte, trägt sich über die Website selbst ein.
          </p>
        </div>
      </details>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird gespeichert …' : 'Lead speichern'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird gespeichert …' : ''}
        </span>
      </div>
    </form>
  )
}
