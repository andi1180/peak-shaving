/**
 * Delta 16b — das Name/Firma-Gate vor dem Report-Download: Schlüssel, Felder und Prüfregel.
 *
 * ── WARUM DIESE DATEI IN `shared` LIEGT UND NICHT IN `apps/website` ─────────────────────────────
 * Aus demselben Grund wie `tariff-catalog.ts` und `analysis-window.ts` daneben: sie wird von MEHR
 * ALS EINER Seite gebraucht, und eine zweite Abschrift wäre die Drift, die niemand bemerkt.
 *
 *   1. Das Formular im Browser prüft damit für die RÜCKMELDUNG.
 *   2. Die Server Action prüft damit für die WAHRHEIT (ein Aufruf muss nicht durch das Formular
 *      gekommen sein).
 *   3. Das DB-Gate (`packages/db-tests`) liest `REPORT_GATE_SOURCE_KEY` und
 *      `REPORT_GATE_CONSENT_PURPOSE` von hier und vergleicht sie gegen `platform.lead_sources`,
 *      `platform.consent_purpose` UND gegen `apps/web/lib/leads/registry.ts`.
 *
 * Genau dasselbe Muster wie `apps/web/lib/kontakt/schema.ts` / `lib/leads/capture-request.ts`: der
 * Client prüft für die Rückmeldung, der Server für die Wahrheit — aber es gibt nur EINE Regel.
 *
 * ── BEWUSST OHNE ZOD, OBWOHL `shared` ZOD HAT ──────────────────────────────────────────────────
 * `apps/website` führt zod nicht als eigene Abhängigkeit, und `packages/db-tests` importiert diese
 * Datei über den Paketnamen, ohne den Rest von `shared` zu ziehen. Diese Datei hat deshalb NULL
 * Importe — sie ist damit aus jedem der drei Kontexte ohne Auflösungsfrage lesbar. Die Regeln sind
 * einfach genug (Pflicht, Länge, Adressform), dass ein Schema hier keinen Fehler verhindern würde,
 * den die Handprüfung offen lässt.
 *
 * ── DIE LÄNGEN SPIEGELN `LEAD_FIELDS` UND DAMIT DIE DATENBANK ──────────────────────────────────
 * 254 (RFC 5321), 100/100 für Vor-/Nachname, 120 für die Firma — exakt die Werte aus
 * `apps/web/lib/leads/registry.ts`. Eine laxere Regel hier hiesse, dass der Nutzer statt einer
 * Feldmeldung einen abgebrochenen Vorgang bekäme.
 */

/**
 * Die Herkunft, unter der ein am Report-Gate erfasster Lead im Bestand steht.
 *
 * ⚠ DIESER SCHLÜSSEL EXISTIERT AN DREI ORTEN, UND DAS IST ABSICHT — mit einem Test dazwischen:
 * hier, in `platform.lead_sources` (Migration `20260830090100`) und in
 * `apps/web/lib/leads/registry.ts` (`LEAD_SOURCE_KEYS_WITHOUT_FORM`, weil das DB-Gate die AKTIVEN
 * Zeilen der Tabelle in BEIDE Richtungen gegen diese Liste prüft). Ein Import wäre der bessere Weg,
 * ist aber versperrt: `registry.ts` ist ausdrücklich abhängigkeitsfrei gehalten, damit das DB-Gate
 * sie relativ lesen kann („Bitte so lassen." steht in ihrem Kopf). Statt die Regel aufzuweichen,
 * hält `packages/db-tests/src/report-gate-source.test.ts` die drei Orte zusammen.
 */
export const REPORT_GATE_SOURCE_KEY = 'rechner-report'

/**
 * Der Einwilligungszweck des Gates — der Wert aus `platform.consent_purpose` (Migration
 * `20260830090000`).
 *
 * NICHT 'result_delivery': Delta 16 Entscheidung 1 schliesst jedes serverseitig erzeugte PDF und
 * damit jeden Mail-Anhang aus — es wird nichts zugesendet, der Browser erzeugt das Dokument selbst.
 * Der Wortlaut von 'result_delivery' verspricht das Gegenteil und beschränkt die Adresse
 * ausdrücklich auf genau diese Zusendung. Ausführlich begründet im Kopf der Migration.
 */
export const REPORT_GATE_CONSENT_PURPOSE = 'offer_contact'

/** Feldlängen — identisch zu `LEAD_FIELDS` in `apps/web/lib/leads/registry.ts`. */
export const REPORT_GATE_MAX_LENGTH = {
  email: 254,
  firstName: 100,
  lastName: 100,
  company: 120,
} as const

export type ReportGateFieldKey = keyof typeof REPORT_GATE_MAX_LENGTH

/**
 * Was das Formular absendet.
 *
 * ES GIBT KEIN `purpose`- UND KEIN `sourceKey`-FELD. Das ist die zentrale Eigenschaft dieses Typs,
 * kein Versehen — beide stehen als Konstante oben und werden serverseitig gesetzt. Käme der Zweck
 * vom Client, erzeugte ein manipulierter Aufruf eine Einwilligung zu einem Text, den niemand
 * gesehen hat; der Nachweis wäre wertlos, und zwar rückwirkend auch für die echten. Dieselbe Regel
 * wie in `capture-flow.ts` (B3-2).
 */
