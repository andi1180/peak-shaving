'use client'

import { useEffect, useId, useState } from 'react'
import { Printer } from 'lucide-react'
import {
  parseReportGate,
  type ReportGateFieldErrors,
  type ReportGateFieldKey,
} from 'shared'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { DATENSCHUTZ_URL } from '@/lib/constants'
import { loadReportGateConsentText, submitReportGate } from '@/lib/report-gate/actions'

/**
 * Delta 16b — das Name/Firma-Gate vor dem Download des erweiterten Reports (§5.1, Delta 16
 * Entscheidung 2).
 *
 * ── WAS DIESES FORMULAR IST, UND WAS ES NICHT IST ──────────────────────────────────────────────
 * Es ist eine echte, konsentgebundene Lead-Erfassung — kein Personalisierungsfeld. Was hier
 * eingetragen wird, steht danach in `platform.leads`, und der Haken erzeugt eine Zeile in
 * `platform.consents` mit dem Wortlaut, der hier stand. Der Name auf dem Deckblatt ist die sichtbare
 * Nebenwirkung, nicht der Zweck.
 *
 * Es ist ausdrücklich NICHT der Nachfolger von `lead-dialog.tsx` („Kostenloses Angebot anfordern",
 * bis heute ein Stub, der nichts persistiert). Der bleibt, wo er ist; ihn mitzulösen war nicht
 * Gegenstand dieses Abschnitts.
 *
 * ── DIE VERBRAUCHSDATEN BLEIBEN, WO SIE SIND ───────────────────────────────────────────────────
 * Abgesendet werden vier Zeichenketten und ein Haken. Lastgang, PV-Profil und die hochgeladene
 * Datei kommen in diesem Formular nicht vor — Prinzip 4 ist unangetastet, und der Satz darüber im
 * Dialog ist deshalb wahr und keine Beruhigung.
 *
 * ── DER HAKEN IST NIE VORAUSGEWÄHLT (Planet49, EuGH C-673/17) ──────────────────────────────────
 * `useState(false)`, und der Zustand wird bei jedem Öffnen zurückgesetzt. Eine vorangekreuzte
 * Einwilligung ist keine; §5.1 verlangt sie ausdrücklich „nicht vorausgewählt". Ohne Haken ist der
 * Absendeknopf gesperrt UND die Server Action lehnt ab — die sichtbare Sperre ist die Höflichkeit,
 * die serverseitige die Wirksamkeit.
 *
 * ── OHNE WORTLAUT KEINE EINWILLIGUNG ───────────────────────────────────────────────────────────
 * Der angezeigte Text kommt serverseitig aus `platform.consent_texts` — dieselbe Quelle und
 * dieselbe Auswahlregel, mit der `capture_lead` ihn archiviert. Liefert sie nichts, wird die
 * Ankreuzmöglichkeit GAR NICHT gezeigt und das Absenden bleibt gesperrt: ein hier hartkodierter
 * Ersatztext wäre ein Nachweis über einen Wortlaut, der nirgends steht.
 *
 * ── B23a — ZWEI ZUSÄTZLICHE FELDER FÜR DAS DOKUMENT, UND SIE SIND ABSCHALTBAR ──────────────────
 * Der neue PDF-Report (react-pdf) trägt einen frei wählbaren TITEL und eine optionale ADRESSE auf
 * dem Deckblatt. Beide werden hier erhoben — aber NUR, wenn der Aufrufer sie über `documentFields`
 * anfordert.
 *
 * ⚠ WARUM NICHT BEDINGUNGSLOS, obwohl die Aufgabenstellung „zwei neue Felder" lautete: der neue
 * Weg ist in dieser Fassung ausdrücklich NICHT live (B23a; umgeschaltet wird mit B23c). Der Knopf
 * im Rechner löst weiterhin `window.print()` gegen das Print-Stylesheet aus, und dessen Deckblatt
 * (`print-cover.tsx`, in dieser PR unangetastet) kennt weder Titel noch Adresse. Bedingungslos
 * gerendert wären die zwei Felder deshalb genau das, was dieses Repo an anderer Stelle als
 * „Requisite" verwirft: erhoben, angezeigt, und ohne jede Wirkung — der alte Stub
 * `lead-dialog.tsx` tut bis heute genau das mit „Funktion/Rolle".
 *
 * Bei der ADRESSE wäre es zusätzlich mehr als eine Kosmetik: nach einer Anschrift zu fragen und sie
 * anschliessend zu verwerfen ist eine Erhebung ohne Zweck — und zwar personenbezogen. Die Adresse
 * wird deshalb weder gespeichert noch übertragen (kein Feld in `ReportGateSubmission`, keine Spalte
 * in `platform.leads`, kein Parameter in `capture_lead`); sie lebt im Zustand dieses Dialogs und
 * geht von dort in das Dokument, das der Browser erzeugt.
 *
 * OHNE `documentFields` ist diese Komponente Zeile für Zeile die bisherige — dieselben vier
 * Pflichtfelder, derselbe Honeypot, dieselbe Einwilligung, dieselbe Absendung.
 */

