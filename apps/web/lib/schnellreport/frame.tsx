/*
 * Rahmen des Schnellreports im Look des Profi-Reports: Deckblatt, Abschlussblatt, Kopf- und
 * Fusszeile der Innenseiten. Übernommen aus `apps/website/lib/pdf-report/document.tsx`
 * (`Cover`, `Outro`, `NavyLockup`, `PageFurniture`) und `theme.ts` (`PDF_COLORS`, `PDF_TYPE`,
 * `PDF_LAYOUT`) — kopiert statt geteilt, weil `apps/website` eine eigene App ohne Abhängigkeit
 * von `apps/web` ist und der Profi-Report beim Verschieben nicht unverändert bliebe.
 * Ändert sich dort Mass oder Farbe, hier nachziehen.
 */
import { Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'
import type { SchnellreportContent } from './content'

export const SCHNELLREPORT_FONT = 'Inter'

/** Das Emblem, von `render.ts` aus `public/brand/coolin-emblem.png` gelesen. */
export type EmblemSource = { data: Buffer; format: 'png' }

/** Werte aus `PDF_COLORS` des Profi-Reports. */
export const FRAME_COLORS = {
  navy: '#18336f',
  onNavy: '#ffffff',
  onNavyMuted: '#a7b1c8',
  accentOnNavy: '#2cc3c1',
  navyRule: '#2a4180',
  accent: '#0f766e',
  ink: '#0f172a',
  textMuted: '#475569',
  border: '#e2e8f0',
} as const

/** Werte aus `PDF_TYPE`/`PDF_LAYOUT` des Profi-Reports. */
export const FRAME_LAYOUT = {
  pageHorizontal: 56.69,
  pageTop: 78,
  pageBottom: 62,
  headerTop: 30,
  footerBottom: 26,
  body: 9.5,
  small: 8.5,
  footer: 7.6,
  lineHeight: 1.25,
} as const

const C = FRAME_COLORS
const L = FRAME_LAYOUT
const LEADING = { fontSize: L.body, lineHeight: L.lineHeight } as const

const f = StyleSheet.create({
  header: {
    position: 'absolute',
    top: L.headerTop,
    left: L.pageHorizontal,
    right: L.pageHorizontal,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerBrand: { flexDirection: 'row', alignItems: 'center' },
  headerMark: { width: 13, height: 13, marginRight: 5 },
  headerWordmark: {
    fontSize: L.small,
    lineHeight: L.lineHeight,
    fontWeight: 600,
    color: C.navy,
    letterSpacing: 0.6,
    marginRight: 3,
  },
  headerWordmarkAccent: {
    fontSize: L.small,
    lineHeight: L.lineHeight,
    fontWeight: 600,
    color: C.accent,
    letterSpacing: 0.6,
  },
  headerDoc: {
    marginLeft: 10,
    fontSize: L.small,
    lineHeight: L.lineHeight,
    color: C.textMuted,
  },
  headerBar: { marginTop: 4, height: 1.6, backgroundColor: C.accent },
  footer: {
    position: 'absolute',
    bottom: L.footerBottom,
    left: L.pageHorizontal,
    right: L.pageHorizontal,
    borderTopWidth: 0.7,
    borderTopColor: C.border,
    paddingTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: L.footer,
    lineHeight: L.lineHeight,
    color: C.textMuted,
  },

  navyPage: {
    fontFamily: SCHNELLREPORT_FONT,
    fontSize: L.body,
    color: C.onNavy,
    backgroundColor: C.navy,
    paddingTop: 52,
    paddingBottom: 52,
    paddingLeft: L.pageHorizontal,
    paddingRight: L.pageHorizontal,
  },
  navyLockup: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  // Weisse Kachel, weil die Emblemfläche (#112555) auf Navy sonst verschwimmt (Profi-Report).
  navyTile: { width: 64, height: 64, backgroundColor: C.onNavy, borderRadius: 12, padding: 7 },
  navyMark: { width: '100%', height: '100%' },
  navyWordmark: {
    ...LEADING,
    fontSize: 17,
    fontWeight: 700,
    color: C.onNavy,
    letterSpacing: 1.6,
  },
  navyWordmarkSub: {
    ...LEADING,
    marginTop: 3,
    fontSize: L.small,
    color: C.onNavyMuted,
    letterSpacing: 0.6,
  },
  navyBody: { flexGrow: 1, justifyContent: 'center' },
  rule: { width: 54, height: 3, backgroundColor: C.accentOnNavy, marginBottom: 18 },
  coverTitle: { fontSize: 30, fontWeight: 700, color: C.onNavy, lineHeight: 1.18 },
  coverSubtitle: { marginTop: 10, fontSize: 12, color: C.onNavyMuted, lineHeight: 1.35 },
  block: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: C.accentOnNavy },
  blockLabel: {
    ...LEADING,
    fontSize: L.small,
    fontWeight: 600,
    color: C.accentOnNavy,
    letterSpacing: 1.2,
  },
  blockName: { ...LEADING, marginTop: 5, fontSize: 13, fontWeight: 600, color: C.onNavy },
  rows: { marginTop: 34, paddingTop: 14, borderTopWidth: 0.5, borderTopColor: C.navyRule },
  row: { flexDirection: 'row', marginBottom: 4 },
  rowLabel: { ...LEADING, width: 150, color: C.onNavyMuted },
  rowValue: { ...LEADING, fontWeight: 600, color: C.onNavy },
  outroTitle: { fontSize: 20, fontWeight: 700, color: C.onNavy, lineHeight: 1.25 },
  outroRole: { ...LEADING, color: C.onNavyMuted },
  outroLines: { marginTop: 7 },
  outroLine: { ...LEADING, color: C.onNavy },
  outroFootLine: { ...LEADING, fontSize: L.small, color: C.onNavyMuted },
})

/** Kopf- und Fusszeile einer Innenseite, ohne `fixed`: jede Seite ist genau ein Blatt. */
export function PageFurniture({
  content,
  emblem,
  page,
}: {
  content: SchnellreportContent
  emblem: EmblemSource
  page: number
}) {
  const [first, ...rest] = content.brand.name.split(' ')
  return (
    <>
      <View style={f.header}>
        <View style={f.headerRow}>
          <View style={f.headerBrand}>
            <Image src={emblem} style={f.headerMark} />
            <Text style={f.headerWordmark}>{first}</Text>
            <Text style={f.headerWordmarkAccent}>{rest.join(' ')}</Text>
          </View>
          {content.headerFirma && <Text style={f.headerDoc}>{content.headerFirma}</Text>}
        </View>
        <View style={f.headerBar} />
      </View>
      <View style={f.footer}>
        <Text>{content.footer.address}</Text>
        <Text>
          {content.footer.web} · {content.pageOf(page)}
        </Text>
      </View>
    </>
  )
}

function NavyLockup({ content, emblem }: { content: SchnellreportContent; emblem: EmblemSource }) {
  return (
    <View style={f.navyLockup}>
      <View style={f.navyTile}>
        <Image src={emblem} style={f.navyMark} />
      </View>
      <View>
        <Text style={f.navyWordmark}>{content.brand.name}</Text>
        <Text style={f.navyWordmarkSub}>{content.brand.sub}</Text>
      </View>
    </View>
  )
}

function NavyPage({ children }: { children: ReactNode }) {
  return (
    <Page size="A4" style={f.navyPage}>
      {children}
    </Page>
  )
}

export function CoverPage({
  content,
  emblem,
}: {
  content: SchnellreportContent
  emblem: EmblemSource
}) {
  const { cover } = content
  return (
    <NavyPage>
      <NavyLockup content={content} emblem={emblem} />
      <View style={f.navyBody}>
        <View style={f.rule} />
        <Text style={f.coverTitle}>{cover.titleLine1}</Text>
        <Text style={f.coverTitle}>{cover.titleLine2}</Text>
        <Text style={f.coverSubtitle}>{cover.subtitle}</Text>
        {cover.firma && (
          <View style={[f.block, { marginTop: 34 }]}>
            <Text style={f.blockLabel}>{cover.customerLabel}</Text>
            <Text style={f.blockName}>{cover.firma}</Text>
          </View>
        )}
        <View style={f.rows}>
          {cover.rows.map((row) => (
            <View key={row.label} style={f.row}>
              <Text style={f.rowLabel}>{row.label}</Text>
              <Text style={f.rowValue}>{row.value}</Text>
            </View>
          ))}
        </View>
      </View>
    </NavyPage>
  )
}

export function ClosingPage({
  content,
  emblem,
}: {
  content: SchnellreportContent
  emblem: EmblemSource
}) {
  const { closing } = content
  const { contact } = closing
  const hasContact = Boolean(contact.name || contact.role || contact.lines.length)
  return (
    <NavyPage>
      <NavyLockup content={content} emblem={emblem} />
      <View style={f.navyBody}>
        <View style={f.rule} />
        <Text style={f.outroTitle}>{closing.title}</Text>
        <Text style={f.coverSubtitle}>{closing.text}</Text>
        {hasContact && (
          <View style={[f.block, { marginTop: 30 }]}>
            {contact.name && <Text style={f.blockLabel}>{closing.contactLabel}</Text>}
            {contact.name && <Text style={f.blockName}>{contact.name}</Text>}
            {contact.role && <Text style={f.outroRole}>{contact.role}</Text>}
            {contact.lines.length > 0 && (
              <View style={f.outroLines}>
                {contact.lines.map((line) => (
                  <Text key={line} style={f.outroLine}>
                    {line}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
        <View style={f.rows}>
          {closing.footerLines.map((line) => (
            <Text key={line} style={f.outroFootLine}>
              {line}
            </Text>
          ))}
        </View>
      </View>
    </NavyPage>
  )
}
