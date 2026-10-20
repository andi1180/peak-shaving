/*
 * PDF-Schnellreport (Leadgen-Umbau Schritt 3b-1) — das Inhaltsmodell: aus den Eingaben werden alle
 * Zeichenketten der sieben Seiten. Rein, ohne React und ohne Datenbank; das Layout liest nur dieses
 * Modell. Vorlage: `docs/prototypes/schnellreport-prototyp.html`, Abschnitt „2 · PDF"; Deckblatt,
 * Abschlussblatt und Kopf-/Fusszeile im Look des Profi-Reports (3b-1-2).
 */
import { createTranslator } from 'next-intl'
import messages from '@/messages/de.json'
import { COMPANY } from '@/lib/nav'
import { computeSchnellcheck, formatGrouped, type Country } from '@/lib/schnellcheck'
import { SCHNELLREPORT_SETTINGS, type SchnellreportSettings } from './settings'
import type { BrancheKey } from './branchen'

export { BRANCHE_KEYS, isBrancheKey, type BrancheKey } from './branchen'

/** Deckblatt, vier Inhaltsseiten, „Unsere Software", Abschlussblatt. */
export const PAGE_COUNT = 7

export const SOFTWARE_STATUSES = ['available', 'from2027', 'projectCustomers'] as const
export type SoftwareStatus = (typeof SOFTWARE_STATUSES)[number]

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
type MetaRow = { label: string; value: string }
type SoftwareModule = { title: string; status: string; accent: boolean; text: string }

export type SchnellreportContent = {
  pageOf: (page: number) => string
  /** Marke + Unterzeile der navyfarbenen Seiten, Wortmarke der Kopfzeile. */
  brand: { name: string; sub: string }
  /** Firma in der Kopfzeile; `null` bei leerer Eingabe (kein Fallback-Text in der Kopfzeile). */
  headerFirma: string | null
  footer: { address: string; web: string }
  cover: {
    titleLine1: string
    titleLine2: string
    subtitle: string
    customerLabel: string
    firma: string | null
    rows: MetaRow[]
  }
  page1: {
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
  }
  page2: {
    kicker: string
    title: string
    chartLabel: string
    branchText: string
    general: string
    leversTitle: string
    levers: Lever[]
  }
  page3: {
    kicker: string
    title: string
    asOf: string
    facts: Fact[]
    checklistTitle: string
    checklist: string[]
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
  }
  software: { kicker: string; title: string; intro: string; modules: SoftwareModule[] }
  closing: {
    title: string
    text: string
    contactLabel: string
    /** Name zuerst, dann Funktion, Telefon, E-Mail — leere Einstellungen fallen weg. */
    contact: { name: string | null; role: string | null; lines: string[] }
    footerLines: [string, string]
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

  const pageOf = (page: number) => t('pageOf', { page, total: PAGE_COUNT })
  const createdOn = formatDate(input.createdAt, input.country)
  const enteredFirma = input.firma.trim() || null
  const address = `${COMPANY.name} · ${COMPANY.street} · ${COMPANY.city}`
  const web = 'www.coolin.at'
  const orNull = (value: string) => value.trim() || null
  const statusLabels = t.raw('software.statuses') as Record<SoftwareStatus, string>
  const modules = t.raw('software.modules') as {
    title: string
    status: SoftwareStatus
    text: string
  }[]

  return {
    pageOf,
    brand: { name: COMPANY.name, sub: t('brandSub') },
    headerFirma: enteredFirma,
    footer: { address, web },
    cover: {
      titleLine1: t('cover.titleLine1'),
      titleLine2: t('cover.titleLine2'),
      subtitle: t('cover.subtitle'),
      customerLabel: t('cover.customerLabel'),
      firma: enteredFirma,
      rows: [
        { label: t('cover.country'), value: tc(isAT ? 'countryAT' : 'countryDE') },
        { label: t('cover.createdAt'), value: createdOn },
      ],
    },
    page1: {
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
    },
    page2: {
      kicker: t('page2.kicker'),
      title: t('page2.title', { branche: branche.dative }),
      chartLabel: t('page2.chartLabel'),
      branchText: branche.text,
      general: t('page2.general'),
      leversTitle: t('page2.leversTitle'),
      levers: t.raw('page2.levers') as Lever[],
    },
    page3: {
      kicker: t('page3.kicker'),
      title: t('page3.title'),
      asOf: settings.tariffsAsOf.trim(),
      facts: t.raw(isAT ? 'page3.factsAT' : 'page3.factsDE') as Fact[],
      checklistTitle: t('page3.checklistTitle'),
      checklist: t.raw('page3.checklist') as string[],
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
    },
    software: {
      kicker: t('software.kicker'),
      title: t('software.title'),
      intro: t('software.intro'),
      modules: modules.map((m) => ({
        title: m.title,
        status: statusLabels[m.status],
        accent: m.status === 'available',
        text: m.text,
      })),
    },
    closing: {
      title: t('closing.title'),
      text: t('closing.text'),
      contactLabel: t('closing.contactLabel'),
      contact: {
        name: orNull(settings.contactName),
        role: orNull(settings.contactRole),
        lines: [settings.phone, settings.email].map((v) => v.trim()).filter(Boolean),
      },
      footerLines: [
        `${address} · ${web}`,
        t('closing.footerDoc', { date: createdOn, pageOf: pageOf(PAGE_COUNT) }),
      ],
    },
  }
}
