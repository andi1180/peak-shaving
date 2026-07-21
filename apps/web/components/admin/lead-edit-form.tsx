'use client'

/**
 * Der Korrekturweg der Lead-Detailseite (B2-1): die ZEHN bearbeitbaren Stammdatenfelder.
 *
 * ── DIE ZEHN FELDER STEHEN GENAU HIER, EINMAL ────────────────────────────────────────────────────
 * Bei einem anonymisierten Lead rendert dieselbe Komponente dieselben zehn Felder als reine Anzeige
 * statt als Eingabe. Zwei getrennte Darstellungen (eine Anzeige-Liste und daneben ein Formular)
 * hätten bedeutet, dass jede künftige Änderung an der Feldmenge an zwei Stellen nachzuziehen ist —
 * und die vergessene Stelle wäre ausgerechnet die, die ein anonymisierter Lead zeigt.
 *
 * ── WAS HIER BEWUSST NICHT STEHT ─────────────────────────────────────────────────────────────────
 * E-Mail (eine Änderung übertrüge eine bestätigte Einwilligung auf eine Adresse, die nie zugestimmt
 * hat), Status und Aufbewahrungsgrundlage (dafür gibt es `LeadStatusForm` samt
 * Einbahnstrassen-Trigger), Herkunft (seit B1-1 unveränderlich) und die Löschfrist (immer
 * abgeleitet). Die Begründungen stehen ausführlich in der Migration und, wo ein Mensch sie braucht,
 * als Satz unter dem Formular.
 *
 * ── LEER HEISST LÖSCHEN ──────────────────────────────────────────────────────────────────────────
 * Ein geleertes Feld setzt die Angabe auf „nicht bekannt". Das ist der Unterschied zum
 * Erfassungspfad (dort lässt ein fehlender Wert den Bestand unberührt, B3-1) und der Grund, warum
 * dieses Formular immer ALLE zehn Felder schickt.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { FieldHint, Input, Label } from '@/components/ui/input'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from '@/components/admin/ui'
import { formatDate, formatKwh } from '@/lib/admin/format'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { updateLeadAction } from '@/lib/admin/leads-actions'
import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  METERING_TYPE_LABELS,
  industryLabel,
  meteringTypeLabel,
  type LeadDetailRow,
} from '@/lib/admin/leads'

/** Anzeige-Zeile für den gesperrten Fall — dieselbe Optik wie die übrigen Felder der Detailseite. */
function ReadOnlyField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-small text-ink">{children}</dd>
    </div>
  )
}

function ReadOnlyView({ lead }: { lead: LeadDetailRow }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <ReadOnlyField label="Firma">{lead.company ?? '—'}</ReadOnlyField>
      <ReadOnlyField label="Vorname">{lead.first_name ?? '—'}</ReadOnlyField>
      <ReadOnlyField label="Nachname">{lead.last_name ?? '—'}</ReadOnlyField>
      <ReadOnlyField label="Telefon">{lead.phone ?? '—'}</ReadOnlyField>
      <ReadOnlyField label="Branche">
        {lead.industry ? industryLabel(lead.industry) : '—'}
      </ReadOnlyField>
      <ReadOnlyField label="Postleitzahl">{lead.postal_code ?? '—'}</ReadOnlyField>
      <ReadOnlyField label="Jahresverbrauch">
        {formatKwh(lead.annual_consumption_kwh)}
      </ReadOnlyField>
      <ReadOnlyField label="Messart">
        {lead.metering_type ? meteringTypeLabel(lead.metering_type) : 'noch nicht geprüft'}
      </ReadOnlyField>
      <ReadOnlyField label="Versorger">{lead.supplier ?? '—'}</ReadOnlyField>
      <ReadOnlyField label="Vertragsende">{formatDate(lead.contract_end_date)}</ReadOnlyField>
    </dl>
  )
}

