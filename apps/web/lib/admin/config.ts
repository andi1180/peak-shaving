/**
 * Konstanten des Admin-Bereichs (T4-4). Reines Konstanten-Modul ohne `server-only` und ohne
 * `next/*`-Import — es wird von der MIDDLEWARE (Edge-Runtime), von Server Components UND von
 * Client-Komponenten gelesen. Gleiche Rolle wie `lib/auth/config.ts` für den Auth-Bereich.
 *
 * Der Import aus `lib/auth/config` ist aus demselben Grund unbedenklich: jenes Modul ist ebenfalls
 * rein. Es liefert die EINE Sanierung eines Rücksprungziels und den EINEN Parameternamen — beide
 * hier nachzubauen wäre eine zweite Auslegung derselben Regel.
 */
import { NEXT_PARAM, sanitizeNext } from '@/lib/auth/config'

/**
 * Basispfad des Admin-Bereichs — OHNE Locale-Präfix. Die Route liegt bewusst außerhalb von
 * `app/(site)/[locale]/`: ein interner Verwaltungsbereich ist kein Seiteninhalt und braucht keine
 * Übersetzung (Website-Pflichtenheft Prinzip 5 zielt auf öffentliche, indexierbare Seiten).
 * Die Middleware nimmt genau diesen Pfad vom next-intl-Routing aus.
 */
export const ADMIN_HREF = '/admin'

/**
 * Der eigene Anmelde-Eingang des Admin-Bereichs (B17) — die EINZIGE Route unterhalb von `/admin`,
 * die anonym erreichbar ist (sie liegt deshalb ausserhalb von `app/admin/(intern)/`).
 *
 * ── ER ERHÖHT DIE SICHERHEIT NICHT, ER SCHAFFT KLARHEIT ──────────────────────────────────────────
 * Es entsteht KEIN zweites Authentifizierungssystem: derselbe Supabase-Auth-Bestand, dieselbe
 * Sitzung, dieselbe Server Action (`signInAction`, T4-2) und dieselbe Rollenprüfung
 * (`platform.user_roles` über `public.is_admin`). Was hier neu ist, ist ausschliesslich ein eigener
 * EINGANG und ein eigener RAHMEN. Wer diese Adresse kennt, hat dadurch keinen Vorteil — der Schutz
 * liegt unverändert in der Rollenprüfung hinter der Anmeldung.
 *
 * Slug deutsch wie `/anmelden` (`lib/auth/config.ts`), damit es im ganzen System eine Schreibweise
 * für dieselbe Handlung gibt.
 */
export const ADMIN_ANMELDEN_HREF = '/admin/anmelden'

/**
 * Kopfzeile, über die die MIDDLEWARE dem Server den angeforderten Admin-Pfad mitteilt.
 *
 * ── WARUM ÜBERHAUPT EINE KOPFZEILE ──────────────────────────────────────────────────────────────
 * Die Zugangsschranke sitzt in `isCurrentUserAdmin` (`lib/admin/guard.ts`) und wird aus einem
 * LAYOUT und aus elf Seiten heraus aufgerufen. Keiner dieser Aufrufer kennt den angeforderten Pfad:
 * ein Layout bekommt ihn nicht als Prop, und Next stellt ihn einer Server Component auch sonst
 * nirgends bereit — gemessen an einem Route Handler unter `/admin`, der die vollständige
 * Kopfzeilenliste ausgegeben hat (`accept`, `host`, `user-agent`, `x-forwarded-*` — mehr nicht).
 * Die Middleware läuft ohnehin für jeden `/admin`-Pfad; sie ist die einzige Stelle, die ihn kennt.
 *
 * ── SIE IST NICHT FÄLSCHBAR ─────────────────────────────────────────────────────────────────────
 * Die Middleware SETZT den Wert auf einer Kopie der Anfrage-Kopfzeilen und überschreibt damit einen
 * etwaigen mitgeschickten. Der Leser prüft ihn trotzdem noch einmal (`adminNextTarget`) — was daraus
 * folgen könnte, wäre ohnehin nur eine Weiterleitung auf einen anderen internen Admin-Pfad, und
 * über den Zugang entscheidet allein die Rollenprüfung dahinter.
 */
export const ADMIN_PATHNAME_HEADER = 'x-admin-pathname'

/**
 * Das Rücksprungziel für den Admin-Eingang: der angeforderte Admin-Pfad, oder `/admin`.
 *
 * Zwei Prüfungen, beide mit eigenem Grund:
 *   - `sanitizeNext` (dieselbe Funktion wie in `signInAction`, kein zweites Open-Redirect-Verfahren),
 *   - und darüber hinaus MUSS das Ziel im Admin-Bereich liegen. Dieser Eingang existiert, damit ein
 *     Admin im Verwaltungsbereich landet; ein Ziel ausserhalb wäre entweder ein Irrtum oder ein
 *     untergeschobener Wert, und in beiden Fällen ist `/admin` die richtige Antwort.
 *
 * Der Eingang selbst ist ausgenommen — als Ziel wäre er eine Schleife auf sich selbst.
 */
