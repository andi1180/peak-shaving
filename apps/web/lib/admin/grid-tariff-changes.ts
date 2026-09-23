import {
  grundpreisUnitLabel,
  messpreisLabel,
  priceBasisLabel,
  seasonLabel,
  shortTime,
  type GridTariffRateWindowRow,
  type GridTariffRow,
} from './grid-tariffs'

/** Ein Eintrag aus `public.admin_list_grid_tariff_changes()`. */
export type GridTariffChange = {
  id: string
  tariff_id: string
  changed_by: string
  changed_at: string
  reason: string
  old_row: TariffSnapshot
  new_row: TariffSnapshot
}

type TariffSnapshot = Partial<GridTariffRow> & {
  rate_windows?: Omit<GridTariffRateWindowRow, 'id' | 'grid_tariff_id'>[]
}

export type FieldChange = { label: string; from: string; to: string }

const EMPTY = '—'

function windowsLabel(windows: TariffSnapshot['rate_windows']): string {
  if (!windows || windows.length === 0) return EMPTY
  return windows
    .map(
      (w) =>
        `${w.label} ${shortTime(w.time_from)}–${shortTime(w.time_to)} · ` +
        `${seasonLabel(w.month_day_from, w.month_day_to)} · ${w.ct_per_kwh} ct/kWh` +
        (w.note ? ` (${w.note})` : ''),
    )
    .join('; ')
}

/**
 * Die Felder, deren Anzeige sich zwischen alt und neu unterscheidet. Verglichen wird die ANZEIGE,
 * nicht der Rohwert — ein Betrag und seine Einheit erscheinen so als eine Zeile.
 */
export function changedFields(
  change: Pick<GridTariffChange, 'old_row' | 'new_row'>,
): FieldChange[] {
  const fields: [string, (s: TariffSnapshot) => string][] = [
    ['Anzeigename', (s) => s.operator_name ?? EMPTY],
    ['Grundpreis', (s) => `${s.grundpreis_amount} ${grundpreisUnitLabel(s.grundpreis_unit ?? '')}`],
    [
      'Messpreis',
      (s) =>
        messpreisLabel({
          messpreis_amount: s.messpreis_amount ?? null,
          messpreis_unit: s.messpreis_unit ?? null,
        }) ?? EMPTY,
    ],
    ['Netzverlust', (s) => `${s.netzverlust_ct_per_kwh} ct/kWh`],
    ['Preisbasis', (s) => priceBasisLabel(s.price_basis ?? '')],
    ['Gültig ab', (s) => s.valid_from ?? EMPTY],
    ['Gültig bis', (s) => s.valid_until ?? 'offen'],
    ['Zeitfenster', (s) => windowsLabel(s.rate_windows)],
  ]
  const out: FieldChange[] = []
  for (const [label, show] of fields) {
    const from = show(change.old_row)
    const to = show(change.new_row)
    if (from !== to) out.push({ label, from, to })
  }
  return out
}