export type ReportGateSubmission = {
  firstName: string
  lastName: string
  company: string
  email: string
  /** Die Einwilligung. PFLICHT — ohne sie entsteht weder Lead noch Consent (s. `parseReportGate`). */
  consent: boolean
  /**
   * Honeypot. Muss LEER sein.
   *
   * Gleicher Feldname wie im Erfassungspfad von `apps/web` (`capture-flow.ts`) — dieselbe Falle,
   * damit ein Bot, der beide Seiten kennt, nicht zwei verschiedene Namen ausprobieren muss und wir
   * nicht zwei Mechanismen pflegen.
   */
  website?: string
}

/** Fehlerschlüssel, keine Sätze — die Oberfläche formuliert. */
export type ReportGateFieldError = 'fieldRequired' | 'tooLong' | 'emailInvalid'

export type ReportGateFieldErrors = Partial<Record<ReportGateFieldKey, ReportGateFieldError>>

export type ReportGateValues = Record<ReportGateFieldKey, string>

export type ParsedReportGate =
  /** Geprüft und getrimmt. `consent` ist hier per Konstruktion `true`. */
  | { ok: true; values: ReportGateValues }
  /** Der Absender kann es selbst beheben — deshalb feldgenau. */
  | { ok: false; reason: 'validation'; fieldErrors: ReportGateFieldErrors }
  /** Ohne Einwilligung wird gar nichts geschrieben. Kein Feld-, sondern ein Ablauffehler. */
  | { ok: false; reason: 'consent_missing' }
  /** Honeypot gefüllt. */
  | { ok: false; reason: 'spam' }

/*
 * Absichtlich pragmatisch: ein Zeichen vor dem @, ein Punkt danach, keine Leerzeichen. Dieselbe
 * Schärfe wie zods `.email()` in der Praxis — die endgültige Prüfung einer Adresse ist ohnehin die
 * Zustellung, und eine strengere Regel weist reale Adressen ab, ohne eine falsche zu verhindern.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const REQUIRED_FIELDS: readonly ReportGateFieldKey[] = ['firstName', 'lastName', 'company', 'email']

/**
 * Prüft eine Absendung. Wirft nie.
 *
 * ── DIE REIHENFOLGE IST EINE ENTSCHEIDUNG ──────────────────────────────────────────────────────
 * Honeypot zuerst, dann die Einwilligung, dann die Felder. Der Honeypot steht vorn, damit ein Bot
 * aus der Antwort nicht ablesen kann, WELCHE Felder er falsch ausgefüllt hat — er bekommt in jedem
 * Fall dieselbe Absage. Die Einwilligung steht vor der Feldprüfung, weil ohne sie ohnehin nichts
 * geschrieben wird: eine Feldmeldung an jemanden, der den Haken gar nicht gesetzt hat, führte ihn
 * durch eine Korrekturschleife, an deren Ende er dieselbe Absage bekäme.
 */
export function parseReportGate(submission: ReportGateSubmission): ParsedReportGate {
  if (typeof submission.website === 'string' && submission.website.trim() !== '') {
    return { ok: false, reason: 'spam' }
  }

  if (submission.consent !== true) return { ok: false, reason: 'consent_missing' }

  const trimmed: ReportGateValues = {
    firstName: (submission.firstName ?? '').trim(),
    lastName: (submission.lastName ?? '').trim(),
    company: (submission.company ?? '').trim(),
    email: (submission.email ?? '').trim(),
  }

  const fieldErrors: ReportGateFieldErrors = {}
  for (const key of REQUIRED_FIELDS) {
    const value = trimmed[key]
    if (value === '') {
      fieldErrors[key] = 'fieldRequired'
      continue
    }
    if (value.length > REPORT_GATE_MAX_LENGTH[key]) {
      fieldErrors[key] = 'tooLong'
      continue
    }
    if (key === 'email' && !EMAIL_RE.test(value)) fieldErrors[key] = 'emailInvalid'
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, reason: 'validation', fieldErrors }
  }

  return { ok: true, values: trimmed }
}

/**
 * Der Name, der auf dem Deckblatt steht (`PrintCover.customer.name`).
 *
 * Vor- und Nachname werden GETRENNT erhoben und getrennt gespeichert (`platform.leads.first_name` /
 * `last_name`, seit dem Namens-Split vom 24.07.2026) — nur für die ANZEIGE werden sie
 * zusammengesetzt. Umgekehrt ginge es nicht: einen zusammengesetzten Namen nachträglich zu zerlegen
 * ist bei Doppelnamen und Titeln unzuverlässig, und eine spätere Anrede braucht den Nachnamen als
 * eigenen Wert.
 */
export function reportGateDisplayName(values: Pick<ReportGateValues, 'firstName' | 'lastName'>) {
  return `${values.firstName} ${values.lastName}`.trim()
}
