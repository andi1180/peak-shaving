import { AdminField } from './ui'

/** Werte der drei Stufenfelder als Formular-Strings; leer heisst „keine Stufen". */
export type TierFieldDefaults = {
  tierThresholdHours?: string
  tier2LeistungspreisEurPerKwYear?: string
  tier2ArbeitspreisCtPerKwh?: string
}

/**
 * Optionaler Abschnitt „Benutzungsdauer-Stufen" — für alle Länder gleich, in Anlage, Bearbeitung
 * und Nachtrag. Die Regeln (alle drei oder keines, nur €/kW·a, genau ein ganzjähriges Fenster)
 * prüft `requireTiers` im Schema.
 */
export function GridTariffTierFields({
  formId,
  defaults,
  errors,
}: {
  formId: string
  defaults?: TierFieldDefaults
  errors?: Record<string, string>
}) {
  return (
    <fieldset className="flex flex-col gap-4 border-t border-line pt-6">
      <legend className="text-caption font-semibold uppercase tracking-wide text-text-muted">
        Benutzungsdauer-Stufen (optional)
      </legend>
      <p className="text-caption text-text-muted">
        Stufe unter der Schwelle = Leistungspreis und Arbeitspreis oben. Alle drei Felder oder
        keines.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <AdminField
          id={`${formId}-tierThresholdHours`}
          name="tierThresholdHours"
          label="Schwelle (h/a)"
          inputMode="numeric"
          placeholder="2500"
          defaultValue={defaults?.tierThresholdHours}
          error={errors?.tierThresholdHours}
        />
        <AdminField
          id={`${formId}-tier2LeistungspreisEurPerKwYear`}
          name="tier2LeistungspreisEurPerKwYear"
          label="Leistungspreis ab Schwelle (€/kW·a)"
          inputMode="numeric"
          defaultValue={defaults?.tier2LeistungspreisEurPerKwYear}
          error={errors?.tier2LeistungspreisEurPerKwYear}
        />
        <AdminField
          id={`${formId}-tier2ArbeitspreisCtPerKwh`}
          name="tier2ArbeitspreisCtPerKwh"
          label="Arbeitspreis ab Schwelle (ct/kWh)"
          inputMode="numeric"
          defaultValue={defaults?.tier2ArbeitspreisCtPerKwh}
          error={errors?.tier2ArbeitspreisCtPerKwh}
        />
      </div>
    </fieldset>
  )
}
