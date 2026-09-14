'use client'

/**
 * „Neuen Lieferanten-Tarifstand anlegen" — das Formular des Abschnitts „Lieferanten-Tarife".
 *
 * ── WORIN ES SICH VOM NETZBETREIBER-FORMULAR UNTERSCHEIDET ─────────────────────────────────────
 *   1. KEINE Zeitfenster. `public.retail_tariffs` hat keine Kind-Tabelle: Dieser Katalog führt
 *      Listenpreise zum Vergleich (ein Arbeitspreis, eine Grundgebühr), nicht die saisonalen und
 *      tageszeitlichen Staffeln eines Netzentgelt-Tarifblatts. Begründung in der Migration.
 *   2. EIN zusätzliches Feld: die Kundengruppe (privat/betrieb). Sie ist Teil der Identität der
 *      Zeile — derselbe Anbieter hat für Haushalte und Betriebe zwei unabhängige Stände.
 *   3. Preisbasis und Kundengruppe haben KEINEN Vorgabewert. Ausführlich begründet an
 *      `RETAIL_SELECT_UNSET`; kurz: Endkundenpreise werden gegenüber Haushalten brutto und gegenüber
 *      Betrieben netto beworben — ein Vorgabewert wäre eine Vermutung, die im Formular aussieht wie
 *      eine Ablesung, und der Vergleich wäre dann still um den Steuersatz falsch.
 *
 * ── ⚠ ES GIBT KEINEN LÖSCHWEG, UND DAS PRÄGT DIESES FORMULAR ──────────────────────────────────
 * Für `public.retail_tariffs` existiert weder eine Lösch- noch eine Änderungsfunktion, für keine
 * Rolle. Eine falsch eingetragene Zeile bleibt stehen und kann nur durch einen neuen Stand abgelöst
 * werden — anders als bei den Netzbetreiber-Tarifen, wo ein Probeeintrag über `delete_grid_tariff`
 * (protokolliert) wieder verschwinden kann. Deshalb steht der Hinweis darauf im Formular und nicht
 * nur in einem Kommentar.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createRetailTariffAction } from '@/lib/admin/retail-tariffs-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import {
  RETAIL_PRICE_BASES,
  RETAIL_PRICE_BASIS_LABELS,
  RETAIL_SEGMENTS,
  RETAIL_SEGMENT_LABELS,
  RETAIL_SELECT_UNSET,
  type RetailProviderOption,
} from '@/lib/admin/retail-tariffs'
import { AdminError, AdminField, AdminSelect, AdminSuccess, formatDate } from './ui'

/** Kennzeichnet im Anbieter-Auswahlfeld den Weg „noch nicht in der Liste". */
const PROVIDER_OTHER = '__other__'

/**
 * Platzhalter der Betragsfelder.
 *
 * ⚠ Ein FORMAT-Hinweis, kein Beispielwert — dieselbe Lehre wie beim Tarifblatt-Scan (B21-2b Teil A):
 * Eine plausible Zahl im Platzhalter ist in einem `inputMode="numeric"`-Feld von einem abgelesenen
 * Wert nicht zu unterscheiden, und die Zahl, die dort stünde, wäre zufällig der echte Preis
 * irgendeines Anbieters.
 */
const AMOUNT_PLACEHOLDER = 'Betrag von der Preisseite'

/** Reihenfolge des Fokussprungs nach einem Feldfehler — von oben nach unten im Formular. */
const FIELD_ORDER = [
  'providerId',
  'providerName',
  'segment',
  'energyPriceCtPerKwh',
  'baseFeeEurPerMonth',
  'priceBasis',
  'sourceUrl',
  'validFrom',
] as const

/**
 * Was nach dem Anlegen an der Stelle des Formulars steht.
 *
 * Dieselbe Entscheidung wie bei den Netzbetreiber-Tarifen: Das Formular wird ERSETZT, nicht
 * stehengelassen. Ein zweiter Klick auf ein noch bedienbares Formular legte entweder einen zweiten,
 * gleichlautenden Stand an (wenn das Datum geändert wurde — und beendete dabei den gerade erst
 * angelegten am Vortag) oder liefe in einen FEHLER wegen der Zeile, die derselbe Klick eben erzeugt
 * hat. Hier wiegt das schwerer als dort: Es gibt keinen Löschweg, mit dem sich das aufräumen liesse.
 *
 * Angezeigt wird, was ABGESCHICKT wurde — die Felder sind unkontrolliert, nach dem Klick steht der
 * getippte Inhalt nirgends mehr im Browser. Die Liste darunter zeigt die Zeile ebenfalls
 * (`revalidatePath`), aber ohne den Quellenbeleg im Volltext.
 */
