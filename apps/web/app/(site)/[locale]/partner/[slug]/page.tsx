import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PartnerLandingPage } from '@/components/partner/partner-landing-page'
import { normalizePartnerSlug } from '@/lib/leads/partner'
import { getActiveConsentText, getActivePartner } from '@/lib/leads/store'

/**
 * `/partner/[slug]` — die Landingpage eines Fachbetriebs (B16-2, Modell A).
 *
 * Ein Fachbetrieb verweist seine eigenen Bestandskunden über einen personalisierten Link an COOLiN.
 * COOLiN führt Analyse und Kundenbeziehung; der Partner bekommt das erste Zugriffsrecht auf die
 * Montage. Die Attribution läuft AUSSCHLIESSLICH über diesen Pfad und ein Formularfeld auf
 * `/kontakt` — kein Cookie, kein localStorage, kein sessionStorage (§165 TKG; eine Speicherung auf
 * dem Endgerät brächte einen Cookie-Banner für die gesamte Domain und beendete die bestehende,
 * cookielose Analytics-Architektur).
 *
 * ── DREI FÄLLE, EINE ANTWORT: 404 ────────────────────────────────────────────────────────────────
 * Unbekannter Slug, STILLGELEGTER Partner, formatverletzender Slug (Unterstrich, Grossbuchstaben,
 * zu lang). Keine Ersatzseite, keine Weiterleitung auf `/kontakt`.
 *
 * Der stillgelegte Fall ist der interessante: Eine Deaktivierung IST die Ansage, dass die Links
 * dieses Fachbetriebs nicht mehr wirken sollen (`admin_set_partner_active`, B16-1 — es gibt bewusst
 * keinen Löschweg). Eine freundliche Ersatzseite („dieser Partner arbeitet nicht mehr mit uns")
 * verriete zudem die Existenz einer beendeten Geschäftsbeziehung an jeden, der Slugs durchprobiert.
 * Und eine Weiterleitung auf `/kontakt` machte aus einem toten Link eine funktionierende Seite —
 * der Fehler in einer bereits verschickten Serienmail fiele dann nie auf.
 *
 * Die Unterscheidung liegt gar nicht hier: `public.get_active_partner` findet einen inaktiven
 * Partner nicht (dieselbe Lesart wie `public.capture_lead` seit B16-1), diese Route kann den
 * dritten Zustand also nicht einmal erfinden.
 *
 * ── DER 404-NACHWEIS GEHÖRT AUF DAS SLUG-SEGMENT, NICHT DARUNTER ─────────────────────────────────
 * Unterhalb eines dynamischen Segments antwortet JEDES erfundene Segment gleich — ein „307 statt
 * 404" auf `/partner/erfunden/irgendwas` beweist deshalb nichts. Gemessen wird direkt auf
 * `/partner/<slug>`.
 *
 * ── `noindex, nofollow` UND NICHT IN DER SITEMAP ─────────────────────────────────────────────────
 * Viele fast identische Seiten, die sich nur im Firmennamen unterscheiden, sind aus
 * Suchmaschinensicht Doorway Pages und beschädigen die organische Sichtbarkeit der echten
 * Inhaltsseiten. Diese Seiten sind für den Direktlink aus der Partner-Mail gedacht, nicht für die
 * Suche. `nofollow` zusätzlich zu `noindex` (anders als `/warteliste/[quelle]`, das `follow`
 * behält): Es gibt nichts zu vererben — die Seite verlinkt nichts, was nicht ohnehin aus der
 * Navigation erreichbar wäre.
 *
 * KEIN `alternates` (Canonical/hreflang): dieselbe Entscheidung wie bei der Rechner-Hülle (13a) und
 * bei `/warteliste/[quelle]` — beides sind Aussagen über eine Seite, die in den Index soll, und
 * widersprechen einem `noindex`. In `lib/routes.ts` steht die Route deshalb als
 * `DYNAMIC_TEMPLATES`-Eintrag (damit `assertRoutesMatchDisk()` sie kennt) und NICHT in
 * `SITE_ROUTES` — nur was dort steht, kann in die sitemap geraten.
 *
 * ── KEIN VORRENDERN, KEIN ISR ───────────────────────────────────────────────────────────────────
 * Anders als `/warteliste/[quelle]` gibt es hier keine Erlaubnisliste im Code: Fachbetriebe entstehen
 * im laufenden Betrieb über den Admin-Bereich. `dynamic = 'force-dynamic'` ist deshalb keine
 * Bequemlichkeit, sondern eine Anforderung: Wird ein Partner stillgelegt, muss seine Seite AB DIESEM
 * MOMENT 404 antworten. Eine zwischengespeicherte Fassung lieferte sie weiter aus — und zwar
 * ausgerechnet dann, wenn jemand die Zusammenarbeit ausdrücklich beendet hat.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'Partner' })

  /*
   * Der Firmenname steht bewusst NICHT im Titel — obwohl er auf der Seite steht und dort richtig
   * ist. `generateMetadata` läuft für jeden Aufruf, auch für einen erfundenen Slug; ein Titel mit
   * Namen verlangte einen zweiten Datenbankaufruf (die Seite selbst macht ihren eigenen), und der
   * Titel einer nicht indexierten Seite erfüllt keinen Zweck, für den sich das lohnte.
   */
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    robots: { index: false, follow: false },
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  /*
   * Die Formprüfung VOR der Datenbank: ein Slug mit Unterstrich oder Grossbuchstaben kann per
   * Konstruktion nicht gespeichert sein (CHECK `^[a-z0-9-]+$` auf `platform.partners.slug`). Ihn
   * trotzdem nachzuschlagen wäre ein Aufruf, dessen Ergebnis feststeht — und ein offener Weg, die
   * Datenbank mit beliebig langen Zeichenketten zu beschäftigen.
   */
  const normalized = normalizePartnerSlug(slug)
  if (!normalized) notFound()

  /*
   * KEIN try/catch: Ein Lesefehler ist etwas anderes als „diesen Partner gibt es nicht", und ein
   * `notFound()` im Fehlerfall verwandelte einen Ausfall in eine falsche Auskunft. Ein geworfener
   * Fehler landet in der Fehlerseite und im Log — sichtbar, statt still.
   */
  const partner = await getActivePartner(normalized)
  if (!partner) notFound()

  /*
   * FAIL-CLOSED wie auf `/kontakt` (B1-2): Ohne den Wortlaut aus `platform.consent_texts` rendert
   * das Formular die Ankreuzmöglichkeit NICHT. Ohne Wortlaut darf keine Einwilligung eingesammelt
   * werden — und die Anfrage selbst hängt nicht daran.
   */
  let marketingConsentText: string | null = null
  try {
    marketingConsentText = (await getActiveConsentText('marketing_email', locale))?.body ?? null
  } catch (cause) {
    console.warn(
      '[leads] Einwilligungstext für die Partner-Landingpage nicht lesbar — die freiwillige ' +
        'Ankreuzmöglichkeit wird ausgelassen:',
      cause,
    )
  }

  return (
    <PartnerLandingPage
      partnerName={partner.displayName}
      partnerSlug={partner.slug}
      marketingConsentText={marketingConsentText}
    />
  )
}
