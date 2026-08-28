/**
 * Der Supabase-Lesezugang des Kalkulators (B21-3a) — anon, NUR LESEND, browser-tauglich.
 *
 * ── DIE ERSTE SUPABASE-ANBINDUNG IN `apps/website` ÜBERHAUPT ────────────────────────────────────
 * Bis hierher hatte diese App keinerlei Datenbank-Verbindung; das war bis B21-1 auch richtig so.
 * Sie bekommt sie jetzt für genau zwei Dinge: die Netzbetreiber-Tarifzeilen (`grid_tariffs` +
 * `grid_tariff_rate_windows`, Delta 5) und die historischen Marktpreise (`spot_prices`, Delta 7).
 * Beides sind VERÖFFENTLICHTE Referenzdaten ohne Personenbezug — genau der Grund, warum B21-1 sie
 * mit direktem RLS-Select statt mit dem `platform`-Wrapper-Muster angelegt hat.
 *
 * ── VERHÄLTNIS ZU PRINZIP 4 („Daten verlassen den Browser nicht") ───────────────────────────────
 * Die Zusage bleibt unangetastet: Es wird NICHTS hochgeladen. Der Lastgang, die Messwerte, die
 * Datei — alles bleibt im Browser, die Rechnung läuft weiter vollständig client-seitig.
 *
 * ⚠ OFFENGELEGTE GRENZE, damit sie niemand später „entdeckt": Eine Abfrage trägt zwangsläufig ihre
 * PARAMETER mit — den gewählten Netzbetreiber, die Netzebene und die Zeitgrenzen des Lastgangs
 * (Delta 15 Regel A: das Fenster IST der Lastgang). Aus „Zeitraum Juni 2025 bis Juni 2026" lässt
 * sich nichts über den Verbrauch ableiten, aber es ist mehr als nichts, und es steht im Server-Log
 * einer fremden Infrastruktur. Die Alternative wäre, die gesamte Preistabelle in den Browser zu
 * laden (bei einem Jahr rund 8.760 Zeilen je Analyse, ohne Filtermöglichkeit) — mehr Datenverkehr
 * für weniger Aussagekraft, ohne dass die Zeitgrenzen dadurch verschwänden. Der Schnitt ist bewusst
 * so gesetzt und gehört in den Datenschutzhinweis, nicht in eine stille Fussnote.
 *
 * ── KEIN SPEICHER AUF DEM ENDGERÄT — die wichtigste Einstellung dieser Datei ────────────────────
 * `persistSession`, `autoRefreshToken` und `detectSessionInUrl` sind AUS. supabase-js legt sonst von
 * sich aus einen Sitzungsschlüssel im `localStorage` an, auch ohne dass sich jemals jemand anmeldet.
 * Das wäre eine Speicherung auf dem Endgerät im Sinne von §165 TKG und brächte einen Cookie-Banner
 * für eine Seite, die heute bewusst ohne auskommt (dieselbe Überlegung wie bei der
 * Partner-Attribution, B16-1). Es gibt hier ohnehin keine Anmeldung: gelesen wird ausschliesslich
 * als `anon`, und der Schlüssel ist öffentlich — er schützt nichts, RLS tut es.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/db-types'

/*
 * LITERALE `process.env.NEXT_PUBLIC_*`-Referenzen sind PFLICHT: Next ersetzt zur Bauzeit genau
 * diese Ausdrücke textuell durch den Wert. Ein dynamischer Zugriff (`process.env[name]`) bliebe im
 * Browser `undefined`. Deshalb je Variable eine eigene, statische Zeile — dieselbe Regel, die
 * `apps/web/lib/env.public.ts` im Kopf beschreibt.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

export type TariffDataClient = SupabaseClient<Database>

/**
 * Der Client — oder `null`, wenn die Umgebung nicht eingerichtet ist.
 *
 * Bewusst KEIN Wurf und KEIN Bauabbruch: Der Rechner ist ohne diese Anbindung vollständig
 * benutzbar (Peak Shaving braucht sie nicht), und ein lokaler Lauf ohne `.env.local` soll ihn nicht
 * lahmlegen. Der fehlende Zugang wird stattdessen als eigener, benannter Zustand nach oben gereicht
 * (`reason: 'not_configured'`) — „wir konnten nicht fragen" ist eine andere Aussage als „es gibt
 * keine Preise", und die beiden dürfen sich nicht vermischen (Delta 15, zwei Fehlerarten).
 */
export function createTariffDataClient(): TariffDataClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

/** Ist die Anbindung überhaupt eingerichtet? Für Diagnose/Anzeige, ohne einen Client zu bauen. */
export function isTariffDataConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
}

/** Einheitliches Fehlerergebnis beider Abfragen. */
export type TariffDataFailure = {
  ok: false
  /**
   * `not_configured` — die Umgebungsvariablen fehlen (unsere Seite, Einrichtungsfehler).
   * `request_failed` — die Abfrage lief, kam aber nicht durch (Netz, RLS, Zeitüberschreitung).
   *
   * Ausdrücklich KEIN dritter Wert für „keine Zeilen gefunden": eine leere Antwort ist eine gültige
   * Antwort (B21-1: existiert für einen Zeitraum keine Tarifzeile, gibt es keine Berechnungs-
   * grundlage — das ist ein Ergebnis, kein Fehler).
   */
  reason: 'not_configured' | 'request_failed'
  message: string
}

export const NOT_CONFIGURED: TariffDataFailure = {
  ok: false,
  reason: 'not_configured',
  message:
    'Die Verbindung zu den Tarif- und Preisdaten ist nicht eingerichtet ' +
    '(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY fehlen).',
}

export function requestFailed(message: string): TariffDataFailure {
  return { ok: false, reason: 'request_failed', message }
}
