import { createTranslator } from 'next-intl'
import messages from '@/messages/de.json'
import { AdminPanel, AdminSection, formatDateTime } from '@/components/admin/ui'
import { Num } from '@/components/ui/layout'
import { isBrancheKey } from '@/lib/schnellreport/branchen'
import { formatGrouped } from '@/lib/schnellcheck'
import type { SchnellreportRequestRow } from '@/lib/admin/schnellreport-requests'

const tReport = createTranslator({ locale: 'de', messages, namespace: 'Schnellreport' })

function brancheLabel(key: string): string {
  return isBrancheKey(key) ? tReport(`branchen.${key}.label`) : key
}

function tipsLabel(row: SchnellreportRequestRow): string {
  if (!row.tipsRequested) return 'nicht angefordert'
  return row.tipsConfirmed ? 'angefordert, bestätigt' : 'angefordert, noch nicht bestätigt'
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-small text-ink">{children}</dd>
    </div>
  )
}

/** Abschnitt „Schnellcheck" der Admin-Lead-Detailseite (3b-3). Nur lesend, entfällt ohne Werte. */
export function LeadSchnellcheck({ rows }: { rows: SchnellreportRequestRow[] }) {
  if (rows.length === 0) return null

  return (
    <AdminSection
      id="schnellcheck"
      title="Schnellcheck"
      description="Werte aus dem Schnellcheck, mit denen der Schnellreport per E-Mail erzeugt wurde — serverseitig nachgerechnet, neueste zuerst."
    >
      <div className="space-y-4">
        {rows.map((row) => (
          <AdminPanel key={row.id}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Zeitpunkt">
                <Num>{formatDateTime(row.createdAt)}</Num>
              </Item>
              <Item label="Land">{row.country === 'AT' ? 'Österreich' : 'Deutschland'}</Item>
              <Item label="Branche">{brancheLabel(row.branche)}</Item>
              <Item label="Jahresverbrauch">
                <Num>{formatGrouped(row.annualKwh)} kWh</Num>
              </Item>
              <Item label="Höchste Leistung">
                <Num>{formatGrouped(row.peakKw)} kW</Num>
                {!row.peakKwEntered && <span className="text-text-muted"> (Reglerwert)</span>}
              </Item>
              <Item label="Stromrechnung">
                {row.billEur === null ? '—' : <Num>{formatGrouped(row.billEur)} € pro Jahr</Num>}
              </Item>
              <Item label="Leistungspreis">
                <Num>{formatGrouped(row.demandPriceEurPerKw)} €/kW·a</Num>
              </Item>
              <Item label="Ergebnis (Spitzenkosten)">
                <Num>{formatGrouped(row.peakCostEur)} € pro Jahr</Num>
              </Item>
              <Item label="Rückruf gewünscht">{row.callbackRequested ? 'ja' : 'nein'}</Item>
              <Item label="Tipp-Mails">{tipsLabel(row)}</Item>
            </dl>
          </AdminPanel>
        ))}
      </div>
    </AdminSection>
  )
}
