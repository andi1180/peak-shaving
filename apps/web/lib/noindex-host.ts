import { isAccessHostRequest } from '@/lib/access-host'
import { normalizeHost, type HostHeaders } from '@/lib/host-match'
import { isPortalHostRequest } from '@/lib/portal-host'

const VERCEL_HOST_SUFFIX = '.vercel.app'

function isVercelHost(host: string | null): boolean {
  return normalizeHost(host).endsWith(VERCEL_HOST_SUFFIX)
}

/**
 * Darf diese Anfrage nicht in den Suchindex? Namentlich benannte Hosts statt „alles ausser www",
 * damit localhost und unbekannte Hosts unverändert bleiben; `x-forwarded-host` wie in `host-match`.
 */
export function isNoindexHostRequest(headers: HostHeaders): boolean {
  return (
    isPortalHostRequest(headers) ||
    isAccessHostRequest(headers) ||
    isVercelHost(headers.get('host')) ||
    isVercelHost(headers.get('x-forwarded-host'))
  )
}
