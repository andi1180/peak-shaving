'use client'

/**
 * Das Anlageformular für EINEN Netzbetreiber-Tarifstand (B21-2b).
 *
 * Muster wie `components/admin/partner-forms.tsx`: echtes `<form action={formAction}>`,
 * `useActionState` für Ladezustand und Fehler, Fokus springt ins erste fehlerhafte Feld, Eingaben
 * bleiben nach einer Ablehnung stehen.
 *
 * ── ES GIBT NUR „NEU ANLEGEN" ───────────────────────────────────────────────────────────────────
 * Kein Bearbeiten — weder hier noch in der Datenbank. Ein Tarifstand ist eine Aussage über einen
 * Zeitraum, und eine 2026 archivierte Analyse (B14) muss 2028 noch sagen können, welcher Stand ihr
 * zugrunde lag. Ein neues Preisblatt ist deshalb ein NEUER Stand; die bisher offene Zeile schliesst
 * die Datenbank in derselben Transaktion. (Das Löschen aus B21-2c ist ein protokollierter Rückbau
 * für Probeeinträge, keine Korrektur.)
 *
 * ── ⚠ DIESE KOMPONENTE WIRD MEHRFACH AUF EINER SEITE GERENDERT ──────────────────────────────────
 * Seit der Mehr-Ebenen-Extraktion (01.09.2026) zeigt ein gescanntes Preisblatt je erkannter
 * Tarifzeile EINE Instanz davon — bis zu sieben nebeneinander (s. `tariff-scan-candidates.tsx`).
 * Daraus folgen zwei Dinge, die beim Anfassen mitzudenken sind:
 *
 *   1. `formId` ERSETZT DIE FRÜHERE KONSTANTE `ID = 'gt'`. Jede DOM-Kennung dieser Instanz leitet
 *      sich daraus ab. Zwei Instanzen mit derselben Vorsilbe hätten doppelte `id`-Attribute: die
 *      `<label for>`-Zuordnung wäre mehrdeutig, und der Fokussprung nach einem Feldfehler
 *      (`getElementById` unten) landete im FALSCHEN Formular.
 *   2. DIE FELDNAMEN BLEIBEN UNVERÄNDERT (`operatorId`, `netzebene`, `w0_label`, …). Sie dürfen
 *      NICHT mit `formId` versehen werden: jede Instanz ist ein eigenes `<form>` und damit eine
 *      eigene FormData; `readGridTariffForm` und `gridTariffSchema` (B21-2b) lesen genau diese
 *      Namen und bleiben unangetastet.
 *
 * ── DER WIEDERHOLBARE ABSCHNITT BRAUCHT JAVASCRIPT, DER REST NICHT ──────────────────────────────
 * Hinzufügen und Entfernen von Zeitfenstern läuft über React-Zustand. Das erste Fenster steht
 * deshalb schon im server-gerenderten Formular: ohne JavaScript lässt sich damit immer noch ein
 * vollständiger Tarifstand mit einem Zeitfenster anlegen, statt vor einem leeren Abschnitt zu
 * stehen.
 */
import * as React from 'react'
import { useActionState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createGridTariffAction } from '@/lib/admin/grid-tariffs-actions'
import { ADMIN_INITIAL_STATE } from '@/lib/admin/schema'
import type { TariffSheetFormPrefill, TariffSheetWindow } from '@/lib/admin/tariff-sheet-scan'
import {
  DEFAULT_GRUNDPREIS_UNIT,
  DEFAULT_PRICE_BASIS,
  GRUNDPREIS_UNITS,
  GRUNDPREIS_UNIT_LABELS,
  METERING_VARIANTS,
  METERING_VARIANT_LABELS,
  NETZEBENEN,
  OPERATOR_OTHER,
  PRICE_BASES,
  PRICE_BASIS_LABELS,
  RATE_WINDOW_LABEL_SUGGESTIONS,
  hasMeteringVariant,
  matchOperatorByName,
  type Netzebene,
  type OperatorOption,
} from '@/lib/admin/grid-tariffs'
import { AdminError, AdminField, AdminPanel, AdminSelect, AdminSuccess } from './ui'

/** Die Vorsilbe jeder DOM-Kennung, wenn der Aufrufer keine eigene vorgibt (Einzelformular). */
const DEFAULT_FORM_ID = 'gt'

