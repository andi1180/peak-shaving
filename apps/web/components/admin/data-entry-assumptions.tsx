'use client'

import { useActionState, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  ANALYSIS_HORIZON_YEARS_MAX,
  ANALYSIS_HORIZON_YEARS_MIN,
  DEPRECIATION_YEARS_MAX,
  DEPRECIATION_YEARS_MIN,
  DRAFT_ANALYSIS_HORIZON_YEARS,
  priceBasisLabel,
  SUBSIDY_PROGRAM_LABEL_MAX,
  SUBSIDY_PROGRAMS_MAX,
  type PriceBasis,
} from 'shared'
import { Button } from '@/components/ui/button'
import {
  isSubsidyMode,
  readAnalysisAssumptionsForm,
  taxRateMissing,
  type AnalysisAssumptionsForm,
  type SubsidyMode,
} from '@/lib/admin/analysis-assumptions-draft'
import { saveMeteringPointAnalysisAssumptionsAction } from '@/lib/admin/data-entry-actions'
import type { MeteringPointSummary } from '@/lib/admin/metering-points'
import type { ProjectSegment } from '@/lib/admin/projects'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminField, AdminPanel, AdminSuccess } from './ui'

const NUMBER = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2, useGrouping: false })

const PROGRAM_FIELDS = ['Label', 'EurPerKwh', 'MaxKwh', 'MaxPercent'] as const
type ProgramRow = Record<(typeof PROGRAM_FIELDS)[number], string>
const EMPTY_PROGRAM: ProgramRow = { Label: '', EurPerKwh: '', MaxKwh: '', MaxPercent: '' }

/** Die Programmzeilen zum Start: nach einem Fehler die Eingabe, sonst der gespeicherte Stand. */
function initialProgramRows(
  values: Record<string, string> | undefined,
  stored: AnalysisAssumptionsForm,
): ProgramRow[] {
  if (values !== undefined && values.subsidyMode === 'per_kwh') {
    const rows = Array.from({ length: SUBSIDY_PROGRAMS_MAX }, (_, i) =>
      Object.fromEntries(PROGRAM_FIELDS.map((f) => [f, values[`program${i}${f}`] ?? ''])),
    ) as ProgramRow[]
    const filled = rows.filter((row) => PROGRAM_FIELDS.some((f) => row[f] !== ''))
    return filled.length > 0 ? filled : [EMPTY_PROGRAM]
  }
  if (stored.subsidyPrograms.length === 0) return [EMPTY_PROGRAM]
  const format = (value: number | null) => (value === null ? '' : NUMBER.format(value))
  return stored.subsidyPrograms.map((p) => ({
    Label: p.label,
    EurPerKwh: format(p.eurPerKwh),
    MaxKwh: format(p.maxKwh),
    MaxPercent: format(p.maxPercent),
  }))
}

