'use client'

/**
 * Die Formulare des Partner-Abschnitts (B16-2): Fachbetrieb anlegen, Stammdaten korrigieren, und der
 * fertige Empfehlungslink zum Kopieren.
 *
 * Muster wie `components/admin/forms.tsx`: echtes `<form action={formAction}>` (funktioniert ohne
 * JavaScript), `useActionState` für Ladezustand und Fehler, Fokus springt ins erste fehlerhafte
 * Feld, Eingaben bleiben nach einer Ablehnung stehen.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  createPartnerAction,
  linkPartnerAccountAction,
  updatePartnerAction,
} from '@/lib/admin/partners-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { PartnerRow } from '@/lib/admin/partners'
import { AdminError, AdminField, AdminSuccess } from './ui'

/** Fokussiert nach dem Absenden das erste fehlerhafte Feld (Muster wie `components/admin/forms.tsx`). */
function useFocusFirstError(
  fieldErrors: Record<string, string> | undefined,
  order: readonly string[],
  idPrefix: string,
) {
  React.useEffect(() => {
    if (!fieldErrors) return
    const first = order.find((name) => fieldErrors[name])
    if (first) document.getElementById(`${idPrefix}-${first}`)?.focus()
  }, [fieldErrors, order, idPrefix])
}

function Submit({
  isPending,
  label,
  pendingLabel,
}: {
  isPending: boolean
  label: string
  pendingLabel: string
}) {
  return (
    <>
      <Button type="submit" variant="primary" size="md" disabled={isPending}>
        {isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
        {isPending ? pendingLabel : label}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {isPending ? pendingLabel : ''}
      </span>
    </>
  )
}

// ── Anlegen ──────────────────────────────────────────────────────────────────────────────────────

const CREATE_FIELDS = ['slug', 'displayName', 'contactFirstName', 'contactLastName'] as const

export function CreatePartnerForm() {
  const [state, formAction, isPending] = useActionState(createPartnerAction, ADMIN_INITIAL_STATE)
  const prefix = `partner-new-${React.useId()}`
  useFocusFirstError(state.fieldErrors, CREATE_FIELDS, prefix)

  const fe = state.fieldErrors
  const v = state.values

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-slug`}
          name="slug"
          label="Kurz-Key"
          defaultValue={v?.slug}
          placeholder="raymann"
          error={fe?.slug}
          /*
           * Der wichtigste Hinweistext dieses Bereichs. Der Slug steht in Mails, die ein Fachbetrieb
           * an hunderte Bestandskunden verschickt; er ist danach unveränderlich (Trigger
           * `guard_partner_slug`, B16-1). Wer das erst nach dem Anlegen erfährt, erfährt es zu spät.
           */
          hint="Steht im Empfehlungslink und ist NACH dem Anlegen unveränderlich. Nur Kleinbuchstaben, Ziffern und Bindestriche."
          required
        />
        <AdminField
          id={`${prefix}-displayName`}
          name="displayName"
          label="Anzeigename (Firma)"
          defaultValue={v?.displayName}
          placeholder="Raymann Elektrotechnik GmbH"
          error={fe?.displayName}
          hint="So wird der Betrieb auf der Landingpage genannt. Später änderbar."
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-contactFirstName`}
          name="contactFirstName"
          label="Ansprechperson — Vorname (optional)"
          defaultValue={v?.contactFirstName}
          error={fe?.contactFirstName}
        />
        <AdminField
          id={`${prefix}-contactLastName`}
          name="contactLastName"
          label="Ansprechperson — Nachname (optional)"
          defaultValue={v?.contactLastName}
          error={fe?.contactLastName}
          /*
           * Steht hier und nicht nur im Code: Die Ansprechperson ist ein INTERNES Stammdatum. Sie
           * erreicht die öffentliche Landingpage nicht — `public.get_active_partner` gibt sie gar
           * nicht heraus (B16-2). Ohne diesen Satz wäre die naheliegende Sorge unbeantwortet.
           */
          hint="Nur intern. Erscheint nicht auf der Landingpage."
        />
      </div>

      <div>
        <Submit isPending={isPending} label="Fachbetrieb anlegen" pendingLabel="Wird angelegt …" />
      </div>
    </form>
  )
}

// ── Stammdaten korrigieren ───────────────────────────────────────────────────────────────────────

const EDIT_FIELDS = ['displayName', 'contactFirstName', 'contactLastName'] as const

