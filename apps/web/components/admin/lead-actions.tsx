'use client'

/**
 * Die Aktionen der Lead-Detailseite (B1-3): Status setzen, Einwilligung widerrufen, Adresse sperren,
 * Lead anonymisieren.
 *
 * ── WARUM NICHT `ActionButton` AUS T4-4 ──────────────────────────────────────────────────────────
 * `ActionButton` zeigt ausschliesslich Fehler an. Hier ist die ERFOLGSMELDUNG fachlich tragend: „für
 * diesen Zweck war nichts mehr offen oder bestätigt" und „widerrufen (2 Einträge)" sind zwei
 * verschiedene Ergebnisse desselben Klicks, und beide sehen in der Tabelle danach gleich aus. Die
 * Komponente unten ist deshalb ein `ActionButton` mit Erfolgs-Slot — dieselbe Bauart (echtes
 * `<form>`, `useActionState` für Ladezustand und Rückmeldung), ein Feld mehr.
 *
 * ── WARUM DIE RÜCKFRAGE NUR BEIM ANONYMISIEREN STEHT ─────────────────────────────────────────────
 * Es ist die einzige Aktion, die etwas ZERSTÖRT. Ein falsch gesetzter Status wird zurückgesetzt; ein
 * versehentlicher Widerruf kostet eine Einwilligung, die die Person neu erteilen kann. Eine
 * Anonymisierung ist endgültig — die Datenbank lehnt danach jede Änderung ab (Trigger
 * guard_anonymized_lead). Eine Rückfrage auf JEDEM Knopf würde genau diesen Unterschied einebnen.
 *
 * Die Rückfrage ist ein `<details>`-Aufklappen und kein `window.confirm`: sie muss BENENNEN, was
 * gelöscht wird und was bleibt — dafür braucht es Fließtext, keinen Systemdialog. Nebenbei
 * funktioniert sie damit auch ohne JavaScript.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Label, Select } from '@/components/ui/input'
import { ADMIN_INITIAL_STATE, type AdminState } from '@/lib/admin/schema'
import {
  anonymizeLeadAction,
  setLeadStatusAction,
  suppressLeadAction,
  withdrawConsentAction,
} from '@/lib/admin/leads-actions'
import { SETTABLE_LEAD_STATUSES, statusLabel } from '@/lib/admin/leads'

type Action = (prev: AdminState, formData: FormData) => Promise<AdminState>

/** Rückmeldung einer Aktion — Erfolg ruhig, Ablehnung als `alert`. */
function Feedback({ state }: { state: AdminState }) {
  if (state.formError) {
    return (
      <p role="alert" className="mt-2 max-w-prose text-caption text-negative">
        {state.formError}
      </p>
    )
  }
  if (state.success) {
    return (
      <p role="status" className="mt-2 max-w-prose text-caption text-text-muted">
        {state.success}
      </p>
    )
  }
  return null
}

/** Ein Knopf, eine Aktion, feste verborgene Werte — mit Erfolgs- UND Fehler-Slot. */
function LeadActionButton({
  action,
  fields,
  label,
  pendingLabel,
  variant = 'secondary',
  disabled,
  children,
}: {
  action: Action
  fields: Record<string, string>
  label: string
  pendingLabel: string
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  /** Optionaler Vorspann innerhalb des Formulars (z. B. die Rückfrage beim Anonymisieren). */
  children?: React.ReactNode
}) {
  const [state, formAction, isPending] = useActionState(action, ADMIN_INITIAL_STATE)

  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      <Button type="submit" variant={variant} size="sm" disabled={disabled || isPending}>
        {isPending ? pendingLabel : label}
      </Button>
      <Feedback state={state} />
    </form>
  )
}

// ── Status ───────────────────────────────────────────────────────────────────────────────────────

export function LeadStatusForm({
  leadId,
  current,
  disabled,
}: {
  leadId: string
  current: string
  disabled?: boolean
}) {
  const [state, formAction, isPending] = useActionState(setLeadStatusAction, ADMIN_INITIAL_STATE)
  /*
   * Der Hinweis erscheint, SOBALD „Kunde" ausgewählt ist — vor dem Abschicken, nicht danach. Der
   * Wechsel hebt die Aufbewahrung dauerhaft auf 7 Jahre und lässt sich nicht zurücknehmen (der
   * Trigger lehnt commercial → marketing ab). Wer das erst in der Erfolgsmeldung liest, hat es
   * schon getan.
   */
  const [selected, setSelected] = React.useState(current)

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="lead-status">Status</Label>
          <div className="mt-1.5">
            <Select
              id="lead-status"
              name="status"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={disabled}
            >
              {SETTABLE_LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <Button type="submit" variant="secondary" size="md" disabled={disabled || isPending}>
          {isPending ? '…' : 'Status speichern'}
        </Button>
      </div>

      {selected === 'customer' && current !== 'customer' && (
        <div
          role="note"
          className="max-w-prose rounded-md border border-warning-border bg-warning-subtle p-3"
        >
          <p className="text-caption text-ink">
            <strong className="font-semibold">„Kunde“ wechselt die Aufbewahrung dauerhaft auf 7
            Jahre.</strong>{' '}
            Aus einer geschäftlichen Beziehung entsteht eine kaufmännische Aufbewahrungspflicht — sie
            endet nicht, wenn der Kunde später abspringt. Der Rückweg auf die 24-Monats-Frist wird von
            der Datenbank abgelehnt.
          </p>
        </div>
      )}

      <Feedback state={state} />
    </form>
  )
}

