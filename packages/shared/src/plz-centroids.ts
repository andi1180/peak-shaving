/**
 * B22b — PLZ → Koordinate: eine statische, getypte Tabelle IM CODE (Pflichtenheft §2.3).
 *
 * ── WARUM CODE UND NICHT EIN GEOCODING-DIENST ──────────────────────────────────────────────────
 * Dieselbe Begründung wie bei der Tarifsatz-Datenschicht (`tariff-catalog.ts`, B11). Ein externer
 * Dienst machte den Rechner von einem zweiten Netzaufruf abhängig und trüge die Ortsangabe des
 * Kunden an einen DRITTEN Empfänger — eine Ausnahme von Prinzip 4, die es nicht zu geben braucht,
 * weil die Daten statisch sind. Eine Datenbanktabelle brächte einen Pflegeweg für einen Datensatz,
 * der einmal eingetragen wird. Als Codemodul ist eine Korrektur ein PR mit einer Datei, und die
 * Herkunft steht hier im Kopf.
 *
 * ── WARUM DAS ÜBERHAUPT GENÜGT — GEMESSEN, NICHT BEHAUPTET ─────────────────────────────────────
 * Innerhalb einer Stadt (≤ 13 km Abstand) liegt der PVGIS-Ertragsunterschied UNTER 1 %
 * (Bestandsaufnahme 2.3: Wien Zentrum 100,0 % · Wien SW ~5 km 100,7 % · Wien NO ~6 km 100,2 % ·
 * Wien Stadtrand ~13 km 100,6 %). Über 145 km (Graz) sind es 6 %. Eine strassengenaue Adresse
 * bringt gegenüber einem PLZ-Mittelpunkt also nichts Messbares — und genau deshalb muss die
 * Anwendung NIE eine hausgenaue Koordinate erheben. Der Datenschutz-Satz im Formular sagt das im
 * Klartext.
 *
 * ── ⚠ KEIN TREFFER HEISST ABLEHNUNG, NIEMALS EINE GERATENE KOORDINATE ──────────────────────────
 * Dieselbe Regel wie bei einem nicht hinterlegten Tarifsatz (B11): der Weg wird verweigert, nicht
 * geschätzt. Eine aus dem Bauch gesetzte Koordinate wäre eine plausibel aussehende Zahl ohne
 * Grundlage — und der Ertragsfehler daraus fiele niemandem auf.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * QUELLE UND LIZENZ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * GeoNames Postal Code Dataset, Datei `AT.zip` (https://download.geonames.org/export/zip/AT.zip),
 * abgerufen am 02.09.2026 (19.225 Zeilen). Lizenz: **Creative Commons Attribution 4.0**
 * (`readme.txt` der Quelle: „This work is licensed under a Creative Commons Attribution 4.0
 * License. This means you can use the dump as long as you give credit to geonames (a link on your
 * website to www.geonames.org is ok)").
 *
 * ⚠ DIE NAMENSNENNUNG IST EINE LIZENZBEDINGUNG, KEINE HÖFLICHKEIT. Sie steht deshalb an ZWEI
 * Orten: hier im Kopf des Moduls und SICHTBAR in der Oberfläche, die die Tabelle benutzt
 * (`POSTAL_CODE_SOURCE` unten wird dort gerendert). Wer die Tabelle an einer dritten Stelle
 * verwendet, nimmt die Nennung mit.
 *
 * ── WIE AUS 19.225 ZEILEN 2.501 EINTRÄGE WURDEN (die Ableitung, damit sie nachvollziehbar ist) ──
 * Der Datensatz führt je PLZ MEHRERE Orte (Wien 1010 einen, Steyr 4400 dreizehn). Je PLZ gilt:
 *   1. Mittelpunkt = **Median** von Breite und Länge über alle gelisteten Orte. Median und nicht
 *      Mittelwert, weil einzelne Zeilen weit danebenliegen (PLZ 3212 führt „Weissenbach" 33 km vom
 *      Rest entfernt) — ein Mittelwert zöge den Mittelpunkt dorthin.
 *   2. Hauptort = der Ort, dessen Name der Gemeinde entspricht; unter mehreren solchen zuerst der
 *      in einer Statutarstadt (`Politischer Bezirk … Stadt`), dann die Gemeinde mit den meisten
 *      Orten, dann der dem Mittelpunkt nächste. Gibt es keinen solchen Ort, wird der Gemeindename
 *      des dem Mittelpunkt nächsten Ortes genommen — und bei den Wiener Gemeindebezirken dessen
 *      Ortsname, weil „Gemeindebezirk Favoriten" als Bestätigung schlechter liest als
 *      „Wien, Favoriten".
 *   3. Koordinate und Name stammen aus DERSELBEN Zeile — was angezeigt wird und was gerechnet
 *      wird, beschreibt damit immer denselben Ort.
 *
 * **Gemessene Güte der Regel** (Abstand Hauptort → Median-Mittelpunkt): Median 0,5 km · p90 2,2 km
 * · p99 6,3 km · Höchstwert 24,8 km. Zwanzig Stichproben quer durch alle Bundesländer wurden von
 * Hand gegen die erwartete Gemeinde geprüft (1010/1100/1220 Wien · 2340 Maria Enzersdorf · 2700
 * Wiener Neustadt · 3100 St. Pölten · 3212 Schwarzenbach an der Pielach · 4020 Linz · 4400 Steyr ·
 * 4600 Wels · 5020 Salzburg · 6020 Innsbruck · 6800 Feldkirch · 6900 Bregenz · 7000 Eisenstadt ·
 * 8010 Graz · 8700 Leoben · 9020 Klagenfurt · 9500 Villach · 9844 Heiligenblut) — **0 Abweichungen**.
 *
 * ── ⚠ ZWEI GEMESSENE GRENZEN, DIE EIN LESER KENNEN MUSS ────────────────────────────────────────
 * 1. **Alle Wiener Postleitzahlen tragen DIESELBE Koordinate** (48,2085 / 16,3721 — der Datensatz
 *    setzt für jeden Gemeindebezirk den Stadtmittelpunkt). Ein Kunde in Wien 1220 wird also mit
 *    dem Wiener Zentrum gerechnet. Das ist genau der Fall, für den die Messung oben gilt: unter
 *    13 km, unter 1 % Ertragsunterschied. Der ANZEIGENAME unterscheidet die Bezirke trotzdem
 *    („Wien, Donaustadt") — er dient der Bestätigung der Eingabe, nicht der Rechnung.
 * 2. **Grosse Land-PLZ streuen.** Der entfernteste gelistete Ort liegt im Median 2,8 km, im
 *    90. Perzentil 10 km und im Höchstfall 39 km vom Mittelpunkt entfernt. Bei 24 km liegt der
 *    Ertragsunterschied nach der Messung oben in der Grössenordnung von 1 %; er bleibt damit
 *    deutlich unter der Streuung zwischen den Wetterjahren (± 5,8 %), die der Report ohnehin nennt.
 *
 * ── ⚠ WAS DIESE TABELLE NICHT IST ──────────────────────────────────────────────────────────────
 * Kein Verzeichnis der Postleitzahlen Österreichs und keine amtliche Quelle. Sie beantwortet EINE
 * Frage: „welche Koordinate übergeben wir PVGIS für diese PLZ?". Für alles andere (Zustellbarkeit,
 * Gemeindezuordnung, Grenzen) ist sie ungeeignet.
 *
 * Rein und ohne Seiteneffekte: kein I/O, keine Uhr, kein globaler Zustand ausser dem einmalig
 * aufgebauten Nachschlagewerk.
 */

/** Ein PLZ-Eintrag: Anzeigename für die Bestätigung in der Oberfläche, Koordinate für PVGIS. */
export type PostalCodeCentroid = {
  /** Vierstellig, ohne Länderpräfix. */
  postalCode: string
  /** Hauptort der PLZ — Bestätigungshilfe für den Nutzer, KEINE Rechengrösse. */
  name: string
  lat: number
  lon: number
}

/** Die Namensnennung, die die Lizenz verlangt — von der Oberfläche SICHTBAR zu rendern. */
export const POSTAL_CODE_SOURCE = {
  name: 'GeoNames',
  url: 'https://www.geonames.org',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  /** Abrufdatum des Datensatzes `AT.zip`, ISO. */
  retrievedOn: '2026-09-02',
} as const

/**
 * Die Tabelle, gepackt: eine Zeile je PLZ, Felder durch `|` getrennt
 * (`PLZ|Hauptort|Breite|Länge`), Koordinaten auf vier Nachkommastellen (≈ 11 m — weit feiner, als
 * die Sache verlangt).
 *
 * ── ⚠ WARUM GEPACKT UND NICHT ALS TYPISIERTES ARRAY WIE `tariff-catalog.ts` ────────────────────
 * Der Vergleich hinkt an einer Stelle: der Tarifkatalog ist eine von HAND gepflegte Liste mit
 * wenigen Einträgen, die ein Mensch liest und ändert. Diese Tabelle ist maschinell aus EINER
 * Quelle abgeleitet, hat 2.501 Einträge und wird nie zeilenweise editiert — als Objektliteral
 * wären es rund 150 kB Quelltext, die ALLE im öffentlichen Client-Bündel landen (der Rechner läuft
 * im Browser, Prinzip 4). Gepackt sind es rund 85 kB, und der getypte Zugriff liegt unverändert
 * an der einzigen Stelle, die zählt: `lookupPostalCodeCentroid`.
 *
 * Eine Korrektur an einem Eintrag ist trotzdem eine Zeile in dieser Datei — der Pflegeweg bleibt
 * derselbe wie bei B11.
 */
