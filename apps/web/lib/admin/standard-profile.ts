import { readDraftProvenance } from '@/lib/project-chat/draft'
import type { StandardProfileCustomerClass } from 'extractors'

import { formatKwh } from './format'
import type { ProjectSegment } from './projects'

/**
 * B24, Teil 1 — DER STANDARDPROFIL-ZWEIG DES LASTGANG-SCHRITTS, reine Hälfte.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client. Das ist keine Stilfrage — diese
 * Datei wird von der Server Action UND von der Client-Komponente gelesen (die Vorschau der
 * Schätzung soll dieselbe Zahl zeigen, die der Server gleich speichert; zwei Rechnungen liefen
 * beim nächsten Umbau auseinander, und der Admin bestätigte dann eine andere Zahl als die
 * gespeicherte). Und `apps/web` prüft `lib/**` — was hier steht, ist der Teil dieses Schritts, der
 * sich ohne Browser messen lässt.
 */

/**
 * Unter welchem Schlüssel der Jahresverbrauch im Entwurf des Zählpunkts steht.
 *
 * ⚠ ES IST KEIN `tariffParamsSchema`-FELD, und das ist kein Versehen. Der Jahresverbrauch ist die
 * EINGABE, aus der ein Profil entsteht — kein Tarifparameter. Er erscheint in
 * `check_draft_completeness` folglich unter `unknown_fields`, genau wie `invoicePeriodFrom`/
 * `invoicePeriodTo` (Konsistenzprüfung, `lib/project-chat/consistency.ts`): „nicht falsch, aber
 * ungeprüft". Der Entwurf ist bewusst offen, damit solche Angaben nicht verloren gehen.
 *
 * Er steht als Konstante da, weil ihn zwei Seiten benutzen — der Schreibweg und die Anzeige. Ein
 * zweites Mal ausgeschrieben liefen sie auseinander, und der Fehlschlag wäre STILL: die Station
 * zeigte dauerhaft „kein Jahresverbrauch hinterlegt", während der Wert daneben im Entwurf steht.
 */
export const ANNUAL_CONSUMPTION_KWH_KEY = 'annualConsumptionKwh'

/**
 * Die Haushalts-Schätzung: 2.000 kWh für die erste Person, je weitere +1.000 kWh.
 *
 * ⚠ GROBE RICHTWERTE (E-Control/Branchenangaben), ausdrücklich keine Messung — deshalb wird ein
 * so entstandener Wert als `assumed` vermerkt und die Formel in die Notiz geschrieben. Wer die
 * Zahl 2027 im Entwurf findet, soll sehen, WIE sie zustande kam, statt sie für eine Ablesung von
 * einer Rechnung zu halten.
 *
 * Die beiden Zahlen stehen einzeln, damit eine spätere Korrektur EINE Konstante trifft und die
 * Notiz automatisch mitwandert.
 */
export const HOUSEHOLD_BASE_KWH = 2000
export const HOUSEHOLD_PER_ADDITIONAL_PERSON_KWH = 1000

/**
 * Obergrenze der Haushaltsgrösse.
 *
 * Nicht die Grenze des Möglichen, sondern die der FORMEL: sie ist linear, und ab einer gewissen
 * Grösse ist das kein Haushalt mehr, sondern eine Einrichtung — für die eine
 * Haushalts-Durchschnittskurve die falsche Grundlage ist. Abgewiesen statt still gekappt: der
 * Admin soll wissen, dass wir seine Zahl nicht nehmen.
 */
export const MAX_HOUSEHOLD_PERSONS = 15

/**
 * Obergrenze des Jahresverbrauchs für ein Haushalts-Standardprofil.
 *
 * ⚠ DIESE ZAHL EXISTIERT EIN ZWEITES MAL: in `apps/website/components/flow/standard-profile-panel.tsx`
 * (dort inline, mit derselben Begründung — „über 100.000 kWh im Jahr ist ein
 * Haushalts-Standardprofil keine belastbare Grundlage mehr"). Die beiden zusammenzulegen hiesse,
 * eine Konstante nach `packages/shared` zu heben und den öffentlichen Rechner anzufassen; das ist
 * ein eigener Schritt. Hier steht sie, weil ein Wizard ohne Obergrenze eine unsinnige Zahl
 * durchrechnete und das Ergebnis seriös aussähe.
 */
export const MAX_STANDARD_PROFILE_ANNUAL_KWH = 100_000

/**
 * Der geschätzte Jahresverbrauch eines Haushalts dieser Grösse.
 *
 * Gibt `null` bei allem, was keine brauchbare Personenzahl ist — der Aufrufer entscheidet, was er
 * dem Nutzer sagt. Eine erfundene Ersatzzahl wäre hier der teuerste Fehler: sie ginge als
 * Verbrauch in ein Profil ein und sähe dort wie eine Angabe aus.
 */
export function estimateHouseholdConsumptionKwh(persons: number): number | null {
  if (!Number.isInteger(persons) || persons < 1 || persons > MAX_HOUSEHOLD_PERSONS) return null
  return HOUSEHOLD_BASE_KWH + (persons - 1) * HOUSEHOLD_PER_ADDITIONAL_PERSON_KWH
}

/**
 * Die Notiz zum Herkunftsvermerk einer Schätzung — sie nennt die Formel UND den Eingabewert.
 *
 * Beides in EINEM Satz und nicht in einem zweiten Entwurfsfeld: die Personenzahl ist keine Angabe
 * über den Anschluss, sondern die Begründung dieser einen Zahl. Als eigenes Feld abgelegt stünde
 * sie später neben einem korrigierten Jahresverbrauch und widerspräche ihm.
 */
