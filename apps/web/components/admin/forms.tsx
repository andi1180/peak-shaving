'use client'

/**
 * Die beiden Anlege-Formulare des Admin-Bereichs (T4-4): Scraper-Ziel und Gutscheincode.
 * Rollen werden NICHT hier vergeben, sondern zeilenweise in der Nutzertabelle (ActionButton) —
 * eine UUID abzutippen wäre eine Fehlerquelle ohne Nutzen.
 *
 * Muster wie die Auth-/Einlöse-Formulare: echtes `<form action={formAction}>` (funktioniert ohne
 * JavaScript), `useActionState` für Ladezustand und Fehler, Fokus springt ins erste fehlerhafte
 * Feld, Eingaben bleiben nach einer Ablehnung stehen.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox, Label } from '@/components/ui/input'
import { createCodeAction, upsertScrapeTargetAction } from '@/lib/admin/actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { PRODUCT_KEYS, PRODUCT_LABELS } from '@/lib/admin/config'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from './ui'

/** Fokussiert nach dem Absenden das erste fehlerhafte Feld (Muster wie `useFocusFirstError`). */
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

// ── Scraper-Ziel ─────────────────────────────────────────────────────────────────────────────────

const TARGET_FIELDS = ['providerSlug', 'providerName', 'tariffPageUrl', 'sortPriority'] as const

export function ScrapeTargetForm() {
  const [state, formAction, isPending] = useActionState(upsertScrapeTargetAction, ADMIN_INITIAL_STATE)
  const prefix = `target-${React.useId()}`
  useFocusFirstError(state.fieldErrors, TARGET_FIELDS, prefix)

  const fe = state.fieldErrors
  const v = state.values

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-providerSlug`}
          name="providerSlug"
          label="Kurz-Key"
          defaultValue={v?.providerSlug}
          placeholder="wien-energie"
          error={fe?.providerSlug}
          hint="Stabiler Schlüssel. Ein bereits vorhandener Key bearbeitet das bestehende Ziel."
          required
        />
        <AdminField
          id={`${prefix}-providerName`}
          name="providerName"
          label="Anbietername"
          defaultValue={v?.providerName}
          placeholder="Wien Energie"
          error={fe?.providerName}
          required
        />
      </div>

      <AdminField
        id={`${prefix}-tariffPageUrl`}
        name="tariffPageUrl"
        label="Tarifseite"
        type="url"
        defaultValue={v?.tariffPageUrl}
        placeholder="https://www.beispiel.at/strom/tarife"
        error={fe?.tariffPageUrl}
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-networkArea`}
          name="networkArea"
          label="Netzgebiet (optional)"
          defaultValue={v?.networkArea}
          placeholder="Wien"
          error={fe?.networkArea}
        />
        <AdminField
          id={`${prefix}-sortPriority`}
          name="sortPriority"
          label="Reihenfolge"
          inputMode="numeric"
          defaultValue={v?.sortPriority ?? '100'}
          error={fe?.sortPriority}
          hint="Kleiner Wert = früher verarbeitet."
        />
      </div>

      <AdminField
        id={`${prefix}-notes`}
        name="notes"
        label="Notiz (optional)"
        defaultValue={v?.notes}
        error={fe?.notes}
      />

      <div className="flex items-start gap-2">
        <Checkbox id={`${prefix}-isActive`} name="isActive" defaultChecked />
        <Label htmlFor={`${prefix}-isActive`} className="font-normal">
          Aktiv — wird beim nächsten Lauf abgefragt
        </Label>
      </div>

      <p className="text-caption text-text-muted">
        Die Extraktionsregel (Selektoren) pflegt die Entwicklung. Eine vorhandene Regel bleibt beim
        Bearbeiten erhalten.
      </p>

      <div>
        <Submit isPending={isPending} label="Ziel speichern" pendingLabel="Wird gespeichert …" />
      </div>
    </form>
  )
}

// ── Gutscheincode ────────────────────────────────────────────────────────────────────────────────

const CODE_FIELDS = ['code', 'productKey', 'maxRedemptions', 'expiresAt'] as const

export function CodeForm() {
  const [state, formAction, isPending] = useActionState(createCodeAction, ADMIN_INITIAL_STATE)
  const prefix = `code-${React.useId()}`
  useFocusFirstError(state.fieldErrors, CODE_FIELDS, prefix)

  const fe = state.fieldErrors
  const v = state.values

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-code`}
          name="code"
          label="Code"
          defaultValue={v?.code}
          placeholder="sommer26"
          error={fe?.code}
          hint="Groß-/Kleinschreibung spielt beim Einlösen keine Rolle."
          required
        />
        <AdminSelect
          id={`${prefix}-productKey`}
          name="productKey"
          label="Produkt"
          defaultValue={v?.productKey ?? 'monitor'}
          error={fe?.productKey}
        >
          {PRODUCT_KEYS.map((key) => (
            <option key={key} value={key}>
              {PRODUCT_LABELS[key]}
            </option>
          ))}
        </AdminSelect>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-maxRedemptions`}
          name="maxRedemptions"
          label="Maximale Einlösungen"
          inputMode="numeric"
          defaultValue={v?.maxRedemptions}
          error={fe?.maxRedemptions}
          hint="Leer lassen für unbegrenzt."
        />
        <AdminField
          id={`${prefix}-expiresAt`}
          name="expiresAt"
          label="Gültig bis"
          type="datetime-local"
          defaultValue={v?.expiresAt}
          error={fe?.expiresAt}
          hint="Leer lassen für unbefristet. Ortszeit Wien."
        />
      </div>

      <AdminField
        id={`${prefix}-note`}
        name="note"
        label="Notiz (optional)"
        defaultValue={v?.note}
        placeholder="Partneraktion Herbst"
        error={fe?.note}
      />

      <div>
        <Submit isPending={isPending} label="Code anlegen" pendingLabel="Wird angelegt …" />
      </div>
    </form>
  )
}
