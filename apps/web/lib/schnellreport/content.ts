/*
 * PDF-Schnellreport (Leadgen-Umbau Schritt 3b-1) — das Inhaltsmodell: aus den Eingaben werden alle
 * Zeichenketten der vier Seiten. Rein, ohne React und ohne Datenbank; das Layout liest nur dieses
 * Modell. Vorlage: `docs/prototypes/schnellreport-prototyp.html`, Abschnitt „2 · PDF".
 */
import { createTranslator } from 'next-intl'
import messages from '@/messages/de.json'
import { COMPANY } from '@/lib/nav'
import { computeSchnellcheck, formatGrouped, type Country } from '@/lib/schnellcheck'
import { SCHNELLREPORT_SETTINGS, type SchnellreportSettings } from './settings'

/** Die sechs Branchen in der Reihenfolge des Prototyps; Texte unter `Schnellreport.branchen`. */
export const BRANCHE_KEYS = [
  'produktion',
  'lebensmittel',
  'gastro',
  'logistik',
  'handel',
  'sonstige',
] as const

export type BrancheKey = (typeof BRANCHE_KEYS)[number]

export function isBrancheKey(value: unknown): value is BrancheKey {
  return typeof value === 'string' && (BRANCHE_KEYS as readonly string[]).includes(value)
}

export const PAGE_COUNT = 4

/** Stundenwerte der statischen Tageskurve auf Seite 2 (Anteil der Spitze, 0–1). */
export const DAY_LOAD = [
  0.18, 0.17, 0.17, 0.17, 0.18, 0.22, 0.33, 0.48, 0.56, 0.7, 0.92, 0.74, 0.52, 0.55, 0.71, 0.6,
  0.56, 0.5, 0.4, 0.31, 0.25, 0.21, 0.19, 0.18,
] as const

/** Ab diesem Anteil ist ein Balken der Tageskurve die (rote) Spitze. */
export const DAY_PEAK_THRESHOLD = 0.85

export type SchnellreportInput = {
  country: Country
  kwh: number
  /** Eingegebene höchste Leistung; `null` = es gilt der Reglerwert. */
  kw: number | null
  sliderKw: number
  bill: number | null
  firma: string
  branche: BrancheKey
  createdAt: Date
}

type Fact = { when: string; text: string }
type Lever = { title: string; text: string }
type ContactField = { label: string; value: string }

export type SchnellreportContent = {
  brand: { prefix: string; i: string; suffix: string }
  pageOf: (page: number) => string
  headMeta: string
  page1: {
    createdOn: string
    kicker: string
    title: string
    forPrefix: string
    firma: string
    forRest: string
    heroValue: string
    heroCaption: string
    tiles: { label: string; value: string }[]
    bill: {
      title: string
      share: number
      totalLabel: string
      totalValue: string
      peakLabel: string
      peakValue: string
      percent: string
    } | null
    tenValue: string
    tenText: string
    meaningTitle: string
    meaning: string
    source: string
    footer: string
  }
  page2: {
    kicker: string
    title: string
    chartLabel: string
    branchText: string
    general: string
    leversTitle: string
    levers: Lever[]
    footer: string
  }
  page3: {
    kicker: string
    title: string
    facts: Fact[]
    checklistTitle: string
    checklist: string[]
    footer: string
  }
  page4: {
    kicker: string
    title: string
    lead: string
    offer: string[]
    price: { value: string; note: string } | null
    cta: string
    ctaNote: string
    example: string
    talk: string
    contact: ContactField[]
    footer: string
  }
}

const DATE_LOCALE: Record<Country, string> = { AT: 'de-AT', DE: 'de-DE' }

function formatDate(date: Date, country: Country): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[country], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Vienna',
  }).format(date)
}

