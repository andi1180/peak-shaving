/**
 * Grenzwerte der Plausibilitäts-Automatik (§5.3). [MARTIN: §12 #4/#5 marktrealistisch
 * bestätigen] — noch nicht validiert, späterer Wert-Tausch ohne Logikänderung (Muster wie die
 * [ANNAHME]-Konstanten in `engine`, z. B. `TOP_PEAKS_N` in `peaks/metrics.ts`).
 */

/** Stufe 1 (§12 #4): unterhalb dieser Grenze ist der Energiepreis unplausibel niedrig (ct/kWh). */
export const ENERGY_PRICE_MIN_CT = 5

/** Stufe 1 (§12 #4): oberhalb dieser Grenze ist der Energiepreis unplausibel hoch (ct/kWh). */
export const ENERGY_PRICE_MAX_CT = 40

/** Stufe 2 (§12 #4): untere Grenze des typischen Brutto-Gesamtpreis-Bands (ct/kWh, inkl. Netz+Steuern). */
export const TOTAL_PRICE_SUSPECT_MIN_CT = 25

/** Stufe 2 (§12 #4): obere Grenze des typischen Brutto-Gesamtpreis-Bands (ct/kWh, inkl. Netz+Steuern). */
export const TOTAL_PRICE_SUSPECT_MAX_CT = 35

/** Stufe 3: erlaubte Abweichung eingegeben vs. hinterlegter Tabellenpreis (ct/kWh), bevor eine Warnung feuert. */
export const TABLE_PRICE_TOLERANCE_CT = 2

/** Stufe 4 (§12 #5): erlaubte relative Abweichung Rückrechnung vs. Rechnungsbetrag, bevor eine Warnung feuert (0,10 = 10 %). */
export const INVOICE_RECONCILE_TOLERANCE_RATIO = 0.1
