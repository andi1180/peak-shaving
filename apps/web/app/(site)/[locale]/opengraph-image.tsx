import fs from 'node:fs'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { routing } from '@/i18n/routing'

/** Eine Karte je Sprache — vorgerendert, damit sie kein Request-Pfad ist. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

/*
 * DAS OG-BILD DER SEITE (Pflichtenheft §6.3: „Ebenso Open-Graph-Tags
 * (Titel/Beschreibung/Bild) pro Seite").
 *
 * WARUM EINE DATEI FÜR ALLE SEITEN: Datei-basierte Metadaten vererben sich an
 * alle darunterliegenden Routen. Diese eine Datei gibt damit JEDER Seite ein
 * `og:image` — `og:title`/`og:description` bleiben dagegen seitenspezifisch
 * (Next füllt sie aus dem `title`/`description` der jeweiligen Seite, s.
 * `openGraph`-Block im Root-Layout). Genau die Aufteilung, die §6.3 verlangt:
 * gleiche Marke, eigener Text.
 *
 * WARUM SIE NEBEN DEM ROOT-LAYOUT LIEGT UND NICHT IN `app/` (gemessen, nicht
 * geraten): Next führt Metadaten SEGMENTWEISE zusammen und ersetzt dabei
 * verschachtelte Objekte, statt sie zu mischen. Läge die Datei in `app/`, würde
 * der `openGraph`-Block des Root-Layouts (`type`/`siteName`/`locale`) das daraus
 * erzeugte `images` VOLLSTÄNDIG überschreiben — die Seiten hätten dann still
 * gar kein `og:image` mehr (im Build genau so beobachtet). Im selben Segment wie
 * das Layout greift die Zusammenführung, und beides steht nebeneinander.
 * Nebeneffekt, der zur Struktur passt: Die Karte kennt ihre Locale.
 *
 * WARUM EINE GEZEICHNETE KARTE UND KEIN FOTO/LOGO-ASSET: Das hochauflösende
 * Original-Logo steht noch aus (§7.4/OP#7). Statt darauf zu warten (und bis
 * dahin gar kein Vorschaubild zu haben) trägt die Karte NUR die Wortmarke — die
 * ist gezeichnete Geometrie und braucht kein Asset. Kommt das Original, ist das
 * hier eine mögliche, aber keine nötige Baustelle.
 *
 * WARUM DIE WORTMARKE HIER NOCHMAL GEBAUT WIRD, statt `components/brand/
 * wordmark.tsx` zu importieren: Die Komponente ist ein SVG mit `<text>` und
 * `var(--color-*)`. Satori (die Engine hinter `next/og`) rendert weder
 * SVG-`<text>` noch CSS-Variablen — beides käme leer heraus. Übernommen sind
 * deshalb die REGELN und die vermessenen Metriken (s. WORDMARK unten), nicht
 * der Code. Ändert sich die Wortmarke, ändert sich diese Datei mit; die
 * Konstanten unten sagen, woran.
 */

export const alt = 'COOLiN ENERGY — Wir senken Ihre Leistungskosten, mit belastbaren Zahlen.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/*
 * FARBEN ALS HEX-LITERALE — die einzige Stelle im Projekt, an der das erlaubt
 * ist, und nur weil es keine Alternative gibt: Satori löst `var(--color-navy)`
 * nicht auf (es gibt kein Stylesheet und kein DOM). Werte 1:1 aus
 * `app/globals.css`; weicht dort ein Ton ab, muss er hier nachgezogen werden.
 */
const NAVY = '#18336f' // --color-navy — der Markengrund
const NODE = '#14b8a6' // --color-node — Teal 500, laut globals.css NUR für Emblem/
//                        Signature auf Navy. Die Karte IST so ein Navy-Grund.
const WHITE = '#ffffff' // --color-on-navy

