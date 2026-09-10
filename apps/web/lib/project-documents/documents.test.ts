import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B24 — der Hoch-/Runterlade-Weg der Projekt-Dokumente (`documents.ts`).
 *
 * ── DIE EIGENSCHAFTEN, DIE SICH NUR HIER PRÜFEN LASSEN ──────────────────────────────────────────
 * Das VERHALTEN der Wrapper (Eigentum, abgeleiteter Pfad, duplicate_document, CASCADE) liegt im
 * DB-Gate und läuft dort gegen eine echte Datenbank. Was NUR hier prüfbar ist, ist die REIHENFOLGE
 * und die Frage, was bei einer Ablehnung NICHT geschieht:
 *
 *   (1) ⚠ EINE ABLEHNUNG BERÜHRT DEN STORAGE NICHT. Nicht „wird dort abgewiesen" — es wird gar
 *       nicht erst geschrieben. Der service_role-Weg ist deshalb ersetzt und zählt mit, ob er
 *       überhaupt angefasst wurde. Ohne Schreibvorgang keine Datei.
 *   (2) DIE BYTES KOMMEN VOR DEM EINTRAG. Umgekehrt stünde bei einem gescheiterten Upload eine Zeile
 *       im Bestand, die eine Datei behauptet, die es nicht gibt — s. Kopf von `documents.ts`.
 *   (3) SCHEITERT DER EINTRAG, WERDEN DIE BYTES WIEDER ENTFERNT. Sonst bliebe eine Datei liegen, an
 *       die niemand mehr herankommt.
 *   (4) DIE GRÖSSENPRÜFUNG LIEGT VOR JEDEM NETZWERKWEG — eine zu grosse Datei wird nicht erst
 *       hochgeladen und dann abgewiesen.
 *   (5) DER DOWNLOAD FRAGT ZUERST DIE DATENBANK. Der Pfad, mit dem die Bytes geholt werden, ist
 *       GENAU der, den der Wrapper geliefert hat — nie einer, den dieser Code selbst gebildet hat.
 */

// `server-only` wirft beim Import ausserhalb einer React-Server-Umgebung. Ersetzt wird nur dieser
// Wächter — er schützt vor einem Import aus einer Client-Komponente, und das ist eine Eigenschaft
// des BUILDS, keine des Moduls (Muster lib/env.guard.test.ts, lib/kontakt/thema.test.ts).
vi.mock('server-only', () => ({}))

const rpc = vi.fn()
const createClient = vi.fn(async () => ({ rpc }))
const putProjectDocumentBytes = vi.fn()
const getProjectDocumentBytes = vi.fn()
const removeProjectDocumentBytes = vi.fn()

vi.mock('@/lib/supabase/server', () => ({ createClient: () => createClient() }))
vi.mock('./storage', () => ({
  putProjectDocumentBytes: (...a: unknown[]) => putProjectDocumentBytes(...a),
  getProjectDocumentBytes: (...a: unknown[]) => getProjectDocumentBytes(...a),
  removeProjectDocumentBytes: (...a: unknown[]) => removeProjectDocumentBytes(...a),
}))

const { readProjectDocument, uploadProjectDocument } = await import('./documents')

const PROJECT = '11111111-2222-4333-8444-555555555555'
const DOCUMENT = '99999999-8888-4777-8666-555555555555'
const PATH = `${PROJECT}/${DOCUMENT}`

function file(bytes = 8): { name: string; type: string; bytes: ArrayBuffer } {
  return { name: 'Jahresrechnung 2025.pdf', type: 'application/pdf', bytes: new ArrayBuffer(bytes) }
}

/** Antwortet den Wrappern der Reihe nach — get_project, dann append_project_document. */
function wrappersOk() {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'get_project') return { data: { status: 'ok', project: { id: PROJECT } }, error: null }
    if (fn === 'append_project_document') {
      return { data: { status: 'ok', document_id: DOCUMENT, storage_path: PATH }, error: null }
    }
    throw new Error(`unerwarteter Wrapper: ${fn}`)
  })
}

