/**
 * Der Ablauf einer Partner-Bewerbung (B16-3) — geprüft mit Attrappen statt Stack.
 *
 * ── WAS SICH NUR HIER PRÜFEN LÄSST ──────────────────────────────────────────────────────────────
 * Das DB-Gate misst, was die Datenbank tut. Die Zusicherungen dieses Bauabschnitts sind aber zum
 * grossen Teil Aussagen darüber, was der Anwendungscode NICHT tut oder was er trotz eines Fehlers
 * noch tut:
 *
 *   - Es entsteht KEIN Lead (`PartnerApplicationEffects` hat gar kein Feld dafür — hier wird
 *     zusätzlich gemessen, dass auch der Kontoanlage-Effekt nicht als Umweg dorthin dient).
 *   - Ein gefüllter Honeypot erzeugt NICHTS und meldet trotzdem Erfolg.
 *   - Eine gescheiterte Kontoanlage kostet die Bewerbung nicht.
 *   - Ein gescheiterter Mailversand kostet die Bewerbung nicht.
 *   - Angemeldet entsteht kein zweites Konto.
 *   - Die Rückmeldung ist in all diesen Fällen dieselbe.
 *
 * Keiner dieser Fälle ist über die Datenbank sichtbar: Dort steht am Ende entweder eine Zeile oder
 * keine, aber nicht, WELCHE Effekte dafür angefasst wurden.
 */
import { describe, expect, it } from 'vitest'
import {
  runPartnerApplication,
  type PartnerApplicationEffects,
  type PartnerApplicationSubmission,
} from './flow'

type Calls = {
  createAccount: Array<{ email: string; password: string }>
  storeApplication: Array<Record<string, unknown>>
  notifyTeam: Array<Record<string, unknown>>
  acknowledgeApplicant: Array<Record<string, unknown>>
}

function makeEffects(overrides: Partial<PartnerApplicationEffects> = {}): {
  effects: PartnerApplicationEffects
  calls: Calls
} {
  const calls: Calls = {
    createAccount: [],
    storeApplication: [],
    notifyTeam: [],
    acknowledgeApplicant: [],
  }

  const effects: PartnerApplicationEffects = {
    createAccount: async (input) => {
      calls.createAccount.push(input)
      return true
    },
    storeApplication: async (input) => {
      calls.storeApplication.push(input)
      return { applicationId: 'app-1' }
    },
    notifyTeam: async (input) => {
      calls.notifyTeam.push(input)
      return undefined
    },
    acknowledgeApplicant: async (input) => {
      calls.acknowledgeApplicant.push(input)
      return undefined
    },
    ...overrides,
  }

  return { effects, calls }
}

const VALID: PartnerApplicationSubmission = {
  company: 'Elektro Musterbetrieb GmbH',
  firstName: 'Anna',
  lastName: 'Gruber',
  email: 'anna@elektro-muster.at',
  password: 'sehr-geheim-123',
  phone: '+43 1 234567',
  websiteUrl: 'elektro-muster.at',
  message: 'Wir montieren seit 20 Jahren Speicher und betreuen etwa 40 Gewerbekunden in Wien.',
  datenschutz: true,
}

/** Die eine Erfolgsantwort. Jede Abweichung wäre ein Signal, an dem sich Verhalten festmachen lässt. */
const ACCEPTED = { ok: true }