/*
 * WORTMARKE — Variante A („Gestapelt"), dieselbe, die Header und Footer zeigen
 * (`components/layout/site-header.tsx` → `WordmarkA`). Seit Prompt 23 zweizeilig:
 * „COOLiN" oben (unverändert), „ENERGY" darunter, auf dieselbe Breite gestreckt.
 *
 * Die Zahlen sind die aus `components/brand/wordmark.tsx`, dort an Inters echten
 * Glyphen vermessen — hier nur von der 100er-Basis auf Em-Anteile umgerechnet,
 * damit sie mit jedem Schriftgrad mitskalieren:
 *   x-Höhe   1118/2048 = 0,5459 em  -> Höhe des i-Stamms (Stamm = x-Höhe bis Grundlinie)
 *   Versalh. 1490/2048 = 0,7275 em  -> der Knoten (0,68 em) überragt sie leicht,
 *                                      genau wie in der Komponente (NODE_CY)
 */
const STEM_H = 0.546 // i-Stamm: x-Höhe
const STEM_W = 0.11
const NODE_R = 0.09 // Knotenradius
const NODE_CY = 0.68 // Knotenmitte über der Grundlinie
const GAP_COOL_I = 0.08 // Abstände wie in wordmark.tsx (iX/nX)
const GAP_I_N = 0.09
const COOL_TRACK = -0.02

/*
 * Prompt 24: Größenhierarchie — COOLiN dominant, ENERGY kleiner + gestreckt
 * (dieselbe Korrektur wie in `wordmark.tsx`, hier für Satori nachgebaut).
 * COOLiN wird als GANZE Zeile (Text + i-Stamm + Knoten + N) um COOL_SCALE
 * vergrößert (`transform: scale()` auf den Zeile-1-Container) — alle an
 * fontSize=100 gemessenen Em-Anteile bleiben dadurch zueinander proportional,
 * ohne eine zweite Metrik zu erfinden. COOL_SCALE=1,2 entspricht exakt dem
 * COOL_SCALE aus wordmark.tsx.
 *
 * ZEILE 2 „ENERGY" — Satori kennt weder SVG-`<text textLength>` noch eine
 * Mess-API für gerendertes Textmaß (anders als der Browser bei wordmark.tsx).
 * Statt zu messen, wird deshalb GESTRECKT: `transform: scaleX()` auf einen
 * Container mit `transformOrigin: 'left'` — dieselbe Technik, die der Prompt
 * für Nicht-SVG-Kontexte vorschlägt.
 *
 * coolNWidthEm = Breite von "COOLiN" (COOL + i-Stamm-Lücken + N) BEI
 * Basis-Schriftgröße (COOL_SCALE=1), aus denselben gemessenen Advance-Breiten
 * wie wordmark.tsx (M.cool700/M.n700, dort durch 100 geteilt):
 * 2,7661 + 0,08 + 0,11 + 0,09 + 0,7422 = 3,7883 em. Die tatsächliche Zeilenbreite
 * nach der COOL_SCALE-Vergrößerung ist COOL_N_WIDTH_EM * COOL_SCALE — das ist
 * die neue Zielbreite für ENERGY.
 * ENERGY_SIZE=0,58 (reduziert von vorher 0,9, analog zu wordmark.tsx energySize
 * 76 vs. vorher 90) ist so gewählt, dass der nötige Stretch sichtbar, aber nicht
 * glyphenverzerrend bleibt. ENERGY_NATURAL_WIDTH_EM ist NICHT geschätzt, sondern
 * am tatsächlich gerenderten OG-Bild vermessen (Pixel-Breite von "ENERGY" ohne
 * Transform bei ENERGY_SIZE, gegen COOL_N_WIDTH_EM*COOL_SCALE skaliert) —
 * ENERGY_STRETCH ergibt sich daraus, kein Korrekturfaktor auf Verdacht.
 */
