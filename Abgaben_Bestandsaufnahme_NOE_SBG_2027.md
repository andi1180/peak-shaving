# Bestandsaufnahme: Abgaben für Netz NÖ, Salzburg Netz und 2027

> **Phase 1 — Recherche, kein Code.** Stand 24.09.2026, alle Quellen am **24.09.2026** abgerufen.
> Phase 2 (Eintragen/Umbau) erst nach Freigabe durch Andreas.
> Code-Stand: `main` @ `58348a3`.

## 0. Kurzfassung

| # | Befund | Folge |
|---|---|---|
| 1 | **Netz NÖ: keine Gebrauchsabgabe** auf der Rechnung (Preisblatt B410, E-Control-Verzeichnis, NÖ GAG 1973) | Eintrag `rate: 0` mit Quelle möglich — **kein Blocker** |
| 2 | **Salzburg Netz: Gebrauchsabgabe JA, aber in ct/kWh je Netzebene**, nicht als Prozentsatz | Heutiger Datentyp (`gebrauchsabgabeRate`, Anteil) kann sie **nicht abbilden** — Typerweiterung nötig |
| 3 | ⚠ **Wien: Gebrauchsabgabe fällt AUCH auf die Energie- und Lieferanten-Einnahmen an** (GAG Tarif C Post 1a) | Hinterlegte Sätze (6 %/7 %) stimmen, die **Bemessungsgrundlage „nur Netzpreis" ist falsch** |
| 4 | ⚠ **Elektrizitätsabgabe 2026: 0,10 ct gilt NUR für Haushalte** (natürliche Person + Lastprofil H0/HA/HF); **alle anderen 0,82 ct** (ElAbgG § 7 Abs. 16) | Heute rechnet **jeder** Kunde 2026 mit 0,10 ct — für Betriebe **zu niedrig** |
| 5 | EAG-Förderbeitrag und -Pauschale sind **bundesweit einheitlich je Netzebene**; die hinterlegten Werte stimmen mit den Verordnungen überein | Positiv bestätigt; NÖ/Salzburg rechnen damit korrekt |
| 6 | 2027: Elektrizitätsabgabe **1,5 ct nach geltendem Recht**; Förderpauschale **verordnet**; Förderbeitrag **nicht verordnet** (erwartet Mitte/Ende Dez. 2026); Gebrauchsabgabe Wien **keine Änderung kundgemacht**; Salzburg **nicht belegt** | 2027 bleibt ohne Förderbeitrag blockiert |
| 7 | Netzentgelte 2027: **neues Regime** (ElWG § 135: SNE-G-V + Tarifverordnung); Grundsatzverordnung nur als Begutachtungsentwurf, Tarifverordnung nicht einmal im Entwurf | 2027 scheitert **ohnehin zuerst an der Netzentgelt-Seite**, unabhängig von den Abgaben |

Die Befunde 3 und 4 betreffen **heute laufende Rechnungen**, nicht nur NÖ, Salzburg oder 2027.

---

## 1. Code: was `levies.ts` heute rechnet

### 1.1 Struktur