/**
 * „Annahmen für die Wirtschaftlichkeit" — Betrachtungshorizont, Förderung und (nur Betrieb) die
 * Steuerangaben je Zählpunkt. Leer gelassen rechnet der Report wie bisher (10 Jahre, keine
 * Förderung, keine Steuerwirkung).
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
  const withTax = segment === 'betrieb'

  const returnedMode = state.values?.subsidyMode
  const [mode, setMode] = useState<SubsidyMode>(
    isSubsidyMode(returnedMode) ? returnedMode : (stored.subsidyMode ?? 'percent'),
  )
  const [programs, setPrograms] = useState<ProgramRow[]>(() =>
    initialProgramRows(state.values, stored),
  )
  const updateProgram = (index: number, field: keyof ProgramRow, value: string) =>
    setPrograms((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)))

  // Hängt den Formularinhalt nach einem gespeicherten Stand neu ein (React setzt Formulare zurück).
  const storedKey = [
    stored.horizonYears,
    stored.subsidyMode,
    stored.subsidyValue,
    JSON.stringify(stored.subsidyPrograms),
    stored.investitionsfreibetragPercent,
    stored.taxRatePercent,
    stored.depreciationYears,
  ].join('|')
  const storedNumber = (value: number | null) => (value === null ? '' : NUMBER.format(value))

  return (
    <AdminPanel>
      <h3 className="text-h4 text-ink">Annahmen für die Wirtschaftlichkeit</h3>
      <p className="mt-1 text-caption text-text-muted">
        Leer gelassen rechnet der Report mit {DRAFT_ANALYSIS_HORIZON_YEARS} Jahren
        {withTax ? ', ohne Förderung und ohne Steuerwirkung.' : ' und ohne Förderung.'}
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
                ['per_kwh', '€ pro kWh'],
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
          {mode === 'per_kwh' ? (
            <div className="flex flex-col gap-3">
              <p className="text-caption text-text-muted">
                Je Gerät gerechnet: Satz × nutzbare kWh, gedeckelt auf „max. kWh" und „max. % der
                Investition". Nur eingetragene Angaben, keine geprüfte Zusage.
              </p>
              {programs.map((row, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-small font-medium text-ink">Programm {i + 1}</span>
                    {programs.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPrograms((rows) => rows.filter((_, j) => j !== i))}
                      >
                        Entfernen
                      </Button>
                    )}
                  </div>
                  <AdminField
                    id={`${formId}-program${i}Label`}
                    name={`program${i}Label`}
                    label="Bezeichnung (optional)"
                    placeholder="z. B. Wiener Landesförderung"
                    maxLength={SUBSIDY_PROGRAM_LABEL_MAX}
                    value={row.Label}
                    onValueChange={(v) => updateProgram(i, 'Label', v)}
                    error={state.fieldErrors?.[`program${i}Label`]}
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <AdminField
                      id={`${formId}-program${i}EurPerKwh`}
                      name={`program${i}EurPerKwh`}
                      label={`€ pro kWh (${priceBasisLabel(basis)})`}
                      inputMode="numeric"
                      value={row.EurPerKwh}
                      onValueChange={(v) => updateProgram(i, 'EurPerKwh', v)}
                      error={state.fieldErrors?.[`program${i}EurPerKwh`]}
                    />
                    <AdminField
                      id={`${formId}-program${i}MaxKwh`}
                      name={`program${i}MaxKwh`}
                      label="max. kWh (optional)"
                      inputMode="numeric"
                      value={row.MaxKwh}
                      onValueChange={(v) => updateProgram(i, 'MaxKwh', v)}
                      error={state.fieldErrors?.[`program${i}MaxKwh`]}
                    />
                    <AdminField
                      id={`${formId}-program${i}MaxPercent`}
                      name={`program${i}MaxPercent`}
                      label="max. % der Investition (optional)"
                      inputMode="numeric"
                      value={row.MaxPercent}
                      onValueChange={(v) => updateProgram(i, 'MaxPercent', v)}
                      error={state.fieldErrors?.[`program${i}MaxPercent`]}
                    />
                  </div>
                </div>
              ))}
              {programs.length < SUBSIDY_PROGRAMS_MAX && (
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPrograms((rows) => [...rows, EMPTY_PROGRAM])}
                  >
                    Programm hinzufügen
                  </Button>
                </div>
              )}
            </div>
          ) : (
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
          )}
        </fieldset>

        {withTax && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-small font-medium text-ink">Steuerliche Wirkung (Richtwert)</legend>
            <input type="hidden" name="taxFields" value="1" />
            <AdminField
              id={`${formId}-investitionsfreibetragPercent`}
              name="investitionsfreibetragPercent"
              label="Investitionsfreibetrag (%)"
              inputMode="numeric"
              placeholder="leer = keine Angabe"
              hint="Öko-IFB: 22 % bei Anschaffung bis 31.12.2026, danach 15 % (Stand WKO 01.2026)."
              defaultValue={
                state.values?.investitionsfreibetragPercent ??
                storedNumber(stored.investitionsfreibetragPercent)
              }
              error={state.fieldErrors?.investitionsfreibetragPercent}
            />
            <AdminField
              id={`${formId}-taxRatePercent`}
              name="taxRatePercent"
              label="Steuersatz (%)"
              inputMode="numeric"
              placeholder="leer = keine Angabe"
              hint={
                taxRateMissing(stored)
                  ? 'Steuersatz nötig für die steuerliche Wirkung.'
                  : 'GmbH: 23 % Körperschaftsteuer. Sonst der persönliche Grenzsteuersatz der Eigentümer.'
              }
              defaultValue={state.values?.taxRatePercent ?? storedNumber(stored.taxRatePercent)}
              error={state.fieldErrors?.taxRatePercent}
            />
            <AdminField
              id={`${formId}-depreciationYears`}
              name="depreciationYears"
              label="Abschreibungsdauer (Jahre)"
              inputMode="numeric"
              placeholder="leer = keine Angabe"
              hint={`Ganze Zahl von ${DEPRECIATION_YEARS_MIN} bis ${DEPRECIATION_YEARS_MAX}.`}
              defaultValue={
                state.values?.depreciationYears ?? storedNumber(stored.depreciationYears)
              }
              error={state.fieldErrors?.depreciationYears}
            />
          </fieldset>
        )}

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
