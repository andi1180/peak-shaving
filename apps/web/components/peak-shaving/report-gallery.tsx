import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Container, Eyebrow, Section } from '@/components/ui/layout'

/**
 * Galerie echter Report-Ansichten des Pro-Kalkulators (Pflichtenheft §5.2b).
 *
 * Ersetzt die zwei „Screenshot folgt"-Platzhalter (OP#7 — Assets sind geliefert).
 * Der alte `ScreenshotPlaceholder` ist damit tot und gelöscht; seine Regel gilt
 * weiter: hier steht KEIN gerendertes Fake-UI, sondern das echte Werkzeug.
 *
 * §9.5 — WAS DIESE BILDER SIND: vier Ansichten aus EINEM Report, gerechnet mit
 * dem **synthetischen Demo-Lastgang** des Kalkulators (die Bäckerei aus
 * `dev-fixtures/`), nicht mit den Daten eines realen Kunden. Genau das sagt der
 * Einordnungssatz unter dem Lead — sichtbar auf der Seite, nicht nur hier im
 * Code. Ohne ihn wären „€ 3.689 / Jahr" und „5,2 Jahre" eine Referenz-Behauptung.
 *
 * BILD-ZUORDNUNG (jedes Bild vor dem Bau angesehen, Zuordnung bestätigt):
 * Reihenfolge ist die des Reports von der Antwort zum Detail — Empfehlung →
 * Kostenverlauf → Jahres-Lastgang → einzelner Tag.
 */

type Shot = {
  key: string
  src: string
  /** Native Pixelmaße — Pflicht für next/image, hält den Platz frei (kein CLS). */
  width: number
  height: number
  /** Querformat: bekommt die volle Breite statt einer Rasterzelle (s. unten). */
  wide?: boolean
}

/**
 * Die vier Assets. Maße sind die ECHTEN Pixelmaße der Dateien (nachgemessen,
 * nicht geschätzt) — nur dann reserviert next/image exakt den richtigen Platz.
 *
 * Alle vier PNGs haben einen TRANSPARENTEN Hintergrund (Ecken geprüft: RGBA
 * 0,0,0,0). Deshalb sitzen sie auf `bg-surface` (weiß): Der freie Rand einer
 * Zelle ist derselbe weiße Kartengrund, den das Bild ohnehin durchscheinen
 * lässt — die Pillarbox der Hochformate ist dadurch unsichtbar.
 *
 * LAYOUT — warum 1 + 3 und nicht 2×2 (gemessen, nicht Geschmack):
 * Drei Bilder sind hochformatig (0,56 / 0,66 / 0,66), EINES ist querformatig
 * (1224×664 = 1,84). In einem 2×2-Raster teilt sich die Containerbreite auf
 * ~536 px je Spalte — der Jahres-Lastgang läuft damit auf 40 % seiner nativen
 * Breite und stand in der gemessenen Fassung mit 356 px totem Weißraum in
 * seiner Zelle: die Zelle wirkte leer, die Achsenbeschriftung war unlesbar.
 * Genau dieses Bild braucht Breite — es zeigt ein ganzes Jahr. Deshalb bekommt
 * es die volle Zeile (1120 px = 91 % nativ, gestochen) und die drei
 * Hochformate stehen darunter nebeneinander. Kein Loch im Raster, kein
 * geschrumpftes Bild. Auf Mobile/Tablet steht ohnehin alles einspaltig.
 */
const SHOTS: Shot[] = [
  {
    key: 'lastgang',
    src: '/images/kalkulator-report/lastgang-kapp-linie.png',
    width: 1224,
    height: 664,
    wide: true,
  },
  {
    key: 'empfehlung',
    src: '/images/kalkulator-report/speicher-empfehlung.png',
    width: 604,
    height: 1080,
  },
  {
    key: 'kostenvergleich',
    src: '/images/kalkulator-report/kostenvergleich-10-jahre.png',
    width: 676,
    height: 1024,
  },
  {
    key: 'energiefluss',
    src: '/images/kalkulator-report/tages-energiefluss.png',
    width: 676,
    height: 1028,
  },
]

