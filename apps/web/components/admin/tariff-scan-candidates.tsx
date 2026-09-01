'use client'

/**
 * Der Anlagebereich „Neuen Tarifstand anlegen": Preisblatt-Scan oben, darunter EIN Formular je
 * gelesener Tarifzeile — oder ein einzelnes leeres Formular für die Anlage von Hand.
 *
 * ── ⚠ N KANDIDATEN SIND N UNABHÄNGIGE FORMULARE, UND DAS IST DIE TRAGENDE ENTSCHEIDUNG ──────────
 * Es gibt bewusst KEINEN Sammel-Absenden-Knopf. Jede Tarifzeile wird einzeln bestätigt und einzeln
 * angelegt. Drei Gründe, jeder für sich ausreichend:
 *
 *   1. DIE BESTÄTIGUNGSSTUFE GILT JE ZEILE. Ein Tarifstand ist nachträglich nicht mehr korrigierbar
 *      und geht in jede künftige Analyse SEINER Netzebene ein. „Alle sieben übernehmen" wäre genau
 *      der eine Klick, für dessen Vermeidung dieser Scan überhaupt so gebaut ist (er schreibt
 *      keine Zeile, er befüllt ein Formular — s. `lib/admin/tariff-scan/actions.ts`).
 *   2. EIN TEILERFOLG IST SICHTBAR STATT VERDECKT. `public.create_grid_tariff` legt GENAU EINE
 *      Zeile atomar an (B21-2b); sieben Zeilen sind sieben Transaktionen, und es gibt keine Klammer
 *      darüber. Bricht die vierte ab, stehen die ersten drei bereits in der Datenbank. Mit sieben
 *      eigenen Formularen sieht der Admin genau das: drei gemeldete Erfolge, eine Fehlermeldung an
 *      IHRER Zeile, drei unberührte Formulare. Ein Sammel-Knopf müsste denselben Zustand hinterher
 *      erklären — oder ihn verschweigen.
 *   3. EIN FORMULAR IST EINE FormData. Die Feldnamen (`operatorId`, `w0_label`, …) sind flach und
 *      werden von `readGridTariffForm` (B21-2b) genau so gelesen. Sieben Kandidaten in EINEM
 *      `<form>` kollidierten in jedem einzelnen Feld; die Alternative wäre ein Umbau von Schema und
 *      Prüfkette gewesen — für nichts.
 *
 * ── DAS MUSTER STEHT SCHON AUF DIESER SEITE ─────────────────────────────────────────────────────
 * Mehrere echte `<form>`-Elemente nebeneinander, jedes mit eigenem `useActionState`, ist genau die
 * Bauform von `ActionButton` (T4-4) — und die Löschknöpfe der Tarifliste darunter benutzen sie
 * bereits. Hooks dürfen nicht in einer Schleife stehen; je Zeile eine eigene Komponenten-Instanz
 * ist der vorgesehene Weg.
 */
import * as React from 'react'
import { CreateGridTariffForm } from './grid-tariff-form'
import { TariffScanPanel } from './tariff-scan-panel'
import { AdminPanel } from './ui'
import {
  METERING_VARIANT_LABELS,
  type OperatorOption,
  type MeteringVariant,
} from '@/lib/admin/grid-tariffs'
import {
  candidateIdentityKey,
  tariffSheetFormPrefill,
  type TariffSheetCandidate,
  type TariffSheetExtraction,
} from '@/lib/admin/tariff-sheet-scan'

/** Die Kopfzeile eines Kandidaten-Formulars: welche Tarifzeile hier gleich angelegt wird. */
function candidateLabel(candidate: TariffSheetCandidate): string {
  const variant = candidate.meteringVariant
  return variant === null
    ? `Netzebene ${candidate.netzebene}`
    : `Netzebene ${candidate.netzebene} · ${METERING_VARIANT_LABELS[variant as MeteringVariant]}`
}

