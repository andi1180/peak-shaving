import { AdminError } from '@/components/admin/ui'
import type { LevyCoverageNotice } from '@/lib/admin/levy-coverage'

/** Warnbalken für auslaufende Abgabensätze — ohne Hinweis kein DOM. */
export function LevyCoverageBanner({ notices }: { notices: readonly LevyCoverageNotice[] }) {
  if (notices.length === 0) return null
  return (
    <div className="mt-6 flex flex-col gap-3">
      {notices.map((notice) =>
        notice.tone === 'expired' ? (
          <AdminError key={notice.text}>{notice.text}</AdminError>
        ) : (
          <div
            key={notice.text}
            role="status"
            className="rounded-md border border-warning-border bg-warning-subtle p-3"
          >
            <p className="text-small font-medium text-ink">{notice.text}</p>
          </div>
        ),
      )}
    </div>
  )
}
