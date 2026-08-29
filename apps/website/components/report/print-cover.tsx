import type { LoadProfile } from 'shared'

/**
 * Deckblatt des erweiterten Druck-Reports (Delta 16a, §6.2 „Installateur nimmt etwas zum
 * Dalassen mit").
 *
 * ── NUR IM DRUCK, UND DAS IST DER GANZE ENTWURF ─────────────────────────────────────────────────
 * `hidden print:block` — dasselbe Muster wie `print-assumptions-snapshot.tsx` (U2 Prompt D). Am
 * Bildschirm ändert sich durch diese Komponente nichts: der Report bleibt das ruhige, datendichte
 * Arbeitsdokument, das §6.2 verlangt. Ein Deckblatt IM Bildschirm-Report wäre eine Seite, durch die
 * sich jeder Nutzer bei jedem Lauf hindurchscrollen müsste.
 *
 * ── COOLiN, KEIN PARTNER-BRANDING ───────────────────────────────────────────────────────────────
 * Delta 16 stellt das ausdrücklich fest, und der Bestand bestätigt es: MVP §7 führt White-Label als
 * `[v2]`, und `platform.partners` trägt weder Logo noch Farbe (gemessen). Der Report trägt deshalb
 * COOLiNs eigene Marke. Die Akzentfarbe läuft trotzdem über `--color-accent` und nicht über einen
 * Hex-Wert — nicht als heimliche White-Label-Vorbereitung, sondern weil DESIGN.md kein Hex im Code
 * duldet und ein hartkodierter Ton hier später genau die Stelle wäre, die jemand übersieht.
 *
 * ── DER NAME/FIRMA-SLOT IST LEER, UND ER IST ABSICHTLICH SCHON DA ───────────────────────────────
 * `customer` ist optional und heute IMMER `undefined`: das Name/Firma-Gate ist Delta 16b (eigener
 * Bauabschnitt, eigener Prompt — es braucht eine Migration, einen Herkunftsschlüssel und
 * `apps/website`s ersten Server-Kontext). Ohne Angabe rendert der Block GAR NICHTS, statt eine
 * leere Zeile oder einen Platzhalterstrich zu zeigen: ein sichtbar leeres Feld auf einem Deckblatt
 * sieht aus wie ein Fehler beim Ausdrucken, nicht wie eine noch nicht gestellte Frage.
 *
 * Für 16b ist damit genau EINE Stelle zu verdrahten — diese Prop. Es gibt bewusst keinen zweiten
 * Ort, an dem ein Kundenname im Druck erscheinen könnte.
 */
export type PrintCoverCustomer = {
  name?: string
  company?: string
}

/** Erster und letzter Zeitstempel des Lastgangs, in Ortszeit — der ausgewertete Zeitraum. */
function formatPeriod(profile: LoadProfile): string | null {
  const first = profile.readings[0]
  const last = profile.readings[profile.readings.length - 1]
  if (!first || !last) return null
  const fmt = new Intl.DateTimeFormat('de-AT', {
    timeZone: profile.timezoneMeta,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  return `${fmt.format(Date.parse(first.ts))} – ${fmt.format(Date.parse(last.ts))}`
}

export function PrintCover({
  loadProfile,
  customer,
}: {
  loadProfile: LoadProfile
  /** Delta 16b. Heute immer `undefined` — s. Kopf. */
  customer?: PrintCoverCustomer
}) {
  const period = formatPeriod(loadProfile)
  const printedAt = new Intl.DateTimeFormat('de-AT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date())

  return (
    /*
     * `break-after-page`: alles Weitere beginnt auf einer neuen Seite. Ohne diese Regel liefe die
     * Kern-Kennzahl auf demselben Blatt weiter und das Deckblatt wäre kein Deckblatt, sondern eine
     * Überschrift.
     */
    <div className="hidden print:block print:break-after-page">
      <div className="flex min-h-[60vh] flex-col justify-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">COOLiN</p>
        <h1 className="mt-6 text-4xl font-semibold leading-tight text-ink">Peak-Shaving-Analyse</h1>
        <p className="mt-3 max-w-prose text-base text-text-muted">
          Wirtschaftlichkeitsbetrachtung eines Batteriespeichers auf Basis Ihres
          Viertelstunden-Lastgangs
        </p>

        {/* Delta 16b — heute nie gesetzt, s. Kopf. */}
        {(customer?.name || customer?.company) && (
          <div className="mt-10 border-l-2 border-accent pl-4">
            <p className="text-xs uppercase tracking-wide text-text-muted">Erstellt für</p>
            {customer.company && (
              <p className="mt-1 text-lg font-medium text-ink">{customer.company}</p>
            )}
            {customer.name && <p className="text-base text-text">{customer.name}</p>}
          </div>
        )}

        <dl className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-sm">
          {period && (
            <div className="flex gap-3">
              <dt className="w-44 shrink-0 text-text-muted">Ausgewerteter Zeitraum</dt>
              <dd className="font-medium text-ink tabular-nums">{period}</dd>
            </div>
          )}
          <div className="flex gap-3">
            <dt className="w-44 shrink-0 text-text-muted">Erstellt am</dt>
            <dd className="font-medium text-ink tabular-nums">{printedAt}</dd>
          </div>
        </dl>

        {/*
         * Steht auf dem Deckblatt und nicht im Kleingedruckten: Wer den Report weiterreicht, soll
         * den Vorbehalt sehen, bevor er die Zahlen sieht. Derselbe Satz wie am Fuss des
         * Bildschirm-Reports (CLAUDE.md: keine ROI-Zahl als „echt" vor der Validierung).
         */}
        <p className="mt-10 max-w-prose border-t border-border pt-4 text-xs text-text-muted">
          Demo-Berechnung mit Beispieldaten. Die Zahlen sind noch nicht gegen einen echten Lastgang
          und eine echte Netzrechnung validiert.
        </p>
      </div>
    </div>
  )
}
