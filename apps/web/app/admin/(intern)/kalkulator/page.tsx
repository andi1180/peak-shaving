import type { Metadata } from 'next'
import { isCurrentUserAdmin } from '@/lib/admin/guard'
import { EMBEDDED_CALCULATOR_SRC } from '@/lib/config'

/**
 * `/admin/kalkulator` — der Rechner im Admin-Bereich, ohne Vorbedingung (B18-4).
 *
 * ── ⚠ DIE ENTSCHEIDUNG DIESER SEITE: ES WIRD KEIN ENTITLEMENT GEPRÜFT ───────────────────────────
 * Das ist der EINZIGE Ort im System, an dem der Rechner ohne `calculator_pro` erscheint — und es ist
 * eine bewusste Ausnahme, keine vergessene Prüfung. Die drei anderen Aufrufer lesen sämtlich
 * `getCalculatorAccess()` (öffentliche Rechner-Route, Portal-Reiter, Kontoseite); hier steht
 * ausdrücklich `isCurrentUserAdmin()` und sonst nichts.
 *
 * Der Grund ist, WAS ein Entitlement ist: die Erlaubnis eines KUNDEN, ein verkauftes Produkt zu
 * benutzen. Ein Admin ist kein Kunde seines eigenen Werkzeugs. Prüfte diese Seite `calculator_pro`,
 * müsste sich Andreas einen Gutscheincode für sein eigenes Produkt ausstellen, um es ansehen zu
 * können — und ausgerechnet der Fall, für den er es am dringendsten braucht (eine Anfrage prüfen,
 * einen Kundenlastgang nachrechnen, einen gemeldeten Fehler nachstellen), fiele mit der
 * Zugangsverwaltung zusammen, die er im Reiter daneben gerade bedient. Die Adminrolle IST die
 * Berechtigung; eine zweite davorzuschalten hiesse, dieselbe Frage zweimal zu stellen und beim
 * zweiten Mal die falsche Antwort zu bekommen.
 *
 * ⚠ DAMIT GIBT ES HIER KEINEN ZWEITEN ZUSTAND. Kein „kein Zugang", kein Anfrage-Formular, kein
 * Zwischenschritt — die Seite hat genau eine Antwort für jeden, der sie überhaupt erreicht.
 * `lib/kalkulator/access.ts` und die vier B18-4-Wrapper sind von dieser Route unangetastet: sie
 * regeln den KUNDEN-Zugang und werden hier nicht gelesen, nicht umgangen und nicht ergänzt.
 *
 * ── DIE ZUGANGSPRÜFUNG STEHT HIER, NICHT NUR IM LAYOUT ──────────────────────────────────────────
 * Dieselbe Lehre wie in jeder anderen Admin-Seite und in den Portal-Reitern: Dass das Layout seine
 * `children` nicht rendert, verhindert nicht, dass Next die Seite rendert und ins Flight-Payload
 * schreibt. Zwei Aufgaben, EINE Regel — beide rufen `isCurrentUserAdmin()`, `cache()` sorgt dafür,
 * dass Sitzungsabfrage und RPC pro Anfrage trotzdem nur einmal laufen (`lib/admin/guard.ts`).
 * Ohne Sitzung leitet die Funktion selbst auf den ADMIN-Eingang um und trägt das Rücksprungziel
 * über den bestehenden `NEXT_PARAM`-Mechanismus mit; angemeldet ohne Rolle gibt es die neutrale
 * „Kein Zugriff"-Seite des Layouts, ohne Weiterleitung (B17/B17-Nachzug).
 *
 * ── DER RECHNER WIRD NICHT NACHGEBAUT ───────────────────────────────────────────────────────────
 * `EMBEDDED_CALCULATOR_SRC` ist dieselbe Konstante wie auf der öffentlichen Rechner-Route und im
 * Portal-Reiter (`lib/config.ts`) — dritte Verwendung, nichts Neues. `apps/web` importiert
 * weiterhin weder Engine noch Kalkulator-UI. Die HÖHE wird hier dagegen eigens gerechnet, weil der
 * Admin-Rahmen höher ist als der Website-Header; Begründung samt Messung an
 * `ADMIN_CALCULATOR_FRAME_STYLE` weiter unten.
 */

/** Rolle live gelesen, ein Entzug greift sofort (I10) — wie in jeder Admin-Route. */
export const dynamic = 'force-dynamic'

/** Neutral wie im Layout: der Tab-Titel darf nicht verraten, dass es hier etwas zu holen gibt. */
export const metadata: Metadata = {
  title: 'COOLiN ENERGY',
  robots: { index: false, follow: false },
}

