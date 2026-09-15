/**
 * Der Vergleichstarif im Entwurf eines Zählpunkts (B24, Teil 1).
 *
 * ── ⚠ WARUM DAS EIN EIGENES MODUL IST ─────────────────────────────────────────────────────────
 * Derselbe Grund wie bei `battery-draft.ts` und `standard-profile.ts`: die Feldnamen haben ZWEI
 * Konsumenten mit entgegengesetzter Richtung — die Server Action SCHREIBT sie, die Station LIEST
 * sie für ihre Zusammenfassung. Zweimal ausgeschrieben liefe eine Umbenennung an einer der beiden
 * vorbei, und zwar still: gespeichert würde unter dem neuen Namen, angezeigt der alte, und die
 * Station behauptete, es sei nichts erfasst.
 *
 * REIN: kein `server-only`, kein `next/*`, kein Supabase-Client — die Client-Komponente importiert
 * von hier, und eine Server-Abhängigkeit bräche ihren Build.
 *
 * ── ⚠ ES GIBT KEINE TARIF-WAHL MEHR (Fachentscheidung 15.09.2026) ─────────────────────────────
 * Bis hierher lagen hier `TARIFF_PREFERENCE_KEY`, `TARIFF_PREFERENCES` und `TariffPreference` —
 * das gespeicherte „behalten" oder „optimieren". Sie sind ERSATZLOS entfernt: der Tarifvergleich
 * mit aWATTar ist keine Kundenentscheidung mehr, sondern automatisch. Damit gibt es nichts mehr zu
 * speichern, das eine Wahl ausdrückt.
 *
 * ⚠ BEREITS GESPEICHERTE ZÄHLPUNKTE KÖNNEN DEN SCHLÜSSEL `tariffPreference` NOCH IM ENTWURF
 * TRAGEN (alte Testdaten, alte Projekte). Das ist harmlos und ausdrücklich KEIN Fehlerzustand:
 * `platform.metering_points.draft` ist jsonb, und ein Feld, das niemand mehr liest, richtet dort
 * keinen Schaden an — dieselbe Lage wie bei anderen stillgelegten Entwurfsfeldern. Es gibt deshalb
 * auch keine Datenmigration.
 */

/**
 * Der selbst gefundene Vergleichstarif — freiwillig.
 *
 * ⚠ EIN EINZIGER, KEINE LISTE: der Nutzer sucht selbst auf einem Vergleichsportal (tarife.at o.ä.)
 * und trägt GENAU EINEN gefundenen Tarif ein — kein Katalog, keine Mehrfachauswahl. Begründung:
 * eine Batterie kann nur gegen ein PREISSIGNAL steuern, das sich über den Tag bewegt (aWATTar);
 * ein einzelner Fixtarif eines Mitbewerbers hat diese Bewegung nicht und ist für die Batterie
 * irrelevant — er ist ein separater, von der Batterie unabhängiger Ersparnis-Hebel, den der
 * Report nennen soll, kein Optimierungsgegenstand.
 */
export const TARIFF_COMPARISON_PROVIDER_NAME_KEY = 'tariffComparisonProviderName'
export const TARIFF_COMPARISON_ENERGY_PRICE_KEY = 'tariffComparisonEnergyPriceCtPerKwh'
export const TARIFF_COMPARISON_BASE_FEE_KEY = 'tariffComparisonBaseFeeEurPerMonth'
export const TARIFF_COMPARISON_PRICE_BASIS_KEY = 'tariffComparisonPriceBasis'

/**
 * Eigene, gleichlautende Konstante statt Import aus `retail-tariffs.ts` — dieselbe Entscheidung
 * dort im eigenen Kopf begründet: ein Import zöge das ganze Modul für zwei Zeichenketten in ein
 * Bündel, das damit nichts zu tun hat.
 */
export const TARIFF_COMPARISON_PRICE_BASES = ['net', 'gross'] as const
export type TariffComparisonPriceBasis = (typeof TARIFF_COMPARISON_PRICE_BASES)[number]

/**
 * ALLE vier Schlüssel des Vergleichstarifs — der Löschweg entfernt sie gemeinsam.
 *
 * ⚠ ABGELEITET, NICHT ABGESCHRIEBEN, und hier wiegt das schwerer als anderswo: `currentComparison`
 * (die Leseseite) gibt `null` zurück, sobald EINES der vier fehlt. Bliebe beim Löschen eines
 * stehen, verschwände die Zusammenfassung trotzdem — und mit ihr der Löschknopf, der das übrige
 * Feld noch hätte entfernen können. Der Zählpunkt trüge danach dauerhaft einen halben Vergleich,
 * den keine Oberfläche mehr anzeigt und kein Weg mehr erreicht.
 */
export const TARIFF_COMPARISON_DRAFT_KEYS: readonly string[] = [
  TARIFF_COMPARISON_PROVIDER_NAME_KEY,
  TARIFF_COMPARISON_ENERGY_PRICE_KEY,
  TARIFF_COMPARISON_BASE_FEE_KEY,
  TARIFF_COMPARISON_PRICE_BASIS_KEY,
]