/* Getypt über `ReportGateFieldKey` (nicht `Record<string, string>`): ein neues Feld in `shared`
   ohne Beschriftung hier ist damit ein Typfehler und keine leere Zeile im Formular. */
const FIELD_LABEL: Record<ReportGateFieldKey, string> = {
  firstName: 'Vorname',
  lastName: 'Nachname',
  company: 'Firma',
  email: 'E-Mail',
}

const FIELD_ERROR_TEXT: Record<string, string> = {
  fieldRequired: 'Bitte ausfüllen.',
  tooLong: 'Diese Angabe ist zu lang.',
  emailInvalid: 'Bitte eine gültige E-Mail-Adresse eingeben.',
}

/**
 * Die Werte fürs Deckblatt.
 *
 * `name`/`company` stammen aus der ERFASSUNG (sie stehen danach in `platform.leads`).
 * `title`/`address` sind reine DOKUMENT-Angaben und entstehen nur, wenn der Aufrufer sie über
 * `documentFields` angefordert hat — sonst bleiben sie `undefined`, und der bestehende Aufrufer
 * (`step-result.tsx`) sieht keinen Unterschied.
 */
export type ReportGateCustomer = {
  name: string
  company: string
  /** B23a. `undefined`, wenn `documentFields` nicht angefordert war. */
  title?: string
  /** B23a. Freitext, mehrzeilig, optional — wird NICHT gespeichert (s. Kopf). */
  address?: string
}

/**
 * B23a — die Dokument-Felder anfordern.
 *
 * `defaultTitle` wird HEREINGEREICHT und nicht hier abgeleitet: die Ableitung braucht das
 * Rechenergebnis (`defaultReportTitle` in `lib/pdf-report/derive.ts`, sie liest
 * `tariffOptimization.computable`), und dieser Dialog kennt es nicht. Ihn das Ergebnis lesen zu
 * lassen, hiesse ein Lead-Formular an den Contract zu binden, von dem es nichts braucht.
 */
export type ReportGateDocumentFields = { defaultTitle: string }