export function ReportGallery() {
  const t = useTranslations('PeakShavingCalculator.Screens')
  const tPrivacy = useTranslations('PeakShavingCalculator.Privacy')

  return (
    <Section tone="alt">
      <Container>
        <Eyebrow>{t('eyebrow')}</Eyebrow>
        <h2 className="mt-3 max-w-prose text-h2 text-ink">{t('title')}</h2>
        <p className="mt-4 max-w-prose text-lead text-text-muted">{t('lead')}</p>

        {/*
         * EINORDNUNG (§9.5) — steht VOR den Bildern, nicht darunter: Wer die
         * Zahlen sieht, soll vorher wissen, dass sie aus einem Demo-Lauf stammen.
         * Kein „Referenzkunde", keine Behauptung über einen realen Betrieb.
         */}
        <p className="mt-4 max-w-prose text-caption text-text-muted">{t('disclaimer')}</p>

        <ul className="mt-10 grid gap-8 lg:grid-cols-3">
          {SHOTS.map((shot) => (
            <li key={shot.key} className={shot.wide ? 'lg:col-span-3' : undefined}>
              <figure className="flex h-full flex-col">
                <div
                  className={
                    shot.wide
                      ? /* Querformat: volle Zeile, natürliche Höhe. Kein Fenster —
                           das Bild IST hier so breit wie die Zeile. */
                        'overflow-hidden rounded-lg border border-line bg-surface p-4 sm:p-6'
                      : /*
                         * Hochformat: ab `lg` ein festes Fenster im
                         * Seitenverhältnis des HÖCHSTEN der drei Bilder
                         * (604×1080). Dadurch sind die drei Karten exakt gleich
                         * hoch und ihre Bildunterschriften stehen auf EINER
                         * Baseline, obwohl die Bilder 0,56 vs. 0,66 messen. Die
                         * beiden flacheren werden dabei nur oben/unten
                         * eingebettet (~97 px) — auf dem weißen Kartengrund
                         * unsichtbar, s. Transparenz-Hinweis oben.
                         *
                         * `object-contain` skaliert vollständig hinein, ohne zu
                         * beschneiden: Ein Screenshot, dem die Legende
                         * abgeschnitten wird, wäre eine falsche Aussage über den
                         * Report.
                         */
                        'overflow-hidden rounded-lg border border-line bg-surface p-4 lg:flex lg:aspect-[604/1080] lg:items-center lg:justify-center lg:p-5'
                  }
                >
                  <Image
                    src={shot.src}
                    alt={t(`shots.${shot.key}.alt`)}
                    width={shot.width}
                    height={shot.height}
                    /* Sagt dem Optimizer die ECHTE Anzeigebreite: sonst lädt er
                       die volle Viewport-Breite. Querformat = volle Zeile
                       (1120px), Hochformat = ein Drittel (~355px). */
                    sizes={
                      shot.wide
                        ? '(min-width: 1024px) 1120px, 100vw'
                        : '(min-width: 1024px) 355px, (min-width: 640px) 600px, 100vw'
                    }
                    /* Screenshots tragen Text und Achsenbeschriftungen; der
                       Default (75) verwischt die kleinen Ziffern sichtbar. */
                    quality={90}
                    className={
                      shot.wide
                        ? 'h-auto w-full'
                        : /* Einspaltig (< lg) auf die native Breite gedeckelt und
                             zentriert — sonst würde ein 604px-Screenshot auf einem
                             ~990px breiten Tablet-Container hochskaliert und
                             sichtbar unscharf. Ab `lg` füllt er sein Fenster. */
                          'mx-auto h-auto w-full max-w-[600px] lg:mx-0 lg:h-full lg:w-full lg:max-w-none lg:object-contain'
                    }
                  />
                </div>
                <figcaption className="mt-3 text-small text-text-muted">
                  <span className="font-semibold text-ink">{t(`shots.${shot.key}.label`)}</span>{' '}
                  {t(`shots.${shot.key}.caption`)}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>

        {/* Getönte Akzent-Fläche über das `*-subtle`-Token — KEIN /alpha auf
            var()-Hex-Tokens: Tailwind verwirft das still (DESIGN.md). */}
        <div className="mt-10 rounded-lg border border-accent-border bg-accent-subtle p-5 sm:p-6">
          <h3 className="text-h4 text-ink">{tPrivacy('title')}</h3>
          <p className="mt-2 max-w-prose text-small text-text">{tPrivacy('text')}</p>
        </div>
      </Container>
    </Section>
  )
}
