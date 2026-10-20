/*
 * PDF-Schnellreport: sieben A4-Seiten. Die Inhaltsseiten folgen dem Prototyp
 * (`docs/prototypes/schnellreport-prototyp.html`, CSS `.p-*`, `.tiles` …), Rahmen und
 * Überschriften dem Profi-Report (`frame.tsx`). Alle Texte kommen fertig aus
 * `buildSchnellreportContent`; hier steht keine Zeichenkette für den Leser.
 */
import { Document, Line, Page, Path, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import { DAY_LOAD, DAY_PEAK_THRESHOLD, type SchnellreportContent } from './content'
import {
  ClosingPage,
  CoverPage,
  FRAME_COLORS,
  FRAME_LAYOUT,
  PageFurniture,
  SCHNELLREPORT_FONT,
  type EmblemSource,
} from './frame'

// Wörtlich aus dem Prototyp (`:root`), deckungsgleich mit DESIGN.md.
const C = {
  navy: '#18336f',
  ink: '#0f172a',
  text: '#1e293b',
  muted: '#475569',
  faint: '#737373',
  accent: '#0f766e',
  accentSubtle: '#f0fdfa',
  surfaceAlt: '#f8fafc',
  border: '#e2e8f0',
  bar: '#cbd5e1',
  negative: '#b91c1c',
  negativeSubtle: '#fef2f2',
  negativeBorder: '#fecaca',
  white: '#ffffff',
} as const

const s = StyleSheet.create({
  page: {
    fontFamily: SCHNELLREPORT_FONT,
    fontSize: 10.5,
    lineHeight: 1.55,
    color: C.text,
    paddingTop: FRAME_LAYOUT.pageTop,
    paddingHorizontal: FRAME_LAYOUT.pageHorizontal,
    paddingBottom: FRAME_LAYOUT.pageBottom,
    flexDirection: 'column',
  },
  body: { flexGrow: 1, flexDirection: 'column', gap: 16 },
  kicker: {
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: 0.85,
    textTransform: 'uppercase',
    color: C.accent,
  },
  // Kapitel- und Zwischenüberschrift wie `h2`/`h3` des Profi-Reports (14 / 11,5 pt, ink).
  h1: { fontSize: 14, fontWeight: 700, color: FRAME_COLORS.ink, lineHeight: 1.25, marginTop: 3 },
  h2: { fontSize: 11.5, fontWeight: 700, color: FRAME_COLORS.ink },
  lead: { fontSize: 11.5, color: C.muted, marginTop: 6 },
  bold: { fontWeight: 700 },
  hero: {
    borderRadius: 10,
    backgroundColor: C.negativeSubtle,
    borderWidth: 1,
    borderColor: C.negativeBorder,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  heroValue: { fontSize: 30, fontWeight: 700, color: C.negative, lineHeight: 1.1 },
  heroCaption: { fontSize: 11, fontWeight: 600, color: C.ink, marginTop: 2 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tileLabel: {
    fontSize: 8,
    fontWeight: 600,
    letterSpacing: 0.64,
    textTransform: 'uppercase',
    color: C.faint,
  },
  tileValue: { fontSize: 16, fontWeight: 700, color: C.ink, marginTop: 2 },
  billbar: { flexDirection: 'row', height: 18, marginTop: 8 },
  billPeak: {
    backgroundColor: C.negative,
    borderTopLeftRadius: 5,
    borderBottomLeftRadius: 5,
  },
  billRest: {
    flexGrow: 1,
    backgroundColor: C.bar,
    borderTopRightRadius: 5,
    borderBottomRightRadius: 5,
  },
  billLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 9,
    color: C.muted,
    marginTop: 5,
  },
  legendValue: { fontWeight: 700, color: C.ink },
  tenbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tenValue: { fontSize: 17, fontWeight: 700, color: C.accent },
  tenText: { flex: 1 },
  small: { fontSize: 8.5, color: C.faint },
  levers: { flexDirection: 'column', gap: 10, marginTop: 6 },
  lever: { flexDirection: 'row', gap: 10 },
  leverNo: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.accentSubtle,
    borderWidth: 1,
    borderColor: C.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leverNoText: { fontSize: 10, fontWeight: 700, color: C.accent, lineHeight: 1 },
  leverTitle: { fontSize: 11, fontWeight: 700, color: C.ink },
  fact: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  factFirst: { borderTopWidth: 0 },
  factWhen: { width: 74, fontSize: 10, fontWeight: 700, color: C.navy },
  listRow: { flexDirection: 'row', gap: 9 },
  checkbox: {
    width: 11,
    height: 11,
    borderWidth: 1.3,
    borderColor: C.muted,
    borderRadius: 3,
    marginTop: 2,
  },
  offer: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 10,
  },
  price: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  priceValue: { fontSize: 26, fontWeight: 700, color: C.navy, lineHeight: 1.1 },
  priceNote: { fontSize: 10, color: C.muted, marginBottom: 3 },
  ctaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ctaBadge: {
    backgroundColor: C.accent,
    color: C.white,
    fontSize: 11,
    fontWeight: 600,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 7,
  },
  ctaNote: { flex: 1, fontSize: 9, color: C.faint },
  talk: { fontSize: 11.5, fontWeight: 600, color: C.ink },
  modules: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  module: {
    width: '48.5%',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6,
  },
  status: {
    alignSelf: 'flex-start',
    fontSize: 7.5,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    lineHeight: 1,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 4,
    color: C.muted,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
  },
  statusAccent: { color: C.accent, backgroundColor: C.accentSubtle, borderColor: C.accent },
})

function PageFrame({
  content,
  emblem,
  page,
  children,
}: {
  content: SchnellreportContent
  emblem: EmblemSource
  page: number
  children: ReactNode
}) {
  return (
    <Page size="A4" style={s.page}>
      <PageFurniture content={content} emblem={emblem} page={page} />
      <View style={s.body}>{children}</View>
    </Page>
  )
}

/** Statische Tageskurve aus dem Prototyp (`#dayBars`), viewBox 490 × 150. */
function DayCurve({ label }: { label: string }) {
  const step = 470 / 24
  return (
    <Svg viewBox="0 0 490 150" width="100%" height={150 * (491 / 490)}>
      <Line x1={10} x2={480} y1={135} y2={135} stroke={C.bar} strokeWidth={1} />
      {DAY_LOAD.map((v, h) => {
        const height = v * 125
        return (
          <Rect
            key={h}
            x={10 + h * step + 3}
            y={135 - height}
            width={step - 6}
            height={height}
            rx={2}
            fill={v >= DAY_PEAK_THRESHOLD ? C.negative : C.bar}
          />
        )
      })}
      <Line
        x1={10}
        x2={480}
        y1={58}
        y2={58}
        stroke={C.navy}
        strokeWidth={1.2}
        strokeDasharray="5 4"
      />
      <Text
        x={480}
        y={52}
        textAnchor="end"
        style={{ fontFamily: SCHNELLREPORT_FONT, fontSize: 9, fontWeight: 600 }}
        fill={C.navy}
      >
        {label}
      </Text>
    </Svg>
  )
}

function Tick() {
  return (
    <Svg viewBox="0 0 14 14" width={10} height={10} style={{ marginTop: 3 }}>
      <Path
        d="M2 7.5 L5.5 11 L12 3"
        stroke={C.accent}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}

export function SchnellreportDocument({
  content,
  emblem,
}: {
  content: SchnellreportContent
  emblem: EmblemSource
}) {
  const { page1, page2, page3, page4, software } = content
  const frame = { content, emblem }
  return (
    <Document title={`${page1.kicker} · ${page1.firma}`} author={content.brand.name}>
      <CoverPage {...frame} />

      <PageFrame {...frame} page={2}>
        <View>
          <Text style={s.kicker}>{page1.kicker}</Text>
          <Text style={s.h1}>{page1.title}</Text>
          <Text style={s.lead}>
            {page1.forPrefix}
            <Text style={s.bold}>{page1.firma}</Text>
            {page1.forRest}
          </Text>
        </View>
        <View style={s.hero}>
          <Text style={s.heroValue}>{page1.heroValue}</Text>
          <Text style={s.heroCaption}>{page1.heroCaption}</Text>
        </View>
        <View style={s.tiles}>
          {page1.tiles.map((tile) => (
            <View key={tile.label} style={s.tile}>
              <Text style={s.tileLabel}>{tile.label}</Text>
              <Text style={s.tileValue}>{tile.value}</Text>
            </View>
          ))}
        </View>
        {page1.bill && (
          <View>
            <Text style={s.h2}>{page1.bill.title}</Text>
            <View style={s.billbar}>
              <View style={[s.billPeak, { width: `${page1.bill.share.toFixed(1)}%` }]} />
              <View style={s.billRest} />
            </View>
            <View style={s.billLegend}>
              <Text>
                {page1.bill.totalLabel} <Text style={s.legendValue}>{page1.bill.totalValue}</Text>
              </Text>
              <Text>
                {page1.bill.peakLabel} <Text style={s.legendValue}>{page1.bill.peakValue}</Text>
                {' · '}
                <Text style={s.legendValue}>{page1.bill.percent}</Text>
              </Text>
            </View>
          </View>
        )}
        <View style={s.tenbox}>
          <Text style={s.tenValue}>{page1.tenValue}</Text>
          <Text style={s.tenText}>{page1.tenText}</Text>
        </View>
        <View>
          <Text style={[s.h2, { marginBottom: 6 }]}>{page1.meaningTitle}</Text>
          <Text>{page1.meaning}</Text>
        </View>
        <Text style={s.small}>{page1.source}</Text>
      </PageFrame>

      <PageFrame {...frame} page={3}>
        <View>
          <Text style={s.kicker}>{page2.kicker}</Text>
          <Text style={s.h1}>{page2.title}</Text>
        </View>
        <DayCurve label={page2.chartLabel} />
        <Text>{page2.branchText}</Text>
        <Text>{page2.general}</Text>
        <View>
          <Text style={s.kicker}>{page2.leversTitle}</Text>
          <View style={s.levers}>
            {page2.levers.map((lever, i) => (
              <View key={lever.title} style={s.lever}>
                <View style={s.leverNo}>
                  <Text style={s.leverNoText}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.leverTitle}>{lever.title}</Text>
                  <Text>{lever.text}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </PageFrame>

      <PageFrame {...frame} page={4}>
        <View>
          <Text style={s.kicker}>{page3.kicker}</Text>
          <Text style={s.h1}>{page3.title}</Text>
        </View>
        <View>
          {page3.facts.map((fact, i) => (
            <View key={fact.when} style={i === 0 ? [s.fact, s.factFirst] : s.fact}>
              <Text style={s.factWhen}>{fact.when}</Text>
              <Text style={{ flex: 1 }}>{fact.text}</Text>
            </View>
          ))}
        </View>
        <View>
          <Text style={[s.kicker, { marginBottom: 8 }]}>{page3.checklistTitle}</Text>
          <View style={{ gap: 7 }}>
            {page3.checklist.map((item) => (
              <View key={item} style={s.listRow}>
                <View style={s.checkbox} />
                <Text style={{ flex: 1 }}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
      </PageFrame>

      <PageFrame {...frame} page={5}>
        <View>
          <Text style={s.kicker}>{software.kicker}</Text>
          <Text style={s.h1}>{software.title}</Text>
          <Text style={s.lead}>{software.intro}</Text>
        </View>
        <View style={s.modules}>
          {software.modules.map((item) => (
            <View key={item.title} style={s.module}>
              <Text style={s.h2}>{item.title}</Text>
              <Text style={item.accent ? [s.status, s.statusAccent] : s.status}>
                {item.status}
              </Text>
              <Text>{item.text}</Text>
            </View>
          ))}
        </View>
      </PageFrame>

      <PageFrame {...frame} page={6}>
        <View>
          <Text style={s.kicker}>{page4.kicker}</Text>
          <Text style={s.h1}>{page4.title}</Text>
          <Text style={s.lead}>{page4.lead}</Text>
        </View>
        <View style={s.offer}>
          <View style={{ gap: 6 }}>
            {page4.offer.map((item) => (
              <View key={item} style={s.listRow}>
                <Tick />
                <Text style={{ flex: 1 }}>{item}</Text>
              </View>
            ))}
          </View>
          {page4.price && (
            <View style={s.price}>
              <Text style={s.priceValue}>{page4.price.value}</Text>
              {page4.price.note ? <Text style={s.priceNote}>{page4.price.note}</Text> : null}
            </View>
          )}
          <View style={s.ctaRow}>
            <Text style={s.ctaBadge}>{page4.cta}</Text>
            <Text style={s.ctaNote}>{page4.ctaNote}</Text>
          </View>
          <Text style={[s.small, { fontSize: 9 }]}>{page4.example}</Text>
        </View>
        <Text style={s.talk}>{page4.talk}</Text>
      </PageFrame>

      <ClosingPage {...frame} />
    </Document>
  )
}