export function householdEstimateNote(persons: number): string {
  const additional = persons - 1
  /*
   * ⚠ `formatKwh` aus `./format` — es trägt die Einheit selbst. Eine zweite, gleichnamige
   * Funktion daneben (Zahl ohne Einheit) gab es hier kurzzeitig: zwei gleich heissende Formatierer
   * im selben Verzeichnis, die Verschiedenes liefern, sind genau die Art Falle, bei der ein
   * Importpfad über die Ausgabe entscheidet.
   */
  const formula =
    additional === 0
      ? formatKwh(HOUSEHOLD_BASE_KWH)
      : `${formatKwh(HOUSEHOLD_BASE_KWH)} + ${additional} × ${formatKwh(HOUSEHOLD_PER_ADDITIONAL_PERSON_KWH)}`
  return (
    `Geschätzt aus ${persons} ${persons === 1 ? 'Person' : 'Personen'} im Haushalt: ${formula}. ` +
    'Grobe Richtwerte, keine Ablesung von einer Rechnung.'
  )
}

/**
 * Welche Profilkurve für ein Segment gilt.
 *
 * ⚠ ES WIRD NICHT NEU GEFRAGT. Das Segment steht am Projekt und ist die erste Station des Wizards;
 * eine zweite Auswahl daneben könnte ihm widersprechen, und dann gälte für den Fragen-Pool das
 * eine und für die Kurve das andere.
 *
 * `null` (Segment nicht gesetzt) ergibt bewusst KEINE Kurve statt „privat": der Spaltenkommentar
 * der Migration sagt ausdrücklich, dass `null` „das Gespräch hat es noch nicht bestimmt" heisst.
 * Auf „privat" zurückzufallen behauptete eine Angabe, die niemand getroffen hat — und sie
 * entschiede über den Verbrauchsverlauf eines ganzen Jahres. Erreichbar ist der Fall über den
 * Wizard ohnehin nicht (ohne Segment gibt es genau EINE Station); er steht als Sperre.
 */
export function customerClassForSegment(
  segment: ProjectSegment | null,
): StandardProfileCustomerClass | null {
  if (segment === 'privat') return 'privat'
  if (segment === 'betrieb') return 'kleingewerbe'
  return null
}

/**
 * Ob für dieses Segment überhaupt eine Profilkurve hinterlegt ist.
 *
 * ⚠ HEUTE NUR FÜR PRIVATHAUSHALTE, und das ist eine fachliche Fehlanzeige, keine technische Lücke:
 * `generateStandardLoadProfile` lehnt `kleingewerbe` mit `no_profile_for_class` ab, weil Delta 8
 * offen lässt, welches G-Profil in Österreich üblich ist. Eine aus dem Haushaltsprofil abgeleitete
 * Gewerbekurve wäre eine erfundene Zahlenreihe mit seriösem Etikett.
 *
 * Die Oberfläche fragt DESHALB vorher, statt den Admin ein Formular ausfüllen zu lassen, das
 * garantiert in einen Fehler läuft. Die Action behandelt `no_profile_for_class` trotzdem — sie ist
 * ein Endpunkt, und eine Station, die eine Ablehnung nicht erklären kann, ist schlechter als eine,
 * die sie nie zeigt.
 */
export function hasStandardProfileCurve(segment: ProjectSegment | null): boolean {
  return customerClassForSegment(segment) === 'privat'
}

/** Woher der gespeicherte Jahresverbrauch stammt — dieselben zwei Werte wie im Entwurf. */
export type StandardProfileConsumption = {
  annualConsumptionKwh: number
  source: 'measured' | 'assumed'
  /** Die Begründung einer Schätzung, wo es eine gibt. */
  note?: string
}

/**
 * Liest den gespeicherten Jahresverbrauch samt Herkunft aus dem Entwurf EINES Zählpunkts.
 *
 * `null`, wenn keiner dasteht oder der Wert unbrauchbar ist — die Station zeigt dann keine Zahl
 * statt einer erfundenen. Ohne Herkunftsvermerk gilt `measured`: ein Wert ohne Vermerk kann nur
 * eingetragen worden sein (die Schätzung schreibt IMMER einen), und ihn als Schätzung auszuweisen
 * wäre die unehrlichere Richtung.
 */
export function readStandardProfileConsumption(
  draft: Record<string, unknown>,
): StandardProfileConsumption | null {
  const value = draft[ANNUAL_CONSUMPTION_KWH_KEY]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null

  const entry = readDraftProvenance(draft)[ANNUAL_CONSUMPTION_KWH_KEY]
  return {
    annualConsumptionKwh: value,
    source: entry?.source === 'assumed' ? 'assumed' : 'measured',
    ...(entry?.note ? { note: entry.note } : {}),
  }
}

/**
 * Liest eine Jahresverbrauchs-Eingabe aus einem Formularfeld.
 *
 * Getrennt von der Schätzung, weil die Fehlerfälle verschieden sind und jeder eine eigene Meldung
 * am Feld braucht: nichts eingetragen und unsinnig hoch sind für den Eintragenden zwei
 * verschiedene Auskünfte.
 */
export function parseAnnualConsumptionKwh(
  raw: string,
): { ok: true; value: number } | { ok: false; reason: 'missing' | 'invalid' | 'too_large' } {
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: false, reason: 'missing' }

  // Das deutsche Dezimalkomma ist auf einem österreichischen Formular der Regelfall, nicht die
  // Ausnahme — es hier abzulehnen hiesse, eine korrekte Eingabe als Fehler auszuweisen.
  const value = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: 'invalid' }
  if (value > MAX_STANDARD_PROFILE_ANNUAL_KWH) return { ok: false, reason: 'too_large' }
  return { ok: true, value }
}
