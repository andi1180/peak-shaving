import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace-Paket `tariff-monitor` (T1, Haushalts-Energiemonitor-Engine) wird
  // aus dem TS-Source transpiliert — Muster wie `apps/website`s `shared`/`engine`.
  // Es ist rein & isomorph (kein I/O), läuft daher unverändert im Browser (T3).
  //
  // `shared` kommt mit B14-2 dazu: der Admin-Bereich liest dort die EINE Definition des
  // Analyse-Bündels und die Archiv-Funktionen (gzip/SHA-256) — dieselben, die der Rechner beim
  // Export benutzt. Eine eigene Kopie hier wäre die zweite Beschreibung desselben Formats, und die
  // Abweichung fiele erst beim Hochladen auf, also nachdem die Analyse gerechnet ist.
  //
  // `extractors` kommt mit der B24-Konsolidierung dazu und ist der Grund, warum der Projekt-Chat
  // überhaupt Dokumente lesen kann: die vier KI-Extraktoren lagen bis dahin in `apps/website` und
  // waren von hier aus nicht erreichbar (der Chat MUSS hier liegen, weil der Zugriffsschutz aller
  // Projekt-Wrapper an `auth.uid()` hängt, und die zwei Apps importieren einander nie). Sie
  // abzuschreiben schied aus — zwei Fassungen derselben Ableseregel laufen auseinander, und dann
  // liest derselbe Kunde je nach Einstieg eine andere Zahl von derselben Rechnung.
  //
  // ⚠ Es ist server-only (`import 'server-only'` in jedem KI-Client). Es darf deshalb NIE aus einer
  // Client-Komponente erreichbar werden; der Import bräche den Build hart, und genau so ist es
  // gemeint.
  transpilePackages: ['tariff-monitor', 'shared', 'extractors'],

  experimental: {
    /*
     * B14-2: der Analyse-Upload schickt ZWEI Dateien durch eine Server Action — das Bündel und die
     * unkomprimierte Ursprungsdatei. Next begrenzt den Rumpf einer Server Action standardmässig auf
     * 1 MB; ein Jahres-Lastgang liegt darüber, und die Ablehnung käme als undurchsichtiger Fehler
     * statt als Satz.
     *
     * Der Wert liegt bewusst ETWAS ÜBER der fachlichen Obergrenze von 20 MB
     * (`MAX_SOURCE_FILE_BYTES`): so entscheidet die Anwendung über zu grosse Dateien und antwortet
     * mit einer verständlichen Meldung, statt dass die Plattform die Anfrage vorher abschneidet.
     * Die fachliche Grenze bleibt die in `lib/admin/analysis-upload.ts`.
     */
    serverActions: { bodySizeLimit: '24mb' },

    /*
     * ⚠ ZWEITE, UNABHÄNGIGE RUMPFGRENZE — und sie greift FRÜHER als `bodySizeLimit`.
     *
     * Gemessen mit einer 21-MB-Datei am Lastgang-Upload (B24): Next schneidet den Rumpf einer
     * Anfrage, die durch die MIDDLEWARE läuft, standardmässig bei 10 MB ab — der gesamte
     * `/admin`-Bereich tut das. Die Server Action bekam daraufhin ein halbes Formular und warf
     * „Unexpected end of form"; der Nutzer sah einen Absturz statt der Meldung, die die Anwendung
     * für genau diesen Fall bereithält.
     *
     * `bodySizeLimit` allein reicht also NICHT: es begrenzt, was die Action annimmt, nicht was die
     * Middleware durchlässt. Der Wert liegt aus demselben Grund wie dort ETWAS über der fachlichen
     * Obergrenze (20 MB, `MAX_PROJECT_DOCUMENT_BYTES` bzw. `MAX_SOURCE_FILE_BYTES`): die Anwendung
     * soll ablehnen und den Grund nennen, nicht die Plattform stumm abschneiden.
     */
    middlewareClientMaxBodySize: '24mb',
  },
  /**
   * 301-Redirects der alten `.html`-Pfade (Pflichtenheft §6.4).
   *
   * Der Bestand war EINE Scroll-Seite; ihre einzigen echten Unterseiten waren
   * diese drei. Sie stehen hier, weil sie in `reference/coolin-legacy.html`
   * NACHWEISLICH verlinkt waren (`href="/impressum.html"`, `href="/datenschutz.html"`,
   * `action="/danke.html"`) — nicht, weil sie plausibel klingen. Ein Redirect für
   * einen Pfad, den es nie gab, wäre toter Code, den niemand je widerlegen kann.
   *
   * `statusCode: 301` UND NICHT `permanent: true` — der Unterschied ist gemessen,
   * nicht kosmetisch: Next macht aus `permanent: true` ein **308**, kein 301
   * (belegt: `/impressum.html` lieferte damit „308 -> /impressum"). Für Google
   * sind beide gleichwertig (beide vererben das Ranking), aber:
   *
   *   – 301 ist der universell verstandene Dauer-Redirect; 308 ist von 2015 und
   *     wird von alten Clients, Proxies und Link-Checkern nicht überall sauber
   *     behandelt. Genau solche Uralt-Clients folgen aber den Links, um die es
   *     hier geht.
   *   – 308 erhält die HTTP-Methode, 301 stuft auf GET herab. Das ist für
   *     `/danke.html` relevant: Es war das POST-Ziel des alten Netlify-Formulars.
   *     Ein POST aus einer noch im Browser liegenden alten Seite würde per 308
   *     als POST auf `/kontakt` weitergereicht — dort gibt es nur eine Seite,
   *     also 405. Per 301 wird daraus ein GET, und der Absender landet auf dem
   *     Formular.
   *
   * `permanent` und `statusCode` schließen sich in Next gegenseitig aus.
   *
   * NICHT DABEI — jeweils mit Grund:
   *
   *   /coolin.html — §6.4 nennt diesen Pfad, es gibt ihn aber nicht. Die alte
   *     Startseite lief unter „/", belegt durch ihr eigenes
   *     `<meta property="og:url" content="https://coolin.at/">`. Und „/" liefert
   *     bereits die neue Startseite aus. Ein Redirect von `/coolin.html` würde
   *     eine URL erfinden, um sie umzuleiten.
   *
   *   #leistungen, #peak-shaving, #vorgehen, #ergebnisse, #kontakt — die
   *     Sprungmarken der alten Scroll-Seite. Fragmente werden vom Browser NICHT
   *     an den Server geschickt; sie sind serverseitig unsichtbar und technisch
   *     nicht umleitbar. `/#leistungen` landet auf der neuen Startseite, der
   *     Anker läuft ins Leere — mehr ist ohne Client-JS nicht möglich und wäre
   *     für ein paar alte Deep-Links den Aufwand nicht wert.
   *
   *   /favicon.png, /logo-coolin-energy.png — Bilder, keine Seiten. §6.4 will
   *     Ranking und Backlinks retten; die hängen an Dokumenten, nicht an Assets.
   */
  async redirects() {
    return [
      { source: '/impressum.html', destination: '/impressum', statusCode: 301 },
      { source: '/datenschutz.html', destination: '/datenschutz', statusCode: 301 },
      /*
       * Die Danke-Seite des alten Netlify-Formulars. Ein Pendant hat der Neubau
       * bewusst nicht — das Formular meldet den Erfolg an Ort und Stelle (§5.5).
       * `/kontakt` ist damit die Seite, die dieselbe Aufgabe erfüllt; ein
       * Redirect auf „/" würde den Besucher mit seinem Anliegen allein lassen.
       */
      { source: '/danke.html', destination: '/kontakt', statusCode: 301 },

      /*
       * BRANCHEN-NEUORDNUNG (Prompt 25). Dieselbe Konvention wie oben:
       * `statusCode: 301`, nicht `permanent: true` (das ergäbe ein 308).
       *
       * Anders als die `.html`-Pfade oben sind das URLs, die WIR selbst
       * ausgeliefert und intern verlinkt haben — sie stehen im Index, in
       * Lesezeichen und in der bereits eingereichten sitemap. Ohne Redirect
       * wären es 404er auf Seiten, die es gab.
       *
       * ZWEI ZIELE, zwei Fälle — die Unterscheidung ist inhaltlich, nicht
       * kosmetisch:
       *
       *   – Hotellerie/Gastronomie sind zu EINER Seite verschmolzen. Ihr Inhalt
       *     lebt dort weiter, also zeigt der Redirect auf die Nachfolgeseite:
       *     Ranking und Backlinks gehen an die Seite, die dasselbe Thema trägt.
       *
       *   – Bäckerei und Handel haben KEINEN Nachfolger. Sie auf eine der neuen
       *     Branchen zu leiten wäre ein Fehler, den Google „soft 404" nennt: Ein
       *     Redirect behauptet „das hier ist jetzt die Adresse dafür" — ein
       *     Bäckerei-Sucher auf /branchen/handwerk zu schicken behauptet etwas
       *     Falsches. Die Übersicht ist die ehrliche Antwort: Sie zeigt, was es
       *     stattdessen gibt, und der Besucher entscheidet.
       */
      {
        source: '/branchen/hotellerie',
        destination: '/branchen/hotellerie-gastronomie',
        statusCode: 301,
      },
      {
        source: '/branchen/gastronomie',
        destination: '/branchen/hotellerie-gastronomie',
        statusCode: 301,
      },
      { source: '/branchen/baeckerei', destination: '/branchen', statusCode: 301 },
      { source: '/branchen/handel', destination: '/branchen', statusCode: 301 },
    ]
  },
}

export default withNextIntl(nextConfig)