beforeEach(() => {
  rpc.mockReset()
  createClient.mockClear()
  putProjectDocumentBytes.mockReset()
  getProjectDocumentBytes.mockReset()
  removeProjectDocumentBytes.mockReset()
  putProjectDocumentBytes.mockResolvedValue({ ok: true })
  removeProjectDocumentBytes.mockResolvedValue(undefined)
})

describe('uploadProjectDocument — ein fremdes Projekt berührt den Storage NICHT', () => {
  it('get_project not_found → kein Schreibvorgang, kein Eintrag', async () => {
    rpc.mockResolvedValue({ data: { status: 'not_found' }, error: null })

    const out = await uploadProjectDocument(PROJECT, file())

    expect(out).toEqual({ ok: false, reason: 'not_found' })
    // Der eigentliche Nachweis: nicht „der Storage lehnt ab", sondern er wird gar nicht angefasst.
    expect(putProjectDocumentBytes).not.toHaveBeenCalled()
    // Und es wurde ausschliesslich GEFRAGT, nicht eingetragen.
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0]![0]).toBe('get_project')
  })

  it('ein Fehler des Wrappers wird wie eine Ablehnung behandelt (fail closed)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Verbindung weg' } })

    const out = await uploadProjectDocument(PROJECT, file())

    expect(out).toEqual({ ok: false, reason: 'not_found' })
    expect(putProjectDocumentBytes).not.toHaveBeenCalled()
  })
})

describe('uploadProjectDocument — die Grössenprüfung liegt VOR jedem Netzwerkweg', () => {
  it('eine zu grosse Datei wird abgewiesen, ohne die Datenbank auch nur zu fragen', async () => {
    wrappersOk()
    const out = await uploadProjectDocument(PROJECT, file(20 * 1024 * 1024 + 1))

    expect(out).toEqual({ ok: false, reason: 'too_large' })
    // Weder Client noch Storage: sonst würde eine 20-MB-Datei erst hochgeladen und dann verworfen.
    expect(createClient).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(putProjectDocumentBytes).not.toHaveBeenCalled()
  })

  it('genau an der Grenze geht es noch durch', async () => {
    wrappersOk()
    const out = await uploadProjectDocument(PROJECT, file(20 * 1024 * 1024), {
      newDocumentId: () => DOCUMENT,
    })
    expect(out).toEqual({ ok: true, documentId: DOCUMENT, storagePath: PATH })
  })

  it('leere Datei und leere Metadaten werden abgewiesen, ohne die Datenbank zu fragen', async () => {
    wrappersOk()
    for (const bad of [
      { name: 'x.pdf', type: 'application/pdf', bytes: new ArrayBuffer(0) },
      { name: '   ', type: 'application/pdf', bytes: new ArrayBuffer(4) },
      { name: 'x.pdf', type: '  ', bytes: new ArrayBuffer(4) },
    ]) {
      expect(await uploadProjectDocument(PROJECT, bad)).toEqual({ ok: false, reason: 'invalid_file' })
    }
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('uploadProjectDocument — die Reihenfolge Bytes → Eintrag', () => {
  it('⚠ die Bytes werden VOR dem Eintrag geschrieben, an den abgeleiteten Pfad', async () => {
    const order: string[] = []
    rpc.mockImplementation(async (fn: string) => {
      order.push(`rpc:${fn}`)
      if (fn === 'get_project') return { data: { status: 'ok', project: {} }, error: null }
      return { data: { status: 'ok' }, error: null }
    })
    putProjectDocumentBytes.mockImplementation(async () => {
      order.push('storage:put')
      return { ok: true }
    })

    const out = await uploadProjectDocument(PROJECT, file(), { newDocumentId: () => DOCUMENT })

    expect(out).toEqual({ ok: true, documentId: DOCUMENT, storagePath: PATH })
    // Umgekehrt stünde bei einem gescheiterten Upload eine Zeile im Bestand, die eine Datei
    // behauptet, die es nicht gibt.
    expect(order).toEqual(['rpc:get_project', 'storage:put', 'rpc:append_project_document'])
    expect(putProjectDocumentBytes).toHaveBeenCalledWith(PATH, expect.anything(), 'application/pdf')
    // Die Kennung, die der Wrapper eintragen soll, ist DIESELBE, mit der die Bytes geschrieben
    // wurden — sonst zeigte die Zeile auf eine andere Datei.
    expect(rpc.mock.calls[1]![1]).toMatchObject({
      p_project_id: PROJECT,
      p_document_id: DOCUMENT,
      p_original_filename: 'Jahresrechnung 2025.pdf',
      p_content_type: 'application/pdf',
    })
  })

  it('scheitert der Schreibvorgang, entsteht KEIN Eintrag', async () => {
    wrappersOk()
    putProjectDocumentBytes.mockResolvedValue({ ok: false, message: 'Bucket voll' })

    const out = await uploadProjectDocument(PROJECT, file())

    expect(out).toEqual({ ok: false, reason: 'storage_failed' })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0]![0]).toBe('get_project')
    // Nichts zu räumen — es wurde nichts geschrieben.
    expect(removeProjectDocumentBytes).not.toHaveBeenCalled()
  })

  it('⚠ scheitert der EINTRAG, werden die eben geschriebenen Bytes wieder entfernt', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'get_project') return { data: { status: 'ok', project: {} }, error: null }
      return { data: { status: 'duplicate_document' }, error: null }
    })

    const out = await uploadProjectDocument(PROJECT, file(), { newDocumentId: () => DOCUMENT })

    expect(out).toEqual({ ok: false, reason: 'record_failed' })
    // Eine Datei ohne Eintrag ist harmlos (sie steht in keiner Liste), kostet aber Platz, und
    // niemand käme je wieder an sie heran.
    expect(removeProjectDocumentBytes).toHaveBeenCalledWith(PATH)
  })
})

