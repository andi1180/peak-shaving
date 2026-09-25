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
 * ── ⚠ DER NETZBETREIBER IST HIER AUSLÖSER UND ENTWURFSFELD ZUGLEICH ───────────────────────────
 * Er steht im Formular, WEIL der Leistungspreis ohne ihn nicht nachschlagbar ist — und er wird
 * seit D3 zusätzlich in den Entwurf geschrieben (`NETZBETREIBER_DRAFT_KEY`), seit dem 16.09.2026
 * auch vom Rechnungs-Scan (`INVOICE_DRAFT_FIELD_KEYS`). Hier stand bis dahin das Gegenteil, mit
 * der überholten Begründung, `tariffParamsSchema` kenne das Feld nicht.
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
 * ── EIN FORMULAR, DREI ACTIONS ────────────────────────────────────────────────────────────────
 * Verschachtelte Formulare gibt es in HTML nicht, und alle Wege brauchen dieselben drei
 * Anschluss-Felder. Vorschlagen und „Netzanschluss übernehmen" tragen deshalb je ein eigenes
 * `formAction` (React 19) — sie schicken DASSELBE Formular an eine andere Action.
 *
 * ── DER NETZANSCHLUSS IST DER ERSTE, IN SICH ABSCHLIESSBARE TEIL ────────────────────────────
 * Erst danach (mit oder ohne Angabe) die Wahl: Tarifwerte eintragen oder direkt weiter. Keiner
 * der Tarifwerte ist Pflicht; wer schon welche erfasst hat, sieht das Formular sofort ganz.
 *
 * ⚠ DER PREIS DIESER ENTSCHEIDUNG, und er ist bezahlt: React setzt UNKONTROLLIERTE Formularfelder
 * nach JEDER abgeschlossenen Action auf diesem Formular zurück, nicht nur nach der gemeinten. Die
 * drei Anschluss-Felder sind deshalb kontrolliert (Absatz bei `operatorId`). Wer hier ein weiteres
 * Feld ergänzt, das BEIDE Wege brauchen, denkt das mit.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'

import {
  BILLING_MODELS,
  BILLING_MODEL_HINTS,
  BILLING_MODEL_LABELS,
  INVOICE_MERGE_FIELD_LABELS,
  VAT_INCLUSIVE_LABEL,
} from 'shared'

import Link from 'next/link'

import { Button } from '@/components/ui/button'
import {
  lookupGridTariffDefaultsAction,
  saveMeteringPointGridConnectionAction,
  saveMeteringPointManualTariffAction,
} from '@/lib/admin/data-entry-actions'
import { billingModelApplies } from '@/lib/project-chat/billing-model'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { ManualTariffDraft } from '@/lib/admin/invoice-extractions'
import {
  DataEntryGridConnectionFields,
  EMPTY_GRID_CONNECTION,
  GRID_CONNECTION_NOT_SET_LABEL,
  type GridConnection,
} from './data-entry-grid-connection'
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

/** Ob über den Netzanschluss hinaus schon ein Tarifwert (oder ein bestätigtes Modell) erfasst ist. */
function hasStoredTariffValues(initial: ManualTariffDraft): boolean {
  return initial.billingModelConfirmed || Object.values(initial.numbers).some((text) => text !== '')
}

type Phase = 'connection' | 'choice' | 'tariff'

