import { describe, expect, it } from 'vitest'

import { BATTERY_LOOKUP_JSON_SCHEMA } from './battery-lookup'
import { BATTERY_SPEC_SCAN_JSON_SCHEMA } from './battery-spec-scan'
import { BATTERY_TEXT_JSON_SCHEMA } from './battery-text'
import { INVOICE_SCAN_JSON_SCHEMA } from './invoice-scan'
import { API_UNION_PARAMETER_LIMIT, countUnionParameters } from './json-schema-unions'
import { PV_ARRAY_TEXT_JSON_SCHEMA } from './pv-array-text'
import { PV_DESIGN_SCAN_JSON_SCHEMA } from './pv-design-scan'
import { REPORT_REQUEST_JSON_SCHEMA } from './report-request'
import { UPLOAD_CLASSIFICATION_JSON_SCHEMA } from './upload-classification'

// Das neunte Schema (`TARIFF_SHEET_SCAN_JSON_SCHEMA`) liegt in apps/web und wird dort geprüft.
const SCHEMAS = {
  'invoice-scan': INVOICE_SCAN_JSON_SCHEMA,
  'battery-lookup': BATTERY_LOOKUP_JSON_SCHEMA,
  'battery-spec-scan': BATTERY_SPEC_SCAN_JSON_SCHEMA,
  'battery-text': BATTERY_TEXT_JSON_SCHEMA,
  'pv-array-text': PV_ARRAY_TEXT_JSON_SCHEMA,
  'pv-design-scan': PV_DESIGN_SCAN_JSON_SCHEMA,
  'upload-classification': UPLOAD_CLASSIFICATION_JSON_SCHEMA,
  'report-request': REPORT_REQUEST_JSON_SCHEMA,
}

describe('countUnionParameters', () => {
  it('zählt type-Arrays und anyOf rekursiv, auch in Array-Items', () => {
    expect(
      countUnionParameters({
        type: 'object',
        properties: {
          a: { type: ['number', 'null'] },
          b: { anyOf: [{ type: 'string', enum: ['x'] }, { type: 'null' }] },
          c: {
            type: 'array',
            items: { type: 'object', properties: { d: { type: ['string', 'null'] } } },
          },
          e: { type: 'boolean' },
        },
      }),
    ).toBe(3)
  })

  it.each(Object.entries(SCHEMAS))(
    `%s bleibt unter der API-Grenze (≤ ${API_UNION_PARAMETER_LIMIT})`,
    (name, schema) => {
      const count = countUnionParameters(schema)
      expect(
        count,
        `${name}: ${count} Union-Parameter — die API weist das mit HTTP 400 ab („Schemas contains too ` +
          `many parameters with union types … limit: ${API_UNION_PARAMETER_LIMIT}")`,
      ).toBeLessThanOrEqual(API_UNION_PARAMETER_LIMIT)
    },
  )

  it('der Rechnungs-Scan hält zwei Reserve unter der Grenze', () => {
    expect(countUnionParameters(INVOICE_SCAN_JSON_SCHEMA)).toBeLessThanOrEqual(14)
  })

  it('netzbetreiber ist ein schlichtes Pflicht-Enum und zählt nicht als Union', () => {
    const props = INVOICE_SCAN_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>
    expect(props.netzbetreiber).toMatchObject({
      type: 'string',
      enum: ['wiener_netze', 'netz_noe', 'salzburg_netz', 'unbekannt'],
    })
    expect(INVOICE_SCAN_JSON_SCHEMA.required).toContain('netzbetreiber')
    expect(countUnionParameters(INVOICE_SCAN_JSON_SCHEMA)).toBe(14)
  })
})
