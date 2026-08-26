export const runtime = 'edge'

import { getRequestContext } from '@cloudflare/next-on-pages'

export default async function handler() {
  let tlsVersion = ''
  try {
    tlsVersion = getRequestContext().cf?.tlsVersion || ''
  } catch {
    tlsVersion = ''
  }
  return new Response(
    JSON.stringify({ tlsVersion: tlsVersion || 'unknown', tls13: tlsVersion === 'TLSv1.3' }),
    { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
  )
}
