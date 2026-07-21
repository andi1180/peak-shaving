import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { WartelistePage } from '@/components/leads/warteliste-page'
import { loadLeadCaptureTexts } from '@/lib/leads/capture-texts'
import { resolveWartelisteSource, wartelisteSegments } from '@/lib/leads/warteliste'

/**
 * `/warteliste/[quelle]` — dieselbe Warteliste unter einer anderen HERKUNFT (B3-4).
 *
 * Erlaubt ist zurzeit genau ein Segment: `wko` → `wko-postaktion-qr`, die Adresse des gedruckten
 * QR-Codes. Die Zuordnung liegt als Erlaubnisliste in `lib/leads/warteliste.ts`.
 *
 * ── ⚠ DAUERHAFTE ZUSAGE: `/warteliste/wko` STEHT AUF PAPIER ─────────────────────────────────────
 * Der Pfad ist als QR-Code auf einem Postbrief gedruckt und lässt sich nicht zurückrufen. Er darf
 * nie umbenannt, nie entfernt und nie auf eine andere Quelle umgehängt werden — auch nicht im Zuge
 * einer späteren Umstrukturierung der Seitenstruktur. Wird die Seite je inhaltlich ersetzt, muss
 * der Pfad bestehen bleiben und weiterleiten. Dieselbe Zusage steht in `DEPLOYMENT.md` (§5) und an
 * der Erlaubnisliste.
 *
 * ── EIN UNBEKANNTES SEGMENT LIEFERT 404 — KEINEN RÜCKFALL AUF DIE ORGANISCHE QUELLE ─────────────
 * Ein Rückfallwert stempelte eine falsche Herkunft auf eine echte Einwilligung, und die Herkunft ist
 * seit B1-1 Pflichtfeld (`leads.first_source_key`, unveränderlich) und die Grundlage jeder späteren
 * Segmentierung. Eine tote Route ist ein sichtbarer Fehler, eine falsch zugeordnete Einwilligung ein
 * unsichtbarer.
 *
 * ── `noindex` UND NICHT IN DER SITEMAP ──────────────────────────────────────────────────────────
 * Diese Seite ist inhaltlich fast identisch mit `/warteliste`; zwei indexierbare Fassungen desselben
 * Textes wären ein Duplikat, das beide Fassungen schwächt. Erreichbar bleibt sie selbstverständlich
 * — `noindex` ist keine Sperre, sondern eine Bitte an Suchmaschinen. Sie wird zudem NIRGENDS intern
 * verlinkt: sie existiert für den gedruckten Zugang.
 *
 * KEIN `alternates` (Canonical/hreflang): dieselbe Entscheidung wie bei der Rechner-Hülle (13a) —
 * beides sind Aussagen über eine Seite, die in den Index soll, und widersprechen einem `noindex`.
 * Deshalb steht die Route auch nicht in `lib/routes.ts`; sie ist ein dynamisches Segment und dort
 * als `DYNAMIC_TEMPLATES`-Eintrag geführt, damit der Abgleich mit der Platte sie kennt.
 */
export const revalidate = 3600

/** Nur die erlaubten Segmente werden vorgerendert; alles andere fällt unten in `notFound()`. */
export function generateStaticParams(): { quelle: string }[] {
  return wartelisteSegments().map((quelle) => ({ quelle }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; quelle: string }>
}): Promise<Metadata> {
  const { locale, quelle } = await params
  if (!resolveWartelisteSource(quelle)) return {}

  const t = await getTranslations({ locale, namespace: 'Warteliste' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    robots: { index: false, follow: true },
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; quelle: string }>
}) {
  const { locale, quelle } = await params
  setRequestLocale(locale)

  const sourceKey = resolveWartelisteSource(quelle)
  if (!sourceKey) notFound()

  const consentTexts = await loadLeadCaptureTexts(sourceKey, locale)

  return <WartelistePage sourceKey={sourceKey} consentTexts={consentTexts} />
}