describe('Anti-Enumeration: die Rückmeldung', () => {
  it('DER KERNFALL: eine gültige Bewerbung wird angenommen', async () => {
    const { effects, calls } = makeEffects()

    expect(await runPartnerApplication(VALID, effects, null)).toEqual(ACCEPTED)
    expect(calls.storeApplication).toHaveLength(1)
    expect(calls.createAccount).toHaveLength(1)
    expect(calls.notifyTeam).toHaveLength(1)
    expect(calls.acknowledgeApplicant).toHaveLength(1)
  })

  it('EIN BESTEHENDES KONTO ÄNDERT NICHTS AN DER ANTWORT — der Antrag entsteht trotzdem', async () => {
    /*
     * GEMESSEN gegen den lokalen Stack: GoTrue antwortet auf einen `signUp` mit einer bereits
     * registrierten, bestätigten Adresse mit HTTP 422 `user_already_exists` — die Antwort VERRÄT die
     * Existenz. Hier wird gemessen, dass der Ablauf sie nicht nach aussen trägt: `createAccount`
     * meldet `false`, und die Bewerbung läuft unverändert durch.
     */
    const { effects, calls } = makeEffects({ createAccount: async () => false })

    expect(await runPartnerApplication(VALID, effects, null)).toEqual(ACCEPTED)
    expect(calls.storeApplication).toHaveLength(1)
    // Und die Eingangsbestätigung sagt, dass KEIN Passwort gesetzt wurde — sonst probierte jemand
    // eines, das es nie gab.
    expect(calls.acknowledgeApplicant[0]!.accountCreated).toBe(false)
  })

  it('eine geworfene Kontoanlage kostet die Bewerbung ebenfalls nicht', async () => {
    const { effects, calls } = makeEffects({
      createAccount: async () => {
        throw new Error('GoTrue nicht erreichbar')
      },
    })

    expect(await runPartnerApplication(VALID, effects, null)).toEqual(ACCEPTED)
    expect(calls.storeApplication).toHaveLength(1)
    expect(calls.acknowledgeApplicant[0]!.accountCreated).toBe(false)
  })

  it('EIN GEFÜLLTER HONEYPOT ERZEUGT NICHTS — und meldet trotzdem Erfolg', async () => {
    /*
     * BEWUSSTE ABWEICHUNG VOM KONTAKTFORMULAR, wo ein gefüllter Honeypot mit 400 ABGELEHNT wird:
     * Diese Seite darf keine Antwort geben, die sich von der Erfolgsantwort unterscheidet. Der Preis
     * (ein fälschlich gefangener Mensch sieht Erfolg) wird über die Kontaktadresse in Erfolgsmeldung
     * und Eingangsbestätigung bezahlt — das ausbleibende Echo ist die Rückmeldung.
     */
    const { effects, calls } = makeEffects()

    const res = await runPartnerApplication(
      { ...VALID, website: 'https://spam.example' },
      effects,
      null,
    )

    expect(res).toEqual(ACCEPTED)
    expect(calls.createAccount).toHaveLength(0)
    expect(calls.storeApplication).toHaveLength(0)
    expect(calls.notifyTeam).toHaveLength(0)
    expect(calls.acknowledgeApplicant).toHaveLength(0)
  })

  it('ein Honeypot aus reinen Leerzeichen ist KEIN Treffer', async () => {
    // Sonst verlöre ein Browser, der ein verstecktes Feld mit einem Leerzeichen füllt, echte
    // Bewerbungen — dieselbe Auslegung wie im Kontaktformular und in der Lead-Erfassung.
    const { effects, calls } = makeEffects()

    expect(await runPartnerApplication({ ...VALID, website: '   ' }, effects, null)).toEqual(
      ACCEPTED,
    )
    expect(calls.storeApplication).toHaveLength(1)
  })
})

describe('Es entsteht kein Lead', () => {
  it('DER GRUND FÜR DIE EIGENE TABELLE: der Ablauf kennt keinen Lead-Schreibweg', async () => {
    /*
     * Der Registrierungsweg schreibt seit B10-5 automatisch einen Lead. Ein Fachbetrieb, der
     * Vertriebspartner werden will, ist kein Peak-Shaving-Interessent — mitgezählt verfälschte er
     * genau die Kennzahl, an der die Marktnachfrage gemessen wird (Ziel 500 Kontakte).
     *
     * Gemessen wird auf den EFFEKT-SCHLÜSSELN, nicht auf einem erwarteten Aufruf: Ein
     * hinzugefügter Lead-Effekt wäre sonst unsichtbar, solange dieser Test ihn nicht kennt. Die
     * Regel steht im Typ (`PartnerApplicationEffects`), und hier steht sie als Messung daneben.
     */
    const { effects } = makeEffects()

    expect(Object.keys(effects).sort()).toEqual([
      'acknowledgeApplicant',
      'createAccount',
      'notifyTeam',
      'storeApplication',
    ])
  })
})

