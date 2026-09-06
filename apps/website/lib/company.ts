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

/**
 * Die Ansprechperson auf der Abschlussseite des PDF-Reports.
 *
 * ── ⚠ ZWEI DER VIER WERTE SIND ABSCHRIFTEN, KEINE NEUEN ANGABEN ────────────────────────────────
 * `phone` steht kanonisch in `apps/web/lib/nav.ts` als `COMPANY_LEGAL.phone`, `email` als
 * `COMPANY.email` — beide dort VERBATIM aus Impressum und Firmenbuchdaten. Hier stehen sie als
 * Kopie, aus demselben Grund wie `PRINT_COMPANY` darüber (getrennte Apps, keine Abhängigkeit), und
 * derselbe Drift-Test (`apps/web/lib/print-company-drift.test.ts`) hält beide zusammen.
 *
 * ⚠ SCHREIBWEISE DER TELEFONNUMMER: `+43 676 76 30456`, wie im Impressum. Dieselben Ziffern wie
 * die im Bau-Auftrag genannte Fassung `+43 676 7630456`; die Gruppierung folgt der kanonischen
 * Quelle, damit der Drift-Test greifen kann und im Repo genau EINE Schreibweise existiert.
 *
 * ── DIE E-MAIL IST DAS FIRMENPOSTFACH UND KEINE PERSÖNLICHE ADRESSE ────────────────────────────
 * `energy@coolin.at` ist im ganzen Repo DIE Kontaktadresse (Impressum, Datenschutz, Absender jeder
 * versendeten Mail, Ausweichadresse im Report-Gate). Eine persönliche Adresse gibt es nirgends —
 * eine hier erfundene („m.neubauer@…") wäre eine geratene Angabe auf einem Dokument, das der Kunde
 * behält, und im Zweifel ein Rückläufer.
 */
export const REPORT_CONTACT = {
  name: 'Martin Neubauer',
  role: 'CEO',
  phone: '+43 676 76 30456',
  email: 'energy@coolin.at',
} as const
