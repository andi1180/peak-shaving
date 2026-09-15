import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * ⚠ Beide Grenzen kommen aus ihrem echten Fundort, nicht als abgetippte Zahl: ein Test, der 12 und
 * 6 MB selbst behauptet, bliebe grün, wenn die Anwendung gegen andere Werte prüft — und misst dann
 * eine Grenze, die es in Produktion nicht gibt.
 */
import { MAX_BATTERY_TEXT_CHARS, MAX_INVOICE_FILE_BYTES } from 'extractors'
/*
 * Dieselbe Regel für die PV-Grenze: `MAX_PV_PROFILE_BYTES` der Action IST
 * `MAX_PROJECT_DOCUMENT_BYTES` (die ABLAGE ist die kleinere von zwei Grenzen). Hier steht
 * deshalb die Quelle und keine zweite Zahl.
 */
import { MAX_PROJECT_DOCUMENT_BYTES } from 'shared'
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
const extractPvDesign = vi.fn()

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
  extractPvDesign: (base64: string) => extractPvDesign(base64),
}))
vi.mock('@/lib/project-documents/documents', () => ({
  uploadProjectDocument: (projectId: string, file: unknown) =>
    uploadProjectDocument(projectId, file),
}))
vi.mock('@/lib/project-documents/storage', () => ({
  removeProjectDocumentBytes: (path: string) => removeProjectDocumentBytes(path),
}))

const {
  addPvArraysFromScanAction,
  deleteMeteringPointBatteryAction,
  extractBatteryTextFromAction,
  removeMeteringPointInvoiceAction,
  removeMeteringPointLoadProfileAction,
  saveMeteringPointBatteryAction,
  saveMeteringPointBatteryChoiceAction,
  saveMeteringPointManualTariffAction,
  saveMeteringPointPvArrayAction,
  saveMeteringPointPvChoiceAction,
  scanPvDesignAction,
  uploadMeteringPointInvoicesAction,
  uploadMeteringPointPvProfileAction,
} = await import('./data-entry-actions')

/*
 * ⚠ AUS DEM MODUL, NICHT AUS DEM BARREL — und das ist kein Umweg, sondern die Zusage selbst:
 * `data-entry-actions.ts` re-exportiert `./data-entry-actions-shared` bewusst NICHT (dort stünde
 * jeder Helfer über den Barrel erreichbar, obwohl ihn ausserhalb dieses Verzeichnisses niemand
 * braucht). Ein Test, der ihn über den Barrel zöge, wäre grün — und hätte dabei genau die Grenze
 * aufgeweicht, die er misst.
 */
const { clearMeteringPointDraftFields } = await import('./data-entry-actions-shared')

/*
 * Die Schlüsselliste kommt aus ihrem Fundort, NICHT abgetippt. Eine zweite Liste im Test liefe
 * beim ersten zusätzlichen Kenndatenfeld auseinander — und zwar in die harmlose Richtung: der
 * Test bliebe grün, während der Löschweg das neue Feld stehen liesse. Der Wächter dagegen steht
 * weiter unten und misst die ABLEITUNG selbst.
 */
const { BATTERY_DRAFT_KEYS, BATTERY_VALUE_FIELDS, readBatteryDraft, batteryDraftIsEmpty } =
  await import('./battery-draft')

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
  extractPvDesign.mockReset()
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

/**
 * B24, Teil 1 — der LÖSCHWEG des Entwurfs (`clearMeteringPointDraftFields`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST: „GELÖSCHT" HEISST, DER SCHLÜSSEL IST WEG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Der naheliegende Weg wäre `setDraftField(…, null)` gewesen. Er löscht nichts: der Schlüssel
 * stünde weiterhin im Entwurf, sein Vermerk weiterhin in `_provenance` — und für jeden Leser ist
 * das eine ANGABE, keine Fehlanzeige (`readBatteryDraft` unterscheidet „ausdrücklich keine
 * Anlage" von „dazu ist nichts erfasst", `check_draft_completeness` zählt einen vorhandenen
 * Schlüssel mit). Genau diese Unterscheidung ist gegen ein GLEICHARTIGES Nachbarfeld messbar:
 * verschwindet zu viel, fällt es an ihm auf; verschwindet zu wenig, an den Batterie-Schlüsseln.
 *
 * Die zweite Eigenschaft ist der geteilte RAHMEN: frisch lesen, EINMAL schreiben, neu rendern.
 * Er ist seit dem Löschweg herausgelöst und trägt beide Umformungen — die Fehlerfälle gelten
 * damit für den Schreibweg mit, und ein Rückbau an einer Kopie fiele hier auf.
 */
