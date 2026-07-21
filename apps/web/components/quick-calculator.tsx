'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FieldHint, Input, Label } from '@/components/ui/input'
import { Num } from '@/components/ui/layout'
import { LeadCaptureForm } from '@/components/leads/lead-capture-form'
import type { LeadCaptureConsentTexts } from '@/lib/leads/capture-texts'
import { CTA_HREF } from '@/lib/nav'
import { QUICK_DECIMAL, QUICK_EUR, computeQuickSaving } from '@/lib/schnellrechner'

/*
 * SCHNELLRECHNER — der freie Teaser (Pflichtenheft §5.4), NICHT der Pro-Kalkulator.
 *
 * Bewusst eine triviale lokale Formel (Zielreduktion × Leistungspreis) statt
 * `packages/engine`: die Engine ist die belastbare Lastgang-Analyse hinter dem
 * Pro-Kalkulator. Sie hier zu importieren würde die Grenze Teaser/Pro verwischen
 * (§5.4: „nicht beide Kalkulator") und den Rechenkern ins Marketing-Bundle ziehen.
 * Der Teaser schätzt, der Pro rechnet — und der CTA ist die Brücke dorthin.
 *
 * §9.5 („keine erfundenen Kennzahlen") ist gewahrt: die Vorbelegung ist ein
 * sichtbares, editierbares Rechenbeispiel, kein behaupteter Referenzwert. Was
 * gerechnet wurde, steht als Formel unter dem Ergebnis — inklusive der Werte,
 * die geklemmt wurden.
 *
 * EIGENSTÄNDIG: Peak-Shaving-Seite und Branchenseiten binden dieselbe Komponente
 * ein. Deshalb `bg-surface` statt eines Navy-Sonderwegs — die Karte trägt ihren
 * eigenen Grund und funktioniert auf JEDEM Sektionshintergrund. Zusätzlich sind
 * nur so die in DESIGN.md gemessenen Kontraste gültig: Feldrand `#8f8f8f` (3,23:1)
 * und Teal-Button (5,47:1) sind gegen WEISS vermessen, nicht gegen Navy.
 */

/*
 * Zahlformate und Rechnung liegen seit B3-2 in `lib/schnellrechner.ts` — die Zusendung des
 * Ergebnisses per E-Mail (B3-2, 'rechnerergebnis') muss dieselben Beträge zeigen wie dieser
 * Bildschirm, und der Server rechnet dafür selbst nach. Die Begründung der zwei Locales steht dort.
 */
const EUR = QUICK_EUR
const DECIMAL = QUICK_DECIMAL
/** Vorbelegung: bewusst OHNE Tausenderpunkt — sonst liefe sie in die Ambiguität unten. */
const PREFILL = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2, useGrouping: false })

type Field =
  | { state: 'empty' }
  | { state: 'invalid' }
  /** `negative` = Eingabe war < 0 und wurde für die Rechnung auf 0 gesetzt. */
  | { state: 'ok'; value: number; negative: boolean }

/**
 * de-AT-Eingabe: Komma = Dezimaltrenner, Punkt = Tausendertrenner („1.500,5").
 * OHNE Komma gilt ein einzelner Punkt als Dezimaltrenner („0.5") — „1.500" wird
 * damit als 1,5 gelesen. Diese Zweideutigkeit ist ohne Kontext nicht auflösbar;
 * ein Tausenderpunkt ohne jede Nachkommastelle ist der seltenere Fall, und die
 * Formel unter dem Ergebnis zeigt offen, welche Zahl tatsächlich gerechnet wurde.
 */
function parseField(raw: string): Field {
  const trimmed = raw.trim()
  if (trimmed === '') return { state: 'empty' }

  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed

  const value = Number(normalized)
  // Fängt Buchstaben, „--", „." UND das getippte „Infinity"/„1e99999" ab.
  if (!Number.isFinite(value)) return { state: 'invalid' }

  // kW und €/kW·a sind Beträge; negativ ist fachlich sinnlos -> mit 0 rechnen.
  // Die Eingabe wird NICHT überschrieben: unter dem Cursor umzuschreiben, was
  // jemand gerade tippt, ist feindlich. Der Hinweis am Feld sagt, was gilt.
  if (value < 0) return { state: 'ok', value: 0, negative: true }
  return { state: 'ok', value, negative: false }
}

type Computed = {
  peak: Field
  reduction: Field
  price: Field
  /** Für die Rechnung verwendete Reduktion (ggf. auf die Spitze geklemmt). */
  effectiveReductionKw: number | null
  savingEur: number | null
  /** Reduktion lag über der Spitze und wurde begrenzt. */
  capped: boolean
  /** Alle drei Felder gültig, aber das Produkt ist nicht mehr endlich. */
  overflow: boolean
}

