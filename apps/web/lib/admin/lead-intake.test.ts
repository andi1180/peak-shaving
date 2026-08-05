import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { planLeadIntake } from './lead-intake'

/**
 * B19 — die Aufnahme einer telefonischen Anfrage.
 *
 * ── DIE EIGENSCHAFT, AN DER DIESER BAUABSCHNITT HÄNGT ───────────────────────────────────────────
 * Dieser Weg versendet KEINE E-Mail — nicht an den Interessenten und auch nicht intern. Das ist
 * keine Absicht, die man dokumentiert, sondern eine Eigenschaft, die geprüft gehört: Der erste
 * Test unten liest die QUELLE des gesamten Pfades und wird rot, sobald irgendwo ein Mailmodul
 * importiert wird. Ein Test, der nur das heutige Verhalten misst, fienge den nächsten Griff daneben
 * nicht — genau der wäre aber der teure.
 */

const HERE = join(process.cwd(), 'lib', 'admin')

/**
 * Der VOLLSTÄNDIGE Pfad, den ein Klick auf „Lead speichern" berührt: Seite → Formular → Action →
 * Entscheidungen. Fehlt hier eine Datei, prüft der Wächter weniger, als sein Name verspricht.
 */
const PFAD = [
  join(process.cwd(), 'app', 'admin', '(intern)', 'leads', 'neu', 'page.tsx'),
  join(process.cwd(), 'components', 'admin', 'lead-intake-form.tsx'),
  join(HERE, 'lead-intake-actions.ts'),
  join(HERE, 'lead-intake.ts'),
  // B19-Nachbesserung: der Leser der formlos erfassten Firmen liegt seither ebenfalls auf dem Weg.
  join(HERE, 'mentioned-businesses.ts'),
]

/**
 * Alles, was in diesem Projekt eine Mail erzeugt oder zustellt. `resend` steht mit drin, damit auch
 * ein direkt gezogenes SDK auffällt und nicht nur unsere eigenen Hüllen.
 */
const MAILMODULE = [
  'lib/kontakt/deliver',
  'lib/kontakt/submit',
  'lib/leads/mail',
  'lib/mail',
  'lib/email',
  'resend',
]

/** Importe (statisch und dynamisch), OHNE Kommentare — sonst wäre das Erklären der Regel ein Verstoss. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
  // `flatMap` statt `map`: die Gruppe ist typseitig optional, und ein `undefined` in der Liste
  // liefe später still an jeder Prüfung vorbei.
  return [
    ...withoutComments.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g),
  ].flatMap((match) => (match[1] ? [match[1]] : []))
}

describe('B19 — der Weg ist mailfrei, und das ist gemessen', () => {
  it('importiert an KEINER Stelle des Pfades ein Mailmodul', () => {
    const treffer: string[] = []
    for (const file of PFAD) {
      for (const spec of importsOf(file)) {
        /*
         * `@/` ist der Alias auf das App-Wurzelverzeichnis und wird ERSETZT, nicht ergänzt — ein
         * `@/` → `lib/` machte aus `@/lib/kontakt/deliver` ein `lib/lib/kontakt/deliver`, und der
         * Wächter liefe an genau dem Import vorbei, für den er gebaut ist. Beim Bauen gemessen: mit
         * der falschen Ersetzung blieb dieser Test grün, obwohl `deliverKontakt` importiert war.
         */
        const normalized = spec.replace(/^@\//, '').replace(/^\.\//, 'lib/admin/')
        if (MAILMODULE.some((mail) => normalized === mail || normalized.startsWith(`${mail}/`))) {
          treffer.push(`${file}: ${spec}`)
        }
      }
    }
    expect(treffer).toEqual([])
  })

  it('nennt in der Erfolgsmeldung ausdrücklich, dass nichts versendet wurde', () => {
    // Die Zusage steht dem Menschen gegenüber, der gerade telefoniert hat — nicht nur im Kommentar.
    const action = readFileSync(join(HERE, 'lead-intake-actions.ts'), 'utf8')
    expect(action).toContain('Es wurde keine E-Mail versendet.')
  })

  it('erzeugt keinen bestätigungspflichtigen Zweck — es gäbe keine Bestätigungsmail dafür', () => {
    /*
     * `platform.purpose_requires_double_opt_in` ist true für 'marketing_email' und
     * 'contract_expiry_reminder'. Beide brauchten eine Bestätigungsmail, um je den Zustand
     * 'confirmed' zu erreichen — die dieser Weg nicht versenden darf. Käme einer von ihnen in den
     * Plan, entstünde eine Einwilligung, die für immer 'pending' bleibt: im Admin-Bereich sichtbar
     * wie eine Zustimmung, nach `has_confirmed_consent` aber keine.
     */
    const plan = planLeadIntake(
      { ...GUELTIG, zuordnung: 'partner:raymann', partnerFreigabe: true },
      ['raymann'],
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const zwecke = plan.calls.map((call) => call.purpose)
    expect(zwecke).not.toContain('marketing_email')
    expect(zwecke).not.toContain('contract_expiry_reminder')
  })

  it('bietet gar kein Marketing-Feld an', () => {
    // Ein Feld, das der Plan ignoriert, wäre eine Requisite. Es darf auch nicht versehentlich
    // zurückkommen: Das Schema kennt den Namen nicht, das Formular rendert ihn nicht.
    const quelle = readFileSync(join(HERE, 'lead-intake.ts'), 'utf8')
    const formular = readFileSync(
      join(process.cwd(), 'components', 'admin', 'lead-intake-form.tsx'),
      'utf8',
    )
    expect(quelle).not.toMatch(/^\s*marketing:/m)
    expect(formular).not.toContain('name="marketing"')
  })
})

