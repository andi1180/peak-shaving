import Image from 'next/image'

import { PRINT_COMPANY } from '@/lib/company'

/**
 * Kopf- und Fusszeile des Druck-Reports — auf JEDER Seite, nicht nur auf der ersten.
 *
 * ── AM BILDSCHIRM ÄNDERT SICH NICHTS ────────────────────────────────────────────────────────────
 * Kopf- und Fusszeile tragen `hidden print:*`; der Tabellenrahmen selbst läuft am Bildschirm als
 * schlichte `block`-Kette (`table`/`tbody`/`tr`/`td` → `display: block`) und ist damit ein
 * durchsichtiger Wrapper um genau ein Kind. Der Report bleibt Zeile für Zeile die bisherige
 * Bildschirmansicht.
 *
 * ── ⚠ WARUM EINE ECHTE `<table>` UND NICHT `position: fixed` ────────────────────────────────────
 * Beide Wege wurden am 02.09.2026 gegen Chromium GEMESSEN (der massgebliche Export-Weg — der
 * PDF-Export läuft über `window.print()`, es gibt keine serverseitige Erzeugung):
 *
 *   `position: fixed` + `top/bottom: 0`      → wiederholt sich zwar auf jeder Seite, sitzt aber IM
 *                                              Inhaltsbereich und liegt damit ÜBER dem Text.
 *   `position: fixed` + negativer Versatz     → wandert unvorhersehbar (Kopfzeile erschien am
 *     (in den Seitenrand hinein)                Seitenfuss, Fusszeile am Seitenkopf) — unbrauchbar.
 *   `display: table-header-group` auf `div`s  → wiederholt sich in Chromium GAR NICHT.
 *   echte `<thead>`/`<tfoot>` einer `<table>` → wiederholt sich auf jeder Seite UND liegt im
 *                                              Textfluss, kann den Inhalt also nicht überdecken.
 *
 * Deshalb: die Kopfzeile ist ein `<thead>` (in-flow, wiederholt sich, überdeckt nichts).
 *
 * ── DIE FUSSZEILE IST EIN HYBRID, UND DAS HAT EINEN GRUND ───────────────────────────────────────
 * Ein wiederholtes `<tfoot>` sitzt auf der LETZTEN Seite direkt unter dem Text statt am Blattfuss
 * — bei einer halb gefüllten Schlussseite sieht das aus, als sei das Dokument abgeschnitten.
 * Deshalb: `position: fixed; bottom: 0` für die sichtbare Fusszeile (sie wiederholt sich, gemessen)
 * und ein LEERER `<tfoot>` derselben Höhe als Platzhalter im Fluss. Der Platzhalter ist das, was
 * verhindert, dass Text unter die Fusszeile läuft — ohne ihn wäre der Hybrid genau der
 * Überdeckungsfall aus der Tabelle oben.
 *
 * ⚠ Die beiden Höhen (`--print-footer-h`) MÜSSEN übereinstimmen. Sie stehen deshalb als EINE
 * Variable in `app/globals.css` und nicht zweimal als Zahl.
 */
export function PrintFrame({ children }: { children: React.ReactNode }) {
  return (
    <table className="block w-full print:table print:table-fixed">
      <thead className="hidden print:table-header-group">
        <tr>
          <td className="p-0">
            <div className="flex flex-col gap-2 pb-4">
              <div className="flex items-center gap-2">
                {/*
                  Die BESTEHENDE Emblem-Datei aus `apps/web/public/brand/` (byte-identisch kopiert,
                  MD5 geprüft) — kein neu gezeichnetes Logo. `priority`, weil ein Bild, das erst
                  beim Scrollen nachlädt, im Druck schlicht fehlen kann.
                */}
                <Image
                  src="/brand/coolin-emblem.png"
                  alt="COOLiN ENERGY"
                  width={128}
                  height={128}
                  priority
                  className="h-7 w-7"
                />
                <span className="text-sm font-semibold tracking-wide text-navy">COOLiN ENERGY</span>
              </div>
              {/* Der Balken. Navy, nicht `--color-accent`: er trägt COOLiNs Marke, nicht die
                  White-Label-Farbe eines Mandanten (s. globals.css). */}
              <div className="h-1 w-full rounded-sm bg-navy" />
            </div>
          </td>
        </tr>
      </thead>

      {/*
        Platzhalter im Fluss — NICHT die sichtbare Fusszeile. Sie steht als `position: fixed`
        unterhalb, damit sie auch auf einer halb gefüllten Schlussseite am Blattfuss sitzt.
      */}
      <tfoot className="hidden print:table-footer-group" aria-hidden>
        <tr>
          <td className="p-0">
            <div className="h-[var(--print-footer-h)]" />
          </td>
        </tr>
      </tfoot>

      <tbody className="block print:table-row-group">
        <tr className="block print:table-row">
          <td className="block p-0 print:table-cell">{children}</td>
        </tr>
      </tbody>
    </table>
  )
}

/**
 * Die sichtbare Fusszeile. Eigene Komponente, weil sie im DOM NEBEN der Tabelle stehen muss
 * (`position: fixed` in einer Tabellenzelle ist in Chromium nicht zuverlässig positioniert).
 */
export function PrintRunningFooter() {
  return (
    <div className="hidden print:fixed print:bottom-0 print:left-0 print:right-0 print:block print:h-[var(--print-footer-h)]">
      <div className="mx-auto flex h-full max-w-6xl items-end justify-between gap-4 border-t border-border px-4 pb-1 pt-2 text-[9px] leading-tight text-text-muted sm:px-6">
        <span>
          {PRINT_COMPANY.name} · {PRINT_COMPANY.street} · {PRINT_COMPANY.city}
        </span>
        <span>{PRINT_COMPANY.web}</span>
      </div>
    </div>
  )
}