const AT_POSTAL_CODES = `1000|Wien|48.2085|16.3721
1004|Wien|48.2085|16.3721
1006|Wien|48.2085|16.3721
1010|Wien, Innere Stadt|48.2085|16.3721
1011|Wien Postfach|48.2085|16.3721
1015|Wien|48.2085|16.3721
1020|Wien, Leopoldstadt|48.2085|16.3721
1021|Wien Postfach|48.2085|16.3721
1024|Wien|48.2037|16.4232
1025|Wien|48.2037|16.4232
1029|Wien|48.2037|16.4232
1030|Wien, Landstraße|48.2085|16.3721
1031|Wien Postfach|48.2085|16.3721
1032|Wien|48.1938|16.3961
1035|Wien|48.1938|16.3961
1037|Wien|48.1938|16.3961
1038|Wien|48.1938|16.3961
1040|Wien, Wieden|48.1926|16.3704
1041|Wien Postfach|48.2085|16.3721
1042|Wien|48.1926|16.3704
1043|Wien|48.1926|16.3704
1045|Wien|48.1926|16.3704
1050|Wien, Margareten|48.2085|16.3721
1051|Wien Postfach|48.2085|16.3721
1053|Wien|48.1868|16.3559
1060|Wien, Mariahilf|48.2085|16.3721
1061|Wien Postfach|48.2085|16.3721
1063|Wien-VÖPh|48.2085|16.3721
1065|Wien|48.1948|16.3498
1070|Wien, Neubau|48.2085|16.3721
1071|Wien Postfach|48.2085|16.3721
1072|Wien|48.2025|16.3470
1080|Wien, Josefstadt|48.2124|16.3455
1081|Wien Postfach|48.2105|16.3588
1082|Wien|48.2110|16.3478
1090|Wien, Alsergrund|48.2232|16.3551
1091|Wien Postfach|48.2122|16.3678
1092|Wien|48.2228|16.3565
1095|Wien|48.2228|16.3565
1097|Wien|48.2228|16.3565
1100|Wien, Favoriten|48.2085|16.3721
1101|Wien Postfach|48.2085|16.3721
1103|Wien|48.1521|16.3876
1104|Wien|48.1521|16.3876
1105|Wien|48.1521|16.3876
1106|Wien|48.1521|16.3876
1107|Wien|48.1521|16.3876
1108|Wien|48.1521|16.3876
1109|Wien|48.1521|16.3876
1110|Wien, Simmering|48.2085|16.3721
1111|Wien Postfach|48.2085|16.3721
1114|Wien|48.1640|16.4463
1115|Wien|48.1640|16.4463
1120|Wien, Meidling|48.2085|16.3721
1121|Wien Postfach|48.2085|16.3721
1122|Wien|48.1705|16.3223
1124|Wien|48.1705|16.3223
1125|Wien|48.1705|16.3223
1127|Wien|48.1705|16.3223
1128|Wien|48.1705|16.3223
1130|Wien, Hietzing|48.2085|16.3721
1131|Wien Postfach|48.2085|16.3721
1132|Wien|48.1773|16.2456
1134|Wien|48.1773|16.2456
1136|Wien|48.1773|16.2456
1140|Purkersdorf|48.2077|16.1754
1141|Wien Postfach|48.2145|16.3053
1142|Wien|48.2210|16.2415
1143|Wien|48.2210|16.2415
1147|Wien|48.2210|16.2415
1148|Wien|48.2210|16.2415
1150|Wien, Rudolfsheim-Fünfhaus|48.1960|16.3183
1151|Wien Postfach|48.2054|16.3586
1152|Wien|48.1955|16.3261
1153|Wien|48.1955|16.3261
1156|Wien|48.1955|16.3261
1160|Wien, Ottakring|48.2167|16.3000
1161|Wien Postfach|48.2105|16.3541
1163|Wien|48.2154|16.2996
1165|Wien|48.2154|16.2996
1166|Wien|48.2154|16.2996
1170|Wien, Hernals|48.2085|16.3721
1171|Wien Postfach|48.2085|16.3721
1172|Wien|48.2337|16.2902
1180|Wien, Währing|48.2085|16.3721
1181|Wien Postfach|48.2085|16.3721
1182|Wien|48.2355|16.3190
1183|Wien|48.2355|16.3190
1190|Wien, Döbling|48.2085|16.3721
1191|Wien Postfach|48.2085|16.3721
1192|Wien|48.2590|16.3337
1193|Wien|48.2590|16.3337
1195|Wien|48.2590|16.3337
1196|Wien|48.2590|16.3337
1200|Wien, Brigittenau|48.2428|16.3755
1201|Wien Postfach|48.2153|16.3728
1203|Wien|48.2402|16.3773
1205|Wien|48.2402|16.3773
1206|Wien|48.2402|16.3773
1208|Wien|48.2402|16.3773
1210|Langenzersdorf|48.3043|16.3614
1211|Wien Postfach|48.2245|16.3703
1213|Wien|48.2811|16.4113
1215|Wien|48.2811|16.4113
1217|Wien|48.2811|16.4113
1218|Wien|48.2811|16.4113
1219|Wien|48.2811|16.4113
1220|Wien, Donaustadt|48.2085|16.3721
1221|Wien Postfach|48.2085|16.3721
1222|Wien|48.2190|16.4950
1223|Wien|48.2190|16.4950
1224|Wien|48.2190|16.4950
1225|Wien|48.2190|16.4950
1228|Wien|48.2190|16.4950
1229|Wien|48.2190|16.4950
1230|Wien, Liesing|48.2085|16.3721
1231|Wien Postfach|48.2085|16.3721
1235|Wien|48.1433|16.2931
1236|Wien|48.1433|16.2931
1238|Wien|48.1433|16.2931
1239|Wien|48.1433|16.2931
1254|Wien|48.2085|16.3721
1300|Schwechat|48.1455|16.5137
1310|Wien|48.2085|16.3721
1400|Wien-Vereinte Nationen|48.2085|16.3721
1423|Wien|48.2085|16.3721
1600|Wien|48.2085|16.3721
1610|Wien|48.2085|16.3721
2000|Stockerau|48.3833|16.2167
2002|Großmugl|48.4992|16.2306
2003|Leitzersdorf|48.4192|16.2451
2004|Niederhollabrunn|48.4333|16.3000
2011|Sierndorf|48.4302|16.1666
2013|Göllersdorf|48.4936|16.1194
2014|Hollabrunn|48.5061|16.0567
2020|Hollabrunn|48.5500|16.0833
2022|Wullersdorf|48.6394|16.1247
2023|Nappersdorf-Kammersdorf|48.6167|16.1833
2024|Mailberg|48.6738|16.1813
2031|Hollabrunn|48.5667|16.1833
2032|Hollabrunn|48.5833|16.2333
2033|Nappersdorf-Kammersdorf|48.6292|16.2216
2034|Großharras|48.6639|16.2456
2041|Wullersdorf|48.6279|16.1009
2042|Guntersdorf|48.6500|16.0500
2051|Zellerndorf|48.6966|15.9584
2052|Pernersdorf|48.7000|16.0167
2053|Pernersdorf|48.7000|16.0333
2054|Haugsdorf|48.7076|16.0766
2061|Hadres|48.7097|16.1304
2062|Seefeld-Kadolz|48.7175|16.1748
2063|Großharras|48.7000|16.2333
2064|Laa an der Thaya|48.7167|16.3000
2070|Retz|48.7571|15.9549
2073|Schrattenthal|48.7182|15.9094
2074|Retz|48.7500|16.0000
2081|Hardegg|48.7963|15.8954
2082|Hardegg|48.8500|15.8500
2083|Hardegg|48.8207|15.8224
2084|Weitersfeld|48.7810|15.8134
2091|Langau|48.8321|15.7156
2092|Hardegg|48.8398|15.8050
2093|Geras|48.7973|15.6727
2094|Drosendorf-Zissersdorf|48.8333|15.6000
2095|Drosendorf-Zissersdorf|48.8676|15.6212
2100|Leobendorf|48.3833|16.3167
2102|Hagenbrunn|48.3333|16.4000
2103|Langenzersdorf|48.3043|16.3614
2104|Spillern|48.3833|16.2500
2105|Leobendorf|48.3833|16.3167
2106|Klein-Engersdorf|48.3331|16.3831
2111|Harmannsdorf|48.3972|16.3722
2112|Harmannsdorf|48.4301|16.4249
2113|Großrußbach|48.4779|16.3835
2114|Großrußbach|48.4741|16.4165
2115|Ernstbrunn|48.5333|16.3500
2116|Niederleis|48.5500|16.4000
2120|Wolkersdorf im Weinviertel|48.3833|16.5167
2122|Wolkersdorf im Weinviertel|48.4000|16.4500
2123|Hochleithen|48.4333|16.5167
2124|Kreuzstetten|48.4833|16.4500
2125|Kreuzstetten|48.4839|16.5077
2126|Ladendorf|48.5333|16.4833
2127|Hautzendorf|48.4333|16.4833
2130|Mistelbach|48.5700|16.5767
2132|Mistelbach|48.6333|16.5167
2133|Fallbach|48.6500|16.4167
2134|Staatz|48.6667|16.5000
2135|Neudorf bei Staatz|48.7208|16.4914
2136|Laa an der Thaya|48.7167|16.3833
2141|Poysdorf|48.6833|16.5667
2143|Großkrut|48.6439|16.7236
2144|Altlichtenwarth|48.6444|16.7966
2145|Hausbrunn|48.6260|16.8284
2151|Asparn an der Zaya|48.5833|16.5000
2152|Gnadendorf|48.6167|16.4000
2153|Stronsdorf|48.6516|16.2989
2154|Gaubitsch|48.6500|16.3833
2161|Poysdorf|48.7167|16.6167
2162|Falkenstein|48.7167|16.5833
2163|Ottenthal|48.7610|16.5791
2164|Wildendürnbach|48.7565|16.5031
2165|Drasenhofen|48.7500|16.6500
2170|Poysdorf|48.6667|16.6333
2171|Herrnbaumgarten|48.6961|16.6828
2172|Schrattenberg|48.7236|16.7220
2181|Palterndorf-Dobermannsdorf|48.6000|16.8167
2182|Palterndorf-Dobermannsdorf|48.5833|16.8167
2183|Neusiedl an der Zaya|48.5992|16.7799
2184|Hauskirchen|48.6132|16.7587
2185|Hauskirchen|48.6000|16.7208
2191|Gaweinstal|48.4800|16.5879
2192|Mistelbach|48.5500|16.6500
2193|Wilfersdorf|48.5833|16.6333
2201|Hagenbrunn|48.3333|16.4000
2202|Enzersfeld im Weinviertel|48.3634|16.4239
2203|Großebersdorf|48.3640|16.4708
2211|Pillichsdorf|48.3500|16.5333
2212|Großengersdorf|48.3587|16.5661
2213|Bockfließ|48.3600|16.6039
2214|Auersthal|48.3737|16.6360
2215|Matzen-Raggendorf|48.3941|16.6582
2221|Groß-Schweinbarth|48.4147|16.6319
2222|Bad Pirawarth|48.4519|16.5983
2223|Hohenruppersdorf|48.4644|16.6524
2224|Sulz im Weinviertel|48.4833|16.6667
2225|Zistersdorf|48.5425|16.7614
2230|Gänserndorf|48.3392|16.7202
2231|Bockfließ|48.3600|16.6039
2232|Deutsch-Wagram|48.2997|16.5667
2241|Schönkirchen-Reyersdorf|48.3548|16.6912
2242|Prottes|48.3868|16.7389
2243|Matzen-Raggendorf|48.4000|16.7000
2244|Spannberg|48.4639|16.7365
2245|Velm-Götzendorf|48.4669|16.7806
2251|Ebenthal|48.4333|16.7833
2252|Angern an der March|48.4000|16.8000
2253|Weikendorf|48.3444|16.7665
2261|Angern an der March|48.3778|16.8281
2262|Angern an der March|48.4167|16.8333
2263|Dürnkrut|48.4731|16.8506
2264|Jedenspeigen|48.4981|16.8723
2265|Drösing|48.5390|16.9026
2272|Ringelsdorf-Niederabsdorf|48.5667|16.8500
2273|Hohenau an der March|48.6042|16.9047
2274|Rabensburg|48.6500|16.9000
2275|Bernhardsthal|48.6916|16.8695
2276|Bernhardsthal|48.7017|16.8253
2280|Glinzendorf|48.2461|16.6406
2281|Raasdorf|48.2466|16.5653
2282|Markgrafneusiedl|48.2667|16.6333
2283|Obersiebenbrunn|48.2654|16.7108
2284|Untersiebenbrunn|48.2567|16.7453
2285|Leopoldsdorf im Marchfelde|48.2226|16.6886
2286|Haringsee|48.1927|16.7874
2291|Lassee|48.2248|16.8223
2292|Engelhartstetten|48.1816|16.8837
2293|Marchegg|48.2622|16.9105
2294|Marchegg|48.2622|16.9105
2295|Weiden an der March|48.3076|16.8273
2301|Groß-Enzersdorf|48.2028|16.5508
2304|Orth an der Donau|48.1452|16.7009
2305|Eckartsau|48.1451|16.7974
2320|Schwechat|48.1333|16.4667
2322|Zwölfaxing|48.1099|16.4627
2325|Himberg|48.0833|16.4333
2326|Lanzendorf|48.1106|16.4450
2327|Rauchenwarth|48.0833|16.5279
2331|Vösendorf|48.1211|16.3404
2332|Hennersdorf|48.1117|16.3631
2333|Leopoldsdorf|48.1156|16.3913
2334|Vösendorf|48.1211|16.3404
2335|Leopoldsdorf|48.1156|16.3913
2340|Maria Enzersdorf|48.1000|16.2833
2344|Maria Enzersdorf|48.1000|16.2833
2345|Brunn am Gebirge|48.1070|16.2847
2346|Maria Enzersdorf-Südstadt|48.0953|16.3065
2349|Mödling|48.0860|16.2892
2351|Wiener Neudorf|48.0828|16.3138
2352|Gumpoldskirchen|48.0454|16.2771
2353|Guntramsdorf|48.0469|16.3138
2355|Wiener Neudorf|48.0828|16.3138
2356|Wiener Neudorf|48.0828|16.3138
2361|Laxenburg|48.0683|16.3561
2362|Biedermannsdorf|48.0839|16.3454
2371|Hinterbrühl|48.0861|16.2481
2372|Gießhübl|48.0978|16.2348
2380|Perchtoldsdorf|48.1194|16.2661
2381|Wolfsgraben|48.1587|16.1210
2384|Breitenfurt bei Wien|48.1333|16.1500
2391|Kaltenleutgeben|48.1165|16.1996
2392|Wienerwald|48.1057|16.1330
2393|Wienerwald|48.0756|16.1627
2401|Fischamend|48.1167|16.6000
2402|Haslau-Maria Ellend|48.1167|16.7167
2403|Scharndorf|48.0940|16.7988
2404|Petronell-Carnuntum|48.1130|16.8658
2405|Bad Deutsch-Altenburg|48.1342|16.9062
2410|Hainburg a.d. Donau|48.1463|16.9450
2412|Wolfsthal|48.1333|17.0000
2413|Berg|48.1015|17.0384
2421|Kittsee|48.0925|17.0639
2422|Pama|48.0473|17.0332
2423|Deutsch Jahrndorf|48.0112|17.1062
2424|Zurndorf|47.9831|17.0031
2425|Nickelsdorf|47.9406|17.0694
2431|Klein-Neusiedl|48.0938|16.6066
2432|Schwadorf|48.0694|16.5796
2433|Enzersdorf an der Fischa|48.0333|16.6000
2434|Götzendorf an der Leitha|48.0167|16.5833
2435|Götzendorf an der Leitha|48.0167|16.5833
2440|Mitterndorf an der Fischa|47.9974|16.4736
2441|Moosbrunn|48.0167|16.4500
2442|Ebreichsdorf|47.9667|16.4333
2443|Leithaprodersdorf|47.9335|16.4791
2444|Seibersdorf|47.9586|16.5184
2445|Leithaprodersdorf|47.9755|16.4805
2451|Hof am Leithaberge|47.9500|16.5833
2452|Mannersdorf am Leithagebirge|47.9667|16.6000
2453|Sommerein|47.9833|16.6500
2454|Trautmannsdorf an der Leitha|48.0236|16.6327
2460|Bruck an der Leitha|48.0242|16.7757
2462|Bruckneudorf|48.0098|16.7197
2463|Trautmannsdorf an der Leitha|48.0500|16.6333
2464|Göttlesbrunn-Arbesthal|48.0667|16.7000
2465|Höflein|48.0667|16.7833
2471|Rohrau|48.0667|16.8500
2472|Prellenkirchen|48.0740|16.9523
2473|Potzneusiedl|48.0450|16.9477
2474|Gattendorf|48.0167|16.9833
2475|Neudorf|48.0167|16.9333
2481|Achau|48.0803|16.3861
2482|Münchendorf|48.0333|16.3833
2483|Ebreichsdorf|47.9558|16.4071
2484|Weigelsdorf, Fischa|47.9503|16.3955
2485|Wimpassing an der Leitha|47.9167|16.4333
2486|Pottendorf|47.9000|16.3833
2490|Ebenfurth|47.8774|16.3673
2491|Neufeld an der Leitha|47.8656|16.3786
2492|Eggendorf|47.8581|16.3218
2493|Eggendorf|47.8581|16.3218
2500|Baden|48.0054|16.2326
2504|Sooß|47.9846|16.2174
2505|Baden-Leesdorf|48.0064|16.2130
2511|Pfaffstätten|48.0174|16.2635
2512|Traiskirchen|48.0062|16.2708
2513|Möllersdorf|48.0258|16.3051
2514|Traiskirchen|48.0148|16.2932
2521|Trumau|47.9935|16.3427
2522|Oberwaltersdorf|47.9757|16.3219
2523|Tattendorf|47.9500|16.3000
2524|Teesdorf|47.9500|16.2833
2525|Günselsdorf|47.9439|16.2606
2531|Gaaden|48.0536|16.2000
2532|Heiligenkreuz|48.0556|16.1249
2533|Klausen-Leopoldsdorf|48.0877|16.0169
2534|Alland|48.0583|16.0790
2540|Bad Vöslau|47.9653|16.2136
2542|Kottingbrunn|47.9510|16.2271
2544|Leobersdorf|47.9280|16.2165
2551|Enzesfeld-Lindabrunn|47.9310|16.1791
2552|Enzesfeld-Lindabrunn|47.9310|16.1791
2560|Hernstein|47.8947|16.1056
2561|Hernstein|47.8947|16.1056
2563|Pottenstein|47.9582|16.0948
2564|Pottenstein|47.9582|16.0948
2565|Weissenbach an der Triesting|48.0098|16.0607
2571|Altenmarkt an der Triesting|48.0155|15.9966
2572|Kaumberg|48.0241|15.8984
2601|Eggendorf|47.8581|16.3218
2602|Schönau an der Triesting|47.9345|16.2538
2603|Felixdorf|47.8816|16.2421
2604|Eggendorf|47.8581|16.3218
2620|Wartmannstetten|47.6936|16.0751
2624|Breitenau|47.7336|16.1434
2625|Schwarzau am Steinfeld|47.7318|16.1709
2630|Ternitz|47.7157|16.0357
2631|Ternitz|47.7375|15.9753
2632|Altendorf|47.6500|16.0167
2640|Gloggnitz|47.6749|15.9389
2641|Schottwien|47.6568|15.8725
2650|Payerbach|47.6921|15.8634
2651|Reichenau an der Rax|47.6951|15.8457
2654|Reichenau an der Rax|47.6738|15.7645
2661|Schwarzau im Gebirge|47.7731|15.7027
2662|Schwarzau im Gebirge|47.8122|15.7058
2663|Rohr im Gebirge|47.8947|15.7360
2671|Payerbach|47.6763|15.8928
2673|Breitenstein|47.6595|15.8215
2680|Spital am Semmering|47.6135|15.7510
2700|Wiener Neustadt|47.8049|16.2320
2703|Wiener Neustadt|47.8049|16.2320
2705|Wiener Neustadt|47.8049|16.2320
2706|Wiener Neustadt|47.8049|16.2320
2707|Wiener Neustadt|47.8049|16.2320
2721|Bad Fischau-Brunn|47.8314|16.1671
2722|Weikersdorf am Steinfelde|47.8061|16.1439
2723|Hohe Wand|47.8308|16.0842
2724|Hohe Wand|47.8305|16.0701
2731|St. Egyden am Steinfeld|47.7811|16.1066
2732|Willendorf|47.7893|16.0569
2733|Schrattenbach|47.7790|15.9906
2734|Puchberg am Schneeberg|47.7871|15.9135
2751|Wiener Neustadt|47.8049|16.2320
2752|Wiener Neustadt|47.8049|16.2320
2753|Markt Piesting|47.8736|16.1251
2754|Waldegg|47.8685|16.0515
2755|Waldegg|47.8785|16.0246
2761|Waidmannsfeld|47.8704|15.9812
2763|Muggendorf|47.9106|15.9353
2770|Gutenstein|47.8760|15.8888
2801|Katzelsdorf|47.7805|16.2699
2802|Hochwolkersdorf|47.6613|16.2807
2803|Schwarzenbach|47.6355|16.3511
2811|Wiesmath|47.6167|16.2833
2812|Hollenthon|47.5894|16.2613
2813|Lichtenegg|47.6000|16.2000
2820|Walpersbach|47.7167|16.2333
2821|Lanzenkirchen|47.7362|16.2199
2822|Bad Erlach|47.7272|16.2144
2823|Pitten|47.7167|16.1833
2824|Seebenstein|47.6994|16.1448
2831|Warth|47.6500|16.1167
2832|Scheiblingkirchen-Thernberg|47.6500|16.1833
2833|Bromberg|47.6654|16.2099
2840|Grimmenstein|47.6163|16.1272
2842|Edlitz|47.5980|16.1405
2851|Thomasberg|47.5667|16.1333
2852|Krumbach|47.5218|16.1942
2853|Bad Schönau|47.4947|16.2341
2860|Kirchschlag in der Buckligen Welt|47.5000|16.2833
2870|St. Corona am Wechsel|47.5779|15.9994
2871|Zöbern|47.5146|16.1311
2872|Mönichkirchen|47.5106|16.0343
2873|Feistritz am Wechsel|47.6000|16.0500
2880|Kirchberg am Wechsel|47.6074|15.9910
2881|Trattenbach|47.6000|15.8667
3001|Mauerbach|48.2451|16.1679
3002|Purkersdorf|48.2077|16.1754
3003|Gablitz|48.2286|16.1544
3004|Gablitz|48.2286|16.1544
3011|Purkersdorf|48.2077|16.1754
3012|Wolfsgraben|48.1587|16.1210
3013|Pressbaum|48.1833|16.0833
3021|Pressbaum|48.1833|16.0833
3031|Pressbaum|48.1833|16.0833
3032|Eichgraben|48.1720|15.9839
3033|Altlengbach|48.1535|15.9261
3034|Maria-Anzbach|48.1901|15.9315
3040|Neulengbach|48.1974|15.9022
3041|Asperhofen|48.2458|15.9261
3042|Würmla|48.2550|15.8603
3051|Neulengbach|48.1660|15.8824
3052|Neustift-Innermanzing|48.1340|15.9135
3053|Klausen-Leopoldsdorf|48.0877|16.0169
3061|Neulengbach|48.1867|15.8440
3062|Kirchstetten|48.1833|15.8167
3071|Böheimkirchen|48.1978|15.7618
3072|Kasten bei Böheimkirchen|48.1532|15.7795
3073|Stössing|48.1227|15.8138
3074|Michelbach|48.1063|15.7606
3100|St. Pölten|48.2000|15.6333
3101|St. Pölten Postfach|48.2015|15.6322
3104|St. Pölten|48.2000|15.6333
3105|St. Pölten|48.2534|15.6782
3106|St. Pölten-Spratzern|48.1704|15.6184
3107|St. Pölten|48.2000|15.6333
3108|St. Pölten-Wagram|48.3623|15.7123
3109|St. Pölten|48.2000|15.6333
3110|Neidling|48.2400|15.5559
3121|Karlstetten|48.2592|15.5654
3122|Dunkelsteinerwald|48.2982|15.4697
3123|Obritzberg-Rust|48.2759|15.6007
3124|Wölbling|48.3068|15.5822
3125|Statzendorf|48.3075|15.6413
3130|Herzogenburg|48.2814|15.6943
3131|Inzersdorf-Getzersdorf|48.3183|15.6757
3133|Traismauer|48.3500|15.7333
3134|Nußdorf ob der Traisen|48.3529|15.6962
3140|St. Pölten|48.2287|15.7242
3141|Kapelln|48.2582|15.7573
3142|Perschling|48.2602|15.7958
3143|Pyhra|48.1591|15.6862
3144|Pyhra|48.1397|15.7269
3150|Wilhelmsburg|48.1057|15.6054
3151|St. Pölten|48.1405|15.6154
3153|Eschenau|48.0483|15.5669
3160|Traisen|48.0333|15.6000
3161|St. Veit an der Gölsen|48.0432|15.6694
3162|St. Veit an der Gölsen|48.0474|15.7108
3163|Rohrbach an der Gölsen|48.0470|15.7417
3170|Hainfeld|48.0339|15.7741
3171|Kleinzell|47.9799|15.7362
3172|Ramsau|48.0031|15.8033
3180|Lilienfeld|48.0131|15.5966
3182|Marktl, Traisental|47.9828|15.5690
3183|Türnitz|47.9310|15.4930
3184|Türnitz|47.9310|15.4930
3192|Hohenberg|47.9068|15.6200
3193|St. Aegyd am Neuwalde|47.8686|15.5968
3195|St. Aegyd am Neuwalde|47.8157|15.5451
3200|Ober-Grafendorf|48.1504|15.5453
3202|Hofstetten-Grünau|48.0971|15.5115
3203|Rabenstein an der Pielach|48.0653|15.4677
3204|Kirchberg an der Pielach|48.0269|15.4288
3205|Weinburg|48.1135|15.5330
3211|Loich|47.9958|15.4016
3212|Schwarzenbach an der Pielach|47.9302|15.3742
3213|Frankenfels|47.9823|15.3259
3214|Puchenstuben|47.9282|15.2875
3221|Puchenstuben|47.8868|15.2911
3222|Annaberg|47.8659|15.3740
3223|Puchenstuben|47.8868|15.2911
3224|Mitterbach am Erlaufsee|47.8295|15.3084
3231|St. Margarethen an der Sierning|48.1643|15.7063
3232|Bischofstetten|48.1222|15.4691
3233|Kilb|48.1010|15.4085
3240|Mank|48.1102|15.3391
3241|Kirnberg an der Mank|48.0725|15.3223
3242|Texingtal|48.0388|15.3156
3243|St. Leonhard am Forst|48.1423|15.2846
3244|Ruprechtshofen|48.1365|15.2767
3250|Wieselburg|48.1333|15.1333
3251|Purgstall an der Erlauf|48.0574|15.1487
3252|Petzenkirchen|48.1469|15.1547
3253|Erlauf|48.1833|15.1833
3254|Bergland|48.1559|15.1855
3261|Steinakirchen am Forst|48.0697|15.0480
3262|Wang|48.0454|15.0267
3263|Randegg|48.0120|14.9733
3264|Reinsberg|47.9857|15.0707
3270|Scheibbs|48.0047|15.1682
3281|Oberndorf an der Melk|48.0639|15.2243
3282|St. Georgen an der Leys|48.0240|15.2354
3283|St. Anton an der Jeßnitz|47.9615|15.2069
3291|Gaming|47.9456|15.1271
3292|Gaming|47.9290|15.0882
3293|Gaming|47.9290|15.0882
3294|Gaming|47.8085|15.1958
3295|Gaming|47.8696|15.1510
3300|Amstetten|48.1229|14.8721
3304|St. Georgen am Ybbsfelde|48.1289|14.9536
3305|Amstetten|48.1229|14.8721
3311|Zeillern|48.1303|14.8076
3312|Zeillern|48.1303|14.8076
3313|Zeillern|48.1303|14.8076
3314|Strengberg|48.1469|14.6515
3321|Zeillern|48.1303|14.8076
3322|Viehdorf|48.1507|14.8926
3323|Neustadtl an der Donau|48.1970|14.9032
3324|Euratsfeld|48.0818|14.9315
3325|Ferschnitz|48.0942|14.9845
3331|Sonntagberg|47.9956|14.7606
3332|Sonntagberg|47.9956|14.7606
3333|Biberbach|48.0301|14.7080
3334|Gaflenz|47.8951|14.7248
3335|Weyer|47.8572|14.6641
3340|Waidhofen an der Ybbs|47.9600|14.7736
3341|Ybbsitz|47.9475|14.8918
3342|Opponitz|47.8667|14.7889
3343|Hollenstein an der Ybbs|47.8030|14.7731
3344|St. Georgen am Reith|47.8420|14.8886
3345|Göstling an der Ybbs|47.8066|14.9380
3350|Haag|48.1136|14.5675
3351|Weistrach|48.0500|14.5833
3352|St. Peter in der Au|48.0167|14.6000
3353|Seitenstetten|48.0333|14.6500
3354|Wolfsbach|48.0789|14.6703
3355|Ertl|47.9770|14.6313
3356|Biberbach|48.0301|14.7080
3361|Aschbach-Markt|48.0831|14.7355
3362|Zeillern|48.1303|14.8076
3363|Winklarn|48.0913|14.8482
3364|Neuhofen an der Ybbs|48.0579|14.8549
3365|Allhartsberg|48.0263|14.7901
3366|Kühberg|48.0236|14.8473
3370|Ybbs an der Donau|48.1667|15.0833
3371|Neumarkt an der Ybbs|48.1410|15.0576
3372|Blindenmarkt|48.1275|14.9865
3373|Neumarkt an der Ybbs|48.1547|15.0958
3374|Ybbs an der Donau|48.2000|15.1167
3375|Krummnußbaum|48.2088|15.1621
3376|St. Martin-Karlsbach|48.1643|15.0208
3380|Pöchlarn|48.2000|15.2000
3381|Golling an der Erlauf|48.1957|15.1755
3382|Loosdorf|48.2000|15.4000
3383|Hürm|48.1560|15.4126
3384|Haunoldstein|48.2000|15.4500
3385|Gerersdorf|48.2009|15.5561
3386|Hafnerbach|48.2167|15.4833
3387|Groß Sierning|48.1930|15.4584
3388|Markersdorf-Haindorf|48.1916|15.4404
3390|Melk|48.2274|15.3319
3392|Dunkelsteinerwald|48.2500|15.4167
3393|Zelking-Matzleinsdorf|48.1687|15.2411
3394|Schönbühel-Aggsbach|48.2090|15.3300
3400|Klosterneuburg|48.3052|16.3252
3402|Klosterneuburg|48.3052|16.3252
3404|Klosterneuburg|48.3052|16.3252
3413|St. Andrä-Wördern|48.3000|16.2167
3420|Klosterneuburg|48.3293|16.3001
3421|Klosterneuburg|48.3497|16.2747
3422|St. Andrä-Wördern|48.3382|16.2314
3423|St. Andrä-Wördern|48.3340|16.2102
3424|Zeiselmauer-Wolfpassing|48.3285|16.1757
3425|Tulln an der Donau|48.3283|16.0586
3426|Muckendorf-Wipfing|48.3318|16.1554
3430|Tulln an der Donau|48.3283|16.0586
3433|Königstetten|48.3020|16.1449
3434|Tulbing|48.2934|16.1223
3435|Zwentendorf an der Donau|48.3453|15.9103
3441|Sieghartskirchen|48.2733|15.9858
3442|Langenrohr|48.3049|16.0103
3443|Sieghartskirchen|48.2553|16.0122
3451|Michelhausen|48.2908|15.9389
3452|Atzenbrugg|48.2912|15.9061
3454|Sitzenberg-Reidling|48.3209|15.8083
3462|Absdorf|48.4002|15.9787
3463|Stetteldorf am Wagram|48.4081|16.0186
3464|Hausleiten|48.3833|16.1000
3465|Königsbrunn am Wagram|48.4167|15.9333
3470|Kirchberg am Wagram|48.4140|15.8884
3471|Großriedenthal|48.4833|15.8667
3472|Hohenwarth-Mühlbach a.M.|48.5072|15.8274
3473|Hohenwarth-Mühlbach a.M.|48.5167|15.7833
3474|Kirchberg am Wagram|48.4000|15.8667
3481|Fels am Wagram|48.4333|15.8167
3482|Fels am Wagram|48.4833|15.8167
3483|Grafenwörth|48.4355|15.7783
3484|Grafenwörth|48.4079|15.7783
3485|Grafenegg|48.4304|15.7491
3491|Straß im Straßertale|48.4667|15.7333
3492|Grafenegg|48.4447|15.7411
3493|Hadersdorf-Kammern|48.4667|15.7167
3494|Gedersdorf|48.4332|15.6886
3495|Rohrendorf bei Krems|48.4194|15.6577
3500|Krems an der Donau|48.4092|15.6141
3502|Krems-Lerchenfeld|48.4123|15.6318
3504|Krems-Stein|48.4016|15.5810
3505|Krems|48.4092|15.6141
3506|Krems an der Donau|48.3794|15.6524
3508|Paudorf|48.3542|15.6185
3511|Furth bei Göttweig|48.3738|15.6141
3512|Mautern an der Donau|48.3932|15.5779
3521|Gföhl|48.4773|15.4766
3522|Lichtenau im Waldviertel|48.5019|15.3764
3524|Sallingberg|48.4833|15.2667
3525|Sallingberg|48.4667|15.2333
3531|Waldhausen|48.5569|15.2906
3532|Rastenfeld|48.5735|15.3318
3533|Zwettl-Niederösterreich|48.5667|15.2500
3541|Senftenberg|48.4522|15.5445
3542|Gföhl|48.5167|15.4833
3543|Krumau am Kamp|48.5888|15.4491
3544|Krumau am Kamp|48.5833|15.4833
3550|Langenlois|48.4667|15.6667
3552|Droß|48.4639|15.5756
3553|Langenlois|48.5167|15.6167
3561|Langenlois|48.4667|15.6667
3562|Schönberg am Kamp|48.5264|15.6714
3564|Schönberg am Kamp|48.5500|15.7000
3571|Gars am Kamp|48.5977|15.6607
3572|St. Leonhard am Hornerwald|48.4625|15.5119
3573|Gars am Kamp|48.6167|15.6167
3580|Horn|48.6627|15.6566
3591|Altenburg|48.6476|15.5930
3592|Röhrenbach|48.6500|15.5000
3593|Pölla|48.6425|15.4493
3594|Pölla|48.6000|15.4000
3595|Brunn an der Wild|48.6942|15.5201
3601|Dürnstein|48.3958|15.5197
3602|Rossatz-Arnsdorf|48.3964|15.5045
3610|Weißenkirchen in der Wachau|48.3979|15.4693
3611|Weinzierl am Walde|48.4167|15.3833
3613|Albrechtsberg an der Großen Krems|48.4624|15.3639
3620|Spitz|48.3656|15.4142
3621|Rossatz-Arnsdorf|48.3649|15.4357
3622|Mühldorf|48.3743|15.3467
3623|Kottes-Purk|48.4333|15.2868
3631|Kirchschlag|48.3935|15.2228
3632|Bad Traunstein|48.4333|15.1333
3633|Schönbach|48.4500|15.0333
3641|Aggsbach|48.3159|15.4066
3642|Schönbühel-Aggsbach|48.2709|15.4376
3643|Maria Laach am Jauerling|48.3041|15.3447
3644|Emmersdorf an der Donau|48.2414|15.3372
3650|Pöggstall|48.3173|15.2041
3652|Leiben|48.2463|15.2746
3653|Weiten|48.2956|15.2601
3654|Raxendorf|48.3411|15.2767
3660|Klein-Pöchlarn|48.2167|15.2167
3661|Artstetten-Pöbring|48.2557|15.2108
3662|Münichreith-Laimbach|48.2500|15.1333
3663|Pöggstall|48.3164|15.1159
3664|Martinsberg|48.3755|15.1500
3665|Gutenbrunn|48.3652|15.1190
3671|Marbach an der Donau|48.2167|15.1500
3672|Maria Taferl|48.2270|15.1595
3680|Persenbeug-Gottsdorf|48.1920|15.1022
3681|Hofamt Priel|48.1958|15.0775
3683|Yspertal|48.3119|15.0594
3684|St. Oswald|48.2692|15.0184
3691|Nöchling|48.2243|14.9812
3701|Großweikersdorf|48.4712|15.9825
3702|Rußbach|48.4500|16.0333
3704|Heldenberg|48.5000|15.9333
3710|Ziersdorf|48.5303|15.9269
3711|Ziersdorf|48.5306|15.8794
3712|Maissau|48.5730|15.8300
3713|Burgschleinitz-Kühnring|48.5877|15.7628
3714|Sitzendorf an der Schmida|48.5984|15.9425
3720|Ravelsbach|48.5500|15.8500
3721|Maissau|48.5833|15.8667
3722|Straning-Grafenberg|48.6167|15.8500
3730|Eggenburg|48.6389|15.8190
3741|Pulkau|48.7048|15.8603
3742|Sigmundsherberg|48.7308|15.7899
3743|Röschitz|48.6657|15.8866
3744|Meiseldorf|48.6500|15.7333
3751|Sigmundsherberg|48.6833|15.7500
3752|Sigmundsherberg|48.7333|15.7500
3753|Pernegg|48.7333|15.6167
3754|Irnfritz-Messern|48.7372|15.5411
3761|Irnfritz-Messern|48.7167|15.5167
3762|Ludweis-Aigen|48.7667|15.4833
3763|Japons|48.7925|15.5683
3800|Göpfritz an der Wild|48.7250|15.4024
3804|Allentsteig|48.6972|15.3276
3811|Göpfritz an der Wild|48.7500|15.4000
3812|Groß-Siegharts|48.7918|15.4043
3813|Dietmanns|48.7951|15.3721
3814|Ludweis-Aigen|48.8000|15.4833
3820|Raabs an der Thaya|48.8500|15.5000
3822|Karlstein an der Thaya|48.8808|15.3966
3823|Raabs an der Thaya|48.9119|15.4647
3824|Raabs an der Thaya|48.8900|15.5333
3830|Waidhofen an der Thaya|48.8167|15.2833
3834|Pfaffenschlag bei Waidhofen a.d.Thaya|48.8333|15.1833
3841|Windigsteig|48.7667|15.2833
3842|Thaya|48.8549|15.2890
3843|Dobersberg|48.9151|15.3219
3844|Waldkirchen an der Thaya|48.9333|15.3500
3851|Kautzen|48.9300|15.2393
3852|Gastern|48.8945|15.2203
3860|Heidenreichstein|48.8667|15.1167
3861|Eggern|48.9083|15.1488
3862|Eisgarn|48.9168|15.1032
3863|Reingers|48.9667|15.1333
3871|Brand-Nagelberg|48.8500|15.0000
3872|Schrems|48.8333|15.0500
3873|Brand-Nagelberg|48.8833|15.0167
3874|Litschau|48.9441|15.0448
3900|Schwarzenau|48.7444|15.2584
3902|Vitis|48.7596|15.1826
3903|Echsenbach|48.7167|15.2167
3910|Zwettl-Niederösterreich|48.6073|15.1671
3911|Rappottenstein|48.5216|15.0793
3912|Grafenschlag|48.5000|15.1667
3913|Großgöttfritz|48.5250|15.2083
3914|Waldhausen|48.5218|15.2625
3920|Groß Gerungs|48.5742|14.9579
3921|Langschlag|48.5745|14.8846
3922|Großschönau|48.6500|14.9333
3923|Schweiggers|48.6667|15.0667
3924|Zwettl-Niederösterreich|48.6024|15.0543
3925|Arbesbach|48.4934|14.9531
3931|Schweiggers|48.6667|15.0667
3932|Kirchberg am Walde|48.7248|15.0883
3942|Hirschbach|48.7433|15.1252
3943|Schrems|48.7833|15.0667
3944|Schrems|48.7739|15.1173
3945|Hoheneich|48.7719|15.0286
3950|Gmünd|48.7683|14.9808
3961|Waldenstein|48.7285|15.0142
3962|Großdietmanns|48.7667|14.8667
3970|Weitra|48.7000|14.8833
3971|St. Martin|48.6611|14.8167
3972|Bad Großpertholz|48.6292|14.8235
3973|Bad Großpertholz|48.5833|14.7500
4000|Allhaming|48.1525|14.1702
4010|Linz, Donau|48.3369|14.0095
4016|Linz, Donau|48.3369|14.0095
4018|Linz, Donau|48.3369|14.0095
4020|Linz|48.3064|14.2861
4021|Linz, Donau Postfach|48.3047|14.2680
4024|Linz, Donau|48.3047|14.2680
4025|Linz, Donau|48.3047|14.2680
4027|Linz|48.3064|14.2861
4030|Linz|48.3064|14.2861
4031|Linz, Donau Postfach|48.3064|14.2861
4032|Linz|48.3064|14.2861
4036|Linz|48.3064|14.2861
4040|Linz|48.3064|14.2861
4041|Linz, Donau Postfach|48.3438|14.2661
4046|Linz, Donau|48.3438|14.2661
4048|Puchenau|48.3121|14.2361
4050|Traun|48.2209|14.2383
4052|Ansfelden|48.2097|14.2900
4053|Neuhofen an der Krems|48.1387|14.2276
4055|Pucking|48.1889|14.1882
4056|Sankt Martin|48.2309|14.2678
4059|Leonding|48.2797|14.2533
4060|Leonding|48.2797|14.2533
4061|Pasching|48.2593|14.2037
4062|Kirchberg-Thening|48.2584|14.1464
4063|Hörsching|48.2263|14.1779
4064|Oftering|48.2340|14.1357
4066|Pasching|48.2593|14.2037
4070|Hinzenbach|48.3237|13.9956
4072|Alkoven|48.2875|14.1075
4073|Wilhering|48.3233|14.1880
4074|Stroheim|48.3376|13.9571
4075|Fraham|48.2696|13.9876
4076|Sankt Marienkirchen an der Polsenz|48.2653|13.9316
4077|Straßham|48.2835|14.1452
4081|Hartkirchen|48.3635|14.0042
4082|Aschach an der Donau|48.3646|14.0204
4083|Haibach ob der Donau|48.4102|13.9162
4084|Sankt Agatha|48.3866|13.8778
4085|Waldkirchen am Wesen|48.4450|13.8086
4090|Engelhartszell|48.5063|13.7321
4091|Vichtenstein|48.5289|13.6492
4092|Esternberg|48.5433|13.5708
4100|Ottensheim|48.3325|14.1743
4101|Feldkirchen an der Donau|48.3452|14.0513
4102|Goldwörth|48.3266|14.1011
4111|Walding|48.3521|14.1576
4112|Sankt Gotthard im Mühlkreis|48.3802|14.1319
4113|Sankt Martin im Mühlkreis|48.4155|14.0382
4114|Sankt Martin im Mühlkreis|48.4259|13.9837
4115|Kleinzell im Mühlkreis|48.4558|13.9919
4116|Sankt Ulrich im Mühlkreis|48.4713|14.0409
4120|Neufelden|48.4833|13.9965
4121|Altenfelden|48.4856|13.9698
4122|Arnreit|48.5251|13.9949
4131|Kirchberg ob der Donau|48.4444|13.9380
4132|Lembach im Mühlkreis|48.4952|13.8951
4133|Niederkappel|48.4653|13.8809
4134|Putzleinsdorf|48.5159|13.8732
4141|Pfarrkirchen im Mühlkreis|48.5038|13.8264
4142|Hofkirchen im Mühlkreis|48.4834|13.8096
4143|Neustift im Mühlkreis|48.5288|13.7564
4144|Oberkappel|48.5528|13.7707
4150|Rohrbach-Berg|48.5781|13.9913
4151|Oepping|48.6028|13.9459
4152|Sarleinsbach|48.5453|13.9049
4153|Peilstein im Mühlviertel|48.6174|13.8951
4154|Kollerschlag|48.6051|13.8408
4155|Nebelberg|48.6285|13.8463
4160|Aigen-Schlägl|48.6367|13.9656
4161|Ulrichsberg|48.6750|13.9105
4162|Julbach|48.6609|13.8652
4163|Klaffer am Hochficht|48.6954|13.8813
4164|Schwarzenberg am Böhmerwald|48.7375|13.8343
4170|Sankt Stefan am Walde|48.5675|14.1024
4171|Sankt Peter am Wimberg|48.5023|14.0782
4172|Sankt Johann am Wimberg|48.4882|14.1304
4173|Sankt Veit im Mühlkreis|48.4681|14.1635
4174|Niederwaldkirchen|48.4504|14.0855
4175|Herzogsdorf|48.4301|14.1128
4180|Zwettl an der Rodl|48.4655|14.2713
4181|Oberneukirchen|48.4640|14.2227
4182|Oberneukirchen|48.4770|14.1917
4183|Ahorn|48.5238|14.1741
4184|Helfenberg|48.5443|14.1422
4190|Bad Leonfelden|48.5205|14.2946
4191|Vorderweißenbach|48.5521|14.2179
4192|Schenkenfelden|48.5027|14.3619
4193|Reichenthal|48.5429|14.3847
4201|Gramastetten|48.3803|14.1918
4202|Kirchschlag bei Linz|48.4115|14.2766
4203|Altenberg bei Linz|48.3728|14.3503
4204|Haibach im Mühlkreis|48.4443|14.3441
4205|Kirchschlag bei Linz|48.4115|14.2766
4209|Engerwitzdorf|48.3451|14.4420
4210|Unterweitersdorf|48.3674|14.4678
4211|Alberndorf in der Riedmark|48.4061|14.4144
4212|Neumarkt im Mühlkreis|48.4282|14.4844
4213|Unterweitersdorf|48.3674|14.4678
4221|Steyregg|48.2851|14.3699
4222|Sankt Georgen an der Gusen|48.2718|14.4495
4223|Katsdorf|48.3179|14.4743
4224|Wartberg ob der Aist|48.3479|14.5080
4225|Luftenberg an der Donau|48.2749|14.4296
4230|Pregarten|48.3549|14.5322
4232|Hagenberg im Mühlkreis|48.3679|14.5169
4240|Waldburg|48.5085|14.4398
4242|Hirschbach im Mühlkreis|48.4890|14.4120
4251|Sandl|48.5609|14.6422
4252|Liebenau|48.5313|14.8039
4261|Rainbach im Mühlkreis|48.5576|14.4745
4262|Leopoldschlag|48.6128|14.4854
4263|Windhaag bei Freistadt|48.5877|14.5619
4264|Grünbach|48.5381|14.5356
4271|Sankt Oswald bei Freistadt|48.5000|14.5833
4272|Weitersfelden|48.4773|14.7255
4273|Unterweißenbach|48.4351|14.7823
4274|Schönau im Mühlkreis|48.3946|14.7302
4280|Königswiesen|48.4045|14.8382
4281|Königswiesen|48.3623|14.8261
4282|Pierbach|48.3481|14.7558
4283|Bad Zell|48.3491|14.6695
4284|Tragwein|48.3331|14.6224
4291|Lasberg|48.4712|14.5402
4292|Kefermarkt|48.4426|14.5388
4293|Gutau|48.4172|14.6128
4294|Sankt Leonhard bei Freistadt|48.4441|14.6782
4300|St. Valentin|48.1500|14.5000
4303|St. Pantaleon-Erla|48.2106|14.5680
4310|Mauthausen|48.2411|14.5196
4311|Schwertberg|48.2734|14.5847
4312|Ried in der Riedmark|48.2711|14.5280
4320|Perg|48.2500|14.6333
4322|Windhaag bei Perg|48.2858|14.6809
4323|Münzbach|48.2674|14.7101
4324|Rechberg|48.3224|14.7118
4331|Naarn im Machlande|48.2167|14.6333
4332|Naarn im Machlande|48.2308|14.5969
4341|Arbing|48.2291|14.7030
4342|Baumgartenberg|48.2087|14.7437
4343|Mitterkirchen im Machland|48.1879|14.6959
4351|Saxen|48.2083|14.7905
4352|Klam|48.2237|14.7779
4360|Grein|48.2286|14.8588
4362|Bad Kreuzen|48.2674|14.8065
4363|Pabneukirchen|48.3237|14.8175
4364|Sankt Thomas am Blasenstein|48.3101|14.7633
4371|Dimbach|48.3061|14.9080
4372|Sankt Georgen am Walde|48.3598|14.9024
4381|Sankt Nikola an der Donau|48.2330|14.9066
4382|Sankt Nikola an der Donau|48.2315|14.9517
4391|Waldhausen im Strudengau|48.2738|14.9475
4392|Dorfstetten|48.3274|14.9831
4400|Steyr|48.0427|14.4213
4401|Steyr Postfach|48.0560|14.4125
4403|Steyr|48.0427|14.4213
4405|Steyr-Münichholz|48.0667|14.4500
4407|Steyr|48.0427|14.4213
4410|Steyr|48.0427|14.4213
4421|Aschach an der Steyr|48.0131|14.3354
4431|Haidershofen|48.0758|14.4613
4432|Ernsthofen|48.1667|14.4833
4441|Behamberg|48.0500|14.4765
4442|Maria Neustift|47.9333|14.6000
4443|Maria Neustift|47.9333|14.6000
4451|Steyr|48.0427|14.4213
4452|Ternberg|47.9452|14.3587
4453|Ternberg|47.9452|14.3587
4460|Laussa|47.9500|14.4500
4461|Laussa|47.9500|14.4500
4462|Reichraming|47.8833|14.4500
4463|Großraming|47.8833|14.5500
4464|Weyer|47.8167|14.6333
4470|Enns|48.2135|14.4761
4481|Asten|48.2194|14.4178
4482|Ennsdorf|48.2118|14.5029
4483|Hargelsberg|48.1486|14.4269
4484|Kronstorf|48.1432|14.4631
4490|Sankt Florian|48.2057|14.3784
4491|Niederneukirchen|48.1609|14.3396
4492|Hofkirchen im Traunkreis|48.1431|14.3778
4493|Wolfern|48.0828|14.3720
4501|Neuhofen an der Krems|48.1387|14.2276
4502|Sankt Marien|48.1480|14.2776
4511|Allhaming|48.1525|14.1702
4521|Schiedlberg|48.0912|14.2635
4522|Sierning|48.0434|14.3093
4523|Aschach an der Steyr|48.0131|14.3354
4531|Kematen an der Krems|48.1115|14.1939
4532|Rohr im Kremstal|48.0686|14.1931
4533|Piberbach|48.1151|14.2264
4540|Pfarrkirchen bei Bad Hall|48.0305|14.1991
4541|Adlwang|47.9924|14.2174
4542|Nußbach|47.9725|14.1639
4550|Kremsmünster|48.0529|14.1292
4551|Ried im Traunkreis|48.0258|14.0745
4552|Wartberg an der Krems|47.9891|14.1186
4553|Schlierbach|47.9364|14.1202
4554|Oberschlierbach|47.9259|14.1662
4560|Kirchdorf an der Krems|47.9056|14.1223
4562|Steinbach am Ziehberg|47.8926|14.0304
4563|Kirchdorf an der Krems|47.9056|14.1223
4564|Klaus an der Pyhrnbahn|47.8314|14.1572
4565|Inzersdorf im Kremstal|47.9281|14.0810
4571|Klaus an der Pyhrnbahn|47.8314|14.1572
4572|Sankt Pankraz|47.7648|14.2065
4573|Hinterstoder|47.6996|14.1547
4574|Vorderstoder|47.7134|14.2271
4575|Roßleithen|47.7006|14.2754
4580|Edlbach|47.7149|14.3447
4581|Rosenau am Hengstpaß|47.7131|14.3925
4582|Spital am Pyhrn|47.6649|14.3401
4591|Molln|47.8872|14.2582
4592|Grünburg|47.9333|14.2333
4593|Grünburg|47.9512|14.2549
4594|Ternberg|47.9452|14.3587
4595|Waldneukirchen|47.9985|14.2588
4596|Steinbach an der Steyr|47.9708|14.2694
4600|Wels|48.1667|14.0333
4601|Wels|48.1667|14.0333
4602|Wels Postfach|48.1615|14.0192
4603|Wels|48.1667|14.0333
4605|Wels|48.1667|14.0333
4606|Wels|48.1667|14.0333
4609|Thalheim bei Wels|48.1500|14.0333
4610|Wels|48.1667|14.0333
4611|Buchkirchen|48.2243|14.0224
4612|Scharten|48.2514|14.0354
4613|Buchkirchen|48.2396|14.0625
4614|Marchtrenk|48.1902|14.1091
4615|Holzhausen|48.2230|14.0968
4616|Weißkirchen an der Traun|48.1620|14.1240
4618|Höllwiesen|48.1823|14.0164
4619|Wels|48.1667|14.0333
4621|Sipbachzell|48.0972|14.1111
4622|Eggendorf im Traunkreis|48.1307|14.1441
4623|Gunskirchen|48.1333|13.9500
4624|Pennewang|48.1333|13.8500
4625|Offenhausen|48.1500|13.8333
4631|Krenglbach|48.2054|13.9559
4632|Pichl bei Wels|48.1851|13.8988
4633|Kematen am Innbach|48.1764|13.8587
4641|Steinhaus|48.1161|14.0189
4642|Sattledt|48.0737|14.0548
4643|Pettenbach|47.9602|14.0169
4644|Scharnstein|47.9043|13.9613
4645|Grünau im Almtal|47.8549|13.9557
4650|Lambach|48.0928|13.8745
4651|Stadl-Paura|48.0796|13.8614
4652|Steinerkirchen an der Traun|48.0791|13.9580
4653|Eberstalzell|48.0439|13.9832
4654|Bad Wimsbach-Neydharting|48.0566|13.8910
4655|Vorchdorf|48.0039|13.9212
4656|Kirchham|47.9707|13.8985
4659|Edt bei Lambach|48.1167|13.8833
4661|Roitham am Traunfall|48.0224|13.8388
4662|Laakirchen|47.9819|13.8217
4663|Laakirchen|47.9819|13.8217
4664|Laakirchen|47.9819|13.8217
4671|Neukirchen bei Lambach|48.1000|13.8167
4672|Bachmanning|48.1310|13.7944
4673|Gaspoltshofen|48.1432|13.7364
4674|Gaspoltshofen|48.1465|13.6829
4675|Weibern|48.1833|13.7000
4676|Aistersheim|48.1868|13.7418
4680|Haag am Hausruck|48.1842|13.6437
4681|Rottenbach|48.2059|13.6808
4682|Geboltskirchen|48.1534|13.6336
4690|Rüstorf|48.0433|13.7898
4691|Schlatt|48.0718|13.7890
4692|Niederthalheim|48.0990|13.7687
4693|Desselbrunn|48.0215|13.7703
4694|Ohlsdorf|47.9607|13.7914
4701|Bad Schallerbach|48.2300|13.9192
4702|Wallern an der Trattnach|48.2330|13.9462
4707|Schlüßlberg|48.2186|13.8716
4710|Pollham|48.2603|13.8506
4712|Michaelnbach|48.2879|13.8314
4713|Gallspach|48.2099|13.8098
4714|Meggenhofen|48.1802|13.7958
4715|Taufkirchen an der Trattnach|48.2473|13.7477
4716|Hofkirchen an der Trattnach|48.2198|13.7394
4720|Kallham|48.2849|13.7109
4721|Altschwendt|48.3232|13.6879
4722|Peuerbach|48.3453|13.7720
4723|Natternbach|48.3973|13.7496
4724|Neukirchen am Walde|48.4058|13.7816
4725|Sankt Aegidi|48.4793|13.7374
4730|Waizenkirchen|48.3302|13.8575
4731|Prambachkirchen|48.3171|13.9045
4732|Sankt Thomas|48.2851|13.8806
4733|Heiligenberg|48.3549|13.8204
4741|Wendling|48.2318|13.6662
4742|Pram|48.2354|13.6058
4743|Peterskirchen|48.2374|13.5473
4751|Dorf an der Pram|48.2638|13.6295
4752|Riedau|48.3024|13.6349
4753|Taiskirchen im Innkreis|48.2647|13.5732
4754|Andrichsfurt|48.2657|13.5264
4755|Zell an der Pram|48.3163|13.6292
4760|Raab|48.3524|13.6469
4761|Enzenkirchen|48.3881|13.6483
4762|Sankt Willibald|48.3610|13.6860
4770|Andorf|48.3713|13.5741
4771|Sigharting|48.3965|13.5980
4772|Lambrechten|48.3177|13.5130
4773|Eggerding|48.3490|13.4771
4774|Sankt Marienkirchen bei Schärding|48.3871|13.4508
4775|Taufkirchen an der Pram|48.4110|13.5395
4776|Diersbach|48.4128|13.5715
4777|Mayrhof|48.3509|13.4929
4780|Schärding|48.4596|13.4451
4782|Sankt Florian am Inn|48.4412|13.4426
4783|Wernstein am Inn|48.5080|13.4610
4784|Schardenberg|48.5206|13.4979
4785|Freinberg|48.5663|13.5137
4786|Brunnenthal|48.4685|13.4607
4791|Rainbach im Innkreis|48.4547|13.5352
4792|Münzkirchen|48.4833|13.5667
4793|Sankt Roman|48.4932|13.6277
4794|Kopfing im Innkreis|48.4399|13.6584
4800|Pühret|48.0349|13.7225
4801|Altmünster|47.9022|13.7642
4802|Ebensee|47.8072|13.7790
4810|Altmünster|47.9022|13.7642
4812|Pinsdorf|47.9298|13.7707
4813|Altmünster|47.9022|13.7642
4814|Altmünster|47.8807|13.7299
4816|Gschwandt|47.9351|13.8457
4817|Sankt Konrad|47.9128|13.8882
4820|Bad Ischl|47.7111|13.6189
4821|Bad Ischl|47.6978|13.6176
4822|Bad Goisern am Hallstättersee|47.6333|13.6333
4823|Hallstatt|47.5907|13.6534
4824|Gosau|47.5842|13.5345
4825|Gosau|47.5842|13.5345
4829|Bad Ischl|47.7111|13.6189
4830|Hallstatt|47.5623|13.6491
4831|Obertraun|47.5574|13.6865
4840|Vöcklabruck|48.0028|13.6565
4841|Ungenach|48.0476|13.6147
4842|Zell am Pettenfirst|48.0801|13.5994
4843|Ampflwang im Hausruckwald|48.0843|13.5524
4844|Regau|47.9908|13.6881
4845|Regau|47.9628|13.7092
4846|Redlham|48.0244|13.7474
4847|Vöcklabruck|48.0028|13.6565
4849|Puchkirchen am Trattberg|48.0448|13.5720
4850|Timelkam|48.0039|13.6076
4851|Gampern|47.9888|13.5543
4852|Weyregg am Attersee|47.9029|13.5719
4853|Steinbach am Attersee|47.8309|13.5461
4854|Steinbach am Attersee|47.8000|13.5333
4860|Lenzing|47.9733|13.6085
4861|Aurach am Hongar|47.9518|13.6729
4863|Seewalchen am Attersee|47.9525|13.5838
4864|Attersee am Attersee|47.9078|13.5266
4865|Nußdorf am Attersee|47.8833|13.5167
4866|Unterach am Attersee|47.8051|13.4646
4870|Vöcklamarkt|48.0025|13.4838
4871|Neukirchen an der Vöckla|48.0373|13.5032
4872|Neukirchen an der Vöckla|48.0405|13.5376
4873|Frankenburg am Hausruck|48.0684|13.4907
4875|Redleiten|48.0826|13.4675
4880|Berg im Attergau|47.9404|13.5255
4881|Straß im Attergau|47.9095|13.4545
4882|Oberwang|47.8667|13.4333
4890|Frankenmarkt|47.9833|13.4167
4891|Pöndorf|47.9958|13.3704
4892|Fornach|48.0228|13.4294
4893|Zell am Moos|47.9000|13.3167
4894|Oberhofen am Irrsee|47.9500|13.3000
4901|Ottnang am Hausruck|48.0972|13.6321
4902|Wolfsegg am Hausruck|48.1067|13.6727
4903|Manning|48.0885|13.6668
4904|Atzbach|48.0836|13.7035
4906|Eberschwang|48.1550|13.5619
4910|Pattigham|48.1552|13.4844
4911|Tumeltsham|48.2319|13.4974
4912|Neuhofen im Innkreis|48.1905|13.4725
4920|Schildorn|48.1456|13.4631
4921|Hohenzell|48.1936|13.5420
4922|Geiersberg|48.2005|13.5807
4923|Lohnsburg am Kobernaußerwald|48.1544|13.4048
4924|Waldzell|48.1356|13.4270
4925|Pramet|48.1430|13.4875
4926|Sankt Marienkirchen am Hausruck|48.1828|13.5770
4931|Mettmach|48.1731|13.3437
4932|Kirchheim im Innkreis|48.2105|13.3586
4933|Aspach|48.1919|13.3194
4941|Mehrnbach|48.2081|13.4352
4942|Gurten|48.2414|13.3444
4943|Geinberg|48.2638|13.2941
4950|Altheim|48.2515|13.2341
4951|Polling im Innkreis|48.2312|13.2800
4952|Weng im Innkreis|48.2351|13.1780
4961|Mühlheim am Inn|48.2833|13.2167
4962|Mining|48.2765|13.1618
4963|Sankt Peter am Hart|48.2527|13.0961
4970|Eitzing|48.2381|13.4241
4971|Aurolzmünster|48.2483|13.4553
4972|Utzenaich|48.2762|13.4609
4973|Senftenbach|48.2723|13.4212
4974|Ort im Innkreis|48.3165|13.4336
4975|Suben|48.4118|13.4304
4980|Antiesenhofen|48.3448|13.3995
4981|Reichersberg|48.3362|13.3596
4982|Mörschwang|48.3035|13.3655
4983|Sankt Georgen bei Obernberg am Inn|48.2919|13.3332
4984|Weilbach|48.2773|13.3716
4985|Katzenberg|48.2942|13.3010
5000|Wals bei Salzburg|47.7191|12.9388
5010|Salzburg|47.7994|13.0440
5013|Salzburg-Liefering|47.8167|13.0167
5014|Salzburg|47.7994|13.0440
5016|Salzburg|47.7994|13.0440
5017|Salzburg|47.7994|13.0440
5018|Salzburg-Europark|47.8029|13.0385
5020|Salzburg|47.7994|13.0440
5021|Salzburg Postfach|47.8024|13.0571
5023|Salzburg|47.7994|13.0440
5025|Salzburg-Parsch|47.8000|13.0667
5026|Salzburg|47.7994|13.0440
5027|Salzburg|47.7994|13.0440
5033|Salzburg|47.7994|13.0440
5061|Salzburg|47.7994|13.0440
5071|Salzburg|47.7994|13.0440
5072|Siezenheim|47.8153|12.9904
5081|Salzburg|47.7994|13.0440
5082|Salzburg|47.7994|13.0440
5083|Grödig|47.7383|13.0373
5084|Großgmain|47.7242|12.9085
5089|Niederalm|47.7287|13.0622
5090|Lofer|47.5847|12.6933
5091|Unken|47.6497|12.7295
5092|Sankt Martin bei Lofer|47.5667|12.7000
5093|Weißbach bei Lofer|47.5202|12.7554
5101|Bergheim|47.8472|13.0291
5102|Anthering|47.8833|13.0167
5110|Oberndorf bei Salzburg|47.9500|12.9333
5111|Bürmoos|47.9834|12.9179
5112|Lamprechtshausen|47.9910|12.9548
5113|Sankt Georgen bei Salzburg|47.9908|12.8850
5114|Göming|47.9511|12.9550
5120|Sankt Pantaleon|48.0076|12.8942
5121|Tarsdorf|48.0800|12.8253
5122|Überackern|48.1929|12.8743
5123|Überackern|48.1929|12.8743
5124|Haigermoos|48.0450|12.8818
5131|Franking|48.0522|12.9117
5132|Geretsberg|48.0893|12.9340
5133|Gilgenberg am Weilhart|48.1296|12.9395
5134|Schwand im Innkreis|48.1787|12.9670
5141|Moosdorf|48.0449|12.9890
5142|Eggelsberg|48.0791|12.9905
5143|Feldkirchen bei Mattighofen|48.0678|13.0448
5144|Handenberg|48.1336|13.0075
5145|Neukirchen an der Enknach|48.1783|13.0501
5151|Nußdorf am Haunsberg|47.9594|13.0092
5152|Dorfbeuern|48.0167|13.0167
5161|Elixhausen|47.8667|13.0667
5162|Obertrum am See|47.9372|13.0772
5163|Palting|48.0154|13.1271
5164|Seeham|47.9675|13.0770
5165|Berndorf bei Salzburg|47.9953|13.0615
5166|Perwang am Grabensee|48.0069|13.0830
5201|Seekirchen am Wallersee|47.9000|13.1333
5202|Neumarkt am Wallersee|47.9500|13.2333
5203|Köstendorf|47.9500|13.2000
5204|Straßwalchen|47.9795|13.2553
5205|Schleedorf|47.9500|13.1500
5211|Lengau|48.0059|13.2166
5212|Lengau|48.0241|13.2941
5221|Lochen am See|48.0016|13.1749
5222|Munderfing|48.0704|13.1816
5223|Pfaffstätt|48.0768|13.1439
5224|Auerbach|48.0642|13.1087
5225|Jeging|48.0483|13.1481
5230|Mattighofen|48.1073|13.1508
5231|Schalchen|48.1192|13.1572
5232|Kirchberg bei Mattighofen|48.0389|13.1152
5233|Pischelsdorf am Engelbach|48.1299|13.0837
5241|Maria Schmolln|48.1382|13.2198
5242|Sankt Johann am Walde|48.1210|13.2833
5251|Höhnhart|48.1659|13.2675
5252|Aspach|48.1857|13.3044
5261|Helpfau-Uttendorf|48.1593|13.1359
5270|Mauerkirchen|48.1917|13.1334
5271|Moosbach|48.2081|13.1641
5272|Treubach|48.1906|13.2017
5273|Roßbach|48.2011|13.2511
5274|Burgkirchen|48.2044|13.0999
5280|Braunau am Inn|48.2563|13.0434
5282|Braunau am Inn|48.2331|13.0157
5300|Hallwang|47.8500|13.0833
5301|Eugendorf|47.8676|13.1261
5302|Henndorf am Wallersee|47.9000|13.1833
5303|Thalgau|47.8414|13.2532
5310|Tiefgraben|47.8738|13.3059
5311|Mondsee|47.8565|13.3491
5321|Koppl|47.8081|13.1556
5322|Hof bei Salzburg|47.8193|13.2149
5323|Ebenau|47.7907|13.1753
5324|Faistenau|47.7777|13.2339
5325|Plainfeld|47.8333|13.1833
5330|Fuschl am See|47.8000|13.3000
5340|Sankt Gilgen|47.7667|13.3667
5342|Sankt Gilgen|47.7395|13.4018
5350|Strobl|47.7167|13.4833
5360|St. Wolfgang im Salzkammergut|47.7393|13.4467
5400|Hallein|47.6833|13.1000
5411|Oberalm|47.7000|13.1000
5412|Puch bei Hallein|47.7154|13.0930
5421|Adnet|47.6975|13.1311
5422|Hallein|47.6651|13.0900
5423|Sankt Koloman|47.6475|13.2028
5424|Bad Vigaun|47.6667|13.1333
5425|Krispl|47.7167|13.1833
5431|Kuchl|47.6265|13.1448
5440|Golling an der Salzach|47.6000|13.1667
5441|Abtenau|47.5637|13.3460
5442|Rußbach am Paß Gschütt|47.5921|13.4657
5450|Werfen|47.4759|13.1902
5451|Werfen|47.5000|13.1667
5452|Pfarrwerfen|47.4539|13.2196
5453|Werfenweng|47.4620|13.2558
5500|Bischofshofen|47.4167|13.2167
5505|Mühlbach am Hochkönig|47.3775|13.1293
5511|Hüttau|47.4161|13.3078
5521|Hüttau|47.4000|13.3167
5522|Sankt Martin am Tennengebirge|47.4650|13.3776
5523|Annaberg-Lungötz|47.5000|13.4000
5524|Annaberg-Lungötz|47.5216|13.4277
5531|Eben im Pongau|47.4000|13.4000
5532|Filzmoos|47.4333|13.5167
5541|Altenmarkt im Pongau|47.3833|13.4167
5542|Flachau|47.3441|13.3915
5550|Radstadt|47.3833|13.4500
5552|Forstau|47.3784|13.5556
5561|Untertauern|47.3000|13.5000
5562|Tweng|47.1833|13.6000
5563|Tweng|47.1833|13.6000
5570|Mauterndorf|47.1345|13.6788
5571|Mariapfarr|47.1500|13.7500
5572|Sankt Andrä im Lungau|47.1500|13.7833
5573|Weißpriach|47.2105|13.6600
5574|Göriach|47.1754|13.7640
5575|Lessach|47.1891|13.8076
5580|Tamsweg|47.1281|13.8110
5581|Sankt Margarethen im Lungau|47.0793|13.6961
5582|Sankt Michael im Lungau|47.1000|13.6333
5583|Muhr|47.0978|13.5009
5584|Zederhaus|47.1557|13.5058
5585|Unternberg|47.1127|13.7426
5591|Ramingstein|47.0746|13.8364
5592|Thomatal|47.0667|13.7500
5600|Sankt Johann im Pongau|47.3500|13.2000
5602|Wagrain|47.3500|13.3167
5603|Kleinarl|47.2772|13.3195
5611|Großarl|47.2333|13.2000
5612|Hüttschlag|47.1763|13.2324
5620|Schwarzach im Pongau|47.3205|13.1517
5621|Sankt Veit im Pongau|47.3333|13.1500
5622|Goldegg|47.3167|13.0833
5623|Schwarzach im Pongau|47.3205|13.1517
5630|Bad Hofgastein|47.1727|13.0987
5632|Dorfgastein|47.2417|13.1022
5640|Bad Gastein|47.1155|13.1347
5645|Bad Gastein|47.1155|13.1347
5651|Lend|47.2986|13.0518
5652|Dienten am Hochkönig|47.3667|13.0000
5660|Taxenbach|47.2912|12.9621
5661|Rauris|47.2266|12.9946
5662|Bruck an der Großglocknerstraße|47.2858|12.8700
5671|Bruck an der Großglocknerstraße|47.2849|12.8231
5672|Fusch an der Großglocknerstraße|47.2280|12.8254
5700|Zell am See|47.3231|12.7984
5710|Kaprun|47.2724|12.7598
5721|Piesendorf|47.2908|12.7184
5722|Niedernsill|47.2833|12.6500
5723|Uttendorf|47.2833|12.5667
5724|Stuhlfelden|47.2876|12.5275
5730|Mittersill|47.2833|12.4833
5731|Hollersbach im Pinzgau|47.2766|12.4233
5732|Bramberg am Wildkogel|47.2833|12.3667
5733|Bramberg am Wildkogel|47.2698|12.3385
5741|Neukirchen am Großvenediger|47.2505|12.2758
5742|Wald im Pinzgau|47.2500|12.2000
5743|Krimml|47.2333|12.1833
5751|Maishofen|47.3667|12.8000
5752|Viehhofen|47.3667|12.7333
5753|Saalbach-Hinterglemm|47.3914|12.6364
5754|Saalbach-Hinterglemm|47.3768|12.5958
5760|Saalfelden am Steinernen Meer|47.4268|12.8480
5761|Maria Alm am Steinernen Meer|47.4101|12.9225
5771|Leogang|47.4391|12.7611
6000|Hall in Tirol|47.2833|11.5167
6010|Innsbruck|47.2627|11.3945
6013|Innsbruck|47.2627|11.3945
6019|Innsbruck|47.2627|11.3945
6020|Innsbruck|47.2627|11.3945
6021|Innsbruck Postfach|47.2527|11.3967
6022|Innsbruck|47.2627|11.3945
6023|Innsbruck|47.2627|11.3945
6024|Innsbruck|47.2627|11.3945
6026|Innsbruck|47.2627|11.3945
6028|Innsbruck|47.2627|11.3945
6029|Innsbruck|47.2627|11.3945
6033|Innsbruck-Arzl|47.2833|11.4333
6060|Hall in Tirol|47.2833|11.5167
6063|Thaur|47.2948|11.4753
6065|Thaur|47.2948|11.4753
6067|Absam|47.2957|11.5059
6068|Mils|47.2833|11.5333
6069|Gnadenwald|47.3167|11.5667
6070|Ampass|47.2625|11.4623
6071|Aldrans|47.2500|11.4500
6072|Lans|47.2383|11.4314
6073|Aldrans|47.2500|11.4500
6074|Rinn|47.2500|11.5000
6075|Tulfes|47.2581|11.5333
6080|Innsbruck|47.2333|11.4000
6082|Patsch|47.2053|11.4151
6083|Ellbögen|47.1667|11.4500
6091|Götzens|47.2361|11.3115
6092|Birgitz|47.2354|11.2992
6094|Axams|47.2311|11.2789
6095|Grinzens|47.2293|11.2532
6100|Seefeld in Tirol|47.3302|11.1879
6103|Reith bei Seefeld|47.3000|11.2000
6105|Leutasch|47.3689|11.1440
6108|Scharnitz|47.3890|11.2645
6111|Volders|47.2833|11.5667
6112|Wattens|47.2942|11.5907
6113|Wattenberg|47.2833|11.6000
6114|Kolsass|47.3000|11.6333
6115|Kolsassberg|47.2815|11.6529
6116|Weer|47.3038|11.6450
6121|Baumkirchen|47.3000|11.5667
6122|Fritzens|47.3053|11.5895
6123|Terfens|47.3235|11.6439
6130|Schwaz|47.3517|11.7101
6133|Weerberg|47.2984|11.6659
6134|Vomp|47.3333|11.6833
6135|Stans|47.3667|11.7167
6136|Pill|47.3235|11.6802
6138|Vomp|47.3333|11.6833
6141|Schönberg im Stubaital|47.1833|11.4167
6142|Mieders|47.1667|11.3833
6143|Mühlbachl|47.1333|11.4500
6145|Navis|47.1333|11.5167
6150|Steinach am Brenner|47.0833|11.4667
6151|Gschnitz|47.0447|11.3509
6152|Trins|47.0833|11.4167
6154|Vals|47.0451|11.5328
6156|Gries am Brenner|47.0385|11.4813
6157|Obernberg am Brenner|47.0167|11.4167
6161|Natters|47.2341|11.3734
6162|Mutters|47.2333|11.3833
6165|Telfes im Stubai|47.1667|11.3667
6166|Fulpmes|47.1520|11.3492
6167|Neustift im Stubaital|47.1167|11.3167
6170|Pettnau|47.2920|11.1596
6173|Oberperfuss|47.2445|11.2476
6175|Kematen in Tirol|47.2500|11.2667
6176|Völs|47.2500|11.3333
6178|Unterperfuss|47.2667|11.2500
6179|Ranggen|47.2573|11.2112
6181|Sellrain|47.2167|11.2167
6182|Stams|47.2760|10.9832
6183|Silz|47.2135|11.0231
6184|St. Sigmund im Sellrain|47.2254|11.0948
6200|Jenbach|47.3917|11.7725
6210|Wiesing|47.4049|11.7971
6212|Eben am Achensee|47.4212|11.7531
6213|Eben am Achensee|47.4406|11.6923
6215|Achenkirch|47.5266|11.7056
6220|Buch in Tirol|47.3745|11.7540
6222|Gallzein|47.3681|11.7716
6230|Brixlegg|47.4294|11.8779
6232|Münster|47.4216|11.8336
6233|Kramsach|47.4479|11.8721
6234|Brandenberg|47.4905|11.8946
6235|Reith im Alpbachtal|47.4169|11.8779
6236|Alpbach|47.3988|11.9437
6240|Rattenberg|47.4394|11.8941
6241|Radfeld|47.4481|11.9142
6250|Kundl|47.4667|11.9833
6252|Breitenbach am Inn|47.4783|11.9737
6260|Bruck am Ziller|47.3900|11.8512
6261|Strass im Zillertal|47.3956|11.8197
6262|Schlitters|47.3805|11.8389
6263|Fügen|47.3470|11.8494
6264|Fügenberg|47.3521|11.8417
6265|Hart im Zillertal|47.3511|11.8648
6271|Uderns|47.3167|11.8667
6272|Kaltenbach|47.2833|11.8667
6273|Ried im Zillertal|47.3000|11.8667
6274|Aschau im Zillertal|47.2667|11.9000
6275|Stumm|47.2905|11.8875
6276|Stummerberg|47.2833|11.9167
6277|Zellberg|47.2333|11.8500
6278|Hainzenberg|47.2179|11.9003
6280|Rohrberg|47.2333|11.9167
6281|Gerlos|47.2246|12.0301
6283|Schwendau|47.1975|11.8590
6284|Ramsau im Zillertal|47.2038|11.8754
6290|Mayrhofen|47.1667|11.8667
6292|Schwendau|47.1975|11.8590
6293|Tux|47.1556|11.7287
6294|Tux|47.1556|11.7287
6295|Mayrhofen|47.1667|11.8667
6300|Wörgl|47.4891|12.0617
6305|Itter|47.4701|12.1439
6306|Söll|47.5038|12.1922
6311|Wildschönau|47.4000|12.0333
6313|Wildschönau|47.4434|12.0489
6314|Wildschönau|47.4500|12.0833
6320|Angerberg|47.5067|12.0403
6321|Angath|47.5076|12.0651
6322|Kirchbichl|47.5174|12.0963
6323|Bad Häring|47.5107|12.1191
6324|Mariastein|47.5277|12.0548
6330|Kufstein|47.5833|12.1667
6332|Kufstein|47.5833|12.1667
6334|Schwoich|47.5460|12.1405
6335|Thiersee|47.5833|12.0667
6336|Langkampfen|47.5500|12.1000
6341|Ebbs|47.6333|12.2167
6342|Niederndorf|47.6500|12.2167
6343|Erl|47.6833|12.1833
6344|Walchsee|47.6516|12.3187
6345|Kössen|47.6699|12.4055
6346|Niederndorferberg|47.6581|12.2428
6347|Rettenschöss|47.6572|12.2687
6351|Scheffau am Wilden Kaiser|47.5294|12.2514
6352|Ellmau|47.5138|12.2994
6353|Going am Wilden Kaiser|47.5133|12.3316
6361|Hopfgarten im Brixental|47.4167|12.1500
6362|Kelchsau|47.3833|12.1333
6363|Westendorf|47.4321|12.2141
6364|Brixen im Thale|47.4500|12.2500
6365|Reith bei Kitzbühel|47.4667|12.3500
6370|Reith bei Kitzbühel|47.4667|12.3500
6371|Aurach bei Kitzbühel|47.4122|12.4273
6372|Oberndorf in Tirol|47.5000|12.3833
6373|Jochberg|47.3792|12.4181
6380|St. Johann in Tirol|47.5233|12.4232
6382|Kirchdorf in Tirol|47.5563|12.4451
6383|Kirchdorf in Tirol|47.5563|12.4451
6384|Waidring|47.5833|12.5667
6385|Schwendt|47.6318|12.3927
6391|Fieberbrunn|47.4763|12.5435
6392|St. Jakob in Haus|47.4996|12.5546
6393|St. Ulrich am Pillersee|47.5255|12.5979
6395|Hochfilzen|47.4667|12.6167
6401|Inzing|47.2737|11.1975
6402|Hatting|47.2787|11.1684
6403|Flaurling|47.2914|11.1232
6404|Polling in Tirol|47.2833|11.1500
6405|Pfaffenhofen|47.3000|11.0833
6406|Oberhofen im Inntal|47.2982|11.0861
6408|Pettnau|47.2920|11.1596
6410|Telfs|47.3071|11.0682
6412|Telfs-St. Georgen|47.3149|11.0512
6413|Wildermieming|47.3167|11.0167
6414|Mieming|47.3000|10.9667
6416|Obsteig|47.3000|10.9333
6421|Rietz|47.2859|11.0307
6422|Stams|47.2760|10.9832
6423|Mötz|47.2833|10.9500
6424|Silz|47.2667|10.9333
6425|Haiming|47.2500|10.8833
6426|Roppen|47.2167|10.8167
6430|Haiming|47.2500|10.8833
6432|Sautens|47.2077|10.8645
6433|Oetz|47.2000|10.9000
6441|Umhausen|47.1350|10.9283
6444|Längenfeld|47.0740|10.9695
6450|Sölden|46.9667|11.0000
6452|Sölden|46.9667|11.0000
6456|Sölden|46.9667|11.0000
6458|Sölden|46.9667|11.0000
6460|Imst|47.2450|10.7397
6462|Karres|47.2167|10.7833
6463|Karrösten|47.2254|10.7656
6464|Tarrenz|47.2667|10.7667
6465|Nassereith|47.3167|10.8333
6471|Arzl im Pitztal|47.2071|10.7626
6473|Jerzens|47.1512|10.7469
6474|Jerzens|47.1512|10.7469
6481|St. Leonhard im Pitztal|47.0517|10.8340
6491|Schönwies|47.1967|10.6574
6492|Imsterberg|47.2052|10.6960
6493|Mils bei Imst|47.2062|10.6748
6500|Landeck|47.1399|10.5659
6511|Zams|47.1584|10.5897
6521|Fließ|47.1167|10.6167
6522|Prutz|47.0833|10.6667
6524|Kaunertal|47.0307|10.7459
6525|Faggen|47.0788|10.6715
6526|Kauns|47.0782|10.6922
6527|Kaunerberg|47.0834|10.7040
6528|Fendels|47.0539|10.6778
6531|Ried im Oberinntal|47.0500|10.6500
6532|Ladis|47.0746|10.6495
6533|Fiss|47.0571|10.6175
6534|Serfaus|47.0402|10.6034
6541|Serfaus|47.0402|10.6034
6542|Pfunds|46.9667|10.5500
6543|Nauders|46.8886|10.5013
6544|Spiss|46.9817|10.4399
6551|Pians|47.1349|10.5124
6552|Tobadill|47.1251|10.5140
6553|See|47.0833|10.4667
6555|Kappl|47.0667|10.3833
6561|Ischgl|47.0126|10.2918
6562|Ischgl|46.9833|10.2500
6563|Galtür|46.9667|10.1833
6571|Strengen|47.1259|10.4620
6572|Flirsch|47.1500|10.4000
6574|Pettneu am Arlberg|47.1459|10.3365
6580|St. Anton am Arlberg|47.1275|10.2637
6591|Grins|47.1403|10.5141
6600|Pflach|47.5167|10.7167
6604|Höfen|47.4667|10.6833
6610|Wängle|47.4866|10.6900
6611|Heiterwang|47.4500|10.7500
6621|Bichlbach|47.4203|10.7904
6622|Berwang|47.4081|10.7474
6623|Namlos|47.3500|10.6667
6631|Lermoos|47.4036|10.8807
6632|Ehrwald|47.4000|10.9167
6633|Biberwier|47.3833|10.9000
6642|Stanzach|47.3833|10.5667
6644|Elmen|47.3404|10.5432
6645|Vorderhornbach|47.3701|10.5395
6646|Hinterhornbach|47.3593|10.4609
6647|Pfafflar|47.3091|10.5852
6650|Gramais|47.2667|10.5333
6651|Häselgehr|47.3167|10.5000
6652|Elbigenalp|47.2904|10.4361
6653|Bach|47.2667|10.4000
6654|Holzgau|47.2604|10.3442
6655|Steeg|47.2439|10.2944
6670|Forchach|47.4167|10.5833
6671|Weißenbach am Lech|47.4416|10.6407
6672|Nesselwängle|47.4833|10.6167
6673|Grän|47.5000|10.5500
6675|Tannheim|47.4993|10.5164
6677|Schattwald|47.5143|10.4614
6682|Vils|47.5500|10.6333
6691|Jungholz|47.5741|10.4472
6700|Stallehr|47.1404|9.8561
6701|Bludenz Postfach|47.1375|9.8072
6706|Bürs|47.1497|9.8000
6707|Bürserberg|47.1464|9.7774
6708|Brand|47.1008|9.7372
6710|Nenzing|47.1844|9.7054
6712|Thüringen|47.2000|9.7667
6713|Ludesch|47.2000|9.7831
6714|Nüziders|47.1667|9.8000
6719|Bludesch|47.2000|9.7331
6721|Thüringerberg|47.2144|9.7850
6722|St. Gerold|47.2211|9.8164
6723|Blons|47.2233|9.8341
6731|Sonntag|47.2358|9.9024
6733|Fontanella|47.2497|9.9086
6741|Raggal|47.2108|9.8369
6751|Innerbraz|47.1500|9.9167
6752|Dalaas|47.1245|9.9910
6754|Klösterle|47.1333|10.0833
6762|Klösterle|47.1333|10.1667
6763|Lech|47.2080|10.1418
6764|Lech|47.2080|10.1418
6767|Warth|47.2500|10.1833
6771|St. Anton im Montafon|47.1180|9.8723
6773|Vandans|47.0957|9.8652
6774|Tschagguns|47.0739|9.9027
6780|Schruns|47.0803|9.9192
6781|Bartholomäberg|47.0924|9.9081
6782|Silbertal|47.0937|9.9831
6787|St. Gallenkirch|46.9674|9.9183
6791|St. Gallenkirch|47.0210|9.9733
6793|Gaschurn|46.9858|10.0270
6794|Gaschurn|46.9667|10.0500
6800|Feldkirch|47.2331|9.6000
6801|Feldkirch Postfach|47.2417|9.5989
6803|Feldkirch|47.2331|9.6000
6805|Feldkirch-Gisingen|47.2589|9.5966
6808|Feldkirch-Nofels|47.2417|9.5989
6811|Göfis|47.2336|9.6346
6812|Meiningen|47.2989|9.5786
6820|Frastanz|47.2174|9.6299
6822|Dünserberg|47.2275|9.7237
6824|Schlins|47.2000|9.7000
6830|Rankweil|47.2711|9.6431
6832|Röthis|47.2933|9.6548
6833|Fraxern|47.3150|9.6739
6834|Übersaxen|47.2528|9.6708
6835|Zwischenwasser|47.2843|9.6787
6836|Viktorsberg|47.3009|9.6748
6837|Weiler|47.2997|9.6500
6840|Götzis|47.3331|9.6331
6841|Mäder|47.3500|9.6167
6842|Koblach|47.3331|9.6000
6844|Altach|47.3544|9.6521
6845|Hohenems|47.3612|9.6869
6850|Dornbirn|47.4143|9.7420
6851|Dornbirn Postfach|47.4291|9.7690
6854|Dornbirn-Messepark|47.4291|9.7690
6855|Dornbirn|47.4143|9.7420
6857|Dornbirn-Haselstauden|47.4331|9.7500
6858|Bildstein|47.4605|9.7909
6861|Alberschwende|47.4502|9.8315
6863|Egg|47.4315|9.8976
6866|Andelsbuch|47.4117|9.8933
6867|Schwarzenberg|47.4141|9.8515
6870|Bezau|47.3848|9.9014
6874|Bezau|47.3848|9.9014
6881|Mellau|47.3503|9.8815
6882|Schnepfau|47.3521|9.9452
6883|Au|47.3218|9.9807
6884|Damüls|47.2803|9.8916
6886|Schoppernau|47.3120|10.0165
6888|Schröcken|47.2576|10.0920
6890|Lustenau|47.4264|9.6585
6900|Bregenz|47.5031|9.7471
6901|Bregenz Postfach|47.5212|9.7655
6904|Bregenz|47.5031|9.7471
6911|Lochau|47.5333|9.7500
6912|Möggers|47.5667|9.8167
6914|Hohenweiler|47.5845|9.7795
6921|Kennelbach|47.4831|9.7667
6922|Wolfurt|47.4667|9.7500
6923|Lauterach|47.4757|9.7294
6932|Langen bei Bregenz|47.5165|9.8338
6933|Doren|47.4928|9.8797
6934|Sulzberg|47.5218|9.9135
6941|Langenegg|47.4692|9.8974
6942|Krumbach|47.4831|9.9358
6943|Riefensberg|47.5014|9.9584
6951|Lingenau|47.4503|9.9217
6952|Hittisau|47.4578|9.9596
6953|Sibratsgfäll|47.4267|10.0381
6960|Buch|47.4857|9.8212
6961|Wolfurt-Bahnhof Postfach|47.4857|9.8212
6971|Hard|47.4831|9.6831
6972|Fußach|47.4793|9.6628
6973|Fußach|47.4793|9.6628
6974|Gaißau|47.4667|9.6000
6991|Mittelberg|47.3578|10.1876
6992|Mittelberg|47.3481|10.1714
6993|Mittelberg|47.3513|10.1720
7000|Eisenstadt|47.8457|16.5233
7001|Eisenstadt Postfach|47.8457|16.5252
7002|Eisenstadt|47.8457|16.5233
7011|Siegendorf|47.7810|16.5423
7012|Zagersdorf|47.7647|16.5138
7013|Klingenbach|47.7569|16.5508
7020|Loipersbach im Burgenland|47.6966|16.4792
7021|Draßburg|47.7465|16.4868
7022|Schattendorf|47.7097|16.5098
7023|Pöttelsdorf|47.7537|16.4386
7024|Hirm|47.7865|16.4546
7025|Pöttelsdorf|47.7537|16.4386
7031|Krensdorf|47.7855|16.4149
7032|Sigleß|47.7753|16.3950
7033|Pöttsching|47.8045|16.3711
7034|Zillingtal|47.8144|16.4093
7035|Steinbrunn|47.8333|16.4167
7041|Wulkaprodersdorf|47.7975|16.5045
7042|Antau|47.7738|16.4798
7051|Großhöflein|47.8359|16.4804
7052|Müllendorf|47.8394|16.4626
7053|Hornstein|47.8805|16.4445
7061|Trausdorf an der Wulka|47.8156|16.5662
7062|Sankt Margarethen im Burgenland|47.8034|16.6088
7063|Oggau am Neusiedler See|47.8333|16.6667
7064|Oslip|47.8291|16.6196
7071|Rust|47.8012|16.6716
7072|Mörbisch am See|47.7500|16.6667
7081|Schützen am Gebirge|47.8523|16.6233
7082|Donnerskirchen|47.8942|16.6463
7083|Purbach am Neusiedler See|47.9129|16.6956
7091|Breitenbrunn am Neusiedler See|47.9445|16.7315
7092|Winden am See|47.9501|16.7556
7093|Jois|47.9617|16.7960
7100|Neusiedl am See|47.9490|16.8417
7101|Neusiedl am See|47.9490|16.8417
7111|Parndorf|47.9996|16.8605
7121|Weiden am See|47.9253|16.8690
7122|Gols|47.8969|16.9111
7123|Mönchhof|47.8802|16.9413
7131|Halbturn|47.8702|16.9754
7132|Frauenkirchen|47.8368|16.9258
7141|Podersdorf am See|47.8541|16.8371
7142|Illmitz|47.7615|16.8002
7143|Apetlon|47.7439|16.8302
7151|Wallern im Burgenland|47.7285|16.9371
7152|Wallern im Burgenland|47.7285|16.9371
7161|Sankt Andrä am Zicksee|47.7841|16.9419
7162|Tadten|47.7642|16.9865
7163|Andau|47.7744|17.0329
7201|Neudörfl|47.7966|16.2977
7202|Bad Sauerbrunn|47.7744|16.3284
7203|Wiesen|47.7378|16.3380
7210|Mattersburg|47.7333|16.4000
7212|Forchtenstein|47.7116|16.3453
7221|Marz|47.7167|16.4167
7222|Rohrbach bei Mattersburg|47.7052|16.4301
7223|Sieggraben|47.6513|16.3799
7301|Deutschkreutz|47.6000|16.6333
7302|Nikitsch|47.5362|16.6602
7304|Großwarasdorf|47.5036|16.5436
7311|Neckenmarkt|47.5996|16.5467
7312|Horitschon|47.5873|16.5470
7321|Unterfrauenhaid|47.5712|16.4988
7322|Lackenbach|47.5904|16.4653
7323|Ritzing|47.6132|16.4955
7331|Weppersdorf|47.5795|16.4268
7332|Kobersdorf|47.5957|16.3917
7341|Markt Sankt Martin|47.5620|16.4251
7342|Kaisersdorf|47.5374|16.3920
7343|Neutal|47.5455|16.4462
7344|Stoob|47.5284|16.4776
7350|Stoob|47.5284|16.4776
7361|Lutzmannsburg|47.4637|16.6366
7371|Unterrabnitz-Schwendgraben|47.4709|16.3557
7372|Draßmarkt|47.5167|16.4000
7373|Piringsdorf|47.4483|16.4152
7374|Weingraben|47.5139|16.3637
7400|Oberschützen|47.3514|16.2073
7410|Loipersdorf-Kitzladen|47.3333|16.0833
7411|Markt Allhau|47.2833|16.0833
7412|Wolfau|47.2500|16.1000
7420|Neustift an der Lafnitz|47.3667|16.0333
7421|Mönichkirchen|47.5106|16.0343
7422|Riedlingsdorf|47.3500|16.1333
7423|Wiesfleck|47.3846|16.1455
7424|Grafenschachen|47.3632|16.0663
7425|Wiesfleck|47.3846|16.1455
7431|Bad Tatzmannsdorf|47.3313|16.2307
7432|Oberschützen|47.3514|16.2073
7433|Mariasdorf|47.3658|16.2314
7434|Bernstein|47.4059|16.2606
7435|Unterkohlstätten|47.3833|16.3167
7441|Pilgersdorf|47.4411|16.3492
7442|Lockenhaus|47.4075|16.4162
7443|Mannersdorf an der Rabnitz|47.4136|16.4945
7444|Mannersdorf an der Rabnitz|47.4281|16.5268
7451|Oberloisdorf|47.4474|16.5076
7452|Frankenau-Unterpullendorf|47.4630|16.5747
7453|Steinberg-Dörfl|47.4833|16.4833
7461|Stadtschlaining|47.3167|16.2833
7463|Weiden bei Rechnitz|47.3132|16.3465
7464|Markt Neuhodis|47.2956|16.3956
7471|Rechnitz|47.3047|16.4410
7472|Schachendorf|47.2615|16.4134
7473|Hannersdorf|47.2290|16.3825
7474|Deutsch Schützen-Eisenberg|47.1430|16.4398
7501|Rotenturm an der Pinka|47.2500|16.2500
7502|Unterwart|47.2640|16.2290
7503|Großpetersdorf|47.2389|16.3178
7511|Mischendorf|47.1928|16.3144
7512|Kohfidisch|47.1747|16.3570
7521|Eberau|47.1076|16.4604
7522|Heiligenbrunn|47.0270|16.4169
7531|Kemeten|47.2486|16.1521
7532|Litzelsdorf|47.2083|16.1717
7533|Ollersdorf im Burgenland|47.1833|16.1667
7534|Olbendorf|47.1833|16.2000
7535|Sankt Michael im Burgenland|47.1285|16.2715
7536|Güttenbach|47.1571|16.2923
7537|Neuberg im Burgenland|47.1689|16.2605
7540|Güssing|47.0594|16.3243
7542|Gerersdorf-Sulz|47.0748|16.2696
7543|Kukmirn|47.0754|16.2103
7544|Tobaj|47.0833|16.3000
7545|Neustift bei Güssing|47.0247|16.2604
7546|Moschendorf|47.0584|16.4773
7550|Wörterberg|47.2167|16.1000
7551|Bocksdorf|47.1426|16.1778
7552|Stinatz|47.2027|16.1331
7553|Bocksdorf|47.1426|16.1778
7554|Rohr im Burgenland|47.1167|16.1667
7561|Heiligenkreuz im Lafnitztal|46.9892|16.2608
7562|Eltendorf|47.0087|16.2024
7563|Königsdorf|47.0025|16.1682
7564|Rudersdorf|47.0513|16.1200
7571|Rudersdorf|47.0513|16.1200
7572|Deutsch Kaltenbrunn|47.0888|16.1069
7574|Burgauberg-Neudauberg|47.0882|16.1140
8000|Graz|47.0667|15.4500
8006|Graz|47.0667|15.4500
8010|Graz|47.0755|15.4401
8011|Graz Postfach|47.0755|15.4823
8012|Graz|47.0667|15.4500
8014|Hönigtal|47.0833|15.5667
8015|Graz|47.0667|15.4500
8016|Graz|47.0667|15.4500
8017|Graz|47.0667|15.4500
8019|Graz|47.0667|15.4500
8020|Graz|47.0755|15.4401
8021|Graz Postfach|47.0667|15.4500
8025|Graz|47.0667|15.4500
8026|Graz|47.0667|15.4500
8035|Graz|47.0667|15.4500
8036|Graz|47.0755|15.4401
8041|Graz|47.0755|15.4401
8042|Graz|47.0755|15.4401
8043|Graz|47.0755|15.4401
8044|Weinitzen|47.1356|15.5180
8045|Weinitzen|47.1500|15.4500
8046|Graz|47.0755|15.4401
8047|Hart bei Graz|47.0431|15.5153
8049|Graz|47.0667|15.4500
8050|Thal|47.0764|15.3605
8051|Thal|47.0764|15.3605
8052|Thal|47.0764|15.3605
8053|Graz|47.0315|15.3732
8054|Graz|47.0051|15.3821
8055|Graz|47.0000|15.4000
8056|Graz|47.0667|15.4500
8057|Graz-Straßgang|47.0315|15.3732
8061|Sankt Radegund bei Graz|47.1817|15.4919
8062|Kumberg|47.1642|15.5326
8063|Eggersdorf bei Graz|47.1234|15.6008
8071|Hausmannstätten|46.9911|15.5114
8072|Fernitz-Mellach|46.9528|15.5111
8073|Feldkirchen bei Graz|47.0167|15.4500
8074|Graz|47.0755|15.4401
8075|Laßnitzhöhe|47.0667|15.5833
8076|Vasoldsberg|47.0163|15.5584
8077|Gössendorf|46.9983|15.4856
8081|Pirching am Traubenberg|46.9500|15.6000
8082|Sankt Stefan im Rosental|46.9039|15.7100
8083|Sankt Stefan im Rosental|46.9039|15.7100
8091|Jagerberg|46.8536|15.7381
8092|Mettersdorf am Saßbach|46.8058|15.7111
8093|Sankt Peter am Ottersbach|46.7978|15.7592
8101|Gratkorn|47.1500|15.3500
8102|Semriach|47.2167|15.4000
8103|Gratwein-Straßengel|47.1333|15.2833
8111|Gratwein-Straßengel|47.1167|15.3167
8112|Sankt Oswald bei Plankenwarth|47.0870|15.2770
8113|Sankt Bartholomä|47.0546|15.2589
8114|Deutschfeistritz|47.1985|15.3362
8120|Peggau|47.2000|15.3500
8121|Deutschfeistritz|47.1985|15.3362
8122|Deutschfeistritz|47.2167|15.2667
8124|Übelbach|47.2253|15.2361
8130|Frohnleiten|47.2667|15.3167
8131|Pernegg an der Mur|47.3432|15.3562
8132|Pernegg an der Mur|47.3598|15.3424
8141|Premstätten|46.9647|15.4042
8142|Wundschuh|46.9264|15.4511
8143|Dobl-Zwaring|46.9333|15.3667
8144|Lieboch|46.9742|15.3375
8151|Hitzendorf|47.0333|15.3000
8152|Stallhofen|47.0500|15.2167
8153|Geistthal-Södingberg|47.1667|15.1667
8160|Weiz|47.2167|15.6167
8162|Passail|47.2833|15.5167
8163|Fladnitz an der Teichalm|47.2854|15.4777
8164|Gutenberg|47.2367|15.5667
8171|Sankt Kathrein am Offenegg|47.3271|15.5675
8172|Birkfeld|47.3333|15.6667
8181|Sankt Ruprecht an der Raab|47.1534|15.6626
8182|Puch bei Weiz|47.2241|15.7250
8183|Floing|47.2636|15.7465
8184|Anger|47.2742|15.6914
8190|Birkfeld|47.3500|15.6833
8191|Birkfeld|47.3333|15.6667
8192|Strallegg|47.4117|15.7253
8194|Waisenegg|47.3942|15.6839
8200|Gleisdorf|47.1056|15.7101
8211|Ilztal|47.1500|15.7667
8212|Gersdorf an der Feistritz|47.1667|15.8500
8213|Gersdorf  an der Feistritz|47.1638|15.7765
8221|Feistritztal|47.1833|15.8500
8222|Feistritztal|47.2000|15.8333
8223|Floing|47.2636|15.7465
8224|Kaindorf|47.2254|15.9113
8225|Pöllau|47.3000|15.8333
8230|Hartberg|47.2833|15.9667
8232|Grafendorf bei Hartberg|47.3403|15.9906
8233|Lafnitz|47.3679|16.0110
8234|Rohrbach an der Lafnitz|47.3833|16.0000
8240|Friedberg|47.4333|16.0500
8241|Dechantskirchen|47.4167|16.0167
8242|Sankt Lorenzen am Wechsel|47.4415|15.9550
8243|Pinggau|47.4423|16.0671
8244|Schäffern|47.4777|16.1096
8250|Vorau|47.4055|15.8875
8251|Sankt Lorenzen am Wechsel|47.4481|15.9329
8252|Waldbach-Mönichwald|47.4685|15.8939
8253|Waldbach-Mönichwald|47.4617|15.8277
8254|Wenigzell|47.4167|15.7833
8255|Sankt Jakob im Walde|47.4684|15.7897
8261|Sinabelkirchen|47.1020|15.8279
8262|Ilz|47.0865|15.9268
8263|Großwilfersdorf|47.0833|15.9833
8264|Großwilfersdorf|47.1333|15.9333
8265|Großsteinbach|47.1500|15.8833
8271|Bad Waltersdorf|47.1696|16.0087
8272|Hartl|47.1833|15.9167
8273|Ebersdorf|47.1985|15.9622
8274|Buch-St. Magdalena|47.2273|15.9901
8280|Fürstenfeld|47.0500|16.0833
8282|Loipersdorf bei Fürstenfeld|47.0000|16.1000
8283|Bad Blumau|47.1167|16.0500
8291|Burgau|47.1427|16.0964
8292|Neudau|47.1755|16.1018
8293|Wörterberg|47.2167|16.1000
8294|Sankt Johann in der Haide|47.2516|16.0244
8295|Sankt Johann in der Haide|47.2808|16.0258
8301|Laßnitzhöhe|47.0667|15.5833
8302|Nestelbach bei Graz|47.0605|15.6114
8311|Markt Hartmannsdorf|47.0546|15.8394
8312|Ottendorf an der Rittschein|47.0478|15.8974
8313|Riegersburg|47.0303|15.9575
8321|St. Margarethen an der Raab|47.2815|15.6738
8322|Eichkögl|47.0236|15.7910
8323|Nestelbach bei Graz|47.0500|15.6667
8324|Kirchberg an der Raab|46.9858|15.7669
8330|Feldbach|46.9531|15.8883
8332|Edelsbach bei Feldbach|46.9894|15.8369
8333|Riegersburg|47.0000|15.9303
8334|Riegersburg|46.9759|15.9515
8341|Paldau|46.9422|15.7958
8342|Gnas|46.8731|15.8253
8343|Bad Gleichenberg|46.8753|15.8845
8344|Bad Gleichenberg|46.8756|15.9086
8345|Straden|46.8092|15.8681
8350|Fehring|46.9400|16.0081
8352|Unterlamm|46.9769|16.0639
8353|Kapfenstein|46.8861|15.9717
8354|Sankt Anna am Aigen|46.8333|15.9667
8355|Tieschen|46.7861|15.9422
8361|Fehring|46.9769|16.0011
8362|Söchau|47.0333|16.0167
8380|Jennersdorf|46.9385|16.1416
8382|Weichselbaum|46.9416|16.1871
8383|Sankt Martin an der Raab|46.9202|16.1338
8384|Minihof-Liebau|46.8796|16.0772
8385|Neuhaus am Klausenbach|46.8667|16.0333
8401|Kalsdorf bei Graz|46.9653|15.4803
8402|Werndorf|46.9242|15.4908
8403|Lang|46.8376|15.5047
8404|Kalsdorf bei Graz|46.9653|15.4803
8410|Wildon|46.8833|15.5167
8411|Hengsberg|46.8692|15.4505
8412|Allerheiligen bei Wildon|46.9142|15.5544
8413|Sankt Georgen an der Stiefing|46.8733|15.5797
8421|Schwarzautal|46.8439|15.6589
8422|Mettersdorf am Saßbach|46.8058|15.7111
8423|Sankt Veit in der Südsteiermark|46.7667|15.6500
8424|Gabersdorf|46.7772|15.5842
8430|Leibnitz|46.7816|15.5384
8431|Gralla|46.8140|15.5551
8432|Kaindorf an der Sulm|46.7925|15.5388
8434|Tillmitsch|46.8120|15.5168
8435|Wagna|46.7668|15.5591
8441|Kitzeck im Sausal|46.7701|15.4289
8442|Kitzeck im Sausal|46.7788|15.4534
8443|Gleinstätten|46.7536|15.3697
8444|Sankt Andrä-Höch|46.7931|15.3993
8451|Heimschuh|46.7600|15.4931
8452|Großklein|46.7361|15.4444
8453|Sankt Johann im Saggautal|46.7039|15.4028
8454|Oberhaag|46.6869|15.3320
8455|Oberhaag|46.6869|15.3320
8461|Gamlitz|46.7203|15.5533
8462|Gamlitz|46.7203|15.5533
8463|Leutschach an der Weinstraße|46.6672|15.4689
8472|Straß in Steiermark|46.7272|15.6244
8473|Murfeld|46.7114|15.6983
8480|Mureck|46.7081|15.7747
8481|Sankt Veit in der Südsteiermark|46.7536|15.7211
8483|Deutsch Goritz|46.7508|15.8294
8484|Halbenrain|46.7500|15.9000
8490|Bad Radkersburg|46.6881|15.9881
8492|Halbenrain|46.7219|15.9467
8493|Klöch|46.7647|15.9656
8501|Lieboch|46.9742|15.3375
8502|Lannach|46.9461|15.3372
8503|Sankt Josef (Weststeiermark)|46.9092|15.3364
8504|Preding|46.8586|15.4097
8505|Sankt Nikolai im Sausal|46.8211|15.4519
8510|Stainz|46.8944|15.2672
8511|Sankt Stefan ob Stainz|46.9286|15.2589
8521|Wettmannstätten|46.8306|15.3872
8522|Groß Sankt Florian|46.8244|15.3186
8523|Deutschlandsberg|46.8153|15.2222
8524|Deutschlandsberg|46.8153|15.2222
8530|Deutschlandsberg|46.8153|15.2222
8541|Schwanberg|46.7583|15.2083
8542|Sankt Peter im Sulmtal|46.7500|15.2500
8543|Sankt Martin im Sulmtal|46.7500|15.3000
8544|Sankt Martin im Sulmtal|46.7167|15.3000
8551|Wies|46.7203|15.2719
8552|Eibiswald|46.6867|15.2472
8553|Eibiswald|46.7000|15.1500
8554|Eibiswald|46.6814|15.0783
8555|Wernersdorf|46.7159|15.2072
8561|Söding-Sankt Johann|47.0000|15.3000
8562|Mooskirchen|46.9817|15.2789
8563|Sankt Martin am Wöllmißberg|47.0014|15.1193
8564|Voitsberg|47.0444|15.1531
8570|Bärnbach|47.0714|15.1279
8571|Bärnbach|47.0714|15.1279
8572|Bärnbach|47.0714|15.1279
8573|Kainach bei Voitsberg|47.1364|15.0953
8580|Köflach|47.0667|15.0833
8581|Köflach|47.0667|15.0833
8582|Bärnbach|47.0714|15.1279
8583|Edelschrott|47.0216|15.0527
8584|Hirschegg-Pack|47.0211|14.9557
8591|Maria Lankowitz|47.0622|15.0653
8592|Maria Lankowitz|47.1000|14.9667
8593|Köflach|47.1313|15.0346
8600|Bruck an der Mur|47.4167|15.2833
8605|Kapfenberg|47.4446|15.2933
8607|Kapfenberg|47.4446|15.2933
8611|Tragöß-Sankt Katharein|47.4690|15.1414
8612|Tragöß-Sankt Katharein|47.5091|15.0751
8614|Breitenau am Hochlantsch|47.3923|15.4297
8616|Gasen|47.3833|15.5667
8621|Thörl|47.5195|15.2228
8622|Thörl|47.5159|15.1750
8623|Aflenz|47.5500|15.2500
8624|Aflenz|47.5500|15.3000
8625|Turnau|47.5578|15.3374
8630|Mariazell|47.7731|15.3164
8632|Mariazell|47.7417|15.3053
8634|Mariazell|47.6667|15.3333
8635|Mariazell|47.6510|15.3046
8636|Turnau|47.6204|15.2712
8641|Sankt Marein im Mürztal|47.4667|15.3667
8642|Sankt Lorenzen im Mürztal|47.4833|15.3667
8643|Kindberg|47.4667|15.4167
8644|Sankt Lorenzen im Mürztal|47.4959|15.3855
8650|Kindberg|47.5000|15.4500
8652|Kindberg|47.5000|15.4500
8653|Stanz im Mürztal|47.4507|15.5333
8654|Fischbach|47.4423|15.6497
8661|Sankt Barbara im Mürztal|47.5333|15.5167
8662|Krieglach|47.5446|15.5343
8663|Sankt Barbara im Mürztal|47.5781|15.4945
8664|Sankt Barbara im Mürztal|47.5957|15.5069
8665|Langenwang|47.5667|15.6167
8670|Krieglach|47.5473|15.5625
8671|St. Kathrein am Hauenstein|47.4894|15.6941
8672|St. Kathrein am Hauenstein|47.4894|15.6941
8673|Ratten|47.4856|15.7208
8674|Rettenegg|47.5269|15.7810
8680|Mürzzuschlag|47.6066|15.6723
8682|Langenwang|47.5667|15.6167
8684|Spital am Semmering|47.6135|15.7510
8685|Spital am Semmering|47.6135|15.7510
8691|Neuberg an der Mürz|47.6580|15.6564
8692|Neuberg an der Mürz|47.6667|15.5833
8693|Neuberg an der Mürz|47.6756|15.4915
8694|Neuberg an der Mürz|47.7549|15.4970
8700|Leoben|47.3765|15.0914
8704|Leoben|47.3765|15.0914
8707|Leoben|47.3765|15.0914
8709|Leoben-Lerchenfeld|47.3728|15.0867
8712|Proleb|47.4000|15.1333
8713|Sankt Stefan ob Leoben|47.3167|14.9783
8714|Kraubath an der Mur|47.3000|14.9333
8715|Sankt Margarethen bei Knittelfeld|47.2508|14.8955
8720|Sankt Margarethen bei Knittelfeld|47.2167|14.8667
8723|Kobenz|47.2500|14.8500
8724|Spielberg|47.2167|14.7833
8731|Gaal|47.2727|14.6700
8732|Seckau|47.2667|14.7833
8733|Sankt Marein-Feistritz|47.2833|14.8667
8734|Lobmingtal|47.1663|14.8117
8740|Zeltweg|47.1833|14.7500
8741|Weißkirchen in Steiermark|47.1541|14.7388
8742|Obdach|47.0667|14.6833
8743|Eppenstein|47.1283|14.7375
8750|Judenburg|47.1667|14.6667
8751|Judenburg - Murdorf|47.1733|14.6778
8753|Fohnsdorf|47.2080|14.6759
8754|Pöls-Oberkurzheim|47.2093|14.5670
8755|Sankt Peter ob Judenburg|47.1842|14.5864
8756|Sankt Georgen ob Judenburg|47.2074|14.4974
8761|Pöls-Oberkurzheim|47.2220|14.5737
8762|Pölstal|47.2500|14.4833
8763|Pölstal|47.2761|14.4839
8764|Pusterwald|47.3061|14.3756
8765|Pölstal|47.3659|14.4660
8770|Sankt Michael in Obersteiermark|47.3384|15.0178
8772|Traboch|47.3770|14.9865
8773|Kammern im Liesingtal|47.3924|14.9041
8774|Mautern in Steiermark|47.4000|14.8333
8775|Kalwang|47.4268|14.7544
8781|Wald am Schoberpaß|47.4494|14.6757
8782|Gaishorn am See|47.4746|14.5908
8783|Gaishorn am See|47.4909|14.5480
8784|Trieben|47.4857|14.4874
8785|Hohentauern|47.4333|14.4833
8786|Rottenmann|47.5253|14.3575
8790|Eisenerz|47.5333|14.8833
8792|Sankt Peter-Freienstein|47.3833|15.0167
8793|Trofaiach|47.4252|15.0068
8794|Vordernberg|47.4881|14.9944
8795|Radmer|47.5333|14.7500
8800|Unzmarkt-Frauenburg|47.2000|14.4500
8811|Scheifling|47.1504|14.4128
8812|Neumarkt in der Steiermark|47.0833|14.4000
8813|Sankt Lambrecht|47.0667|14.3000
8820|Neumarkt in der Steiermark|47.0660|14.4430
8822|Mühlen|47.0307|14.5085
8831|Niederwölz|47.1513|14.3748
8832|Oberwölz|47.2031|14.2818
8833|Teufenbach-Katsch|47.1308|14.3086
8841|Teufenbach-Katsch|47.1308|14.3086
8842|St. Peter am Kammersberg|47.1500|14.2333
8843|St. Peter am Kammersberg|47.1808|14.1843
8844|Schöder|47.1833|14.1000
8850|Murau|47.1106|14.1694
8852|Murau|47.1001|14.1972
8853|Ranten|47.1595|14.0835
8854|Krakau|47.1833|13.9833
8861|Sankt Georgen am Kreischberg|47.1072|14.0768
8862|Stadl-Predlitz|47.0833|13.9667
8863|Stadl-Predlitz|47.0833|13.9333
8864|Stadl-Predlitz|46.9608|13.8878
8900|Selzthal|47.5499|14.3120
8903|Lassing|47.5333|14.2500
8904|Ardning|47.5912|14.3637
8911|Admont|47.5754|14.4608
8912|Admont|47.5833|14.5167
8913|Admont|47.5754|14.4608
8920|Landl|47.6064|14.7450
8921|Landl|47.6500|14.7667
8922|Landl|47.6667|14.7833
8923|Landl|47.7000|14.8000
8924|Wildalpen|47.6500|14.9833
8931|Landl|47.6667|14.7167
8932|Sankt Gallen|47.6863|14.6171
8933|Sankt Gallen|47.6863|14.6171
8934|Altenmarkt bei Sankt Gallen|47.7233|14.6484
8940|Liezen|47.5667|14.2333
8942|Wörschach|47.5500|14.1500
8943|Aigen im Ennstal|47.5205|14.1453
8950|Stainach-Pürgg|47.5403|14.1182
8951|Stainach-Pürgg|47.5277|14.0749
8952|Irdning-Donnersbachtal|47.4897|14.0992
8953|Irdning-Donnersbachtal|47.4614|14.1297
8954|Mitterberg-Sankt Martin|47.4870|13.9720
8960|Öblarn|47.4594|13.9902
8961|Sölk|47.4167|13.9667
8962|Gröbming|47.4427|13.9012
8965|Aich|47.4167|13.8333
8966|Aich|47.4228|13.8215
8967|Haus|47.4100|13.7672
8970|Schladming|47.3929|13.6870
8971|Schladming|47.3652|13.6813
8972|Ramsau am Dachstein|47.4215|13.6554
8973|Schladming|47.4000|13.6167
8974|Radstadt|47.4046|13.5738
8982|Bad Mitterndorf|47.5487|14.0131
8983|Bad Mitterndorf|47.5556|13.9319
8984|Bad Mitterndorf|47.5667|13.8500
8990|Bad Aussee|47.6100|13.7824
8992|Altaussee|47.6384|13.7628
8993|Grundlsee|47.6167|13.8167
9000|Villach|46.6103|13.8558
9010|Klagenfurt am Wörthersee|46.6247|14.3053
9020|Klagenfurt am Wörthersee|46.6363|14.3397
9021|Klagenfurt am Wörthersee Postfach|46.6330|14.3299
9022|Klagenfurt am Wörthersee|46.6247|14.3053
9023|Klagenfurt am Wörthersee|46.6247|14.3053
9025|Klagenfurt am Wörthersee|46.6247|14.3053
9026|Klagenfurt am Wörthersee|46.6247|14.3053
9027|Klagenfurt am Wörthersee|46.6247|14.3053
9028|Klagenfurt am Wörthersee|46.6247|14.3053
9033|Klagenfurt|46.6247|14.3053
9034|Klagenfurt|46.6247|14.3053
9061|Klagenfurt am Wörthersee|46.6676|14.2384
9062|Moosburg|46.6575|14.1747
9063|Maria Saal|46.6808|14.3486
9064|Magdalensberg|46.5707|14.2959
9065|Ebenthal in Kärnten|46.5895|14.4140
9071|Köttmannsdorf|46.5614|14.2339
9072|Ludmannsdorf|46.5486|14.1452
9073|Köttmannsdorf|46.5777|14.2801
9074|Keutschach am See|46.5885|14.1780
9081|Maria Wörth|46.6132|14.1711
9082|Maria Wörth|46.6164|14.1631
9100|Völkermarkt|46.6622|14.6344
9102|Völkermarkt|46.7000|14.5667
9103|Diex|46.7443|14.6170
9111|Völkermarkt|46.6833|14.6500
9112|Griffen|46.7044|14.7328
9113|Ruden|46.6583|14.7764
9121|Völkermarkt|46.6333|14.5333
9122|St. Kanzian am Klopeiner See|46.6037|14.5730
9123|Gallizien|46.5761|14.5215
9125|Eberndorf|46.6219|14.6364
9130|Poggersdorf|46.6500|14.4500
9131|Grafenstein|46.6139|14.4672
9132|Gallizien|46.5500|14.5167
9133|Sittersdorf|46.5444|14.6058
9135|Eisenkappel-Vellach|46.4884|14.5914
9141|Eberndorf|46.5914|14.6436
9142|Globasnitz|46.5584|14.6966
9143|Feistritz ob Bleiburg|46.5708|14.7650
9150|Bleiburg|46.5983|14.7954
9155|Neuhaus|46.6333|14.8833
9161|Maria Rain|46.5539|14.2956
9162|Ferlach|46.5333|14.2500
9163|Ferlach|46.4924|14.2629
9170|Ferlach|46.5269|14.3019
9171|Ferlach|46.5269|14.3019
9172|Zell-Pfarre|46.4722|14.3889
9173|St. Margareten im Rosental|46.5311|14.4227
9181|Feistritz im Rosental|46.5225|14.1683
9182|St. Jakob im Rosental|46.5322|14.0905
9183|St. Jakob im Rosental|46.5381|14.0340
9184|St. Jakob im Rosental|46.5478|14.0572
9201|Pörtschach am Wörther See|46.6364|14.1464
9210|Pörtschach am Wörther See|46.6364|14.1464
9212|Techelsberg am Wörther See|46.6497|14.0895
9220|Velden am Wörther See|46.6130|14.0413
9231|Velden am Wörther See|46.6500|14.0000
9232|Rosegg|46.5883|14.0172
9241|Wernberg|46.6167|13.9333
9300|Frauenstein|46.8142|14.2942
9311|Frauenstein|46.8235|14.3162
9312|Mölbling|46.8385|14.3819
9313|St. Georgen am Längsee|46.7806|14.4303
9314|St. Georgen am Längsee|46.7754|14.4666
9321|Kappel am Krappfeld|46.8386|14.4864
9322|Micheldorf|46.9140|14.4306
9323|Neumarkt in der Steiermark|47.0219|14.4139
9330|Althofen|46.8730|14.4745
9334|Guttaring|46.8854|14.5107
9335|Hüttenberg|46.9167|14.5833
9341|Straßburg|46.9113|14.3343
9342|Gurk|46.8739|14.2917
9343|Weitensfeld im Gurktal|46.8886|14.2133
9344|Weitensfeld im Gurktal|46.8446|14.1963
9345|Weitensfeld im Gurktal|46.8667|14.1667
9346|Glödnitz|46.8740|14.1191
9360|Friesach|46.9553|14.4058
9361|Friesach|46.9845|14.3288
9362|Metnitz|46.9791|14.2526
9363|Metnitz|46.9806|14.2167
9371|Brückl|46.7517|14.5367
9372|Eberstein|46.8081|14.5600
9373|Klein St. Paul|46.8232|14.5418
9374|Klein St. Paul|46.8714|14.5436
9375|Hüttenberg|46.9414|14.5500
9376|Hüttenberg|46.9563|14.5848
9400|Wolfsberg|46.8406|14.8442
9402|Wolfsberg, Kärnten|46.8481|14.8329
9411|Wolfsberg|46.8333|14.7833
9412|Wolfsberg|46.8708|14.7808
9413|Frantschach-St. Gertraud|46.8667|14.8833
9421|St. Andrä|46.7667|14.9000
9422|St. Andrä|46.7435|14.8873
9423|St. Georgen im Lavanttal|46.7399|14.9598
9431|Wolfsberg|46.8406|14.8442
9433|St. Andrä|46.7620|14.7986
9441|Wolfsberg|46.9167|14.8833
9451|Preitenegg|46.9400|14.9258
9461|Wolfsberg|46.9167|14.8000
9462|Bad St. Leonhard im Lavanttal|46.9628|14.7917
9463|Reichenfels|47.0072|14.7442
9470|St. Paul im Lavanttal|46.7088|14.8461
9472|Lavamünd|46.6667|14.9500
9473|Lavamünd|46.6402|14.9473
9500|Villach|46.6127|13.8464
9501|Villach|46.6103|13.8558
9503|Villach|46.6103|13.8558
9504|Villach|46.6013|13.8224
9507|Villach|46.6103|13.8558
9509|Zauchen|46.6167|13.9000
9520|Treffen am Ossiacher See|46.6649|13.9212
9521|Treffen am Ossiacher See|46.6666|13.8744
9523|Villach|46.6381|13.8778
9524|Villach|46.6167|13.8833
9530|Bad Bleiberg|46.6255|13.6810
9531|Nötsch im Gailtal|46.6044|13.6147
9535|Schiefling am Wörthersee|46.5917|14.0982
9536|Velden am Wörther See|46.5667|14.0333
9541|Treffen am Ossiacher See|46.7000|13.8167
9542|Afritz am See|46.7293|13.7903
9543|Arriach|46.7292|13.8505
9544|Feld am See|46.7764|13.7478
9545|Radenthein|46.8006|13.7117
9546|Bad Kleinkirchheim|46.8165|13.7831
9551|Steindorf am Ossiacher See|46.6911|13.9711
9552|Steindorf am Ossiacher See|46.6983|14.0092
9554|St. Urban|46.7616|14.1650
9555|Glanegg|46.7226|14.1989
9556|Liebenfels|46.7378|14.2867
9560|Feldkirchen in Kärnten|46.7237|14.0958
9562|Himmelberg|46.7567|14.0306
9563|Gnesau|46.7812|13.9555
9564|Reichenau|46.8226|13.8562
9565|Reichenau|46.8492|13.8872
9566|Feldkirchen|46.7237|14.0958
9570|Ossiach|46.6743|13.9836
9571|Albeck|46.8333|14.0333
9572|Deutsch-Griffen|46.8667|14.0667
9580|Villach|46.6000|13.9167
9581|Finkenstein am Faaker See|46.5664|13.9614
9582|Finkenstein am Faaker See|46.5513|13.9281
9583|Finkenstein am Faaker See|46.5681|13.9097
9584|Finkenstein am Faaker See|46.5615|13.8709
9585|Villach|46.6013|13.8224
9586|Villach|46.5656|13.7861
9587|Villach|46.5697|13.7581
9601|Arnoldstein|46.5461|13.7100
9602|Hohenthurn|46.5577|13.6604
9611|Nötsch im Gailtal|46.5909|13.6141
9612|Nötsch im Gailtal|46.6114|13.5904
9613|Feistritz an der Gail|46.5775|13.6067
9614|St. Stefan im Gailtal|46.5992|13.5377
9615|Hermagor-Pressegger See|46.6292|13.4729
9620|Hermagor-Pressegger See|46.6333|13.3500
9622|Gitschtal|46.6833|13.2667
9623|St. Stefan im Gailtal|46.6186|13.5206
9624|Hermagor-Pressegger See|46.6167|13.4167
9631|Hermagor-Pressegger See|46.6277|13.2527
9632|Kirchbach|46.6416|13.1845
9633|Kirchbach|46.6493|13.1535
9634|Kirchbach|46.6473|13.1214
9635|Dellach|46.6617|13.0797
9640|Kötschach-Mauthen|46.6653|12.9986
9651|Kötschach-Mauthen|46.6832|12.9282
9652|Lesachtal|46.6837|12.8833
9653|Lesachtal|46.6928|12.8186
9654|Lesachtal|46.7000|12.7667
9655|Lesachtal|46.7000|12.7333
9701|Spittal an der Drau|46.7647|13.5846
9702|Ferndorf|46.7365|13.6266
9710|Paternion|46.6877|13.6791
9711|Paternion|46.7142|13.6361
9712|Fresach|46.7156|13.6908
9713|Stockenboi|46.7317|13.5725
9714|Stockenboi|46.7261|13.5231
9721|Weißenstein|46.6858|13.7303
9722|Weißenstein|46.6667|13.7606
9751|Sachsenburg|46.8292|13.3550
9753|Kleblach-Lind|46.7709|13.3458
9754|Steinfeld|46.7581|13.2493
9761|Greifenburg|46.7503|13.1798
9762|Weißensee|46.7200|13.2828
9771|Berg im Drautal|46.7489|13.1311
9772|Dellach im Drautal|46.7447|13.0897
9773|Irschen|46.7569|13.0253
9781|Oberdrauburg|46.7431|12.9703
9782|Nikolsdorf|46.7858|12.9133
9800|Spittal an der Drau|46.8000|13.5000
9802|Spittal an der Drau|46.8000|13.5000
9805|Baldramsdorf|46.8011|13.4533
9811|Lendorf|46.8353|13.4303
9812|Lurnfeld|46.8451|13.3936
9813|Lurnfeld|46.8993|13.2726
9814|Mühldorf|46.8603|13.3536
9815|Reißeck|46.8781|13.3114
9816|Reißeck|46.9000|13.2667
9821|Obervellach|46.9367|13.2042
9822|Mallnitz|46.9917|13.1678
9831|Flattach|46.9386|13.1344
9832|Stall|46.8906|13.0369
9833|Rangersdorf|46.8600|12.9492
9841|Winklern|46.8736|12.8747
9842|Mörtschach|46.9239|12.9178
9843|Großkirchheim|46.9753|12.8907
9844|Heiligenblut am Großglockner|47.0333|12.8667
9851|Seeboden am Millstätter See|46.8333|13.4833
9852|Trebesing|46.8864|13.5103
9853|Gmünd in Kärnten|46.9167|13.5333
9854|Malta|46.9542|13.5075
9861|Krems in Kärnten|46.9243|13.5883
9862|Krems in Kärnten|46.9667|13.6333
9863|Rennweg am Katschberg|47.0301|13.6133
9871|Seeboden am Millstätter See|46.8365|13.5224
9872|Millstatt am See|46.8078|13.5806
9873|Radenthein|46.7805|13.6574
9900|Lienz|46.8289|12.7690
9903|Oberlienz|46.8472|12.7314
9904|Thurn|46.8506|12.7686
9905|Gaimberg|46.8513|12.7934
9906|Lavant|46.7989|12.8381
9907|Tristach|46.8161|12.7897
9908|Amlach|46.8164|12.7636
9909|Leisach|46.8125|12.7486
9911|Assling|46.7897|12.6428
9912|Anras|46.7739|12.5608
9913|Abfaltersbach|46.7572|12.5283
9918|Strassen|46.7539|12.4842
9919|Heinfels|46.7547|12.4667
9920|Sillian|46.7528|12.4211
9931|Außervillgraten|46.7875|12.4314
9932|Innervillgraten|46.8119|12.3747
9941|Kartitsch|46.7289|12.5008
9942|Obertilliach|46.7106|12.6144
9943|Untertilliach|46.7035|12.6776
9951|Ainet|46.8660|12.6897
9952|St. Johann im Walde|46.9108|12.6226
9954|Schlaiten|46.8794|12.6542
9961|Hopfgarten in Defereggen|46.9192|12.5364
9962|St. Veit in Defereggen|46.9246|12.4115
9963|St. Jakob in Defereggen|46.9178|12.3343
9971|Matrei in Osttirol|47.0000|12.5333
9972|Virgen|47.0037|12.4574
9974|Prägraten am Großvenediger|47.0174|12.3737
9981|Kals am Großglockner|46.9935|12.6382
9990|Nußdorf-Debant|46.8438|12.8108
9991|Dölsach|46.8283|12.8453
9992|Iselsberg-Stronach|46.8381|12.8494`