function compute(peakRaw: string, reductionRaw: string, priceRaw: string): Computed {
  const peak = parseField(peakRaw)
  const reduction = parseField(reductionRaw)
  const price = parseField(priceRaw)

  const base = { peak, reduction, price, capped: false, overflow: false }
  if (peak.state !== 'ok' || reduction.state !== 'ok' || price.state !== 'ok') {
    return { ...base, effectiveReductionKw: null, savingEur: null }
  }

  /*
   * Die eigentliche Rechnung (inkl. Klemmung auf die Spitze) liegt seit B3-2 in
   * `lib/schnellrechner.ts`, weil der Server sie für die Zusendung des Ergebnisses nachrechnet.
   * Hier bleibt nur die Übersetzung der EINGABE-Zustände in Anzeigezustände.
   */
  const computed = computeQuickSaving({
    peakKw: peak.value,
    reductionKw: reduction.value,
    pricePerKwYear: price.value,
  })

  if (!computed) {
    const capped = reduction.value > peak.value
    return {
      ...base,
      capped,
      effectiveReductionKw: capped ? peak.value : reduction.value,
      savingEur: null,
      overflow: true,
    }
  }

  return {
    ...base,
    capped: computed.capped,
    effectiveReductionKw: computed.effectiveReductionKw,
    savingEur: computed.savingEur,
  }
}

function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  invalid,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  hint?: string
  invalid?: boolean
}) {
  const hintId = hint ? `${id}-hint` : undefined
  return (
    // Abstand aus dem Layout (space-y), nicht aus Einzel-Margins am Primitive —
    // DESIGN.md „Layout & Gestaltung". Gleiches Muster wie /styleguide.
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        // type="text" + inputMode statt type="number": Letzteres liefert bei
        // Komma-Eingabe je nach Browser einen LEEREN Wert zurück und verstellt
        // sich am Scrollrad — für ein live nachgerechnetes Feld beides untauglich.
        // inputMode="decimal" bringt trotzdem die numerische Tastatur.
        type="text"
        inputMode="decimal"
        autoComplete="off"
        // Kein fachliches Limit, nur eine Bremse gegen Tastatur-Mash: sie hält
        // das Produkt in einem Bereich, den Intl noch als Ziffernfolge formatiert.
        maxLength={12}
        // tabular-nums ist bei Lastwerten Pflicht (DESIGN.md) — drei gestapelte
        // Zahlenfelder mit proportionalen Ziffern flackern beim Tippen.
        className="tabular-nums"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={hintId}
      />
      {hint ? (
        <FieldHint id={hintId} tone={invalid ? 'error' : 'muted'}>
          {hint}
        </FieldHint>
      ) : null}
    </div>
  )
}

export interface QuickCalculatorProps {
  /** Vorbelegung der aktuellen Leistungsspitze (kW). */
  defaultPeakKw?: number
  /** Vorbelegung der Zielreduktion (kW). */
  defaultReductionKw?: number
  /** Vorbelegung des Leistungspreises (€/kW·a). */
  defaultPricePerKwYear?: number
  /**
   * Erfassung unter dem Ergebnis (B3-2, Einstiegspunkt 'rechnerergebnis').
   *
   * BEWUSST EIN SERIALISIERBARES OBJEKT UND KEIN `ReactNode`/Render-Prop: das Formular braucht die
   * LIVE gerechneten Werte, die es nur hier gibt — eine von aussen fertig gerenderte Karte könnte
   * sie nicht sehen, und eine Funktion liesse sich aus einer Server-Komponente nicht hereinreichen.
   * Die Einwilligungstexte lädt die Seite serverseitig (`lib/leads/capture-texts.ts`) und reicht sie
   * durch — die Komponente selbst holt keine Texte.
   *
   * Fehlt der Wert, verhält sich der Schnellrechner exakt wie bisher (Startseite, Branchenseiten,
   * Artikel). Die Platzierung ist eine getrennte Entscheidung.
   */
  capture?: { consentTexts: LeadCaptureConsentTexts } | null
  className?: string
}

