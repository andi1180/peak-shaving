import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Der Wächter der Scan-Action.
 *
 * ⚠ GEPRÜFT WIRD DIE EIGENSCHAFT, DIE SICH NUR HIER PRÜFEN LÄSST: dass bei fehlender Berechtigung
 * oder unbrauchbarer Datei GAR KEIN Extraktionsaufruf entsteht. „Es kommt ein Fehler zurück" wäre
 * die schwächere Aussage — sie bliebe auch dann wahr, wenn die Action vorher ein Sprachmodell
 * befragt (und damit Geld ausgegeben) hätte. Die Extraktion ist deshalb ersetzt und zählt mit,
 * ob sie aufgerufen wurde. Dieselbe Technik wie beim Cron-Endpunkt (B4-1).
 *
 * Die Qualität der Extraktion prüft das nicht — die entscheidet ein Aufruf gegen ein echtes Blatt.
 */

const isCurrentUserAdmin = vi.fn<() => Promise<boolean>>()
const extractTariffSheetData = vi.fn()

vi.mock('../guard', () => ({ isCurrentUserAdmin: () => isCurrentUserAdmin() }))
vi.mock('./extract', () => ({
  extractTariffSheetData: (...args: unknown[]) => extractTariffSheetData(...args),
}))

const { scanTariffSheet } = await import('./actions')
const { MAX_TARIFF_SHEET_FILE_BYTES } = await import('../tariff-sheet-scan')

/** Eine Datei mit echtem Inhalt und wählbarem Medientyp/Grösse. */
function pdf(bytes = 1024, type = 'application/pdf'): File {
  return new File([new Uint8Array(bytes)], 'preisblatt.pdf', { type })
}

beforeEach(() => {
  isCurrentUserAdmin.mockReset().mockResolvedValue(true)
  extractTariffSheetData.mockReset().mockResolvedValue({
    ok: true,
    extraction: { operatorName: 'Wiener Netze GmbH', windows: [] },
  })
})

describe('Berechtigung', () => {
  it('lehnt ohne Admin-Rolle ab, OHNE die Extraktion auch nur anzufassen', async () => {
    isCurrentUserAdmin.mockResolvedValue(false)

    await expect(scanTariffSheet(pdf())).resolves.toEqual({ ok: false, error: 'forbidden' })
    expect(extractTariffSheetData).not.toHaveBeenCalled()
  })

  it('prüft die Rolle VOR der Datei — eine unbrauchbare Datei verrät nichts über das Formular', async () => {
    isCurrentUserAdmin.mockResolvedValue(false)

    // Ohne Datei UND ohne Rolle: die Antwort muss die Rolle nennen, nicht die fehlende Datei.
    await expect(scanTariffSheet(null)).resolves.toEqual({ ok: false, error: 'forbidden' })
    expect(extractTariffSheetData).not.toHaveBeenCalled()
  })
})

describe('Prüfkette vor jedem externen Kontakt', () => {
  it.each([
    ['ohne Datei', null, 'no_file'],
    ['bei leerer Datei', new File([], 'leer.pdf', { type: 'application/pdf' }), 'no_file'],
    ['bei falschem Medientyp', pdf(1024, 'image/png'), 'wrong_type'],
    ['über der Grössengrenze', pdf(MAX_TARIFF_SHEET_FILE_BYTES + 1), 'too_large'],
  ])('lehnt %s ab, ohne die Extraktion aufzurufen', async (_name, file, expected) => {
    await expect(scanTariffSheet(file as File | null)).resolves.toEqual({
      ok: false,
      error: expected,
    })
    expect(extractTariffSheetData).not.toHaveBeenCalled()
  })

  it('lässt eine Datei GENAU auf der Grenze durch — die Grenze schliesst ein', async () => {
    await scanTariffSheet(pdf(MAX_TARIFF_SHEET_FILE_BYTES))
    expect(extractTariffSheetData).toHaveBeenCalledTimes(1)
  })
})

describe('Ausgänge', () => {
  it('reicht die extrahierten Felder durch — und sonst nichts', async () => {
    const extraction = { operatorName: 'Netz NÖ GmbH', windows: [] }
    extractTariffSheetData.mockResolvedValue({ ok: true, extraction })

    const result = await scanTariffSheet(pdf())

    expect(result).toEqual({ ok: true, extraction })
    // Kein Dateiname, keine Grösse, kein Roh-Text der Antwort.
    expect(Object.keys(result)).toEqual(['ok', 'extraction'])
  })

  it.each([
    ['not_configured', 'not_configured'],
    ['unreadable', 'unreadable'],
    // ⚠ `api_error` wird nach aussen zu `unavailable` — was schiefging, geht den Absender nichts an.
    ['api_error', 'unavailable'],
  ])('übersetzt den Grund %s in den Zustand %s', async (reason, expected) => {
    extractTariffSheetData.mockResolvedValue({ ok: false, reason })
    await expect(scanTariffSheet(pdf())).resolves.toEqual({ ok: false, error: expected })
  })

  it('übergibt die Datei base64-kodiert, ohne data:-Präfix', async () => {
    await scanTariffSheet(
      new File([new Uint8Array([1, 2, 3])], 'p.pdf', { type: 'application/pdf' }),
    )

    const [passed] = extractTariffSheetData.mock.calls[0] as [string]
    expect(passed).toBe(Buffer.from(new Uint8Array([1, 2, 3])).toString('base64'))
    expect(passed).not.toContain('data:')
  })
})
