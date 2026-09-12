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
 * Dass es heute GENAU EIN Feld ist, ist der Stand dieses Bauschritts und nicht der Zuschnitt: der
 * Ja-Zweig (welches Erzeugungsprofil vorliegt) legt hier weitere Felder ab, und die Aufteilung ist
 * dann nicht nachzuziehen.
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
