'use client'

/**
 * Gratis-Check-Ergebnis (T3-Teil 3, Pflichtenheft_Monitor_MVP.md §1.3/§5.1/§7/§2).
 *
 * Extrahiert aus `gratis-check-client.tsx` (T3-1/2) und im apps/web-Design
 * gestaltet — die Berechnung selbst (`compareTariffs`/`checkPlausibility`,
 * T1) bleibt unverändert, nur die Darstellung ist neu. Das ist der Schritt,
 * wo die Ehrlichkeits-Prinzipien SICHTBAR werden:
 *
 *   1. HEADLINE = Dauerpreis-Ersparnis der Empfehlung (§1.3), NUR wenn > 0.
 *      Ohne sparenden Kandidaten gibt es KEINE erfundene Zahl — stattdessen
 *      die ehrliche „bereits konkurrenzfähig"-Aussage (§14-DoD-Ehrlichkeit).
 *   2. Bonus steht STRIKT SEPARAT von der Dauerpreis-Zahl (§1.3) — eigene
 *      Zeile, eigenes Label, nie in die große Zahl gerechnet.
 *   3. Plausi-Warnungen (§5.3) stehen VOR dem Ergebnis, im Warning-Token
 *      (DESIGN.md) — sie untergraben die Zahl darunter und dürfen nicht wie
 *      eine Fußnote wirken.
 *   4. Der Grob-Hinweis (§5.1) ist ehrlich UND die Überleitung zur Abo-Karte
 *      (§2) — diese Formulardaten liefern strukturell NIE mehr als die 4
 *      Stufe-1-Pflichtfelder, `result.confidence` ist hier also immer
 *      `'rough'`; die Bedingung bleibt trotzdem geschrieben, nicht
 *      angenommen, falls das Formular später Stufe-2-Felder bekommt.
 *   5. Die Abo-Karte (§2/§12#1) beschreibt Wert, behauptet aber KEINEN
 *      Festpreis (kommerziell offen) und hat einen ehrlichen „bald
 *      verfügbar"-Zustand statt eines toten Links (T4 verdrahtet ihn real).
 */
import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Bell, Calculator, ScanLine, type LucideIcon } from 'lucide-react'
import type { PlausibilityWarning, TariffComparisonResult, TariffCostObject } from 'tariff-monitor'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Num } from '@/components/ui/layout'
import { cn } from '@/lib/utils'

const EUR = new Intl.NumberFormat('de-AT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

const CT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 })

/**
 * Plausi-Warnungen (§5.3) — PROMINENT vor dem Ergebnis, DESIGN.md-Warning-Token
 * (`*-subtle`/`*-border`, kein `/alpha`). Bewusst OHNE Icon: dieselbe
 * Zurückhaltung wie `components/wissen/callout.tsx` — die Fläche + die
 * Überschrift tragen die Signalwirkung, kein ⚠️ (§7.3 verbietet Emoji/verspielte
 * Icons, ein zusätzliches Warn-Icon wäre reines Dekor).
 */
