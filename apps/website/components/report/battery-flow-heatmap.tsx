'use client'

import { formatKwh1 } from '@/lib/format'
import { Num } from './num'

/**
 * Stunden-Heatmap: wann im Tag lädt und entlädt der Speicher — und wie das über die Monate wandert.
 *
 * ── ⚠ KEIN RECHARTS ────────────────────────────────────────────────────────────────────────────
 * Eine Heatmap ist ein Raster aus Flächen, kein Diagramm mit Achsen und Serien. Als CSS-Grid ist
 * sie ein Dutzend Zeilen Code, druckt zuverlässig (kein SVG, das sich neu misst) und braucht keine
 * Bibliotheks-Akrobatik für etwas, das `div`s besser können.
 *
 * ── ⚠ ZWEI RICHTUNGEN, ZWEI FARBEN — UND KEINE DAVON IST GRÜN ODER ROT ────────────────────────
 * Laden trägt den Akzentton, Entladen den neutralen Textton, die Sättigung die Menge. Grün/Rot
 * bleiben im ganzen Report für Ersparnis/Kosten reserviert (DESIGN.md „Farbe ist Information"):
 * Laden ist weder gut noch schlecht, es ist eine Richtung. `color-mix()` statt Hex, damit ein
 * White-Label-Akzent die Skala automatisch mitzieht.
 *
 * ── ⚠ LEERE ZELLE ≠ RUHENDER SPEICHER ──────────────────────────────────────────────────────────
 * `null` (kein Messwert in dieser Stunde dieses Monats) wird als schraffurfreie, leere Zelle mit
 * gestricheltem Rand gezeichnet; eine echte 0 dagegen als hellste Stufe der Skala. Der Unterschied
 * ist bei einem Teiljahres-Lastgang die halbe Grafik.
 */

/*
 * ⚠ DREI Buchstaben, nicht einer. Einbuchstabig ist die Spaltenreihe „J F M A M J J A S O N D" —
 * darin ist J dreimal und M und A je zweimal vergeben, und ein Leser kann die Spalte, auf die er
 * zeigt, nicht benennen. Am gerenderten Chart gemessen: bei zwölf Spalten über die halbe
 * Report-Breite trägt jede rund 35 px, „Jän" braucht bei 10 px Schrift etwa 20.
 */
const MONTH_LABELS = [
  'Jän',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
] as const
const MONTH_FULL = [
  'Jänner',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const

/** Farbe einer Zelle: Akzent für Laden, neutraler Textton für Entladen, Sättigung = Anteil am Maximum. */
function cellStyle(value: number | null, maxAbs: number): React.CSSProperties {
  if (value == null) {
    return { backgroundColor: 'transparent', border: '1px dashed var(--color-border)' }
  }
  const share = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0
  // Untergrenze 4 %, damit eine echte 0 als hellste Stufe sichtbar bleibt und nicht mit einer
  // fehlenden Zelle verschwimmt.
  const pct = Math.round(4 + share * 96)
  const base = value >= 0 ? 'var(--color-accent)' : 'var(--color-ink)'
  return { backgroundColor: `color-mix(in srgb, ${base} ${pct}%, var(--color-surface))` }
}

export function BatteryFlowHeatmap({
  grid,
  batteryName,
}: {
  /** `[stunde 0..23][monat 0..11]` — Netto-kWh am Netz, + = laden, − = entladen. */
  grid: (number | null)[][]
  batteryName: string
}) {
  const flat = grid.flat()
  const maxAbs = flat.reduce<number>((m, v) => (v == null ? m : Math.max(m, Math.abs(v))), 0)
  const coveredMonths = MONTH_FULL.map((_, m) => grid.some((row) => row[m] != null))
  const anyCovered = coveredMonths.some(Boolean)
  if (!anyCovered || maxAbs === 0) return null

  // Die Stunde mit der grössten Netto-Ladung über alle Monate — die Aussage in einem Satz.
  let peakHour = 0
  let peakValue = -Infinity
  for (let h = 0; h < 24; h++) {
    const sum = grid[h]!.reduce<number>((acc, v) => (v == null ? acc : acc + v), 0)
    if (sum > peakValue) {
      peakValue = sum
      peakHour = h
    }
  }

  return (
    <div
      className="rounded-lg border border-border bg-surface p-6 print:break-inside-avoid"
      data-testid="stunden-heatmap"
    >
      <p className="mb-1 text-sm font-medium text-ink">Wann lädt und entlädt Ihr Speicher?</p>
      <p className="mb-4 text-xs text-text-muted">
        Netto geladene (Akzentfarbe) und entladene (dunkel) Energie je Stunde und Kalendermonat, in
        Ortszeit — gerechnet für {batteryName}. Gezählt ist die Menge am Netz, also das, was bezogen
        bzw. eingespart wurde.
      </p>

      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          {/* Kopfzeile: Monate */}
          <div className="mb-1 grid grid-cols-[2.5rem_repeat(12,1fr)] gap-px">
            <div />
            {MONTH_LABELS.map((label, m) => (
              <div
                key={m}
                className="text-center text-[10px] text-text-muted"
                title={MONTH_FULL[m]}
              >
                {label}
              </div>
            ))}
          </div>

          {grid.map((row, h) => (
            <div key={h} className="grid grid-cols-[2.5rem_repeat(12,1fr)] gap-px">
              {/* Nur jede dritte Stunde beschriften — 24 Zahlen untereinander sind Lärm, und die
                  Zeilenhöhe gibt sie ohnehin nicht her. */}
              <div className="pr-1 text-right text-[10px] leading-4 text-text-muted tabular-nums">
                {h % 3 === 0 ? `${String(h).padStart(2, '0')}h` : ''}
              </div>
              {row.map((value, m) => (
                <div
                  key={m}
                  className="h-4 rounded-[2px]"
                  style={cellStyle(value, maxAbs)}
                  title={
                    value == null
                      ? `${MONTH_FULL[m]}, ${String(h).padStart(2, '0')}:00 — keine Messwerte`
                      : `${MONTH_FULL[m]}, ${String(h).padStart(2, '0')}:00 — ${
                          value >= 0 ? 'netto geladen' : 'netto entladen'
                        } ${formatKwh1(Math.abs(value))}`
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: 'var(--color-accent)' }}
            aria-hidden
          />
          geladen
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: 'var(--color-ink)' }}
            aria-hidden
          />
          entladen
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ border: '1px dashed var(--color-border)' }}
            aria-hidden
          />
          keine Messwerte
        </span>
        <span>
          Stärkste Zelle: <Num>{formatKwh1(maxAbs)}</Num>
        </span>
      </div>

      <div className="mt-3 border-t border-border pt-3 text-xs text-text-muted">
        <p>
          Über den ganzen Zeitraum wird am meisten um{' '}
          <strong>
            <Num>{String(peakHour).padStart(2, '0')}</Num>:00 Uhr
          </strong>{' '}
          geladen. Wandert dieser Schwerpunkt über die Monate, folgt die Steuerung dem Preis — im
          Winter liegen die günstigen Stunden meist nachts, im Sommer um die Mittagszeit.
        </p>
        <p className="mt-2">
          Die Auflösung ist bewusst <strong>stündlich</strong>, nicht viertelstündlich: die
          Börsenpreise, an denen sich die Ladung ausrichtet, gelten je Stunde. Eine feinere
          Darstellung zeigte Unterschiede, die aus der Last stammen, nicht aus der Steuerung.
        </p>
      </div>
    </div>
  )
}