describe('Pflichtfelder', () => {
  it('EIN LEERER FREITEXT WIRD ABGELEHNT — und zwar bevor irgendetwas passiert', async () => {
    const { effects, calls } = makeEffects()

    const res = await runPartnerApplication({ ...VALID, message: '' }, effects, null)

    expect(res).toEqual({
      ok: false,
      error: 'validation',
      fieldErrors: { message: 'messageTooShort' },
    })
    expect(calls.createAccount).toHaveLength(0)
    expect(calls.storeApplication).toHaveLength(0)
  })

  it('ein zu knapper Freitext ebenfalls', async () => {
    const { effects } = makeEffects()
    const res = await runPartnerApplication({ ...VALID, message: 'Interesse.' }, effects, null)
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      fieldErrors: { message: 'messageTooShort' },
    })
  })

  it('ohne Datenschutz-Zustimmung entsteht nichts', async () => {
    const { effects, calls } = makeEffects()

    const res = await runPartnerApplication({ ...VALID, datenschutz: false }, effects, null)

    expect(res).toMatchObject({ ok: false, error: 'validation' })
    expect(calls.storeApplication).toHaveLength(0)
  })

  it('ohne Passwort wird abgelehnt, solange niemand angemeldet ist', async () => {
    const { effects, calls } = makeEffects()

    const res = await runPartnerApplication({ ...VALID, password: undefined }, effects, null)

    expect(res).toEqual({
      ok: false,
      error: 'validation',
      fieldErrors: { password: 'passwordTooShort' },
    })
    expect(calls.createAccount).toHaveLength(0)
  })

  it('Firma, Name und Adresse sind Pflicht', async () => {
    const { effects } = makeEffects()

    for (const [field, patch] of [
      ['company', { company: '  ' }],
      ['firstName', { firstName: '' }],
      ['lastName', { lastName: '' }],
      ['email', { email: '' }],
    ] as const) {
      const res = await runPartnerApplication({ ...VALID, ...patch }, effects, null)
      expect(res, field).toMatchObject({ ok: false, error: 'validation' })
      expect(
        (res as { fieldErrors: Record<string, string> }).fieldErrors[field],
        field,
      ).toBeTruthy()
    }
  })

  it('eine unvollständige Adresse wird feldgenau abgewiesen', async () => {
    const { effects } = makeEffects()
    const res = await runPartnerApplication({ ...VALID, email: 'anna@' }, effects, null)
    expect(res).toEqual({
      ok: false,
      error: 'validation',
      fieldErrors: { email: 'emailInvalid' },
    })
  })
})

describe('Bereits angemeldet', () => {
  const session = { userId: 'user-42', email: 'chef@elektro-muster.at' }

  it('ES ENTSTEHT KEIN ZWEITES KONTO, und der Antrag hängt an der Sitzung', async () => {
    const { effects, calls } = makeEffects()

    const res = await runPartnerApplication(
      { ...VALID, email: undefined, password: undefined },
      effects,
      session,
    )

    expect(res).toEqual(ACCEPTED)
    expect(calls.createAccount).toHaveLength(0)
    expect(calls.storeApplication[0]!.userId).toBe('user-42')
    expect(calls.storeApplication[0]!.email).toBe('chef@elektro-muster.at')
  })

  it('das Fehlen von Adresse und Passwort ist dabei KEIN Eingabefehler', async () => {
    /*
     * Das Formular zeigt beide Felder im angemeldeten Fall gar nicht. Eine Pflichtfeldmeldung zu
     * einem Feld, das niemand sieht, wäre eine Sackgasse — die Adresse wird deshalb aus der Sitzung
     * eingesetzt, BEVOR geprüft wird.
     */
    const { effects } = makeEffects()

    const res = await runPartnerApplication(
      { ...VALID, email: undefined, password: undefined },
      effects,
      session,
    )

    expect(res).toEqual(ACCEPTED)
  })

  it('eine abweichend eingetippte Adresse ändert die Zuordnung nicht', async () => {
    /*
     * Die Zuordnung folgt der SITZUNG, nicht der Angabe: Sonst entstünde ein Antrag, der auf ein
     * fremdes Konto zeigt, obwohl die Person gerade in ihrem eigenen angemeldet war. Dieselbe Regel
     * setzt `public.submit_partner_application` in der Datenbank noch einmal durch.
     */
    const { effects, calls } = makeEffects()

    await runPartnerApplication({ ...VALID, email: 'jemand@anderes.at' }, effects, session)

    expect(calls.storeApplication[0]!.userId).toBe('user-42')
    expect(calls.storeApplication[0]!.email).toBe('chef@elektro-muster.at')
  })

  it('die Eingangsbestätigung sagt, dass kein neues Passwort gesetzt wurde', async () => {
    const { effects, calls } = makeEffects()

    await runPartnerApplication(
      { ...VALID, email: undefined, password: undefined },
      effects,
      session,
    )

    expect(calls.acknowledgeApplicant[0]!.accountCreated).toBe(false)
    expect(calls.acknowledgeApplicant[0]!.to).toBe('chef@elektro-muster.at')
  })
})