function PlausibilityWarnings({ warnings }: { warnings: PlausibilityWarning[] }) {
  const t = useTranslations('Monitor.GratisCheck')
  if (warnings.length === 0) return null

  return (
    <div className="rounded-lg border border-warning-border bg-warning-subtle p-5 sm:p-6">
      <p className="text-h4 text-warning">{t('warningsTitle')}</p>
      <ul className="mt-3 space-y-1.5">
        {warnings.map((warning, index) => (
          <li key={index} className="text-small text-text">
            {warning.message}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Eine Alternativen-Zeile. Teurere Alternativen (negative Ersparnis) werden
 * NICHT als „Ersparnis" geframt (Vorgabe Punkt 4) — eigener Text („X/Jahr
 * mehr"), negative Badge-Farbe statt der grünen. Die empfohlene Zeile trägt
 * zusätzlich einen Akzent-Rand + Empfehlung-Badge — dieselbe Karte, die oben
 * als Headline steht, taucht hier bewusst nochmal auf (§1.3-Analogon zum
 * Kalkulator: `perBattery` enthält die Empfehlung ebenfalls, keine Dopplung
 * vermeiden um den Preis einer unvollständigen Liste).
 */
function AlternativeRow({
  tariff,
  cost,
  savingOngoingEurPerYear,
  recommended,
}: {
  tariff: TariffCostObject
  cost: { ongoingYearlyCostEur: number }
  savingOngoingEurPerYear: number
  recommended: boolean
}) {
  const t = useTranslations('Monitor.GratisCheck')
  const positive = savingOngoingEurPerYear > 0
  const negative = savingOngoingEurPerYear < 0

  return (
    <li
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-3',
        recommended && 'border-accent-border bg-accent-subtle',
      )}
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-body font-medium text-ink">
            {tariff.providerName} · {tariff.tariffName}
          </p>
          {recommended ? <Badge variant="accent">{t('result.recommendedBadge')}</Badge> : null}
        </div>
        <p className="mt-0.5 text-caption text-text-muted">
          <Num>{CT.format(tariff.energyPriceCtPerKwh)} ct/kWh</Num> ·{' '}
          <Num>{EUR.format(cost.ongoingYearlyCostEur)}</Num>/Jahr
        </p>
      </div>
      <Badge variant={positive ? 'positive' : negative ? 'negative' : 'neutral'} className="shrink-0">
        <Num>
          {positive
            ? t('result.altSaving', { amount: EUR.format(savingOngoingEurPerYear) })
            : negative
              ? t('result.altMoreExpensive', { amount: EUR.format(Math.abs(savingOngoingEurPerYear)) })
              : t('result.altNoDifference')}
        </Num>
      </Badge>
    </li>
  )
}

type SubscriptionBullet = { icon: LucideIcon; title: string; text: string }

/**
 * Abo-Karte (§2/§12#1) — MITTLERE Prominenz: eine eigenständige Karte mit
 * Akzent-Rand (sichtbar) auf einem eigenen, dezenten `navy-subtle`-Flächenton
 * (DESIGN.md) — hebt sie vom umgebenden Ergebnis ab, ohne eine
 * Navy-Vollfläche/Hero zu sein (das wäre drängend, §1.2 verbietet künstliche
 * Dringlichkeit) und ohne mit dem grünen Ersparnis-Wert oben zu konkurrieren
 * (Grün bleibt reserviert für die Kernzahl). Beschreibt Wert (a/b/c aus §2),
 * KEIN hartkodierter Preis. CTA ist bewusst ein deaktivierter Button +
 * erklärender Text — kein toter Link, keine Sackgasse: T4 ersetzt `disabled`
 * durch den echten Registrierung/Stripe-Flow. Platzierung: direkt nach dem
 * Ergebnis/der Empfehlung, VOR der Alternativen-Liste — dort ist der Funnel-
 * Moment am stärksten; nur EINMAL platziert (nicht zusätzlich am Listenende).
 */
function SubscriptionTeaser() {
  const t = useTranslations('Monitor.GratisCheck.subscription')

  const bullets: SubscriptionBullet[] = [
    { icon: ScanLine, title: t('scanTitle'), text: t('scanText') },
    { icon: Calculator, title: t('preciseTitle'), text: t('preciseText') },
    { icon: Bell, title: t('monitorTitle'), text: t('monitorText') },
  ]

  return (
    <Card className="border-accent-border bg-navy-subtle">
      <CardHeader>
        <p className="text-label uppercase text-accent">{t('eyebrow')}</p>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-small text-text-muted">{t('lead')}</p>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-5 sm:grid-cols-3">
          {bullets.map((bullet) => {
            const Icon = bullet.icon
            return (
              <li key={bullet.title}>
                <Icon className="h-4 w-4 text-accent" strokeWidth={1.75} aria-hidden="true" />
                <p className="mt-2 text-small font-semibold text-ink">{bullet.title}</p>
                <p className="mt-1 text-caption text-text-muted">{bullet.text}</p>
              </li>
            )
          })}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
          {/*
            Kein `href`, kein `onClick` — `disabled` macht den „bald
            verfügbar"-Zustand für Tastatur/Screenreader unmissverständlich
            (kein anklickbares Element, das nichts tut).
          */}
          <Button type="button" variant="primary" size="lg" disabled>
            {t('cta')}
          </Button>
          <p className="text-caption text-text-muted">{t('ctaNote')}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function GratisCheckResult({
  result,
  plausibilityWarnings,
}: {
  result: TariffComparisonResult
  plausibilityWarnings: PlausibilityWarning[]
}) {
  const t = useTranslations('Monitor.GratisCheck')

  // `recommendation.tariff` ist dieselbe Objekt-Referenz wie das entsprechende
  // `alternatives[i].tariff` (compare.ts baut `recommendation` direkt aus einem
  // gefundenen `alternatives`-Eintrag) — Referenzvergleich statt Neuberechnung.
  const recommendedEntry = result.recommendation
    ? result.alternatives.find((alt) => alt.tariff === result.recommendation!.tariff)
    : undefined

  const isRough = result.confidence === 'rough'

  return (
    <div className="space-y-6">
      <PlausibilityWarnings warnings={plausibilityWarnings} />

      <Card>
        <CardContent className="pt-5">
          <p className="text-small text-text-muted">
            {t('currentLabel')}: <Num>{EUR.format(result.current.ongoingYearlyCostEur)}</Num>/Jahr
          </p>

          {recommendedEntry && result.recommendation ? (
            <div className="mt-3">
              <p className="text-small text-text-muted">
                {t('result.headlineFor', {
                  target: `${result.recommendation.tariff.providerName} ${result.recommendation.tariff.tariffName}`,
                })}
              </p>
              {/* DOMINANTE Zahl der Sektion, semantisch grün (DESIGN.md: Grün nur für Ersparnis). */}
              <p className="mt-1 text-h1 text-positive">
                <Num>{EUR.format(recommendedEntry.savingOngoingEurPerYear)}</Num>
                <span className="text-body text-text-muted"> /Jahr</span>
              </p>

              {result.recommendation.tariff.bonusEur > 0 ? (
                // STRIKT SEPARAT (§1.3): eigene Zeile, eigener Rand, nie Teil der Zahl oben.
                <p className="mt-3 border-t border-line pt-3 text-small text-text">
                  <span className="font-semibold text-ink">{t('result.bonusLabel')}: </span>
                  <Num>
                    {t('result.bonusText', {
                      amount: EUR.format(result.recommendation.tariff.bonusEur),
                    })}
                  </Num>
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-h3 text-ink">{t('result.alreadyCompetitiveTitle')}</p>
              <p className="mt-2 max-w-prose text-body text-text-muted">
                {t('result.alreadyCompetitiveText')}
              </p>
            </div>
          )}

          {isRough ? <p className="mt-4 text-caption text-text-muted">{t('result.roughNote')}</p> : null}
        </CardContent>
      </Card>

      {/*
        Abo-Karte direkt nach dem Ergebnis, VOR der Alternativen-Liste
        (stärkster Funnel-Moment, §1.2 MITTLERE Prominenz — s. Kommentar an
        `SubscriptionTeaser`). Der Grob-Hinweis (§5.1) dient hier weiterhin
        als Überleitung zur Karte, nicht als Fußnote der Liste darunter.
      */}
      {isRough ? <p className="max-w-prose text-small text-text-muted">{t('result.roughBridge')}</p> : null}
      <SubscriptionTeaser />

      {/* Mehrheitsabdeckungs-Disclaimer (§7): sichtbar, dezent, dauerhaft. */}
      <p className="text-caption text-text-muted">{t('coverageDisclaimer')}</p>

      <Card>
        <CardHeader>
          <CardTitle>{t('alternativesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {result.alternatives.map((alt) => (
              <AlternativeRow
                key={`${alt.tariff.providerName}-${alt.tariff.tariffName}`}
                tariff={alt.tariff}
                cost={alt.cost}
                savingOngoingEurPerYear={alt.savingOngoingEurPerYear}
                recommended={result.recommendation?.tariff === alt.tariff}
              />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