export function DataEntryInvoiceManual({
  projectId,
  meteringPointId,
  initial,
  nextHref,
}: {
  projectId: string
  meteringPointId: string
  /** Die nächste Station, oder `null` am Ende der Liste. */
  nextHref: string | null
  /**
   * Der bereits erfasste Stand dieses Zählpunkts, gelesen aus dem ENTWURF
   * (`readManualTariffDraft`) — nicht aus dem Rückgabewert einer Action.
   *
   * ⚠ ER IST DER GRUND, WARUM DIESES FORMULAR NACH EINEM STATIONSWECHSEL NICHT MEHR LEER IST. Bis
   * dahin schrieb die Handeingabe in den Entwurf und las ihn nie zurück: alle Felder starteten auf
   * `''`, und weil die Zusammenfassung darüber an den gelesenen RECHNUNGEN hängt (nicht am
   * Entwurf), zeigte die ganze Station den eingetragenen Stand nirgends. Gespeichert war er,
   * sichtbar nicht — von aussen ununterscheidbar von „nichts gespeichert".
   */
  initial: ManualTariffDraft
}) {
  const [saveState, saveAction, isSaving] = useActionState(
    saveMeteringPointManualTariffAction,
    ADMIN_INITIAL_STATE,
  )
  const [lookupState, lookupAction, isLooking] = useActionState(
    lookupGridTariffDefaultsAction,
    ADMIN_INITIAL_STATE,
  )

  const [connectionState, connectionAction, isSavingConnection] = useActionState(
    saveMeteringPointGridConnectionAction,
    ADMIN_INITIAL_STATE,
  )

  /*
   * ⚠ DIE DREI ANSCHLUSS-FELDER SIND KONTROLLIERT, UND ZWAR WEGEN DER WEITEREN ACTIONS: React
   * setzt unkontrollierte Felder nach JEDER Action auf diesem Formular zurück — der
   * Vorschlagen-Knopf löschte sonst genau die Angaben, aus denen der Vorschlag gebildet wurde.
   */
  const [connection, setConnection] = React.useState<GridConnection>({
    operatorId: initial.operatorId,
    netzebene: initial.netzebene,
    meteringVariant: initial.meteringVariant,
  })
  const [phase, setPhase] = React.useState<Phase>(
    hasStoredTariffValues(initial) ? 'tariff' : 'connection',
  )
  const [connectionSkipped, setConnectionSkipped] = React.useState(false)

  React.useEffect(() => {
    if (connectionState.success) setPhase('choice')
  }, [connectionState])

  // Eine Änderung nach dem Abschluss macht ihn wieder offen — sonst ginge sie beim „Weiter" still verloren.
  const changeConnection = (next: GridConnection) => {
    setConnection(next)
    setConnectionSkipped(false)
    setPhase((current) => (current === 'choice' ? 'connection' : current))
  }

  /*
   * ⚠ KONTROLLIERT AUS DEMSELBEN GRUND WIE DIE DREI FELDER DARÜBER: auch der Vorschlagen-Knopf
   * setzt dieses Formular zurück, und ein zurückgesetztes Auswahlfeld stünde wieder auf dem
   * Vorgabewert — es hätte damit still eine getroffene Wahl verworfen, und zwar die eine, die die
   * Kernzahl der Analyse bestimmt.
   */
  const [billingModel, setBillingModel] = React.useState<string>(initial.billingModel)

  /*
   * ⚠ DIESE ZWEI TARIFFELDER SIND KONTROLLIERT, WEIL DER VORSCHLAG SIE BEFÜLLT — ein anderer Grund
   * als bei den drei Anschluss-Feldern darüber, und deshalb ein eigener Absatz.
   *
   * Die ÜBRIGEN Tarifwerte bleiben unkontrolliert: eine beanstandete Eingabe wird dort wie überall
   * sonst über den Formularzustand des Browsers wiederangezeigt. Das trägt, weil das SPEICHERN die
   * Action ist, die sie beanstandet — nach ihr ist ein Zurücksetzen die richtige Antwort auf einen
   * Fehler in genau diesem Feld. Die drei Anschluss-Felder darüber trifft dagegen auch die
   * LESENDE Action, die über ihren Inhalt gar nicht urteilt.
   */
  const [leistungspreis, setLeistungspreis] = React.useState(
    initial.numbers.leistungspreisEurPerKwYear,
  )
  const [minBillableKw, setMinBillableKw] = React.useState(initial.numbers.minBillableKw)

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
    saveState.fieldErrors?.[key] ??
    lookupState.fieldErrors?.[key] ??
    connectionState.fieldErrors?.[key]

  const busy = isSaving || isLooking || isSavingConnection
  // Ohne Leistungsmessung gibt es keinen Leistungspreis und damit kein Abrechnungsmodell.
  const showBillingModel = billingModelApplies(connection)

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
          hinterlegten Leistungspreis vor; die Preisfelder darunter bleiben dabei editierbar und
          werden erst mit dem Speichern übernommen.
        </p>

        <DataEntryGridConnectionFields
          idPrefix="manual"
          value={connection}
          onChange={changeConnection}
          fieldError={fieldError}
        />

        {phase === 'connection' && connectionState.formError && (
          <AdminError>{connectionState.formError}</AdminError>
        )}
        {phase === 'connection' && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              formAction={connectionAction}
              variant="primary"
              size="md"
              disabled={busy}
            >
              {isSavingConnection && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {isSavingConnection ? 'Wird gespeichert …' : 'Netzanschluss übernehmen'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              disabled={busy}
              onClick={() => {
                setConnection(EMPTY_GRID_CONNECTION)
                setConnectionSkipped(true)
                setPhase('choice')
              }}
            >
              {GRID_CONNECTION_NOT_SET_LABEL}
            </Button>
          </div>
        )}

        {phase === 'choice' && (
          <div className="flex flex-col gap-3" data-testid="manual-connection-choice">
            {connectionSkipped ? (
              <p className="text-small text-text-muted">Netzanschluss nicht angegeben.</p>
            ) : (
              connectionState.success && <AdminSuccess>{connectionState.success}</AdminSuccess>
            )}
            <p className="max-w-2xl text-small text-text-muted">
              Tarifwerte sind freiwillig — Abrechnungsmodell, Arbeitspreis und Grundgebühr lassen
              sich jetzt eintragen oder später nachholen.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setPhase('tariff')}
              >
                Tarifwerte eintragen
              </Button>
              {nextHref !== null && (
                <Button asChild variant="primary" size="md">
                  <Link href={nextHref}>Weiter zur nächsten Station</Link>
                </Button>
              )}
            </div>
          </div>
        )}

        {phase === 'tariff' && (
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
              disabled={busy}
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
        )}
      </fieldset>

      {phase === 'tariff' && (
        <>
          {showBillingModel ? (
            <fieldset className="flex flex-col gap-4 border-t border-line pt-6">
              <legend className="text-small font-medium text-ink">Abrechnungsmodell</legend>
              <p className="max-w-2xl text-small text-text-muted">
                Nach welcher Regel der Netzbetreiber die abgerechnete Leistung bildet. Die drei
                Modelle unterscheiden sich um bis zum Faktor 12 im verrechneten kW-Wert — die Wahl
                bestimmt damit die Ersparnis, die der Report ausweist.
              </p>

              <div className="sm:max-w-md">
                <AdminSelect
                  id="manual-billing-model"
                  name="billingModel"
                  label={INVOICE_MERGE_FIELD_LABELS.billingModel}
                  error={fieldError('billingModel')}
                  value={billingModel}
                  onValueChange={setBillingModel}
                >
                  {/*
              ⚠ KEINE leere Option. Das Feld ist im Contract PFLICHT; ein „— bitte wählen —" machte
              daraus einen Pflichtfehler, den nur auflösen kann, wer die Frage bereits versteht.
              Vorbelegt und sichtbar ist die ehrlichere Form — und die Zeile darunter sagt, ob der
              Wert schon bestätigt ist oder noch unser Vorschlag.
            */}
                  {BILLING_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {BILLING_MODEL_LABELS[model]}
                    </option>
                  ))}
                </AdminSelect>
              </div>

              <p className="max-w-2xl text-small text-text-muted">
                {BILLING_MODEL_HINTS[billingModel as keyof typeof BILLING_MODEL_HINTS]}
              </p>

              <p
                className="max-w-2xl text-small text-text-muted"
                data-testid="billing-model-confirmation"
              >
                {initial.billingModelConfirmed
                  ? 'Übernommen — dieser Wert steht beim Zählpunkt und wird so gerechnet.'
                  : 'Noch nicht bestätigt: das ist unser Vorschlag. Gerechnet wird damit erst, wenn Sie ' +
                    'ihn mit „Werte übernehmen" bestätigen — prüfen Sie ihn an der Leistungszeile der ' +
                    'Rechnung.'}
              </p>
            </fieldset>
          ) : (
            <p
              className="max-w-2xl border-t border-line pt-6 text-small text-text-muted"
              data-testid="billing-model-not-applicable"
            >
              Abrechnungsmodell: entfällt — ohne Leistungsmessung fällt kein Leistungspreis an.
            </p>
          )}

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
              {/* H3: gespeichert wird netto; die Basis sagt, wie die drei Lieferantenpreise gemeint sind. */}
              <AdminSelect
                id="manual-price-basis"
                name="priceBasis"
                label="Lieferantenpreise eingetragen"
                defaultValue={initial.priceBasis}
                error={fieldError('priceBasis')}
                hint={
                  initial.priceBasis === ''
                    ? 'Basis nicht erfasst — die Werte stehen so, wie bisher gerechnet (netto). Beim Speichern bitte wählen.'
                    : 'Gilt für Arbeitspreis, Nachttarif und Grundgebühr. Gerechnet wird immer netto.'
                }
              >
                {initial.priceBasis === '' && (
                  <option value="">Basis nicht erfasst — bitte wählen</option>
                )}
                <option value="net">netto (ohne USt)</option>
                <option value="gross">{VAT_INCLUSIVE_LABEL}</option>
              </AdminSelect>
              <AdminField
                id="manual-energy-price"
                name="energyPriceCtPerKwh"
                label={fieldLabel('energyPriceCtPerKwh')}
                inputMode="numeric"
                defaultValue={initial.numbers.energyPriceCtPerKwh}
                error={fieldError('energyPriceCtPerKwh')}
              />
              <AdminField
                id="manual-energy-price-night"
                name="energyPriceNightCtPerKwh"
                label={fieldLabel('energyPriceNightCtPerKwh')}
                inputMode="numeric"
                defaultValue={initial.numbers.energyPriceNightCtPerKwh}
                error={fieldError('energyPriceNightCtPerKwh')}
                hint="Nur, wenn ein eigener Nachttarif vereinbart ist."
              />
              <AdminField
                id="manual-feed-in"
                name="einspeiseverguetungCtPerKwh"
                label={fieldLabel('einspeiseverguetungCtPerKwh')}
                inputMode="numeric"
                defaultValue={initial.numbers.einspeiseverguetungCtPerKwh}
                error={fieldError('einspeiseverguetungCtPerKwh')}
              />
              <AdminField
                id="manual-base-fee"
                name="supplierBaseFeeEurPerMonth"
                label={fieldLabel('supplierBaseFeeEurPerMonth')}
                inputMode="numeric"
                defaultValue={initial.numbers.supplierBaseFeeEurPerMonth}
                error={fieldError('supplierBaseFeeEurPerMonth')}
              />
              <AdminField
                id="manual-annual-kwh"
                name="annualConsumptionKwh"
                label={fieldLabel('annualConsumptionKwh')}
                inputMode="numeric"
                defaultValue={initial.numbers.annualConsumptionKwh}
                error={fieldError('annualConsumptionKwh')}
              />
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" size="md" disabled={busy}>
              {isSaving && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              )}
              {isSaving ? 'Wird gespeichert …' : 'Werte übernehmen'}
            </Button>
            <span role="status" aria-live="polite" className="sr-only">
              {isSaving ? 'Wird gespeichert …' : ''}
            </span>
          </div>
        </>
      )}
    </form>
  )
}
