import { useTranslations } from 'next-intl'
import { CopyBlock } from './copy-block'

/**
 * DER MARKETING-INHALT DES PARTNER-PORTALS (B16-4b; mit B18-3 aus `partner-portal-page.tsx`
 * HERAUSGEZOGEN, nicht kopiert).
 *
 * Empfehlungslink, zwei Textvorlagen und der Platzhalter für die Auswertung — genau das, was ein
 * freigeschalteter Fachbetrieb hier findet. Inhaltlich unverändert; herausgezogen ist er, weil ihn
 * seit B18-3 ZWEI Rahmen zeigen: die Bestandsroute `/partner-portal` auf coolin.at (öffentlicher
 * Header, unverändert) und der Reiter „Marketing" im Portalbereich auf `partner.coolin.at`. Eine
 * zweite Fassung liefe auseinander — und diese Texte gehen unter dem NAMEN DES PARTNERS an dessen
 * Bestandskunden.
 *
 * ── ⚠ ES STEHT NICHTS ÜBER EINZELNE INTERESSENTEN DARIN ─────────────────────────────────────────
 * Keine Namen, keine Firmen, keine Anzahl, kein Status. Die namentliche Sicht setzt einen
 * Einwilligungszweck voraus, den es noch nicht gibt — ein Interessent hat eingewilligt, dass COOLiN
 * ihn kontaktiert, nicht dass ein dritter Betrieb seinen Namen zu sehen bekommt (B16-6, wartet auf
 * die juristische Prüfung). Auch die blosse ANZAHL fehlt bewusst: sie ist B16-5, dort wird die
 * Zählweise gesondert entschieden, und eine hier schnell hingeschriebene Zahl wäre die Zahl, an der
 * sich der Betrieb ab dem ersten Tag orientiert.
 *
 * Statt eines leeren Bereichs, der wie ein Defekt aussieht, steht ein Platzhalter-Hinweis: dass
 * Auswertungszahlen folgen und warum hier noch keine stehen. Eine erfundene Zahl wäre der einzige
 * Fehler, der schlimmer wäre als gar keine.
 *
 * ── ⚠ ARBEITSSTAND DER TEXTE ────────────────────────────────────────────────────────────────────
 * Gerüst und Formulierungen stammen aus dem Bau; die endgültigen kommen von Andreas/Martina. Die
 * Texte liegen unter `PartnerPortal.*` in `messages/de.json` und tragen dort einen Vermerk. Das
 * betrifft besonders die zwei VORLAGEN. Bindende Leitplanken für jede Neufassung — keine Preis-,
 * Ergebnis- oder Ersparnisversprechen, keine Zusage über die Bearbeitungsdauer, COOLiN tritt als
 * unabhängiger Prüfer auf und nicht als Verkäufer.
 *
 * SERVER-KOMPONENTE: `'use client'` ist nur das Kopierfeld (`CopyBlock`).
 */
export function PartnerMarketingContent({
  /** Anzeigename des Fachbetriebs — steht im Einleitungssatz. */
  companyName,
  /** Der VOLLSTÄNDIGE Empfehlungslink (`absoluteUrl`), nicht nur der Kurz-Key. */
  referralUrl,
}: {
  companyName: string
  referralUrl: string | null
}) {
  const t = useTranslations('PartnerPortal')

  const copyLabels = {
    button: t('copy.button'),
    copied: t('copy.copied'),
    copiedAnnounce: t('copy.copiedAnnounce'),
    failed: t('copy.failed'),
  }

  const templates = [
    {
      key: 'short' as const,
      label: t('templates.short.label'),
      subject: t('templates.short.subject'),
      body: t('templates.short.body', { link: referralUrl ?? '' }),
    },
    {
      key: 'long' as const,
      label: t('templates.long.label'),
      subject: t('templates.long.subject'),
      body: t('templates.long.body', { link: referralUrl ?? '' }),
    },
  ]

  return (
    <>
      <h1 className="text-h2 text-ink">{t('title')}</h1>
      <p className="mt-3 text-body text-text-muted">{t('intro', { company: companyName })}</p>

      <div className="mt-8 flex flex-col gap-4">
        <section className="rounded-lg border border-line bg-surface p-6">
          <h2 className="text-h4 text-ink">{t('link.title')}</h2>
          <p className="mt-1 text-small text-text-muted">{t('link.hint')}</p>
          <div className="mt-4">
            {referralUrl && <CopyBlock value={referralUrl} labels={copyLabels} />}
          </div>
        </section>

        <section className="rounded-lg border border-line bg-surface p-6">
          <h2 className="text-h4 text-ink">{t('templates.title')}</h2>
          <p className="mt-1 text-small text-text-muted">{t('templates.intro')}</p>

          <div className="mt-5 flex flex-col gap-6">
            {templates.map((template) => (
              <div key={template.key}>
                <h3 className="text-small font-semibold text-ink">{template.label}</h3>

                <p className="mt-3 text-caption text-text-muted">{t('templates.subjectLabel')}</p>
                <div className="mt-1">
                  <CopyBlock value={template.subject} labels={copyLabels} />
                </div>

                <p className="mt-4 text-caption text-text-muted">{t('templates.bodyLabel')}</p>
                <div className="mt-1">
                  <CopyBlock value={template.body} multiline labels={copyLabels} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/*
          Der Platzhalter — kein leerer Bereich, der wie ein Defekt aussieht, und keine erfundene
          Zahl. Die Zählweise entscheidet B16-5; bis dahin steht hier, dass hier bewusst nichts
          steht.
        */}
        <section className="rounded-lg border border-line bg-surface-sunken p-6">
          <h2 className="text-h4 text-ink">{t('stats.title')}</h2>
          <p className="mt-1 text-small text-text-muted">{t('stats.body')}</p>
        </section>
      </div>
    </>
  )
}
