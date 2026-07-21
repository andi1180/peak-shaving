/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace-Pakete `shared` (zod-Schemata + Contract-Typen) und `engine`
  // (Parser, §3.2/§3.3) werden aus dem TS-Source transpiliert — kein
  // Build-Order-Zwang zwischen Paketen.
  transpilePackages: ['shared', 'engine'],

  /*
   * B14-2: der Commit, mit dem diese Fassung gebaut wurde, als BAU-KONSTANTE.
   *
   * Er landet in jedem Analyse-Bündel und ist dort die belastbare Angabe darüber, WOMIT gerechnet
   * wurde — eine von Hand gepflegte Versionsnummer bleibt still stehen, ein Commit nicht. Vercel
   * stellt `VERCEL_GIT_COMMIT_SHA` beim Bauen bereit; `env` setzt den Wert fest ins Client-Bündel
   * ein (die Variable selbst ist nicht `NEXT_PUBLIC_`-präfixt und wäre sonst im Browser nicht
   * sichtbar).
   *
   * Fehlt der Wert (lokaler Lauf), bleibt er leer — der Code macht daraus einen ERKENNBAREN
   * Platzhalter, und der Upload im Admin-Bereich weist ihn ab. Ein leerer String liefe durch die
   * Datenbank und stünde 2027 als Angabe da, die keine ist.
   */
  env: {
    NEXT_PUBLIC_ENGINE_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? '',
  },
}

export default nextConfig