const COOL_SCALE = 1.2
const COOL_N_WIDTH_EM = 3.7883
const COOL_N_WIDTH_EM_SCALED = COOL_N_WIDTH_EM * COOL_SCALE
const ENERGY_SIZE = 0.58
const ENERGY_NATURAL_WIDTH_EM = 2.776
const ENERGY_STRETCH = COOL_N_WIDTH_EM_SCALED / ENERGY_NATURAL_WIDTH_EM
const ENERGY_OPACITY = 0.75
const LINE_GAP = 0.14 // Grundlinie COOLiN (skaliert) -> Versalhöhe ENERGY, in em

/*
 * Bei `lineHeight: 1` sitzt Inters Grundlinie 0,1362 em über der Unterkante der
 * Textbox (aus den Vertikalmetriken der Datei: (asc 1984 − desc −494)/2048 =
 * 1,2100 -> halbes Leading −0,1050; Grundlinie = 1984/2048 − 0,1050 = 0,8638 em
 * unter der Oberkante).
 *
 * Deshalb reicht `alignItems: 'flex-end'` NICHT, um Gezeichnetes auf die
 * Grundlinie zu setzen: flex-end richtet die BOXEN aus, und unter der Grundlinie
 * liegt noch die Unterlänge. Der i-Stamm bekommt den Versatz als `bottom`, das
 * kleinere „ENERGY" die Differenz seiner eigenen Unterlänge als `marginBottom` —
 * sonst hinge es unter der Zeile.
 */
const BASELINE_FROM_BOTTOM = 0.1362

function Wordmark({ fontSize: s }: { fontSize: number }) {
  /*
   * Prompt 24: Zeile 1 ("COOLiN") wird komplett mit sCool = s * COOL_SCALE
   * dimensioniert statt mit `s` — bewusst KEIN CSS-`transform: scale()` auf den
   * Zeile-1-Container: Satoris Flex-Layout reserviert für eine transformierte Box
   * weiter nur ihre UNSKALIERTE Größe, Zeile 2 würde also nicht nach unten
   * mitwandern, sondern von der vergrößerten Zeile 1 überlappt. Jede Em-Angabe
   * aus Zeile 1 (Schriftgröße, Lücken, i-Stamm, Knoten) mit sCool statt s zu
   * multiplizieren skaliert dagegen echte Layoutgrößen — Flex reflowt korrekt.
   */
  const sCool = s * COOL_SCALE
  const capText = {
    fontSize: sCool,
    fontWeight: 700,
    letterSpacing: COOL_TRACK * sCool,
    lineHeight: 1,
    color: WHITE,
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      {/* Zeile 1 — „COOLiN", textlich/Gewicht/Knotenfarbe unverändert, nur um
          COOL_SCALE vergrößert (Prompt 24). */}
      <div style={{ display: 'flex', alignItems: 'flex-end' }}>
        <div style={capText}>COOL</div>

        {/* Das „i" ist gezeichnet, kein Buchstabe (Regel aus wordmark.tsx): nur so
            sitzt der Knoten exakt und skaliert mit der Marke mit. */}
        <div
          style={{
            display: 'flex',
            position: 'relative',
            width: STEM_W * sCool,
            height: sCool,
            marginLeft: GAP_COOL_I * sCool,
            marginRight: GAP_I_N * sCool,
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: BASELINE_FROM_BOTTOM * sCool,
              width: STEM_W * sCool,
              height: STEM_H * sCool,
              borderRadius: (STEM_W * sCool) / 2,
              background: WHITE,
            }}
          />
          {/* Der i-Punkt IST ein Teal-Knoten aus dem Netz-Motiv — der Anker zum
              Emblem und der einzige Farbakzent der Karte. */}
          <div
            style={{
              position: 'absolute',
              bottom: (BASELINE_FROM_BOTTOM + NODE_CY - NODE_R) * sCool,
              left: STEM_W * sCool * 0.5 - NODE_R * sCool,
              width: NODE_R * 2 * sCool,
              height: NODE_R * 2 * sCool,
              borderRadius: NODE_R * sCool,
              background: NODE,
            }}
          />
        </div>

        <div style={capText}>N</div>
      </div>

      {/* Zeile 2 — „ENERGY", kleiner und gestreckt auf die Breite von Zeile 1
          (COOL_N_WIDTH_EM_SCALED). `transformOrigin: 'left'` hält die Streckung
          linksbündig zu Zeile 1. */}
      <div
        style={{
          display: 'flex',
          marginTop: LINE_GAP * sCool,
          transform: `scaleX(${ENERGY_STRETCH})`,
          transformOrigin: 'left',
        }}
      >
        <div
          style={{
            fontSize: ENERGY_SIZE * sCool,
            fontWeight: 400,
            lineHeight: 1,
            color: WHITE,
            opacity: ENERGY_OPACITY,
          }}
        >
          ENERGY
        </div>
      </div>
    </div>
  )
}

