'use client'

/**
 * Tarifwerte von Hand — der zweite Weg der Rechnung-Station (B24, Teil 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DER FALL, DEN DIE STATION BISHER NICHT KANNTE: ES GIBT KEINE RECHNUNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Station nimmt PDFs entgegen und liest sie aus. Wer keine hat — weil der Kunde am Telefon
 * vorliest, weil die Rechnung beim Steuerberater liegt, weil der Anschluss neu ist — stand bisher
 * vor einem Dateifeld und einem „Weiter", das die Angaben ungefragt überspringt. Der Kopf der
 * Station hat diesen Weg als „eigenen Auftrag" benannt; das hier ist er.
 *
 * ── ⚠ DER NETZBETREIBER IST HIER EIN AUSLÖSER, KEIN ENTWURFSFELD ──────────────────────────────
 * Er steht im Formular, WEIL der Leistungspreis ohne ihn nicht nachschlagbar ist — und er wird
 * ausdrücklich NICHT in den Entwurf geschrieben: `tariffParamsSchema` kennt das Feld nicht, zod
 * entfernte es beim nächsten Auswerten stillschweigend (dieselbe Feststellung, aus der
 * `INVOICE_DRAFT_FIELD_KEYS` ihn ausschliesst). Welcher Netzbetreiber zuständig ist, entscheidet
 * der Tarif-Schritt; hier beantwortet er genau eine Frage, und zwar vor dem Speichern.
 *
 * ── ⚠ „WERTE VORSCHLAGEN" IST EIN EIGENER KLICK, KEIN AUTOMATISMUS ────────────────────────────
 * Ein Nachladen bei jeder Auswahländerung wäre bequemer und in zwei Richtungen falsch: es löste
 * schon während des Durchklickens der Netzebenen Abfragen aus, und es überschriebe einen Wert, den
 * der Admin gerade von der Rechnung abgetippt hat, sobald er daneben die Messvariante korrigiert.
 * Der Vorschlag ist eine ANGEFORDERTE Auskunft; was damit geschieht, entscheidet ein Mensch.
 *
 * Die vorgeschlagenen Werte landen in zwei ganz gewöhnlichen, danach frei editierbaren Feldern —
 * es gibt keinen „aus dem Preisblatt"-Zustand, der sie schützt. Prinzip 1: die Rechnung des Kunden
 * schlägt unsere Tabelle, und das muss man tun können, ohne etwas zurückzunehmen.
 *
 * ── EIN FORMULAR, ZWEI ACTIONS ────────────────────────────────────────────────────────────────
 * Verschachtelte Formulare gibt es in HTML nicht, und die zwei Wege brauchen dieselben drei Felder.
 * Der Vorschlagen-Knopf trägt deshalb ein eigenes `formAction` (React 19) — er schickt DASSELBE
 * Formular an eine andere Action. Zwei getrennte Formulare nebeneinander hiessen, Netzbetreiber und
 * Netzebene zweimal zu erheben; zwei Werte für dieselbe Frage wären ein Zustand, der auseinander
 * laufen kann.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'

import {
  INVOICE_MERGE_FIELD_LABELS,
  METERING_VARIANTS,
  METERING_VARIANT_LABELS,
  NETZBETREIBER_IDS,
  NETZBETREIBER_LABELS,
  NETZEBENEN,
  hasMeteringVariant,
} from 'shared'

import { Button } from '@/components/ui/button'
import {
  lookupGridTariffDefaultsAction,
  saveMeteringPointManualTariffAction,
} from '@/lib/admin/data-entry-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import { AdminError, AdminField, AdminSelect, AdminSuccess } from './ui'

/**
 * Die Einheit gehört zum Feld, nicht zum Namen.
 *
 * Die NAMEN kommen aus `INVOICE_MERGE_FIELD_LABELS` (`packages/shared`) — dieselben, die die
 * Zusammenfassung der gelesenen Rechnungen und die Widerspruchsmeldung verwenden. Zwei
 * Bezeichnungen für dasselbe Feld nebeneinander wären für jeden verwirrend, der beide Wege benutzt.
 * Die Einheit steht nur hier, weil nur ein Eingabefeld sie braucht.
 */
const UNITS = {
  energyPriceCtPerKwh: 'ct/kWh',
  energyPriceNightCtPerKwh: 'ct/kWh',
  einspeiseverguetungCtPerKwh: 'ct/kWh',
  supplierBaseFeeEurPerMonth: '€/Monat',
  leistungspreisEurPerKwYear: '€/kW und Jahr',
  minBillableKw: 'kW',
  annualConsumptionKwh: 'kWh',
} as const

type NumberFieldKey = keyof typeof UNITS

function fieldLabel(key: NumberFieldKey): string {
  return `${INVOICE_MERGE_FIELD_LABELS[key]} (${UNITS[key]})`
}

