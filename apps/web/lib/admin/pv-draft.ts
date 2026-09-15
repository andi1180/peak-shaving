/**
 * Die PV-Angaben im Entwurf eines Zählpunkts (B24, Teil 1).
 *
 * ── ⚠ WARUM DAS EIN EIGENES MODUL IST, OBWOHL HEUTE EIN FELD DARIN STEHT ──────────────────────
 * Aus demselben Grund wie bei `battery-draft.ts`: der Feldname hat ZWEI Konsumenten mit
 * entgegengesetzter Richtung — die Server Action SCHREIBT ihn, die Station LIEST ihn, um ihren
 * Zweig zu wählen. Zweimal ausgeschrieben liefe eine Umbenennung an einer der beiden vorbei, und
 * zwar still: gespeichert würde unter dem neuen Namen, gelesen der alte, und die Station stellte
 * ihre Frage erneut, obwohl sie beantwortet ist.
 *
 * ⚠ DASS HIER GENAU EIN FELD STEHT, IST DER AUSGANG EINER ENTSCHEIDUNG, NICHT EINE LÜCKE. Der
 * Ja-Zweig hat seine Felder NICHT hier abgelegt, sondern in zwei eigenen Modulen (`pv-array-draft.ts`
 * für die Modulflächen, `pv-profile-draft.ts` für das Erzeugungsprofil) — jedes mit seinen eigenen
 * Lesern und Kollisionsprüfungen. Was dieses Modul dadurch zusätzlich trägt, ist die Klammer über
 * alle drei: `PV_DRAFT_KEYS` (s. u.).
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — die Client-Komponente importiert
 * von hier, und eine Server-Abhängigkeit bräche ihren Build.
 *
 * ── ⚠ `hasPv` IST KEIN `tariffParamsSchema`-FELD, UND DAS IST IN ORDNUNG ──────────────────────
 * Wortgleich zur Batterie-Station: der Entwurf ist eine Sammlung von Angaben, nicht das
 * Contract-Objekt selbst; `tariffParamsSchema` ist ein `z.object` OHNE `.strict()`, zod entfernt
 * unbekannte Schlüssel beim Auswerten und meldet keinen Fehler (in `draft.test.ts` gemessen).
 * ⚠ Folge: `check_draft_completeness` führt das Feld als `unknown_field` — es zählt nicht zur
 * Vollständigkeit des Tarif-Contracts.
 *
 * ── ⚠ WAS DIESE ANGABE NICHT IST ─────────────────────────────────────────────────────────────
 * Sie ist NICHT die Erzeugungskurve und auch keine Aussage über deren Herkunft. Ob eine vorhandene
 * Anlage als gemessenes Profil vorliegt oder geschätzt werden muss (PVGIS, B22), entscheidet der
 * Ja-Zweig — und der ist ein eigener Bauabschnitt. `hasPv: true` heisst heute ausschliesslich:
 * „es gibt eine Anlage", nicht „ihre Erzeugung ist erfasst".
 */

import { PV_ARRAYS_KEY } from './pv-array-draft'
import { PV_PROFILE_DRAFT_KEYS } from './pv-profile-draft'

/**
 * „Es gibt bereits eine PV-Anlage" — geschrieben von BEIDEN Zweigen der Frage.
 *
 * ⚠ ANDERS ALS `hasBattery`, und der Unterschied ist beabsichtigt. Dort schreibt nur der Ja-Zweig
 * (`hasBattery: false` gibt es bewusst nicht, weil der Nein-Zweig dort eine ANDERE Frage stellt —
 * den Speichervorschlag — und ein daraus abgeleitetes „keine Batterie" ein zweites, womöglich
 * widersprüchliches Signal wäre). Hier stellt der Nein-Zweig gar keine zweite Frage: „nein, keine
 * PV-Anlage" IST die Antwort auf genau diese eine, und sie muss von „dazu wurde nichts gefragt"
 * unterscheidbar bleiben — sonst stellte die Station sie nach jedem Neuladen erneut.
 */
export const PV_PRESENT_KEY = 'hasPv'

/**
 * ALLE Entwurfs-Schlüssel, die zur PV-Angabe dieses Zählpunkts gehören — die Antwort auf die
 * Frage, die Modulflächen und das Erzeugungsprofil.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ WARUM DIESES MODUL DAFÜR SEINE ZWEI GESCHWISTER IMPORTIERT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `pv-draft.ts` ist die WURZEL des PV-Zweigs: `hasPv` entscheidet, ob es die Modulflächen und das
 * Erzeugungsprofil überhaupt gibt. Der Entfernen-Weg muss deshalb von hier aus vollständig sein —
 * er löst genau den Zustand auf, den der Kopf von `data-entry-pv.tsx` beschreibt: wer von Ja auf
 * Nein wechselt, sieht die eingelesenen Angaben nicht mehr, im Entwurf stehen sie trotzdem weiter.
 *
 * ⚠ ABGELEITET, NICHT ABGESCHRIEBEN (Muster `BATTERY_DRAFT_KEYS`). Eine von Hand gepflegte
 * Zweitliste liefe beim nächsten zusätzlichen Profil-Feld auseinander — und zwar still: der
 * Löschweg liesse es stehen, der Zählpunkt trüge danach etwa einen geschätzten Jahresertrag ohne
 * die Anlage, zu der er gehört, und die Station zeigte ihre Frage wieder an, als sei nichts
 * erfasst. Die zwei Geschwister importieren `pv-draft.ts` NICHT (geprüft) — es entsteht kein Zirkel,
 * und beide sind wie dieses Modul rein (die Client-Komponente zieht ohnehin alle drei).
 */
export const PV_DRAFT_KEYS: readonly string[] = [
  PV_PRESENT_KEY,
  PV_ARRAYS_KEY,
  ...PV_PROFILE_DRAFT_KEYS,
]

/** Was im Entwurf eines Zählpunkts an PV-Angaben steht. */
export type PvDraftSummary = {
  /** `true`/`false` = die Frage wurde beantwortet · `null` = dazu steht nichts im Entwurf. */
  hasPv: boolean | null
}

export function readPvDraft(draft: Record<string, unknown>): PvDraftSummary {
  const value = draft[PV_PRESENT_KEY]
  /*
   * Strikt: `'true'` oder `1` sähen wie eine Aussage aus und sind keine — dieselbe Lesart wie
   * `readBatteryDraft`. Bewusst hier ausgeschrieben statt von dort importiert: `battery-draft.ts`
   * exportiert seinen Leser nicht, und ihn dafür zu öffnen machte aus zwei unabhängigen
   * Entwurfs-Modulen eines, das am anderen hängt.
   */
  return { hasPv: value === true ? true : value === false ? false : null }
}
