# Inter (TTF) — nur für das OG-Bild

Diese zwei Dateien sind **ausschließlich** für `app/opengraph-image.tsx` da.
**Für die Website selbst sind sie irrelevant** — dort lädt `next/font` Inter
(Root-Layouts), und daran ändert sich nichts.

## Warum liegen hier Schriftdateien, wenn `next/font` doch schon Inter lädt?

Weil Satori (die Engine hinter `next/og`) die Glyphen-**Bytes** braucht und sie
sich nicht von `next/font` geben lassen kann:

- `next/font` legt seine Dateien hash-benannt unter `.next/static/media/` ab.
  Es gibt keine öffentliche API, die den Pfad verrät; er ändert sich pro Build.
- Diese Dateien sind **woff2**. Satori unterstützt ttf/otf/woff — **woff2 nicht**.

Deshalb TTF, und deshalb im Repo statt beim Bauen von Google geladen: Ein
`fetch` zur Build-Zeit macht jeden Vercel-Build von einem fremden Dienst
abhängig — fällt er aus, bricht der Build. Das widerspräche auch §7.4 („Fonts
selbst gehostet"). Der Preis sind ~640 KB im Repo; das ist einmalig und ein
Markenasset, kein Bundle: **die Dateien landen nie im Browser**, sie werden nur
beim Vorrendern des Bildes gelesen.

## Herkunft

Inter, Version 20 (Google-Fonts-Auslieferung), statische Instanzen:

| Datei                | Schnitt        | Verwendung auf der Karte     |
| -------------------- | -------------- | ---------------------------- |
| `Inter-Regular.ttf`  | 400 (Regular)  | „ENERGY", Claim              |
| `Inter-Bold.ttf`     | 700 (Bold)     | „COOLiN"                     |

Bezogen von `fonts.gstatic.com` über die Google-Fonts-CSS-API (`css2?family=Inter:wght@400;700`,
TTF-Auslieferung). Der **volle Latin-Zeichensatz**, bewusst nicht per `text=`
auf die Zeichen der Karte reduziert: Ein Subset würde beim nächsten
Claim-Wechsel (`messages/de.json` → `Brand.claim`) still leere Kästchen
rendern, statt laut zu brechen. Umlaute, „—" und „₂" sind damit abgedeckt.

## Lizenz

SIL Open Font License 1.1 — erlaubt Weitergabe und Einbettung, auch
kommerziell. Copyright The Inter Project Authors (https://github.com/rsms/inter).
Volltext: https://openfontlicense.org/

## Wenn eine neue Schnittstärke gebraucht wird

Nicht raten, welche Datei „passt" — die Metriken der Wortmarke
(`components/brand/wordmark.tsx`) sind an Inters echten Glyphen vermessen. Eine
andere Schriftfamilie oder eine andere Inter-Version verschiebt sie.
