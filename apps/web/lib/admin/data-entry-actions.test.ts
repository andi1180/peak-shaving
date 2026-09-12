import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ⚠ Beide Grenzen kommen aus ihrem echten Fundort, nicht als abgetippte Zahl: ein Test, der 12 und
 * 6 MB selbst behauptet, bliebe grün, wenn die Anwendung gegen andere Werte prüft — und misst dann
 * eine Grenze, die es in Produktion nicht gibt.
 */
import { MAX_BATTERY_TEXT_CHARS, MAX_INVOICE_FILE_BYTES } from 'extractors'
import { MAX_INVOICES_PER_UPLOAD } from './invoice-extractions'

/**
 * B24, Teil 1 — die Server Actions, deren Zusage in der ORCHESTRIERUNG steckt.
 *
 * Zwei Actions, ein gemeinsamer Gegenstand: was zwischen den Wrapper-Aufrufen passiert, und was
 * bei einem TEILausfall stehen bleibt. Das Verhalten der Wrapper selbst liegt im DB-Gate.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST: WAS BEI EINEM TEILAUSFALL STEHEN BLEIBT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Das Verhalten der beiden Wrapper selbst (Adminrolle, `in_use`-Sperre, Rückgabe der noch gültigen
 * Dokument-Kennung) ist Sache der Migration und liegt im DB-Gate. Was DORT nicht messbar ist, ist
 * die Orchestrierung dazwischen — und genau in ihr sitzt die Entscheidung dieses Schritts:
 *
 *   1. ERST die Datei, DANN die Zeile. Umgekehrt bliebe im Fehlerfall ein Objekt im Bucket, auf das
 *      nichts mehr zeigt — unsichtbar in jeder Liste.
 *   2. SCHEITERT DAS LÖSCHEN DER DATEI, BLEIBT DIE ZEILE STEHEN. Sie ist der einzige Beleg dafür,
 *      dass die Datei noch da ist; sie trotzdem zu löschen wäre der stille Datenverlust, den die
 *      Reihenfolge gerade verhindern soll.
 *   3. IN BEIDEN FÄLLEN WIRD DIE STATION NEU GERENDERT. Der Zählpunkt ist ab Schritt 1
 *      zurückgesetzt; ohne `revalidatePath` zeigte der Browser weiter die Zusammenfassung eines
 *      Lastgangs, den es nicht mehr gibt.
 *
 * Der Storage-Rand ist deshalb ersetzt und zählt mit, OB und WANN er gerufen wurde — ein Fehlschlag
 * lässt sich in einer echten Ablage nicht auf Zuruf herstellen.
 */

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const removeProjectDocumentBytes = vi.fn()
const revalidatePath = vi.fn()
const uploadProjectDocument = vi.fn()
const extractInvoiceData = vi.fn()
const extractBatteryText = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }))
vi.mock('next/navigation', () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`)
  },
}))
/*
 * `extractors` ist `server-only`. Der LASTGANG-Leser wird hier nicht gebraucht (der Rückweg fasst
 * ihn nicht an) und bleibt ein leerer Platzhalter.
 *
 * ⚠ DER REST DES MODULS IST ECHT (`importActual`), und das ist kein Komfort: `MAX_INVOICE_FILE_BYTES`
 * wird auf Modulebene gelesen (`INVOICE_FAILURE_TEXT`) UND ist die Schwelle, gegen die die Action
 * prüft. Als Attrappe mit eigener Zahl liefe dieser Test gegen eine Grenze, die es in Produktion
 * nicht gibt — und `undefined` wäre schlimmer: `file.size > undefined` ist immer `false`, der
 * Zweig „zu gross" wäre unerreichbar und der Test dafür grün aus dem falschen Grund.
 *
 * Ein Tiefen-Import der Konstante scheidet aus: `packages/extractors` gibt unter `exports` allein
 * den Barrel frei (die Sperre aus Delta 17), und eine zweite Zahl im Repo wäre genau die Doppelung,
 * gegen die sie gebaut ist.
 */
vi.mock('extractors', async () => ({
  ...(await vi.importActual<typeof import('extractors')>('extractors')),
  readLoadProfile: vi.fn(),
  extractInvoiceData: (base64: string) => extractInvoiceData(base64),
  extractBatteryText: (text: string) => extractBatteryText(text),
}))
vi.mock('@/lib/project-documents/documents', () => ({
  uploadProjectDocument: (projectId: string, file: unknown) =>
    uploadProjectDocument(projectId, file),
}))
vi.mock('@/lib/project-documents/storage', () => ({
  removeProjectDocumentBytes: (path: string) => removeProjectDocumentBytes(path),
}))

const {
  extractBatteryTextFromAction,
  removeMeteringPointInvoiceAction,
  removeMeteringPointLoadProfileAction,
  saveMeteringPointBatteryAction,
  saveMeteringPointBatteryChoiceAction,
  saveMeteringPointManualTariffAction,
  saveMeteringPointPvChoiceAction,
  uploadMeteringPointInvoicesAction,
} = await import('./data-entry-actions')

const PROJECT_ID = '11111111-2222-4333-8444-555555555555'
const POINT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const DOCUMENT_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'
const STORAGE_PATH = `${PROJECT_ID}/${DOCUMENT_ID}`

function form(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('projectId', PROJECT_ID)
  fd.set('meteringPointId', POINT_ID)
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return fd
}

/** Der Gutfall beider Wrapper — einzelne Tests überschreiben gezielt einen davon. */
function withWrappers(
  reset: unknown = {
    status: 'ok',
    metering_point_id: POINT_ID,
    project_id: PROJECT_ID,
    document_id: DOCUMENT_ID,
    storage_path: STORAGE_PATH,
  },
  del: unknown = { status: 'ok', document_id: DOCUMENT_ID, project_id: PROJECT_ID },
) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'admin_reset_metering_point_load_profile') return { data: reset, error: null }
    if (fn === 'admin_delete_metering_point_document') return { data: del, error: null }
    throw new Error(`unerwarteter Wrapper: ${fn}`)
  })
}

beforeEach(() => {
  rpc.mockReset()
  createClient.mockClear()
  removeProjectDocumentBytes.mockReset()
  revalidatePath.mockReset()
  removeProjectDocumentBytes.mockResolvedValue({ ok: true })
  uploadProjectDocument.mockReset()
  extractInvoiceData.mockReset()
  extractBatteryText.mockReset()
  withWrappers()
})

describe('removeMeteringPointLoadProfileAction — der vollständige Rückweg', () => {
  it('setzt zurück, löscht die Datei und DANN die Zeile', async () => {
    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(state.success).toBe('Lastgang entfernt. Sie können eine neue Datei hochladen.')
    expect(state.formError).toBeUndefined()

    expect(rpc).toHaveBeenNthCalledWith(1, 'admin_reset_metering_point_load_profile', {
      p_metering_point_id: POINT_ID,
    })
    expect(removeProjectDocumentBytes).toHaveBeenCalledWith(STORAGE_PATH)
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_delete_metering_point_document', {
      p_metering_point_id: POINT_ID,
      p_document_id: DOCUMENT_ID,
    })

    // ⚠ Die Reihenfolge selbst, nicht nur die Tatsache, dass beides passiert ist.
    const [storageCall] = removeProjectDocumentBytes.mock.invocationCallOrder
    const rowCall = rpc.mock.invocationCallOrder[1]
    expect(storageCall).toBeDefined()
    expect(rowCall).toBeDefined()
    expect(storageCall as number).toBeLessThan(rowCall as number)
    expect(revalidatePath).toHaveBeenCalledWith(
      `/admin/kalkulator-projekte/${PROJECT_ID}/dateneingabe`,
    )
  })

  // ── Der geforderte Simulationsfall ────────────────────────────────────────────────────────────
  it('⚠ lässt die Zeile STEHEN, wenn das Löschen der Datei scheitert', async () => {
    removeProjectDocumentBytes.mockResolvedValue({ ok: false, message: 'network down' })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    // Kein zweiter Wrapper-Aufruf: die Zeile ist der einzige Beleg dafür, dass die Datei noch da ist.
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalledWith('admin_delete_metering_point_document', expect.anything())

    // Und der Admin erfährt BEIDES: dass der Zählpunkt frei ist UND dass ein Rest bleibt.
    expect(state.success).toBeUndefined()
    expect(state.formError).toContain('vom Zählpunkt entfernt')
    expect(state.formError).toContain('neue Datei hochladen')
    expect(state.formError).toContain('nicht aus der Ablage löschen')

    // Der Zählpunkt IST zurückgesetzt — die Station muss das zeigen, auch im Fehlerfall.
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('meldet einen stehengebliebenen Eintrag, wenn nur der letzte Schritt scheitert', async () => {
    withWrappers(undefined, { status: 'in_use' })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(removeProjectDocumentBytes).toHaveBeenCalledTimes(1)
    expect(state.success).toBeUndefined()
    expect(state.formError).toContain('Dokumentenliste')
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })
})

describe('removeMeteringPointLoadProfileAction — nichts anfassen, wo nichts zu tun ist', () => {
  it('fasst die Ablage nicht an, wenn der Zählpunkt keine Quelle trug', async () => {
    withWrappers({
      status: 'ok',
      metering_point_id: POINT_ID,
      project_id: PROJECT_ID,
      document_id: null,
      storage_path: null,
    })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(state.success).toBe('Es war kein Lastgang hinterlegt. Der Zählpunkt ist leer.')
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('benennt einen unbekannten Zählpunkt und rendert die Station NICHT neu', async () => {
    withWrappers({ status: 'not_found' })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(state.formError).toContain('Diesen Zählpunkt gibt es nicht')
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
    // Es wurde nichts geändert — ein Neurendern behauptete das Gegenteil.
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('gibt eine entzogene Rolle als solche zurück, ohne die Ablage anzufassen', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })

    const state = await removeMeteringPointLoadProfileAction({}, form())

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('fragt die Datenbank gar nicht erst, wenn die Kennungen unbrauchbar sind', async () => {
    const badPoint = await removeMeteringPointLoadProfileAction({}, form({ meteringPointId: 'x' }))
    expect(badPoint.formError).toBeDefined()

    const badProject = await removeMeteringPointLoadProfileAction({}, form({ projectId: 'x' }))
    expect(badProject.formError).toBeDefined()

    expect(rpc).not.toHaveBeenCalled()
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * B24, Teil 1 — der Rechnungs-Schritt: mehrere Dateien in EINEM Vorgang
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Was hier geprüft wird, ist genau das, was WEDER das DB-Gate NOCH `invoice-extractions.test.ts`
 * sehen kann: die Orchestrierung über mehrere Dateien hinweg. Vier Eigenschaften, und jede davon
 * geht im Fehlerfall still schief:
 *
 *   1. EIN FEHLSCHLAG BLOCKIERT DIE ÜBRIGEN NICHT. Zwölf Rechnungen sind zwölf abrechenbare
 *      Modellaufrufe; eine unlesbare darunter darf die elf gelesenen nicht mitnehmen.
 *   2. DER ZWEITE VORGANG ERGÄNZT, ER ERSETZT NICHT. `update_metering_point_draft` ERSETZT den
 *      Entwurf — wer die bestehende Liste nicht mitführt, verliert bei jedem Nachreichen alles,
 *      was vorher gelesen wurde, und die Zusammenführung liefe über eine einzige Rechnung.
 *   3. EIN WIDERSPRUCH ÜBERSCHREIBT NICHTS. `mergeInvoiceExtractions` setzt so ein Feld auf `null`,
 *      und `invoiceDraftValues` lässt es weg — der zuvor übernommene Wert bleibt STEHEN. Wäre das
 *      anders, bestritte ein Widerspruch genau die Angabe, die er gerade in Frage stellt.
 *   4. ÜBER DER OBERGRENZE PASSIERT GAR NICHTS. Nicht die ersten zwölf: eine Datei, die hochgeladen
 *      und gelesen wurde, ist bezahlt und abgelegt.
 *
 * Der Entwurf wird deshalb ZUSTANDSBEHAFTET nachgebildet (`list_metering_points` liest, was
 * `update_metering_point_draft` geschrieben hat) — ein Mock, der immer denselben leeren Entwurf
 * liefert, könnte Punkt 2 und 3 gar nicht messen und bliebe grün.
 */

/** Der Entwurf des Zählpunkts — von `update_metering_point_draft` geschrieben, von `list_…` gelesen. */
let draft: Record<string, unknown> = {}

/*
 * ⚠ Der Dateiname steht IM Inhalt, und das ist kein Beiwerk: `readOneInvoice` läuft für alle
 * Dateien NEBENLÄUFIG (`Promise.all`), ein Aufrufzähler ordnet die Antworten des Auslesers deshalb
 * nicht zu. Zuordenbar ist nur, was der Extraktor tatsächlich bekommt — die Bytes DIESER Datei.
 */
function pdf(name: string, bytes = 1024): File {
  const payload = new TextEncoder().encode(name)
  const content = new Uint8Array(Math.max(bytes, payload.byteLength))
  content.set(payload)
  return new File([content], name, { type: 'application/pdf' })
}

/** Der Dateiname aus der base64-Nutzlast, die `extractInvoiceData` übergeben bekommt. */
function filenameOf(pdfBase64: string): string {
  return Buffer.from(pdfBase64, 'base64').toString('utf8').replace(/\0+$/, '')
}

/** Eine gelesene Rechnung mit genau den Feldern, die der Test braucht. */
function extraction(rates: Record<string, number> = {}, head: Record<string, unknown> = {}) {
  return {
    ok: true,
    extraction: {
      netzbetreiber: 'wiener_netze',
      netzebene: 5,
      meteringVariant: null,
      annualConsumptionKwh: null,
      billingPeriodFrom: null,
      billingPeriodTo: null,
      billingPeriodAssumed: null,
      ...head,
      rates: {
        leistungspreisEurPerKwYear: null,
        minBillableKw: null,
        arbeitspreisNetzCtPerKwh: null,
        energyPriceCtPerKwh: null,
        energyPriceNightCtPerKwh: null,
        einspeiseverguetungCtPerKwh: null,
        supplierBaseFeeEurPerMonth: null,
        ...rates,
      },
    },
  }
}

function withInvoiceWrappers() {
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'list_metering_points') {
      return {
        data: {
          status: 'ok',
          metering_points: [{ id: POINT_ID, draft }],
        },
        error: null,
      }
    }
    if (fn === 'update_metering_point_draft') {
      // ⚠ ERSETZEN, nicht verschmelzen — genau die Semantik des Wrappers.
      draft = args.p_draft as Record<string, unknown>
      return { data: { status: 'ok' }, error: null }
    }
    throw new Error(`unerwarteter Wrapper: ${fn}`)
  })
}

function invoiceForm(files: File[]): FormData {
  const fd = new FormData()
  fd.set('projectId', PROJECT_ID)
  fd.set('meteringPointId', POINT_ID)
  for (const file of files) fd.append('files', file)
  return fd
}

/** Die gespeicherten Einträge aus dem zuletzt geschriebenen Entwurf. */
function storedEntries(): { documentId: string; filename: string }[] {
  const raw = draft._invoiceExtractions
  return Array.isArray(raw) ? (raw as { documentId: string; filename: string }[]) : []
}

describe('uploadMeteringPointInvoicesAction', () => {
  beforeEach(() => {
    draft = {}
    withInvoiceWrappers()
    /*
     * Die Kennung leitet sich aus dem DATEINAMEN ab, nicht aus einem Aufrufzähler: die Uploads
     * laufen nebenläufig, ein Zähler ordnete also der falschen Datei die falsche Kennung zu.
     */
    uploadProjectDocument.mockImplementation(async (_projectId: string, file: { name: string }) => ({
      ok: true,
      documentId: `doc-${file.name}`,
      storagePath: `${PROJECT_ID}/doc-${file.name}`,
    }))
    extractInvoiceData.mockImplementation(async () => extraction())
  })

  it('liest eine Datei, legt sie ab und schreibt die Werte in den Entwurf', async () => {
    extractInvoiceData.mockResolvedValue(extraction({ energyPriceCtPerKwh: 24.5 }))

    const state = await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('Jahr 2025.pdf')]))

    expect(state.success).toContain('Eine Rechnung gelesen')
    expect(state.fieldErrors).toBeUndefined()
    expect(uploadProjectDocument).toHaveBeenCalledTimes(1)
    expect(extractInvoiceData).toHaveBeenCalledTimes(1)

    // Der Seiteneintrag trägt die Ablage-Kennung und den Dateinamen …
    expect(storedEntries()).toHaveLength(1)
    expect(storedEntries()[0]).toMatchObject({
      documentId: 'doc-Jahr 2025.pdf',
      filename: 'Jahr 2025.pdf',
    })
    // … und der gelesene Wert steht als Contract-Feld daneben.
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
    // ⚠ Die Netzebene als „NE X", nicht als Zahl — sonst wäre der Entwurf dauerhaft ungültig.
    expect(draft.netzebene).toBe('NE 5')
    // `netzbetreiber` ist kein Contract-Feld und steht deshalb NICHT im Entwurf.
    expect(draft.netzbetreiber).toBeUndefined()

    expect(revalidatePath).toHaveBeenCalledWith(
      `/admin/kalkulator-projekte/${PROJECT_ID}/dateneingabe`,
    )
  })

  it('verarbeitet mehrere Dateien in EINEM Vorgang', async () => {
    const state = await uploadMeteringPointInvoicesAction(
      {},
      invoiceForm([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]),
    )

    expect(state.success).toContain('3 Rechnungen gelesen')
    expect(state.success).toContain('Es liegen jetzt 3 Rechnungen')
    expect(uploadProjectDocument).toHaveBeenCalledTimes(3)
    expect(extractInvoiceData).toHaveBeenCalledTimes(3)
    expect(storedEntries().map((entry) => entry.filename)).toEqual(['a.pdf', 'b.pdf', 'c.pdf'])

    // ⚠ EIN Schreibvorgang, nicht drei: der Seiteneintrag und die übernommenen Werte gehören
    // zusammen, und `update_metering_point_draft` ERSETZT ohnehin.
    const writes = rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')
    expect(writes).toHaveLength(1)
  })

  it('⚠ weist mehr als MAX_INVOICES_PER_UPLOAD ab, OHNE etwas zu speichern', async () => {
    const files = Array.from({ length: MAX_INVOICES_PER_UPLOAD + 1 }, (_, i) => pdf(`r${i}.pdf`))

    const state = await uploadMeteringPointInvoicesAction({}, invoiceForm(files))

    expect(state.fieldErrors?.files).toContain(String(MAX_INVOICES_PER_UPLOAD))
    expect(state.fieldErrors?.files).toContain('nichts hochgeladen')
    expect(state.success).toBeUndefined()

    // Nicht die ersten zwölf: eine abgelegte und gelesene Datei ist bezahlt.
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(extractInvoiceData).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('benennt einen falschen Medientyp je Datei — ohne sie hochzuladen', async () => {
    const foto = new File([new Uint8Array(1024)], 'foto.png', { type: 'image/png' })

    const state = await uploadMeteringPointInvoicesAction({}, invoiceForm([foto]))

    expect(state.fieldErrors?.files).toContain('foto.png')
    expect(state.fieldErrors?.files).toContain('Nur PDF')
    // Die Prüfung läuft VOR jedem Netzweg und vor jedem abrechenbaren Aufruf.
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(extractInvoiceData).not.toHaveBeenCalled()
    // Nichts zu speichern — der Entwurf wird gar nicht erst gelesen.
    expect(rpc).not.toHaveBeenCalled()
  })

  it('benennt eine zu grosse Datei je Datei — ohne sie hochzuladen', async () => {
    const zuGross = pdf('scan.pdf', MAX_INVOICE_FILE_BYTES + 1)

    const state = await uploadMeteringPointInvoicesAction({}, invoiceForm([zuGross]))

    expect(state.fieldErrors?.files).toContain('scan.pdf')
    expect(state.fieldErrors?.files).toContain('Grösser als')
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(extractInvoiceData).not.toHaveBeenCalled()
  })

  // ── Der geforderte Teilausfall ───────────────────────────────────────────────────────────────
  it('⚠ lässt EINEN Fehlschlag die übrigen Dateien NICHT blockieren', async () => {
    extractInvoiceData.mockImplementation(async (pdfBase64: string) => {
      // Genau EINE Datei ist unlesbar — erkannt an ihrem Inhalt, nicht an der Aufrufreihenfolge.
      if (filenameOf(pdfBase64) === 'kaputt.pdf') return { ok: false, reason: 'unreadable' }
      return extraction({ energyPriceCtPerKwh: 24.5 })
    })

    const state = await uploadMeteringPointInvoicesAction(
      {},
      invoiceForm([pdf('gut-1.pdf'), pdf('kaputt.pdf'), pdf('gut-2.pdf')]),
    )

    // Erfolg UND Fehlermeldung nebeneinander — beides ist wahr.
    expect(state.success).toContain('2 Rechnungen gelesen')
    expect(state.fieldErrors?.files).toContain('kaputt.pdf')
    expect(state.fieldErrors?.files).not.toContain('gut-1.pdf')

    expect(storedEntries().map((entry) => entry.filename)).toEqual(['gut-1.pdf', 'gut-2.pdf'])
    // Die zwei gelesenen Rechnungen sind gespeichert, der Wert steht im Entwurf.
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
  })

  it('⚠ ERGÄNZT beim zweiten Vorgang, statt die bestehende Liste zu ersetzen', async () => {
    extractInvoiceData.mockResolvedValue(extraction({ energyPriceCtPerKwh: 24.5 }))
    await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('erste.pdf')]))
    expect(storedEntries()).toHaveLength(1)

    // Zweiter Vorgang, andere Datei — dieselben Werte, also kein Widerspruch.
    extractInvoiceData.mockResolvedValue(
      extraction({ energyPriceCtPerKwh: 24.5, leistungspreisEurPerKwYear: 38.52 }),
    )
    const state = await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('zweite.pdf')]))

    expect(state.success).toContain('Eine Rechnung gelesen')
    expect(state.success).toContain('Es liegen jetzt 2 Rechnungen')
    expect(storedEntries().map((entry) => entry.filename)).toEqual(['erste.pdf', 'zweite.pdf'])

    // ⚠ Der Merge läuft über ALTE UND NEUE Extraktionen: das nur in der zweiten Rechnung
    // enthaltene Feld kommt dazu, das übereinstimmende bleibt.
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
    expect(draft.leistungspreisEurPerKwYear).toBe(38.52)
  })

  it('⚠ lässt einen WIDERSPRUCH den zuvor gesetzten Wert NICHT überschreiben', async () => {
    extractInvoiceData.mockResolvedValue(extraction({ energyPriceCtPerKwh: 24.5 }))
    await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('erste.pdf')]))
    expect(draft.energyPriceCtPerKwh).toBe(24.5)

    // Die zweite Rechnung sagt etwas anderes — der Merge setzt das Feld auf `null`, und
    // `invoiceDraftValues` lässt es weg.
    extractInvoiceData.mockResolvedValue(extraction({ energyPriceCtPerKwh: 26.9 }))
    const state = await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('zweite.pdf')]))

    expect(state.success).toContain('widersprechen einander')
    expect(state.success).toContain('NICHT übernommen')

    // ⚠ Der Wert von vorher steht UNVERÄNDERT — weder gelöscht noch mit 26,9 überschrieben.
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
    // Der übereinstimmende Teil bleibt ebenfalls stehen.
    expect(draft.netzebene).toBe('NE 5')
    // Und beide Belege liegen am Zählpunkt.
    expect(storedEntries()).toHaveLength(2)
  })

  it('fragt die Datenbank gar nicht erst, wenn keine Datei ausgewählt wurde', async () => {
    // ⚠ Ein leeres Mehrfach-Dateifeld schickt dennoch EINEN Eintrag mit Grösse 0.
    const fd = invoiceForm([])
    fd.append('files', new File([], '', { type: 'application/pdf' }))

    const state = await uploadMeteringPointInvoicesAction({}, fd)

    expect(state.fieldErrors?.files).toContain('mindestens eine PDF-Rechnung')
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('meldet ein verschwundenes Projekt als solches, nicht als Problem der Datei', async () => {
    uploadProjectDocument.mockResolvedValue({ ok: false, reason: 'not_found' })

    const state = await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('a.pdf')]))

    expect(state.formError).toBeDefined()
    expect(state.fieldErrors).toBeUndefined()
    // Ein Teilerfolg wäre eine Behauptung: keine der Dateien kann angekommen sein.
    expect(extractInvoiceData).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('gibt eine entzogene Rolle als solche zurück, ohne den Entwurf anzufassen', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })

    const state = await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('a.pdf')]))

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('fragt die Datenbank gar nicht erst, wenn die Kennungen unbrauchbar sind', async () => {
    const fd = invoiceForm([pdf('a.pdf')])
    fd.set('meteringPointId', 'x')

    const state = await uploadMeteringPointInvoicesAction({}, fd)

    expect(state.formError).toBeDefined()
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * B24, Teil 1 — EINE gelesene Rechnung zurücknehmen
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Drei Eigenschaften, und keine davon ist am Rückgabewert allein erkennbar:
 *
 *   1. DIE ZUSAMMENFÜHRUNG LÄUFT ÜBER DIE VERBLIEBENEN, nicht über die alte Liste. Sichtbar wird
 *      das nur, wenn das Entfernen einen WIDERSPRUCH auflöst: dann — und nur dann — ändert sich
 *      ein Wert im Entwurf. Ein Test über zwei einige Rechnungen bliebe grün, auch wenn die
 *      Zusammenführung gar nicht erneut liefe.
 *   2. ES WIRD NICHTS AUFGERÄUMT. Ein Feld, dessen einzige Stütze die entfernte Rechnung war,
 *      bleibt STEHEN (dieselbe schonende Richtung wie bei einem Widerspruch). Das ist eine
 *      Entscheidung, keine Nachlässigkeit — der Test hält sie fest, damit sie niemand „repariert".
 *   3. EIN UNBEKANNTER EINTRAG SCHREIBT NICHTS. Zweiter Klick, zweiter Tab: das Ziel ist bereits
 *      hergestellt, und ein Schreibvorgang über eine unveränderte Liste wäre eine Änderung, die
 *      keine ist.
 */
describe('removeMeteringPointInvoiceAction', () => {
  beforeEach(() => {
    draft = {}
    withInvoiceWrappers()
    uploadProjectDocument.mockImplementation(async (_projectId: string, file: { name: string }) => ({
      ok: true,
      documentId: `doc-${file.name}`,
      storagePath: `${PROJECT_ID}/doc-${file.name}`,
    }))
    extractInvoiceData.mockImplementation(async () => extraction())
  })

  /** Legt drei gelesene Rechnungen an — nacheinander, wie es real geschieht. */
  async function seedThree(): Promise<void> {
    // Die erste setzt beide Werte: Arbeitspreis 24,5 und einen Leistungspreis, den nur SIE trägt.
    extractInvoiceData.mockResolvedValue(
      extraction({ energyPriceCtPerKwh: 24.5, leistungspreisEurPerKwYear: 38.52 }),
    )
    await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('a.pdf')]))

    // Die zweite und dritte widersprechen ihr beim Arbeitspreis — und sind sich untereinander einig.
    extractInvoiceData.mockResolvedValue(extraction({ energyPriceCtPerKwh: 26.9 }))
    await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('b.pdf')]))
    await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('c.pdf')]))
  }

  function removeForm(documentId: string): FormData {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    fd.set('documentId', documentId)
    return fd
  }

  it('⚠ führt NUR die verbliebenen Rechnungen zusammen — ein aufgelöster Widerspruch wirkt', async () => {
    await seedThree()

    // Ausgangslage: der Widerspruch hat den zuerst übernommenen Wert stehen lassen.
    expect(storedEntries()).toHaveLength(3)
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
    expect(draft.leistungspreisEurPerKwYear).toBe(38.52)

    rpc.mockClear()
    revalidatePath.mockClear()

    const state = await removeMeteringPointInvoiceAction({}, removeForm('doc-a.pdf'))

    expect(state.formError).toBeUndefined()
    expect(state.success).toContain('a.pdf')
    expect(state.success).toContain('Es liegen jetzt 2 Rechnungen')
    expect(state.success).toContain('bleibt in der Dokumentenliste')

    expect(storedEntries().map((entry) => entry.filename)).toEqual(['b.pdf', 'c.pdf'])

    /*
     * ⚠ DER KERN: b und c sind sich einig, der Widerspruch ist mit a verschwunden — der Wert
     * wechselt auf 26,9. Liefe die Zusammenführung noch über alle drei, stünde hier weiterhin 24,5.
     */
    expect(draft.energyPriceCtPerKwh).toBe(26.9)

    /*
     * ⚠ POSITIV-KONTROLLE zur bewussten Nicht-Bereinigung: den Leistungspreis trug AUSSCHLIESSLICH
     * die entfernte Rechnung. Er steht unverändert im Entwurf.
     */
    expect(draft.leistungspreisEurPerKwYear).toBe(38.52)

    // EIN Schreibvorgang — die gekürzte Liste und die neuen Werte gehören zusammen.
    const writes = rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')
    expect(writes).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledWith(
      `/admin/kalkulator-projekte/${PROJECT_ID}/dateneingabe`,
    )
  })

  it('⚠ lässt beim Entfernen der LETZTEN Rechnung die übernommenen Angaben stehen', async () => {
    extractInvoiceData.mockResolvedValue(extraction({ energyPriceCtPerKwh: 24.5 }))
    await uploadMeteringPointInvoicesAction({}, invoiceForm([pdf('einzige.pdf')]))
    expect(draft.energyPriceCtPerKwh).toBe(24.5)

    const state = await removeMeteringPointInvoiceAction({}, removeForm('doc-einzige.pdf'))

    expect(state.success).toContain('keine gelesene Rechnung mehr')
    expect(storedEntries()).toHaveLength(0)
    // Der Wert bleibt — er kann inzwischen von Hand geprüft worden sein.
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
    expect(draft.netzebene).toBe('NE 5')
  })

  it('⚠ schreibt NICHTS, wenn der Eintrag schon weg ist — rendert die Station aber neu', async () => {
    await seedThree()
    const before = JSON.stringify(draft)

    rpc.mockClear()
    revalidatePath.mockClear()

    const state = await removeMeteringPointInvoiceAction({}, removeForm('doc-gibt-es-nicht.pdf'))

    expect(state.success).toBeUndefined()
    expect(state.formError).toContain('nicht (mehr) an diesem Zählpunkt')
    expect(rpc).not.toHaveBeenCalledWith('update_metering_point_draft', expect.anything())
    expect(JSON.stringify(draft)).toBe(before)

    // Die angezeigte Liste ist veraltet — ohne Neurendern liefe derselbe Klick beliebig oft hierher.
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('gibt eine entzogene Rolle als solche zurück, ohne den Entwurf anzufassen', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })

    const state = await removeMeteringPointInvoiceAction({}, removeForm('doc-a.pdf'))

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('fragt die Datenbank gar nicht erst, wenn eine Kennung fehlt', async () => {
    const badPoint = removeForm('doc-a.pdf')
    badPoint.set('meteringPointId', 'x')
    expect((await removeMeteringPointInvoiceAction({}, badPoint)).formError).toBeDefined()

    const badProject = removeForm('doc-a.pdf')
    badProject.set('projectId', 'x')
    expect((await removeMeteringPointInvoiceAction({}, badProject)).formError).toBeDefined()

    const noDocument = removeForm('   ')
    expect((await removeMeteringPointInvoiceAction({}, noDocument)).formError).toBeDefined()

    expect(rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

/**
 * B24, Teil 1 — die MANUELLE Tarifeingabe.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST: EIN LEERES FELD IST KEINE ANGABE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `update_metering_point_draft` ERSETZT den Entwurf. Wer die sieben Formularfelder unbesehen
 * hineinfaltet, schreibt für jedes leer gelassene ein `null` — und löscht damit genau die Angaben,
 * die eine zuvor gelesene Rechnung beigesteuert hat. Der Aufruf meldete dabei Erfolg, die Station
 * zeigte anschliessend eine leere Zeile, und niemand könnte sagen, wodurch sie leer wurde.
 *
 * Der Fall ist der REGELFALL dieses Formulars, nicht sein Randfall: Wer am Telefon vorliest, hat
 * selten alle sieben Zahlen vor sich. Der Test füllt deshalb ZWEI von sieben und misst beides —
 * dass die zwei ankommen UND dass die fünf übrigen den Bestand unberührt lassen.
 *
 * Der Entwurf ist derselbe zustandsbehaftete Nachbau wie oben (`withInvoiceWrappers`): ein Mock,
 * der immer einen leeren Entwurf liefert, könnte „bleibt unverändert" gar nicht messen.
 */
describe('saveMeteringPointManualTariffAction — zwei von sieben Feldern', () => {
  /** Ein bereits gelesener Stand, wie ihn der Rechnungs-Upload hinterlässt. */
  const EXISTING = {
    energyPriceCtPerKwh: 24.5,
    einspeiseverguetungCtPerKwh: 8,
    annualConsumptionKwh: 88426,
    netzebene: 'NE 5',
    _provenance: {
      energyPriceCtPerKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
      einspeiseverguetungCtPerKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
      annualConsumptionKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
      netzebene: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
    },
  }

  function manualForm(fields: Record<string, string>): FormData {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    // Genau das, was das Formular sendet: ALLE Felder, die meisten davon leer.
    fd.set('operatorId', 'wiener_netze')
    fd.set('netzebene', '')
    fd.set('meteringVariant', '')
    for (const key of [
      'energyPriceCtPerKwh',
      'energyPriceNightCtPerKwh',
      'einspeiseverguetungCtPerKwh',
      'supplierBaseFeeEurPerMonth',
      'leistungspreisEurPerKwYear',
      'minBillableKw',
      'annualConsumptionKwh',
    ]) {
      fd.set(key, '')
    }
    for (const [key, value] of Object.entries(fields)) fd.set(key, value)
    return fd
  }

  beforeEach(() => {
    draft = { ...EXISTING }
    withInvoiceWrappers()
  })

  it('⚠ schreibt GENAU die zwei gefüllten Felder und lässt die übrigen unverändert', async () => {
    const before = JSON.parse(JSON.stringify(draft))

    const state = await saveMeteringPointManualTariffAction(
      {},
      // Dezimalkomma, wie ein deutschsprachiges Formular es liefert.
      manualForm({ leistungspreisEurPerKwYear: '38,52', minBillableKw: '0' }),
    )

    expect(state.formError).toBeUndefined()
    expect(state.fieldErrors).toBeUndefined()
    expect(state.success).toContain('2 Angaben wurden übernommen')

    // GENAU EIN Schreibvorgang — der Wrapper ERSETZT, zwei Aufrufe nähmen einander die Arbeit weg.
    const writes = rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')
    expect(writes).toHaveLength(1)

    // Die zwei eingetippten Werte stehen da, als ZAHL (nicht als Zeichenkette).
    expect(draft.leistungspreisEurPerKwYear).toBe(38.52)
    expect(draft.minBillableKw).toBe(0)

    // ⚠ Die fünf leer gelassenen Felder sind NICHT als `null` geschrieben worden — sie kommen im
    // Entwurf überhaupt nicht vor bzw. tragen unverändert ihren alten Wert.
    expect(draft).not.toHaveProperty('energyPriceNightCtPerKwh')
    expect(draft).not.toHaveProperty('supplierBaseFeeEurPerMonth')
    expect(draft.energyPriceCtPerKwh).toBe(before.energyPriceCtPerKwh)
    expect(draft.einspeiseverguetungCtPerKwh).toBe(before.einspeiseverguetungCtPerKwh)
    expect(draft.annualConsumptionKwh).toBe(before.annualConsumptionKwh)
    expect(draft.netzebene).toBe(before.netzebene)

    // Auch die Herkunftsvermerke der Bestandsfelder bleiben, wie sie waren — ein neu gesetzter
    // Zeitstempel behauptete, die Angabe sei gerade erst abgelesen worden.
    const provenance = draft._provenance as Record<string, { source: string; at: string }>
    expect(provenance.energyPriceCtPerKwh).toEqual(before._provenance.energyPriceCtPerKwh)
    expect(provenance.annualConsumptionKwh).toEqual(before._provenance.annualConsumptionKwh)

    // Die zwei neuen tragen `measured`: abgetippt ist dieselbe Herkunft wie abgelesen (Delta §3.2).
    expect(provenance.leistungspreisEurPerKwYear?.source).toBe('measured')
    expect(provenance.minBillableKw?.source).toBe('measured')

    // ⚠ `netzbetreiber` wird NICHT geschrieben, obwohl das Formular danach fragt: er ist kein
    // `tariffParamsSchema`-Feld und verschwände beim nächsten Auswerten stillschweigend.
    expect(draft).not.toHaveProperty('netzbetreiber')
    expect(JSON.stringify(draft)).not.toContain('wiener_netze')
  })

  it('schreibt GAR NICHTS, wenn kein einziges Feld gefüllt ist', async () => {
    const state = await saveMeteringPointManualTariffAction({}, manualForm({}))

    expect(state.formError).toContain('mindestens einen Wert')
    // Nicht einmal gelesen: ohne Angabe gibt es nichts zu tun.
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })

  it('bricht VOR jedem Schreibvorgang ab, wenn eine Eingabe unbrauchbar ist', async () => {
    const state = await saveMeteringPointManualTariffAction(
      {},
      manualForm({ leistungspreisEurPerKwYear: '38,52', minBillableKw: '-3' }),
    )

    expect(state.fieldErrors?.minBillableKw).toBeDefined()
    // Auch der gültige zweite Wert bleibt liegen — ein halb übernommenes Formular wäre der
    // Zustand, den niemand nachvollziehen kann.
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })
})

/**
 * B24, Teil 1 — die BATTERIE-Station.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST: ZWEI ACTIONS AUF EINEM FORMULAR
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der Ja-Zweig trägt „Auslesen" und „Speichern" auf DEMSELBEN Formular. Genau diese Konstruktion
 * ist bei der Rechnungs-Station ein gemessener Defekt gewesen (PR #200): React setzt
 * UNKONTROLLIERTE Formularfelder nach JEDER abgeschlossenen Action zurück, nicht nur nach der
 * gemeinten — der Vorschlagen-Knopf löschte die Angaben, aus denen der Vorschlag gebildet wurde.
 *
 * Die Felder sind deshalb hier von Anfang an kontrolliert. Was ein Unit-Test davon messen kann, ist
 * nicht das React-Verhalten (`apps/web` hat kein Renderer-Setup), sondern die Bedingung, unter der
 * die Oberfläche es überhaupt halten kann: die LESE-Action darf nichts schreiben, und die
 * SPEICHER-Action muss genau die Werte übernehmen, die nach ihr im Formular stehen. Der Test fährt
 * beide NACHEINANDER auf demselben Wertesatz — der Durchstich, den die Aufgabenstellung als
 * Positiv-Kontrolle gegen jenen Defekt verlangt.
 *
 * Die zweite Eigenschaft, die nur hier messbar ist: der NEIN-Zweig schreibt GENAU EIN Feld. Fiele
 * dort ein Batteriefeld mit hinein, wäre das eine Angabe über eine Anlage, die es nicht gibt.
 */
describe('Batterie-Station', () => {
  /** Ein bereits gelesener Stand, wie ihn die Rechnungs-Station hinterlässt. */
  const EXISTING = {
    energyPriceCtPerKwh: 24.5,
    _provenance: {
      energyPriceCtPerKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
    },
  }

  /** Genau das, was das Formular sendet: alle vier Felder, die meisten davon leer. */
  function batteryForm(fields: Record<string, string> = {}): FormData {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    fd.set('batteryText', '')
    for (const key of ['capacityKwh', 'maxPowerKw', 'roundTripEfficiencyPercent', 'pricePerKwh']) {
      fd.set(key, '')
    }
    for (const [key, value] of Object.entries(fields)) fd.set(key, value)
    return fd
  }

  beforeEach(() => {
    draft = { ...EXISTING }
    withInvoiceWrappers()
  })

  it('⚠ Auslesen und Speichern nacheinander: die gelesenen Werte überstehen den zweiten Aufruf', async () => {
    extractBatteryText.mockResolvedValue({
      ok: true,
      extraction: {
        // ⚠ Wird bewusst VERWORFEN: die Wizard-Frage oben ist bereits die Antwort.
        hasExistingBattery: true,
        capacityKwh: 19.2,
        maxPowerKw: 10.6,
        roundTripEfficiencyPercent: 90,
        // Nicht genannt — das Feld muss danach LEER sein, nicht „irgendein alter Wert".
        pricePerKwh: null,
      },
    })

    // ── Schritt 1: auslesen ──────────────────────────────────────────────────────────────────
    const read = await extractBatteryTextFromAction(
      {},
      batteryForm({ batteryText: 'Sungrow, 19,2 kWh nutzbar, 10,6 kW, rund 90 %' }),
    )

    expect(read.formError).toBeUndefined()
    expect(read.fieldErrors).toBeUndefined()
    // ⚠ DIE LESE-ACTION SCHREIBT NICHTS — kein Wrapper, kein Neurendern.
    expect(rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)

    // Deutsches Dezimalkomma, damit der eigene Zahlenleser den Vorschlag auch annimmt.
    expect(read.values?.capacityKwh).toBe('19,2')
    expect(read.values?.maxPowerKw).toBe('10,6')
    expect(read.values?.roundTripEfficiencyPercent).toBe('90')
    // Nicht gelesen ⇒ ausdrücklich leer, nicht abwesend.
    expect(read.values?.pricePerKwh).toBe('')
    expect(read.values?.found).toBe('3')
    // `hasExistingBattery` erreicht kein Feld — es steht nirgends in der Antwort.
    expect(JSON.stringify(read.values)).not.toContain('hasExistingBattery')

    // ── Schritt 2: DIESELBEN Werte speichern (so, wie sie danach im Formular stehen) ─────────
    const save = await saveMeteringPointBatteryAction(
      {},
      batteryForm({
        batteryText: 'Sungrow, 19,2 kWh nutzbar, 10,6 kW, rund 90 %',
        capacityKwh: read.values?.capacityKwh ?? '',
        maxPowerKw: read.values?.maxPowerKw ?? '',
        roundTripEfficiencyPercent: read.values?.roundTripEfficiencyPercent ?? '',
        pricePerKwh: read.values?.pricePerKwh ?? '',
      }),
    )

    expect(save.formError).toBeUndefined()
    expect(save.fieldErrors).toBeUndefined()
    expect(save.success).toContain('3 Angaben')

    // ⚠ POSITIV-KONTROLLE gegen den PR-#200-Defekt: die drei gelesenen Zahlen kommen als ZAHLEN an.
    expect(draft.existingBatteryCapacityKwh).toBe(19.2)
    expect(draft.existingBatteryMaxPowerKw).toBe(10.6)
    expect(draft.existingBatteryRoundTripEfficiencyPercent).toBe(90)
    // Der nicht gelesene Preis bleibt leer und wird NICHT als `null` geschrieben.
    expect(draft).not.toHaveProperty('existingBatteryPricePerKwh')

    expect(draft.hasBattery).toBe(true)
    // Der Bestand der Rechnungs-Station bleibt unberührt.
    expect(draft.energyPriceCtPerKwh).toBe(EXISTING.energyPriceCtPerKwh)

    // GENAU EIN Schreibvorgang — der Wrapper ERSETZT, zwei Aufrufe nähmen einander die Arbeit weg.
    const writes = rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')
    expect(writes).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledTimes(1)

    // Abgetippt ist dieselbe Herkunft wie abgelesen (Delta §3.2).
    const provenance = draft._provenance as Record<string, { source: string }>
    expect(provenance.existingBatteryCapacityKwh?.source).toBe('measured')
    expect(provenance.hasBattery?.source).toBe('measured')
  })

  it('⚠ Nein-Zweig: schreibt AUSSCHLIESSLICH `wantsBatteryRecommendation`', async () => {
    const before = JSON.parse(JSON.stringify(draft))
    const keysBefore = Object.keys(draft)

    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    fd.set('wantsRecommendation', 'ja')

    const state = await saveMeteringPointBatteryChoiceAction({}, fd)

    expect(state.formError).toBeUndefined()
    expect(state.success).toContain('Speichervorschlag')

    expect(draft.wantsBatteryRecommendation).toBe(true)

    // ⚠ KEINES der vier Batteriefelder — und auch kein `hasBattery`: der Nein-Zweig beantwortet
    // eine ANDERE Frage, und ein daraus abgeleitetes „keine Batterie" wäre ein zweites Signal.
    expect(draft).not.toHaveProperty('existingBatteryCapacityKwh')
    expect(draft).not.toHaveProperty('existingBatteryMaxPowerKw')
    expect(draft).not.toHaveProperty('existingBatteryRoundTripEfficiencyPercent')
    expect(draft).not.toHaveProperty('existingBatteryPricePerKwh')
    expect(draft).not.toHaveProperty('hasBattery')

    // Gezählt statt aufgezählt: GENAU EIN neuer Schlüssel neben `_provenance`.
    const added = Object.keys(draft).filter((key) => !keysBefore.includes(key))
    expect(added).toEqual(['wantsBatteryRecommendation'])

    // Der Bestand bleibt unberührt, und es wird genau einmal geschrieben.
    expect(draft.energyPriceCtPerKwh).toBe(before.energyPriceCtPerKwh)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
    // Kein abrechenbarer Aufruf — der Nein-Zweig liest keinen Freitext.
    expect(extractBatteryText).not.toHaveBeenCalled()
  })

  it('⚠ Nein-Zweig: „nein" ist eine ANGABE, kein fehlender Schlüssel', async () => {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    fd.set('wantsRecommendation', 'nein')

    await saveMeteringPointBatteryChoiceAction({}, fd)

    // `false`, nicht `undefined`: „ausdrücklich kein Vorschlag" muss von „nicht gefragt"
    // unterscheidbar bleiben.
    expect(draft.wantsBatteryRecommendation).toBe(false)
    expect(draft).toHaveProperty('wantsBatteryRecommendation')
  })

  it('speichert „es gibt einen Speicher" auch ohne eine einzige Kennzahl', async () => {
    const state = await saveMeteringPointBatteryAction({}, batteryForm())

    expect(state.formError).toBeUndefined()
    expect(state.success).toContain('Kenndaten wurden keine erfasst')
    // ⚠ Anders als bei der manuellen Tarifeingabe: „es gibt einen Speicher" IST eine Angabe, und
    // eine Lücke, die der KI-Check benennen kann, ist nicht dasselbe wie eine ungestellte Frage.
    expect(draft.hasBattery).toBe(true)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
  })

  it('bricht VOR jedem Schreibvorgang ab, wenn eine Eingabe unbrauchbar ist', async () => {
    const state = await saveMeteringPointBatteryAction(
      {},
      // 120 % Wirkungsgrad ist physikalisch unmöglich — die Kapazität daneben ist gültig.
      batteryForm({ capacityKwh: '19,2', roundTripEfficiencyPercent: '120' }),
    )

    expect(state.fieldErrors?.roundTripEfficiencyPercent).toBeDefined()
    expect(state.fieldErrors?.capacityKwh).toBeUndefined()
    // Auch der gültige Wert bleibt liegen — und `hasBattery` ebenfalls.
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })

  it('⚠ eine Ablesung ohne Zahl leert die Felder NICHT, sondern wird als solche gemeldet', async () => {
    /*
     * Der Extraktor meldet `unreadable` nur, wenn ALLE FÜNF Felder leer sind — `hasExistingBattery`
     * eingeschlossen. „Ja, wir haben einen Speicher" liefert damit ein `ok` ohne eine einzige Zahl.
     * Durchgereicht leerte es die vier Felder und behauptete dabei, es habe etwas gelesen.
     */
    extractBatteryText.mockResolvedValue({
      ok: true,
      extraction: {
        hasExistingBattery: true,
        capacityKwh: null,
        maxPowerKw: null,
        roundTripEfficiencyPercent: null,
        pricePerKwh: null,
      },
    })

    const state = await extractBatteryTextFromAction(
      {},
      batteryForm({ batteryText: 'Ja, wir haben einen Speicher.' }),
    )

    expect(state.formError).toContain('keine Kenndaten')
    // Keine Werte ⇒ die Oberfläche fasst die Felder nicht an.
    expect(state.values).toBeUndefined()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('fragt gar nicht erst, wenn nichts eingetragen ist — jeder Aufruf ist abrechenbar', async () => {
    const state = await extractBatteryTextFromAction({}, batteryForm({ batteryText: '   ' }))

    expect(state.fieldErrors?.batteryText).toBeDefined()
    expect(extractBatteryText).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('⚠ kürzt den Freitext VOR dem externen Kontakt, nicht erst im Modell', async () => {
    extractBatteryText.mockResolvedValue({ ok: false, reason: 'unreadable' })

    await extractBatteryTextFromAction(
      {},
      // Das `maxlength` des Textfelds ist eine Angabe des Browsers; die Sperre sitzt hier.
      batteryForm({ batteryText: 'x'.repeat(MAX_BATTERY_TEXT_CHARS + 500) }),
    )

    expect(extractBatteryText).toHaveBeenCalledTimes(1)
    expect(extractBatteryText.mock.calls[0]?.[0]).toHaveLength(MAX_BATTERY_TEXT_CHARS)
  })

  it('nennt jeden Ausfall des Extraktors beim Namen und schreibt nichts', async () => {
    for (const reason of ['not_configured', 'api_error', 'unreadable'] as const) {
      extractBatteryText.mockResolvedValue({ ok: false, reason })
      const state = await extractBatteryTextFromAction({}, batteryForm({ batteryText: 'irgendwas' }))
      expect(state.formError, reason).toBeDefined()
      expect(state.values, reason).toBeUndefined()
    }
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })

  it('weist eine fehlende oder formverletzende Kennung ab, ohne die Datenbank zu fragen', async () => {
    const bad = new FormData()
    bad.set('projectId', 'kein-uuid')
    bad.set('meteringPointId', POINT_ID)
    bad.set('wantsRecommendation', 'ja')
    expect((await saveMeteringPointBatteryChoiceAction({}, bad)).formError).toBeDefined()

    const badPoint = batteryForm()
    badPoint.set('meteringPointId', 'kein-uuid')
    expect((await saveMeteringPointBatteryAction({}, badPoint)).formError).toBeDefined()

    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('PV-Station', () => {
  /** Ein bereits gelesener Stand, wie ihn die Rechnungs-Station hinterlässt. */
  const EXISTING = {
    energyPriceCtPerKwh: 24.5,
    _provenance: {
      energyPriceCtPerKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
    },
  }

  /** Genau das, was die zwei Absendeknöpfe schicken: die zwei Kennungen und die Antwort. */
  function pvForm(answer: string): FormData {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    fd.set('hasPv', answer)
    return fd
  }

  beforeEach(() => {
    draft = { ...EXISTING }
    withInvoiceWrappers()
  })

  it('⚠ „nein" ist eine ANGABE, kein fehlender Schlüssel', async () => {
    const keysBefore = Object.keys(draft)

    const state = await saveMeteringPointPvChoiceAction({}, pvForm('nein'))

    expect(state.formError).toBeUndefined()
    expect(state.success).toBe('Vermerkt: Es gibt keine PV-Anlage.')

    /*
     * ⚠ DIE ZUSAGE DIESES SCHRITTS: `false`, nicht `undefined`. Wäre der Nein-Zweig ein fehlender
     * Schlüssel (wie `hasBattery` es bewusst ist), stellte die Station ihre Frage nach jedem
     * Neuladen erneut — und zwar dem, der sie gerade beantwortet hat.
     */
    expect(draft.hasPv).toBe(false)
    expect(draft).toHaveProperty('hasPv')

    // Gezählt statt aufgezählt: GENAU EIN neuer Schlüssel neben `_provenance`.
    const added = Object.keys(draft).filter((key) => !keysBefore.includes(key))
    expect(added).toEqual(['hasPv'])

    // Der Bestand der Rechnungs-Station bleibt unberührt, und es wird genau einmal geschrieben.
    expect(draft.energyPriceCtPerKwh).toBe(EXISTING.energyPriceCtPerKwh)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledTimes(1)

    // Die Angabe des Kunden ist ein Messwert, keine Annahme (Delta §3.2).
    const provenance = draft._provenance as Record<string, { source: string }>
    expect(provenance.hasPv?.source).toBe('measured')
  })

  it('speichert „ja" und schreibt sonst nichts', async () => {
    const keysBefore = Object.keys(draft)

    const state = await saveMeteringPointPvChoiceAction({}, pvForm('ja'))

    expect(state.formError).toBeUndefined()
    expect(state.success).toBe('Vermerkt: Es gibt bereits eine PV-Anlage.')
    expect(draft.hasPv).toBe(true)

    /*
     * ⚠ Der Ja-Zweig erhebt in diesem Bauschritt NICHTS über die Erzeugung. Ein hier nebenbei
     * geschriebenes Profil-Feld wäre eine Aussage über eine Kurve, die niemand hochgeladen hat.
     */
    const added = Object.keys(draft).filter((key) => !keysBefore.includes(key))
    expect(added).toEqual(['hasPv'])
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
  })

  it('⚠ eine geänderte Antwort ÜBERSCHREIBT die frühere', async () => {
    // Es gibt für diese Angabe keinen Entfernen-Weg — wer sich vertippt, muss die andere Antwort
    // nachlegen können, und danach darf genau EIN Wert dastehen.
    await saveMeteringPointPvChoiceAction({}, pvForm('ja'))
    expect(draft.hasPv).toBe(true)

    await saveMeteringPointPvChoiceAction({}, pvForm('nein'))
    expect(draft.hasPv).toBe(false)

    // Der Wrapper ERSETZT den Entwurf — die Angabe der Rechnungs-Station muss beide Läufe
    // überstehen, sonst hätte der zweite Klick sie mitgenommen.
    expect(draft.energyPriceCtPerKwh).toBe(EXISTING.energyPriceCtPerKwh)
  })

  it('weist eine unbekannte Antwort ab, ohne die Datenbank zu fragen', async () => {
    /*
     * Über die zwei Knöpfe unerreichbar (sie schicken feste Werte) — erreichbar an ihnen vorbei.
     * Still verworfen stünde danach eine Erfolgsmeldung über einem unveränderten Entwurf.
     */
    for (const answer of ['', 'vielleicht', 'true']) {
      expect((await saveMeteringPointPvChoiceAction({}, pvForm(answer))).formError).toBeDefined()
    }
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })

  it('weist eine formverletzende Kennung ab, ohne die Datenbank zu fragen', async () => {
    const badProject = pvForm('ja')
    badProject.set('projectId', 'kein-uuid')
    expect((await saveMeteringPointPvChoiceAction({}, badProject)).formError).toBeDefined()

    const badPoint = pvForm('ja')
    badPoint.set('meteringPointId', 'kein-uuid')
    expect((await saveMeteringPointPvChoiceAction({}, badPoint)).formError).toBeDefined()

    expect(rpc).not.toHaveBeenCalled()
  })
})