function CreatedRetailTariff({ values }: { values: Record<string, string> }) {
  const from = values.validFrom ?? ''

  return (
    <div className="rounded-md border border-line bg-surface-sunken px-3 py-3 text-small text-text">
      <p className="font-medium text-ink">
        {values.providerName || '—'}
        <span className="text-text-muted">
          {' · '}
          {RETAIL_SEGMENT_LABELS[values.segment as keyof typeof RETAIL_SEGMENT_LABELS] ??
            values.segment ??
            '—'}
        </span>
      </p>
      <p className="mt-1 text-text-muted">
        Kennung <span className="font-medium text-text">{values.providerId || '—'}</span>
        {' · gültig ab '}
        <span className="tabular-nums text-text">{from ? formatDate(from) : '—'}</span>
      </p>
      <p className="mt-2">
        <span className="text-text-muted">Arbeitspreis </span>
        <span className="tabular-nums">{values.energyPriceCtPerKwh || '—'} ct/kWh</span>
        <span className="text-text-muted"> · Grundgebühr </span>
        <span className="tabular-nums">{values.baseFeeEurPerMonth || '—'} EUR/Monat</span>
        <span className="text-text-muted"> · </span>
        {RETAIL_PRICE_BASIS_LABELS[values.priceBasis as keyof typeof RETAIL_PRICE_BASIS_LABELS] ??
          values.priceBasis ??
          '—'}
      </p>
      <p className="mt-2 break-words text-caption text-text-muted">
        Beleg: {values.sourceUrl || '—'}
      </p>
      <p className="mt-3 text-caption text-text-muted">
        Dieser Stand lässt sich nicht mehr bearbeiten und nicht löschen — er kann nur durch einen
        späteren Stand abgelöst werden. Für einen weiteren Eintrag bitte die Seite neu laden.
      </p>
    </div>
  )
}

