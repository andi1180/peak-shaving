/**
 * Wächter über die Umgebungsvariablen, die NUR unter der Produktivdomain Pflicht sind.
 *
 * Heute betrifft das genau eine Sache: Cloudflare Turnstile (§8.6). Die Datei ist trotzdem als
 * „Produktions-Wächter" und nicht als „Turnstile-Wächter" benannt — eine zweite Variable dieser
 * Art (in Produktion Pflicht, sonst optional) gehört in dieselbe Prüfung und nicht in eine zweite
 * Datei, die man beim nächsten Mal wieder neu erfinden müsste.
 *
 * ── WARUM ES DIESE DATEI ÜBERHAUPT GIBT ─────────────────────────────────────────────────────────
 * `verifyTurnstile` (`lib/kontakt/turnstile.ts`) ÜBERSPRINGT die serverseitige Prüfung, wenn
 * `TURNSTILE_SECRET_KEY` fehlt. Das ist richtig und bleibt so: ohne Secret gäbe es nichts zu
 * prüfen, und ein harter Fehler machte jedes Formular lokal und in jeder Preview ohne
 * Cloudflare-Env unbenutzbar. Die Lücke lag ausschliesslich darin, dass in PRODUKTION exakt
 * dieselbe Kulanz galt — dort, wo es keinen Grund gibt, die Werte nicht zu haben.
 *
 * GEMESSEN am Live-HTML von `/partner-werden` vor der Behebung: 0× `cf-turnstile`. Der Schutz war
 * in Produktion faktisch nie aktiv, und nichts hat es gemeldet — weder Build noch CI noch die
 * Formulare selbst, die ja weiterhin funktionierten. Genau das ist die Sorte Fehler, die monatelang
 * unbemerkt bleibt: Es fehlt nichts Sichtbares, es fehlt nur der Schutz.
 *
 * Dieser Wächter macht ein KÜNFTIGES Vergessen laut (neues Projekt, gelöschte Variable, falscher
 * Scope) — er ist ausdrücklich NICHT die Prüfung selbst und ändert an `verifyTurnstile` nichts.
 *
 * ── WARUM EINE DRITTE DATEI UND NICHT `env.public.ts` ───────────────────────────────────────────
 * Die Prüfung braucht drei Dinge aus drei Modulen: `IS_PRODUCTION_SITE` (`lib/site.ts`), den
 * Widget-Key (`env.public.ts`) und das Secret (`env.server.ts`). `lib/site.ts` importiert bereits
 * `env.public.ts` — die Prüfung dort hineinzulegen ergäbe einen ZIRKELIMPORT (`env.public` →
 * `site` → `env.public`). Sie steht deshalb an einem dritten Ort, der von allen dreien abhängt und
 * von dem umgekehrt nichts abhängt.
 *
 * `server-only`: dieses Modul liest `serverEnv` und darf damit strukturell nie im Client-Bundle
 * landen. Der Widget-Key wäre dort harmlos, das Secret nicht.
 *
 * ── WARUM KEIN PFLICHTFELD IM SCHEMA ────────────────────────────────────────────────────────────
 * Beide Variablen bleiben in `env.public.ts`/`env.server.ts` `optionalEnv`. Ein schema-weites
 * Pflichtfeld erzwänge sie ÜBERALL — in der CI (die keine Produktions-Env setzt), in jeder Preview
 * und lokal. Die Bedingung ist aber keine „diese Variable existiert immer", sondern „unter der
 * Produktivdomain existiert sie". Genau diese Bedingung lässt sich in einem zod-Schema, das die
 * Domain nicht kennt, nicht ausdrücken.
 */
import 'server-only'
import { publicEnv } from './env.public'
import { serverEnv } from './env.server'
import { IS_PRODUCTION_SITE, PRODUCTION_ORIGIN } from './site'

/**
 * Prüft die produktionspflichtigen Werte und wirft im Stil von `parseEnv` (`lib/env-shared.ts`):
 * eine Zeile je fehlendem Wert, benannt, mit „Build/Start abgebrochen".
 *
 * Rein und ohne `process.env`-Zugriff — alle drei Eingaben kommen als Argument herein, damit die
 * Bedingung ohne Umgebung prüfbar bleibt.
 */
export function assertProductionEnv(
  isProductionSite: boolean,
  turnstileSiteKey: string | undefined,
  turnstileSecretKey: string | undefined,
): void {
  /*
   * DIE EINZIGE BEDINGUNG. Preview-Builds und lokale Builds laufen weiterhin ohne beide Werte
   * durch — auch dann, wenn sie in Preview inzwischen gesetzt SIND: Ein Build darf nicht erzwingen,
   * was er nicht braucht, sonst ist die nächste Preview eines fremden Forks unbaubar.
   */
  if (!isProductionSite) return

  const missing: string[] = []
  if (!turnstileSiteKey) {
    missing.push(
      'NEXT_PUBLIC_TURNSTILE_SITE_KEY: fehlt — ohne Widget-Key rendert das Formular kein ' +
        'Turnstile-Feld, es entsteht also gar kein Token zum Prüfen.',
    )
  }
  if (!turnstileSecretKey) {
    missing.push(
      'TURNSTILE_SECRET_KEY: fehlt — ohne Secret überspringt `verifyTurnstile` die serverseitige ' +
        'Prüfung still (das ist ausserhalb der Produktivdomain Absicht).',
    )
  }
  if (missing.length === 0) return

  throw new Error(
    `Unvollständige Produktions-Umgebungsvariablen (apps/web) — Build/Start abgebrochen:\n` +
      missing.map((line) => `  - ${line}`).join('\n') +
      `\nDieser Build läuft unter der Produktivdomain (${PRODUCTION_ORIGIN}); dort ist der ` +
      `Bot-Schutz des Kontakt-, Warteliste- und Partner-Formulars Pflicht. Beide Werte stammen ` +
      `aus dash.cloudflare.com → Turnstile und gehören in Vercel (Scope: Production).\n` +
      `Vorlage/Doku: apps/web/.env.example, DEPLOYMENT.md §9.`,
  )
}

/*
 * Beim Import ausgeführt — das IST der Wächter. Wo diese Datei eingebunden ist und warum dort,
 * steht in `app/(site)/[locale]/layout.tsx`.
 */
assertProductionEnv(
  IS_PRODUCTION_SITE,
  publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  serverEnv.TURNSTILE_SECRET_KEY,
)
