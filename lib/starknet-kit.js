/**
 * StarknetKit mobile wallet wrapper for Ownerz DataVaultz.
 * Client-only: all window access guarded, dynamic imports inside functions
 * to avoid SSR bundling of starknetkit's 2.5MB + WalletConnect.
 *
 * Keeps STRK20 / WalletAccountV6 in lib/starknet.js — this file only
 * handles wallet discovery via WalletConnect / QR / deeplink on mobile.
 */

// Re-export disconnect for symmetry (dynamic under the hood)
export async function disconnectKit(opts) {
  if (typeof window === 'undefined') return
  try {
    const { disconnect } = await import('starknetkit')
    await disconnect(opts)
  } catch (e) {
    console.warn('starknetkit disconnect failed', e)
  }
}

/**
 * Detect if we're inside Ready/Argent mobile in-app browser.
 * Tries starknetkit's helper first, falls back to UA sniff.
 * Safe on SSR (returns false).
 */
export async function isInReadyAppBrowser() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  try {
    const mod = await import('starknetkit/argentMobile')
    if (mod?.isInArgentMobileAppBrowser) {
      return mod.isInArgentMobileAppBrowser()
    }
  } catch (_) {
    // fall through to UA check
  }
  const ua = navigator.userAgent || ''
  return /ReadyWallet|Ready\s*Wallet|Argent/i.test(ua)
}

/**
 * Synchronous UA helper for quick mobile checks without async.
 * Used by pages/index.js before deciding to open Kit modal.
 */
export function isMobileBrowser() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return /Mobi|Android/i.test(navigator.userAgent) || window.matchMedia('(max-width:768px)').matches
}

/**
 * Connect via StarknetKit modal (WalletConnect / QR / deeplink).
 * - Client-only (returns null on SSR)
 * - Dynamic imports to keep bundle SSR-safe
 * - Returns StarknetWindowObject (wallet) or null
 *
 * @param {Object} opts
 * @param {"alwaysAsk"|"canAsk"|"neverAsk"} opts.modalMode
 * @param {"light"|"dark"|"system"} opts.modalTheme
 * @returns {Promise<import('@starknet-io/types-js').StarknetWindowObject|null>}
 */
export async function connectViaKit({ modalMode = 'alwaysAsk', modalTheme = 'system' } = {}) {
  if (typeof window === 'undefined') return null

  // Dynamic imports — keeps SSR build clean (starknetkit pulls WalletConnect)
  const [{ connect: skConnect }, { InjectedConnector }, argentMobileMod, webWalletMod] = await Promise.all([
    import('starknetkit'),
    import('starknetkit/injected'),
    import('starknetkit/argentMobile'),
    import('starknetkit/webwallet').catch(() => ({ WebWalletConnector: null })),
  ])

  const { ArgentMobileConnector } = argentMobileMod
  const { WebWalletConnector } = webWalletMod || {}

  const dappName = 'Ownerz DataVaultz'
  const url = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'
  const rpcUrl = process.env.NEXT_PUBLIC_STARKNET_RPC || undefined
  // Use demo projectId if not set — WalletConnect still works but rate-limited
  const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'f2e613881f7a0e811295cdd57999e31b'

  const connectors = [
    ArgentMobileConnector.init({
      options: {
        dappName,
        url,
        chainId: 'SN_SEPOLIA',
        rpcUrl,
        projectId,
      },
    }),
    new InjectedConnector({ options: { id: 'argentX' } }),
    new InjectedConnector({ options: { id: 'braavos' } }),
  ]
  // WebWallet fallback for mobile web without app install (no WC needed)
  if (WebWalletConnector) {
    try {
      connectors.push(new WebWalletConnector({ url: 'https://web.ready.co' }))
    } catch {}
  }

  try {
    const result = await skConnect({
      connectors,
      modalMode,
      modalTheme,
    })
    // result: { wallet, connector, connectorData }
    return result?.wallet ?? null
  } catch (err) {
    console.warn('starknetkit connect failed', err)
    return null
  }
}
