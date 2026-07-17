import { useTranslations } from 'next-intl'
import { Container, Eyebrow, Section } from '@/components/ui/layout'
import { KontaktCta } from '@/components/home/kontakt-cta'
import { COMPANY } from '@/lib/nav'
import { TEAM } from '@/lib/team'

/**
 * /ueber-uns (Pflichtenheft §11) — bespoke Seite, NICHT über das Leistungs- oder
 * Branchen-Template. Aufbau: Hero → Mission → Team → Prinzipien → Firmensitz →
 * Kontakt-CTA (Prompt 20).
 *
 * Struktur (Reihenfolge, Team-IDs, Initialen) kommt aus `lib/team.ts`; ALLE
 * sichtbaren Texte aus `messages/de.json` (`UeberUns`, §8.7). Der Firmensitz
 * liest die EINE `COMPANY`-Konstante (`lib/nav.ts`) — keine zweite Adress-Quelle
 * im Repo (dieselbe Regel wie beim JSON-LD/§6.4).
 *
 * KEIN Signature-Motiv: kanonischer Ort ist der Footer (DESIGN.md), der hier
 * bereits läuft.
 */
export function UeberUnsPage() {
  return (
    <>
      <HeroSection />
      <MissionSection />
      <TeamSection />
      <PrinzipienSection />
      <FirmensitzSection />
      {/* Wiederverwendeter Startseiten-CTA: eine „Über uns"-Seite hat kein Thema
          zum Vorwählen — deshalb der nackte `/kontakt` (s. `kontakt-cta.tsx`). */}
      <KontaktCta />
    </>
  )
}

/** Hero: Eyebrow + H1 + Intro, einspaltig — wie auf den übrigen Seiten (§5.1). */
function HeroSection() {
  const t = useTranslations('UeberUns')
  return (
    <Container className="py-16 sm:py-24">
      <Eyebrow>{t('eyebrow')}</Eyebrow>
      <h1 className="mt-3 max-w-prose text-h1 text-ink">{t('title')}</h1>
      <p className="mt-5 max-w-prose text-lead text-text">{t('intro')}</p>
    </Container>
  )
}

/** Mission: Headline + zwei Absätze — Ton über Hierarchie (erster Absatz führt). */
function MissionSection() {
  const t = useTranslations('UeberUns.mission')
  const paragraphs = t.raw('text') as string[]
  return (
    <Section tone="alt">
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('title')}</h2>
        <div className="mt-5 max-w-prose space-y-4 text-body text-text-muted">
          {paragraphs.map((p, i) => (
            <p key={p} className={i === 0 ? 'text-lead text-text' : undefined}>
              {p}
            </p>
          ))}
        </div>
      </Container>
    </Section>
  )
}

/** Team: 3 Karten mit Initialen-Platzhalter (KEIN Foto), Name, Rolle, Bio. */
function TeamSection() {
  const t = useTranslations('UeberUns.team')
  return (
    <Section>
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('title')}</h2>
        <ul className="mt-10 grid gap-6 md:grid-cols-3">
          {TEAM.map((member) => (
            <li key={member.id} className="h-full">
              <div className="flex h-full flex-col rounded-lg border border-line bg-surface p-6">
                {/*
                 * Foto-Platzhalter: Initialen auf Markengrund (Navy), klar als
                 * Platzhalter erkennbar — KEIN Stock-Foto, kein generisches
                 * Personen-Icon, das ein echtes Foto vortäuscht. Ein echtes Foto
                 * ersetzt später nur diese Darstellung (analog OP#7).
                 */}
                <div
                  aria-hidden="true"
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-navy text-h4 font-semibold tracking-wide text-white"
                >
                  {member.initials}
                </div>
                <h3 className="mt-5 text-h4 text-ink">{t(`${member.id}.name`)}</h3>
                <p className="mt-1 text-small font-medium uppercase tracking-wide text-accent">
                  {t(`${member.id}.role`)}
                </p>
                <p className="mt-3 text-small text-text-muted">{t(`${member.id}.bio`)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}

/** Prinzipien: Headline + 3 Karten (Titel + Text). Eigenständige Formulierung,
 *  keine 1:1-Dopplung des Startseiten-Blocks „So arbeiten wir". */
function PrinzipienSection() {
  const t = useTranslations('UeberUns.prinzipien')
  const items = t.raw('items') as { title: string; text: string }[]
  return (
    <Section tone="alt">
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('title')}</h2>
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {items.map((item) => (
            <li key={item.title} className="h-full">
              <div className="flex h-full flex-col rounded-lg border border-line bg-surface p-5">
                <h3 className="text-h4 text-ink">{item.title}</h3>
                <p className="mt-2 text-small text-text-muted">{item.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  )
}

/**
 * Firmensitz: NUR bestätigte Felder (Name + Adresse) aus der `COMPANY`-Konstante.
 * KEINE Rechtsform/UID/Firmenbuchnummer (OP#13 unbestätigt) — gleiche
 * Zurückhaltung wie beim LocalBusiness-JSON-LD (§6.4).
 *
 * KEIN Karten-Embed (Cookie-/Privacy-Grund, §9.3 — ein Google-Maps-iframe würde
 * das „kein Cookie-Banner"-Versprechen unterlaufen). Nur ein reiner Link nach
 * Google Maps, dessen Such-Query aus DERSELBEN `COMPANY`-Adresse gebaut wird —
 * kein zweiter Adress-String im Code.
 */
function FirmensitzSection() {
  const t = useTranslations('UeberUns.sitz')

  const mapsQuery = encodeURIComponent(
    `${COMPANY.street}, ${COMPANY.address.postalCode} ${COMPANY.address.locality}, ${COMPANY.address.countryName}`,
  )
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`

  return (
    <Section>
      <Container>
        <h2 className="max-w-prose text-h2 text-ink">{t('title')}</h2>
        <address className="mt-5 not-italic text-body text-text-muted">
          <span className="block font-medium text-ink">{COMPANY.name}</span>
          <span className="block">{COMPANY.street}</span>
          <span className="block">{COMPANY.city}</span>
        </address>
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-small font-medium text-accent underline-offset-4 hover:underline"
        >
          {t('mapsLabel')}
        </a>
      </Container>
    </Section>
  )
}