export default async function OpengraphImage({ params }: { params: { locale: string } }) {
  /*
   * Der Claim kommt aus den Messages, nicht als String hierher (§8.7) — es ist
   * derselbe Satz, den der Footer neben derselben Wortmarke zeigt
   * (`Brand.claim`). Die Buchstaben der Wortmarke selbst bleiben dagegen fest:
   * sie sind gezeichnete Marke, kein Text (genau wie in `wordmark.tsx`).
   *
   * Die Karte spricht damit die Sprache ihrer Locale — eine zweite Sprache
   * bekommt ihre eigene, ohne dass hier etwas umgebaut wird (§8.7).
   */
  const { locale } = params
  const messages = (await import(`../../../messages/${locale}.json`)).default
  const claim: string = messages.Brand.claim

  /*
   * Inter als echte Schriftdatei: Satori braucht Glyphen-Bytes und kann weder
   * `next/font` noch die von ihm erzeugten (hashbenannten, woff2-komprimierten)
   * Dateien lesen — woff2 versteht Satori grundsätzlich nicht.
   *
   * Die Dateien liegen deshalb IM REPO (`assets/fonts/`, s. dortige README):
   * selbst gehostet wie §7.4 es verlangt, ohne Netzabruf beim Bauen. `readFileSync`
   * + `process.cwd()` ist dasselbe Muster, mit dem `lib/wissen.ts` die Artikel
   * liest — die Route wird beim Bauen einmal vorgerendert, nicht pro Anfrage.
   */
  const fontDir = path.join(process.cwd(), 'assets', 'fonts')
  const [regular, bold] = [
    fs.readFileSync(path.join(fontDir, 'Inter-Regular.ttf')),
    fs.readFileSync(path.join(fontDir, 'Inter-Bold.ttf')),
  ]

  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        background: NAVY,
        // Kein Gradient, kein Schatten (§7.2) — flache Fläche, wie die
        // Navy-Sektionen der Seite.
        padding: 88,
        fontFamily: 'Inter',
      }}
    >
      <Wordmark fontSize={104} />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Akzent-Strich: die einzige Dekoration, und sie ist die Farbe der
              Marke — keine Fläche, kein Muster (DESIGN.md: „Farbe ist
              Information, kein Dekor"; hier trägt sie die Wiedererkennung). */}
        <div style={{ display: 'flex', width: 96, height: 4, background: NODE }} />
        <div
          style={{
            marginTop: 36,
            fontSize: 46,
            fontWeight: 400,
            lineHeight: 1.35,
            letterSpacing: -0.6,
            color: WHITE,
            // Der Claim ist die Aussage, die Wortmarke die Marke — der Claim
            // darf sie nicht überstrahlen.
            opacity: 0.88,
            maxWidth: 900,
          }}
        >
          {claim}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { name: 'Inter', data: regular, weight: 400, style: 'normal' },
        { name: 'Inter', data: bold, weight: 700, style: 'normal' },
      ],
    },
  )
}
