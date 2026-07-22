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
 * nicht. Nichts
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

export function GratisCheckClient({
  tariffs,
  isLoggedIn,
}: {
  tariffs: TariffCostObject[]
  /** NUR ob eine Session existiert (aus der Server-Component) — routet den Abo-Teaser-CTA (Aufgabe 5c).
   *  Der Gratis-Check bleibt loginlos/dataless: keine Verbrauchsdaten verlassen den Browser. */
  isLoggedIn: boolean
}) {
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
    /*
     * T3-4 (§7 Randfall 4): `showWelcomeBack` bewusst NICHT hier auf `false`
     * setzen. Der Banner sitzt VOR dem Formular — ihn genau beim Absenden
     * verschwinden zu lassen, während gleichzeitig darunter das komplette
     * Ergebnis erscheint, ließ den Absende-Button (auf dem der Zeiger/Fokus
     * gerade sitzt) sichtbar nach oben springen. Die Aussage bleibt auch nach
     * dem Absenden wahr (`saveGratisCheckValues` speichert exakt diese Werte),
     * verschwindet also erst bei „Neu eingeben" — dort ist ein Sprung erwartet
     * (das Formular wird ohnehin geleert).
     */
  }

  function handleReset() {
    setValues(EMPTY_GRATIS_CHECK_VALUES)
    setResult(null)
    setPlausibilityWarnings([])
    setShowWelcomeBack(false)
    clearStoredGratisCheckValues()
    setFormKey((key) => key + 1)
  }

  /*
   * §7 Randfall 1: 0 Tarife ist produktiv real möglich (Scrape-Lauf lieferte
   * nichts, oder die DB war beim Server-Fetch nicht erreichbar — s.
   * `app/(site)/[locale]/strom-check/page.tsx`, beide Ursachen laufen hier
   * zusammen). RUHIGE Meldung statt eines Fehlertons: neutrale, abgesetzte
   * Fläche (dasselbe `info`-Callout-Muster wie `components/wissen/callout.tsx`
   * — `border-line`/`bg-surface-sunken`, KEIN `text-negative`/Warnfarbe, das
   * ist kein Fehler des Nutzers). Kein Formular, kein „0 Tarife geladen".
   */
  if (tariffs.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-line bg-surface-sunken p-5 sm:p-6">
        <p className="text-h4 text-ink">{t('unavailable.title')}</p>
        <p className="mt-3 max-w-prose text-body text-text">{t('unavailable.text')}</p>
      </div>
    )
  }

  return (
    <div className="mt-8 space-y-6">
      <p className="text-caption text-text-muted">{t('loadedCount', { count: tariffs.length })}</p>

      {/*
        §6 Rückkehrer-UX: dieselbe Kasten-Geometrie wie `PlausibilityWarnings`
        unten und der `accent`-Callout (`components/wissen/callout.tsx`,
        `rounded-lg p-5 sm:p-6`, `border-accent-border`/`bg-accent-subtle`) —
        vorher `rounded-md px-4 py-3`, eine zweite, kleinere Kasten-Geometrie
        auf derselben Seite. `secondary` (Navy-Kontur) statt `ghost` für den
        Reset: der klare, immer sichtbare Weg zurück zu einer frischen
        Eingabe darf nicht so leicht zu übersehen sein wie ein reiner Textlink.
      */}
      {showWelcomeBack && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-accent-border bg-accent-subtle p-5 sm:p-6">
          <p className="text-body text-text">{t('welcomeBack')}</p>
          <Button type="button" variant="secondary" size="sm" onClick={handleReset}>
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
        <GratisCheckResult
          result={result}
          plausibilityWarnings={plausibilityWarnings}
          isLoggedIn={isLoggedIn}
        />
      ) : (
        <p className="text-body text-text-muted">{t('noResultYet')}</p>
      )}
    </div>
  )
}