export function TariffScanCandidates({ operators }: { operators: readonly OperatorOption[] }) {
  /*
   * Das Ergebnis des letzten Scans und ein Zähler, der die Formulare NEU AUFBAUT.
   *
   * Die Eingabefelder der Formulare sind unkontrolliert; eine geänderte Vorbelegung wirkt deshalb
   * erst bei einem NEUEN Element. Der Zähler steht als Teil des `key` an jedem Formular: er wechselt
   * genau einmal je Scan, React ersetzt die Teilbäume, und die Felder starten mit den gelesenen
   * Werten.
   *
   * ⚠ Er ist auch dann nötig, wenn zwei Scans dieselben Kandidaten-Kennungen liefern (dasselbe
   * Blatt in einer neueren Fassung): ohne ihn blieben die Formulare bestehen und zeigten weiter die
   * Werte des ersten Scans.
   *
   * ⚠ Ein Scan verwirft damit bewusst, was vorher in den Formularen stand. Das ist die Bedeutung von
   * „das Blatt füllt das Formular"; alles Weitere bleibt die Entscheidung des Menschen davor.
   */
  const [extraction, setExtraction] = React.useState<TariffSheetExtraction | null>(null)
  const [scanNonce, setScanNonce] = React.useState(0)

  function applyExtraction(next: TariffSheetExtraction) {
    setExtraction(next)
    setScanNonce((value) => value + 1)
  }

  const candidates = extraction?.candidates ?? []

  return (
    <div className="flex flex-col gap-6">
      {/*
        Der Datei-Eingang steht AUSSERHALB jedes Formulars: verschachtelte Formulare gibt es in HTML
        nicht, und die PDF darf unter keinen Umständen im Rumpf eines Tarif-Formulars mitfahren.
      */}
      <TariffScanPanel onExtracted={applyExtraction} />

      {candidates.length === 0 ? (
        /*
          Kein Kandidat: das gewohnte Einzelformular — derselbe Codepfad, nur ohne Vorbelegung.
          Hat der Scan blattweite Angaben geliefert (Betreiber, Gültig ab, Preisbasis), aber keine
          Zeile sicher zuordnen können, reisen genau diese drei als Vorbelegung mit; die Netzebene
          bleibt dann sichtbar leer und sagt darunter warum.
        */
        <CreateGridTariffForm
          key={`${scanNonce}:einzeln`}
          operators={operators}
          prefill={extraction ? tariffSheetFormPrefill(extraction, null) : null}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-accent-border bg-accent-subtle p-3 text-small text-ink">
            <p>
              <span className="font-medium">
                {candidates.length}{' '}
                {candidates.length === 1 ? 'Tarifzeile erkannt' : 'Tarifzeilen erkannt'}
              </span>{' '}
              — je eine Kombination aus Netzebene und Messvariante.
            </p>
            <p className="mt-1 text-text-muted">
              Jede Zeile wird EINZELN geprüft und einzeln angelegt: Es gibt bewusst keinen Knopf, der
              alle auf einmal übernimmt. Bitte jeden Wert gegen das Blatt prüfen — ein angelegter
              Tarifstand lässt sich nicht mehr korrigieren. Zeilen, die Sie nicht brauchen, lassen Sie
              einfach stehen.
            </p>
          </div>

          <ul className="flex flex-col gap-4">
            {candidates.map((candidate) => {
              const identity = candidateIdentityKey(candidate)
              return (
                <li key={`${scanNonce}:${identity}`}>
                  <AdminPanel>
                    <h4 className="text-small font-semibold text-ink">
                      {candidateLabel(candidate)}
                    </h4>
                    <p className="mt-1 text-caption text-text-muted">
                      Aus dem Preisblatt gelesen. Prüfen, bei Bedarf korrigieren, dann anlegen.
                    </p>
                    <div className="mt-4">
                      <CreateGridTariffForm
                        operators={operators}
                        prefill={tariffSheetFormPrefill(extraction!, candidate)}
                        formId={`gt-${identity}`}
                      />
                    </div>
                  </AdminPanel>
                </li>
              )
            })}
          </ul>

          {/*
            ── ⚠ DER AUSWEG, OHNE DEN DIE FESTE IDENTITÄT EINE SACKGASSE WÄRE ──────────────────
            Seit die Netzebene einer gescannten Zeile nicht mehr umschaltbar ist (die Preise
            gehören zu IHRER Ebene, ein Umschalten legte sie unter falschem Namen an), braucht ein
            falsch zugeordneter Kandidat einen zweiten Weg. Ohne dieses Formular gäbe es ihn nicht:
            Solange ein Scan Kandidaten geliefert hat, rendert dieser Bereich AUSSCHLIESSLICH deren
            Formulare — der Admin müsste die Seite neu laden, um überhaupt wieder eines ohne
            Vorbelegung zu sehen, und verlöre dabei die übrigen sechs.

            Es ist DIESELBE Komponente mit `prefill = null`, keine zweite Fassung.
          */}
          <AdminPanel>
            <h4 className="text-small font-semibold text-ink">Tarifzeile von Hand anlegen</h4>
            <p className="mt-1 max-w-prose text-caption text-text-muted">
              Für eine Zeile, die der Scan nicht gelesen oder falsch zugeordnet hat. Alle Angaben
              werden hier selbst eingetragen — es ist nichts vorbelegt.
            </p>
            <div className="mt-4">
              <CreateGridTariffForm
                key={`${scanNonce}:manuell`}
                operators={operators}
                prefill={null}
                formId="gt-manuell"
              />
            </div>
          </AdminPanel>
        </div>
      )}
    </div>
  )
}
