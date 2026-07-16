import type { Metadata } from 'next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input, Textarea, Select, Label, FieldHint } from '@/components/ui/input'
import { Link } from '@/components/ui/link'
import { Container, Eyebrow, Num } from '@/components/ui/layout'
import { Emblem } from '@/components/brand/emblem'
import { SignatureRule, SignatureField } from '@/components/brand/signature'
import { WordmarkA, WordmarkB, WordmarkC, Lockup } from '@/components/brand/wordmark'

/*
 * /styleguide — reine REVIEW-Seite (Pflichtenheft §7: Design-System-Gate).
 * Kein Bestandteil der öffentlichen Navigation und kein Seiten-Content.
 * noindex, damit die Seite nie in den Index rutscht (§6.4).
 */
export const metadata: Metadata = {
  title: 'Styleguide — COOLiN ENERGY',
  description: 'Interne Design-System-Review. Nicht Teil der Website.',
  robots: { index: false, follow: false },
}

/* — Palette: exakt die Werte aus app/globals.css / DESIGN.md — */
const CORE_COLORS = [
  {
    name: 'Navy (Anker)',
    varName: '--color-navy',
    hex: '#18336f',
    role: 'Marke, Wortmarke, Emblem, tragende Flächen',
    contrast: '11,52:1 auf Off-White — AAA',
  },
  {
    name: 'Teal 700 (Akzent)',
    varName: '--color-accent',
    hex: '#0f766e',
    role: 'Der EINE Akzent: CTA, Links, aktive Zustände. Sparsam.',
    contrast: '5,47:1 auf Weiß — AA (nicht AAA → kein Fließtext)',
  },
  {
    name: 'Ink',
    varName: '--color-ink',
    hex: '#0f172a',
    role: 'Überschriften',
    contrast: '17,06:1 auf Off-White — AAA',
  },
  {
    name: 'Text',
    varName: '--color-text',
    hex: '#1e293b',
    role: 'Fließtext',
    contrast: '13,98:1 auf Off-White — AAA',
  },
  {
    name: 'Text muted',
    varName: '--color-text-muted',
    hex: '#475569',
    role: 'Sekundärtext, Captions',
    contrast: '7,24:1 auf Off-White — AAA',
  },
  {
    name: 'Off-White (Grund)',
    varName: '--color-surface-alt',
    hex: '#f8fafc',
    role: 'Seitengrund, abgesetzte Sektionen',
    contrast: 'Grundfläche — trägt die Werte oben',
  },
]

const SUPPORT_COLORS = [
  { name: 'Surface', varName: '--color-surface', hex: '#ffffff', role: 'Karten, Felder' },
  {
    name: 'Surface sunken',
    varName: '--color-surface-sunken',
    hex: '#f1f5f9',
    role: 'Zeilen, Hover',
  },
  { name: 'Border', varName: '--color-border', hex: '#e2e8f0', role: 'Dünne Ränder' },
  { name: 'Border strong', varName: '--color-border-strong', hex: '#cbd5e1', role: 'Feldränder' },
  {
    name: 'Accent subtle',
    varName: '--color-accent-subtle',
    hex: '#f0fdfa',
    role: 'Callout-Flächen',
  },
  { name: 'Node (Teal 500)', varName: '--color-node', hex: '#14b8a6', role: 'NUR Emblem/Signature' },
]

const SEMANTIC_COLORS = [
  {
    name: 'Positive',
    varName: '--color-positive',
    hex: '#15803d',
    role: 'Ersparnis',
    contrast: '5,02:1 auf Weiß — AA',
  },
  {
    name: 'Negative',
    varName: '--color-negative',
    hex: '#b91c1c',
    role: 'Kosten',
    contrast: '6,47:1 auf Weiß — AA',
  },
  {
    name: 'Warning',
    varName: '--color-warning',
    hex: '#b45309',
    role: 'Warnhinweis',
    contrast: '5,02:1 auf Weiß — AA',
  },
  {
    name: 'Positive subtle',
    varName: '--color-positive-subtle',
    hex: '#f0fdf4',
    role: 'Fläche hinter einer Ersparnis',
    contrast: 'Text darauf 4,79:1 — AA',
  },
  {
    name: 'Negative subtle',
    varName: '--color-negative-subtle',
    hex: '#fef2f2',
    role: 'Fläche hinter einem Kostenwert',
    contrast: 'Text darauf 5,91:1 — AA',
  },
  {
    name: 'Warning subtle',
    varName: '--color-warning-subtle',
    hex: '#fffbeb',
    role: 'Fläche hinter einer Warnung',
    contrast: 'Text darauf 4,84:1 — AA',
  },
]

