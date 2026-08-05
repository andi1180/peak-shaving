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
      { ...GUELTIG, partnerSlug: 'raymann', partnerFreigabe: true },
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
    const formular = readFileSync(join(process.cwd(), 'components', 'admin', 'lead-intake-form.tsx'), 'utf8')
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
  empfehlung: 'mein Elektriker aus Wiener Neustadt',
  partnerSlug: '',
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
      referredByText: 'mein Elektriker aus Wiener Neustadt',
      partnerSlug: null,
    })
  })

  it('macht aus der Partner-Freigabe einen ZWEITEN Aufruf, ohne die Identitätsfelder zu wiederholen', () => {
    const plan = planLeadIntake(
      { ...GUELTIG, partnerSlug: 'raymann', partnerFreigabe: true },
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
    expect(zweiter?.referredByText).toBeNull()
  })

  it('lehnt eine Freigabe OHNE zugeordneten Fachbetrieb ab, statt sie still zu verwerfen', () => {
    // Sonst entstünde eine bestätigte Einwilligung zu einer Weitergabe, die nicht stattfinden kann.
    const plan = planLeadIntake({ ...GUELTIG, partnerSlug: '', partnerFreigabe: true }, ['raymann'])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.partnerFreigabe).toMatch(/Fachbetrieb/)
  })

  it('lehnt einen Fachbetrieb ab, den es nicht (mehr) aktiv gibt', () => {
    // Ein stillgelegter Betrieb zwischen Seitenaufbau und Klick: `capture_lead` verwürfe den Slug
    // still, und die Zuordnung sähe aus wie erfolgt.
    const plan = planLeadIntake({ ...GUELTIG, partnerSlug: 'stillgelegt' }, ['raymann'])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.fieldErrors.partnerSlug).toBeTruthy()
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
    const plan = planLeadIntake(
      { ...GUELTIG, unternehmen: '', telefon: '   ', empfehlung: '' },
      [],
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.calls[0]?.company).toBeNull()
    expect(plan.calls[0]?.phone).toBeNull()
    expect(plan.calls[0]?.referredByText).toBeNull()
  })
})