/** Eine Fensterzeile im Formular: stabiler Schlüssel plus die Werte aus einem Scan. */
type WindowRow = { key: number; prefill: TariffSheetWindow | null }

/**
 * Eine gelesene Zahl als Feldwert — oder `undefined`, damit die nächste Quelle greift.
 *
 * ⚠ Nicht `?? ''`: Ein Leerstring wäre eine ANGABE und verdrängte die Vorbelegung aus
 * `state.values` nach einer beanstandeten Eingabe. Und `String(0)` muss `'0'` ergeben — eine
 * ausgewiesene Null ist ein Wert (kein Sockel vereinbart), keine fehlende Angabe.
 */
function numberValue(value: number | null | undefined): string | undefined {
  return typeof value === 'number' ? String(value) : undefined
}

/**
 * Der Wert des Netzebene-Feldes, solange keine gewählt ist.
 *
 * ⚠ Es gibt bewusst KEINE Vorauswahl. Vorher stand das Feld auf `NETZEBENEN[0]`, also auf
 * „Netzebene 3" — und zwar auch dann, wenn ein Scan gerade KEINE Ebene erkannt hatte. Eine
 * Vorauswahl ist von einer getroffenen Auswahl nicht zu unterscheiden; sie ginge hier in eine
 * Zeile ein, die sich nachträglich nicht mehr korrigieren lässt. Der leere Wert läuft in
 * `gridTariffSchema` sauber in „Bitte eine Netzebene wählen." — die Prüfung war dafür nicht
 * anzufassen.
 */
const NETZEBENE_UNSET = ''

/**
 * ⚠ EIN PLATZHALTER ZEIGT EIN FORMAT, NIE EINEN PLAUSIBLEN WERT.
 *
 * Die Betragsfelder trugen Beispielzahlen (`38.52`, `0.62`, `4.14`). In einem leeren Feld sieht
 * ein grauer Beispielbetrag aus wie ein abgelesener — und `38.52` WAR am 01.09.2026 an
 * WN-EX0105 sogar der zutreffende NE-3-Grundpreis, während `0.62` frei erfunden war (die echten
 * Netzverlustentgelte dieses Blattes liegen bei 0,109 bis 0,700). Format-Platzhalter wie „00:00"
 * oder „04-01" bleiben: sie zeigen eine Schreibweise, die man nicht raten kann, und sind als
 * Betrag nicht lesbar.
 */
const AMOUNT_PLACEHOLDER = 'Betrag vom Preisblatt'

/**
 * Der Herkunfts-Hinweis an einem Feld, das der Scan tatsächlich befüllt hat.
 *
 * ── ⚠ WARUM ES IHN BRAUCHT ────────────────────────────────────────────────────────────────────
 * Ohne ihn ist ein vom Scan befülltes Feld von einem leeren Feld mit Platzhalter und von einer
 * blossen Vorauswahl NICHT zu unterscheiden. Am 01.09.2026 an einem echten Preisblatt gemessen:
 * Der Scan von WN-EX0105 lieferte damals wegen der Mehr-Ebenen-Regel bewusst nur `operatorName`,
 * `priceBasis` und `validFrom`. Das Formular zeigte danach trotzdem „Netzebene 3" (Vorauswahl),
 * darunter „38.52" und daneben „0.62" (beides Platzhalter). Das las sich wie eine gelungene
 * Extraktion mit genau einem falschen Wert — es war das Gegenteil: nichts davon kam aus dem Scan.
 *
 * ── ER BESCHREIBT DIE VORBELEGUNG, NICHT DEN AKTUELLEN FELDINHALT ─────────────────────────────
 * Die Felder sind bewusst unkontrolliert; der Hinweis wird deshalb aus der GEPARSTEN EXTRAKTION
 * abgeleitet und nicht aus dem Formularzustand. Er bleibt stehen, wenn der Admin den Wert danach
 * überschreibt — „vorbelegt" sagt genau das aus, und der Fall ist harmlos: Wer selbst tippt, weiss,
 * woher sein Wert stammt. Die Frage, die der Hinweis beantwortet, ist die umgekehrte: „stand das
 * schon da, oder hat der Scan es gelesen?"
 */
function scanOrigin(fromScan: boolean, hint?: React.ReactNode): React.ReactNode {
  if (!fromScan) return hint
  const origin = <span className="font-medium text-accent">Vorbelegt aus dem Preisblatt-Scan</span>
  return hint ? (
    <>
      {origin} · {hint}
    </>
  ) : (
    origin
  )
}

