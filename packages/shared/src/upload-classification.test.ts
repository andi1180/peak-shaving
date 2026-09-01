import { describe, expect, it } from 'vitest'

import {
  UPLOAD_CLASSIFICATION_CANDIDATE_KEYS,
  UPLOAD_CLASSIFICATION_JSON_SCHEMA,
  UPLOAD_DOCUMENT_TYPES,
  UPLOAD_DOCUMENT_TYPE_LABELS,
  emptyUploadClassificationVerdict,
  isUploadDocumentType,
  parseUploadClassification,
  resolveUploadDocumentType,
  type UploadClassificationVerdict,
} from './upload-classification'

/** Ein Urteil aus den drei Einzelaussagen — kürzer als das Objekt in jedem Test. */
function verdict(
  istRechnung: boolean,
  istLastgang: boolean,
  istTarifblatt: boolean,
): UploadClassificationVerdict {
  return { istRechnung, istLastgang, istTarifblatt }
}

describe('Die Arten', () => {
  it('führt genau die vier bekannten Werte, `unbekannt` eingeschlossen', () => {
    expect([...UPLOAD_DOCUMENT_TYPES]).toEqual(['rechnung', 'lastgang', 'tarifblatt', 'unbekannt'])
  })

  it('hat für jede Art einen Anzeigenamen — sonst stünde in der Liste ein leeres Feld', () => {
    for (const type of UPLOAD_DOCUMENT_TYPES) {
      expect(UPLOAD_DOCUMENT_TYPE_LABELS[type]).toBeTruthy()
    }
  })

  it('erkennt eine Korrektur aus der Oberfläche nur, wenn sie eine bekannte Art nennt', () => {
    expect(isUploadDocumentType('rechnung')).toBe(true)
    expect(isUploadDocumentType('unbekannt')).toBe(true)
    expect(isUploadDocumentType('Rechnung')).toBe(false)
    expect(isUploadDocumentType('angebot')).toBe(false)
    expect(isUploadDocumentType(null)).toBe(false)
    expect(isUploadDocumentType(0)).toBe(false)
  })
})

describe('JSON-Schema', () => {
  it('verlangt jede der drei Fragen und verbietet zusätzliche Felder', () => {
    expect(UPLOAD_CLASSIFICATION_JSON_SCHEMA.type).toBe('object')
    expect(UPLOAD_CLASSIFICATION_JSON_SCHEMA.additionalProperties).toBe(false)
    expect(UPLOAD_CLASSIFICATION_JSON_SCHEMA.required).toEqual([
      ...UPLOAD_CLASSIFICATION_CANDIDATE_KEYS,
    ])
    expect(Object.keys(UPLOAD_CLASSIFICATION_JSON_SCHEMA.properties as object)).toEqual([
      ...UPLOAD_CLASSIFICATION_CANDIDATE_KEYS,
    ])
  })

  it('fragt ausschliesslich Wahrheitswerte ab — keine Konfidenz, kein Freitext', () => {
    const props = UPLOAD_CLASSIFICATION_JSON_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >
    for (const key of UPLOAD_CLASSIFICATION_CANDIDATE_KEYS) {
      expect(props[key].type).toBe('boolean')
      expect(props[key].description).toBeTruthy()
      // Kein Zahlen-, Aufzählungs- oder Textfeld, das sich als Konfidenz lesen liesse.
      expect(props[key].enum).toBeUndefined()
    }
  })

  it('kombiniert nirgends eine Typ-Union mit einer enum-Liste (die API weist das mit 400 ab)', () => {
    /*
     * Derselbe rekursive Wächter wie in `invoice-scan.test.ts`. Er prüft die URSACHE des
     * Totalausfalls vom 31.08.2026, nicht die heutige Form — dadurch ist auch ein Feld
     * abgesichert, das es in diesem Schema noch gar nicht gibt.
     */
    const offenders: string[] = []
    function walk(node: unknown, path: string) {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      const obj = node as Record<string, unknown>
      if (Array.isArray(obj.type) && obj.enum !== undefined) offenders.push(path)
      for (const [key, value] of Object.entries(obj)) walk(value, `${path}.${key}`)
    }

    walk(UPLOAD_CLASSIFICATION_JSON_SCHEMA, '$')
    expect(offenders).toEqual([])
  })
})

describe('parseUploadClassification — fail closed, Frage für Frage', () => {
  it('übernimmt eine vollständige Antwort unverändert', () => {
    expect(
      parseUploadClassification({ istRechnung: true, istLastgang: false, istTarifblatt: false }),
    ).toEqual(verdict(true, false, false))
  })

  it('macht aus einer unbrauchbaren Antwort ein leeres Urteil statt einer Ausnahme', () => {
    for (const raw of [null, undefined, 'ja', 42, [], { egal: true }]) {
      expect(parseUploadClassification(raw)).toEqual(emptyUploadClassificationVerdict())
    }
  })

  it('⚠ wertet NUR echtes true als Zustimmung — "true" und 1 sähen wie eine aus', () => {
    const parsed = parseUploadClassification({
      istRechnung: 'true',
      istLastgang: 1,
      istTarifblatt: 'ja',
    })
    expect(parsed).toEqual(verdict(false, false, false))
  })

  it('behandelt ein fehlendes Feld wie ein Nein', () => {
    expect(parseUploadClassification({ istRechnung: true })).toEqual(verdict(true, false, false))
  })

  it('lässt keine zusätzlichen Felder in das Urteil durch', () => {
    const parsed = parseUploadClassification({
      istRechnung: true,
      istLastgang: false,
      istTarifblatt: false,
      konfidenz: 0.9,
      begruendung: 'Ich bin sehr sicher.',
    })
    expect(Object.keys(parsed)).toEqual([...UPLOAD_CLASSIFICATION_CANDIDATE_KEYS])
  })
})

describe('resolveUploadDocumentType — genau eine Zustimmung', () => {
  it('bildet jede der drei Einzelaussagen auf ihre Art ab', () => {
    expect(resolveUploadDocumentType(verdict(true, false, false))).toBe('rechnung')
    expect(resolveUploadDocumentType(verdict(false, true, false))).toBe('lastgang')
    expect(resolveUploadDocumentType(verdict(false, false, true))).toBe('tarifblatt')
  })

  it('ergibt `unbekannt`, wenn nichts zutrifft — das ist ein Ergebnis, kein Fehlschlag', () => {
    expect(resolveUploadDocumentType(verdict(false, false, false))).toBe('unbekannt')
  })

  it('⚠ ergibt `unbekannt` bei MEHREREN Zustimmungen — es gibt bewusst keine Rangfolge', () => {
    expect(resolveUploadDocumentType(verdict(true, false, true))).toBe('unbekannt')
    expect(resolveUploadDocumentType(verdict(true, true, false))).toBe('unbekannt')
    expect(resolveUploadDocumentType(verdict(true, true, true))).toBe('unbekannt')
  })

  it('liefert für jede mögliche Antwort eine bekannte Art — es gibt keinen fünften Ausgang', () => {
    for (const r of [true, false]) {
      for (const l of [true, false]) {
        for (const t of [true, false]) {
          expect(UPLOAD_DOCUMENT_TYPES).toContain(resolveUploadDocumentType(verdict(r, l, t)))
        }
      }
    }
  })
})