const GUELTIG = {
  vorname: 'Eva',
  nachname: 'Mayr-Stihl',
  email: 'eva.mayr@baeckerei-mayr.at',
  unternehmen: 'Bäckerei Mayr GmbH',
  telefon: '+43 1 234 5678',
  thema: '',
  zuordnung: '',
  neueFirma: '',
  datenschutz: true as const,
  partnerFreigabe: false,
}

describe('planLeadIntake — der Ablauf', () => {
  it('erzeugt GENAU EINEN capture_lead-Aufruf mit der neuen Herkunft und ohne Zweck', () => {
    const plan = planLeadIntake(GUELTIG, [])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.calls).toHaveLength(1)
    expect(plan.calls[0]).toMatchObject({
      email: 'eva.mayr@baeckerei-mayr.at',
      sourceKey: 'telefonanfrage',
      // Vertragsanbahnung, nicht Einwilligung — das Datenschutz-Häkchen erzeugt keine consents-Zeile.
      purpose: null,
      firstName: 'Eva',
      lastName: 'Mayr-Stihl',
      company: 'Bäckerei Mayr GmbH',
      phone: '+43 1 234 5678',
      partnerSlug: null,
    })
    expect(plan.mention).toBeNull()
  })

  it('macht aus der Partner-Freigabe einen ZWEITEN Aufruf, ohne die Identitätsfelder zu wiederholen', () => {
    const plan = planLeadIntake(
      { ...GUELTIG, zuordnung: 'partner:raymann', partnerFreigabe: true },
      ['raymann', 'huber'],
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.calls).toHaveLength(2)
    const [erster, zweiter] = plan.calls
    expect(erster?.purpose).toBeNull()
    expect(erster?.partnerSlug).toBe('raymann')

    expect(zweiter?.purpose).toBe('partner_lead_disclosure')
    expect(zweiter?.email).toBe(erster?.email)
    // `capture_lead` führt Identitätsfelder mit coalesce(Bestand, neu) zusammen — sie erneut zu
    // schicken änderte nichts und liesse den Aufruf so aussehen, als könnte er es.
    expect(zweiter?.firstName).toBeNull()
    expect(zweiter?.lastName).toBeNull()
    expect(zweiter?.company).toBeNull()
    expect(zweiter?.phone).toBeNull()
  })

  it('lehnt eine Freigabe OHNE zugeordneten Fachbetrieb ab, statt sie still zu verwerfen', () => {
    // Sonst entstünde eine bestätigte Einwilligung zu einer Weitergabe, die nicht stattfinden kann.
    const plan = planLeadIntake({ ...GUELTIG, zuordnung: '', partnerFreigabe: true }, ['raymann'])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.partnerFreigabe).toMatch(/Fachbetrieb/)
  })

  it('lehnt einen Fachbetrieb ab, den es nicht (mehr) aktiv gibt', () => {
    // Ein stillgelegter Betrieb zwischen Seitenaufbau und Klick: `capture_lead` verwürfe den Slug
    // still, und die Zuordnung sähe aus wie erfolgt.
    const plan = planLeadIntake({ ...GUELTIG, zuordnung: 'partner:stillgelegt' }, ['raymann'])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.zuordnung).toBeTruthy()
  })

  it('verweigert die Aufnahme ohne Datenschutz-Häkchen', () => {
    const plan = planLeadIntake({ ...GUELTIG, datenschutz: false as unknown as true }, [])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.datenschutz).toBeTruthy()
  })

  it('beanstandet eine unbrauchbare E-Mail-Adresse am Feld', () => {
    const plan = planLeadIntake({ ...GUELTIG, email: 'eva.mayr(at)baeckerei' }, [])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.email).toBeTruthy()
  })

  it('verlangt Vor- UND Nachnamen', () => {
    const plan = planLeadIntake({ ...GUELTIG, vorname: '  ', nachname: '' }, [])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.vorname).toBeTruthy()
    expect(plan.fieldErrors.nachname).toBeTruthy()
  })

  it('macht aus leeren Optionalfeldern `null`, nicht Leerstrings', () => {
    // Dieselbe Normalisierung wie `capture_lead`: ein Leerstring ist keine Angabe. Ohne sie
    // überschriebe eine zweite Erfassung einen echten Bestandswert mit „".
    const plan = planLeadIntake({ ...GUELTIG, unternehmen: '', telefon: '   ' }, [])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls[0]?.company).toBeNull()
    expect(plan.calls[0]?.phone).toBeNull()
  })
})