describe('readProjectDocument — der Pfad kommt aus der Datenbank, nie aus diesem Code', () => {
  it('geholt wird GENAU der Pfad, den der Wrapper geliefert hat', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'ok',
        document: {
          storage_path: PATH,
          original_filename: 'Jahresrechnung 2025.pdf',
          content_type: 'application/pdf',
        },
      },
      error: null,
    })
    getProjectDocumentBytes.mockResolvedValue({ ok: true, bytes: new ArrayBuffer(4) })

    const out = await readProjectDocument(DOCUMENT)

    expect(out).toMatchObject({
      ok: true,
      filename: 'Jahresrechnung 2025.pdf',
      contentType: 'application/pdf',
    })
    expect(rpc).toHaveBeenCalledWith('get_project_document', { p_document_id: DOCUMENT })
    expect(getProjectDocumentBytes).toHaveBeenCalledWith(PATH)
  })

  it('⚠ ein fremdes Dokument berührt den Storage NICHT', async () => {
    rpc.mockResolvedValue({ data: { status: 'not_found' }, error: null })

    expect(await readProjectDocument(DOCUMENT)).toEqual({ ok: false, reason: 'not_found' })
    // Nicht „der Storage liefert nichts" — er wird gar nicht gefragt. Ein Pfad ist ohne die
    // Zustimmung der Datenbank in diesem Code überhaupt nicht bekannt.
    expect(getProjectDocumentBytes).not.toHaveBeenCalled()
  })

  it('ein Fehler des Wrappers wird wie eine Ablehnung behandelt (fail closed)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Verbindung weg' } })
    expect(await readProjectDocument(DOCUMENT)).toEqual({ ok: false, reason: 'not_found' })
    expect(getProjectDocumentBytes).not.toHaveBeenCalled()
  })
})