export function buildSchnellreportContent(
  input: SchnellreportInput,
  settings: SchnellreportSettings = SCHNELLREPORT_SETTINGS,
): SchnellreportContent {
  const result = computeSchnellcheck({
    country: input.country,
    kwh: input.kwh,
    kw: input.kw,
    bill: input.bill,
    sliderKw: input.sliderKw,
  })
  if (!result) throw new Error('Schnellreport ohne Jahresverbrauch')

  const t = createTranslator({ locale: 'de', messages, namespace: 'Schnellreport' })
  const tc = createTranslator({ locale: 'de', messages, namespace: 'Schnellcheck' })

  const firma = input.firma.trim() || t('firmaFallback')
  const branche = messages.Schnellreport.branchen[input.branche]
  const isAT = input.country === 'AT'
  const peak = formatGrouped(result.peakCostEur)

  // Quellenzeile wortgleich zum Schnellcheck, ergänzt um den Netto-Hinweis des Prototyps.
  const note =
    result.usageHours === null
      ? tc('noteAT', { price: result.demandPrice })
      : tc('noteDE', { price: result.demandPrice, hours: formatGrouped(result.usageHours) })

  const contact: ContactField[] = []
  if (settings.contactName.trim())
    contact.push({ label: t('page4.contactName'), value: settings.contactName.trim() })
  if (settings.phone.trim())
    contact.push({ label: t('page4.contactPhone'), value: settings.phone.trim() })
  contact.push({ label: t('page4.contactEmail'), value: COMPANY.email })
  contact.push({ label: t('page4.contactWeb'), value: 'coolin.at' })

  return {
    brand: { prefix: t('brandPrefix'), i: t('brandI'), suffix: t('brandSuffix') },
    pageOf: (page) => t('pageOf', { page, total: PAGE_COUNT }),
    headMeta: t('headMeta', { firma }),
    page1: {
      createdOn: t('createdOn', { date: formatDate(input.createdAt, input.country) }),
      kicker: t('page1.kicker'),
      title: t('page1.title'),
      forPrefix: t('page1.forPrefix'),
      firma,
      forRest: t('page1.forRest', {
        branche: branche.label,
        country: tc(isAT ? 'countryAT' : 'countryDE'),
      }),
      heroValue: t('aroundEur', { amount: peak }),
      heroCaption: result.kwFromInput
        ? t('page1.heroCaption')
        : tc('bigSubExample', { kw: formatGrouped(result.kw) }),
      tiles: [
        {
          label: t('page1.tileKwh'),
          value: t('page1.kwhValue', { kwh: formatGrouped(input.kwh) }),
        },
        { label: t('page1.tileKw'), value: t('page1.kwValue', { kw: formatGrouped(result.kw) }) },
        {
          label: t('page1.tilePrice'),
          value: t('page1.priceValue', { price: result.demandPrice }),
        },
      ],
      bill: result.bill && {
        title: t('page1.billTitle'),
        share: result.bill.share,
        totalLabel: t('page1.billTotal'),
        totalValue: t('eur', { amount: formatGrouped(result.bill.billEur) }),
        peakLabel: t('page1.billPeak'),
        peakValue: t('aroundEur', { amount: peak }),
        percent: t('aroundPercent', { pct: result.bill.percent }),
      },
      tenValue: t('savingValue', { amount: formatGrouped(result.savingEur) }),
      tenText: t('page1.tenText'),
      meaningTitle: t('page1.meaningTitle'),
      meaning: [
        t('page1.meaningBefore'),
        t(isAT ? 'page1.billingAT' : 'page1.billingDE'),
        t('page1.meaningAfter'),
      ].join(' '),
      source: `${note} ${t('page1.net')}`,
      footer: t('page1.footer'),
    },
    page2: {
      kicker: t('page2.kicker'),
      title: t('page2.title', { branche: branche.dative }),
      chartLabel: t('page2.chartLabel'),
      branchText: branche.text,
      general: t('page2.general'),
      leversTitle: t('page2.leversTitle'),
      levers: t.raw('page2.levers') as Lever[],
      footer: t('page2.footer'),
    },
    page3: {
      kicker: t('page3.kicker'),
      title: t('page3.title'),
      facts: t.raw(isAT ? 'page3.factsAT' : 'page3.factsDE') as Fact[],
      checklistTitle: t('page3.checklistTitle'),
      checklist: t.raw('page3.checklist') as string[],
      footer: t('page3.footer'),
    },
    page4: {
      kicker: t('page4.kicker'),
      title: t('page4.title'),
      lead: t('page4.lead'),
      offer: t.raw('page4.offer') as string[],
      price: settings.price.trim()
        ? { value: settings.price.trim(), note: settings.priceNote.trim() }
        : null,
      cta: t('page4.cta'),
      ctaNote: t('page4.ctaNote'),
      example: t('page4.example'),
      talk: t('page4.talk'),
      contact,
      footer: t('page4.footer'),
    },
  }
}
