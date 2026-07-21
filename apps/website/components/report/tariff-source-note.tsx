import { NETZBETREIBER_LABELS, type TariffSourceRef } from 'shared'

import { Num } from './num'

/** Anzeigenamen der überschreibbaren Felder — dieselben Bezeichnungen wie in den Formularen. */
const FIELD_LABELS: Record<TariffSourceRef['overriddenFields'][number], string> = {
  leistungspreisEurPerKwYear: 'Leistungspreis',
  billingModel: 'Abrechnungsmodell',
  minBillableKw: 'Mindestleistung',
}

/**
 * B11, TEIL 3 — Welcher Tarifsatz-Stand dieser Rechnung zugrunde lag, und was davon überschrieben
 * wurde.
 *
 * ── DAUERHAFT SICHTBAR, NICHT IN EINER AUFKLAPPBAREN BOX ────────────────────────────────────────
 * Steht ausserhalb der „Annahmen & Rechenweise"-Accordion und OHNE `print:hidden`. Ohne diese
 * Angabe ist eine später archivierte Baseline nicht einzuordnen: 2027 lässt sich sonst nicht mehr
 * sagen, ob die Zahlen auf unserer Tabelle oder auf der echten Netzrechnung des Kunden beruhten —
 * und das ist beim Wirkungsnachweis genau die Frage, die zuerst gestellt wird.
 *
 * ── DER FALL „KEINE AUSWAHL" IST EINE AUSSAGE, KEINE LEERSTELLE ─────────────────────────────────
 * Wer keinen Netzbetreiber gewählt hat, hat die Werte aus seiner Rechnung eingetragen — das ist die
 * BESSERE Grundlage, nicht die schlechtere (Prinzip 1). Deshalb steht auch dann etwas da, statt
 * dass der Abschnitt verschwindet.
 */
export function TariffSourceNote({ source }: { source: TariffSourceRef | null }) {
  if (!source) {
    return (
      <p className="text-xs text-text-muted" data-testid="tarif-stand">
        Tarifsätze: kein hinterlegter Stand gewählt — Leistungspreis, Abrechnungsmodell und
        Mindestleistung stammen unverändert aus Ihrer Eingabe.
      </p>
    )
  }

  const overridden = source.overriddenFields.map((field) => FIELD_LABELS[field])

  return (
    <p className="text-xs text-text-muted" data-testid="tarif-stand">
      Tarifsätze: {NETZBETREIBER_LABELS[source.netzbetreiber]}, Netzebene{' '}
      <Num>{source.netzebene}</Num> · Stand „{source.tariffSetLabel}“, gültig ab{' '}
      <Num>{source.tariffSetValidFrom}</Num>.{' '}
      {overridden.length === 0
        ? 'Die Vorgabewerte wurden unverändert übernommen.'
        : `Selbst eingetragen und damit massgeblich: ${overridden.join(', ')}.`}
    </p>
  )
}
