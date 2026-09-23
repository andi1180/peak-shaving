/**
 * Prüf- und Test-Fixtures — bewusst NICHT im Produktions-Barrel (`shared`).
 *
 * Wer von hier importiert, ist eine Prüfroute oder ein Test. Ein Produktionspfad, der hierher
 * greift, rechnet gegen erfundene Geräte (K3c).
 */
export * from './demo-battery-catalog'