export function QuickCalculator({
  defaultPeakKw = 500,
  defaultReductionKw = 100,
  defaultPricePerKwYear = 120,
  capture = null,
  className,
}: QuickCalculatorProps) {
  const t = useTranslations('QuickCalculator')

  // useId, nicht ein fester String: die Komponente darf mehrfach auf einer Seite
  // stehen, und doppelte for/id-Paare hängen das Label an das falsche Feld.
  const uid = React.useId()
  const peakId = `${uid}-peak`
  const reductionId = `${uid}-reduction`
  const priceId = `${uid}-price`

  const [peakRaw, setPeakRaw] = React.useState(() => PREFILL.format(defaultPeakKw))
  const [reductionRaw, setReductionRaw] = React.useState(() => PREFILL.format(defaultReductionKw))
  const [priceRaw, setPriceRaw] = React.useState(() => PREFILL.format(defaultPricePerKwYear))

  // Kein „Berechnen"-Button: die Formel ist trivial, das Ergebnis fällt bei
  // jedem Tastenanschlag im Render ab. Kein useMemo — eine Multiplikation.
  const { peak, reduction, price, effectiveReductionKw, savingEur, capped, overflow } = compute(
    peakRaw,
    reductionRaw,
    priceRaw,
  )

  const fieldHint = (field: Field, extra?: string) => {
    if (field.state === 'invalid') return t('hintNumber')
    if (field.state === 'ok' && field.negative) return t('hintNegative')
    return extra
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('intro')}</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-4">
          <NumberField
            id={peakId}
            label={t('peakLabel')}
            value={peakRaw}
            onChange={setPeakRaw}
            hint={fieldHint(peak)}
            invalid={peak.state === 'invalid'}
          />
          <NumberField
            id={reductionId}
            label={t('reductionLabel')}
            value={reductionRaw}
            onChange={setReductionRaw}
            hint={fieldHint(
              reduction,
              // Dezenter Hinweis STATT einer Fehlermarkierung: die Eingabe ist
              // nicht kaputt, nur begrenzt. Womit gerechnet wurde, steht zusätzlich
              // als Formel direkt am Ergebnis.
              capped && peak.state === 'ok'
                ? t('hintCapped', { value: DECIMAL.format(peak.value) })
                : undefined,
            )}
            invalid={reduction.state === 'invalid'}
          />
          <NumberField
            id={priceId}
            label={t('priceLabel')}
            value={priceRaw}
            onChange={setPriceRaw}
            hint={fieldHint(price)}
            invalid={price.state === 'invalid'}
          />
        </div>

        {/*
         * aria-live auf dem GANZEN Ergebnisblock inkl. Beschriftung: eine nackt
         * vorgelesene „12.000 €" ohne Kontext wäre wertlos. aria-atomic sorgt
         * dafür, dass der Satz als Ganzes kommt, nicht nur die geänderte Ziffer.
         * `polite` — die Ansage darf warten, bis die Eingabe steht.
         */}
        <div
          className="mt-6 border-t border-line pt-5"
          aria-live="polite"
          aria-atomic="true"
        >
          <p className="text-small text-text-muted">{t('resultLabel')}</p>

          {/* Grün ist hier kein Dekor: DESIGN.md reserviert `positive` für genau
              das — eine Ersparnis. Der Akzent bleibt dadurch dem CTA vorbehalten. */}
          <p className="mt-1 break-words text-h2 text-positive">
            <Num>{savingEur === null ? '—' : EUR.format(savingEur)}</Num>
          </p>

          {savingEur === null || effectiveReductionKw === null || price.state !== 'ok' ? (
            <p className="mt-1.5 text-caption text-text-muted">
              {overflow ? t('resultTooLarge') : t('resultIncomplete')}
            </p>
          ) : (
            // Offengelegte Rechenweise — und zugleich der ehrlichste Ort für den
            // geklemmten Wert: hier steht die Zahl, mit der wirklich gerechnet wurde.
            <p className="mt-1.5 text-caption text-text-muted">
              <Num>
                {t('formula', {
                  reduction: DECIMAL.format(effectiveReductionKw),
                  price: DECIMAL.format(price.value),
                })}
              </Num>
            </p>
          )}
        </div>

        <p className="mt-5 text-caption text-text-muted">{t('disclaimer')}</p>

        <Button asChild variant="primary" size="md" className="mt-4 w-full sm:w-auto">
          <Link href={CTA_HREF}>{t('cta')}</Link>
        </Button>

        {/*
          ERFASSUNG UNTER DEM ERGEBNIS (B3-2). Sie steht NACH dem Kalkulator-CTA und optisch
          abgesetzt: der Weg zum belastbaren Ergebnis bleibt der Hauptweg, die Zusendung ist das
          Angebot für alle, die die Zahl erst einmal mitnehmen wollen.

          Die übergebenen Werte sind die ROHEN Eingaben, nicht die angezeigte Ersparnis — der Server
          rechnet selbst nach (`lib/schnellrechner.ts`), damit die Zahl in unserer eigenen E-Mail
          nicht vom Absender wählbar ist.
        */}
        {capture && peak.state === 'ok' && reduction.state === 'ok' && price.state === 'ok' && (
          <div className="mt-6 border-t border-line pt-6">
            <LeadCaptureForm
              sourceKey="rechnerergebnis"
              consentTexts={capture.consentTexts}
              calculator={{
                peakKw: peak.value,
                reductionKw: reduction.value,
                pricePerKwYear: price.value,
              }}
              className="border-0 bg-transparent p-0"
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
