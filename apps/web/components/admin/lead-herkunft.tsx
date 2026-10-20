import { AdminPanel, AdminSection, formatDateTime } from '@/components/admin/ui'
import { Num } from '@/components/ui/layout'
import type {
  AttributionTouch,
  LeadAttribution,
  ProfiReportRequestRow,
} from '@/lib/admin/lead-attribution'
import type { AttributionChannel } from '@/lib/attribution/attribution'
import type { LoadProfileAnswer } from '@/lib/profi-report/request'

const CHANNEL_LABEL: Record<AttributionChannel, string> = {
  schnellreport: 'Schnellreport',
  profi_report: 'Profi-Report-Anfrage',
  kontakt: 'Kontaktformular',
}

const LOAD_PROFILE_LABEL: Record<LoadProfileAnswer, string> = {
  ja: 'ja',
  nein: 'nein',
  unsicher: 'weiß nicht',
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-small text-ink">{children}</dd>
    </div>
  )
}

function TouchItems({ touch }: { touch: AttributionTouch }) {
  const direct = !touch.utmSource && !touch.referrerHost
  return (
    <>
      <Item label="Zeitpunkt">
        <Num>{formatDateTime(touch.createdAt)}</Num>
      </Item>
      <Item label="Quelle / Medium / Kampagne">
        {touch.utmSource
          ? [touch.utmSource, touch.utmMedium ?? '–', touch.utmCampaign ?? '–'].join(' / ')
          : direct
            ? 'direkt'
            : '—'}
      </Item>
      <Item label="Einstieg">{touch.landingPath ?? '—'}</Item>
      <Item label="Verweis von">{touch.referrerHost ?? '—'}</Item>
      {touch.utmContent && <Item label="utm_content">{touch.utmContent}</Item>}
      {touch.utmTerm && <Item label="utm_term">{touch.utmTerm}</Item>}
    </>
  )
}

/** Zelle „Herkunft (UTM)" der Lead-Liste: utm_source des first touch, darunter die Kampagne. */
export function LeadUtmCell({
  source,
  campaign,
}: {
  source: string | null
  campaign: string | null
}) {
  if (!source) return null
  return (
    <>
      {source}
      {campaign && <span className="block text-caption text-text-muted">{campaign}</span>}
    </>
  )
}

/** Abschnitt „Herkunft" der Admin-Lead-Detailseite (Leadgen 5): first touch und je Absendung. */
export function LeadHerkunft({ attribution }: { attribution: LeadAttribution }) {
  return (
    <AdminSection
      id="herkunft"
      title="Herkunft"
      description="UTM-Parameter, Einstiegsseite und verweisende Website. Der first touch ist die erste erfasste Absendung und ändert sich danach nicht; jede Absendung trägt ihre eigene Herkunft."
    >
      <div className="space-y-4">
        <AdminPanel>
          <h3 className="text-h4 text-ink">First touch</h3>
          {attribution.firstTouch ? (
            <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <TouchItems touch={attribution.firstTouch} />
            </dl>
          ) : (
            <p className="mt-2 text-small text-text-muted">
              Noch keine Herkunft erfasst (Lead vor der Messung oder ohne Absendung über die
              Website).
            </p>
          )}
        </AdminPanel>
        {attribution.touches.map((touch) => (
          <AdminPanel key={touch.id}>
            <h3 className="text-h4 text-ink">{CHANNEL_LABEL[touch.channel]}</h3>
            <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <TouchItems touch={touch} />
            </dl>
          </AdminPanel>
        ))}
      </div>
    </AdminSection>
  )
}

/** Abschnitt „Profi-Report" (Leadgen 5): die Lastgang-Angabe je Anfrage. Entfällt ohne Anfrage. */
export function LeadProfiReport({ rows }: { rows: ProfiReportRequestRow[] }) {
  if (rows.length === 0) return null
  return (
    <AdminSection
      id="profi-report"
      title="Profi-Report"
      description="Anfragen über /profi-report, neueste zuerst."
    >
      <div className="space-y-4">
        {rows.map((row) => (
          <AdminPanel key={row.id}>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Item label="Zeitpunkt">
                <Num>{formatDateTime(row.createdAt)}</Num>
              </Item>
              <Item label="Lastgang vorhanden">{LOAD_PROFILE_LABEL[row.hasLoadProfile]}</Item>
            </dl>
          </AdminPanel>
        ))}
      </div>
    </AdminSection>
  )
}