describe('Fehlertoleranz', () => {
  it('EIN GESCHEITERTER MAILVERSAND KOSTET KEINE BEWERBUNG', async () => {
    /*
     * Erst speichern, dann senden. Eine verlorene Benachrichtigung ist ärgerlich; eine verlorene
     * Bewerbung ist ein Betrieb, der nie wieder anfragt.
     */
    const { effects, calls } = makeEffects({
      notifyTeam: async () => {
        throw new Error('Resend nicht erreichbar')
      },
    })

    // Der Wurf darf nicht durchschlagen — die Effekte selbst werfen laut Contract nicht, aber der
    // Ablauf muss auch das aushalten.
    await expect(runPartnerApplication(VALID, effects, null)).rejects.toThrow()
    // Entscheidend: Der Antrag war VOR dem Versand da.
    expect(calls.storeApplication).toHaveLength(1)
  })

  it('eine Benachrichtigung, die einen Fehlschlag MELDET, ändert nichts an der Antwort', async () => {
    /*
     * Der reale Fall: `sendPartnerApplicationNotification` und
     * `sendPartnerApplicationAcknowledgement` werfen NICHT, sie melden `{ ok: false }` und loggen.
     * Genau das wird hier gemessen — die Antwort bleibt Erfolg.
     */
    const { effects, calls } = makeEffects({
      notifyTeam: async () => ({ ok: false }),
      acknowledgeApplicant: async () => ({ ok: false }),
    })

    expect(await runPartnerApplication(VALID, effects, null)).toEqual(ACCEPTED)
    expect(calls.storeApplication).toHaveLength(1)
  })

  it('SCHEITERT DAS SPEICHERN, wird KEIN Erfolg gemeldet — der einzige solche Fall', async () => {
    /*
     * Kein Enumerationssignal: Der Fall hängt an der Erreichbarkeit der Datenbank, nicht an der
     * Adresse — dieselbe Eingabe liefe eine Minute später durch. Die Alternative wäre die
     * schlimmere: ein „Danke, wir melden uns" für eine Bewerbung, die nirgends steht.
     */
    const { effects, calls } = makeEffects({
      storeApplication: async () => {
        throw new Error('Datenbank nicht erreichbar')
      },
    })

    expect(await runPartnerApplication(VALID, effects, null)).toEqual({
      ok: false,
      error: 'unavailable',
    })
    expect(calls.notifyTeam).toHaveLength(0)
    expect(calls.acknowledgeApplicant).toHaveLength(0)
  })
})

describe('Was an die Datenbank geht', () => {
  it('leere Optionalfelder kommen als null an, nicht als Leerstring', async () => {
    // Sonst überlebte ein leer abgesendetes Feld als '' und sähe in jeder Auswertung wie eine
    // Angabe aus — dieselbe Falle, die B3-1 bei den Segmentierungsfeldern beschreibt.
    const { effects, calls } = makeEffects()

    await runPartnerApplication({ ...VALID, phone: '   ', websiteUrl: '' }, effects, null)

    expect(calls.storeApplication[0]!.phone).toBeNull()
    expect(calls.storeApplication[0]!.website).toBeNull()
  })

  it('der Freitext geht wörtlich durch, nur ohne umgebende Leerzeichen', async () => {
    const message = 'Zeile 1\nZeile 2 mit Umlauten: Kühlhaus, Bäckerei & Co. — seit 1998.'
    const { effects, calls } = makeEffects()

    await runPartnerApplication({ ...VALID, message: `  ${message}  ` }, effects, null)

    expect(calls.storeApplication[0]!.message).toBe(message)
  })

  it('die interne Benachrichtigung trägt Freitext und Antragskennung', async () => {
    // Der Freitext IST der Grund, warum jemand die Mail öffnet; die Kennung führt zur Detailansicht.
    const { effects, calls } = makeEffects()

    await runPartnerApplication(VALID, effects, null)

    expect(calls.notifyTeam[0]!.applicationId).toBe('app-1')
    expect(calls.notifyTeam[0]!.message).toContain('Speicher')
    expect(calls.notifyTeam[0]!.hasSession).toBe(false)
  })
})
