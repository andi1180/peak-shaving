import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ⚠ Beide Grenzen kommen aus ihrem echten Fundort, nicht als abgetippte Zahl: ein Test, der 12 und
 * 6 MB selbst behauptet, bliebe grün, wenn die Anwendung gegen andere Werte prüft — und misst dann
 * eine Grenze, die es in Produktion nicht gibt.
 */
import { MAX_INVOICE_FILE_BYTES } from 'extractors'
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
}))
vi.mock('@/lib/project-documents/documents', () => ({
  uploadProjectDocument: (projectId: string, file: unknown) =>
    uploadProjectDocument(projectId, file),
}))
vi.mock('@/lib/project-documents/storage', () => ({
  removeProjectDocumentBytes: (path: string) => removeProjectDocumentBytes(path),
}))

const { removeMeteringPointLoadProfileAction, uploadMeteringPointInvoicesAction } = await import(
  './data-entry-actions'
)

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