/**
 * ⚠ EIGENE HÖHENRECHNUNG — und jede Zahl darin ist GEMESSEN, nicht geschätzt.
 *
 * `CALCULATOR_FRAME_STYLE` (`lib/config.ts`) rechnet `100dvh - var(--header-h)`, und `--header-h`
 * (4rem/64 px) ist die Höhe des ÖFFENTLICHEN Website-Headers. Der Admin-Rahmen ist ABER HÖHER: er
 * besteht aus Kopfzeile UND Bereichs-Navigation (`AdminShell` → `AdminNav`). Unverändert übernommen
 * ergäbe die Konstante einen iframe, der höher ist als der freie Platz — also einen ZWEITEN
 * Scrollbalken für die Seite, zusätzlich zu dem, den der Rechner in sich selbst hat. Genau diese
 * Richtung benennt der Portal-Reiter (B18-4) als die schädliche; dort liegt der Fehler in der
 * harmlosen (der Portal-Rahmen ist flacher als der Website-Header, der iframe damit ein paar Pixel
 * zu kurz), weshalb er dort bewusst stehen gelassen wurde.
 *
 * ── ⚠ DIE KOPFZEILE HAT ZWEI HÖHEN, UND DAS WAR DER FEHLER IM ERSTEN WURF ───────────────────────
 * Am laufenden Production-Build über 14 Breiten ausgemessen: die Kopfzeile trägt `flex-wrap` und
 * bricht unterhalb von **480 px** auf zwei Zeilen um (Marke + Kennzeichnung + Abmelden passen nicht
 * mehr nebeneinander). Gemessen:
 *
 *   ab 480 px:   Kopfzeile  60 px + Navigationsleiste 45 px = **105 px**
 *   unter 480:   Kopfzeile 104 px + Navigationsleiste 45 px = **149 px**
 *
 * Ein EINZIGER Abzug traf deshalb nur den einen Fall: mit `104 px` gerechnet ergab sich bei 375 px
 * Breite ein Seiten-Scroll von **41 px** — exakt der doppelte Scrollbalken, den dieser Kommentar
 * vermeiden soll. Deshalb zwei Werte mit der gemessenen Schwelle als Grenze.
 *
 * Abgezogen werden `var(--header-h)` (64) + `2.75rem` (44) = **108 px** ab 480 px (iframe 3 px
 * kürzer als der freie Platz) und **150 px** darunter (1 px kürzer) — beide auf der harmlosen Seite.
 * Kein Pixel-Feilschen: der Rechner scrollt in seinem Rahmen ohnehin selbst, und der Fehlerfall
 * eines geänderten Rahmens sind ein paar Pixel Seiten-Scroll, kein Bruch.
 *
 * `min-h` wie in der geteilten Konstante: auf einem sehr flachen Fenster bleibt sonst ein Schlitz
 * übrig, in dem der Rechner nicht bedienbar ist — dann lieber die Seite scrollen lassen. Auf einem
 * echten Telefon (375 × 667) ist dieser Fall der Normalfall und der Seiten-Scroll gewollt.
 *
 * Bewusst KEINE zweite Konstante in `lib/config.ts`: die dortige benennt die Höhe der
 * RECHNER-Fläche unter dem WEBSITE-Header und wird von zwei Routen geteilt. Ein dritter Wert für
 * einen dritten Rahmen gehört zu diesem Rahmen, nicht in die geteilte Datei.
 */
const ADMIN_CALCULATOR_FRAME_CLASS =
  'h-[calc(100dvh-9.375rem)] min-h-[40rem] min-[480px]:h-[calc(100dvh-var(--header-h)-2.75rem)]'

export default async function Page() {
  /*
   * Fail-closed und ohne zweite Frage. Der `false`-Zweig ist NICHT der Anfrage-Zustand des
   * Kundenpfads, sondern schlicht „kein Inhalt" — die sichtbare Antwort für ein angemeldetes Konto
   * ohne Rolle erzeugt bereits das Layout, und sie sagt bewusst nichts über eine fehlende Rolle.
   */
  if (!(await isCurrentUserAdmin())) return null

  return (
    <>
      {/*
       * Eine H1 für die Dokumentstruktur (§9.4), aber KEINE sichtbare: sie schöbe den Rechner nach
       * unten aus dem Bild, und der Fokus liegt hier auf dem Werkzeug. Dieselbe Entscheidung und
       * derselbe Grund wie auf `/peak-shaving/kalkulator/rechner`. Der iframe trägt seinen eigenen
       * `title` für die Screenreader-Ansage.
       *
       * Der Text steht hier als Zeichenkette und nicht in `messages/de.json`: der gesamte
       * `/admin`-Bereich hält seine deutschen Sätze im Code (T4-4/B1-3, begründet in
       * `lib/admin/schema.ts` — er liegt ausserhalb der next-intl-Struktur, ein Key-Umweg ohne
       * Wörterbuch wäre eine Indirektion ohne Nutzen).
       */}
      <h1 className="sr-only">Peak-Shaving Kalkulator</h1>

      {/*
       * VOLLFLÄCHIG: kein `Container`, kein Rand, kein Radius — der Rechner bringt seinen eigenen
       * Grund und seine eigene Innenbreite mit, ein Kasten um den Kasten wäre doppelter Rahmen.
       * Dieselbe Entscheidung wie auf der öffentlichen Rechner-Route und im Portal-Reiter.
       *
       * ⚠ DER RECHNER ERLAUBT NICHT JEDEN RAHMEN-URSPRUNG. `apps/website` sendet seit B18-4
       * `Content-Security-Policy: frame-ancestors 'self' https://coolin.at https://www.coolin.at
       * https://partner.coolin.at` (am laufenden Dienst gemessen). Der Admin-Bereich liegt auf
       * `www.coolin.at` und ist damit gedeckt — LOKAL und in jeder Preview bleibt der Rahmen dagegen
       * leer, und der Grund steht nur in der Browser-Konsole. Das ist erwartet und kein Defekt;
       * wer eine weitere Domain braucht, trägt sie in `apps/website/next.config.mjs` ein.
       */}
      <iframe
        src={EMBEDDED_CALCULATOR_SRC}
        title="Peak-Shaving Kalkulator"
        className={`block w-full border-0 ${ADMIN_CALCULATOR_FRAME_CLASS}`}
      />
    </>
  )
}
