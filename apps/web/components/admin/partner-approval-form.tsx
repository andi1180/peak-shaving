'use client'

/**
 * Der Genehmigungsschritt auf der Antrags-Detailseite (B16-4a).
 *
 * ── WARUM DIESES FORMULAR MEHR IST ALS EIN KNOPF ────────────────────────────────────────────────
 * Es ist der einzige Vorgang des Admin-Bereichs, der drei unumkehrbare Dinge auf einmal tut: Er legt
 * einen Fachbetrieb an (den es für niemanden ein `delete`-Grant gibt), vergibt einen Kurz-Key, der
 * danach unveränderlich ist (Trigger `platform.guard_partner_slug`), und setzt einen Antrag
 * endgültig auf „genehmigt". Der Kurz-Key wandert anschliessend in Links, die der Betrieb an
 * hunderte Bestandskunden verschickt — ab dann ist er auch faktisch nicht mehr zurückholbar.
 *
 * Deshalb drei Dinge, die ein blosser Knopf nicht könnte:
 *   1. ein VORSCHLAG aus dem Firmennamen (`suggestPartnerSlug`), frei überschreibbar,
 *   2. eine Verfügbarkeitsprüfung, die WÄHREND DES TIPPENS antwortet statt nach dem Bestätigen,
 *   3. ein ausdrückliches Häkchen, das die Unveränderlichkeit benennt, bevor der Knopf benutzbar
 *      wird.
 *
 * ── DIE VERFÜGBARKEITSPRÜFUNG IST EINE HILFE, KEINE ZUSAGE ──────────────────────────────────────
 * Sie vergleicht gegen die Liste der bereits vergebenen Kurz-Keys, die die Seite serverseitig aus
 * `public.admin_list_partners` mitgibt. Ein eigener Prüf-Wrapper wäre eine zweite Definition von
 * „vergeben" — und er könnte trotzdem nicht garantieren, dass der Key im Moment des Bestätigens noch
 * frei ist. Die harte Grenze bleibt der Wrapper (`duplicate_slug`) und dahinter der Primärschlüssel;
 * hier steht nur die lesbare Fassung davor.
 *
 * Muster wie `components/admin/partner-forms.tsx`: echtes `<form action={formAction}>` (funktioniert
 * ohne JavaScript — dann entfällt nur die Sofortmeldung, nicht die Prüfung), `useActionState` für
 * Ladezustand und Fehler.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Label } from '@/components/ui/input'
import { approvePartnerApplicationAction } from '@/lib/admin/partner-applications-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { PARTNER_SLUG_PATTERN, suggestPartnerSlug } from '@/lib/admin/partner-slug'
import { AdminError, AdminField, AdminSuccess } from './ui'

export function PartnerApprovalForm({
  applicationId,
  company,
  takenSlugs,
}: {
  applicationId: string
  /** Der Firmenname AUS DEM ANTRAG — Grundlage des Vorschlags, nicht des gespeicherten Wertes. */
  company: string
  /** Die bereits vergebenen Kurz-Keys, serverseitig gelesen (s. Kopf). */
  takenSlugs: readonly string[]
}) {
  const [state, formAction, isPending] = useActionState(
    approvePartnerApplicationAction,
    ADMIN_INITIAL_STATE,
  )
  const prefix = `approve-${applicationId}`

  const vorschlag = React.useMemo(() => suggestPartnerSlug(company), [company])
  const [slug, setSlug] = React.useState(vorschlag)
  const [bestaetigt, setBestaetigt] = React.useState(false)

  React.useEffect(() => {
    if (state.fieldErrors?.slug) document.getElementById(`${prefix}-slug`)?.focus()
  }, [state.fieldErrors, prefix])

  const normalisiert = slug.trim().toLowerCase()
  const vergeben = normalisiert !== '' && takenSlugs.includes(normalisiert)
  const formfehler =
    normalisiert !== '' && !PARTNER_SLUG_PATTERN.test(normalisiert)
      ? 'Nur Kleinbuchstaben, Ziffern und Bindestriche — keine Unterstriche, keine Umlaute.'
      : normalisiert !== '' && normalisiert.length < 2
        ? 'Mindestens 2 Zeichen.'
        : undefined

  /*
   * Nach dem Erfolg ist der Vorgang vorbei: Die Seite lädt neu (`revalidatePath`) und zeigt den
   * genehmigten Zustand. Das Formular hier bleibt bis dahin stehen und zeigt die Meldung — der Knopf
   * wird gesperrt, damit ein zweiter Klick nicht in die (ohnehin greifende) `already_reviewed`-
   * Ablehnung läuft und wie ein Fehler aussieht.
   */
  const erledigt = Boolean(state.success)

  return (
    <form action={formAction} noValidate className="mt-4 flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <input type="hidden" name="id" value={applicationId} />

      <div className="max-w-md">
        <AdminField
          id={`${prefix}-slug`}
          name="slug"
          label="Kurz-Key des Fachbetriebs"
          value={slug}
          onValueChange={setSlug}
          placeholder="raymann"
          error={state.fieldErrors?.slug ?? formfehler}
          hint={
            vorschlag
              ? `Vorschlag aus dem Firmennamen: ${vorschlag}. Frei überschreibbar — und nach der Genehmigung UNVERÄNDERLICH.`
              : 'Aus dem Firmennamen liess sich kein Vorschlag bilden. Nach der Genehmigung ist der Kurz-Key UNVERÄNDERLICH.'
          }
          required
        />
        {/*
          Die Verfügbarkeit steht direkt unter dem Feld und meldet sich beim Tippen — nicht erst
          nach dem Bestätigen eines Vorgangs, der nicht zurücknehmbar ist.
        */}
        {vergeben && (
          <p role="status" className="mt-1.5 text-caption text-negative">
            Dieser Kurz-Key ist bereits vergeben. Er identifiziert einen bestehenden Fachbetrieb und
            wird nicht überschrieben.
          </p>
        )}
        {!vergeben && normalisiert !== '' && !formfehler && (
          <p role="status" className="mt-1.5 text-caption text-text-muted">
            Kurz-Key ist frei. Der Empfehlungslink lautet danach{' '}
            <span className="text-text">/partner/{normalisiert}</span>.
          </p>
        )}
      </div>

      <div className="rounded-md border border-warning-border bg-warning-subtle p-3">
        <p className="text-small text-ink">Was mit dem Bestätigen passiert — und nicht passiert:</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-caption text-ink">
          <li>
            Der Fachbetrieb wird mit den Angaben AUS DEM ANTRAG angelegt und mit dem Konto des
            Antrags verknüpft. Firma und Ansprechperson lassen sich später korrigieren, der Kurz-Key
            NICHT.
          </li>
          <li>
            Der Antrag ist danach endgültig geprüft. Eine Genehmigung lässt sich über die Oberfläche
            nicht zurücknehmen, und Fachbetriebe sind nicht löschbar.
          </li>
          {/*
            B16-4b hat diesen Punkt umgedreht: Bis dahin stand hier, dass KEINE Nachricht rausgeht.
            Seit die Genehmigungsmail existiert, ist der Hinweis, der gebraucht wird, ein anderer —
            dass sofort eine Mail an einen realen Betrieb rausgeht, und dass sie sich nicht
            zurückholen lässt. Was danach tatsächlich passiert ist (versendet · nicht versendet ·
            versendet, aber nicht vermerkt), sagt die Rückmeldung nach dem Bestätigen.
          */}
          <li>
            <span className="font-medium">Der Betrieb wird sofort per E-Mail benachrichtigt.</span>{' '}
            Er bekommt seinen Empfehlungslink und den Weg ins Partner-Portal. Scheitert der Versand,
            steht das in der Rückmeldung — die Genehmigung selbst gilt trotzdem, und die
            Benachrichtigung lässt sich unter „Partner" nachholen.
          </li>
        </ul>
      </div>

      <div className="flex items-start gap-2">
        <Checkbox
          id={`${prefix}-confirm`}
          name="confirm"
          checked={bestaetigt}
          onChange={(e) => setBestaetigt(e.currentTarget.checked)}
        />
        <Label htmlFor={`${prefix}-confirm`} className="font-normal">
          Mir ist bewusst, dass der Kurz-Key danach unveränderlich ist und die Genehmigung nicht
          zurückgenommen werden kann.
        </Label>
      </div>

      <div>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={isPending || erledigt || !bestaetigt || vergeben || Boolean(formfehler)}
        >
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird genehmigt …' : 'Bewerbung genehmigen und Fachbetrieb anlegen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird genehmigt …' : ''}
        </span>
      </div>
    </form>
  )
}
