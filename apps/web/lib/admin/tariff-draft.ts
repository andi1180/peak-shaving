/**
 * Die Tarifwahl im Entwurf eines Zählpunkts (B24, Teil 1).
 *
 * ── ⚠ WARUM DAS EIN EIGENES MODUL IST ─────────────────────────────────────────────────────────
 * Derselbe Grund wie bei `battery-draft.ts` und `standard-profile.ts`: der Feldname hat ZWEI
 * Konsumenten mit entgegengesetzter Richtung — die Server Action SCHREIBT ihn, die Station LIEST
 * ihn für ihre Zusammenfassung. Zweimal ausgeschrieben liefe eine Umbenennung an einer der beiden
 * vorbei, und zwar still: gespeichert würde unter dem neuen Namen, angezeigt der alte, und die
 * Station behauptete, es sei nichts erfasst.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — die Client-Komponente importiert
 * von hier, und eine Server-Abhängigkeit bräche ihren Build.
 *
 * ── ⚠ EIN STRING-ENUM UND KEIN WAHRHEITSWERT ──────────────────────────────────────────────────
 * Es sind ZWEI BENANNTE OPTIONEN, keine Ja/Nein-Frage: „den aktuellen Tarif behalten" und „einen
 * optimalen vorschlagen lassen" sind gleichrangige Wünsche, von denen keiner die Verneinung des
 * anderen ist. Als `boolean` müsste einer von beiden zum Vorgabewert erklärt werden, und der Name
 * des Feldes sagte dann nicht mehr, welcher gemeint ist (`optimizeTariff: false` liest sich wie
 * „nicht optimieren", nicht wie „behalten"). Ein dritter Wunsch — sollte er je dazukommen — ist
 * hier ein Listeneintrag und dort ein Schema-Bruch.
 *
 * ── ⚠ ES GIBT KEIN GEGENSTÜCK ZU `hasBattery` ─────────────────────────────────────────────────
 * Die Batterie-Station trägt zwei Felder, weil dort eine WEICHE mit zwei Unterpfaden steht
 * („gibt es schon einen Speicher?" → Kenndaten ODER Speichervorschlag). Hier gibt es von Anfang an
 * genau eine Frage mit genau einer Antwort; ein zweites Feld wäre ein zweites Signal, das dem
 * ersten widersprechen kann.
 *
 * ── ⚠ KEIN `tariffParamsSchema`-FELD, UND DAS IST IN ORDNUNG ──────────────────────────────────
 * Wie `hasBattery` und `annualConsumptionKwh`: der Entwurf ist eine Sammlung von Angaben, nicht
 * das Contract-Objekt selbst. `tariffParamsSchema` ist ein `z.object` OHNE `.strict()`, zod
 * entfernt unbekannte Schlüssel beim Auswerten und meldet keinen Fehler. Folge: die Wahl zählt in
 * `check_draft_completeness` als `unknown_field` und damit nicht zur Vollständigkeit des
 * Tarif-Contracts — sie ist eine Anweisung an die ANALYSE, kein Eingabewert für sie.
 */

/** „Was soll mit dem Stromtarif geschehen?" — geschrieben ausschliesslich von der Tarif-Station. */
export const TARIFF_PREFERENCE_KEY = 'tariffPreference'

export const TARIFF_PREFERENCES = ['behalten', 'optimieren'] as const

export type TariffPreference = (typeof TARIFF_PREFERENCES)[number]