/** Anzahl der Einträge — als Zusage geprüft (s. Test), damit ein verstümmelter Datenblock auffällt. */
export const AT_POSTAL_CODE_COUNT = 2501

let index: Map<string, PostalCodeCentroid> | null = null

function getIndex(): Map<string, PostalCodeCentroid> {
  if (index) return index
  const map = new Map<string, PostalCodeCentroid>()
  for (const line of AT_POSTAL_CODES.split('\n')) {
    if (!line) continue
    const [postalCode, name, lat, lon] = line.split('|')
    if (!postalCode || !name || !lat || !lon) continue
    map.set(postalCode, { postalCode, name, lat: Number(lat), lon: Number(lon) })
  }
  index = map
  return map
}

/**
 * Normalisiert eine eingetippte PLZ auf die vierstellige Form.
 *
 * Angenommen werden die Schreibweisen, die auf österreichischen Rechnungen und Briefköpfen
 * vorkommen: `1100`, `A-1100`, `AT 1100`, mit Leerzeichen. Alles andere ergibt `null` — und `null`
 * heisst „das ist keine österreichische PLZ", nicht „irgendwas daraus machen".
 */
export function normalizePostalCode(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/^A[T]?[\s-]*/, '').replace(/\s+/g, '')
  return /^\d{4}$/.test(cleaned) ? cleaned : null
}

/**
 * PLZ → Koordinate. **Kein Treffer ⇒ `null`, niemals eine geratene Koordinate** (s. Kopf).
 */
export function lookupPostalCodeCentroid(postalCode: string): PostalCodeCentroid | null {
  const key = normalizePostalCode(postalCode)
  if (!key) return null
  return getIndex().get(key) ?? null
}