- Übergabetyp `LevyPeriodInput` ([levies.ts:32-74](packages/shared/src/levies.ts#L32-L74)): je Zeitraum Elektrizitätsabgabe (ct/kWh), EAG-Förderbeitrag (ct/kWh + Grundpreis mit Einheit), EAG-Pauschale (€/Jahr) und `gebrauchsabgabeRate` als **Anteil**, laut Kommentar „AUSSCHLIESSLICH auf den Netto-NETZPREIS“ ([:68-73](packages/shared/src/levies.ts#L68-L73)).
- `buildLevySchedule(operatorId, netzebene, from, to, meteringVariant)` ([:359-425](packages/shared/src/levies.ts#L359-L425)) schneidet an allen Gültigkeitsgrenzen. **Ein Abschnitt, dem auch nur eine der vier Quellen fehlt, entfällt** ([:405-409](packages/shared/src/levies.ts#L405-L409)).
- Aufrufer, beide gleich: öffentlicher Rechner [apps/website/lib/tariff-pricing.ts:68-78](apps/website/lib/tariff-pricing.ts#L68-L78) und Wizard [apps/web/lib/admin/analysis-tariff-inputs.ts:332-342](apps/web/lib/admin/analysis-tariff-inputs.ts#L332-L342).

### 1.2 Hinterlegte Sätze

| Abgabe | Schlüssel | Zeiträume | Zeile |
|---|---|---|---|
| Elektrizitätsabgabe | bundesweit, **ohne Kundenart** | 2025: 1,5 ct · 2026: 0,10 ct · **ab 2027: nichts** | [:139-159](packages/shared/src/levies.ts#L139-L159) |
| EAG-Pauschale | Netzebene 3–7 | 2025-01-01 … **2027-12-31** | [:203-209](packages/shared/src/levies.ts#L203-L209) |
| EAG-Förderbeitrag | Netzebene + Messvariante | 2025, 2026 · **ab 2027: nichts** | [:252-281](packages/shared/src/levies.ts#L252-L281) |
| Gebrauchsabgabe | **Netzbetreiber**, nur `wiener_netze` | 2025: 6 % · 01.01.–28.02.2026: 6 % · ab 01.03.2026: 7 % (offen) | [:293-323](packages/shared/src/levies.ts#L293-L323) |

### 1.3 Wie der Satz angewendet wird

- Arbeitspreis je Intervall: `energie + netz × (1 + Gebrauchsabgabe) + Elektrizitätsabgabe + EAG-ct/kWh` ([tou.ts:345-351](packages/engine/src/simulation/tou.ts#L345-L351)). Die Energie steht **ausserhalb** des Gebrauchsabgabe-Faktors.
- Fixposten: Gebrauchsabgabe nur auf Netz-Grundpreis + Messpreis ([monthly-tariff-comparison.ts:295-297](packages/engine/src/simulation/monthly-tariff-comparison.ts#L295-L297)). Die Lieferanten-Grundgebühr ist bewusst ausgenommen ([:298](packages/engine/src/simulation/monthly-tariff-comparison.ts#L298)).
- Der Leistungspreis-Pfad (`packages/engine/src/tariff/strategy.ts`) liest **keinen** Abgabensatz. In Wien fehlt der Leistungspreis-Ersparnis damit die Gebrauchsabgabe auf das Netzentgelt (s. §3.3).

### 1.4 Warum NÖ und Salzburg scheitern

`GEBRAUCHSABGABE_BY_OPERATOR['netz_noe' | 'salzburg_netz']` ist `undefined` → `?? []` ([:387](packages/shared/src/levies.ts#L387), [:408](packages/shared/src/levies.ts#L408)). Damit ist `gebrauch` `null`, der Abschnitt entfällt ([:409](packages/shared/src/levies.ts#L409)), und `periods` ist leer. Der Rechenkern findet je Intervall keinen Zeitraum ([tou.ts:275](packages/engine/src/simulation/tou.ts#L275), [:280-282](packages/engine/src/simulation/tou.ts#L280-L282)) und verweigert den gesamten Tarifvergleich mit `side: 'levy', kind: 'gap'` ([tou.ts:310-321](packages/engine/src/simulation/tou.ts#L310-L321)).

**Die EAG-Sätze sind dabei nicht das Problem.** Sie sind nur nach Netzebene geschlüsselt und gelten für NÖ/Salzburg gleichermassen (s. §2.4).

### 1.5 Warum 2027 scheitert

Für 2027 fehlen **Elektrizitätsabgabe** ([:151-158](packages/shared/src/levies.ts#L151-L158), `validUntil: '2026-12-31'`) und **EAG-Förderbeitrag** (jeder Eintrag ist auf sein Jahr befristet, [:238-239](packages/shared/src/levies.ts#L238-L239)). Pauschale (bis 2027-12-31) und Gebrauchsabgabe Wien (offen) wären vorhanden.

⚠ Unabhängig davon meldet `tou.ts` die **Netzentgelt-Lücke vor der Abgaben-Lücke** ([tou.ts:295-307](packages/engine/src/simulation/tou.ts#L295-L307)). Solange keine `grid_tariffs`-Zeile für 2027 existiert, sieht der Kunde die Netzentgelt-Meldung, nicht die Abgaben-Meldung.

### 1.6 Veraltete Dokumentation (nicht korrigiert, nur gemeldet)

[DEPLOYMENT.md:1441-1443](DEPLOYMENT.md#L1441-L1443) sagt „Das Kalenderjahr 2025 rechnet weiterhin nicht“. Das ist seit **#312** überholt: Elektrizitätsabgabe und Gebrauchsabgabe Wien 2025 sind hinterlegt. Die Tabelle dort ([:1413-1418](DEPLOYMENT.md#L1413-L1418)) führt die 2026er Elektrizitätsabgabe ebenfalls ohne Haushaltsbedingung. Beides wird in Phase 2 mitgezogen.

---

## 2. Rechtslage

Einstufung: **belegt** = Primärquelle mit Wortlaut · **nicht belegt** = keine Primärquelle auffindbar.

### 2.1 Niederösterreich (Netz NÖ) — Gebrauchsabgabe: **wird nicht erhoben** (belegt, mit Einschränkung)

| Quelle | Fundstelle | Aussage |
|---|---|---|
| Netz NÖ, „Informations- und Preisblatt Strom – Systemnutzungsentgelte, Förderbeiträge, Steuern und Abgaben – Ausgabe 01.01.2026“ (B410-20251219) | [PDF](https://netz-noe.at/getContentAsset/514ea02f-7393-40f3-bcd9-dd6f77b47719/0ee16eb8-9692-4f25-b8a4-d007b35915a4/B410_Systemnutzungstarife-Strom.pdf?language=de) | Unter „Steuern und Abgaben“ stehen ausser den EAG-Posten ausschliesslich: „Elektrizitätsabgabe – Gem. Elektrizitätsabgabegesetz … Alle Ebenen 0,82 / Für Haushaltskunden 0,1“. **Keine Gebrauchsabgabe.** |
| NÖ Gebrauchsabgabegesetz 1973, LGBl. 3700, zuletzt LGBl. Nr. 101/2022 | [RIS LrNO 20000766](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrNO&Gesetzesnummer=20000766), Tarif Z 6, § 9 Abs. 1 und 4, § 10 Abs. 1 | Keine Abgabe auf den Energiebezug. Tarif Z 6 ist eine Jahresabgabe für Leitungssysteme „je begonnenen hundert Längenmetern höchstens € 28,-“. Sie schuldet der Träger der Gebrauchserlaubnis (Leitungsbetreiber), nicht der Kunde. |
| E-Control, Verzeichnis „Netzbetreiber/Lieferant STROM – Gemeinde – Berechnung“, Stand 01.03.2026 | [PDF](https://www.e-control.at/documents/1785851/1811582/Gebrauchsabgabe_Oesterreich_Strom_Gas_17_10_2019_Web.pdf/a736a694-c4f2-1da9-392b-d79e8f6c9cf6) (Dateiname 2019, Inhalt 2026) | Netz NÖ ist nicht aufgeführt. Aufgeführt sind drei **kleine örtliche Netzbetreiber** in NÖ mit ct/kWh-Sätzen: Göstling an der Ybbs 0,1013 · Hollenstein an der Ybbs 0,1013 · Kleinneusiedl (Polsterer Kerres Ruttin) 0,1059. |

**Einschränkungen:**
- Das E-Control-Verzeichnis „umfasst nur jene Gebrauchsabgaben, die nicht schon in den Netzkosten inkludiert sind“. Eine längenbezogene Abgabe nach Tarif Z 6 wäre allenfalls in den regulierten Netzkosten enthalten, ist dann aber **bereits im Netzentgelt** und kein eigener Posten.
- Belegt ist die **Ausgabe 01.01.2026**. Für 2025 stützt sich „0“ auf das seit 2022 unveränderte NÖ GAG; das Preisblatt 2025 wurde **nicht** abgerufen → in Phase 2 nachziehen.

### 2.2 Land Salzburg (Salzburg Netz) — Gebrauchsabgabe: **wird erhoben, in ct/kWh** (belegt)

**Rechtsgrundlage:** Salzburger Gebrauchsabgabegesetz, StF LGBl. Nr. 21/1992, zuletzt LGBl. Nr. 40/2022 ([RIS LrSbg 10000685](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrSbg&Gesetzesnummer=10000685)):
- § 1 Abs. 1: Die Gemeinden sind ermächtigt, die Abgabe „durch Beschluß der Gemeindevertretung (in der Stadt Salzburg des Gemeinderates)“ auszuschreiben. Abgabepflichtig sind gemeindeeigene Versorgungsunternehmen (≥ 50 % Gemeindeanteil, nach Verschmelzung ≥ 25 %, § 1 Abs. 3).
- § 2 Abs. 1 und 2: Bemessungsgrundlage sind die „Roheinnahmen des Unternehmens … im Gebiet der die Abgabe ausschreibenden Gemeinde“, höchstens „6 v.H.“. Das ist das Verhältnis Gemeinde ↔ Unternehmen, **nicht** der Kundensatz.
- § 3b Abs. 2 und 3: bei Elektrizität „zusätzlich zu den Systemnutzungstarifen … weiter zu verrechnen, dass sich zumindest eine annähernd gleichmäßige Verteilung auf die einzelnen Netzebenen ergibt“, über „Aufschläge je Leistungseinheit“, die „zu veröffentlichen“ sind.

**Sätze 2026** — Salzburg Netz, „Zuschläge zum Systemnutzungsentgelt Strom – 01/2026“, gültig ab 01.01.2026, netto ([PDF](https://www.salzburgnetz.at/content/dam/salzburgnetz/dokumente/stromnetz/Strom-Zuschlaege-Systemnnutzung.pdf)):

| NE 3 | NE 4 | NE 5 | NE 6 | NE 7 (alle Varianten) |
|---|---|---|---|---|
| 0,0562 ct/kWh | 0,0993 ct/kWh | 0,1558 ct/kWh | 0,2907 ct/kWh | 0,3789 ct/kWh |

Fussnote 3: „Die Gebrauchsabgabe wird in Cent pro verbrauchter Kilowattstunde berechnet und wird an die öffentliche Hand abgeführt.“

**Bemessung für den Rechner:** ein **fester ct/kWh-Aufschlag je Netzebene auf die bezogene Energie**. Er fällt nicht auf Grundpreis, Messpreis oder Leistungspreis an und ist kein Prozentsatz.

**Geltungsbereich:** Laut E-Control-Verzeichnis (s. o.) gilt er für Salzburg Netz im Netzgebiet „Bundesland Salzburg sowie PLZ 4824, 4825, 4894, 5120, …“, also **netzweit**, nicht nur in der Stadt Salzburg. Ausnahme: Die **Elektrizitätswerk Bad Hofgastein GmbH** ist ein eigener Netzbetreiber mit 0,4893 ct/kWh; im Rechner ist sie kein `salzburg_netz`-Fall.

**Nicht belegt:**
- **Die Sätze 2025.** Salzburg Netz schreibt in der „Info Netzentgelte, Steuern & Abgaben Strom, Stand 1. Jänner 2026“ ([PDF](https://www.salzburgnetz.at/content/dam/salzburgnetz/dokumente/rechtliches/Info_Netzentgelte-Steuern-Abgaben_Strom.pdf)), die Gebrauchsabgabe sei „im Vergleich zum Vorjahr um 11 % in jeder Netzebene gesenkt“ worden. **Die 2025er Werte daraus zurückzurechnen wäre eine Schätzung** → das Preisblatt 01/2025 muss beschafft werden.
- Die ausschreibende Gemeindeverordnung (Stadt Salzburg) wurde nicht gefunden. Das Preisblatt des Netzbetreibers ist dennoch die massgebliche Quelle für den weiterverrechneten Satz (§ 3b Abs. 3 verlangt dessen Veröffentlichung).

### 2.3 Wien — Positivkontrolle der hinterlegten Sätze

**Rechtsgrundlage:** Gebrauchsabgabegesetz 1966, LGBl. für Wien Nr. 20/1966 ([RIS LrW 20000131](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrW&Gesetzesnummer=20000131), Fassung vom 24.09.2026):
- § 10 Abs. 1 lit. b: „in Hundertsätzen von allen Einnahmen, die im Zusammenhang mit der Gebrauchserlaubnis erzielt werden, unter Ausschluss der Umsatzsteuer, der Elektrizitätsabgabe, der Ökostrompauschale, des Ökostromförderbeitrages und der Erdgasabgabe“.
- **Tarif C Post 1** (Netzbetreiber): „für Unternehmen, zu deren bestimmungsgemäßer Betriebsführung eine ausgedehntere Inanspruchnahme von Grundstücken erforderlich ist (zB bei … Freileitungen, unterirdischen Einbauten …), 7 vH der Einnahmen“.
- **Tarif C Post 1a** (Lieferant): „für Unternehmen, denen eine Einrichtung, die Gegenstand der Gebrauchserlaubnis nach Tarif C, Post 1, ist, zum Gebrauch überlassen wird, 7 vH der unter Verwendung der überlassenen Einrichtung erzielten Einnahmen“.
- § 9 Abs. 4a: Der Endkunde ist für die an ihn erbrachten Lieferungen Gesamtschuldner.
- **6 % → 7 %:** Novelle **LGBl. für Wien Nr. 3/2026** vom 24.02.2026, Inkrafttreten nach § 18 Abs. 18 Z 1 „mit dem der Kundmachung folgenden Monatsersten“, also am **01.03.2026**. Gegenprobe über die RIS-Fassung vom 28.02.2026: C 1 und C 1a jeweils „6 vH“.
- **Geltungsbereich:** § 1 Abs. 1, „öffentlichem Grund in der Gemeinde“, also nur die Gemeinde Wien.

**Bestätigende Anbieter-Quellen:**
- Wiener Netze, WN-EX0106 „Steuern und Abgaben für Netzleistungen“, Vers. 2/2026 ([Dokument](https://www.wienernetze.at/o/document/wn_ex0106_steuernundabgaben_202603_bf)): „Für KundInnen aus Wien beträgt die Abgabe bis 28.2.2026 6 Prozent und ab 1.3.2026 7 Prozent vom Netto-Netzpreis.“ Das Blatt beschreibt nur, was der **Netzbetreiber** einhebt.
- Wien Energie, Informations- und Preisblatt Business (Nachtstrom), Vertragsbeginn Juli–Sept. 2026 ([Dokument](https://dokumente.wienenergie.at/link/nachtstrom-business/)): „Darin nicht enthalten und von Ihnen zusätzlich zu bezahlen sind 7% Gebrauchsabgabe (für Kund*innen mit Netzanschluss in Wien) sowie 20% USt. Darüber hinaus haben Sie die von der Wiener Netze GmbH vorgeschriebenen Netzkosten inkl. 7% Gebrauchsabgabe … zu bezahlen.“

**Ergebnis der Positivkontrolle:**

| Hinterlegt | Urteil |
|---|---|
| 6 % 2025 und 01.01.–28.02.2026, 7 % ab 01.03.2026 | ✅ **bestätigt** (Netz UND Energie, derselbe Satz) |
| Netzseite: Netznutzung, Netzverlust, Netz-Grundpreis, Messpreis | ✅ bestätigt |
| **„AUSSCHLIESSLICH auf den Netto-Netzpreis … nicht auf Arbeitspreis, Lieferanten-Grundgebühr“** ([levies.ts:68-73](packages/shared/src/levies.ts#L68-L73), [:317-320](packages/shared/src/levies.ts#L317-L320)) | ❌ **zu korrigieren.** Nach Tarif C Post 1a fällt derselbe Satz auf die Netto-Einnahmen des **Lieferanten** an: Energie-Arbeitspreis **und** Lieferanten-Grundgebühr. Die **Urbanz-Rechnung 2024/25** (6 % auf Netz + Energie) stimmt mit dem Gesetz überein. |
| Nicht auf Elektrizitätsabgabe/EAG | ✅ bestätigt über § 10 Abs. 1 lit. b. Dass die heutigen EAG-Beiträge unter „Ökostrompauschale/-förderbeitrag“ fallen, ist **Auslegung**: der Gesetzestext nennt noch die alten Bezeichnungen. |
| Elektrizitätsabgabe 2025 1,50 ct/kWh | ✅ bestätigt (s. §2.4) |
| Schlüssel `wiener_netze` = Wien | ⚠ **zu eng gefasst.** Die Abgabe gilt nur für Anschlüsse **in der Gemeinde Wien** („Für KundInnen aus Wien“, „mit Netzanschluss in Wien“). Wiener Netze versorgt auch Teile NÖ; dort fällt die Wiener Abgabe **nicht** an. Ob dort eine NÖ-Gemeindeabgabe anfällt: **nicht belegt.** |

**Woher der Fehler kommt:** Die Quelle im Code (WN-EX0106) ist ein **Netzbetreiber**-Dokument und sagt nur, was Wiener Netze einhebt. Die Energie-Seite hebt der Lieferant nach einer eigenen Tarifpost ein, und die ist in keinem Netzbetreiber-Blatt zu sehen.

**aWATTar:** Die Tarifseite HOURLY erwähnt die Gebrauchsabgabe nicht. Dass aWATTar sie auf der Rechnung ausweist, ist **nicht belegt**. Gesetzlich fällt sie über C 1a für jeden Lieferanten an, der über das Wiener Netz liefert; das ist Lesart des Wortlauts, bestätigt durch die Praxis von Wien Energie.

### 2.4 Bundesabgaben

#### Elektrizitätsabgabe (ElAbgG, BGBl. Nr. 201/1996, [RIS 10005027](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10005027))

| Zeitraum | Satz | Fundstelle | Stand |
|---|---|---|---|
| 2025 | 1,5 ct/kWh | § 4 Abs. 2 „0,015 Euro je kWh“. Die Absenkung nach § 7 Abs. 11 galt nur „vor dem 1. Jänner 2025“ | ✅ belegt |
| 2026, **Haushalte** | 0,1 ct/kWh | § 7 Abs. 16 Z 1, eingefügt durch **BGBl. I Nr. 95/2025** (23.12.2025): „0,001 Euro je kWh für die Lieferung von elektrischer Energie an natürliche Personen, die … die Voraussetzungen gemäß § 4 Abs. 1 Stromkostenzuschussgesetz … erfüllen“ | ✅ belegt |
| 2026, **alle anderen** | **0,82 ct/kWh** | § 7 Abs. 16 Z 2: „0,0082 Euro je kWh für sonstige Lieferungen von elektrischer Energie sowie den Verbrauch …“ | ✅ belegt |
| **2027** | **1,5 ct/kWh** | Befristung „vor dem 1. Jänner 2027“, danach § 4 Abs. 2. Keine Novelle im BGBl. 2026 (RIS-Suche 01.01.–24.09.2026 ohne Treffer, § 7 hat keinen Abs. 18+) | ✅ geltendes Recht, **keine Verlängerung kundgemacht**. Eine Ankündigung war nicht auffindbar. |

**Haushaltsbedingung** (SKZG, BGBl. I Nr. 156/2022, § 4 Abs. 1 + Anlage I, [RIS 20012046](https://ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20012046&FassungVom=2024-12-31&Paragraf=4)): natürliche Person, Stromliefervertrag, Zählpunkt mit **Standardlastprofil H0, HA oder HF**. Eine kWh-Obergrenze gibt es nicht. **Betriebe (G-Profile, Lastgangmessung) und juristische Personen zahlen 2026 0,82 ct.**

Gegenprobe: Netz NÖ (B410) und Salzburg Netz weisen dieselbe Zweiteilung 0,82 / 0,1 aus.

**Abweichung zum Code:** [levies.ts:151-158](packages/shared/src/levies.ts#L151-L158) hinterlegt 0,10 ct für **jeden** Kunden 2026. Für jeden Gewerbekunden und für jeden Lastgang-gemessenen Kunden ist das um 0,72 ct/kWh zu niedrig, und zwar in **allen** Tarifvergleichs-Reihen gleich. Das Niveau der Kosten verschiebt sich, die Differenz zwischen den Reihen nur über Ladeverluste (mehr bezogene kWh). Der Code kennt heute **keine Kundenart** in `buildLevySchedule`. Der Referenzfall Urbanz (Segment privat) dürfte die Haushaltsbedingung erfüllen; ob sein Zählpunkt ein H0-Profil trägt, ist hier **nicht geprüft**.

#### EAG-Förderpauschale (§ 73 EAG, BGBl. I Nr. 150/2021)

Erneuerbaren-Förderpauschale-Verordnung 2025, **BGBl. II Nr. 416/2024** (30.12.2024), § 1: „beträgt für die Kalenderjahre 2025 bis einschließlich 2027“ ([RIS](https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2024_II_416/BGBLA_2024_II_416.html)). Die Beträge hängen nur an der Netzebene und sind **bundesweit einheitlich**: NE 3/4 60.524,03 € · NE 5 8.992,14 € · NE 6 553,36 € · NE 7 19,02 €.

✅ **Deckt sich mit [levies.ts:203-209](packages/shared/src/levies.ts#L203-L209)**, 2027 inklusive. Die konsolidierte Fassung ist unverändert. Nach der letzten EAG-Novelle (BGBl. I Nr. 47/2026) sind §§ 73–75 unberührt.

Randnotiz: § 73 Abs. 4 schreibt bei unterjähriger Nutzung „pro angefangenem Kalendermonat ein Zwölftel“ vor. Der Code rechnet tagesanteilig (`yearShare`). Für Vergleiche über gleiche Zeiträume ist das neutral, für die absolute Höhe eine kleine Abweichung.

#### EAG-Förderbeitrag (§ 75 EAG)

- § 75 Abs. 2: „Auf eine bundesweit gleichförmige Belastung der Endkunden je Netzebene ist … Bedacht zu nehmen.“ Die Verordnung legt einen Prozentsatz „des **österreichweit durchschnittlichen**, je Netzebene zu entrichtenden Netznutzungs- und Netzverlustentgelts“ fest und weist in § 2 **feste, bundesweit einheitliche Beträge** je Netzebene aus. Sie sind **nicht** je Netzbereich verschieden.
- 2025: **BGBl. II Nr. 419/2024** (30.12.2024), 10,32 % ([RIS](https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2024_II_419/BGBLA_2024_II_419.html)).
- 2026: **BGBl. II Nr. 301/2025** (18.12.2025), 7,32 % ([RIS](https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2025_II_301/BGBLA_2025_II_301.html)).
- ✅ **Alle Werte in [levies.ts:252-281](packages/shared/src/levies.ts#L252-L281) stimmen mit § 2 beider Verordnungen überein** (NE 3–6, NE 7 gemessen/nicht gemessen/unterbrechbar, Grundpreis, Arbeit, Netzverlust). Die Fundstelle im Code nennt allerdings das Wiener-Netze-Preisblatt EX104 statt der Verordnung. Das ist inhaltlich richtig, aber keine Primärquelle.
- **2027: nicht verordnet**, auch kein Entwurf. Die Gutachten-Seite des BMWET führt nur 2026 ([Seite](https://www.bmwet.gv.at/Services/Publikationen/publikationen-energie/erneuerbaren-foerderbeitragsverordnung.html)). **Übliche Kundmachung:** zweite Dezemberhälfte (30.12.2024 bzw. 18.12.2025).
- ⚠ Die Verordnung 2026 bezieht sich auf die SNE-V 2018. Mit dem neuen Netzentgelt-Regime 2027 (s. u.) ist **offen, ob die Gliederung** (Leistung/Arbeit/Netzverlust je NE-Variante) gleich bleibt → **nicht belegt**.

### 2.5 Gebrauchsabgabe 2027

| Gebiet | Stand |
|---|---|
| Wien | **Keine Änderung für Tarif C 1/1a kundgemacht.** Die konsolidierte Fassung (zuletzt LGBl. 24/2026) nennt 2027 nur für Tarifposten B 24 und D 1–D 5, die keine Leitungen betreffen. Die 7 % gelten damit weiter; der offene Eintrag `validUntil: null` ist rechtlich gedeckt. |
| Netz NÖ | Kein Satz, keine Änderung in Sicht (NÖ GAG seit 2022 unverändert). |
| Salzburg Netz | **Nicht belegt.** Salzburg Netz veröffentlicht die Zuschläge je Kalenderjahr (Preisblatt „01/2026“), erwartungsgemäss mit dem Tarifwechsel zum 01.01. |

### 2.6 Netzentgelte 2027

- 2026: SNE-V 2018 – Novelle 2026, **BGBl. II Nr. 305/2025** (18.12.2025), gestützt auf § 49 ElWOG 2010 ([RIS](https://www.ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2025_II_305/BGBLA_2025_II_305.html)). Die Novelle 2025 (BGBl. II Nr. 370/2024) erschien ebenfalls im Dezember.
- **Ab 2027 neues Regime:** ElWG, BGBl. I Nr. 91/2025, § 135, zweistufig:
  1. **Systemnutzungsentgelte-Grundsatzverordnung (SNE-G-V)** des E-Control-Vorstands. Sie liegt nur als **Begutachtungsentwurf** vor ([PDF](https://www.e-control.at/documents/1785851/0/V+SNE+01_26+SNE-G-V+Begutachtungsentwurf+samt+Erl%C3%A4uterungen.pdf/1425ce2f-897d-bea7-b8e6-e84f67f978ab?t=1782735970283)); § 32 Abs. 1: Inkrafttreten 01.01.2027. Neu ist u. a. ein **Monatsleistungspreis in Cent/kW je Netzbereich** (§ 6). → **angekündigt, nicht kundgemacht.**
  2. **Tarifverordnung** mit den konkreten Beträgen: **weder Entwurf noch Kundmachung** → nicht belegt.
- Die RIS-Suche im BGBl. 2026 („Grundsatzverordnung“, „SNE“, „Tarifverordnung“) ergab keinen Treffer. „Erlassung bis Oktober 2026“ steht nur in Sekundärquellen.
- **Folge:** Die `grid_tariffs`-Zeilen 2027 lassen sich frühestens nach der Tarifverordnung (realistisch Dezember 2026) pflegen. Der **Monatsleistungspreis** berührt zusätzlich die Leistungspreis-Systematik (`billingModel`, OP#3). Das ist ein eigener Bauabschnitt und kein Abgaben-Thema.

---

## 3. Vorschlag für Phase 2 (keine Entscheidung)

### 3.1 Sicher eintragbar — Primärquelle vorhanden

| Eintrag | Quelle | Aufwand |
|---|---|---|
| `netz_noe`: Gebrauchsabgabe **0** ab 2026-01-01 | Preisblatt B410 Ausgabe 01.01.2026 + NÖ GAG 1973 | Datenzeile. Für 2025 erst nach Abruf des Preisblatts 2025 |
| Elektrizitätsabgabe **2027: 1,5 ct/kWh** | ElAbgG § 4 Abs. 2 + Befristung § 7 Abs. 16 | Datenzeile, s. aber §3.4 (politisches Risiko einer Verlängerung) |
| Quellenangaben EAG auf die **Verordnungen** umstellen (BGBl. II 416/2024, 419/2024, 301/2025) | RIS | nur `sourceNote`, Werte unverändert |

### 3.2 Eintragbar, aber mit Umbau des Datentyps

| Punkt | Warum Umbau | Folge |
|---|---|---|
| **Elektrizitätsabgabe 2026 zweigeteilt** (0,1 Haushalt / 0,82 sonst) | `buildLevySchedule` kennt keine Kundenart. Es braucht ein Merkmal „erfüllt SKZG § 4 Abs. 1“. Naheliegend ist das Segment (`privat`/`betrieb`) im Wizard; im öffentlichen Rechner fehlt die Angabe | **Berührt heute laufende Rechnungen**: jeder Betrieb mit Lastgang aus 2026. Regel 12: Golden File Bäckerei (2025er Jahrgang, Satz 1,5 ct, dürfte unberührt sein, sofern kein 2026er Tag eingeht) und Urbanz neu ziehen |
| **Wien: Gebrauchsabgabe auch auf Energie + Lieferanten-Grundgebühr** | `levyOnGridWorkPrice` ([tou.ts:345-351](packages/engine/src/simulation/tou.ts#L345-L351)) und `usageChargeFix` ([monthly-tariff-comparison.ts:297](packages/engine/src/simulation/monthly-tariff-comparison.ts#L297)) müssen die Energie- und Lieferantenseite einbeziehen, in **allen** Reihen inkl. aWATTar | Kosten steigen in Wien um 6–7 % des Energieanteils. Weil der Energieanteil je Reihe verschieden ist, **ändern sich auch die Ersparnis-Differenzen** (Wege 1–4), nicht nur das Niveau |
| **Salzburg: Gebrauchsabgabe als ct/kWh je Netzebene** | `gebrauchsabgabeRate` ist ein Anteil; es braucht ein zweites Feld (z. B. `gebrauchsabgabeCtPerKwh`), das wie die Elektrizitätsabgabe auf jede bezogene kWh geht, und eine Schlüsselung nach (Betreiber, Netzebene) | 2026 eintragbar (Preisblatt 01/2026). **2025 nicht**: Werte nicht belegt, Preisblatt 01/2025 beschaffen |
| **Wiener Netze ausserhalb Wiens** | Schlüssel ist der Netzbetreiber, rechtlich massgeblich ist die **Gemeinde** des Anschlusses | Ohne Ortsmerkmal (PLZ/Gemeinde) bekommt ein Wiener-Netze-Kunde in NÖ die Wiener Abgabe. Entweder Ortsmerkmal einführen oder den Fall benannt verweigern |

Weitere Folgen derselben Wurzel, ausserhalb des Auftrags und nur gemeldet:
- **Leistungspreis in Wien:** Tarif C Post 1 erfasst „alle Einnahmen“ des Netzbetreibers, also auch den Leistungspreis. Der Leistungspreis-Pfad ([strategy.ts](packages/engine/src/tariff/strategy.ts)) rechnet ohne Gebrauchsabgabe; die Peak-Shaving-Ersparnis eines Wiener Kunden liegt damit um 6–7 % zu niedrig. Salzburg (ct/kWh) ist davon nicht betroffen.
- **Kleine örtliche Netzbetreiber** (Göstling, Hollenstein, Kleinneusiedl, Bad Hofgastein) sind keine der drei `NETZBETREIBER_IDS` und bleiben ausserhalb.

### 3.3 Nicht eintragbar — nicht verordnet

- EAG-Förderbeitrag 2027 (erwartet 2. Dezemberhälfte 2026)
- Gebrauchsabgabe Salzburg 2027 und 2025
- Netzentgelte 2027 (Tarifverordnung nach ElWG § 135; Struktur ändert sich)

### 3.4 Umgang mit noch nicht verordneten 2027-Sätzen — zwei Varianten

Vorab: **Solange die Netzentgelte 2027 fehlen, ist die Frage für den Tarifvergleich theoretisch.** `tou.ts` blockiert zuerst an der Netzentgelt-Seite ([tou.ts:295-307](packages/engine/src/simulation/tou.ts#L295-L307)). Praktisch relevant wird die Wahl frühestens zwischen Tarifverordnung und Förderbeitrags-Verordnung, oder falls die Netzentgelt-Seite selbst eine Annahme-Regel bekommt.

**Variante A — benannter Blocker (heutiges Verhalten, geschärft)**
- Ein 2027er Tag ohne verordneten Satz → `side: 'levy'`, mit einer Meldung, die **benennt, welcher Satz** fehlt und **ab wann er erwartet wird**. Heute sagt `gapMessage` nur „fehlen belegte Abgabensätze“ + Zeitraum ([tou.ts:354-364](packages/engine/src/simulation/tou.ts#L354-L364)).
- **Report:** Die Wege 2–4 und die Monatsvergleichs-Reihen entfallen für jeden Lastgang, der in 2027 hineinreicht. Die Zusammenfassung (D8) verliert die Tarif-Wege und zeigt nur noch Weg 5, sofern vorhanden. Die Jahres-Hochrechnung (D6) wählt ihr Fenster „spätestmöglich bis gestern“ und dürfte ab Januar 2027 in die Lücke fallen und entfallen; das ist in Phase 2 am Code zu prüfen.
- **Vorteil:** keine Zahl ohne Beleg, konsistent mit Delta 15 Regel C und `pending_regulation`.
- **Nachteil:** Ab Neujahr bis zur Kundmachung, also bis zu mehreren Wochen, gibt es für **jeden** aktuellen Lastgang keinen Tarifvergleich. Das ist genau die Zeit, in der Kunden nach neuen Tarifen fragen.

**Variante B — ausgewiesene Annahme**
- Für fehlende 2027er Sätze gilt eine **benannte Regel**, z. B. „letzter verordneter Satz fortgeschrieben“ oder für die Elektrizitätsabgabe „Satz nach geltendem Recht (1,5 ct)“. Die Periode trägt einen Marker (Muster `basis: 'foresight_unvalidated'` / `energyPriceBasis`), und der Report weist die Annahme **je betroffener Zahl** aus.
- **Report:** Alle Kapitel bleiben erhalten. Dazu kommt ein Hinweis unter „Annahmen und Datengrundlage“ plus eine Markierung an den betroffenen Reihen. Die Ersparnis-Spanne (D8) enthielte dann eine angenommene Komponente, und es ist zu entscheiden, ob sie dort stehen darf.
- **Risiko:** Beim Förderbeitrag sank der Satz 2025→2026 um rund 30 % (10,32 % → 7,32 %). Eine Fortschreibung kann also um Zehntel-ct/kWh daneben liegen. Bei der Elektrizitätsabgabe ist 1,5 ct zwar geltendes Recht, aber eine Verlängerung der Absenkung wäre ein Sprung um den Faktor 1,8 (Betrieb) bzw. 15 (Haushalt). Eine **abgelegte Analyse** (B14, append-only) friert eine solche Annahme ein; die Wertkopie in `inputs` muss den Marker mittragen, sonst ist später nicht erkennbar, dass es eine Annahme war.
- **Mischform:** Die Elektrizitätsabgabe 2027 nach geltendem Recht eintragen (belegt, nur politisch revisionsanfällig) und nur den Förderbeitrag nach A oder B behandeln. Das hält die Menge der Annahmen klein.

---

## 4. Abweichungen und Grenzen dieser Bestandsaufnahme

- **Zwei Korrekturen an hinterlegten Aussagen** (Wien-Bemessungsgrundlage, Elektrizitätsabgabe 2026 Betriebe) sind oben begründet. Keine davon ist hier umgesetzt.
- Nicht selbst als Primärquelle gelesen: das Wiener-Netze-Preisblatt EX104 2025 (die EAG-Werte sind stattdessen gegen die Verordnungen im RIS geprüft).
- Die Rechtsrecherche lief über Web-Abrufe. Einzelne PDFs (Netz NÖ, Salzburg Netz) mussten per `curl` + `pdftotext` gelesen werden, weil der Abrufdienst sie nicht lesen konnte. Die URL `…wn_ex0106…_2026_geschutzt` antwortete mit HTTP 400; verwendet wurde die aktuell verlinkte Fassung `…_202603_bf`.
- Die Auswirkung der Korrekturen ist **nicht beziffert**. Eine Zahl dazu braucht den Rechenlauf aus Phase 2 mit benannter Datenquelle (Regel 11).