// ── Widerruf ─────────────────────────────────────────────────────────────────────────────────────

export function WithdrawConsentButton({
  leadId,
  purpose,
  disabled,
}: {
  leadId: string
  purpose: string
  disabled?: boolean
}) {
  return (
    <LeadActionButton
      action={withdrawConsentAction}
      fields={{ leadId, purpose }}
      label="Einwilligung widerrufen"
      pendingLabel="…"
      disabled={disabled}
    />
  )
}

// ── Sperre ───────────────────────────────────────────────────────────────────────────────────────

export function SuppressLeadButton({ leadId, disabled }: { leadId: string; disabled?: boolean }) {
  return (
    <LeadActionButton
      action={suppressLeadAction}
      fields={{ leadId }}
      label="Adresse dauerhaft sperren"
      pendingLabel="…"
      disabled={disabled}
    />
  )
}

// ── Anonymisieren ────────────────────────────────────────────────────────────────────────────────

/*
 * Die Erfolgsmeldung dieser Aktion ist NICHT zu sehen — und das ist in Ordnung: nach dem
 * erfolgreichen Aufruf rendert `revalidatePath` die Seite neu, der ganze Block wird durch den
 * dauerhaften Hinweis „Dieser Lead ist anonymisiert — anonymisiert am … durch …" ersetzt. Das ist
 * die stärkere Bestätigung, weil sie bleibt. Bei den anderen Aktionen ist es umgekehrt, dort
 * überleben die Formulare die Neu-Darstellung bewusst (s. `app/admin/leads/[id]/page.tsx`).
 */
export function AnonymizeLead({
  leadId,
  email,
  consentCount,
  isSuppressed,
}: {
  leadId: string
  email: string
  consentCount: number
  isSuppressed: boolean
}) {
  return (
    <details className="group rounded-md border border-negative bg-negative-subtle p-4">
      <summary
        className={
          'inline-flex cursor-pointer list-none items-center rounded-md text-small font-semibold ' +
          'text-negative outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
          'focus-visible:ring-offset-2'
        }
      >
        Lead anonymisieren …
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        <p className="max-w-prose text-small text-ink">
          <strong className="font-semibold">Das lässt sich nicht rückgängig machen.</strong> Nach der
          Anonymisierung lehnt die Datenbank jede weitere Änderung an diesem Lead ab — auch über die
          Serverseite und auch für Administratoren.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Wird unwiederbringlich gelöscht
            </p>
            <ul className="mt-1 list-disc pl-5 text-small text-ink">
              <li>
                die E-Mail-Adresse <span className="break-all">{email}</span>
              </li>
              <li>Firma, Vor- und Nachname und Telefonnummer</li>
              <li>
                IP-Adresse und Browser-Kennung {consentCount === 1 ? 'der' : 'aller'}{' '}
                {consentCount === 1 ? 'Einwilligung' : `${consentCount} Einwilligungen`}
              </li>
            </ul>
          </div>
          <div>
            <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
              Bleibt bestehen
            </p>
            <ul className="mt-1 list-disc pl-5 text-small text-ink">
              <li>
                die Einwilligungen selbst: Zweck, Wortlaut, Zeitpunkte — ohne Identitätsmerkmale kein
                Personenbezug mehr, aber weiterhin der Nachweis, dass korrekt gearbeitet wurde
              </li>
              <li>
                der Sperrlisten-Eintrag{isSuppressed ? '' : ', falls einer besteht'} — er MUSS die
                Löschung überleben, sonst stünde die Person nach dem nächsten Import wieder im
                Verteiler
              </li>
              <li>Herkunft und Anlagedatum (ohne Personenbezug)</li>
            </ul>
          </div>
        </div>

        <LeadActionButton
          action={anonymizeLeadAction}
          fields={{ leadId }}
          label="Endgültig anonymisieren"
          pendingLabel="wird anonymisiert …"
          variant="primary"
        />
      </div>
    </details>
  )
}
