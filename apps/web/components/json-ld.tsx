import type { JsonLdNode } from '@/lib/json-ld'

/**
 * Rendert einen JSON-LD-Block (Pflichtenheft §6.4).
 *
 * SERVERSEITIG GERENDERT, weil die Komponente keine Client-Direktive trägt: Der
 * Block steht damit im ausgelieferten HTML, nicht erst nach der Hydration. Für
 * strukturierte Daten ist das der ganze Zweck — ein Crawler, der kein JS
 * ausführt, sieht sonst nichts.
 *
 * MEHRERE BLÖCKE PRO SEITE SIND KORREKT, kein Versehen: Ein Artikel trägt den
 * Firmen-Knoten aus dem Layout, seinen eigenen `Article` und die `FAQPage` — drei
 * `<script>`-Tags aus drei Komponenten. Suchmaschinen führen alle JSON-LD-Blöcke
 * einer Seite zu EINEM Graphen zusammen; `@id`-Verweise lösen sich über
 * Blockgrenzen hinweg auf. Ein einzelner `@graph` wäre nur dann nötig, wenn eine
 * Komponente wissen müsste, was die anderen ausgeben — und genau das soll sie
 * nicht.
 *
 * `key` auf dem Script: Ohne einen stabilen Schlüssel könnte React zwei
 * benachbarte Blöcke beim Re-Render verwechseln. Er kommt aus dem `@type`, weil
 * pro Seite höchstens ein Block je Typ steht.
 */
export function JsonLd({ schema }: { schema: JsonLdNode }) {
  return (
    <script
      type="application/ld+json"
      key={String(schema['@type'])}
      /*
       * `dangerouslySetInnerHTML` ist hier der VORGESEHENE Weg (so auch in der
       * Next-Dokumentation): React würde als Kind-Text `<` und `&` zu HTML-
       * Entities escapen — `&lt;` ist innerhalb eines `<script>`-Blocks aber
       * kein `<`, sondern genau diese fünf Zeichen. Das Ergebnis wäre kaputtes
       * JSON. Ein `<script>` ist ein CDATA-Element, sein Inhalt wird NICHT
       * HTML-dekodiert.
       *
       * Dass das Escaping trotzdem nötig ist, erledigt `serializeJsonLd`.
       */
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(schema) }}
    />
  )
}

/**
 * Serialisiert einen Knoten für die Einbettung in `<script>`.
 *
 * WARUM DAS `<` ERSETZT WERDEN MUSS: Der HTML-Parser sucht im Script-Inhalt nach
 * der Zeichenfolge `</script` und beendet den Block dort — egal, ob sie in einem
 * JSON-String steht. Ein Text, der sie enthält, bricht damit aus dem Block aus,
 * und der Rest landet als Markup im Dokument. Das ist keine Theorie: Die Inhalte
 * hier kommen aus Artikel-Frontmatter und `messages/de.json`, also aus
 * redigiertem Text — ein Artikel über HTML wäre genug.
 *
 * Die Ersetzung ist VERLUSTFREI: Die Unicode-Escape-Sequenz unten ist JSONs
 * eigene Schreibweise für „kleiner als". Der HTML-Parser findet die Zeichenfolge
 * `</script` damit nicht mehr, `JSON.parse` liefert das Zeichen unverändert
 * zurück. Der Inhalt bleibt derselbe — nur seine Schreibweise im Transport
 * ändert sich. Deshalb genügt das eine Zeichen: `>` und `&` können den Block
 * nicht beenden.
 */
function serializeJsonLd(schema: JsonLdNode): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c')
}
