/**
 * Die Lead-Erfassung aus der REGISTRIERUNG (B10-5) — der zweite Einstiegspunkt neben dem
 * Kontaktformular (B1-2), gebaut nach exakt demselben Muster und bewusst nicht daneben.
 *
 * ── WARUM ÜBERHAUPT ─────────────────────────────────────────────────────────────────────────────
 * Bis hierher erzeugte eine Registrierung nur `auth.users` + `platform.profiles`. Wer sich anmeldet
 * und die Bestätigungsmail nie öffnet, hinterliess damit eine E-Mail-Adresse ohne jeden Kontext —
 * kein Betrieb, kein Name, keine Herkunft. Genau diese Abbrecher sind der Zielfall: der Lead
 * entsteht deshalb SOFORT nach `auth.signUp` und ausdrücklich VOR der Mail-Bestätigung.
 *
 * ── DREI REGELN, DIE HIER GELTEN ────────────────────────────────────────────────────────────────
 *
 * 1. RECHTSGRUNDLAGE IST VERTRAGSANBAHNUNG, NICHT EINWILLIGUNG. `capture_lead` wird OHNE Zweck
 *    aufgerufen; es entsteht bewusst KEINE Zeile in `platform.consents` und es gibt kein
 *    Ankreuzfeld auf dem Registrierungsformular. Eine Registrierung für einen zugangsbeschränkten
 *    B2B-Bereich IST die Anbahnung — eine zusätzlich eingeholte Einwilligung wäre eine zweite,
 *    juristisch eigenständige Frage, die dieser Schritt ausdrücklich nicht aufmacht.
 *
 * 2. `retention_basis` BLEIBT AUF DEM VORGABEWERT ('marketing', 24 Monate). Dieselbe bewusste
 *    Nicht-Eskalation wie beim Kontaktformular und aus demselben Grund: Hochstufen geht später
 *    jederzeit je Lead (der B1-1-Trigger zieht `deletion_due_at` nach), der umgekehrte Weg wäre
 *    eine rückwirkend zu lange Speicherung.
 *
 * 3. DER SCHREIBVORGANG BRINGT DIE REGISTRIERUNG NIE ZUM SCHEITERN. Er läuft NACH dem erfolgreichen
 *    `signUp`, und jeder Fehler wird laut geloggt, aber verschluckt: ein verlorenes Konto wiegt
 *    schwerer als ein verlorener Bestandseintrag. Deshalb gibt diese Funktion auch nichts zurück,
 *    das die Server Action in einen Fehlerzustand übersetzen könnte.
 *
 * ── KEINE NACHWEISFELDER (`source_ip`/`user_agent`) ─────────────────────────────────────────────
 * Sie sind seit B1-1 ausschliesslich der Nachweis EINER EINWILLIGUNG. Hier entsteht keine — sie
 * mitzuschreiben wäre eine Speicherung ohne den Zweck, der sie trägt.
 */
import 'server-only'
import { getLocale } from 'next-intl/server'
import { leadSourceForRegistration } from './registration-source'
import { captureLead } from './store'

export type RegistrationLeadInput = {
  email: string
  /** Firma und Name sind auf dem Registrierungsformular Pflicht (B10-5) — hier trotzdem defensiv. */
  company?: string
  firstName?: string
  lastName?: string
  /**
   * Das bereits SANIERTE Rücksprungziel (`sanitizeNext`), aus dem die Herkunft abgeleitet wird.
   * Leer bedeutet „kein Ziel" und ist der Normalfall, nicht der Fehlerfall.
   */
  next?: string
}

/**
 * Schreibt den Lead. Wirft NIE.
 *
 * Ein bereits bekannter Lead (etwa aus einer früheren `/kontakt`-Anfrage) wird von `capture_lead`
 * ZUSAMMENGEFÜHRT, nicht ein zweites Mal angelegt: die Zusammenführungsregeln der Identitätsfelder
 * (Bestand gewinnt, einzeln je Feld) bleiben unangetastet — sie sind B1-2/Namens-Split und werden
 * hier weder ergänzt noch umgangen. Auch `first_source_key` bleibt beim ZUERST erfassten Wert; die
 * Herkunft eines bestehenden Leads wird durch eine spätere Registrierung nicht überschrieben
 * (unveränderlich seit B1-1).
 */
export async function captureRegistrationLead(input: RegistrationLeadInput): Promise<void> {
  try {
    const locale = await getLocale()

    await captureLead({
      email: input.email,
      sourceKey: leadSourceForRegistration(input.next),
      // Ohne Zweck entsteht keine Einwilligungszeile — s. Regel 1 im Kopf.
      purpose: null,
      company: input.company ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      locale,
    })
  } catch (cause) {
    /*
     * LAUT loggen, still weitermachen (Regel 3 oben). Die Adresse steht bewusst NICHT im Log-Text —
     * ein Fehlerlog ist kein zulässiger zweiter Speicherort für Personenbezug.
     */
    console.error('[leads] Lead-Erfassung aus der Registrierung fehlgeschlagen:', cause)
  }
}
