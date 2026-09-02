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
  type GrundpreisUnit,
  type MeteringVariant,
  type Netzebene,
  type OperatorOption,
  type PriceBasisValue,
} from '@/lib/admin/grid-tariffs'
import {
  AdminError,
  AdminField,
  AdminFixedValue,
  AdminPanel,
  AdminSelect,
  AdminSuccess,
  formatDate,
} from './ui'

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
 * oder „24:00" bleiben: sie zeigen eine Schreibweise, die man nicht raten kann (das Tagesende ist
 * 24:00), und ein leeres Uhrzeit-Feld ist ohnehin kein gültiges Fenster — ein Uhrzeit-Platzhalter
 * kann also nie für eine abgelesene Angabe gehalten werden.
 *
 * ── ⚠ DIE SAISONFELDER WAREN GENAU DAVON AUSGENOMMEN — UND ES HAT ZUGESCHLAGEN ────────────────
 * Für „04-01"/„09-30" galt dieselbe Begründung, und sie trug nicht: Ein Monat-Tag-Paar IST als
 * Wert lesbar, und diese beiden Zahlen sind zufällig die reale SNAP-Saison (1. April bis
 * 30. September) genau des Blattes, das durch dieses Formular läuft. Am 01.09.2026 gemessen: Der
 * Scan liefert für die Netzebenen 3 bis 6 korrekt KEINE Saison — im Formular stand darunter
 * trotzdem sichtbar „04-01"/„09-30", und die Kopfzeile der Fensterzeile bürgte mit „Vorbelegt aus
 * dem Preisblatt-Scan" optisch dafür mit. Das las sich als saisonal begrenzter NE-3-Tarif; die
 * Rohantwort des Modells enthält an dieser Stelle nachweislich nichts. Dieselbe Falle wie beim
 * Betrag „38.52", eine Ebene tiefer.
 *
 * Der Ersatz nennt deshalb keine Schreibweise, sondern die BEDEUTUNG des leeren Feldes; das Format
 * steht ohnehin in der Beschriftung („MM-TT").
 */
const AMOUNT_PLACEHOLDER = 'Betrag vom Preisblatt'

/** Der Platzhalter der beiden Saisonfelder — eine Aussage über das leere Feld, keine Zahl. */
const SEASON_PLACEHOLDER = 'leer = ganzjährig'

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

/**
 * Der Hinweis an EINEM der beiden Saisonfelder.
 *
 * Drei Zustände, drei verschiedene Aussagen — und der mittlere ist der, dessentwegen es diese
 * Funktion gibt:
 *
 *   - Der Scan hat eine Saison gelesen  → der gewohnte Herkunftsvermerk.
 *   - Der Scan hat die ZEILE gelesen, aber KEINE Saison → das wird ausdrücklich gesagt. Ohne diesen
 *     Satz ist „der Scan hat hier nichts gefunden" von „ich habe die Saison noch nicht eingetragen"
 *     nicht zu unterscheiden — und die Kopfzeile der Fensterzeile sagt daneben „Vorbelegt aus dem
 *     Preisblatt-Scan".
 *   - Kein Scan (Anlage von Hand) → kein Hinweis; der Platzhalter sagt bereits, was leer bedeutet.
 */
function seasonHint(
  window: TariffSheetWindow | null,
  field: 'monthDayFrom' | 'monthDayTo',
): React.ReactNode {
  if (!window) return undefined
  if (window[field] !== null) return scanOrigin(true)
  return 'Der Scan hat für dieses Fenster keine Saison gelesen — leer heisst ganzjährig.'
}

/**
 * Die sechs Felder EINES Zeitfensters (B21-2d aus dem Anlageformular herausgezogen).
 *
 * ── ⚠ WARUM SIE HIER STEHEN BLEIBT UND NICHT IN EINE EIGENE DATEI WANDERT ─────────────────────
 * Sie braucht `AMOUNT_PLACEHOLDER`, `SEASON_PLACEHOLDER`, `numberValue` und `seasonHint` — und die
 * ersten beiden Helfer benutzt das Formular oben WEITERHIN für Grundpreis und Netzverlust. In eine
 * eigene Datei verschoben müssten sie entweder mitwandern (dann importierte das Anlageformular
 * seine eigenen Platzhalter aus einer Datei über Zeitfenster) oder von hier importiert werden
 * (Zirkelbezug). Beides wäre Umbau für nichts: Beide Verwender rendern auf DERSELBEN Seite.
 *
 * ── ⚠ DIE FELDNAMEN KOMMEN ALS VORSILBE HEREIN, SIE WERDEN NICHT ABGELEITET ────────────────────
 * Das Anlageformular nummeriert seine Zeilen (`w0_label`, `w1_label`, …) und `readGridTariffForm`
 * liest genau diese Namen. Das „Zeitfenster ergänzen"-Formular trägt genau EIN Fenster und benutzt
 * deshalb FLACHE Namen (`label`, `timeFrom`, …) — ein Index daran wäre eine Nummer ohne zweite
 * Zeile, und die Fehlerpfade von `addRateWindowSchema` liessen sich nicht mehr direkt auf
 * Feldnamen abbilden. Die Vorsilbe ist damit der einzige Unterschied zwischen beiden Verwendungen.
 *
 * Verhaltensgleich zur bisherigen, eingebetteten Fassung: Für `namePrefix = `w${index}_`` entstehen
 * Zeichen für Zeichen dieselben `id`- und `name`-Attribute wie vorher.
 */
export function RateWindowFields({
  formId,
  namePrefix,
  fieldErrors,
  prefill,
}: {
  formId: string
  /** `w0_`, `w1_`, … im Anlageformular; `''` beim Ergänzen eines einzelnen Fensters. */
  namePrefix: string
  fieldErrors: Record<string, string> | undefined
  /** Die gelesenen Werte aus dem Preisblatt-Scan — `null` bei Eingabe von Hand. */
  prefill: TariffSheetWindow | null
}) {
  const name = (leaf: string): string => `${namePrefix}${leaf}`
  const error = (leaf: string): string | undefined => fieldErrors?.[name(leaf)]

  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      <AdminField
        id={`${formId}-${name('label')}`}
        name={name('label')}
        label="Bezeichnung"
        placeholder={RATE_WINDOW_LABEL_SUGGESTIONS.join(' · ')}
        error={error('label')}
        defaultValue={prefill?.label}
        required
      />
      <AdminField
        id={`${formId}-${name('ctPerKwh')}`}
        name={name('ctPerKwh')}
        label="Arbeitspreis (ct/kWh)"
        inputMode="numeric"
        placeholder={AMOUNT_PLACEHOLDER}
        error={error('ctPerKwh')}
        defaultValue={numberValue(prefill?.ctPerKwh)}
        required
      />
      <AdminField
        id={`${formId}-${name('timeFrom')}`}
        name={name('timeFrom')}
        label="Uhrzeit von"
        placeholder="00:00"
        error={error('timeFrom')}
        defaultValue={prefill?.timeFrom}
        required
      />
      <AdminField
        id={`${formId}-${name('timeTo')}`}
        name={name('timeTo')}
        label="Uhrzeit bis"
        placeholder="24:00"
        error={error('timeTo')}
        defaultValue={prefill?.timeTo}
        hint="Tagesende ist 24:00 — deshalb ein Textfeld und kein Zeitwähler."
        required
      />
      {/*
        ⚠ DIE HERKUNFT STEHT HIER FELDGENAU UND NICHT AN DER KOPFZEILE.
        Für Bezeichnung, Uhrzeiten und Arbeitspreis ist die zeilenweite Aussage oben
        richtig: `parseWindow` verwirft eine Fensterzeile, sobald eines dieser vier
        Felder fehlt — sie stammen also ganz oder gar nicht aus dem Scan. Die Saison
        ist der EINZIGE Teil, den eine gelesene Zeile legitim NICHT trägt (ganzjährig
        heisst: beide Felder null). Genau dort trug die Kopfzeile ihre Aussage zu weit
        und bürgte für zwei leere Felder mit.
      */}
      <AdminField
        id={`${formId}-${name('monthDayFrom')}`}
        name={name('monthDayFrom')}
        label="Saison von (MM-TT, optional)"
        placeholder={SEASON_PLACEHOLDER}
        error={error('monthDayFrom')}
        hint={seasonHint(prefill, 'monthDayFrom')}
        defaultValue={prefill?.monthDayFrom ?? undefined}
      />
      <AdminField
        id={`${formId}-${name('monthDayTo')}`}
        name={name('monthDayTo')}
        label="Saison bis (MM-TT, optional)"
        placeholder={SEASON_PLACEHOLDER}
        error={error('monthDayTo')}
        hint={seasonHint(prefill, 'monthDayTo')}
        defaultValue={prefill?.monthDayTo ?? undefined}
      />
      {/*
        Die Notiz steht ALLEIN in einer eigenen Zeile (B21-2d): Sie ist der einzige Freitext des
        Fensters, und in der zweispaltigen Reihe daneben stünde ein einzeiliges Feld für einen Satz,
        der eine Preisblatt-Fussnote tragen soll.
      */}
      <div className="sm:col-span-2">
        <AdminField
          id={`${formId}-${name('note')}`}
          name={name('note')}
          label="Notiz (optional)"
          placeholder="z. B. Fussnote des Preisblatts"
          error={error('note')}
          hint="Für Menschen — sie geht in keine Berechnung ein und erscheint nicht im Kalkulator."
        />
      </div>
    </div>
  )
}

