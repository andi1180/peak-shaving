import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * D12 Teil 2 — die Admin-Aktion, die einen Zählpunkt durchrechnet und daraus eine Übergabe für den
 * Report-Renderer anlegt.
 *
 * ⚠ GEMESSEN WIRD DER INHALT DER ÜBERGABE, NICHT NUR IHR ZUSTANDEKOMMEN. `create_report_render_request`
 * nimmt zwei beliebige `jsonb` entgegen und kennt kein Vokabular für Analysen: eine leere oder
 * vertauschte Nutzlast liefe dort widerspruchslos durch, und der Renderer bekäme eine Übergabe, die
 * vollständig aussieht. Der Test greift deshalb die Argumente des Wrappers ab.
 */

import { emptyInvoiceExtraction, type InvoiceExtraction } from 'shared'

import { setDraftField } from '@/lib/project-chat/draft'
import { invoiceDraftValues } from './invoice-extractions'

const rpc = vi.fn()
const readProjectDocument = vi.fn()

/*
 * Der Drei-Wege-Vergleich fragt seit dem `fetchTariffPricing`-Port zwei Tabellen ab. Hier ist nichts
 * gepflegt — die Abfragen antworten leer, der Hebel ist damit nicht berechenbar, und genau das ist
 * der Punkt: die Analyse läuft trotzdem durch. Ohne diesen Stub wäre der Lauf zwar ebenfalls grün
 * (jede Seite scheitert für sich), aber mit zwei Fehler-Protokollzeilen in einem passenden Test.
 */
const emptyQuery: Record<string, unknown> = {
  then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
}
for (const method of ['select', 'eq', 'is', 'or', 'lte', 'gte', 'lt', 'order', 'range']) {
  emptyQuery[method] = () => emptyQuery
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, from: () => emptyQuery }),
}))
vi.mock('@/lib/project-documents/documents', () => ({
  readProjectDocument: (id: string) => readProjectDocument(id),
}))

const { createReportRenderRequestAction } = await import('./report-render-actions')

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const POINT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const REQUEST_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const DOCUMENT_ID = 'cccccccc-dddd-4eee-8fff-000000000000'

/** Ein vollständiger Tarif-Entwurf, wie ihn die Rechnung-Station hinterlässt. */
const DRAFT: Record<string, unknown> = {
  netzebene: 'NE 7',
  meteringVariant: 'mit_leistungsmessung',
  leistungspreisEurPerKwYear: 82.92,
  minBillableKw: 0,
  energyPriceCtPerKwh: 24.5,
  einspeiseverguetungCtPerKwh: 7.2,
  supplierBaseFeeEurPerMonth: 14.9,
  netzbetreiber: 'wiener_netze',
}

/** Ein Tag mit Morgenspitze — 96 Viertelstunden, ISO-Zeitstempel, Semikolon/Dezimalkomma. */
function loadProfileCsv(): string {
  const rows: string[] = ['Zeitstempel;Bezug (kW)']
  for (let i = 0; i < 96; i += 1) {
    const at = new Date(Date.UTC(2025, 2, 17, 0, 0) + i * 15 * 60_000)
    const hour = at.getUTCHours()
    const kw = hour >= 5 && hour < 8 ? 48 : hour >= 8 && hour < 18 ? 22 : 9
    rows.push(`${at.toISOString().slice(0, 16)};${String(kw).replace('.', ',')}`)
  }
  return rows.join('\n')
}

function form(): FormData {
  const fd = new FormData()
  fd.set('projectId', PROJECT_ID)
  fd.set('meteringPointId', POINT_ID)
  return fd
}

function withWrappers(draft: Record<string, unknown>) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'admin_get_project') {
      return { data: { status: 'ok', project: { id: PROJECT_ID, customer_label: 'Bäckerei Gruber' } }, error: null }
    }
    if (fn === 'list_metering_points') {
      return {
        data: {
          status: 'ok',
          metering_points: [
            { id: POINT_ID, draft, source_document_id: DOCUMENT_ID },
          ],
        },
        error: null,
      }
    }
    if (fn === 'create_report_render_request') return { data: REQUEST_ID, error: null }
    throw new Error(`unerwarteter Wrapper: ${fn}`)
  })
}

beforeEach(() => {
  rpc.mockReset()
  readProjectDocument.mockReset()
  readProjectDocument.mockResolvedValue({
    ok: true,
    bytes: new TextEncoder().encode(loadProfileCsv()).buffer,
    filename: 'lastgang-2025.csv',
    contentType: 'text/csv',
  })
})

