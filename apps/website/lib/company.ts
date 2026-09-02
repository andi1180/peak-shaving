/**
 * Firmen-Identität für die Fusszeile des Druck-Reports.
 *
 * ── ⚠ DIE KANONISCHE QUELLE IST `apps/web/lib/nav.ts` (`COMPANY`), NICHT DIESE DATEI ────────────
 * Dort steht sie VERBATIM aus `reference/coolin-legacy.html` und dem Live-Impressum
 * (`apps/web/coolin-legacy-impressum.md`) — nicht erfunden, nicht geraten. Diese Datei ist eine
 * bewusste, minimale KOPIE: `apps/website` ist eine eigene Next-App mit eigenem Deployment und
 * hat keine Abhängigkeit auf `apps/web` (und soll auch keine bekommen, nur um vier Zeichenketten
 * zu lesen).
 *
 * Damit die beiden nicht auseinanderlaufen — und genau davor warnt der Kopf von `nav.ts`: „Eine
 * zweite Adresse im Repo könnte von der sichtbaren abweichen" — hält ein Test in `apps/web`
 * (`lib/print-company-drift.test.ts`) diese Datei gegen `COMPANY`. Er liest die Quelle hier als
 * TEXT; ein Import wäre ein App-übergreifender Modulverweis und damit genau die Kopplung, die es
 * hier nicht geben soll.
 *
 * ── WAS BEWUSST NICHT HIER STEHT ────────────────────────────────────────────────────────────────
 * Die ECG-Pflichtangaben des Rechtsträgers (Firmenbuch, UID, Rechtsform — `COMPANY_LEGAL` in
 * `nav.ts`, Rechtsträger ist „COOLiN CONSULTING AND INNOVATION GmbH"). Sie gehören ins Impressum,
 * nicht in die Fusszeile eines Analyse-Reports; eine Fusszeile ist eine Absenderangabe, kein
 * Impressum, und eine halbe Pflichtangabe wäre schlechter als keine.
 */
export const PRINT_COMPANY = {
  /** Marke, unter der COOLiN auftritt — NICHT der eingetragene Firmenwortlaut. */
  name: 'COOLiN ENERGY',
  street: 'Karl-Popper-Straße 22',
  city: '1100 Wien, Österreich',
  /** Ohne Protokoll: eine Fusszeile auf Papier ist keine anklickbare Adresse. */
  web: 'www.coolin.at',
} as const