/**
 * Das Thema — seit `platform.leads.thema` existiert, ist es hier kein leeres Versprechen mehr.
 *
 * ── WAS HIER GEPRÜFT WIRD UND WAS BEWUSST NICHT ─────────────────────────────────────────────────
 * Was die Datenbank aus dem Wert macht (Speicherung, Zusammenführung, Anonymisierung), steht in
 * `packages/db-tests/src/lead-thema.test.ts`. Was nur hier prüfbar ist: dass der Wert überhaupt in
 * den Plan gerät, dass er OPTIONAL ist, und dass ein Wert, den die Taxonomie nicht kennt,
 * ABGEWIESEN wird statt still zu verschwinden — die Datenbank kann das nicht abfangen, sie trägt
 * bewusst keinen CHECK.
 */
describe('planLeadIntake — das Thema', () => {
  it('reicht ein gewähltes Thema als SCHLÜSSEL durch', () => {
    const plan = planLeadIntake({ ...GUELTIG, thema: 'peakShaving' }, [])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls[0]?.thema).toBe('peakShaving')
  })

  it('ist optional — ohne Auswahl entsteht der Lead trotzdem, mit thema = null', () => {
    /*
     * Der Unterschied zum öffentlichen Formular, wo das Feld Pflicht ist: Hier ordnet ein Mensch
     * ein Telefonat ein, und nicht jedes Gespräch lässt sich sauber zuschlagen. Ein Pflichtfeld
     * erzwänge eine erfundene Zuordnung.
     */
    const plan = planLeadIntake({ ...GUELTIG, thema: '' }, [])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls).toHaveLength(1)
    expect(plan.calls[0]?.thema).toBeNull()
  })

  it('macht aus reinen Leerzeichen `null`, nicht einen Leerstring', () => {
    // Ein '' überlebte jedes COALESCE und verdrängte über einen zweiten Kontakt ein echtes Thema.
    const plan = planLeadIntake({ ...GUELTIG, thema: '   ' }, [])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls[0]?.thema).toBeNull()
  })

  it('weist ein Thema ab, das die Taxonomie nicht kennt — statt es still zu verwerfen', () => {
    /*
     * Aus keinem gerenderten Auswahlfeld kann dieser Wert stammen. Still verworfen stünde am Ende
     * ein Lead ohne Thema da, obwohl jemand eines ausgewählt hat — dieselbe Regel wie bei
     * `zuordnung`.
     */
    const plan = planLeadIntake({ ...GUELTIG, thema: 'erfunden' }, [])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.thema).toBeTruthy()
  })

  it('trägt das Thema NICHT in den zweiten Aufruf der Partner-Freigabe', () => {
    // Der zweite Aufruf schreibt eine EINWILLIGUNG, nicht die Angaben — dieselbe Entscheidung wie
    // bei den Identitätsfeldern und wie im öffentlichen Weg (`lib/leads/capture.ts`).
    const plan = planLeadIntake(
      { ...GUELTIG, thema: 'esg', zuordnung: 'partner:raymann', partnerFreigabe: true },
      ['raymann'],
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls).toHaveLength(2)
    expect(plan.calls[0]?.thema).toBe('esg')
    expect(plan.calls[1]?.thema).toBeNull()
  })

  it('zählt die Themen NICHT selbst auf — die Liste kommt aus der Taxonomie', () => {
    /*
     * Der eigentliche Wächter dieses Schritts. Eine getippte Werteliste im Admin-Bereich wäre die
     * zweite Taxonomie, gegen die `lib/kontakt/themen.ts` gebaut ist: Beim ersten Leistungs-Rename
     * zeigte das Formular einen Namen, den es nicht mehr gibt, und die Prüfung liesse einen Wert
     * durch, den das öffentliche Formular gar nicht mehr anbietet.
     *
     * Geprüft an der QUELLE, weil ein Verhaltenstest das nicht sehen könnte: Eine abgetippte Liste
     * mit denselben acht Werten verhielte sich heute identisch und driftete erst später ab.
     */
    const quelle = readFileSync(join(HERE, 'lead-intake.ts'), 'utf8')
    const formular = readFileSync(
      join(process.cwd(), 'components', 'admin', 'lead-intake-form.tsx'),
      'utf8',
    )
    expect(quelle).toContain("from '@/lib/kontakt/themen'")
    for (const key of ['peakShaving', 'pvSpeicher', 'sonstiges']) {
      expect(quelle, `${key} darf im Admin-Schema nicht abgetippt stehen`).not.toContain(`'${key}'`)
      expect(formular, `${key} darf im Formular nicht abgetippt stehen`).not.toContain(`'${key}'`)
    }
  })
})