/** Reihenfolge, in der nach dem ersten Fehler fokussiert wird — von oben nach unten im Formular. */
const FIELD_ORDER = [
  'operatorId',
  'operatorName',
  'netzebene',
  'meteringVariant',
  'grundpreisAmount',
  'grundpreisUnit',
  'netzverlustCtPerKwh',
  'priceBasis',
  'validFrom',
] as const

/**
 * Der Netzbetreiber, mit dem das Formular startet.
 *
 * Der Scan liefert ausschliesslich den GEDRUCKTEN NAMEN und nie eine Kennung (Begründung in
 * `matchOperatorByName`). Passt er auf einen bekannten Betrieb, wird dessen bestehende Kennung
 * benutzt; sonst startet das Formular auf „Anderer Netzbetreiber …", trägt den Namen ein und lässt
 * das Kennungsfeld LEER — die vergibt ein Mensch.
 */
function initialOperatorId(
  prefill: TariffSheetFormPrefill | null,
  operators: readonly OperatorOption[],
): string {
  const fallback = operators[0]?.id ?? OPERATOR_OTHER
  if (!prefill) return fallback
  const matched = matchOperatorByName(prefill.operatorName, operators)
  if (matched) return matched.id
  return prefill.operatorName !== null ? OPERATOR_OTHER : fallback
}

/**
 * Die Fensterzeilen, mit denen das Formular startet.
 *
 * Findet der Scan für diese Tarifzeile kein Fenster, bleibt EINE leere Zeile stehen: das Formular
 * verlangt mindestens ein Zeitfenster, und ein leerer Abschnitt wäre eine Sackgasse.
 */
function initialWindowRows(prefill: TariffSheetFormPrefill | null): WindowRow[] {
  const windows = prefill?.windows ?? []
  if (windows.length === 0) return [{ key: 0, prefill: null }]
  return windows.map((window, index) => ({ key: index, prefill: window }))
}

