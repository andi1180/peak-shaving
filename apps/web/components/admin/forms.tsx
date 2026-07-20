'use client'

/**
 * Die Eingabe-Formulare des Admin-Bereichs: Scraper-Ziel, Rollenvergabe und Gutscheincode.
 *
 * Die Rollenvergabe ist mit der T4-4-Nacharbeit HIERHER gewandert. Vorher war sie ein Knopf je
 * Zeile in der Liste ALLER Konten; seit die Rollen-Liste nur noch Rollenträger zeigt, gäbe es dort
 * niemanden mehr zu befördern — der künftige Admin steht per Definition noch nicht darin. Die
 * Vergabe läuft deshalb über die E-Mail-Adresse. Der ENTZUG bleibt ein Zeilen-Knopf: sein Ziel
 * steht immer in der Liste.
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
import {
  createCodeAction,
  grantRoleByEmailAction,
  upsertScrapeTargetAction,
} from '@/lib/admin/actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { CODE_PRODUCT_KEYS, PRODUCT_LABELS } from '@/lib/admin/config'
import type { ScrapeTargetRow } from '@/lib/admin/types'
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

/**
 * `target` = das zu bearbeitende Ziel (aus der Tabelle vorbelegt) oder `null` für „neu anlegen".
 *
 * Die Vorbelegung ist der eigentliche Fix: der Upsert schreibt IMMER alle übergebenen Felder, ein
 * leer gelassenes Netzgebiet ist also ein geleertes Netzgebiet. Nur wenn das Formular den
 * vollständigen gespeicherten Stand zeigt, bedeutet „Speichern" auch „nur meine Änderung
 * speichern". Rangfolge: was der Nutzer zuletzt abgeschickt hat (`state.values`, damit eine
 * Ablehnung nichts wegwirft) vor dem gespeicherten Stand.
 */
export function ScrapeTargetForm({ target = null }: { target?: ScrapeTargetRow | null }) {
  const [state, formAction, isPending] = useActionState(upsertScrapeTargetAction, ADMIN_INITIAL_STATE)
  const prefix = `target-${React.useId()}`
  useFocusFirstError(state.fieldErrors, TARGET_FIELDS, prefix)

  const fe = state.fieldErrors
  const v = state.values
  const isEditing = target !== null
  /** Zuletzt Getipptes gewinnt über den gespeicherten Stand; der wiederum über „leer". */
  const val = (key: string, stored?: string | number | null): string | undefined =>
    v?.[key] ?? (stored == null ? undefined : String(stored))

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-providerSlug`}
          name="providerSlug"
          label="Kurz-Key"
          defaultValue={val('providerSlug', target?.provider_slug)}
          placeholder="wien-energie"
          error={fe?.providerSlug}
          /*
           * Beim Bearbeiten schreibgeschützt: der Slug ist der Konflikt-Key des Upserts. Ihn zu
           * ändern legte KEIN umbenanntes Ziel an, sondern ein zusätzliches zweites — und das alte
           * bliebe samt Verlauf zurück. Er wird trotzdem mitgeschickt (readOnly, nicht disabled),
           * denn er ist es, der das Ziel identifiziert.
           */
          readOnly={isEditing}
          hint={
            isEditing
              ? 'Nicht änderbar — der Kurz-Key identifiziert dieses Ziel samt Verlauf.'
              : 'Stabiler Schlüssel. Ein bereits vorhandener Key bearbeitet das bestehende Ziel.'
          }
          required
        />
        <AdminField
          id={`${prefix}-providerName`}
          name="providerName"
          label="Anbietername"
          defaultValue={val('providerName', target?.provider_name)}
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
        defaultValue={val('tariffPageUrl', target?.tariff_page_url)}
        placeholder="https://www.beispiel.at/strom/tarife"
        error={fe?.tariffPageUrl}
        required
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${prefix}-networkArea`}
          name="networkArea"
          label="Netzgebiet (optional)"
          defaultValue={val('networkArea', target?.network_area)}
          placeholder="Wien"
          error={fe?.networkArea}
        />
        <AdminField
          id={`${prefix}-sortPriority`}
          name="sortPriority"
          label="Reihenfolge"
          inputMode="numeric"
          defaultValue={val('sortPriority', target?.sort_priority) ?? '100'}
          error={fe?.sortPriority}
          hint="Kleiner Wert = früher verarbeitet."
        />
      </div>

      <AdminField
        id={`${prefix}-notes`}
        name="notes"
        label="Notiz (optional)"
        defaultValue={val('notes', target?.notes)}
        error={fe?.notes}
      />

      <div className="flex items-start gap-2">
        <Checkbox
          id={`${prefix}-isActive`}
          name="isActive"
          defaultChecked={isEditing ? target.is_active : true}
        />
        <Label htmlFor={`${prefix}-isActive`} className="font-normal">
          Aktiv — wird beim nächsten Lauf abgefragt
        </Label>
      </div>

      <p className="text-caption text-text-muted">
        Die Extraktionsregel (Selektoren) pflegt die Entwicklung. Eine vorhandene Regel bleibt beim
        Bearbeiten erhalten.
      </p>

      <div>
        <Submit
          isPending={isPending}
          label={isEditing ? 'Änderungen speichern' : 'Ziel anlegen'}
          pendingLabel="Wird gespeichert …"
        />
      </div>
    </form>
  )
}