/** Die Vorsilbe der Feldnamen einer Fensterzeile im Anlageformular. */
function windowPrefix(index: number): string {
  return `w${index}_`
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

/**
 * Die Zusammenfassung EINES angelegten Zeitfensters, aus den abgesendeten Formularwerten.
 *
 * Die Indizes sind lückenlos: das Formular nummeriert seine Fensterzeilen über den ARRAY-INDEX
 * (`w${index}_…`), nicht über den stabilen Schlüssel — nach dem Entfernen einer Zeile rutschen die
 * folgenden nach. Deshalb genügt ein aufsteigender Durchlauf, bis kein `w{i}_label` mehr da ist;
 * dieselbe Annahme trifft `readGridTariffForm` (B21-2b) auf der Serverseite.
 */
function submittedWindows(values: Record<string, string>): {
  label: string
  ctPerKwh: string
  timeFrom: string
  timeTo: string
  season: string | null
}[] {
  const out = []
  for (let i = 0; values[`w${i}_label`] !== undefined; i += 1) {
    const from = values[`w${i}_monthDayFrom`]?.trim()
    const to = values[`w${i}_monthDayTo`]?.trim()
    out.push({
      label: values[`w${i}_label`] ?? '',
      ctPerKwh: values[`w${i}_ctPerKwh`] ?? '',
      timeFrom: values[`w${i}_timeFrom`] ?? '',
      timeTo: values[`w${i}_timeTo`] ?? '',
      season: from && to ? `${from} bis ${to}` : null,
    })
  }
  return out
}

/** Ein Wert, den das Formular gar nicht erst mitgeschickt hat — als solcher erkennbar. */
const MISSING = '—'

/**
 * Was nach einem erfolgreichen Anlegen an der Stelle des Formulars steht.
 *
 * ── ⚠ WARUM DAS FORMULAR VERSCHWINDET UND NICHT NUR EINE MELDUNG DAZUKOMMT ────────────────────
 * Bis hierher blieb es nach einem `created` unverändert stehen — mit ausgefüllten Feldern und
 * einem klickbaren „Tarifstand anlegen". Der zweite Klick ist nicht harmlos, und er hat ZWEI
 * Ausgänge, die beide schlecht sind (an der echten Funktion gemessen, s. Handover):
 *
 *   1. UNVERÄNDERT abgeschickt antwortet `create_grid_tariff` mit `invalid_valid_from` — also
 *      einem FEHLER am Datumsfeld („Der bisher gültige Stand beginnt am …"), und zwar wegen des
 *      Standes, den derselbe Klick eine Sekunde zuvor selbst angelegt hat. Für den Admin liest
 *      sich das, als sei etwas schiefgegangen.
 *   2. Mit GEÄNDERTEM Gültigkeitsbeginn legt er einen ZWEITEN Stand an und beendet den gerade
 *      erst erzeugten am Vortag (gemessen: `closed_count: 1`). Das ist der teure Fall — es gibt
 *      kein Bearbeiten, der Rückbau ist ein protokollierter Löschvorgang (B21-2c).
 *
 * Ein Formular, das nach getaner Arbeit stehen bleibt, lädt genau dazu ein. Es wird deshalb
 * ERSETZT statt deaktiviert: ein Feld mit `readOnly` sähe weiterhin aus, als liesse sich vielleicht
 * doch etwas ändern — dieselbe Überlegung, aus der `AdminFixedValue` (PR #120) kein graues
 * Eingabefeld ist.
 *
 * ── DIE WERTE BLEIBEN LESBAR, UND ZWAR AUS EINEM BESTIMMTEN GRUND ─────────────────────────────
 * Angezeigt wird, was ABGESCHICKT wurde (`state.values`), nicht was die Datenbank zurückmeldet.
 * Der Admin hat gerade neun Felder und bis zu zwölf Zeitfenster von einem Preisblatt abgetippt;
 * verschwände das mit dem Klick, könnte er es mit nichts mehr vergleichen. Die Liste „Alle
 * Tarifzeilen" darunter zeigt die Zeile zwar ebenfalls (`revalidatePath`), aber ohne die
 * Zeitfenster-Sätze.
 */
function CreatedGridTariff({
  idPrefix,
  values,
}: {
  idPrefix: string
  values: Record<string, string>
}) {
  const variant = values.meteringVariant
  const unit = values.grundpreisUnit
  const basis = values.priceBasis
  const windows = submittedWindows(values)

  const isVariant = (v: string | undefined): v is MeteringVariant =>
    v !== undefined && (METERING_VARIANTS as readonly string[]).includes(v)
  const isUnit = (v: string | undefined): v is GrundpreisUnit =>
    v !== undefined && (GRUNDPREIS_UNITS as readonly string[]).includes(v)
  const isBasis = (v: string | undefined): v is PriceBasisValue =>
    v !== undefined && (PRICE_BASES as readonly string[]).includes(v)

  return (
    <div className="flex flex-col gap-6">
      {/*
        Dieselbe zweispaltige Aufteilung wie im Formular: Der Admin sieht seine Eingaben an
        derselben Stelle wieder, nur eingefroren — nicht in einer anderen Anordnung, die er erst
        wieder zuordnen müsste.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFixedValue
          id={`${idPrefix}-created-operator`}
          label="Netzbetreiber"
          value={values.operatorName || MISSING}
          hint={values.operatorId ? `Kennung ${values.operatorId}` : undefined}
        />
        <AdminFixedValue
          id={`${idPrefix}-created-netzebene`}
          label="Netzebene"
          value={values.netzebene ? `Netzebene ${values.netzebene}` : MISSING}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFixedValue
          id={`${idPrefix}-created-grundpreis`}
          label="Grundpreis"
          value={values.grundpreisAmount || MISSING}
          hint={isUnit(unit) ? GRUNDPREIS_UNIT_LABELS[unit] : undefined}
        />
        <AdminFixedValue
          id={`${idPrefix}-created-netzverlust`}
          label="Netzverlustentgelt (ct/kWh)"
          value={values.netzverlustCtPerKwh || MISSING}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/*
          Die Messvariante steht nur da, wo eine mitgeschickt wurde — auf den Netzebenen 3 bis 6
          gehört `null` in die Spalte, und eine Zeile „Messvariante: —" behauptete dort eine
          fehlende Angabe statt einer nicht vorhandenen (B21-1, `nulls not distinct`).
        */}
        {isVariant(variant) && (
          <AdminFixedValue
            id={`${idPrefix}-created-meteringVariant`}
            label="Leistungsmessungs-Variante"
            value={METERING_VARIANT_LABELS[variant]}
          />
        )}
        <AdminFixedValue
          id={`${idPrefix}-created-priceBasis`}
          label="Preisbasis"
          value={isBasis(basis) ? PRICE_BASIS_LABELS[basis] : MISSING}
        />
        <AdminFixedValue
          id={`${idPrefix}-created-validFrom`}
          label="Gültig ab"
          value={values.validFrom ? formatDate(values.validFrom) : MISSING}
        />
      </div>

      <div className="border-t border-line pt-5">
        <h4 className="text-small font-semibold text-ink">
          {windows.length === 1 ? 'Zeitfenster' : `Zeitfenster (${windows.length})`}
        </h4>
        <ul className="mt-3 flex flex-col gap-2">
          {windows.map((w, index) => (
            <li
              key={index}
              className="rounded-md border border-line bg-surface-sunken px-3 py-2 text-small text-text"
            >
              <span className="font-medium text-ink">{w.label}</span>
              <span className="text-text-muted"> · </span>
              <span className="tabular-nums">{w.ctPerKwh} ct/kWh</span>
              <span className="text-text-muted"> · </span>
              <span className="tabular-nums">
                {w.timeFrom}–{w.timeTo}
              </span>
              <span className="text-text-muted"> · {w.season ?? 'ganzjährig'}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="max-w-prose text-caption text-text-muted">
        Dieser Stand ist angelegt und lässt sich nicht mehr bearbeiten. Er steht ab jetzt in der
        Liste „Alle Tarifzeilen" weiter unten. Für eine weitere Tarifzeile bitte die Seite neu
        laden.
      </p>
    </div>
  )
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

  /*
   * ── ⚠ DIE IDENTITÄT EINER GESCANNTEN TARIFZEILE IST FEST, KEIN AUSWAHLFELD ──────────────────
   * Hat der Scan die Kombination gelesen, steht sie als TEXT da und reist als verstecktes Feld
   * mit. Der Grund ist nicht Bequemlichkeit, sondern was ein Umschalten bedeutete: Diese Instanz
   * wurde AUS einem Kandidaten erzeugt — Grundpreis, Netzverlust und Fensterliste gehören zu
   * SEINER Netzebene. Ein Dropdown änderte die Beschriftung und liesse die Preise stehen; heraus
   * käme ein Tarifstand, der die Werte der einen Ebene unter dem Namen einer anderen anlegt. Und
   * er wäre nicht mehr korrigierbar (kein Bearbeiten, B21-2b). Die Kopfzeile über dem Formular
   * (`tariff-scan-candidates.tsx`) nennt dieselbe Kombination und kann dadurch nicht mehr von dem
   * abweichen, was das Formular absendet.
   *
   * ⚠ MASSGEBLICH IST DER GELESENE WERT, NICHT `prefill != null`. Es gibt den Fall, dass ein Scan
   * blattweite Angaben liefert und KEINE Zeile zuordnen kann (`tariffSheetFormPrefill(…, null)`) —
   * dort MUSS die Auswahl bleiben, sonst liesse sich der Stand gar nicht anlegen. Dasselbe gilt
   * für eine Netzebene 7 ohne gelesene Variante: `gridTariffSchema` verlangt sie dort, und ohne
   * Auswahlfeld wäre das Formular unabsendbar.
   */
  const fixedNetzebene = prefill?.netzebene ?? null
  const fixedVariant = fixedNetzebene !== null && showVariant ? (prefill?.meteringVariant ?? null) : null

  /*
   * Der eine Ausweg, wenn der Scan eine Zeile falsch zugeordnet hat. Er steht AN der Instanz und
   * nicht nur im Handover: Ohne Dropdown ist „hier stimmt die Ebene nicht" sonst eine Sackgasse.
   */
  const fixedIdentityHint =
    'Diese Zeile ist auf die gelesene Kombination festgelegt. Falsch zugeordnet? Diese Zeile stehen lassen und den Tarifstand unten von Hand anlegen.'

  /*
   * ── ⚠ NACH EINEM ERFOLG GIBT ES KEIN FORMULAR MEHR ──────────────────────────────────────────
   * `state.success` ist für DIESE Action gleichbedeutend mit `status: 'created'`: die Server
   * Action setzt das Feld in genau einem Zweig (`grid-tariffs-actions.ts`), alle übrigen Ausgänge
   * antworten mit `formError` oder `fieldErrors`. Ein eigenes Statusfeld auf `AdminState` — das
   * zehn andere Admin-Formulare mitträgen — wäre dafür nicht nötig; die Bedingung ist als Kommentar
   * an beiden Enden festgehalten, damit ein künftiger zweiter `success`-Zweig nicht still das
   * Formular sperrt.
   *
   * Es wird kein `<form>` gerendert, nicht bloss ein deaktivierter Knopf: was es nicht gibt, lässt
   * sich auch nicht über einen zweiten Klick, die Eingabetaste in einem Feld oder ein
   * wiederhergestelltes Formular auslösen. Die Begründung, warum ein zweiter Klick teuer ist, steht
   * bei `CreatedGridTariff`.
   *
   * REIN CLIENTSEITIG ABGELEITET: kein Speicher, keine zweite Datenquelle. Ein Neuladen der Seite
   * zeigt wieder das leere Formular — richtig so, denn dann steht die angelegte Zeile in der Liste
   * darunter (`revalidatePath`), und das ist der Ort, an dem sie dauerhaft hingehört.
   */
  if (state.success) {
    return (
      <div className="flex flex-col gap-6">
        <AdminSuccess>{state.success}</AdminSuccess>
        <CreatedGridTariff idPrefix={formId} values={state.values ?? {}} />
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {state.formError && <AdminError>{state.formError}</AdminError>}

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
        {fixedNetzebene !== null ? (
          <>
            {/*
              Der Wert reist als verstecktes Feld mit — `readGridTariffForm` liest weiterhin genau
              `netzebene`, Schema und Server Action bleiben unangetastet.
            */}
            <input type="hidden" name="netzebene" value={String(fixedNetzebene)} />
            <AdminFixedValue
              id={`${formId}-netzebene`}
              label="Netzebene"
              value={`Netzebene ${fixedNetzebene}`}
              error={state.fieldErrors?.netzebene}
              hint={scanOrigin(true, fixedIdentityHint)}
            />
          </>
        ) : (
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
        )}

        {/*
          Die Variante gibt es NUR auf den Netzebenen, die sie anbieten (Delta 5). Auf allen anderen
          wird das Feld gar nicht gerendert — ein deaktiviertes Feld sendet seinen Wert nicht, ein
          verstecktes täte es doch, und in der Spalte stünde dann eine Variante, wo `null` hingehört.
          Genau darauf beruht der `unique nulls not distinct`-Constraint aus B21-1.
        */}
        {fixedVariant !== null ? (
          <>
            <input type="hidden" name="meteringVariant" value={fixedVariant} />
            <AdminFixedValue
              id={`${formId}-meteringVariant`}
              label="Leistungsmessungs-Variante"
              value={METERING_VARIANT_LABELS[fixedVariant]}
              error={state.fieldErrors?.meteringVariant}
              hint={scanOrigin(true)}
            />
          </>
        ) : showVariant ? (
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

                <RateWindowFields
                  formId={formId}
                  namePrefix={windowPrefix(index)}
                  fieldErrors={state.fieldErrors}
                  prefill={row.prefill}
                />
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