const TYPE_SCALE = [
  { token: 'text-h1', px: '40 px / 650 / -0,022em', sample: 'Leistungstarif 2027 verstehen' },
  { token: 'text-h2', px: '30 px / 600 / -0,015em', sample: 'Was sich für Betriebe ändert' },
  { token: 'text-h3', px: '22 px / 600 / -0,01em', sample: 'Netzebenen und Leistungspreis' },
  { token: 'text-h4', px: '18 px / 600', sample: 'Messung und Abrechnung' },
]

function Swatch({
  name,
  varName,
  hex,
  role,
  contrast,
}: {
  name: string
  varName: string
  hex: string
  role: string
  contrast?: string
}) {
  return (
    <div className="flex gap-3">
      <div
        className="h-14 w-14 shrink-0 rounded-md border border-line"
        style={{ background: `var(${varName})` }}
      />
      <div className="min-w-0">
        <p className="text-small font-semibold text-ink">{name}</p>
        <p className="text-caption tabular-nums text-text-muted">
          {hex} · <code>{varName}</code>
        </p>
        <p className="mt-0.5 text-caption text-text-muted">{role}</p>
        {contrast ? <p className="mt-0.5 text-caption text-accent">{contrast}</p> : null}
      </div>
    </div>
  )
}

function Block({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-line py-12">
      <h2 className="text-h2 text-ink">{title}</h2>
      {hint ? <p className="mt-2 max-w-prose text-body text-text-muted">{hint}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  )
}

/** Rahmen für die zwei Entscheidungen, die Andreas hier trifft. */
function DecisionCallout({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-accent-border bg-accent-subtle p-4">
      <p className="text-label uppercase text-accent">Entscheidung {n}</p>
      <p className="mt-1 text-h4 text-ink">{title}</p>
      <div className="mt-1 max-w-prose text-small text-text">{children}</div>
    </div>
  )
}

export default function StyleguidePage() {
  return (
    <main className="bg-surface-alt pb-24">
      <Container>
        {/* Kopf */}
        <header className="py-12">
          <Eyebrow>Intern · nicht Teil der Website</Eyebrow>
          <h1 className="mt-2 text-h1 text-ink">Design-System</h1>
          <p className="mt-3 max-w-prose text-lead text-text-muted">
            Tokens, Typografie, Bausteine und Wortmarke von COOLiN ENERGY. Kern-Palette bewusst
            deckungsgleich mit dem Peak-Shaving-Kalkulator, damit der Übergang Marketing →
            Pro-Kalkulator wie ein Produkt wirkt. Zwei Punkte auf dieser Seite sind offen und von
            dir zu entscheiden.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <DecisionCallout n={1} title="Display-Schrift: ja oder nein?">
              Inter-only vs. Inter + Source Serif 4 für Überschriften. Vergleich unten im Abschnitt
              „Typografie".
            </DecisionCallout>
            <DecisionCallout n={2} title="Signature-Motiv: ja oder nein?">
              Netzlinien + Knoten als wiederkehrendes Element. Vorschau unten im Abschnitt
              „Signature-Motiv".
            </DecisionCallout>
          </div>
        </header>

        {/* — Palette — */}
        <Block
          title="Palette"
          hint="Ein Anker (Navy) + ein Akzent (Teal 700) + Off-White + Slate-Grau. Alle Werte sind CSS-Variablen; die Neutralen sind bewusst Slate (blaustichig), kein neutrales Grau. Kontraste unten sind gerechnet, nicht geschätzt."
        >
          <h3 className="text-h4 text-ink">Kern</h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CORE_COLORS.map((c) => (
              <Swatch key={c.varName} {...c} />
            ))}
          </div>

          <h3 className="mt-10 text-h4 text-ink">Flächen & Struktur</h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SUPPORT_COLORS.map((c) => (
              <Swatch key={c.varName} {...c} />
            ))}
          </div>

          <h3 className="mt-10 text-h4 text-ink">Semantisch — nur für Daten</h3>
          <p className="mt-1 max-w-prose text-small text-text-muted">
            Grün/Rot/Bernstein sind für Zahlen mit Bedeutung reserviert (Ersparnis / Kosten /
            Warnung). Nicht als Dekor verwenden — sonst verlieren sie ihre Signalwirkung.
          </p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {SEMANTIC_COLORS.map((c) => (
              <Swatch key={c.varName} {...c} />
            ))}
          </div>

          <div className="mt-8 rounded-lg border border-line bg-surface p-4">
            <p className="text-small font-semibold text-ink">Kontrast-Regel</p>
            <p className="mt-1 max-w-prose text-small text-text-muted">
              Teal 700 erreicht auf Weiß <Num>5,47:1</Num> — AA für Fließtext ist damit formal
              erfüllt, AAA (<Num>7:1</Num>) nicht. Fließtext läuft trotzdem in Navy/Slate: der
              Akzent bleibt so das seltene Signal und nicht die Grundfarbe. Teal für CTA, Links,
              aktive Zustände und große Elemente.
            </p>
            <p className="mt-3 max-w-prose text-small text-text-muted">
              <strong className="text-ink">Kein /alpha auf Token-Farben.</strong> Tailwind kann den
              Alpha-Modifier (<code>bg-positive/10</code>) nicht auf unsere <code>var()</code>
              -Hex-Tokens anwenden und verwirft ihn <em>still</em> — die Fläche bleibt transparent,
              ohne Fehlermeldung. Deshalb gibt es für getönte Flächen eigene{' '}
              <code>*-subtle</code>-Tokens.
            </p>
          </div>
        </Block>

        {/* — Typografie — */}
        <Block
          title="Typografie"
          hint="Inter für alles (Konsistenz mit dem Kalkulator, exzellente Zahlen-Lesbarkeit). Optional eine Display-Schrift NUR für Überschriften. Beides hier direkt nebeneinander."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Option 1 */}
            <Card>
              <CardHeader>
                <Badge variant="accent" className="w-fit">
                  Option 1 · Default
                </Badge>
                <CardTitle>Inter-only</CardTitle>
                <CardDescription>
                  Eine Schrift für alles. Ruhig, technisch, identisch zum Kalkulator. Kein zweiter
                  Font-Download.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {TYPE_SCALE.map((t) => (
                  <div key={t.token}>
                    <p className="text-caption tabular-nums text-text-muted">
                      {t.token} · {t.px}
                    </p>
                    <p className={`${t.token} text-ink`}>{t.sample}</p>
                  </div>
                ))}
                <div>
                  <p className="text-caption text-text-muted">text-body · 16 px</p>
                  <p className="max-w-prose text-body text-text">
                    Ab 2027 verschiebt die SNE-GV-Reform das Gewicht vom Arbeits- zum
                    Leistungspreis. Für Betriebe mit kurzen Lastspitzen ändert das die Rechnung
                    grundlegend.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Option 2 */}
            <Card>
              <CardHeader>
                <Badge variant="neutral" className="w-fit">
                  Option 2 · zu entscheiden
                </Badge>
                <CardTitle>Inter + Source Serif 4</CardTitle>
                <CardDescription>
                  Überschriften in Source Serif 4, Text und alle Zahlen weiter in Inter. Wirkt
                  redaktioneller — trägt die Fachartikel (Leistungstarif 2027).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {TYPE_SCALE.map((t) => (
                  <div key={t.token}>
                    <p className="text-caption tabular-nums text-text-muted">
                      {t.token} · font-display
                    </p>
                    <p className={`${t.token} font-display text-ink`}>{t.sample}</p>
                  </div>
                ))}
                <div>
                  <p className="text-caption text-text-muted">text-body · 16 px · Inter</p>
                  <p className="max-w-prose text-body text-text">
                    Ab 2027 verschiebt die SNE-GV-Reform das Gewicht vom Arbeits- zum
                    Leistungspreis. Für Betriebe mit kurzen Lastspitzen ändert das die Rechnung
                    grundlegend.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Kleinere Stufen + Zahlen */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Kleine Stufen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-lead text-text">text-lead · 18 px · Einleitungen</p>
                <p className="text-body text-text">text-body · 16 px · Fließtext</p>
                <p className="text-small text-text">text-small · 14 px · UI, Tabellen</p>
                <p className="text-caption text-text-muted">text-caption · 13 px · Quellen, Meta</p>
                <p className="text-label uppercase text-accent">text-label · 12 px · Eyebrow</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Zahlen: tabular-nums ist Pflicht</CardTitle>
                <CardDescription>
                  Bei allen Finanz- und Lastwerten (§7.4). Links proportional, rechts tabellarisch —
                  in der rechten Spalte stehen die Ziffern untereinander.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6 text-small">
                  <div>
                    <p className="mb-2 text-caption text-negative">falsch (proportional)</p>
                    <p className="text-ink">€ 11.480</p>
                    <p className="text-ink">€ 7.900</p>
                    <p className="text-ink">€ 2.700</p>
                  </div>
                  <div>
                    <p className="mb-2 text-caption text-positive">richtig (tabular-nums)</p>
                    <Num className="block text-ink">€ 11.480</Num>
                    <Num className="block text-ink">€ 7.900</Num>
                    <Num className="block text-ink">€ 2.700</Num>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </Block>

        {/* — Wortmarke — */}
        <Block
          title="Wortmarke"
          hint={
            '„COOLiN" kräftig, „ENERGY" leichter und gesperrt. Der i-Punkt ist in allen Varianten ein Teal-Knoten aus dem Emblem-Motiv — das ist die Klammer zwischen Zeichen und Schrift. Flach, kein Gradient. Schrift erbt currentColor, läuft also auch auf Navy.'
          }
        >
          <div className="space-y-4">
            {[
              {
                key: 'A',
                Comp: WordmarkA,
                name: 'Variante A — „Kompakt"',
                desc: 'COOLiN Bold (700), enges Tracking, ENERGY leicht (400) und gesperrt. Knoten als satter Punkt. Sachlichste, ruhigste Lesart.',
              },
              {
                key: 'B',
                Comp: WordmarkB,
                name: 'Variante B — „Knoten"',
                desc: 'COOLiN Semibold (600), der i-Punkt hängt sichtbar an einer Leitung und bekommt einen Halo-Ring — stärkster Bezug zum Emblem, erzählender. ENERGY schwerer (500), weiter gesperrt.',
              },
              {
                key: 'C',
                Comp: WordmarkC,
                name: 'Variante C — „Gestapelt"',
                desc: 'ENERGY exakt auf COOLiN-Breite gesperrt darunter. Kompakteste Grundfläche (schmale Header). i-Punkt als offener Ring — leiser.',
              },
            ].map(({ key, Comp, name, desc }) => (
              <Card key={key}>
                <CardHeader>
                  <CardTitle>{name}</CardTitle>
                  <CardDescription className="max-w-prose">{desc}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-0">
                  <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
                    <div className="flex items-center justify-center bg-surface p-6">
                      <Comp className="h-9 w-auto text-navy" />
                    </div>
                    <div className="flex items-center justify-center bg-navy p-6">
                      <Comp className="h-9 w-auto text-white" />
                    </div>
                    <div className="flex items-center justify-center bg-surface p-6">
                      <Comp className="h-9 w-auto text-ink" monochrome />
                    </div>
                  </div>
                  <p className="pt-2 text-caption text-text-muted">
                    links: Navy auf Weiß · Mitte: Weiß auf Navy (currentColor) · rechts:
                    einfarbig (<code>monochrome</code>, für 1-Farb-Druck/Gravur)
                  </p>
                  <div className="flex items-end gap-6 pt-4">
                    <Comp className="h-5 w-auto text-navy" />
                    <Comp className="h-7 w-auto text-navy" />
                    <Comp className="h-12 w-auto text-navy" />
                  </div>
                  <p className="pt-2 text-caption text-text-muted">
                    Skalierung: 20 / 28 / 48 px Höhe — prüft, ob der Knoten klein noch trägt.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Lockup */}
          <h3 className="mt-10 text-h4 text-ink">Lockup — Emblem + Wortmarke</h3>
          <p className="mt-1 max-w-prose text-small text-text-muted">
            Clear-Space = 0,5 × Emblemhöhe auf allen Seiten (gestrichelt angedeutet). Innerhalb
            dieser Zone steht nichts. Das Emblem ist eine <strong>Nachzeichnung</strong> der
            favicon.png — Platzhalter bis zum hochauflösenden Original (OP#7).
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {(['A', 'B', 'C'] as const).map((v) => (
              <Card key={v} className="flex items-center justify-center p-4">
                <Lockup variant={v} showClearSpace />
              </Card>
            ))}
          </div>
          <Card className="mt-4 flex items-center justify-center border-navy bg-navy p-4">
            <Lockup variant="A" inverse />
          </Card>
          <p className="mt-2 text-caption text-text-muted">
            Inversfassung für dunkle Gründe: heller Emblem-Grund, Navy-Linien, Wortmarke in Weiß.
            Der Teal-Knoten bleibt in beiden Fassungen gleich — er ist die Konstante der Marke.
          </p>
        </Block>

        {/* — Signature-Motiv — */}
        <Block
          title="Signature-Motiv"
          hint="Aus dem Emblem abgeleitet: dünne Netzlinien mit Knoten. Gedacht als seltenes Wiedererkennungs-Element (Sektionstrenner, ruhige Fläche hinter einer Navy-Sektion) — nicht als Muster über die ganze Seite. Aktuell nirgends verdrahtet; Einsatz ist Entscheidung 2."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Trenner</CardTitle>
                <CardDescription>Zwischen zwei Sektionen, statt einer nackten Linie.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="py-6">
                  <SignatureRule />
                </div>
                <p className="text-caption text-text-muted">
                  Linien in currentColor, nur die Knoten tragen den Akzent.
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Fläche</CardTitle>
                <CardDescription>Hinter einer Navy-Sektion, sehr niedrige Deckkraft.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative h-40 overflow-hidden rounded-md bg-navy">
                  <div className="absolute inset-0 text-white">
                    <SignatureField />
                  </div>
                  <div className="relative flex h-full items-center p-6">
                    <p className="max-w-xs text-h4 text-white">
                      Lastspitzen kosten mehr, als die meisten Betriebe glauben.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-8">
            <div className="text-center">
              <Emblem className="h-16 w-16" />
              <p className="mt-2 text-caption text-text-muted">Emblem (Nachzeichnung)</p>
            </div>
            <div className="text-center">
              <Emblem className="h-8 w-8" />
              <p className="mt-2 text-caption text-text-muted">32 px</p>
            </div>
            <div className="text-center">
              <Emblem className="h-5 w-5" />
              <p className="mt-2 text-caption text-text-muted">20 px (Favicon-Nähe)</p>
            </div>
          </div>
        </Block>

        {/* — Bausteine — */}
        <Block
          title="Bausteine"
          hint="Nur Primitives. Flache Flächen, dünne Ränder statt Schlagschatten, sichtbarer Tastatur-Fokus (mit Tab durchgehen!). Keine Gradienten."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Buttons */}
            <Card>
              <CardHeader>
                <CardTitle>Button</CardTitle>
                <CardDescription>
                  Primär = Teal-Akzent (sparsam, ein CTA pro Ansicht). Sekundär = Navy-Kontur. Ghost
                  = textnah.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary">Analyse starten</Button>
                  <Button variant="secondary">Mehr erfahren</Button>
                  <Button variant="ghost">Abbrechen</Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" size="sm">
                    Klein
                  </Button>
                  <Button variant="primary" size="md">
                    Standard
                  </Button>
                  <Button variant="primary" size="lg">
                    Groß
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" disabled>
                    Deaktiviert
                  </Button>
                  <Button variant="secondary" disabled>
                    Deaktiviert
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Links + Badges */}
            <Card>
              <CardHeader>
                <CardTitle>Link & Badge</CardTitle>
                <CardDescription>
                  Links im Fließtext sind unterstrichen — Farbe allein darf nicht das einzige
                  Merkmal sein (WCAG 1.4.1).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="max-w-prose text-body text-text">
                  Die Reform der{' '}
                  <Link href="/styleguide">Systemnutzungsentgelte tritt 2027 in Kraft</Link> und
                  betrifft jeden Betrieb mit Leistungsmessung.
                </p>
                <div className="flex flex-wrap items-center gap-4">
                  <Link href="/styleguide" variant="standalone">
                    Zum Schnellrechner
                  </Link>
                  <Link href="/styleguide" variant="quiet">
                    Impressum
                  </Link>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Badge>Neutral</Badge>
                  <Badge variant="accent">Akzent</Badge>
                  <Badge variant="navy">Navy</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="positive">− 2.700 €/Jahr</Badge>
                  <Badge variant="negative">+ 11.480 €</Badge>
                  <Badge variant="warning">Betonsockel nötig</Badge>
                </div>
                <p className="text-caption text-text-muted">
                  Die untere Reihe ist semantisch: nur für Zahlen mit Bedeutung, nie als Dekor.
                </p>
              </CardContent>
            </Card>

            {/* Formular */}
            <Card>
              <CardHeader>
                <CardTitle>Eingabe</CardTitle>
                <CardDescription>
                  Alle Felder 16 px — kleiner zoomt iOS beim Fokus hinein. Select ist bewusst nativ.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="sg-firma">Firma</Label>
                  <Input id="sg-firma" placeholder="Bäckerei Muster GmbH" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-mail">E-Mail</Label>
                  <Input id="sg-mail" type="email" defaultValue="keine-mail" aria-invalid="true" aria-describedby="sg-mail-err" />
                  <FieldHint tone="error">
                    <span id="sg-mail-err">Bitte eine vollständige E-Mail-Adresse eingeben.</span>
                  </FieldHint>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-netz">Netzbetreiber</Label>
                  <Select id="sg-netz" defaultValue="wn">
                    <option value="wn">Wiener Netze</option>
                    <option value="noe">Netz Niederösterreich</option>
                    <option value="sbg">Salzburg Netz</option>
                  </Select>
                  <FieldHint>Steht auf der ersten Seite deiner Netzrechnung.</FieldHint>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-text">Nachricht</Label>
                  <Textarea id="sg-text" placeholder="Worum geht es?" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-off">Deaktiviert</Label>
                  <Input id="sg-off" defaultValue="Nicht editierbar" disabled />
                </div>
              </CardContent>
            </Card>

            {/* Flächen */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Karte</CardTitle>
                  <CardDescription>
                    Dünner Rand, kein Schlagschatten. Tiefe entsteht über die Fläche, nicht über
                    Schatten.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-line bg-surface-sunken p-4">
                    <p className="text-small text-text">
                      Abgesetzte Fläche (<code>surface-sunken</code>) innerhalb einer Karte.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <div className="rounded-lg border border-accent-border bg-accent-subtle p-5">
                <Eyebrow>Callout</Eyebrow>
                <p className="mt-1 text-body text-text">
                  Akzent-Fläche für Hinweise. Bleibt selten — sonst verliert der Akzent seine
                  Wirkung.
                </p>
              </div>

              <div className="rounded-lg bg-navy p-5 text-navy-foreground">
                <Eyebrow className="text-node">Navy-Fläche</Eyebrow>
                <p className="mt-1 text-body">
                  Tragende Ankerfläche. Weiß auf Navy: <Num>12,06:1</Num> — AAA.
                </p>
                <div className="mt-4 flex gap-3">
                  <Button variant="primary">Primär auf Navy</Button>
                  <Button
                    variant="secondary"
                    className="border-white/30 bg-transparent text-white hover:bg-white/10"
                  >
                    Sekundär auf Navy
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Raster */}
          <h3 className="mt-10 text-h4 text-ink">Raster & Radius</h3>
          <div className="mt-4 grid gap-6 sm:grid-cols-2">
            <Card>
              <CardContent className="pt-5">
                <p className="mb-3 text-small font-medium text-ink">Spacing — 4er-Raster</p>
                <div className="space-y-2">
                  {[
                    ['1', 4],
                    ['2', 8],
                    ['3', 12],
                    ['4', 16],
                    ['6', 24],
                    ['8', 32],
                    ['12', 48],
                  ].map(([token, px]) => (
                    <div key={token} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-caption tabular-nums text-text-muted">
                        {token} · {px}px
                      </span>
                      <div className="h-3 rounded-sm bg-accent" style={{ width: `${px}px` }} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <p className="mb-3 text-small font-medium text-ink">Radius</p>
                <div className="flex flex-wrap items-end gap-4">
                  {[
                    ['sm · 4px', 'rounded-sm'],
                    ['md · 6px', 'rounded-md'],
                    ['lg · 8px', 'rounded-lg'],
                  ].map(([label, cls]) => (
                    <div key={cls} className="text-center">
                      <div className={`h-14 w-14 border border-line-strong bg-surface ${cls}`} />
                      <p className="mt-1 text-caption tabular-nums text-text-muted">{label}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-4 max-w-prose text-caption text-text-muted">
                  Bewusst zurückhaltend. Die einzige stark gerundete Form ist das Emblem — dort ist
                  die Rundung Teil der Marke, nicht Geschmack.
                </p>
              </CardContent>
            </Card>
          </div>
        </Block>
      </Container>
    </main>
  )
}