export function CreateRetailTariffForm({
  providers,
}: {
  providers: readonly RetailProviderOption[]
}) {
  const [state, formAction, isPending] = useActionState(
    createRetailTariffAction,
    ADMIN_INITIAL_STATE,
  )
  /*
   * Beginnt der Katalog leer, gibt es nichts auszuwählen — dann startet das Formular direkt auf dem
   * Weg „neuer Anbieter". Eine Auswahl mit einem einzigen Eintrag „Anderer Anbieter …" wäre ein
   * Bedienschritt ohne Entscheidung.
   */
  const [providerId, setProviderId] = React.useState<string>(
    providers[0]?.id ?? PROVIDER_OTHER,
  )

  const formId = 'rt'

  const fieldErrors = state.fieldErrors
  React.useEffect(() => {
    if (!fieldErrors) return
    const first = FIELD_ORDER.find((name) => fieldErrors[name])
    if (first) document.getElementById(`${formId}-${first}`)?.focus()
  }, [fieldErrors])

  const known = providers.find((p) => p.id === providerId)

  /*
   * REIN CLIENTSEITIG ABGELEITET: kein Speicher, keine zweite Datenquelle. Ein Neuladen zeigt wieder
   * das leere Formular — richtig so, denn dann steht die angelegte Zeile in der Liste darunter, und
   * das ist der Ort, an dem sie dauerhaft hingehört.
   */
  if (state.success) {
    return (
      <div className="flex flex-col gap-6">
        <AdminSuccess>{state.success}</AdminSuccess>
        <CreatedRetailTariff values={state.values ?? {}} />
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.formError && <AdminError>{state.formError}</AdminError>}

      {/* ── Anbieter ──────────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${formId}-providerSelect`}
          name="providerSelect"
          label="Stromanbieter"
          value={providerId}
          onValueChange={setProviderId}
          hint="Bereits eingetragene Anbieter stehen zur Auswahl. Ein neuer wird EINMAL von Hand erfasst und ist danach hier zu finden."
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value={PROVIDER_OTHER}>Anderer Anbieter …</option>
        </AdminSelect>

        {known ? (
          <>
            {/*
              Die Kennung ist die Identität der Zeile und darf nicht aus dem Anzeigenamen
              zurückgerechnet werden. Sie fährt deshalb als verstecktes Feld mit — das Auswahlfeld
              selbst heisst bewusst anders, damit es sie nicht überschreibt.
            */}
            <input type="hidden" name="providerId" value={known.id} />
            <input type="hidden" name="providerName" value={known.name} />
            <div className="self-end pb-1 text-caption text-text-muted">
              Kennung <span className="font-medium text-text">{known.id}</span>
            </div>
          </>
        ) : (
          <>
            <AdminField
              id={`${formId}-providerId`}
              name="providerId"
              label="Kennung (neu)"
              placeholder="awattar"
              error={state.fieldErrors?.providerId}
              hint="Kleinbuchstaben, Ziffern, Unterstriche. Sie identifiziert den Anbieter dauerhaft — ein Tippfehler erzeugt einen zweiten Anbieter, keine Fehlermeldung."
              defaultValue={state.values?.providerId}
              required
            />
            <AdminField
              id={`${formId}-providerName`}
              name="providerName"
              label="Anzeigename (neu)"
              placeholder="aWATTar"
              error={state.fieldErrors?.providerName}
              defaultValue={state.values?.providerName}
              required
            />
          </>
        )}
      </div>

      {/* ── Kundengruppe und Gültigkeit ───────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${formId}-segment`}
          name="segment"
          label="Kundengruppe"
          defaultValue={state.values?.segment ?? RETAIL_SELECT_UNSET}
          error={state.fieldErrors?.segment}
          hint="Teil der Identität dieser Zeile: derselbe Anbieter hat für Haushalte und Betriebe zwei unabhängige Stände."
        >
          <option value={RETAIL_SELECT_UNSET}>— bitte wählen —</option>
          {RETAIL_SEGMENTS.map((s) => (
            <option key={s} value={s}>
              {RETAIL_SEGMENT_LABELS[s]}
            </option>
          ))}
        </AdminSelect>
        <AdminField
          id={`${formId}-validFrom`}
          name="validFrom"
          label="Gültig ab"
          type="date"
          error={state.fieldErrors?.validFrom}
          defaultValue={state.values?.validFrom}
          hint="Ein bereits offener Stand dieses Anbieters wird automatisch am Vortag beendet."
          required
        />
      </div>

      {/* ── Preis ─────────────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${formId}-energyPriceCtPerKwh`}
          name="energyPriceCtPerKwh"
          label="Arbeitspreis (ct/kWh)"
          inputMode="numeric"
          placeholder={AMOUNT_PLACEHOLDER}
          error={state.fieldErrors?.energyPriceCtPerKwh}
          defaultValue={state.values?.energyPriceCtPerKwh}
          required
        />
        <AdminField
          id={`${formId}-baseFeeEurPerMonth`}
          name="baseFeeEurPerMonth"
          label="Grundgebühr (EUR/Monat)"
          inputMode="numeric"
          placeholder={AMOUNT_PLACEHOLDER}
          error={state.fieldErrors?.baseFeeEurPerMonth}
          defaultValue={state.values?.baseFeeEurPerMonth}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${formId}-priceBasis`}
          name="priceBasis"
          label="Preisbasis"
          defaultValue={state.values?.priceBasis ?? RETAIL_SELECT_UNSET}
          error={state.fieldErrors?.priceBasis}
          hint="Keine Vorauswahl, und das ist Absicht: Anbieter bewerben gegenüber Haushalten üblicherweise brutto, gegenüber Betrieben netto. Gerechnet wird intern durchgängig netto."
        >
          <option value={RETAIL_SELECT_UNSET}>— bitte wählen —</option>
          {RETAIL_PRICE_BASES.map((b) => (
            <option key={b} value={b}>
              {RETAIL_PRICE_BASIS_LABELS[b]}
            </option>
          ))}
        </AdminSelect>
      </div>

      {/* ── Quellenbeleg ──────────────────────────────────────────────────────────────────────── */}
      <AdminField
        id={`${formId}-sourceUrl`}
        name="sourceUrl"
        label="Quellenbeleg"
        placeholder="https://…"
        error={state.fieldErrors?.sourceUrl}
        defaultValue={state.values?.sourceUrl}
        hint="Preisseite des Anbieters oder wo der Preis sonst herkommt — auch ein Beleg wie „Preisblatt per E-Mail vom 12.09.2026“ ist gültig. Er darf nicht leer bleiben: ein Listenpreis ohne Beleg ist eine Behauptung."
        required
      />

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={isPending}>
          {isPending && (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />
          )}
          {isPending ? 'Wird angelegt …' : 'Tarifstand anlegen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird angelegt …' : ''}
        </span>
      </div>
    </form>
  )
}
