'use client'

/**
 * Gratis-Check-Client (T3-Teil 2/3, Pflichtenheft_Monitor_MVP.md §5.1/§5.3/§6/§10).
 *
 * Bekommt die bereits gemappten `TariffCostObject[]` vom Server (Props, s.
 * `app/(site)/[locale]/strom-check/page.tsx`) und rechnet ausschließlich im
 * Browser. Formular + Zustand (localStorage, Plausi-Wiring) sind T3-2; das
 * Ergebnis-Rendering ist an `gratis-check-result.tsx` ausgelagert (T3-3,
 * Design-Feinschliff der Ehrlichkeits-Prinzipien) — diese Datei bleibt reine
 * Orchestrierung: Formular-Zustand halten, Engine aufrufen, Ergebnis reichen.
 *
 * ENGINE-AUFRUF BEIM ABSENDEN (nicht live pro Tastenanschlag — die Werte
 * gelten erst nach bestandener Prüfung als „eingegeben"):
 *   (a) `compareTariffs(userInput, tariffs)` — wie in T3-1.
 *   (b) `checkPlausibility(userInput)` — NEU, OHNE `matchedTariff`/
 *       `invoiceTotalEur`/`gridCostEstimate`, es feuern also nur Stufe 1+2
 *       (§5.3). Läuft bewusst NEBEN `compareTariffs`, nicht über dessen
 *       (weiterhin leeres) Stub-Feld `result.plausibility.warnings` — das ist
 *       seit T1-Teil 4/5 Architektur (`checkPlausibility` bleibt unverdrahtet
 *       in `compareTariffs`, s. `packages/tariff-monitor/CLAUDE.md`).
 *
 * localStorage (§6 Schritt 3, §10): Vorbelegung passiert ERST NACH DEM MOUNT
 * (`useEffect`) — `window.localStorage` existiert während SSR/erstem Paint
 * nicht (Muster wie `components/peak-shaving/calculator-gate.tsx`). Nichts
 * verlässt den Browser: kein Fetch, kein Supabase-Import in dieser Datei.
 */
import * as React from 'react'
import { checkPlausibility, compareTariffs } from 'tariff-monitor'
import type { PlausibilityWarning, TariffComparisonResult, TariffCostObject } from 'tariff-monitor'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { GratisCheckForm } from '@/components/monitor/gratis-check-form'
import { GratisCheckResult } from '@/components/monitor/gratis-check-result'
import {
  EMPTY_GRATIS_CHECK_VALUES,
  toUserTariffInput,
  type GratisCheckRawValues,
  type GratisCheckValues,
} from '@/lib/monitor/schema'
import {
  clearStoredGratisCheckValues,
  loadStoredGratisCheckValues,
  saveGratisCheckValues,
} from '@/lib/monitor/storage'

export function GratisCheckClient({ tariffs }: { tariffs: TariffCostObject[] }) {
  const t = useTranslations('Monitor.GratisCheck')

  const [values, setValues] = React.useState<GratisCheckRawValues>(EMPTY_GRATIS_CHECK_VALUES)
  const [result, setResult] = React.useState<TariffComparisonResult | null>(null)
  const [plausibilityWarnings, setPlausibilityWarnings] = React.useState<PlausibilityWarning[]>([])
  const [showWelcomeBack, setShowWelcomeBack] = React.useState(false)
  /*
   * Wechselt bei „Neu eingeben" — erzwingt einen Remount von `GratisCheckForm`.
   * Dessen Fehler-/Fokus-Zustand lebt bewusst INNERHALB der Formular-Komponente
   * (reines Formularverhalten, s. dort); ein `key`-Wechsel ist der saubere Weg,
   * ihn von außen zurückzusetzen, statt einen zweiten Kanal dafür zu bauen.
   */
  const [formKey, setFormKey] = React.useState(0)

  React.useEffect(() => {
    const stored = loadStoredGratisCheckValues()
    if (stored) {
      setValues(stored)
      setShowWelcomeBack(true)
    }
  }, [])

  function handleChange<K extends keyof GratisCheckRawValues>(
    field: K,
    value: GratisCheckRawValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }))
  }

  function handleValidSubmit(parsed: GratisCheckValues) {
    const userInput = toUserTariffInput(parsed)
    setResult(compareTariffs(userInput, tariffs))
    setPlausibilityWarnings(checkPlausibility(userInput))
    saveGratisCheckValues(values)
    setShowWelcomeBack(false)
  }

  function handleReset() {
    setValues(EMPTY_GRATIS_CHECK_VALUES)
    setResult(null)
    setPlausibilityWarnings([])
    setShowWelcomeBack(false)
    clearStoredGratisCheckValues()
    setFormKey((key) => key + 1)
  }

  if (tariffs.length === 0) {
    return <p className="mt-6 text-body text-negative">{t('noTariffs')}</p>
  }

  return (
    <div className="mt-8 space-y-6">
      <p className="text-caption text-text-muted">{t('loadedCount', { count: tariffs.length })}</p>

      {showWelcomeBack && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-border bg-accent-subtle px-4 py-3">
          <p className="text-small text-text">{t('welcomeBack')}</p>
          <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
            {t('resetLabel')}
          </Button>
        </div>
      )}

      <GratisCheckForm
        key={formKey}
        values={values}
        onChange={handleChange}
        onValidSubmit={handleValidSubmit}
      />

      {result ? (
        <GratisCheckResult result={result} plausibilityWarnings={plausibilityWarnings} />
      ) : (
        <p className="text-body text-text-muted">{t('noResultYet')}</p>
      )}
    </div>
  )
}
