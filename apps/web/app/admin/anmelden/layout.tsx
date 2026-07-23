import type { ReactNode } from 'react'
import { AdminRootShell, ADMIN_METADATA } from '@/components/admin/root-shell'

/*
 * Root-Layout des ÖFFENTLICHEN Admin-Eingangs (B17) — bewusst OHNE Zugangsschranke und ohne Rahmen.
 *
 * Es ist ein eigenes Root-Layout und kein gemeinsames mit dem geschützten Zweig: gemessen hat Next
 * bei einem gemeinsamen Elternteil das Skript-Bündel der Admin-Übersicht in das ANONYM ausgelieferte
 * HTML dieser Seite geschrieben. Vollständige Begründung samt Messung und Gegenprobe:
 * `components/admin/root-shell.tsx`.
 *
 * `robots: noindex, nofollow` kommt aus derselben geteilten Metadaten-Konstante wie im geschützten
 * Zweig — die Indexierbarkeit des Bereichs hat damit weiterhin genau EINEN Fundort. Den Titel
 * überschreibt die Seite selbst.
 */

export const metadata = ADMIN_METADATA

export default function AdminAnmeldenLayout({ children }: { children: ReactNode }) {
  return <AdminRootShell>{children}</AdminRootShell>
}
