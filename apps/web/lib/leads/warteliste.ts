/**
 * DIE AUFLÖSUNG DES ROUTEN-SEGMENTS `/warteliste/[quelle]` (B3-4).
 *
 * Beide Wartelisten-Routen zeigen dasselbe Formular und erheben dieselben Felder; sie unterscheiden
 * sich allein darin, unter WELCHER HERKUNFT die Eintragung im Bestand landet. Diese Datei ist die
 * eine Stelle, an der aus einem Stück URL ein Einstiegspunkt wird.
 *
 * ── DIE ZUORDNUNG IST EINE ERLAUBNISLISTE, KEINE ABLEITUNG ──────────────────────────────────────
 * Es wird NICHT aus dem Segment ein `source_key` gebaut (kein Präfix, kein Nachschlagen in
 * `LEAD_SOURCE_KEYS`). Jedes zulässige Segment steht hier einzeln, mit dem Schlüssel, den es meint.
 * Damit ist die Menge der öffentlich erreichbaren Herkünfte an genau einem Ort ablesbar, statt sich
 * aus einer Regel zu ergeben, die beim nächsten neuen Einstiegspunkt versehentlich mehr zulässt.
 *
 * ── EIN UNBEKANNTES SEGMENT IST EIN 404, KEIN RÜCKFALL AUF DIE ORGANISCHE QUELLE ────────────────
 * Die naheliegende Bequemlichkeit — „unbekanntes Segment? dann eben `warteliste`" — wäre der
 * teuerste Fehler dieses Bauabschnitts. Sie stempelte eine FALSCHE Herkunft auf eine echte
 * Einwilligung; und die Herkunft ist seit B1-1 Pflichtfeld (`leads.first_source_key`, unveränderlich)
 * und die Grundlage jeder späteren Segmentierung. Ein Vertipper in der gedruckten Adresse fiele
 * damit nie auf: Die Seite funktionierte, die Leads kämen an, und die Auswertung, ob der Brief
 * Rücklauf erzeugt hat, wäre still falsch — genau die Frage, für die es die zweite Route gibt.
 *
 * Eine tote Route ist ein sichtbarer Fehler, eine falsch zugeordnete Einwilligung ein unsichtbarer.
 *
 * REIN: kein `server-only`, kein `next/*` — die Route braucht die Auflösung, die Tests auch.
 */

import { LEAD_CAPTURE_REGISTRY, type LeadSourceKey } from './registry'

/**
 * Die Einstiegspunkte, die eine Wartelisten-Seite tragen darf — beide mit demselben Zweck, denselben
 * Feldern und demselben Einwilligungswortlaut (s. Registry).
 *
 * Als eigener Typ und nicht als blosses `LeadSourceKey`, damit die Seite nicht versehentlich unter
 * einer Herkunft gerendert werden kann, die etwas ganz anderes erhebt (etwa
 * `vertragsablauf-landing`, wo Versorger und Vertragsende Pflicht sind): Der Compiler weist das ab.
 */
export type WartelisteSourceKey = Extract<LeadSourceKey, 'warteliste' | 'wko-postaktion-qr'>

/**
 * Segment (in der URL) → Einstiegspunkt (in der Datenbank).
 *
 * Der Segment-Name ist kurz, weil er auf Papier steht und abgetippt werden können muss; der
 * Registry-Schlüssel ist es nicht, weil er im Bestand steht und dort sprechend sein soll. Genau
 * deshalb sind die beiden nicht dasselbe Wort.
 */
export const WARTELISTE_SEGMENTS: Readonly<Record<string, WartelisteSourceKey>> = {
  /*
   * ⚠ DAUERHAFTE ZUSAGE — `/warteliste/wko` STEHT AUF PAPIER.
   *
   * Der Pfad ist als QR-Code auf einem Postbrief gedruckt. Gedruckte Adressen kann man nicht
   * zurückrufen: Ein Brief, der in einem Betrieb im Ordner liegt, wird auch in einem Jahr noch
   * gescannt. Deshalb gilt für dieses Segment dauerhaft:
   *
   *   – NIE umbenennen (auch nicht „nur der Ordnung halber", auch nicht bei einer Umstrukturierung
   *     der Seitenstruktur),
   *   – NIE entfernen,
   *   – NIE auf eine andere Quelle umhängen — der Schlüssel rechts ist Teil der Zusage, nicht bloss
   *     eine Verdrahtung. Ein umgehängter Schlüssel schriebe die Rückläufe des Briefs unter einer
   *     fremden Herkunft in den Bestand.
   *
   * Wird die Seite je inhaltlich ersetzt, muss der Pfad bestehen bleiben und weiterleiten.
   * Dieselbe Zusage steht in `DEPLOYMENT.md` (§5) und an der Route selbst.
   */
  wko: 'wko-postaktion-qr',
}

/**
 * Der Einstiegspunkt zu einem Segment — oder `null`.
 *
 * `null` heisst für die Route: `notFound()`. Sie ist der einzige vorgesehene Umgang damit; einen
 * Ersatzwert gibt es bewusst nicht (s. Kopf).
 */
export function resolveWartelisteSource(segment: unknown): WartelisteSourceKey | null {
  if (typeof segment !== 'string') return null
  return WARTELISTE_SEGMENTS[segment] ?? null
}

/**
 * Beim Bauen der statischen Pfade UND als Selbstprüfung: jedes Segment muss auf einen Eintrag
 * zeigen, den die Registry kennt. Ein Tippfehler rechts wäre sonst erst am ersten echten Lead
 * sichtbar — dann nämlich als abgewiesene Erfassung („unbekannter Einstiegspunkt").
 */
export function wartelisteSegments(): string[] {
  return Object.entries(WARTELISTE_SEGMENTS).map(([segment, key]) => {
    if (!LEAD_CAPTURE_REGISTRY[key]) {
      throw new Error(
        `lib/leads/warteliste.ts: Segment "${segment}" zeigt auf den Einstiegspunkt "${key}", ` +
          'den die Registry nicht kennt.',
      )
    }
    return segment
  })
}
