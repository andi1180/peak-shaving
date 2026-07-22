/**
 * DIE AUFLÖSUNG DER PARTNER-ZUORDNUNG (B16-2) — `resolvePartnerAttribution`.
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ──────────────────────────────────────────────────
 * Was `public.capture_lead` mit einem übergebenen Slug macht (verwerfen bei unbekannt/inaktiv,
 * `coalesce(Bestand, neu)` bei erneuter Erfassung), steht in der Datenbank und wird dort geprüft —
 * `packages/db-tests/src/partner-attribution.test.ts` (B16-1). Hier steht die Entscheidung DAVOR:
 * Welcher der beiden möglichen Slugs gilt, und welche HERKUNFT der Lead bekommt, wenn keiner gilt.
 *
 * Das ist die Eigenschaft, die sich nur anwendungsseitig prüfen lässt — und die einzige, an der eine
 * Manipulation vom Browser aus etwas ändern könnte, wenn sie falsch wäre.
 *
 * ── WARUM DAS STORE-MODUL ERSETZT WIRD ───────────────────────────────────────────────────────────
 * `lib/leads/store.ts` trägt `import 'server-only'` und erzeugt einen service_role-Client — ein
 * Import davon würde ausserhalb der React-Server-Umgebung hart werfen. Die Ersetzung ist damit nicht
 * Bequemlichkeit, sondern die Voraussetzung dafür, die ECHTE Funktion aufzurufen statt einer
 * nachgebauten Kopie ihrer Logik. Gleiches gilt für das `server-only`-Paket selbst, das
 * `capture.ts` importiert.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActivePartner: vi.fn(),
}))

vi.mock('server-only', () => ({}))

vi.mock('./store', () => ({
  getActivePartner: mocks.getActivePartner,
  captureLead: vi.fn(),
  getActiveConsentText: vi.fn(),
}))

vi.mock('./mail', () => ({ sendConsentConfirmationMail: vi.fn() }))
vi.mock('./tokens', () => ({ createConfirmationToken: vi.fn() }))
vi.mock('next-intl/server', () => ({ getLocale: async () => 'de' }))
vi.mock('@/lib/site', () => ({ absoluteUrl: (path: string) => `https://coolin.at${path}` }))

const { resolvePartnerAttribution } = await import('./capture')

const RAYMANN = { slug: 'raymann', displayName: 'Raymann Elektrotechnik GmbH' }

beforeEach(() => {
  mocks.getActivePartner.mockReset()
})

describe('resolvePartnerAttribution — der Pfad der Landingpage', () => {
  it('ein aktiver Fachbetrieb: eigene Herkunft UND Zuordnung', async () => {
    mocks.getActivePartner.mockResolvedValue(RAYMANN)

    const result = await resolvePartnerAttribution({ pathSlug: 'raymann' })

    expect(result).toEqual({
      sourceKey: 'partner-empfehlung',
      partnerSlug: 'raymann',
      partnerDisplayName: 'Raymann Elektrotechnik GmbH',
    })
  })

  it('DER PFAD SCHLÄGT DEN RUMPF — ein mitgeschickter Slug wird nicht einmal nachgeschlagen', async () => {
    /*
     * Die Manipulationsprobe. An der Zuordnung hängt später, wer ein Montageprojekt bekommt; ein
     * Wert, den der Browser stellt, darf darüber nicht entscheiden. Der Beweis ist nicht nur das
     * Ergebnis, sondern das ARGUMENT des einzigen Aufrufs: nachgeschlagen wird ausschliesslich der
     * Pfad-Slug.
     */
    mocks.getActivePartner.mockResolvedValue(RAYMANN)

    const result = await resolvePartnerAttribution({
      pathSlug: 'raymann',
      querySlug: 'fremder-betrieb',
    })

    expect(mocks.getActivePartner).toHaveBeenCalledTimes(1)
    expect(mocks.getActivePartner).toHaveBeenCalledWith('raymann')
    expect(result.partnerSlug).toBe('raymann')
  })

  it('unbekannter oder stillgelegter Fachbetrieb: KEINE Zuordnung UND nicht die Partner-Herkunft', async () => {
    /*
     * Der reale Fall: Ein Fachbetrieb wird stillgelegt, während seine Serienmail noch in Postfächern
     * liegt. Die Anfrage muss ankommen (sonst kostete ein toter Link einen echten Kunden) — aber sie
     * darf keine Partner-Aussendung BEHAUPTEN, zu der es keinen Partner gibt: `first_source_key` ist
     * seit B1-1 unveränderlich, die Zeile wäre nicht mehr zu bereinigen.
     */
    mocks.getActivePartner.mockResolvedValue(null)

    const result = await resolvePartnerAttribution({ pathSlug: 'stillgelegt' })

    expect(result).toEqual({
      sourceKey: 'kontaktformular',
      partnerSlug: null,
      partnerDisplayName: null,
    })
  })

  it('formatverletzender Slug: gar kein Datenbankaufruf', async () => {
    const result = await resolvePartnerAttribution({ pathSlug: 'raymann_elektro' })

    expect(mocks.getActivePartner).not.toHaveBeenCalled()
    expect(result.partnerSlug).toBeNull()
    expect(result.sourceKey).toBe('kontaktformular')
  })

  it('Datenbankfehler: keine Zuordnung, aber auch kein geworfener Fehler', async () => {
    // Ein Lesefehler darf keine Kundenanfrage kosten — die Erfassung läuft weiter, nur ohne Partner.
    mocks.getActivePartner.mockRejectedValue(new Error('Netzwerk weg'))

    const result = await resolvePartnerAttribution({ pathSlug: 'raymann' })

    expect(result.partnerSlug).toBeNull()
    expect(result.sourceKey).toBe('kontaktformular')
  })
})

describe('resolvePartnerAttribution — der ?partner=-Parameter auf /kontakt', () => {
  it('gültiger Slug: Zuordnung ja, eigene Herkunft NEIN', async () => {
    /*
     * Der Unterschied zur Landingpage, und er ist beabsichtigt: Die Person ist über die gewöhnliche
     * Kontaktseite gekommen — das ist die Herkunft. Der Partner ist eine zusätzliche Angabe an
     * dieser Anfrage, keine andere Anfrage.
     */
    mocks.getActivePartner.mockResolvedValue(RAYMANN)

    const result = await resolvePartnerAttribution({ querySlug: 'raymann' })

    expect(result).toEqual({
      sourceKey: 'kontaktformular',
      partnerSlug: 'raymann',
      partnerDisplayName: 'Raymann Elektrotechnik GmbH',
    })
  })

  it('unbekannter Slug: still verworfen, die Anfrage bleibt', async () => {
    mocks.getActivePartner.mockResolvedValue(null)

    const result = await resolvePartnerAttribution({ querySlug: 'erfunden' })

    expect(result.partnerSlug).toBeNull()
    expect(result.sourceKey).toBe('kontaktformular')
  })

  it('ohne jede Angabe: keine Zuordnung, kein Aufruf', async () => {
    const result = await resolvePartnerAttribution({})

    expect(mocks.getActivePartner).not.toHaveBeenCalled()
    expect(result).toEqual({
      sourceKey: 'kontaktformular',
      partnerSlug: null,
      partnerDisplayName: null,
    })
  })
})