export function CreateGridTariffForm({
  operators,
  prefill = null,
  formId = DEFAULT_FORM_ID,
}: {
  operators: readonly OperatorOption[]
  /**
   * Die gelesenen Werte EINER Tarifzeile samt der blattweiten Angaben — oder `null` für die Anlage
   * von Hand. Beides ist derselbe Codepfad: ohne Vorbelegung entfallen schlicht alle
   * Herkunftszeilen, und die Felder starten leer.
   *
   * ⚠ Die Prop ist die EINZIGE Quelle der Vorbelegung. Ein neuer Scan erzeugt eine neue Instanz
   * (der Aufrufer wechselt den `key`), nicht einen Zustandswechsel in dieser hier — deshalb
   * genügen `useState`-Initialwerte, und es braucht keinen `useEffect`, der nachträglich in die
   * unkontrollierten Felder schreibt. Ein solcher hätte zwei Fehler auf einmal: der Admin sähe
   * kurz die alten Werte, und jeder spätere Render überschriebe, was er inzwischen getippt hat.
   */
  prefill?: TariffSheetFormPrefill | null
  /** Vorsilbe aller DOM-Kennungen dieser Instanz. Muss auf der Seite eindeutig sein (s. Kopf). */
  formId?: string
}) {
  const [state, formAction, isPending] = useActionState(createGridTariffAction, ADMIN_INITIAL_STATE)

  const [operatorId, setOperatorId] = React.useState<string>(() =>
    initialOperatorId(prefill, operators),
  )
  const [netzebene, setNetzebene] = React.useState<Netzebene | null>(prefill?.netzebene ?? null)

  /*
   * Stabile Schlüssel statt des Array-Index: Beim Entfernen einer Zeile würde React sonst die
   * FOLGENDEN Zeilen wiederverwenden — die (unkontrollierten) Eingaben blieben stehen und wanderten
   * sichtbar eine Zeile nach oben. Der Zähler startet hinter den vorbelegten Zeilen und ist damit
   * auch beim Vorrendern gleich (kein `Math.random`, kein Hydration-Unterschied).
   */
  const [windowRows, setWindowRows] = React.useState<WindowRow[]>(() => initialWindowRows(prefill))
  const nextKey = React.useRef(windowRows.length)

  const fieldErrors = state.fieldErrors
  React.useEffect(() => {
    if (!fieldErrors) return
    const first =
      FIELD_ORDER.find((name) => fieldErrors[name]) ??
      Object.keys(fieldErrors).find((name) => name.startsWith('w'))
    if (first) document.getElementById(`${formId}-${first}`)?.focus()
  }, [fieldErrors, formId])

  const known = operators.find((o) => o.id === operatorId)
  /*
   * Ohne gewählte Netzebene steht die Frage nach der Messvariante gar nicht an — sie hängt an
   * `NETZEBENEN_MIT_MESSVARIANTE`, und das ist erst mit einer Ebene beantwortbar.
   */
  const showVariant = netzebene !== null && hasMeteringVariant(netzebene)

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.formError && <AdminError>{state.formError}</AdminError>}
      {state.success && <AdminSuccess>{state.success}</AdminSuccess>}

      {/* ── Netzbetreiber ─────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${formId}-operatorSelect`}
          name="operatorSelect"
          label="Netzbetreiber"
          defaultValue={operatorId}
          onValueChange={setOperatorId}
          hint={scanOrigin(
            prefill?.operatorName != null,
            'Bereits eingetragene Betreiber stehen zur Auswahl. Ein neuer wird EINMAL von Hand erfasst und ist danach hier zu finden.',
          )}
        >
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value={OPERATOR_OTHER}>Anderer Netzbetreiber …</option>
        </AdminSelect>

        {known ? (
          <>
            {/*
              Die Kennung ist die Identität der Tarifzeile und darf nicht aus dem Anzeigenamen
              zurückgerechnet werden. Sie fährt deshalb als verstecktes Feld mit — das Auswahlfeld
              selbst heisst bewusst anders, damit es sie nicht überschreibt.
            */}
            <input type="hidden" name="operatorId" value={known.id} />
            <input type="hidden" name="operatorName" value={known.name} />
            <div className="self-end pb-1 text-caption text-text-muted">
              Kennung <span className="font-medium text-text">{known.id}</span>
            </div>
          </>
        ) : (
          <>
            <AdminField
              id={`${formId}-operatorId`}
              name="operatorId"
              label="Kennung (neu)"
              placeholder="linz_netz"
              error={state.fieldErrors?.operatorId}
              hint="Kleinbuchstaben, Ziffern, Unterstriche — wie wiener_netze. Sie identifiziert den Betreiber dauerhaft."
              defaultValue={state.values?.operatorId}
              required
            />
            <AdminField
              id={`${formId}-operatorName`}
              name="operatorName"
              label="Anzeigename (neu)"
              placeholder="Linz Netz GmbH"
              error={state.fieldErrors?.operatorName}
              hint={scanOrigin(prefill?.operatorName != null)}
              defaultValue={prefill?.operatorName ?? state.values?.operatorName}
              required
            />
          </>
        )}
      </div>

      {/* ── Netzebene und Messvariante ────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminSelect
          id={`${formId}-netzebene`}
          name="netzebene"
          label="Netzebene"
          defaultValue={netzebene === null ? NETZEBENE_UNSET : String(netzebene)}
          error={state.fieldErrors?.netzebene}
          onValueChange={(v) => setNetzebene(v === NETZEBENE_UNSET ? null : (Number(v) as Netzebene))}
          hint={
            prefill
              ? scanOrigin(
                  prefill.netzebene !== null,
                  /*
                   * ⚠ Aus einem KANDIDATEN ist dieser Zweig unerreichbar: ein Kandidat trägt seine
                   * Netzebene per Definition (s. `../../lib/admin/tariff-sheet-scan`). Er greift
                   * ausschliesslich, wenn ein Scan zwar blattweite Angaben, aber keine einzige
                   * sicher zuordenbare Tarifzeile geliefert hat — und dann ist er genau die
                   * richtige Auskunft.
                   */
                  prefill.netzebene === null
                    ? 'Der Scan hat auf diesem Blatt keine Tarifzeile sicher zuordnen können. Bitte die Netzebene von Hand wählen.'
                    : undefined,
                )
              : undefined
          }
        >
          <option value={NETZEBENE_UNSET}>— bitte wählen —</option>
          {NETZEBENEN.map((n) => (
            <option key={n} value={n}>
              Netzebene {n}
            </option>
          ))}
        </AdminSelect>

        {/*
          Die Variante gibt es NUR auf den Netzebenen, die sie anbieten (Delta 5). Auf allen anderen
          wird das Feld gar nicht gerendert — ein deaktiviertes Feld sendet seinen Wert nicht, ein
          verstecktes täte es doch, und in der Spalte stünde dann eine Variante, wo `null` hingehört.
          Genau darauf beruht der `unique nulls not distinct`-Constraint aus B21-1.
        */}
        {showVariant ? (
          <AdminSelect
            id={`${formId}-meteringVariant`}
            name="meteringVariant"
            label="Leistungsmessungs-Variante"
            defaultValue={prefill?.meteringVariant ?? METERING_VARIANTS[0]}
            error={state.fieldErrors?.meteringVariant}
            hint={scanOrigin(prefill?.meteringVariant != null)}
          >
            {METERING_VARIANTS.map((v) => (
              <option key={v} value={v}>
                {METERING_VARIANT_LABELS[v]}
              </option>
            ))}
          </AdminSelect>
        ) : netzebene === null ? (
          <p className="self-end pb-2 text-caption text-text-muted">
            Erst mit der Netzebene steht fest, ob eine Leistungsmessungs-Variante dazugehört.
          </p>
        ) : (
          <p className="self-end pb-2 text-caption text-text-muted">
            Netzebene {netzebene} kennt keine Leistungsmessungs-Variante — das Feld entfällt.
          </p>
        )}
      </div>

      {/* ── Preise ────────────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${formId}-grundpreisAmount`}
          name="grundpreisAmount"
          label="Grundpreis"
          inputMode="numeric"
          placeholder={AMOUNT_PLACEHOLDER}
          error={state.fieldErrors?.grundpreisAmount}
          hint={scanOrigin(prefill?.grundpreisAmount != null)}
          defaultValue={numberValue(prefill?.grundpreisAmount) ?? state.values?.grundpreisAmount}
          required
        />
        <AdminSelect
          id={`${formId}-grundpreisUnit`}
          name="grundpreisUnit"
          label="Einheit des Grundpreises"
          defaultValue={prefill?.grundpreisUnit ?? DEFAULT_GRUNDPREIS_UNIT}
          error={state.fieldErrors?.grundpreisUnit}
          hint={scanOrigin(
            prefill?.grundpreisUnit != null,
            'Die Einheit entscheidet die Bedeutung: nur EUR/kW·Jahr ist ein Leistungspreis. Eine Jahrespauschale heisst Leistungspreis 0 — also keine Spitzenkappung.',
          )}
        >
          {GRUNDPREIS_UNITS.map((u) => (
            <option key={u} value={u}>
              {GRUNDPREIS_UNIT_LABELS[u]}
            </option>
          ))}
        </AdminSelect>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminField
          id={`${formId}-netzverlustCtPerKwh`}
          name="netzverlustCtPerKwh"
          label="Netzverlustentgelt (ct/kWh)"
          inputMode="numeric"
          placeholder={AMOUNT_PLACEHOLDER}
          error={state.fieldErrors?.netzverlustCtPerKwh}
          hint={scanOrigin(prefill?.netzverlustCtPerKwh != null)}
          defaultValue={
            numberValue(prefill?.netzverlustCtPerKwh) ?? state.values?.netzverlustCtPerKwh
          }
          required
        />
        <AdminSelect
          id={`${formId}-priceBasis`}
          name="priceBasis"
          label="Preisbasis"
          defaultValue={prefill?.priceBasis ?? DEFAULT_PRICE_BASIS}
          error={state.fieldErrors?.priceBasis}
          hint={scanOrigin(
            prefill?.priceBasis != null,
            'Netzentgelte stehen laut Tarifblatt netto. Ohne diese Angabe wäre ein Vergleich zwischen zwei Quellen stillschweigend um 20 % falsch.',
          )}
        >
          {PRICE_BASES.map((b) => (
            <option key={b} value={b}>
              {PRICE_BASIS_LABELS[b]}
            </option>
          ))}
        </AdminSelect>
      </div>

      <AdminField
        id={`${formId}-validFrom`}
        name="validFrom"
        label="Gültig ab"
        type="date"
        error={state.fieldErrors?.validFrom}
        defaultValue={prefill?.validFrom ?? state.values?.validFrom}
        hint={scanOrigin(
          prefill?.validFrom != null,
          'Ein bereits offener Stand derselben Kombination wird automatisch am Vortag beendet. Der Tag muss NACH dessen Beginn liegen.',
        )}
        required
      />

      {/* ── Zeitfenster ───────────────────────────────────────────────────────────────────────── */}
      <div className="border-t border-line pt-5">
        <h4 className="text-small font-semibold text-ink">Zeitfenster</h4>
        <p className="mt-1 max-w-prose text-caption text-text-muted">
          Die zeitabhängige Arbeitspreis-Seite des Netzentgelts. Mindestens eines ist nötig; SNAP,
          Winter und künftige Saisontypen sind reguläre Fenster derselben Form. Saison leer lassen
          heisst ganzjährig.
        </p>

        <ul className="mt-4 flex flex-col gap-4">
          {windowRows.map((row, index) => (
            <li key={row.key}>
              <AdminPanel className="bg-surface-sunken">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">
                    Fenster {index + 1}
                    {/*
                      Eine Fensterzeile stammt als GANZES aus dem Scan oder gar nicht
                      (`parseWindow` verwirft ein halb gelesenes Fenster) — die Herkunft
                      gehört deshalb an die Kopfzeile und nicht sechsmal an die Einzelfelder.
                    */}
                    {row.prefill && (
                      <span className="ml-2 font-medium normal-case tracking-normal text-accent">
                        Vorbelegt aus dem Preisblatt-Scan
                      </span>
                    )}
                  </p>
                  {windowRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setWindowRows((rows) => rows.filter((r) => r.key !== row.key))}
                      className="inline-flex items-center gap-1 rounded-sm text-caption text-text-muted underline decoration-line underline-offset-[3px] outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                      Entfernen
                    </button>
                  )}
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <AdminField
                    id={`${formId}-w${index}_label`}
                    name={`w${index}_label`}
                    label="Bezeichnung"
                    placeholder={RATE_WINDOW_LABEL_SUGGESTIONS.join(' · ')}
                    error={state.fieldErrors?.[`w${index}_label`]}
                    defaultValue={row.prefill?.label}
                    required
                  />
                  <AdminField
                    id={`${formId}-w${index}_ctPerKwh`}
                    name={`w${index}_ctPerKwh`}
                    label="Arbeitspreis (ct/kWh)"
                    inputMode="numeric"
                    placeholder={AMOUNT_PLACEHOLDER}
                    error={state.fieldErrors?.[`w${index}_ctPerKwh`]}
                    defaultValue={numberValue(row.prefill?.ctPerKwh)}
                    required
                  />
                  <AdminField
                    id={`${formId}-w${index}_timeFrom`}
                    name={`w${index}_timeFrom`}
                    label="Uhrzeit von"
                    placeholder="00:00"
                    error={state.fieldErrors?.[`w${index}_timeFrom`]}
                    defaultValue={row.prefill?.timeFrom}
                    required
                  />
                  <AdminField
                    id={`${formId}-w${index}_timeTo`}
                    name={`w${index}_timeTo`}
                    label="Uhrzeit bis"
                    placeholder="24:00"
                    error={state.fieldErrors?.[`w${index}_timeTo`]}
                    defaultValue={row.prefill?.timeTo}
                    hint="Tagesende ist 24:00 — deshalb ein Textfeld und kein Zeitwähler."
                    required
                  />
                  <AdminField
                    id={`${formId}-w${index}_monthDayFrom`}
                    name={`w${index}_monthDayFrom`}
                    label="Saison von (MM-TT, optional)"
                    placeholder="04-01"
                    error={state.fieldErrors?.[`w${index}_monthDayFrom`]}
                    defaultValue={row.prefill?.monthDayFrom ?? undefined}
                  />
                  <AdminField
                    id={`${formId}-w${index}_monthDayTo`}
                    name={`w${index}_monthDayTo`}
                    label="Saison bis (MM-TT, optional)"
                    placeholder="09-30"
                    error={state.fieldErrors?.[`w${index}_monthDayTo`]}
                    defaultValue={row.prefill?.monthDayTo ?? undefined}
                  />
                </div>
              </AdminPanel>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              setWindowRows((rows) => [...rows, { key: nextKey.current++, prefill: null }])
            }
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Zeitfenster hinzufügen
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line pt-5">
        <Button type="submit" variant="primary" size="md" disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" />}
          {isPending ? 'Wird angelegt …' : 'Tarifstand anlegen'}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {isPending ? 'Wird angelegt …' : ''}
        </span>
      </div>
    </form>
  )
}