/**
 * B19-Nachbesserung — die formlose Firmenerwähnung.
 *
 * ── DIE EIGENSCHAFT, AN DER DIESER NACHTRAG HÄNGT ───────────────────────────────────────────────
 * Eine formlos genannte Firma darf NIE `partner_slug` setzen. Jene Spalte ist seit B18-6 ein
 * ZUGRIFFSRECHT: über sie zeigt `public.get_my_partner_leads` einem angemeldeten Fachbetrieb SEINE
 * Anfragen mit Namen. Ein Name, den jemand am Telefon gehört hat, hat weder Bewerbung noch Prüfung
 * noch Konto durchlaufen — er dort einzutragen wäre eine Partnerschaft durch Zuhören. Die Tests
 * unten messen das an JEDEM der drei Auswahlwege.
 */
describe('planLeadIntake — formlos genannte Firmen', () => {
  const FIRMA_ID = '11111111-2222-3333-4444-555555555555'

  it('setzt bei einer bestehenden Firma NIE partnerSlug', () => {
    const plan = planLeadIntake(
      { ...GUELTIG, zuordnung: `firma:${FIRMA_ID}` },
      ['raymann'],
      [FIRMA_ID],
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls).toHaveLength(1)
    expect(plan.calls[0]?.partnerSlug).toBeNull()
    expect(plan.mention).toEqual({ kind: 'existing', businessId: FIRMA_ID })
  })

  it('setzt bei einer NEUEN Firma NIE partnerSlug und reicht den Namen durch', () => {
    const plan = planLeadIntake(
      { ...GUELTIG, zuordnung: 'neu', neueFirma: '  Elektro Huber  ' },
      ['raymann'],
      [],
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls[0]?.partnerSlug).toBeNull()
    // Randleerzeichen fallen weg — sonst entstünde neben „Elektro Huber" ein zweiter Eintrag.
    expect(plan.mention).toEqual({ kind: 'new', name: 'Elektro Huber' })
  })

  it('erzeugt bei einem echten Fachbetrieb KEINE Firmenerwähnung', () => {
    // Die Gegenrichtung: eine Zuordnung ist kein Anlass, zusätzlich eine Notiz anzulegen.
    const plan = planLeadIntake({ ...GUELTIG, zuordnung: 'partner:raymann' }, ['raymann'], [])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls[0]?.partnerSlug).toBe('raymann')
    expect(plan.mention).toBeNull()
  })

  it('lehnt eine Freigabe an eine formlos genannte Firma ab', () => {
    /*
     * Sie hat kein Portal, kein Konto und keinen Anspruch — die Einwilligung hätte keinen
     * Gegenstand. Das ist ein FEHLER und kein stilles Verwerfen: Am Telefon hat jemand „ja" gesagt.
     */
    const plan = planLeadIntake(
      { ...GUELTIG, zuordnung: `firma:${FIRMA_ID}`, partnerFreigabe: true },
      ['raymann'],
      [FIRMA_ID],
    )
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.partnerFreigabe).toMatch(/Fachbetrieb/)
  })

  it('lehnt eine Firmenkennung ab, die das Formular nicht angeboten hat', () => {
    // Sonst schlüge erst `admin_attach_mentioned_business` mit 22023 fehl — nach dem Anlegen des
    // Leads, also als technischer Fehler statt als Feldmeldung davor.
    const plan = planLeadIntake(
      { ...GUELTIG, zuordnung: 'firma:erfunden' },
      ['raymann'],
      [FIRMA_ID],
    )
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.zuordnung).toBeTruthy()
  })

  it('verlangt einen Namen, wenn „neue Firma" gewählt ist', () => {
    // Still auf „keine Zuordnung" zurückzufallen sähe aus wie eine gespeicherte Angabe.
    const plan = planLeadIntake({ ...GUELTIG, zuordnung: 'neu', neueFirma: '   ' }, [], [])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.neueFirma).toBeTruthy()
  })

  it('weist einen Auswahlwert ohne bekanntes Präfix ab, statt ihn zu verwerfen', () => {
    // Ein Wert ohne Präfix kann aus keinem gerenderten Auswahlfeld stammen. Er DARF insbesondere
    // nicht als Slug durchgehen: das wäre genau der Weg zu einer erschlichenen Partner-Zuordnung.
    const plan = planLeadIntake({ ...GUELTIG, zuordnung: 'raymann' }, ['raymann'], [])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.zuordnung).toBeTruthy()
  })

  it('erzeugt ohne Auswahl weder Zuordnung noch Erwähnung', () => {
    const plan = planLeadIntake(GUELTIG, ['raymann'], [FIRMA_ID])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls[0]?.partnerSlug).toBeNull()
    expect(plan.mention).toBeNull()
  })
})

