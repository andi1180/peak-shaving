import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Container } from '@/components/ui/layout'
import { Emblem } from '@/components/brand/emblem'
import { WordmarkA } from '@/components/brand/wordmark'
import { SignatureRule } from '@/components/brand/signature'
import { LEISTUNGEN_FLAT, BRANCHEN_FLAT, PEAK_SHAVING_FLAT, COMPANY } from '@/lib/nav'
import { cn } from '@/lib/utils'

const footerLink = cn(
  'text-small text-text-muted transition-colors hover:text-accent',
  'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
)

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-label uppercase text-ink">{title}</p>
      <ul className="mt-3 space-y-2">{children}</ul>
    </div>
  )
}

export function SiteFooter() {
  const t = useTranslations('Footer')
  const tNav = useTranslations('Nav')
  const tBrand = useTranslations('Brand')

  return (
    // bg-surface-subtle: derselbe Chrome-Grund wie der Header — Rahmen oben und
    // unten lesen als EIN Element, der Inhalt dazwischen bleibt neutral.
    // Fallback (DESIGN.md „Grünton"): zurück auf `bg-surface-alt`.
    <footer className="mt-auto border-t border-line bg-surface-subtle">
      <Container className="py-12">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          {/* Marken-Spalte */}
          <div className="lg:col-span-2">
            <Link
              href="/"
              aria-label={tNav('home')}
              className="inline-flex items-center gap-2.5 rounded-md text-navy outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Emblem className="h-7 w-7" />
              <WordmarkA className="h-5 w-auto" />
            </Link>

            <p className="mt-4 max-w-xs text-small text-text-muted">{tBrand('claim')}</p>

            {/*
             * SIGNATURE-MOTIV — der KANONISCHE Ort (DESIGN.md „Signature-Motiv").
             *
             * Genau hier, weil der Footer auf JEDER Seite läuft: dadurch trägt
             * jede Seite das Motiv genau 1× und es wird zur wiederkehrenden
             * Signatur — statt eines Einzelauftritts auf der Startseite, den
             * niemand als Wiedererkennung lesen kann. Die Regel „max. 1× pro
             * Seitenansicht" ist damit systemisch erfüllt, nicht pro Seite neu
             * verhandelt: wer anderswo einen Auftritt setzen will, muss diesen
             * hier entfernen.
             *
             * Ruhiger Abschluss der Markenspalte, in einer eigenen Zeile — es
             * läuft NIE hinter oder durch Text (DESIGN.md, Regel aus dem Bau).
             * `aria-hidden` steckt in der Komponente: reines Dekor.
             */}
            <SignatureRule className="mt-6 h-5 w-48 text-line-strong" />

            {/*
             * Adresse VERBATIM aus reference/coolin-legacy.html (Kontakt-Block).
             * <address> ist das korrekte Element für Kontaktdaten des Betreibers.
             */}
            <address className="mt-6 not-italic text-small text-text-muted">
              <p className="font-medium text-ink">{COMPANY.name}</p>
              <p className="mt-1">{COMPANY.street}</p>
              <p>{COMPANY.city}</p>
              <p className="mt-2">
                <a
                  href={`mailto:${COMPANY.email}`}
                  className={cn(footerLink, 'underline decoration-line-strong underline-offset-2')}
                >
                  {COMPANY.email}
                </a>
              </p>
            </address>
          </div>

          {/* Nav-Spalten */}
          <FooterCol title={t('colLeistungen')}>
            {LEISTUNGEN_FLAT.map((leaf) => (
              <li key={leaf.href}>
                <Link href={leaf.href} className={footerLink}>
                  {tNav(leaf.labelKey)}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/leistungen" className={footerLink}>
                {tNav('leistungenAll')}
              </Link>
            </li>
          </FooterCol>

          <div className="space-y-8">
            <FooterCol title={t('colPeakShaving')}>
              {PEAK_SHAVING_FLAT.map((leaf) => (
                <li key={leaf.href}>
                  <Link href={leaf.href} className={footerLink}>
                    {tNav(leaf.labelKey)}
                  </Link>
                </li>
              ))}
            </FooterCol>

            <FooterCol title={t('colBranchen')}>
              {BRANCHEN_FLAT.map((leaf) => (
                <li key={leaf.href}>
                  <Link href={leaf.href} className={footerLink}>
                    {tNav(leaf.labelKey)}
                  </Link>
                </li>
              ))}
            </FooterCol>
          </div>

          <FooterCol title={t('colUnternehmen')}>
            <li>
              <Link href="/wissen" className={footerLink}>
                {tNav('wissen')}
              </Link>
            </li>
            <li>
              <Link href="/ueber-uns" className={footerLink}>
                {tNav('ueberUns')}
              </Link>
            </li>
            <li>
              <Link href="/referenzen" className={footerLink}>
                {t('referenzen')}
              </Link>
            </li>
            <li>
              <Link href="/produkte" className={footerLink}>
                {t('produkte')}
              </Link>
            </li>
            <li>
              <Link href="/kontakt" className={footerLink}>
                {tNav('kontakt')}
              </Link>
            </li>
          </FooterCol>
        </div>

        {/* Abschlusszeile */}
        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-caption tabular-nums text-text-muted">
            {t('copyright', { year: 2026 })}
          </p>
          <ul className="flex items-center gap-5">
            <li>
              <Link href="/impressum" className={footerLink}>
                {t('impressum')}
              </Link>
            </li>
            <li>
              <Link href="/datenschutz" className={footerLink}>
                {t('datenschutz')}
              </Link>
            </li>
          </ul>
        </div>
      </Container>
    </footer>
  )
}