export function ReportGateDialog({
  onUnlocked,
  documentFields,
}: {
  /** Wird GENAU EINMAL aufgerufen — nach erfolgreicher Erfassung, mit den Werten fürs Deckblatt. */
  onUnlocked: (customer: ReportGateCustomer) => void
  /** B23a. Fehlt sie, werden Titel und Adresse GAR NICHT gerendert — s. Kopf. */
  documentFields?: ReportGateDocumentFields
}) {
  const [open, setOpen] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [company, setCompany] = useState('')
  const [email, setEmail] = useState('')
  /*
   * B23a. Der Titel startet auf dem VORSCHLAG und ist von dort an der Wert des Nutzers — bewusst
   * ohne Nachführung, wenn sich `defaultTitle` später ändert: was jemand getippt hat, gehört ihm.
   * Ohne `documentFields` bleiben beide Zustände unberührt und wandern nirgendwohin.
   */
  const [title, setTitle] = useState(documentFields?.defaultTitle ?? '')
  const [address, setAddress] = useState('')
  const [consent, setConsent] = useState(false)
  /** Der Honeypot. Ein Mensch sieht das Feld nicht und lässt es daher leer. */
  const [website, setWebsite] = useState('')
  const [fieldErrors, setFieldErrors] = useState<ReportGateFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [consentText, setConsentText] = useState<string | null>(null)
  const [consentTextLoaded, setConsentTextLoaded] = useState(false)

  const ids = useId()

  /*
   * Der Wortlaut wird beim ÖFFNEN geholt, nicht beim Rendern des Reports. Sonst liefe bei jedem
   * Analyselauf ein Datenbankaufruf, obwohl die meisten Nutzer den Report gar nicht drucken.
   */
  useEffect(() => {
    if (!open || consentTextLoaded) return
    let aborted = false
    void loadReportGateConsentText().then((text) => {
      if (aborted) return
      setConsentText(text)
      setConsentTextLoaded(true)
    })
    return () => {
      aborted = true
    }
  }, [open, consentTextLoaded])

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      // Beim Öffnen zurücksetzen — insbesondere der Haken (nie vorausgewählt, auch nicht beim
      // zweiten Anlauf nach einem Fehler).
      setConsent(false)
      setFieldErrors({})
      setFormError(null)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return

    setFormError(null)
    setFieldErrors({})

    const submission = { firstName, lastName, company, email, consent, website }

    /*
     * DIESELBE REGEL WIE AUF DEM SERVER — importiert, nicht nachgebaut (`shared/report-gate.ts`).
     * Der Client prüft für die RÜCKMELDUNG, der Server für die WAHRHEIT; zwei Regeln liefen
     * auseinander, und dann zeigte das Formular ein Feld als in Ordnung an, das die Action verwirft.
     *
     * ⚠ ABGEFANGEN WIRD HIER NUR, WAS DER ABSENDER SELBST BEHEBEN KANN: Feldfehler und der fehlende
     * Haken. Ein gefüllter HONEYPOT läuft bewusst DURCH bis zur Server Action — aus zwei Gründen,
     * und der erste ist beim Bauen gemessen worden:
     *
     *   1. Hier abgefangen passierte GAR NICHTS: kein Feldfehler, keine Meldung, kein Aufruf. Wen
     *      die Falle versehentlich trifft (Autofill), der drückt auf den Knopf und sieht zu, wie
     *      nichts geschieht — schlimmer als eine Absage, weil er nicht einmal weiss, dass es
     *      fehlgeschlagen ist.
     *   2. Die Falle ist eine SICHERHEITS-Entscheidung, und die gehört auf den Server. Ein
     *      automatisierter Absender ruft die Action ohnehin direkt auf und käme an jeder
     *      Client-Prüfung vorbei; die hier wäre dann eine Sperre, die genau den Falschen aufhält.
     */
    const local = parseReportGate(submission)
    if (!local.ok && local.reason === 'validation') {
      setFieldErrors(local.fieldErrors)
      return
    }
    if (!local.ok && local.reason === 'consent_missing') {
      setFormError('Bitte stimmen Sie zu, um fortzufahren.')
      return
    }

    setPending(true)
    try {
      const response = await submitReportGate(submission)
      if (response.ok) {
        setOpen(false)
        /*
         * B23a: Name und Firma kommen aus der ANTWORT DES SERVERS (er hat sie getrimmt und
         * geschrieben — massgeblich ist, was im Bestand steht). Titel und Adresse kommen aus dem
         * Formularzustand, weil sie nirgends hingeschickt wurden; ohne `documentFields` sind sie
         * `undefined` und der bestehende Aufrufer bekommt exakt das bisherige Objekt.
         */
        onUnlocked(
          documentFields
            ? { ...response.customer, title: title.trim(), address: address.trim() || undefined }
            : response.customer,
        )
        return
      }
      if (response.error === 'validation') {
        setFieldErrors(response.fieldErrors as ReportGateFieldErrors)
        return
      }
      if (response.error === 'consent_missing') {
        setFormError('Bitte stimmen Sie zu, um fortzufahren.')
        return
      }
      /*
       * 'spam' und 'unavailable' bekommen DIESELBE Meldung. Ein eigener Satz für den Honeypot
       * verriete einem Bot, dass er in die Falle gelaufen ist; und ein Mensch, den die Falle
       * versehentlich trifft, ist mit „bitte melden Sie sich" ohnehin besser bedient als mit einer
       * Erklärung, die er nicht einordnen kann.
       */
      setFormError(
        'Das hat gerade nicht geklappt. Bitte versuchen Sie es erneut oder schreiben Sie an ' +
          'energy@coolin.at — den Report senden wir Ihnen dann zu.',
      )
    } catch {
      setFormError(
        'Das hat gerade nicht geklappt. Bitte versuchen Sie es erneut oder schreiben Sie an ' +
          'energy@coolin.at — den Report senden wir Ihnen dann zu.',
      )
    } finally {
      setPending(false)
    }
  }

  const consentAvailable = consentText !== null
  const canSubmit = consentAvailable && consent && !pending

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {/*
        KEIN `DialogTrigger asChild` mit dem Knopf: der Knopf steht in `step-result.tsx` in einer
        Reihe mit den anderen Ausgabewegen und wird dort gerendert. Hier wird er als eigener,
        gleich aussehender Auslöser geführt, damit die ganze Gate-Mechanik in EINER Datei bleibt.
      */}
      <Button variant="outline" size="sm" onClick={() => handleOpenChange(true)}>
        <Printer className="h-4 w-4" />
        Als PDF speichern
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report herunterladen</DialogTitle>
          <DialogDescription>
            Der ausführliche Report trägt Ihren Namen und Ihre Firma auf dem Deckblatt. Ihre
            Verbrauchsdaten werden dabei nicht übertragen — sie bleiben in Ihrem Browser.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id={`${ids}-firstName`}
              label={FIELD_LABEL.firstName}
              value={firstName}
              onChange={setFirstName}
              autoComplete="given-name"
              error={fieldErrors.firstName}
            />
            <Field
              id={`${ids}-lastName`}
              label={FIELD_LABEL.lastName}
              value={lastName}
              onChange={setLastName}
              autoComplete="family-name"
              error={fieldErrors.lastName}
            />
            <Field
              id={`${ids}-company`}
              label={FIELD_LABEL.company}
              value={company}
              onChange={setCompany}
              autoComplete="organization"
              className="sm:col-span-2"
              error={fieldErrors.company}
            />
            <Field
              id={`${ids}-email`}
              label={FIELD_LABEL.email}
              value={email}
              onChange={setEmail}
              type="email"
              autoComplete="email"
              className="sm:col-span-2"
              error={fieldErrors.email}
            />
          </div>

          {/*
            B23a — die Dokument-Angaben. Sie stehen UNTER den Pflichtfeldern und optisch abgesetzt,
            weil sie eine andere Sache sind: die vier oben werden erfasst und gespeichert, diese
            zwei gestalten nur das Blatt. Sie erscheinen ausschliesslich, wenn der Aufrufer sie
            angefordert hat — s. Kopf.
          */}
          {documentFields && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-title`}>Titel des Dokuments</Label>
                <Input
                  id={`${ids}-title`}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <p className="text-xs text-text-muted">
                  Vorgeschlagen aus Ihrer Auswertung — Sie können ihn überschreiben.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${ids}-address`}>Adresse (falls bekannt)</Label>
                <Textarea
                  id={`${ids}-address`}
                  value={address}
                  rows={3}
                  autoComplete="street-address"
                  onChange={(e) => setAddress(e.target.value)}
                />
                {/*
                  Der Satz ist keine Beruhigung, sondern eine Tatsache über den Code: es gibt kein
                  Feld dafür in `ReportGateSubmission`, keine Spalte in `platform.leads` und keinen
                  Parameter in `capture_lead`.
                */}
                <p className="text-xs text-text-muted">
                  Erscheint nur auf dem Deckblatt. Wird nicht übertragen und nicht gespeichert.
                </p>
              </div>
            </div>
          )}

          {/*
            HONEYPOT — gleicher Feldname (`website`) und gleiche Mechanik wie im Erfassungspfad von
            `apps/web`. Versteckt über `hidden`-Positionierung statt `type="hidden"`: ein
            `type="hidden"` füllt kein Bot-Skript aus, das Formulare wie ein Browser bedient. Kein
            `tabIndex`-Sprung und `aria-hidden`, damit weder Tastatur noch Screenreader je darauf
            landen — die Falle darf einen Menschen nicht treffen.

            ⚠ Turnstile gibt es in dieser App NICHT (in `apps/web` schon, `lib/kontakt/turnstile.ts`).
            Der Honeypot ist hier der vollständige Bot-Schutz, nicht der Fallback. Wer Turnstile
            nachrüstet, braucht dafür ein zweites Schlüsselpaar im Vercel-Projekt
            `peak-shaving-website` und das Widget-Skript — s. DEPLOYMENT.md §1-Website-b.
          */}
          <div className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden" aria-hidden>
            <label htmlFor={`${ids}-website`}>Website (bitte frei lassen)</label>
            <input
              id={`${ids}-website`}
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          {consentAvailable ? (
            <label className="flex items-start gap-2 text-sm text-text-muted">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                className="mt-0.5"
                aria-describedby={`${ids}-consent-text`}
              />
              <span id={`${ids}-consent-text`}>
                {consentText}{' '}
                <a
                  href={DATENSCHUTZ_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  Datenschutzerklärung
                </a>
              </span>
            </label>
          ) : (
            <p role="status" className="text-sm text-text-muted">
              {consentTextLoaded
                ? 'Der Einwilligungstext ist gerade nicht abrufbar. Ohne ihn können wir Ihre ' +
                  'Zustimmung nicht einholen — bitte versuchen Sie es später erneut.'
                : 'Einwilligungstext wird geladen …'}
            </p>
          )}

          {formError && (
            <p role="alert" className="text-sm text-negative">
              {formError}
            </p>
          )}

          <Button type="submit" disabled={!canSubmit}>
            {pending ? 'Wird gesendet …' : 'Report herunterladen'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = 'text',
  autoComplete,
  className,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: string
  autoComplete?: string
  className?: string
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label} *</Label>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-negative">
          {FIELD_ERROR_TEXT[error] ?? 'Bitte prüfen Sie diese Angabe.'}
        </p>
      )}
    </div>
  )
}