export function adminNextTarget(pathname: string | null | undefined): string {
  const next = sanitizeNext(pathname, ADMIN_HREF)
  if (next === ADMIN_ANMELDEN_HREF || next.startsWith(`${ADMIN_ANMELDEN_HREF}?`)) return ADMIN_HREF
  return next === ADMIN_HREF || next.startsWith(`${ADMIN_HREF}/`) || next.startsWith(`${ADMIN_HREF}?`)
    ? next
    : ADMIN_HREF
}

/** Der Admin-Eingang samt Rücksprungziel. Ist das Ziel ohnehin `/admin`, entfällt der Parameter —
 *  dasselbe Muster wie im Auth-Callback, der `next` nur bei abweichendem Ziel anhängt. */
export function adminLoginHref(pathname: string | null | undefined): string {
  const next = adminNextTarget(pathname)
  if (next === ADMIN_HREF) return ADMIN_ANMELDEN_HREF
  return `${ADMIN_ANMELDEN_HREF}?${new URLSearchParams({ [NEXT_PARAM]: next }).toString()}`
}

/**
 * Die Produkte, für die ein Gutscheincode ausgestellt werden kann — Spiegel des Postgres-Enums
 * `platform.product_key`. Weicht die Liste ab, lehnt die Datenbank den Wert ohnehin ab; sie steht
 * hier, damit das Formular ein Auswahlfeld statt eines freien Textfelds zeigen kann.
 */
export const PRODUCT_KEYS = ['monitor', 'calculator_pro'] as const
export type ProductKey = (typeof PRODUCT_KEYS)[number]

/** Anzeigenamen der Produkte (der Enum-Wert selbst ist kein Nutzertext). */
export const PRODUCT_LABELS: Record<ProductKey, string> = {
  monitor: 'Strom-Monitor',
  calculator_pro: 'Kalkulator Pro',
}

/**
 * Die Produkte, für die ein Gutscheincode ausgestellt werden darf.
 *
 * ── SEIT B10-2 WIEDER DECKUNGSGLEICH MIT `PRODUCT_KEYS` — die Geschichte gehört dazu ────────────
 * `calculator_pro` war hier bewusst AUSGESCHLOSSEN, solange der Pro-Kalkulator `platform.entitlements`
 * an keiner Stelle las: sein Zugang hing an einem separaten, DB-losen Zugangscode. Ein für
 * `calculator_pro` eingelöster Gutscheincode hätte damals brav eine Entitlement-Zeile geschrieben,
 * die im Kalkulator nichts bewirkt — der Kunde hätte bezahlt und stünde trotzdem vor dem
 * Code-Dialog. Der unangenehmste aller Fehler: er sieht bis zum Einlösen wie ein Erfolg aus.
 *
 * B10-2 hat genau diese Bedingung aufgelöst. Die Route prüft jetzt `get_my_entitlement` für
 * `calculator_pro` (`lib/kalkulator/access.ts`), den Code-Dialog gibt es nicht mehr. Ein
 * eingelöster Gutscheincode wirkt damit tatsächlich — er ist derzeit sogar der EINZIGE
 * Selfservice-Weg zum Kalkulator (ein Stripe-Preis existiert nicht, OP#1 ist offen; ein erfundener
 * Platzhalterpreis wäre hier derselbe Fehler wie eine erfundene Tarifzahl in B11).
 *
 * Die Liste bleibt trotzdem eine EIGENE neben `PRODUCT_KEYS` und wird nicht durch sie ersetzt:
 * „welche Produkte gibt es" und „welche darf ein Admin per Code verschenken" sind zwei Fragen, die
 * heute zufällig dieselbe Antwort haben. Ein künftiges Produkt, das ausschliesslich über Stripe
 * läuft, gehört in die erste Liste und nicht in diese.
 */
export const CODE_PRODUCT_KEYS = ['monitor', 'calculator_pro'] as const
export type CodeProductKey = (typeof CODE_PRODUCT_KEYS)[number]

/**
 * Die vergebbaren Rollen — Spiegel des CHECK auf `platform.user_roles.role`. Aktuell genau eine.
 * Wird der CHECK per Migration geweitet, ist diese Liste mitzuziehen (die DB bleibt die harte Grenze).
 */
export const ROLES = ['admin'] as const
export type Role = (typeof ROLES)[number]