export function DataEntryInvoiceManual({
  projectId,
  meteringPointId,
}: {
  projectId: string
  meteringPointId: string
}) {
  const [saveState, saveAction, isSaving] = useActionState(
    saveMeteringPointManualTariffAction,
    ADMIN_INITIAL_STATE,
  )
  const [lookupState, lookupAction, isLooking] = useActionState(
    lookupGridTariffDefaultsAction,
    ADMIN_INITIAL_STATE,
  )

  /*
   * Die Netzebene steuert ein ANDERES Feld: nur auf Netzebenen mit Varianten (heute NE 7) gibt es
   * überhaupt eine Messvariante. Das Auswahlfeld bleibt dabei UNKONTROLLIERT — der Beobachter liest
   * mit, er übernimmt nicht (Muster `AdminSelect.onValueChange`, B19).
   */
  const [netzebene, setNetzebene] = React.useState('')
  const variantApplies = netzebene !== '' && hasMeteringVariant(Number(netzebene))

  /*
   * ⚠ NUR DIESE ZWEI FELDER SIND KONTROLLIERT — genau die, die der Vorschlag befüllt. Die übrigen
   * bleiben unkontrolliert, damit eine beanstandete Eingabe wie überall sonst über den
   * Formularzustand des Browsers wiederangezeigt wird und nicht über React-State, den ein Rerender
   * zurücksetzen könnte.
   */
  const [leistungspreis, setLeistungspreis] = React.useState('')
  const [minBillableKw, setMinBillableKw] = React.useState('')

  const suggested = lookupState.values?.lookup === 'ok' ? lookupState.values : null

  React.useEffect(() => {
    if (!suggested) return
    setLeistungspreis(suggested.leistungspreisEurPerKwYear ?? '')
    setMinBillableKw(suggested.minBillableKw ?? '')
    /*
     * Hängt an der Objektidentität des Lookup-Ergebnisses: `useActionState` liefert bei jedem Lauf
     * ein neues Objekt, bei jedem anderen Rerender dasselbe. Ein getippter Wert wird dadurch nicht
     * beim nächsten Tastendruck wieder überschrieben.
     */
  }, [suggested])

  /*
   * ⚠ VORRANG FÜR DIE ZULETZT ERWARTETE HANDLUNG. Beide Actions melden Feldfehler, und es gibt
   * keinen gemeinsamen Zustand, der sagt, welche zuletzt lief. Das Speichern ist die Handlung, die
   * ein Mensch zuletzt vornimmt; sein Fehler gehört deshalb nach vorn. Ein Lookup-Fehler bleibt
   * daneben sichtbar, bis der nächste Lookup läuft — er benennt eine Eingabe, die auch fürs
   * Speichern fehlt.
   */
  const fieldError = (key: string): string | undefined =>
    saveState.fieldErrors?.[key] ?? lookupState.fieldErrors?.[key]

  return (
    <form action={saveAction} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="meteringPointId" value={meteringPointId} />

      {saveState.success && <AdminSuccess>{saveState.success}</AdminSuccess>}
      {saveState.formError && <AdminError>{saveState.formError}</AdminError>}
      {lookupState.formError && <AdminError>{lookupState.formError}</AdminError>}

      <fieldset className="flex flex-col gap-4">
        <legend className="text-small font-medium text-ink">Netzanschluss</legend>
        <p className="max-w-2xl text-small text-text-muted">
          Netzbetreiber und Netzebene stehen auf der Netzrechnung. Aus ihnen schlagen wir den
          hinterlegten Leistungspreis vor — gespeichert wird nur, was darunter in den Feldern steht.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <AdminSelect
            id="manual-operator"
            name="operatorId"
            label="Netzbetreiber"
            error={fieldError('operatorId')}
            hint="Wird nicht gespeichert — er dient nur dem Vorschlag."
          >
            <option value="">— bitte wählen —</option>
            {NETZBETREIBER_IDS.map((id) => (
              <option key={id} value={id}>
                {NETZBETREIBER_LABELS[id]}
              </option>
            ))}
          </AdminSelect>

          <AdminSelect
            id="manual-netzebene"
            name="netzebene"
            label={INVOICE_MERGE_FIELD_LABELS.netzebene}
            error={fieldError('netzebene')}
            onValueChange={setNetzebene}
          >
            <option value="">— bitte wählen —</option>
            {NETZEBENEN.map((level) => (
              <option key={level} value={String(level)}>
                Netzebene {level}
              </option>
            ))}
          </AdminSelect>
        </div>

        {/*
          ⚠ GAR NICHT GERENDERT, nicht bloss deaktiviert — dieselbe Entscheidung wie im
          Tarif-Schritt des Rechners: ein deaktiviertes Feld gäbe es weiterhin, und der nächste
          Umbau schickte seinen Wert mit. In der Spalte gehört auf NE 3–6 aber `null` (B21-1,
          `unique nulls not distinct`); ein Wert daneben fände die gepflegte Zeile nie, und der
          Vorschlag bliebe leer, obwohl das Preisblatt gepflegt ist.
        */}
        {variantApplies && (
          <div className="sm:max-w-sm">
            <AdminSelect
              id="manual-metering-variant"
              name="meteringVariant"
              label={INVOICE_MERGE_FIELD_LABELS.meteringVariant}
              error={fieldError('meteringVariant')}
              hint="Auf Netzebene 7 hängt der Leistungspreis daran."
            >
              <option value="">— bitte wählen —</option>
              {METERING_VARIANTS.map((variant) => (
                <option key={variant} value={variant}>
                  {METERING_VARIANT_LABELS[variant]}
                </option>
              ))}
            </AdminSelect>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {/*
            `formAction` schickt DIESES Formular an die Lookup-Action — kein Speichern, kein
            Schreibvorgang. `type="submit"` ist dafür nötig; ein Knopf ohne Absendetyp löst gar
            nichts aus.
          */}
          <Button
            type="submit"
            formAction={lookupAction}
            variant="secondary"
            size="md"
            disabled={isLooking || isSaving}
          >
            {isLooking && (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
            )}
            {isLooking ? 'Wird nachgeschlagen …' : 'Werte vorschlagen'}
          </Button>
          <span role="status" aria-live="polite" className="text-small text-text-muted">
            {isLooking
              ? 'Wird nachgeschlagen …'
              : suggested
                ? `Aus dem hinterlegten Preisblatt übernommen (Stand ${suggested.stichtag}). ` +
                  'Beide Werte bleiben frei änderbar.'
                : lookupState.values?.lookup === 'none'
                  ? 'Für diese Kombination ist kein Preisblatt hinterlegt — bitte von der ' +
                    'Netzrechnung abtippen.'
                  : ''}
          </span>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-line pt-6">
        <legend className="text-small font-medium text-ink">Tarifwerte</legend>
        <p className="max-w-2xl text-small text-text-muted">
          Alle Felder sind freiwillig. Was leer bleibt, wird nicht gespeichert — ein bereits
          eingetragener Wert (etwa aus einer zuvor gelesenen Rechnung) bleibt dann unverändert
          stehen.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField
            id="manual-leistungspreis"
            name="leistungspreisEurPerKwYear"
            label={fieldLabel('leistungspreisEurPerKwYear')}
            inputMode="numeric"
            value={leistungspreis}
            onValueChange={setLeistungspreis}
            error={fieldError('leistungspreisEurPerKwYear')}
          />
          <AdminField
            id="manual-min-billable"
            name="minBillableKw"
            label={fieldLabel('minBillableKw')}
            inputMode="numeric"
            value={minBillableKw}
            onValueChange={setMinBillableKw}
            error={fieldError('minBillableKw')}
            hint="Die Untergrenze, die der Netzbetreiber mindestens verrechnet."
          />
          <AdminField
            id="manual-energy-price"
            name="energyPriceCtPerKwh"
            label={fieldLabel('energyPriceCtPerKwh')}
            inputMode="numeric"
            error={fieldError('energyPriceCtPerKwh')}
          />
          <AdminField
            id="manual-energy-price-night"
            name="energyPriceNightCtPerKwh"
            label={fieldLabel('energyPriceNightCtPerKwh')}
            inputMode="numeric"
            error={fieldError('energyPriceNightCtPerKwh')}
            hint="Nur, wenn ein eigener Nachttarif vereinbart ist."
          />
          <AdminField
            id="manual-feed-in"
            name="einspeiseverguetungCtPerKwh"
            label={fieldLabel('einspeiseverguetungCtPerKwh')}
            inputMode="numeric"
            error={fieldError('einspeiseverguetungCtPerKwh')}
          />
          <AdminField
            id="manual-base-fee"
            name="supplierBaseFeeEurPerMonth"
            label={fieldLabel('supplierBaseFeeEurPerMonth')}
            inputMode="numeric"
            error={fieldError('supplierBaseFeeEurPerMonth')}
          />
          <AdminField
            id="manual-annual-kwh"
            name="annualConsumptionKwh"
            label={fieldLabel('annualConsumptionKwh')}
            inputMode="numeric"
            error={fieldError('annualConsumptionKwh')}
          />
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="md" disabled={isSaving || isLooking}>
          {isSaving && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isSaving ? 'Wird gespeichert …' : 'Werte übernehmen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isSaving ? 'Wird gespeichert …' : ''}
        </span>
      </div>
    </form>
  )
}
