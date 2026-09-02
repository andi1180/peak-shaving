/**
 * Grundgebühren von STROMLIEFERANTEN (Delta 19) — heute genau eine: die von aWATTar.
 *
 * ── ⚠ WARUM DAS EINE CODE-KONSTANTE IST UND NICHT `public.grid_tariffs` ────────────────────────
 * `grid_tariffs` beschreibt das NETZ: die Zeile ist über (Netzbetreiber, Netzebene, Messvariante)
 * geschlüsselt, und jeder Wert darin gilt genau für diese Kombination. Die Grundgebühr eines
 * Lieferanten hat keine dieser Dimensionen — sie ist für jeden Kunden dieselbe, unabhängig davon,
 * an welchem Netz er hängt. In diese Tabelle geschrieben müsste sie in jeder Zeile stehen und in
 * jeder gepflegt werden; ein Preisblatt-Nachtrag für Wiener Netze änderte dann still die Gebühr,
 * die für Netz NÖ ausgewiesen wird.
 *
 * Sie steht deshalb im Code, versionskontrolliert — dieselbe Ablage und dieselbe Begründung wie
 * die B11-Tarifschicht (`tariff-catalog.ts`): eine Satzänderung ist ein PR mit einer Datei, samt
 * Quelle, Datum und einem Menschen, der ihn gegengelesen hat.
 *
 * ── ⚠ NETTO, UND ZWAR NACHGERECHNET ────────────────────────────────────────────────────────────
 * Gerechnet wird durchgängig netto (Delta 6). aWATTar weist die Gebühr im Endkundenauftritt brutto
 * aus; 4,79 € netto × 1,20 = 5,748 € ≈ die dort genannten 5,75 € brutto. Die beiden Zahlen sind
 * also dieselbe Gebühr in zwei Preisbasen — und die netto-Fassung ist die, die neben die
 * Netzentgelte (netto) und die Börsenpreise (netto) gehört.
 *
 * ── ⚠ EIN EINTRAG, KEINE AUSWAHLFUNKTION — und warum das kein Versäumnis ist ────────────────────
 * `validFrom` steht bewusst schon jetzt am Datensatz: ändert aWATTar den Satz, entsteht ein
 * ZWEITER Eintrag mit späterem `validFrom` und dazu eine Auswahl nach Datum (Vorbild
 * `lookupTariffProfile`). Solange es genau einen gibt, wäre eine Auswahlfunktion über eine
 * einelementige Liste Struktur ohne Aussage (Prinzip 6). Was sie NICHT sein darf: eine stille
 * Ersetzung des bestehenden Werts — eine 2026 gerechnete Baseline muss 2028 noch sagen können,
 * mit welcher Gebühr sie gerechnet wurde (dieselbe Append-only-Haltung wie bei `consent_texts`).
 */

import type { PriceBasis } from './tariff'

export type SupplierBaseFee = {
  /** Anzeigename des Lieferanten — er steht so im Report. */
  supplier: string
  /** Grundgebühr je Monat, in der unten genannten Preisbasis. */
  eurPerMonth: number
  /** Delta 6: Pflichtangabe an der Quelle. Gerechnet wird durchgängig netto. */
  priceBasis: PriceBasis
  /** ISO-Datum, ab dem dieser Satz gilt (inklusiv). */
  validFrom: string
  /** Woher der Wert stammt — eine Zahl ohne Fundstelle ist im Zweifel geraten. */
  sourceNote: string
}

export const AWATTAR_BASE_FEE: SupplierBaseFee = {
  supplier: 'aWATTar',
  eurPerMonth: 4.79,
  priceBasis: 'net',
  /*
   * [ANNAHME] Es liegt kein Beleg für den Beginn dieses Satzes vor. Gesetzt ist deshalb die
   * Untergrenze des überhaupt auswertbaren Zeitraums (Delta 15 Regel B, `SPOT_PRICE_ANCHOR_DATE`):
   * für jede Analyse, die dieser Rechner annimmt, gilt damit derselbe Satz. Das ist die
   * angreifbare, aber sichtbare Annahme — die Alternative wäre ein erfundenes Startdatum gewesen,
   * das aussieht wie eine Angabe.
   */
  validFrom: '2025-01-01',
  sourceNote:
    'aWATTar HOURLY, Grundgebühr laut Endkunden-Preisangabe (5,75 € brutto/Monat = 4,79 € netto), ' +
    'im Repo festgehalten am 02.09.2026. Ändert sich der Satz, kommt ein ZWEITER Eintrag mit ' +
    'späterem validFrom hinzu — der bestehende wird nicht editiert.',
}
