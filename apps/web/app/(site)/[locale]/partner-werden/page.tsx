import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { PartnerApplicationPage } from '@/components/partner/partner-application-page'
import { PARTNER_BEWERBUNG_HREF } from '@/lib/partner-application/config'
import { robotsFor } from '@/lib/routes'
import { pageAlternates } from '@/lib/seo'
import { createClient } from '@/lib/supabase/server'

/**
 * `/partner-werden` — die öffentliche Bewerbung eines Fachbetriebs (B16-3, Modell A).
 *
 * ── DER PFAD LIEGT AUSDRÜCKLICH NICHT UNTER `/partner/` ─────────────────────────────────────────
 * Dort sitzt seit B16-2 das dynamische Segment `[slug]` (die Landingpage eines aufgenommenen
 * Betriebs). Ein statisches Kindsegment machte den Slug dieses Namens für immer unerreichbar — und
 * zwar still: der betroffene Fachbetrieb bekäme einen Link, der auf eine ganz andere Seite führt,
 * und der Fehler fiele erst auf, wenn seine Serienmail bereits draussen ist.
 *
 * ── INDEXIERBAR UND IN DER SITEMAP ──────────────────────────────────────────────────────────────
 * Anders als die Landingpages, die `noindex` tragen. Der Grund dort — viele fast identische Seiten,
 * die sich nur im Firmennamen unterscheiden, sind aus Suchmaschinensicht Doorway Pages — trifft
 * hier nicht zu: Es gibt genau EINE Seite, mit eigenem Inhalt, und sie soll von suchenden
 * Fachbetrieben gefunden werden. `robotsFor` liest die Entscheidung aus `lib/routes.ts` — dem einen
 * Fundort, an dem auch die sitemap sie liest; die beiden können nicht auseinanderlaufen.
 *
 * ── KEIN ISR: DIE SEITE KENNT DIE SITZUNG ───────────────────────────────────────────────────────
 * `dynamic = 'force-dynamic'`. Wer angemeldet ist, bekommt kein Passwortfeld und sieht, mit welchem
 * Konto seine Bewerbung verknüpft wird. Eine zwischengespeicherte Fassung zeigte dem nächsten
 * Besucher die Adresse des vorigen — der teuerste denkbare Cache-Fehler dieser Seite. `/kontakt` und
 * `/warteliste` dürfen `revalidate` benutzen, weil sie keine Sitzung lesen.
 *
 * Die Adresse ist eine ANZEIGE, keine Zusicherung: Die Server Action liest die Sitzung noch einmal
 * selbst (`lib/partner-application/actions.ts`) — was der Browser schickt, entscheidet nichts.
 *
 * ── KEIN EINWILLIGUNGSWORTLAUT AUS `platform.consent_texts` ─────────────────────────────────────
 * Anders als `/kontakt`, `/warteliste` und `/vertragsende-erinnerung`: Eine Bewerbung erzeugt KEINE
 * Einwilligung. Rechtsgrundlage ist Vertragsanbahnung — dieselbe wie beim Kontaktformular und bei
 * der Registrierung (B10-5). Es gibt deshalb kein Ankreuzfeld für Werbung, keinen neuen
 * `consent_purpose` und nichts zu laden.
 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'PartnerBewerbung' })
  return {
    title: `${t('metaTitle')} — COOLiN ENERGY`,
    description: t('metaDescription'),
    alternates: pageAlternates(locale, PARTNER_BEWERBUNG_HREF),
    robots: robotsFor(PARTNER_BEWERBUNG_HREF),
  }
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  /*
   * Läuft eine Sitzung? Nur für die DARSTELLUNG (kein Passwortfeld, genannte Adresse). Ein
   * Lesefehler gilt als „nicht angemeldet": Dann erscheinen Adress- und Passwortfeld, und der
   * Bewerbungsweg funktioniert unverändert — die Action entscheidet ohnehin selbst.
   */
  let sessionEmail: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    sessionEmail = user?.email ?? null
  } catch (cause) {
    console.warn('[partner-application] Sitzung nicht lesbar — Formular rendert anonym:', cause)
  }

  return <PartnerApplicationPage sessionEmail={sessionEmail} />
}
