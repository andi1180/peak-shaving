import { createRequire } from 'node:module'
import path from 'node:path'

/**
 * Zeilenzahl eines Satzes in der Report-Schrift, gemessen mit fontkit (der Schriftbibliothek von
 * react-pdf) und gierig umbrochen wie ohne Silbentrennung. Nur für Tests.
 */
const requireFromApp = createRequire(path.resolve(import.meta.dirname, '../package.json'))
const requireFromRenderer = createRequire(requireFromApp.resolve('@react-pdf/renderer'))
const requireFromFont = createRequire(requireFromRenderer.resolve('@react-pdf/font'))
const fontkit = requireFromFont('fontkit') as {
  openSync(file: string): {
    unitsPerEm: number
    layout(text: string): { advanceWidth: number }
  }
}

const FONT_DIR = path.resolve(import.meta.dirname, '../public/report-fonts')
const regular = fontkit.openSync(`${FONT_DIR}/Inter-Regular.woff`)

export function textWidthPt(text: string, fontSize: number): number {
  return (regular.layout(text).advanceWidth / regular.unitsPerEm) * fontSize
}

export function lineCount(text: string, fontSize: number, width: number): number {
  let lines = 1
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (line && textWidthPt(next, fontSize) > width) {
      lines += 1
      line = word
    } else {
      line = next
    }
  }
  return lines
}
