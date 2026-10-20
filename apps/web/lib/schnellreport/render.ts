import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createElement, type ReactElement } from 'react'
import { Font, renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { buildSchnellreportContent, type SchnellreportInput } from './content'
import { SchnellreportDocument } from './document'
import { SCHNELLREPORT_FONT, type EmblemSource } from './frame'
import { SCHNELLREPORT_SETTINGS, type SchnellreportSettings } from './settings'

/*
 * react-pdf lädt Schriften in Node per `fetch` — ein Dateipfad geht dort nicht, eine Data-URI schon.
 * Die Dateien liegen in `assets/` (nicht `public/`); `next.config.mjs` nimmt sie für die Routen mit,
 * die dieses Modul benutzen (`outputFileTracingIncludes`) — ebenso das Emblem aus `public/brand/`.
 */
const FONT_DIR = path.join(process.cwd(), 'assets', 'schnellreport-fonts')
const FONT_FILES = [
  { file: 'Inter-Regular.woff', fontWeight: 400 },
  { file: 'Inter-SemiBold.woff', fontWeight: 600 },
  { file: 'Inter-Bold.woff', fontWeight: 700 },
] as const

const EMBLEM_FILE = path.join(process.cwd(), 'public', 'brand', 'coolin-emblem.png')

let fontsReady: Promise<void> | null = null
let emblemReady: Promise<EmblemSource> | null = null

function loadEmblem(): Promise<EmblemSource> {
  emblemReady ??= readFile(EMBLEM_FILE).then((data) => ({ data, format: 'png' as const }))
  return emblemReady
}

function registerFonts(): Promise<void> {
  fontsReady ??= (async () => {
    const fonts = await Promise.all(
      FONT_FILES.map(async ({ file, fontWeight }) => {
        const data = await readFile(path.join(FONT_DIR, file))
        return { src: `data:font/woff;base64,${data.toString('base64')}`, fontWeight }
      }),
    )
    Font.register({ family: SCHNELLREPORT_FONT, fonts })
    // Englische Silbentrennung zerreisst deutsche Komposita; lieber ganze Wörter umbrechen.
    Font.registerHyphenationCallback((word) => [word])
  })()
  return fontsReady
}

/** Erzeugt den siebenseitigen PDF-Schnellreport (für den Mail-Anhang in 3b-2 und die Vorschau). */
export async function renderSchnellreportPdf(
  input: SchnellreportInput,
  settings: SchnellreportSettings = SCHNELLREPORT_SETTINGS,
): Promise<Buffer> {
  const [, emblem] = await Promise.all([registerFonts(), loadEmblem()])
  const content = buildSchnellreportContent(input, settings)
  // SchnellreportDocument rendert als Wurzel ein <Document>; der Typ von renderToBuffer sieht das nicht.
  const element = createElement(SchnellreportDocument, {
    content,
    emblem,
  }) as unknown as ReactElement<DocumentProps>
  return renderToBuffer(element)
}