// ── Rollenvergabe über die E-Mail ────────────────────────────────────────────────────────────────

const ROLE_FIELDS = ['email'] as const

/**
 * Vergibt die Administrator-Rolle an ein bestehendes Konto, gesucht über seine E-Mail.
 *
 * Bewusst KEINE Auswahlliste aller Konten: die gäbe es nur, wenn der Admin-Bereich weiterhin jedes
 * registrierte Konto auflistete — genau das ist mit der Trennung in Rollen und Kunden entfallen.
 * Die E-Mail ist ausserdem das, was in der Absprache ohnehin hin- und hergeht („mach mir bitte
 * … Admin").
 *
 * Die Rolle steckt in einem versteckten Feld statt in einer Auswahl: es gibt aktuell genau eine
 * (`ROLES`). Ein Dropdown mit einem einzigen Eintrag ist eine Entscheidung, die keine ist.
 */
export function GrantRoleForm() {
  const [state, formAction, isPending] = useActionState(grantRoleByEmailAction, ADMIN_INITIAL_STATE)
  const prefix = `role-${React.useId()}`
  useFocusFirstError(state.fieldErrors, ROLE_FIELDS, prefix)

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <input type="hidden" name="role" value="admin" />

      <AdminField
        id={`${prefix}-email`}
        name="email"
        label="E-Mail-Adresse des Kontos"
        type="email"
        defaultValue={state.values?.email}
        placeholder="kollege@coolin.at"
        error={state.fieldErrors?.email}
        hint="Das Konto muss bereits registriert sein. Groß-/Kleinschreibung spielt keine Rolle."
        required
      />

      <div>
        <Submit
          isPending={isPending}
          label="Administrator-Rolle vergeben"
          pendingLabel="Wird vergeben …"
        />
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
  /** Genau ein wählbares Produkt → festes Feld statt Auswahl (s. unten). */
  const onlyProduct = CODE_PRODUCT_KEYS.length === 1 ? CODE_PRODUCT_KEYS[0] : null

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
        {/*
         * Bleibt genau EIN code-fähiges Produkt übrig, ist eine Auswahl keine Auswahl mehr — dann
         * steht der Wert fest da (mit Begründung) und fährt als verstecktes Feld mit. Kommt ein
         * zweites Produkt dazu, erscheint das Dropdown von selbst wieder.
         * Der Grund, warum „Kalkulator Pro" fehlt: `lib/admin/config.ts`.
         */}
        {onlyProduct ? (
          <div>
            <span className="text-small font-medium text-ink">Produkt</span>
            <p className="mt-1.5 text-body text-text">{PRODUCT_LABELS[onlyProduct]}</p>
            <input type="hidden" name="productKey" value={onlyProduct} />
            <p className="mt-1.5 text-caption text-text-muted">
              Der Pro-Kalkulator prüft diesen Zugang noch nicht — ein Code dafür bliebe wirkungslos
              und steht deshalb nicht zur Wahl.
            </p>
          </div>
        ) : (
          <AdminSelect
            id={`${prefix}-productKey`}
            name="productKey"
            label="Produkt"
            /*
             * `key` erzwingt einen Neuaufbau, sobald sich der zuletzt abgeschickte Wert ändert.
             * Ohne ihn fiele die Auswahl nach einer abgelehnten Anlage sichtbar auf den ersten
             * Eintrag zurück: React wendet `defaultValue` bei einem unkontrollierten `<select>` nur
             * beim Einhängen an, und der Formular-Reset nach der Action setzt das Feld danach auf
             * das ursprüngliche `selected` — nicht auf das, was der Nutzer gewählt hatte.
             */
            key={v?.productKey ?? 'initial'}
            defaultValue={v?.productKey ?? CODE_PRODUCT_KEYS[0]}
            error={fe?.productKey}
          >
            {CODE_PRODUCT_KEYS.map((key) => (
              <option key={key} value={key}>
                {PRODUCT_LABELS[key]}
              </option>
            ))}
          </AdminSelect>
        )}
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
