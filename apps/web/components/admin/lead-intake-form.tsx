'use client'

/**
 * B19 — das Formular für eine telefonisch hereingekommene Anfrage.
 *
 * ── ES IST BEWUSST NICHT DAS ÖFFENTLICHE KONTAKTFORMULAR ────────────────────────────────────────
 * `components/kontakt/kontakt-form.tsx` wiederzuverwenden wäre naheliegend und falsch: Es trägt
 * Turnstile, einen Honeypot, Thema und Nachricht, ein Marketing-Häkchen und next-intl-Texte. Nichts
 * davon passt. Der Honeypot fängt Bots — hier ist die Anmeldung die Prüfung. Thema und Nachricht
 * leben dort in der internen Benachrichtigungsmail, die hier nicht entsteht. Und das
 * Marketing-Häkchen ist ohne Bestätigungsmail nicht einlösbar (ausführlich in `lib/admin/lead-intake.ts`).
 *
 * ── DIE FEHLENDEN FELDER SIND DIE AUSSAGE DIESES FORMULARS ──────────────────────────────────────
 * Kein Thema, keine Nachricht, kein Marketing — jedes davon wäre eine Requisite, die aussähe, als
 * bewirkte sie etwas. Die Oberfläche sagt an Ort und Stelle, warum sie fehlen, statt es dem
 * nächsten Leser als Lücke zu überlassen.
 */

import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Label } from '@/components/ui/input'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from '@/components/admin/ui'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { createLeadAction } from '@/lib/admin/lead-intake-actions'

export type PartnerOption = { slug: string; displayName: string }

export function LeadIntakeForm({
  partners,
  partnerDisclosureConsentText,
}: {
  /** Nur AKTIVE Fachbetriebe — die Server Action prüft die Auswahl unabhängig davon erneut. */
  partners: PartnerOption[]
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
   * Nur die Zuordnung ist kontrolliert: An ihr hängt, ob die Freigabe überhaupt ankreuzbar ist.
   * Der Rest läuft unkontrolliert über `defaultValue` — nach einer beanstandeten Eingabe kommen die
   * Werte über `state.values` zurück, damit niemand alles neu tippen muss.
   */
  const [partnerSlug, setPartnerSlug] = React.useState(state.values?.partnerSlug ?? '')
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
          Weder an die eingetragene Adresse noch intern. Der Kontakt wird ausschliesslich gespeichert
          — die Adresse deshalb am Telefon zurücklesen lassen, eine Prüfmail gibt es nicht.
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

      <AdminField
        id="lead-empfehlung"
        name="empfehlung"
        label="Empfohlen durch (Freitext)"
        defaultValue={state.values?.empfehlung}
        error={fieldError('empfehlung')}
        hint="Was der Anrufer selbst gesagt hat, z. B. „mein Elektriker aus Wiener Neustadt“. Eine BEOBACHTUNG — die verbindliche Zuordnung ist das Feld darunter."
      />

      {/*
       * ZWEI FELDER FÜR DAS, WAS WIE EINES AUSSIEHT (B16-1). Oben der Freitext des Anrufers,
       * hier das Urteil: Nur dieses Feld entscheidet, wer die Anfrage später im Portal sieht und
       * wem ein Montageprojekt zugeteilt wird. In einem Feld vermischt liesse sich nicht mehr
       * feststellen, ob ein Name dort steht, weil der Kunde ihn genannt hat oder weil ihn jemand
       * zugeordnet hat.
       */}
      <AdminSelect
        id="lead-partner"
        name="partnerSlug"
        label="Fachbetrieb zuordnen"
        defaultValue={partnerSlug}
        error={fieldError('partnerSlug')}
        hint="Verbindliche Zuordnung. Nachträglich nur auf der Lead-Detailseite änderbar."
        /*
         * Der Select bleibt UNKONTROLLIERT (`defaultValue` trägt die Wiederanzeige); der Beobachter
         * liest den Wert nur mit, weil die Freigabe darunter daran hängt.
         */
        onValueChange={setPartnerSlug}
      >
        <option value="">— keine Zuordnung —</option>
        {partners.map((partner) => (
          <option key={partner.slug} value={partner.slug}>
            {partner.displayName}
          </option>
        ))}
      </AdminSelect>

      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-caption font-medium text-text-muted">Einwilligungen</legend>

        <div className="flex items-start gap-2">
          <Checkbox id="lead-datenschutz" name="datenschutz" defaultChecked={state.values?.datenschutz === 'on'} />
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
                disabled={partnerSlug === ''}
              />
              <Label htmlFor="lead-partner-freigabe" className="font-normal text-text">
                {partnerDisclosureConsentText}
              </Label>
            </div>
            <p className="pl-7 text-caption text-text-muted">
              {partnerSlug === ''
                ? 'Erst wählbar, wenn oben ein Fachbetrieb zugeordnet ist — eine Freigabe ohne Empfänger hätte keinen Gegenstand.'
                : 'Wirkt sofort: Der Betrieb sieht die Anfrage mit Namen in seinem Portal. Ohne Freigabe zählt sie dort nur mit.'}
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
       * Ohne diesen Absatz liest sich das Fehlen von Thema, Nachricht und Marketing wie eine
       * Lücke, die jemand „nur noch schnell" schliesst; genau dabei entstünden entweder ein
       * Feld ohne Speicherort oder eine Einwilligung ohne Rechtswert.
       */}
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-body-sm font-medium text-ink">
          Warum es hier kein Feld für Thema, Nachricht und Werbe-Einwilligung gibt
        </summary>
        <div className="mt-3 space-y-2 text-body-sm text-text-muted">
          <p>
            <span className="font-medium text-text">Thema und Nachricht:</span> Für beides gibt es
            keine Spalte. Der Lead-Bestand speichert ausschliesslich Identitätsfelder; im
            öffentlichen Formular leben Thema und Nachricht allein in der internen
            Benachrichtigungsmail — und die entsteht hier nicht. Das Anliegen gehört bis auf
            Weiteres in die Gesprächsnotiz.
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