describe('createReportRenderRequestAction', () => {
  it('legt aus einem vollständigen Entwurf eine Übergabe an — mit Ergebnis UND Lastgang', async () => {
    withWrappers(DRAFT)

    const state = await createReportRenderRequestAction({}, form())
    expect(state.formError).toBeUndefined()
    /*
     * ⚠ Die Kennung steht seit dem D12-Abschluss im ZIEL, nicht im Meldungstext: sie führt auf die
     * Leseseite in `apps/website`, und eine von Hand übertragene Kennung mit Tippfehler sähe aus wie
     * eine abgelaufene Übergabe.
     */
    expect(state.successHref).toContain(REQUEST_ID)
    expect(state.successHref).toContain('/report/')

    const call = rpc.mock.calls.find(([fn]) => fn === 'create_report_render_request')
    expect(call).toBeDefined()
    const args = call![1] as Record<string, unknown>

    // Das Ergebnis ist gerechnet, nicht leer durchgereicht.
    const result = args.p_analysis_result as { current: { billedKw: number }; perBattery: unknown[] }
    expect(result.current.billedKw).toBeCloseTo(48, 6)
    expect(result.perBattery.length).toBeGreaterThan(0)

    // Der Lastgang steht daneben — er kommt im AnalysisResult nicht vor.
    const loadProfile = args.p_load_profile as { readings: unknown[]; intervalMinutes: number }
    expect(loadProfile.readings).toHaveLength(96)
    expect(loadProfile.intervalMinutes).toBe(15)

    // Genau sieben Felder, als WERTE — kein Verweis auf den veränderlichen Entwurf.
    expect(args.p_report_input_meta).toEqual({
      customerLabel: 'Bäckerei Gruber',
      netzbetreiber: 'wiener_netze',
      supplierBaseFeeEurPerMonth: 14.9,
      /*
       * D5 — `null` heisst „die PV-Frage wurde nie beantwortet" (dieser Entwurf stellt sie nicht),
       * und der Befund ist leer, weil ein Tageslastgang die Mindest-Tageszahl je Monat nicht
       * erreicht und deshalb gar nicht erst bewertet wird.
       */
      hasPv: null,
      pvOutageMonths: [],
      meteringPointId: POINT_ID,
      projectId: PROJECT_ID,
    })
    expect(args.p_ttl_hours).toBe(24)
  })

  /*
   * ⚠ DER FALL, DER DEN FEHLER VOM 16.09.2026 SICHTBAR MACHT. Der Entwurf entsteht hier NICHT von
   * Hand, sondern genau so, wie die Rechnung-Station ihn nach einem reinen Scan hinterlässt — über
   * `invoiceDraftValues`. Ein von Hand gesetztes `netzbetreiber` im Fixture prüfte nur die Fixture.
   */
  it('⚠ trägt den Netzbetreiber auch nach einem REINEN Rechnungs-Scan in die Übergabe', async () => {
    const gelesen: InvoiceExtraction = {
      ...emptyInvoiceExtraction(),
      netzbetreiber: 'wiener_netze',
      netzebene: 7,
      meteringVariant: 'mit_leistungsmessung',
      rates: {
        ...emptyInvoiceExtraction().rates,
        leistungspreisEurPerKwYear: 82.92,
        minBillableKw: 0,
        energyPriceCtPerKwh: 24.5,
        einspeiseverguetungCtPerKwh: 7.2,
      },
    }

    let draft: Record<string, unknown> = {}
    for (const { field, value } of invoiceDraftValues(gelesen)) {
      draft = setDraftField(draft, field, value, 'measured', undefined, new Date('2026-09-16T08:00:00Z'))
    }
    withWrappers(draft)

    const state = await createReportRenderRequestAction({}, form())
    expect(state.formError).toBeUndefined()

    const call = rpc.mock.calls.find(([fn]) => fn === 'create_report_render_request')
    const meta = call![1].p_report_input_meta as Record<string, unknown>
    expect(meta.netzbetreiber).toBe('wiener_netze')
  })

  it('ohne Grundgebühr im Entwurf steht `null` — nicht 0', async () => {
    const { supplierBaseFeeEurPerMonth: _weg, ...ohneGrundgebuehr } = DRAFT
    withWrappers(ohneGrundgebuehr)

    const state = await createReportRenderRequestAction({}, form())
    expect(state.formError).toBeUndefined()

    const call = rpc.mock.calls.find(([fn]) => fn === 'create_report_render_request')
    const meta = call![1].p_report_input_meta as Record<string, unknown>
    // 0 hiesse „keine Grundgebühr vereinbart" — eine Angabe, die niemand gemacht hat.
    expect(meta.supplierBaseFeeEurPerMonth).toBeNull()
  })

  it('⚠ bei gesperrtem Entwurf (geschätzte PV) entsteht GAR KEINE Zeile', async () => {
    withWrappers({ ...DRAFT, hasPv: true, pvProfileSource: 'generated', pvEstimatedAnnualKwh: 12_000 })

    const state = await createReportRenderRequestAction({}, form())

    // Die Meldung des Laufs kommt unverändert an — sie nennt die betroffenen Felder.
    expect(state.success).toBeUndefined()
    expect(state.formError).toContain('pvProfileSource')
    expect(rpc.mock.calls.some(([fn]) => fn === 'create_report_render_request')).toBe(false)
  })
})
