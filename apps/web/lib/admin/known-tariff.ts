import { INVOICE_DRAFT_FIELD_KEYS, draftFieldFor } from './invoice-extractions'

/**
 * B24, Teil 1 — „gibt es für diesen Zählpunkt überhaupt einen bekannten Tarif?"
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DAS EIN EIGENES MODUL IST UND NICHT IN `tariff-draft.ts` STEHT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Die Frage gehört der TARIF-Station, ihre Antwort steht aber in dem, was die RECHNUNG-Station
 * hinterlassen hat. Sie in `tariff-draft.ts` zu beantworten hiesse, von dort aus
 * `invoice-extractions.ts` zu importieren — und `tariff-draft.ts` wird von der Client-Komponente
 * der Station gelesen. Das ganze Rechnungs-Modul samt seiner Beschriftungen, Formatierer und der
 * Auswertung des Scans läge damit im Bündel einer Station, die davon nichts braucht; genau die
 * Doppelung, die der Kopf von `tariff-draft.ts` für zwei Zeichenketten bereits ablehnt.
 *
 * Gelesen wird das hier ausschliesslich von der SEITE (Server), die daraus eine Prop bildet. Rein:
 * kein `server-only`, kein `next/*`, kein Supabase-Client — damit es sich ohne Browser messen
 * lässt.
 */

/**
 * Die Entwurfs-Schlüssel, an denen ein bekannter Tarif erkennbar ist.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ GEPRÜFT WIRD DER ENTWURF, NICHT `INVOICE_SKIPPED_KEY`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Beide Wege der Rechnung-Station schreiben denselben Vorrat an Feldern: der Upload über
 * `invoiceDraftValues`, die Handeingabe über dieselbe `draftFieldFor`-Abbildung. Welcher von
 * beiden gelaufen ist, spielt für diese Frage keine Rolle — es zählt, ob am Ende ein Tarifwert
 * dasteht. Der Überspringen-Vermerk (`invoiceSkipped`, PR #227) ist die UMKEHRUNG derselben
 * Frage („bewusst nichts angegeben"), nicht eine dritte Quelle: er entsteht nur dort, wo die
 * Felder ohnehin leer bleiben.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ `annualConsumptionKwh` IST AUSGENOMMEN, UND OHNE DIESE AUSNAHME WÄRE DIE PRÜFUNG WERTLOS
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Es steht in `INVOICE_DRAFT_FIELD_KEYS`, weil der Rechnungs-Scan es MITLESEN kann — es ist aber
 * kein Tarifwert, sondern die EINGABE, aus der ein Standardprofil entsteht. Und genau so wird es
 * auch geschrieben: `saveMeteringPointStandardProfileAction` (Lastgang-Station, Nein-Zweig) legt
 * es unter demselben Schlüssel ab (`ANNUAL_CONSUMPTION_KWH_KEY` — ein Fundort für beide Wege, s.
 * dort).
 *
 * Mitgezählt wäre die Antwort damit für JEDEN Zählpunkt ohne Lastgang-Datei `true` — also
 * ausgerechnet für den Regelfall, für den diese Prüfung gebaut ist: der Kunde hat keine Rechnung
 * vorgelegt, nur seinen Jahresverbrauch genannt, und die Station böte ihm trotzdem an, „den
 * aktuellen Tarif zu behalten" — einen Tarif, den niemand kennt. Der Fehlschlag wäre still: es
 * stünde eine plausible Schaltfläche da, und was fehlt, sieht man ihr nicht an.
 */
export const KNOWN_TARIFF_DRAFT_FIELDS: readonly string[] = INVOICE_DRAFT_FIELD_KEYS.filter(
  (key) => key !== 'annualConsumptionKwh',
).map(draftFieldFor)

/**
 * Steht im Entwurf dieses Zählpunkts ein Tarifwert — aus einer gelesenen Rechnung ODER von Hand?
 *
 * ⚠ `!== undefined` und nicht „irgendein wahrer Wert": eine echte `0` (etwa ein Leistungspreis von
 * 0 bei einem Anschluss ohne Leistungsmessung) IST eine Angabe. Über die Wahrheitswert-Prüfung
 * gelesen verschwände sie, und der Zählpunkt gälte als tariflos, obwohl der Wert dasteht.
 */
export function hasKnownTariffInDraft(draft: Record<string, unknown>): boolean {
  return KNOWN_TARIFF_DRAFT_FIELDS.some((field) => draft[field] !== undefined)
}