export function PartnerEditForm({ partner }: { partner: PartnerRow }) {
  const [state, formAction, isPending] = useActionState(updatePartnerAction, ADMIN_INITIAL_STATE)
  const prefix = `partner-edit-${partner.slug}`
  useFocusFirstError(state.fieldErrors, EDIT_FIELDS, prefix)

  const fe = state.fieldErrors

  return (
    <form action={formAction} noValidate className="mt-4 flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      {/*
        Der Slug identifiziert den Datensatz und fährt deshalb MIT — als verborgenes Feld, nicht als
        `readOnly`-Eingabe: Er ist hier nichts, was man ansehen oder bearbeiten müsste (er steht
        bereits in der Überschrift der Karte), und ein deaktiviertes Feld sendete seinen Wert nicht.
        Ein änderndes Feld gibt es ohnehin nicht — `admin_update_partner` hat dafür keinen Parameter,
        und `guard_partner_slug` ist die harte Grenze dahinter.
      */}
      <input type="hidden" name="slug" value={partner.slug} />

      <AdminField
        id={`${prefix}-displayName`}
        name="displayName"
        label="Anzeigename (Firma)"
        defaultValue={state.values?.displayName ?? partner.display_name}
        error={fe?.displayName}
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-contactFirstName`}
          name="contactFirstName"
          label="Ansprechperson — Vorname"
          defaultValue={state.values?.contactFirstName ?? partner.contact_first_name ?? ''}
          error={fe?.contactFirstName}
        />
        <AdminField
          id={`${prefix}-contactLastName`}
          name="contactLastName"
          label="Ansprechperson — Nachname"
          defaultValue={state.values?.contactLastName ?? partner.contact_last_name ?? ''}
          error={fe?.contactLastName}
        />
      </div>

      {/*
        „Leer heisst löschen" — dieselbe Regel wie im Lead-Korrekturformular (B2-1) und aus demselben
        Grund: Ein Bearbeitungsformular schickt immer alle Felder, ein geleertes Feld ist eine
        Aussage. Sie gilt hier NUR für die Ansprechperson; der Anzeigename ist Pflicht.
      */}
      <p className="text-caption text-text-muted">
        Ein geleertes Feld der Ansprechperson löscht die Angabe. Der Kurz-Key lässt sich nicht
        ändern — er steht in bereits verschickten Mails.
      </p>

      <div>
        <Submit
          isPending={isPending}
          label="Änderungen speichern"
          pendingLabel="Wird gespeichert …"
        />
      </div>
    </form>
  )
}

// ── Konto verknüpfen (B16-4a) ────────────────────────────────────────────────────────────────────

/**
 * Hängt ein bestehendes Konto per E-Mail-Adresse an diesen Fachbetrieb.
 *
 * ── WOFÜR ES DIESES FORMULAR GIBT ───────────────────────────────────────────────────────────────
 * Ein von Hand angelegter Betrieb (Raymann) hat kein Konto — und der einzige andere Weg zu einem
 * führt über einen genehmigten Antrag, den es für ihn nicht gibt und nicht mehr geben kann (sein
 * Kurz-Key ist vergeben). Ohne dieses Formular könnte er das Partner-Portal aus B16-4b nie benutzen.
 *
 * ── ÜBER DIE ADRESSE, NICHT ÜBER EINE AUSWAHLLISTE ──────────────────────────────────────────────
 * Ein Admin hat die Adresse; eine Konto-Kennung hat er nicht. Eine Auswahlliste aller Konten
 * anzubieten wäre ein Verzeichnisdienst über alle Nutzer für eine Handlung, die zweimal im Jahr
 * vorkommt — dieselbe Überlegung wie bei der Rollenvergabe per E-Mail (T4-4).
 *
 * Es gibt bewusst KEIN Gegenstück zum Lösen: Der einzige vorgesehene Weg dorthin ist die Löschung
 * des Kontos durch die Person selbst. Der Satz steht sichtbar unter dem Feld, nicht nur hier.
 */
export function LinkAccountForm({ slug }: { slug: string }) {
  const [state, formAction, isPending] = useActionState(
    linkPartnerAccountAction,
    ADMIN_INITIAL_STATE,
  )
  const prefix = `partner-link-${slug}`
  useFocusFirstError(state.fieldErrors, ['email'] as const, prefix)

  return (
    <form action={formAction} noValidate className="mt-4 flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <input type="hidden" name="slug" value={slug} />

      <div className="max-w-md">
        <AdminField
          id={`${prefix}-email`}
          name="email"
          label="E-Mail-Adresse des Kontos"
          type="email"
          defaultValue={state.values?.email}
          placeholder="chef@fachbetrieb.at"
          error={state.fieldErrors?.email}
          hint="Das Konto muss bereits bestehen — dieses Formular legt keines an. Eine bestehende Zuordnung wird nicht überschrieben, und es gibt keinen Weg, sie hier wieder zu lösen."
          required
        />
      </div>

      <div>
        <Submit isPending={isPending} label="Konto verknüpfen" pendingLabel="Wird verknüpft …" />
      </div>
    </form>
  )
}

// ── Empfehlungslink ──────────────────────────────────────────────────────────────────────────────

/**
 * Der fertige Link zum Kopieren.
 *
 * ── ER STEHT ALS TEXT DA, NICHT NUR HINTER EINEM KNOPF ───────────────────────────────────────────
 * `navigator.clipboard` verlangt einen sicheren Kontext und kann von den Einstellungen des Browsers
 * abgelehnt werden. Wäre der Link nur über den Knopf erreichbar, hätte ein fehlgeschlagenes Kopieren
 * keinen Ausweg. Der `<code>`-Block ist deshalb die eigentliche Ausgabe, der Knopf die Bequemlichkeit
 * — und er sagt es, wenn er scheitert, statt so zu tun, als hätte er kopiert.
 *
 * Die URL wird SERVERSEITIG gebildet (`absoluteUrl`, `lib/site.ts`) und hereingereicht: Es gibt in
 * dieser App genau eine Basis-URL, und `window.location.origin` wäre eine zweite — auf einer
 * Preview-Domain entstünde damit ein Link, der einem Fachbetrieb ausgehändigt würde und in ein paar
 * Wochen ins Leere zeigt.
 */
export function ReferralLink({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setFailed(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
      setFailed(true)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="select-all break-all rounded-md border border-line bg-surface-sunken px-2 py-1 text-caption text-text">
          {url}
        </code>
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? (
            <Check className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          )}
          {copied ? 'Kopiert' : 'Link kopieren'}
        </Button>
      </div>
      {/* Ansage für Screenreader — ein Icon-Wechsel wird nicht vorgelesen. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? 'Link in die Zwischenablage kopiert.' : ''}
      </span>
      {failed && (
        <p className="mt-1.5 text-caption text-text-muted">
          Kopieren hat nicht geklappt — bitte den Link oben markieren und von Hand kopieren.
        </p>
      )}
    </div>
  )
}