describe('clearMeteringPointDraftFields — Felder wirklich entfernen', () => {
  /*
   * ⚠ ZWEI GLEICHARTIGE FELDER MIT VERMERK. Das zweite ist die Positiv-Kontrolle: ohne ein
   * Nachbarfeld, das denselben Weg genommen hat, bewiese „der Entwurf ist danach leer" nur, dass
   * überhaupt etwas passiert ist — nicht, dass genau das Genannte verschwindet.
   */
  const EXISTING = {
    existingBatteryCapacityKwh: 19.2,
    energyPriceCtPerKwh: 24.5,
    _provenance: {
      existingBatteryCapacityKwh: { source: 'measured', at: '2026-09-02T08:00:00.000Z' },
      energyPriceCtPerKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
    },
  }

  beforeEach(() => {
    draft = JSON.parse(JSON.stringify(EXISTING))
    withInvoiceWrappers()
  })

  it('⚠ entfernt Feld UND Vermerk — und lässt das Nachbarfeld nachweislich stehen', async () => {
    const failure = await clearMeteringPointDraftFields(
      PROJECT_ID,
      POINT_ID,
      ['existingBatteryCapacityKwh'],
      'Test',
    )

    expect(failure).toBeNull()

    // Der Schlüssel EXISTIERT nicht mehr — `toBeUndefined` allein liesse ein `{key: undefined}`
    // durchgehen, und genau das ist der Zustand, den dieser Weg vermeiden soll.
    expect(draft).not.toHaveProperty('existingBatteryCapacityKwh')
    const provenance = draft._provenance as Record<string, unknown>
    expect(provenance).not.toHaveProperty('existingBatteryCapacityKwh')

    // ⚠ POSITIV-KONTROLLE: das gleichartige Nachbarfeld steht unverändert da, mit seinem Vermerk.
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
    expect(provenance.energyPriceCtPerKwh).toEqual({
      source: 'measured',
      at: '2026-09-01T10:00:00.000Z',
    })

    // GENAU EIN Schreibvorgang — der Wrapper ERSETZT, zwei Aufrufe nähmen einander die Arbeit weg.
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledWith(
      `/admin/kalkulator-projekte/${PROJECT_ID}/dateneingabe`,
    )
  })

  it('entfernt `_provenance` selbst, sobald der letzte Vermerk fällt', async () => {
    await clearMeteringPointDraftFields(
      PROJECT_ID,
      POINT_ID,
      ['existingBatteryCapacityKwh', 'energyPriceCtPerKwh'],
      'Test',
    )

    // Ein Seiteneintrag ohne Einträge ist keine Herkunftsangabe — er sieht nur so aus.
    expect(draft).not.toHaveProperty('_provenance')
    expect(draft).toEqual({})
  })

  it('ein Feld ohne Vermerk und ein gar nicht vorhandenes sind kein Fehler', async () => {
    draft = { existingBatteryCapacityKwh: 19.2, energyPriceCtPerKwh: 24.5 }

    const failure = await clearMeteringPointDraftFields(
      PROJECT_ID,
      POINT_ID,
      // Das erste ist da (ohne Vermerk), das zweite war nie da.
      ['existingBatteryCapacityKwh', 'existingBatteryPricePerKwh'],
      'Test',
    )

    expect(failure).toBeNull()
    expect(draft).toEqual({ energyPriceCtPerKwh: 24.5 })
    // Ein Entwurf ohne `_provenance` bekommt auch keines angehängt.
    expect(draft).not.toHaveProperty('_provenance')
  })

  it('liest FRISCH statt den Stand des Seitenaufbaus zurückzuschreiben', async () => {
    /*
     * `update_metering_point_draft` ERSETZT. Käme der Entwurf aus der Zeit des Renderns, machte
     * jeder Löschklick jede Angabe rückgängig, die seither dazugekommen ist — etwa eine in einem
     * zweiten Tab hochgeladene Rechnung. Gemessen an der Reihenfolge der Wrapper-Aufrufe.
     */
    await clearMeteringPointDraftFields(PROJECT_ID, POINT_ID, ['existingBatteryCapacityKwh'], 'Test')

    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'list_metering_points',
      'update_metering_point_draft',
    ])
  })

  it('meldet eine entzogene Rolle beim Namen — beim Lesen wie beim Schreiben', async () => {
    // (a) schon das Lesen scheitert
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    const onRead = await clearMeteringPointDraftFields(PROJECT_ID, POINT_ID, ['x'], 'Test')
    expect(onRead?.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')

    // (b) gelesen wird, geschrieben nicht — der Entwurf bleibt dabei unangetastet.
    rpc.mockReset()
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_metering_points') {
        return { data: { status: 'ok', metering_points: [{ id: POINT_ID, draft }] }, error: null }
      }
      return { data: null, error: { code: '42501', message: 'denied' } }
    })
    const onWrite = await clearMeteringPointDraftFields(
      PROJECT_ID,
      POINT_ID,
      ['existingBatteryCapacityKwh'],
      'Test',
    )

    expect(onWrite?.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(draft).toEqual(EXISTING)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('weist einen unbekannten Zählpunkt ab, ohne etwas zu schreiben', async () => {
    const failure = await clearMeteringPointDraftFields(
      PROJECT_ID,
      // Formal gültig, in der Liste nicht enthalten.
      '99999999-8888-4777-8666-555555555555',
      ['existingBatteryCapacityKwh'],
      'Test',
    )

    expect(failure?.formError).toContain('Diesen Zählpunkt gibt es nicht')
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(0)
    expect(draft).toEqual(EXISTING)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('behandelt eine unerwartete Wrapper-Antwort als Fehlschlag, nicht als Erfolg', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_metering_points') {
        return { data: { status: 'ok', metering_points: [{ id: POINT_ID, draft }] }, error: null }
      }
      // Kein `error`, aber auch kein `ok` — ohne die Statusprüfung liefe das als Erfolg durch.
      return { data: { status: 'not_found' }, error: null }
    })

    const failure = await clearMeteringPointDraftFields(
      PROJECT_ID,
      POINT_ID,
      ['existingBatteryCapacityKwh'],
      'Test',
    )

    expect(failure?.formError).toBe('Das hat nicht geklappt. Bitte versuchen Sie es erneut.')
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

/**
 * B24, Teil 1 — die Batterie-Angaben wieder ENTFERNEN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ ALLE SECHS SCHLÜSSEL, NICHT NUR DIE VIER KENNDATEN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bliebe `hasBattery: true` stehen, läse der Entwurf danach als „es GIBT einen Speicher, die
 * Kenndaten sind nur noch nicht erfasst" — eine positive Aussage über eine Anlage, zu der nichts
 * mehr dasteht, und die teurere der zwei möglichen Fehlrichtungen: `check_draft_completeness`
 * meldete eine Lücke, die es gar nicht gibt, und die Station stellte ihre Frage nicht erneut.
 *
 * Die zweite Eigenschaft ist der Durchstich bis zur ANZEIGE: nach dem Löschen muss
 * `readBatteryDraft` „nichts erfasst" melden — genau daran hängt, dass die Ja/Nein-Frage der
 * Station wieder erscheint.
 */
describe('deleteMeteringPointBatteryAction', () => {
  /** Ein vollständig erfasster Speicher neben einer Angabe der Rechnungs-Station. */
  const EXISTING = {
    hasBattery: true,
    wantsBatteryRecommendation: false,
    existingBatteryCapacityKwh: 19.2,
    existingBatteryMaxPowerKw: 10.6,
    existingBatteryRoundTripEfficiencyPercent: 90,
    existingBatteryPricePerKwh: 640,
    energyPriceCtPerKwh: 24.5,
    _provenance: {
      hasBattery: { source: 'measured', at: '2026-09-02T08:00:00.000Z' },
      wantsBatteryRecommendation: { source: 'measured', at: '2026-09-02T08:00:00.000Z' },
      existingBatteryCapacityKwh: { source: 'measured', at: '2026-09-02T08:00:00.000Z' },
      existingBatteryMaxPowerKw: { source: 'measured', at: '2026-09-02T08:00:00.000Z' },
      existingBatteryRoundTripEfficiencyPercent: {
        source: 'measured',
        at: '2026-09-02T08:00:00.000Z',
      },
      existingBatteryPricePerKwh: { source: 'measured', at: '2026-09-02T08:00:00.000Z' },
      energyPriceCtPerKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
    },
  }

  function deleteForm(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    for (const [key, value] of Object.entries(overrides)) fd.set(key, value)
    return fd
  }

  beforeEach(() => {
    draft = JSON.parse(JSON.stringify(EXISTING))
    withInvoiceWrappers()
  })

  it('⚠ DIE LISTE IST ABGELEITET, NICHT ABGESCHRIEBEN', () => {
    /*
     * Der Wächter gegen die eine Änderung, die sonst still danebenginge: wer `BATTERY_VALUE_FIELDS`
     * um ein fünftes Kenndatenfeld erweitert, erweitert damit AUTOMATISCH den Löschweg. Eine von
     * Hand gepflegte zweite Liste liesse das neue Feld stehen — die Station zeigte danach eine
     * Zusammenfassung mit genau einem Wert darin, und niemand könnte sagen, woher er kommt.
     */
    for (const entry of BATTERY_VALUE_FIELDS) {
      expect(BATTERY_DRAFT_KEYS, entry.field).toContain(entry.field)
    }
    // Die zwei Ja/Nein-Felder kommen dazu — und sonst nichts.
    expect(BATTERY_DRAFT_KEYS).toHaveLength(BATTERY_VALUE_FIELDS.length + 2)
    expect(BATTERY_DRAFT_KEYS).toContain('hasBattery')
    expect(BATTERY_DRAFT_KEYS).toContain('wantsBatteryRecommendation')
  })

  it('⚠ löscht ALLE sechs Batterie-Schlüssel samt Vermerken — und nur die', async () => {
    const state = await deleteMeteringPointBatteryAction({}, deleteForm())

    expect(state.formError).toBeUndefined()
    expect(state.success).toBe('Batterie-Angaben gelöscht.')

    // Gezählt statt aufgezählt: kein einziger der sechs Schlüssel ist übrig.
    for (const key of BATTERY_DRAFT_KEYS) {
      expect(draft, key).not.toHaveProperty(key)
    }
    const provenance = draft._provenance as Record<string, unknown>
    for (const key of BATTERY_DRAFT_KEYS) {
      expect(provenance, key).not.toHaveProperty(key)
    }

    // ⚠ POSITIV-KONTROLLE: die Rechnungs-Station ist unberührt, samt ihrem Vermerk.
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
    expect(provenance.energyPriceCtPerKwh).toEqual({
      source: 'measured',
      at: '2026-09-01T10:00:00.000Z',
    })
    // Und es bleibt wirklich nur das eine Feld plus sein Vermerk übrig.
    expect(Object.keys(draft).sort()).toEqual(['_provenance', 'energyPriceCtPerKwh'])

    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledWith(
      `/admin/kalkulator-projekte/${PROJECT_ID}/dateneingabe`,
    )
  })

  it('⚠ danach meldet die Zusammenfassung „nichts erfasst" — die Frage erscheint wieder', async () => {
    // Vorher trägt sie nachweislich etwas — ohne diese Zeile bewiese die Gegenprobe nichts.
    expect(batteryDraftIsEmpty(readBatteryDraft(draft))).toBe(false)

    await deleteMeteringPointBatteryAction({}, deleteForm())

    const summary = readBatteryDraft(draft)
    expect(batteryDraftIsEmpty(summary)).toBe(true)
    /*
     * ⚠ `null`, NICHT `false`. Die Zusammenfassung normalisiert einen fehlenden Schlüssel auf
     * `null` = „dazu steht nichts im Entwurf"; `false` hiesse „ausdrücklich keine Anlage" bzw.
     * „ausdrücklich kein Vorschlag" — eine ANGABE, und damit ein Stand, der die Frage gerade NICHT
     * wieder erscheinen liesse. Genau diese Unterscheidung trägt der Löschweg, und sie ist nur
     * deshalb hier messbar, weil der Ausgangsstand ein echtes `false` enthielt.
     */
    expect(summary.hasBattery).toBeNull()
    expect(summary.wantsRecommendation).toBeNull()
  })

  it('ein „nein"-Zweig allein wird ebenso vollständig entfernt', async () => {
    // Der reale zweite Zustand: nur die Empfehlungs-Antwort steht im Entwurf.
    draft = {
      wantsBatteryRecommendation: true,
      energyPriceCtPerKwh: 24.5,
      _provenance: {
        wantsBatteryRecommendation: { source: 'measured', at: '2026-09-02T08:00:00.000Z' },
        energyPriceCtPerKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
      },
    }

    const state = await deleteMeteringPointBatteryAction({}, deleteForm())

    expect(state.success).toBe('Batterie-Angaben gelöscht.')
    expect(draft).not.toHaveProperty('wantsBatteryRecommendation')
    expect(draft.energyPriceCtPerKwh).toBe(24.5)
  })

  it('meldet eine entzogene Rolle, ohne den Entwurf anzufassen', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })

    const state = await deleteMeteringPointBatteryAction({}, deleteForm())

    expect(state.formError).toBe('Keine Berechtigung. Bitte laden Sie die Seite neu.')
    expect(state.success).toBeUndefined()
    expect(draft).toEqual(EXISTING)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('fragt die Datenbank bei einer formverletzenden Kennung gar nicht erst', async () => {
    const badProject = deleteForm({ projectId: 'kein-uuid' })
    expect((await deleteMeteringPointBatteryAction({}, badProject)).formError).toBeDefined()

    const badPoint = deleteForm({ meteringPointId: 'kein-uuid' })
    expect((await deleteMeteringPointBatteryAction({}, badPoint)).formError).toBeDefined()

    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('uploadMeteringPointPvProfileAction — die Erzeugungsreihe', () => {
  /**
   * ⚠ DER LESER IST HIER ECHT, NICHT ERSETZT.
   *
   * `readPvProfile` ist deterministisch und macht keinen Netzweg und keinen Modellaufruf — anders
   * als `extractInvoiceData` nebenan, das ein Modell fragt und deshalb eine Attrappe braucht. Mit
   * einem Stub prüfte dieser Block seine eigene Vorbereitung: er reichte ein Metadaten-Objekt
   * hinein, das er selbst geschrieben hat, und bekäme es im Entwurf wieder heraus. Dieselbe
   * Überlegung, mit der der Konflikt-Fall der Rechnungs-Station über das ECHTE
   * `mergeInvoiceExtractions` läuft.
   *
   * Gemessen wird damit die ganze Kette Bytes → Leser → Entwurf. Die Erwartungen sind trotzdem
   * HANDGERECHNET (im Juni gilt CEST = UTC+2) — was der Leser aus echten Netzbetreiber- und
   * Wechselrichter-Dateien macht, misst `packages/engine/src/parser/metadata.test.ts`.
   */

  /** Ein bereits gelesener Stand, wie ihn die Rechnungs-Station hinterlässt. */
  const EXISTING = { energyPriceCtPerKwh: 24.5 }

  /**
   * Ein Viertelstunden-PV-CSV in LOKALER Schreibweise — dasselbe Format wie die Demo-Fixtures
   * (`;` als Trenner, Dezimalkomma). `skipDays` lässt ganze Kalendertage weg.
   */
  function pvCsvText(options: { days: number; skipDays?: number[]; intervalMinutes?: number }) {
    const step = options.intervalMinutes ?? 15
    const perDay = (24 * 60) / step
    const skip = new Set(options.skipDays ?? [])
    const two = (n: number) => String(n).padStart(2, '0')

    const lines = ['Zeitstempel;PV-Erzeugung (kW)']
    for (let day = 1; day <= options.days; day++) {
      if (skip.has(day)) continue
      for (let slot = 0; slot < perDay; slot++) {
        const m = slot * step
        const value = ((slot % 9) * 0.5).toFixed(2).replace('.', ',')
        lines.push(`${two(day)}.06.2025 ${two(Math.floor(m / 60))}:${two(m % 60)};${value}`)
      }
    }
    return lines.join('\n')
  }

  function pvFile(text: string, name = 'erzeugung.csv', type = 'text/csv'): File {
    return new File([new TextEncoder().encode(text)], name, { type })
  }

  function pvForm(file: File): FormData {
    const fd = form()
    fd.set('file', file)
    return fd
  }

  /** Die Vermerke aus dem zuletzt geschriebenen Entwurf. */
  function provenanceOf(field: string): { source?: string } {
    const raw = draft._provenance as Record<string, { source?: string }> | undefined
    return raw?.[field] ?? {}
  }

  beforeEach(() => {
    draft = { ...EXISTING }
    withInvoiceWrappers()
    uploadProjectDocument.mockResolvedValue({
      ok: true,
      documentId: DOCUMENT_ID,
      storagePath: STORAGE_PATH,
    })
  })

  it('⚠ legt die Datei ab und schreibt Zeitraum, Intervall UND Lücken in den Entwurf', async () => {
    /*
     * Drei Junitage, der zweite fehlt vollständig. Handgerechnet (CEST = UTC+2):
     *   Beginn   01.06. 00:00 Ortszeit → 2025-05-31T22:00:00.000Z
     *   Ende     03.06. 23:45 + 15 min = 04.06. 00:00 Ortszeit → 2025-06-03T22:00:00.000Z
     *   Lücke    02.06. 00:00 bis 03.06. 00:00 Ortszeit → 2025-06-01T22:00Z … 2025-06-02T22:00Z
     */
    const state = await uploadMeteringPointPvProfileAction(
      {},
      pvForm(pvFile(pvCsvText({ days: 3, skipDays: [2] }), 'pv-juni.csv')),
    )

    expect(state.success).toBe('Erzeugungsprofil eingelesen und gespeichert.')
    expect(state.fieldErrors).toBeUndefined()
    expect(state.formError).toBeUndefined()

    // Die Datei liegt im PROJEKT — die Eigentumsfrage beantwortet dabei die Datenbank.
    expect(uploadProjectDocument).toHaveBeenCalledTimes(1)
    expect(uploadProjectDocument).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ name: 'pv-juni.csv', type: 'text/csv' }),
    )

    expect(draft.pvIntervalMinutes).toBe(15)
    expect(draft.pvCoveredFrom).toBe('2025-05-31T22:00:00.000Z')
    expect(draft.pvCoveredTo).toBe('2025-06-03T22:00:00.000Z')
    // ⚠ Ohne die Kennung wüsste später niemand mehr, welche Datei das war.
    expect(draft.pvSourceDocumentId).toBe(DOCUMENT_ID)
    expect(draft._pvProfileGaps).toEqual([
      { from: '2025-06-01T22:00:00.000Z', to: '2025-06-02T22:00:00.000Z' },
    ])

    // Eine Ablesung ist ein Messwert, keine Annahme (Delta §3.2).
    expect(provenanceOf('pvCoveredFrom').source).toBe('measured')
    expect(provenanceOf('pvIntervalMinutes').source).toBe('measured')

    // Der Bestand der Rechnungs-Station überlebt — der Wrapper ERSETZT den Entwurf.
    expect(draft.energyPriceCtPerKwh).toBe(EXISTING.energyPriceCtPerKwh)

    /*
     * ⚠ EIN Schreibvorgang, nicht zwei: Zeitraum und Lücken sind die Auswertung DERSELBEN Datei.
     * Getrennt geschrieben gäbe es einen Zustand, in dem der eine zu einer anderen Datei gehört
     * als die anderen.
     */
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledWith(
      `/admin/kalkulator-projekte/${PROJECT_ID}/dateneingabe`,
    )
  })

  it('eine lückenlose Datei schreibt eine LEERE Lückenliste, keinen fehlenden Schlüssel', async () => {
    // „Keine Lücke" ist eine Aussage über die Datei und muss sich von „nie eingelesen"
    // unterscheiden lassen — die Station liest genau diesen Unterschied.
    await uploadMeteringPointPvProfileAction({}, pvForm(pvFile(pvCsvText({ days: 3 }))))

    expect(draft._pvProfileGaps).toEqual([])
    expect(draft).toHaveProperty('_pvProfileGaps')
    expect(draft.pvCoveredTo).toBe('2025-06-03T22:00:00.000Z')
  })

  it('⚠ ein leerer Medientyp wird ersetzt, statt die Ablage scheitern zu lassen', async () => {
    // Kommt real vor; `uploadProjectDocument` wiese ihn als `invalid_file` ab, und der Admin läse
    // einen Ablagefehler über einer Datei, die vollständig lesbar ist.
    await uploadMeteringPointPvProfileAction(
      {},
      pvForm(pvFile(pvCsvText({ days: 2 }), 'ohne-typ.csv', '')),
    )

    expect(uploadProjectDocument).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ type: 'application/octet-stream' }),
    )
  })

  // ── Die drei Ausgänge, die NICHTS hinterlassen dürfen ────────────────────────────────────────
  it('⚠ weist eine zu grosse Datei ab — ohne Upload und ohne den Entwurf anzufassen', async () => {
    const zuGross = new File([new Uint8Array(MAX_PROJECT_DOCUMENT_BYTES + 1)], 'gross.csv', {
      type: 'text/csv',
    })

    const state = await uploadMeteringPointPvProfileAction({}, pvForm(zuGross))

    expect(state.fieldErrors?.file).toContain('zu gross')
    expect(state.fieldErrors?.file).toContain('nichts hochgeladen und nichts gespeichert')
    expect(state.success).toBeUndefined()

    // Die Prüfung läuft VOR jedem Netzweg — der Entwurf wird gar nicht erst gelesen.
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })

  it('⚠ reicht die Meldung DES LESERS durch, statt sie durch einen eigenen Satz zu ersetzen', async () => {
    /*
     * Ein Wechselrichter-Export im 5-Minuten-Raster — der häufigste reale Ablehnungsgrund. Die
     * Meldung des Lesers nennt das ERKANNTE Intervall, und das ist die einzige Auskunft, die dem
     * Admin sagt, WAS an seiner Datei nicht stimmt. Ein eigener Satz („Datei konnte nicht gelesen
     * werden") nähme sie ihm, ohne dass irgendetwas fehlschlüge.
     *
     * Gemessen wird deshalb an einer Zahl, die NUR der Leser kennt: die „5 min" stehen nirgends in
     * dieser Action und in keinem Text, den sie selbst formulieren könnte.
     */
    const state = await uploadMeteringPointPvProfileAction(
      {},
      pvForm(pvFile(pvCsvText({ days: 1, intervalMinutes: 5 }))),
    )

    expect(state.fieldErrors?.file).toContain('5 min')
    expect(state.fieldErrors?.file).toContain('Intervall')
    // Der eigene Zusatz kommt HINTEN dran und ersetzt nichts.
    expect(state.fieldErrors?.file).toContain('Es wurde nichts hochgeladen und nichts gespeichert.')

    // Abgelehnt heisst abgelehnt: die Datei landet nicht in der Ablage.
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })

  it('reicht auch die Meldung zu einer unlesbaren Datei durch', async () => {
    const state = await uploadMeteringPointPvProfileAction(
      {},
      pvForm(pvFile('Hallo Welt\nDies ist keine Tabelle', 'notiz.csv')),
    )

    expect(state.fieldErrors?.file).toContain('Zeitstempel-Spalte')
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('verlangt überhaupt eine Datei', async () => {
    const state = await uploadMeteringPointPvProfileAction({}, form())
    expect(state.fieldErrors?.file).toBe('Bitte eine Datei auswählen.')
    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  // ── Der Teilausfall ──────────────────────────────────────────────────────────────────────────
  it('⚠ ein verschwundener Zählpunkt: die Datei ist ABGELEGT, und die Meldung sagt das', async () => {
    /*
     * Der Zählpunkt ist zwischen Seitenaufbau und Absenden weggefallen (zweiter Tab, verkleinerte
     * Zählpunkt-Zahl). Die Datei liegt zu diesem Zeitpunkt bereits im Projekt — sie ist bezahlt und
     * lässt sich hier nicht mehr zurücknehmen. Eine Meldung, die das verschweigt, schickt den Admin
     * dieselbe Datei ein zweites Mal hochladen.
     */
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'list_metering_points') {
        // Ein anderer Zählpunkt steht noch da — die Antwort ist gültig, unsere Zeile fehlt nur.
        return { data: { status: 'ok', metering_points: [{ id: DOCUMENT_ID, draft: {} }] }, error: null }
      }
      throw new Error(`unerwarteter Wrapper: ${fn}`)
    })

    const state = await uploadMeteringPointPvProfileAction(
      {},
      pvForm(pvFile(pvCsvText({ days: 2 }))),
    )

    expect(state.formError).toContain('Zählpunkt gibt es nicht (mehr)')
    expect(state.formError).toContain('im Projekt abgelegt')
    expect(state.success).toBeUndefined()

    // Hochgeladen wurde sehr wohl — geschrieben nichts.
    expect(uploadProjectDocument).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(0)
    expect(draft).toEqual(EXISTING)
  })

  it('weist eine formverletzende Kennung ab, ohne Datei und ohne Datenbank', async () => {
    const badProject = pvForm(pvFile(pvCsvText({ days: 2 })))
    badProject.set('projectId', 'kein-uuid')
    expect((await uploadMeteringPointPvProfileAction({}, badProject)).formError).toBeDefined()

    const badPoint = pvForm(pvFile(pvCsvText({ days: 2 })))
    badPoint.set('meteringPointId', 'kein-uuid')
    expect((await uploadMeteringPointPvProfileAction({}, badPoint)).formError).toBeDefined()

    expect(uploadProjectDocument).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})


describe('saveMeteringPointPvArrayAction — die Modulflächen sind eine LISTE', () => {
  /** Ein bereits gelesener Stand, wie ihn die Rechnungs-Station hinterlässt. */
  const EXISTING = {
    energyPriceCtPerKwh: 24.5,
    _provenance: {
      energyPriceCtPerKwh: { source: 'measured', at: '2026-09-01T10:00:00.000Z' },
    },
  }

  /** Genau das, was das Formular sendet: alle drei Felder, auch die leeren. */
  function arrayForm(fields: Record<string, string> = {}): FormData {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    for (const key of ['peakPowerKwp', 'slopeDeg', 'direction']) fd.set(key, '')
    for (const [key, value] of Object.entries(fields)) fd.set(key, value)
    return fd
  }

  /** Die gespeicherten Flächen aus dem zuletzt geschriebenen Entwurf — roh, nicht über den Leser. */
  function storedArrays(): Record<string, unknown>[] {
    const raw = draft._pvArrays
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  }

  beforeEach(() => {
    draft = { ...EXISTING }
    withInvoiceWrappers()
  })

  it('⚠ DIE ZUSAGE DIESES SCHRITTS: der zweite Klick HÄNGT AN, er überschreibt nicht', async () => {
    const first = await saveMeteringPointPvArrayAction(
      {},
      arrayForm({ peakPowerKwp: '4,25', slopeDeg: '30', direction: 'SO' }),
    )

    expect(first.formError).toBeUndefined()
    expect(first.fieldErrors).toBeUndefined()
    expect(first.success).toContain('eine Fläche')
    expect(storedArrays()).toEqual([
      { peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 },
    ])

    const second = await saveMeteringPointPvArrayAction(
      {},
      arrayForm({ peakPowerKwp: '5,95', slopeDeg: '35', direction: 'SW' }),
    )

    expect(second.formError).toBeUndefined()
    expect(second.success).toContain('2 Flächen')

    /*
     * ⚠ DER EIGENTLICHE WÄCHTER. Im vorigen, skalaren Stand stand hier nach dem zweiten Klick
     * GENAU EIN Wert — der zweite hatte den ersten überschrieben, und die geschätzte Erzeugung
     * fiele um die erste Fläche zu niedrig aus, ohne dass eine Zahl deswegen falsch aussähe.
     */
    expect(storedArrays()).toEqual([
      { peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 },
      { peakPowerKwp: 5.95, direction: 'SW', slopeDeg: 35 },
    ])

    // Die alten Skalar-Schlüssel entstehen nicht mehr — sonst stünden zwei Wahrheiten nebeneinander.
    expect(draft).not.toHaveProperty('pvArrayPeakPowerKwp')
    expect(draft).not.toHaveProperty('pvArrayDirection')
    expect(draft).not.toHaveProperty('pvArraySlopeDeg')

    // Der Bestand der Rechnungs-Station bleibt unberührt.
    expect(draft.energyPriceCtPerKwh).toBe(EXISTING.energyPriceCtPerKwh)

    // Je Klick GENAU EIN Schreibvorgang — der Wrapper ERSETZT, zwei nähmen einander die Arbeit weg.
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(2)
    expect(revalidatePath).toHaveBeenCalledTimes(2)
  })

  it('ein leeres Feld fehlt DIESER Fläche — es wird als `null` geführt, nicht weggelassen', async () => {
    const state = await saveMeteringPointPvArrayAction({}, arrayForm({ peakPowerKwp: '9,8' }))

    expect(state.formError).toBeUndefined()
    /*
     * ⚠ Bewusst anders als im skalaren Stand: dort liess ein leeres Feld einen bereits erfassten
     * Wert stehen. Hier entsteht ein NEUER Eintrag, für den es nichts zu schonen gibt — die Fläche
     * gibt es, diese eine Angabe zu ihr fehlt.
     */
    expect(storedArrays()).toEqual([{ peakPowerKwp: 9.8, direction: null, slopeDeg: null }])
  })

  it('ohne eine einzige Angabe wird NICHTS angehängt und nichts geschrieben', async () => {
    const state = await saveMeteringPointPvArrayAction({}, arrayForm())

    expect(state.formError).toBe('Bitte mindestens eine Angabe eintragen.')
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })

  it('ein unbrauchbarer Wert bricht VOR dem Schreiben ab — und lässt die Liste unberührt', async () => {
    await saveMeteringPointPvArrayAction({}, arrayForm({ peakPowerKwp: '4,25' }))
    const before = JSON.parse(JSON.stringify(storedArrays()))
    rpc.mockClear()

    const state = await saveMeteringPointPvArrayAction(
      {},
      arrayForm({ peakPowerKwp: '5,95', slopeDeg: '999' }),
    )

    expect(state.fieldErrors?.slopeDeg).toBeDefined()
    expect(state.success).toBeUndefined()
    expect(rpc).not.toHaveBeenCalled()
    expect(storedArrays()).toEqual(before)
  })

  it('eine unbekannte Himmelsrichtung wird BENANNT, nicht still verworfen', async () => {
    const state = await saveMeteringPointPvArrayAction(
      {},
      arrayForm({ peakPowerKwp: '4,25', direction: 'nord-nord-ost' }),
    )

    expect(state.fieldErrors?.direction).toBe('Diese Himmelsrichtung kennen wir nicht.')
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual(EXISTING)
  })

  it('weist eine formverletzende Kennung ab, ohne die Datenbank zu fragen', async () => {
    const bad = arrayForm({ peakPowerKwp: '4,25' })
    bad.set('meteringPointId', 'kein-uuid')

    expect((await saveMeteringPointPvArrayAction({}, bad)).formError).toBeDefined()
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('scanPvDesignAction + addPvArraysFromScanAction — mehrere Flächen aus EINEM Dokument', () => {
  /**
   * ⚠ WARUM DIESE ZWEI ACTIONS GEMEINSAM GEMESSEN WERDEN.
   *
   * Sie sind über eine KODIERUNG gekoppelt, die nirgends sonst geprüft werden kann: der Scan legt
   * seine Kandidaten unter indizierten Schlüsseln (`0.peakPowerKwp`, `1.direction`, …) in das
   * flache `values`-Feld von `AdminState`, die Übernahme liest sie unter denselben Schlüsseln
   * wieder heraus. Getrennt gemessen bliebe beides grün, während der eine Index schreibt und die
   * andere daneben liest — und der Fehler sähe nicht nach einem Fehler aus, sondern nach einem
   * Dokument mit weniger Flächen.
   *
   * Der Test füttert die Übernahme deshalb mit GENAU DEM, was der Scan geliefert hat, statt mit
   * einem von Hand gebauten Formular.
   */

  /** Eine gelesene Modulfläche — vollständig, sofern der Test nichts anderes sagt. */
  function scanned(overrides: Record<string, unknown> = {}) {
    return {
      peakPowerKwp: 4.25,
      slopeDeg: 30,
      direction: 'SO',
      azimuthDeg: null,
      moduleCount: 10,
      ...overrides,
    }
  }

  /** Das Ergebnis des Extraktors mit N Flächen, jede an ihrer Nennleistung erkennbar. */
  function outcome(count: number) {
    return {
      ok: true,
      extraction: {
        arrays: Array.from({ length: count }, (_, i) => scanned({ peakPowerKwp: i + 1 })),
        azimuthConvention: null,
        locationText: null,
      },
    }
  }

  function designForm(): FormData {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    fd.set('pvDesign', new File([new Uint8Array(1024)], 'auslegung.pdf', {
      type: 'application/pdf',
    }))
    return fd
  }

  /**
   * Baut das Übernahme-Formular AUS der Scan-Antwort — genau wie die Oberfläche: alle Kandidaten
   * mit ihren Werten als versteckte Felder, angekreuzt nur die genannten.
   */
  function takeoverForm(values: Record<string, string>, checked: number[]): FormData {
    const fd = new FormData()
    fd.set('projectId', PROJECT_ID)
    fd.set('meteringPointId', POINT_ID)
    const count = values.candidateCount ?? '0'
    fd.set('candidateCount', count)
    for (let i = 0; i < Number(count); i += 1) {
      for (const key of ['peakPowerKwp', 'slopeDeg', 'direction']) {
        fd.set(`${i}.${key}`, values[`${i}.${key}`] ?? '')
      }
      if (checked.includes(i)) fd.set(`include-${i}`, 'on')
    }
    return fd
  }

  /** Die gespeicherten Flächen aus dem zuletzt geschriebenen Entwurf — roh, nicht über den Leser. */
  function storedArrays(): Record<string, unknown>[] {
    const raw = draft._pvArrays
    return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  }

  beforeEach(() => {
    draft = {}
    withInvoiceWrappers()
  })

  it('drei Flächen gelesen, ZWEI angekreuzt — genau die zwei landen in der Liste', async () => {
    extractPvDesign.mockResolvedValue({
      ok: true,
      extraction: {
        arrays: [
          scanned({ peakPowerKwp: 4.25, slopeDeg: 30, direction: 'SO' }),
          scanned({ peakPowerKwp: 5.95, slopeDeg: 35, direction: 'SW' }),
          scanned({ peakPowerKwp: 3.1, slopeDeg: 15, direction: 'O' }),
        ],
        azimuthConvention: null,
        locationText: null,
      },
    })

    const scan = await scanPvDesignAction({}, designForm())
    const values = scan.values ?? {}

    expect(scan.formError).toBeUndefined()
    expect(values.extraction).toBe('ok')
    expect(values.candidateCount).toBe('3')
    expect(values.truncated).toBeUndefined()

    /*
     * ⚠ POSITIV-KONTROLLE, und sie trägt den ganzen Test: die dritte Fläche wurde nachweislich
     * GELESEN und stand vollständig zur Übernahme bereit. Ohne diese drei Zusicherungen bliebe der
     * Test unten auch dann grün, wenn der Scan die dritte gar nicht erst geliefert hätte — er
     * misst dann nicht mehr die AUSWAHL, sondern eine Lücke im Lesen.
     */
    expect(values['2.peakPowerKwp']).toBe('3,1')
    expect(values['2.slopeDeg']).toBe('15')
    expect(values['2.direction']).toBe('O')

    const state = await addPvArraysFromScanAction({}, takeoverForm(values, [0, 1]))

    expect(state.formError).toBeUndefined()
    expect(state.success).toContain('2 Flächen')

    expect(storedArrays()).toEqual([
      { peakPowerKwp: 4.25, direction: 'SO', slopeDeg: 30 },
      { peakPowerKwp: 5.95, direction: 'SW', slopeDeg: 35 },
    ])

    // Die dritte ist NICHT dabei — weder als Eintrag noch als Wert irgendwo im Entwurf.
    expect(storedArrays().some((a) => a.peakPowerKwp === 3.1)).toBe(false)

    // Beide zusammen in EINEM Schreibvorgang: der Wrapper ERSETZT, zwei nähmen einander die Arbeit weg.
    expect(rpc.mock.calls.filter(([fn]) => fn === 'update_metering_point_draft')).toHaveLength(1)
    expect(revalidatePath).toHaveBeenCalledTimes(1)
  })

  it('⚠ mehr Flächen als die Obergrenze: es wird GEKAPPT und die Kappung BENANNT', async () => {
    /*
     * ⚠ DIE ZAHL STEHT HIER BEWUSST NICHT. `MAX_PV_DESIGN_CANDIDATES` ist modul-lokal und nicht
     * exportierbar (die Datei trägt `'use server'`). Ein abgetippter Wert wäre eine zweite
     * Behauptung über dieselbe Grenze und bliebe grün, wenn die Anwendung gegen eine andere prüft.
     * Gemessen wird deshalb das VERHALTEN: es kommen weniger Kandidaten heraus als das Dokument
     * führt, die letzte gelieferte trägt einen Wert, die erste NICHT gelieferte keinen — und die
     * Gesamtzahl des Dokuments bleibt nennbar.
     */
    const IN_DOCUMENT = 20
    extractPvDesign.mockResolvedValue(outcome(IN_DOCUMENT))

    const scan = await scanPvDesignAction({}, designForm())
    const values = scan.values ?? {}
    const count = Number(values.candidateCount)

    expect(scan.formError).toBeUndefined()
    expect(values.truncated).toBe('1')
    expect(values.arrayCount).toBe(String(IN_DOCUMENT))
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThan(IN_DOCUMENT)

    // Die Grenze liegt GENAU dort, wo `candidateCount` sie behauptet — nicht daneben.
    expect(values[`${count - 1}.peakPowerKwp`]).toBe(String(count))
    expect(values[`${count}.peakPowerKwp`]).toBeUndefined()

    /*
     * ⚠ GEGENPROBE — ohne sie wäre „truncated" auch dann grün, wenn die Action es IMMER setzt:
     * ein Dokument unterhalb der Grenze wird nicht gekappt und meldet es auch nicht.
     */
    extractPvDesign.mockResolvedValue(outcome(3))
    const small = await scanPvDesignAction({}, designForm())

    expect(small.values?.candidateCount).toBe('3')
    expect(small.values?.arrayCount).toBe('3')
    expect(small.values?.truncated).toBeUndefined()
  })

  it('ohne ein einziges Häkchen wird NICHTS geschrieben', async () => {
    extractPvDesign.mockResolvedValue(outcome(2))
    const scan = await scanPvDesignAction({}, designForm())

    const state = await addPvArraysFromScanAction({}, takeoverForm(scan.values ?? {}, []))

    expect(state.formError).toBe('Bitte mindestens eine Fläche auswählen.')
    expect(state.success).toBeUndefined()
    expect(rpc).not.toHaveBeenCalled()
    expect(draft).toEqual({})
  })
})