export function LeadEditForm({ lead, disabled }: { lead: LeadDetailRow; disabled: boolean }) {
  const [state, formAction, isPending] = useActionState(updateLeadAction, ADMIN_INITIAL_STATE)

  /*
   * Nur DIESES eine Feld ist kontrolliert: der Hinweis unten muss erscheinen, SOBALD ein anderes
   * Datum dasteht — vor dem Abschicken, nicht danach. Wer erst in der Erfolgsmeldung liest, dass
   * eine weitere Erinnerung rausgeht, hat sie schon ausgelöst. (Dieselbe Bauart wie der
   * „Kunde"-Hinweis in LeadStatusForm.)
   */
  const [contractEnd, setContractEnd] = React.useState(lead.contract_end_date ?? '')
  const contractEndChanged = contractEnd !== (lead.contract_end_date ?? '')

  if (disabled) {
    return (
      <>
        <ReadOnlyView lead={lead} />
        <p className="mt-4 max-w-prose text-caption text-text-muted">
          Dieser Lead ist anonymisiert — die Felder sind gesperrt. Die Datenbank lehnt jede Änderung
          ab, auch über die Serverseite und auch für Administratoren.
        </p>
      </>
    )
  }

  const fieldError = (name: string): string | undefined => state.fieldErrors?.[name]

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="leadId" value={lead.id} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AdminField
          id="lead-company"
          name="company"
          label="Firma"
          defaultValue={lead.company ?? ''}
          error={fieldError('company')}
        />
        {/*
          * ZWEI Felder statt einem: die Anrede in Korrespondenz braucht den Nachnamen als eigenen
          * Wert. Beide sind hier — anders als im Kontaktformular — OPTIONAL: der Bestand enthält
          * Leads aus Einstiegspunkten, die gar keinen Namen erheben, und ein Pflichtfeld machte
          * jede andere Korrektur an so einem Lead unmöglich. Leer heisst auch hier LÖSCHEN, und
          * zwar je Feld einzeln.
          */}
        <AdminField
          id="lead-first-name"
          name="firstName"
          label="Vorname"
          defaultValue={lead.first_name ?? ''}
          error={fieldError('firstName')}
        />
        <AdminField
          id="lead-last-name"
          name="lastName"
          label="Nachname"
          defaultValue={lead.last_name ?? ''}
          error={fieldError('lastName')}
        />
        <AdminField
          id="lead-phone"
          name="phone"
          label="Telefon"
          defaultValue={lead.phone ?? ''}
          error={fieldError('phone')}
        />

        <AdminSelect
          id="lead-industry"
          name="industry"
          label="Branche"
          defaultValue={lead.industry ?? ''}
          error={fieldError('industry')}
        >
          <option value="">keine Angabe</option>
          {INDUSTRIES.map((key) => (
            <option key={key} value={key}>
              {INDUSTRY_LABELS[key]}
            </option>
          ))}
        </AdminSelect>

        <AdminField
          id="lead-postal-code"
          name="postalCode"
          label="Postleitzahl"
          inputMode="numeric"
          defaultValue={lead.postal_code ?? ''}
          error={fieldError('postalCode')}
          hint="Vier Ziffern."
        />
        <AdminField
          id="lead-consumption"
          name="annualConsumptionKwh"
          label="Jahresverbrauch (kWh)"
          inputMode="numeric"
          defaultValue={
            lead.annual_consumption_kwh === null ? '' : String(lead.annual_consumption_kwh)
          }
          error={fieldError('annualConsumptionKwh')}
          hint="Leer lassen heisst „nicht bekannt“ — 0 ist keine Angabe."
        />

        <AdminSelect
          id="lead-metering-type"
          name="meteringType"
          label="Messart"
          defaultValue={lead.metering_type ?? ''}
          error={fieldError('meteringType')}
          hint="„Nicht geprüft“ und „geprüft, nicht bestimmbar“ sind verschiedene Aussagen."
        >
          <option value="">noch nicht geprüft</option>
          {Object.entries(METERING_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </AdminSelect>

        <AdminField
          id="lead-supplier"
          name="supplier"
          label="Versorger"
          defaultValue={lead.supplier ?? ''}
          error={fieldError('supplier')}
        />

        {/*
          * Kontrolliert (s. oben) — als einziges Feld, weil an seiner Änderung eine Wirkung nach
          * aussen hängt.
          */}
        <div>
          <Label htmlFor="lead-contract-end">Vertragsende</Label>
          <div className="mt-1.5">
            <Input
              id="lead-contract-end"
              name="contractEndDate"
              type="date"
              value={contractEnd}
              onChange={(e) => setContractEnd(e.target.value)}
              aria-invalid={fieldError('contractEndDate') ? true : undefined}
              aria-describedby="lead-contract-end-hint"
            />
          </div>
          <FieldHint
            id="lead-contract-end-hint"
            tone={fieldError('contractEndDate') ? 'error' : 'muted'}
          >
            {fieldError('contractEndDate') ?? 'Leeren entfernt das Datum.'}
          </FieldHint>
        </div>
      </div>

      {contractEndChanged && contractEnd !== '' && (
        <div
          role="note"
          className="max-w-prose rounded-md border border-warning-border bg-warning-subtle p-3"
        >
          <p className="text-caption text-ink">
            <strong className="font-semibold">
              Ein anderes Vertragsende erzeugt eine neue Fälligkeit.
            </strong>{' '}
            Die Erinnerung wird je Vertragsende genau einmal versendet (B4-2, Primärschlüssel aus
            Lead und Datum). Mit dem neuen Datum ist der Fall wieder offen — die Person bekommt
            also, acht Wochen davor, eine weitere Erinnerung. Das ist beabsichtigt und der Grund,
            warum eine Korrektur überhaupt möglich ist; es soll nur nicht überraschen.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="md" disabled={isPending}>
          {isPending ? 'Wird gespeichert …' : 'Änderungen speichern'}
        </Button>
      </div>

      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      <p className="max-w-prose text-caption text-text-muted">
        Nicht bearbeitbar und bewusst ohne Eingabefeld: die <strong>E-Mail-Adresse</strong> — sie ist
        die Adresse, von der die Einwilligung erteilt und an die die Bestätigung gesendet wurde; eine
        Änderung übertrüge eine bestätigte Einwilligung auf eine Adresse, die nie zugestimmt hat. Ein
        unerreichbarer Lead wird gekennzeichnet, nicht repariert. Ebenfalls nicht hier:{' '}
        <strong>Status</strong> und <strong>Aufbewahrungsgrundlage</strong> (eigener Abschnitt),{' '}
        <strong>Herkunft</strong> (seit der Ersterfassung unveränderlich) und die{' '}
        <strong>Löschfrist</strong> (wird immer abgeleitet, nie gesetzt).
      </p>
    </form>
  )
}