/** Entfernt Block- und Zeilenkommentare (dieselbe Aufbereitung wie beim Mailfreiheits-Wächter). */
function ohneKommentare(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

describe('B19-Nachbesserung — der Freitext ist aus DIESEM Weg verschwunden', () => {
  it('kennt weder ein Feld „empfehlung" noch schreibt es referred_by_text', () => {
    /*
     * `platform.leads.referred_by_text`, `public.capture_lead`, der öffentliche Kontaktweg und die
     * Partner-Landingpage bleiben unverändert — NUR dieser Aufrufort schreibt die Spalte nicht
     * mehr. Gemessen an der Quelle, weil ein Verhaltenstest ein wieder eingebautes Feld erst dann
     * fände, wenn jemand ihn erweitert.
     */
    // Kommentare vorher entfernen: Das ERKLÄREN der Regel darf nicht als Verstoss zählen — genau
    // diese Falle hat in B11 einmal zugeschlagen (der Wächter wurde am Erklärtext rot).
    const quelle = ohneKommentare(readFileSync(join(HERE, 'lead-intake.ts'), 'utf8'))
    const action = ohneKommentare(readFileSync(join(HERE, 'lead-intake-actions.ts'), 'utf8'))
    const formular = readFileSync(
      join(process.cwd(), 'components', 'admin', 'lead-intake-form.tsx'),
      'utf8',
    )
    expect(quelle).not.toContain('referredByText')
    expect(action).not.toContain('referredByText')
    expect(formular).not.toContain('name="empfehlung"')
  })

  it('legt in KEINEM Fall eine Partnerzeile an', () => {
    /*
     * Die schärfste Zusage dieses Nachtrags: `platform.partners` wird von diesem Pfad weder
     * erweitert noch beschrieben — auch nicht mit `is_active = false`. Es gibt dafür keinen
     * Wrapper, und dieser Wächter macht rot, sobald einer hier auftaucht.
     */
    const quelle = ohneKommentare(readFileSync(join(HERE, 'lead-intake.ts'), 'utf8'))
    const action = ohneKommentare(readFileSync(join(HERE, 'lead-intake-actions.ts'), 'utf8'))
    for (const datei of [quelle, action]) {
      expect(datei).not.toContain('admin_create_partner')
      expect(datei).not.toContain('admin_update_partner')
      expect(datei).not.toContain('admin_set_partner_active')
    }
  })
})
