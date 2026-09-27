'use client'

import { useActionState, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  ANALYSIS_HORIZON_YEARS_MAX,
  ANALYSIS_HORIZON_YEARS_MIN,
  DRAFT_ANALYSIS_HORIZON_YEARS,
  priceBasisLabel,
  type PriceBasis,
} from 'shared'
import { Button } from '@/components/ui/button'
import {
  isSubsidyMode,
  readAnalysisAssumptionsForm,
  type SubsidyMode,
} from '@/lib/admin/analysis-assumptions-draft'
import { saveMeteringPointAnalysisAssumptionsAction } from '@/lib/admin/data-entry-actions'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import type { ProjectSegment } from '@/lib/admin/projects'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminField, AdminPanel, AdminSuccess } from './ui'

const NUMBER = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2, useGrouping: false })

/**
 * „Annahmen für die Wirtschaftlichkeit" — Betrachtungshorizont und Förderung je Zählpunkt.
 * Leer gelassen rechnet der Report wie bisher (10 Jahre, keine Förderung).
 */
export function DataEntryAssumptions({
  projectId,
  meteringPoint,
  segment,
}: {
  projectId: string
  meteringPoint: MeteringPointSummary
  segment: ProjectSegment | null
}) {
  const [state, action, isSaving] = useActionState(
    saveMeteringPointAnalysisAssumptionsAction,
    ADMIN_INITIAL_STATE,
  )
  const formId = useId()
  const stored = readAnalysisAssumptionsForm(meteringPoint.draft)
  // Die Förderbasis folgt der Preisanzeige des Reports: Privat inkl. USt, Betrieb netto.
  const basis: PriceBasis = segment === 'privat' ? 'gross' : 'net'

  const returnedMode = state.values?.subsidyMode
  const [mode, setMode] = useState<SubsidyMode>(
    isSubsidyMode(returnedMode) ? returnedMode : (stored.subsidyMode ?? 'percent'),
  )

  // Hängt den Formularinhalt nach einem gespeicherten Stand neu ein (React setzt Formulare zurück).
  const storedKey = `${stored.horizonYears ?? ''}|${stored.subsidyMode ?? ''}|${stored.subsidyValue ?? ''}`

  return (
    <AdminPanel>
      <h3 className="text-h4 text-ink">Annahmen für die Wirtschaftlichkeit</h3>
      <p className="mt-1 text-caption text-text-muted">
        Leer gelassen rechnet der Report mit {DRAFT_ANALYSIS_HORIZON_YEARS} Jahren und ohne
        Förderung.
      </p>

      <form key={storedKey} action={action} className="mt-4 flex flex-col gap-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="meteringPointId" value={meteringPoint.id} />
        <input type="hidden" name="subsidyPriceBasis" value={basis} />

        <AdminField
          id={`${formId}-horizonYears`}
          name="horizonYears"
          label="Betrachtungshorizont (Jahre)"
          inputMode="numeric"
          placeholder={String(DRAFT_ANALYSIS_HORIZON_YEARS)}
          hint={`Ganze Zahl von ${ANALYSIS_HORIZON_YEARS_MIN} bis ${ANALYSIS_HORIZON_YEARS_MAX}.`}
          defaultValue={
            state.values?.horizonYears ??
            (stored.horizonYears === null ? '' : String(stored.horizonYears))
          }
          error={state.fieldErrors?.horizonYears}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-small font-medium text-ink">Förderung</legend>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ['percent', '% der Investition'],
                ['fixed', 'Fixbetrag in €'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-small text-text">
                <input
                  type="radio"
                  name="subsidyMode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="accent-accent"
                />
                {label}
              </label>
            ))}
          </div>
          <AdminField
            id={`${formId}-subsidyValue`}
            name="subsidyValue"
            label={
              mode === 'percent'
                ? 'Anteil der Investition (%)'
                : `Betrag (EUR, ${priceBasisLabel(basis)})`
            }
            inputMode="numeric"
            placeholder="leer = keine Förderung"
            hint="Nur eine eingetragene Angabe, keine geprüfte Zusage — sie wird im Report so benannt."
            defaultValue={
              state.values?.subsidyValue ??
              (stored.subsidyValue === null || stored.subsidyMode !== mode
                ? ''
                : NUMBER.format(stored.subsidyValue))
            }
            error={state.fieldErrors?.subsidyValue ?? state.fieldErrors?.subsidyMode}
          />
        </fieldset>

        <div>
          <Button type="submit" variant="secondary" size="sm" disabled={isSaving}>
            {isSaving && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            Annahmen speichern
          </Button>
        </div>
      </form>

      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}
    </AdminPanel>
  )
}
