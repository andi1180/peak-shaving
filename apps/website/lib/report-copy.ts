import { displayedPriceBasis, VAT_INCLUSIVE_LABEL } from 'shared'

/**
 * Report-Texte, die an MEHR ALS EINER Stelle stehen müssen (Delta 16a).
 *
 * ── WARUM EINE KONSTANTE UND NICHT ZWEIMAL DERSELBE SATZ ────────────────────────────────────────
 * Der Hindsight-Hinweis ist nach §6.2 PFLICHT und steht seit U2 unaufdringlich an der
 * Ersparnis-Aufschlüsselung (`recommendation-card.tsx`) — genau dort, wo §6.2 ihn verlangt
 * („beim Eigenverbrauchs-/Lastverschiebungs-Anteil"). Der Methodik-Abschnitt des erweiterten
 * Druck-Reports (Delta 16a) braucht dieselbe Aussage ein zweites Mal, weil er als Kapitel für sich
 * gelesen wird: ein Report, den ein Installateur beim Kunden dalässt, wird abschnittsweise
 * gelesen, nicht von vorn bis hinten.
 *
 * Zweimal ausgeschrieben liefen die beiden Fassungen beim nächsten Umformulieren auseinander — und
 * dann stünde in einem Dokument zweimal derselbe Vorbehalt in zwei Schärfen. Das ist der einzige
 * Grund für diese Datei; sie ist bewusst kein allgemeiner „Textkatalog".
 *
 * Der Wortlaut ist WÖRTLICH der bestehende (U2, `recommendation-card.tsx`) — in Delta 16a
 * ausdrücklich übernommen und nicht neu formuliert.
 */

/** §6.2/§3.6, Pflicht. Steht an der Ersparnis-Aufschlüsselung UND im Methodik-Abschnitt. */
export const HINDSIGHT_NOTE =
  'Eigenverbrauch & tarifbewusstes Laden sind mit vollem Rückblick auf das Jahresprofil ' +
  'gerechnet (Bestmarke). Der Spitzenschutz-Anteil ist davon nicht betroffen.'

/**
 * Wessen Speicher die dritte Reihe des Monatsvergleichs fährt — Dativ, für „aWATTar mit …".
 *
 * ⚠ Seit D7 entsteht diese Reihe auch OHNE Bestandsanlage, aus dem Dispatch der empfohlenen
 * Katalog-Batterie (`compute-analysis.ts`). „Ihrem Speicher" wäre dort eine Behauptung über ein
 * Gerät, das der Kunde nicht besitzt. Die Fallunterscheidung ist dieselbe wie bei der Kapp-Linie
 * (`report.tsx`, `pdf-report/recommendation.ts`); der Wortlaut steht hier, damit die Stellen, die
 * sie treffen, nicht auseinanderlaufen.
 */
export function monthlyBatteryRef(isExisting: boolean): string {
  return isExisting ? 'Ihrem Speicher' : 'der empfohlenen Batterie'
}

/**
 * Wie die Reihe/der Weg „aWATTar, gesteuert" ÜBERALL heisst, wo sie BESCHRIFTET wird —
 * Balkenlabel, Legende, Tabellenzeile, Absatzüberschrift.
 *
 * ── ⚠ EIN NAME, WEIL ES EINE SACHE IST ────────────────────────────────────────────────────────
 * Bis zum 21.09.2026 stand hier `aWATTar mit ${monthlyBatteryRef(isExisting)}` — gerendert also
 * „aWATTar mit" plus Possessivum („Ihrem Speicher" bzw. „der empfohlenen Batterie"), und im
 * Monatsvergleich zusätzlich mit dem Anhang „(Ladung optimiert)". Derselbe Gegenstand trug damit
 * im selben Dokument bis zu drei Beschriftungen, und im Wege-Kapitel las sich die Achse anders als
 * die Überschrift darunter.
 *
 * ⚠ Der Wortlaut ist DER DES ZIELBILDS: `Urbanz_Wirtschaftlichkeitsanalyse V2.pdf`, Seite 5,
 * „Weg 3 — aWATTar mit Ladesteuerung". Er nennt bewusst kein Gerät — wessen Speicher gesteuert
 * wird, sagt der Fliesstext daneben (`monthlyBatteryRef`), wo ein Satz den Dativ auch tragen kann.
 * Eine Beschriftung ohne Possessivum ist ausserdem in BEIDEN Fällen richtig (Bestandsanlage wie
 * empfohlene Batterie) und braucht die Fallunterscheidung gar nicht erst.
 */
export const CONTROLLED_WAY_LABEL = 'aWATTar mit Ladesteuerung'

/**
 * K3d — Herkunft des angezeigten Wirkungsgrads eines Katalog-Geräts, am Bildschirm-Druck und im
 * PDF gleich. `null`, wo die Herkunft nicht vermerkt ist: dann steht der Wert ohne Zusatz.
 */
export function rteSourceNote(rteSource: string | null | undefined): string | null {
  if (rteSource === 'datenblatt') return 'laut Datenblatt'
  if (rteSource === 'annahme') return 'angenommen'
  return null
}

/**
 * H3 — der USt-Zusatz am Bildschirm, abgelesen an den gezeigten Zahlen (`analysisForDisplay`):
 * Privatkunden sehen „inkl. 20 % USt", Betriebe unverändert „exkl. MwSt.".
 */
export function vatNote(view: object | null | undefined): string {
  return displayedPriceBasis(view) === 'gross' ? VAT_INCLUSIVE_LABEL : 'exkl. MwSt.'
}
