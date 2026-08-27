/**
 * Starknet wallet connection module for Ownerz.
 * Uses get-starknet v6 + starknet.js v10.7.0 (WalletAccountV6).
 * 
 * CRITICAL: This dapp never touches viewing keys.
 * The user's wallet acts on its behalf via starknet.js.
 * 
 * STRK20 integration pattern (from Philoxenia & strk20-by-example.org):
 * 1. walletV6.requestAccounts(wallet) — registers dapp with Starknet Wallet API
 * 2. walletV6.supportedWalletApi(wallet) — detects STRK20 capability (>= 0.10)
 * 3. WalletAccountV6.connect(provider, wallet) — creates WalletAccountV6
 * 4. account.strk20InvokeTransaction(actions) — sends STRK20 tx (no waitForTransaction)
 */

import { createStore } from '@starknet-io/get-starknet-discovery'
import { WalletAccountV6, walletV6, RpcProvider, constants as SNconstants } from 'starknet'

// RPC provider URL (from env or fallback to public Sepolia)
const RPC_URL = process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8'

// Create a proper RpcProvider instance (NOT a config object)
const provider = new RpcProvider({ nodeUrl: RPC_URL })

/**
 * Get available wallets from get-starknet discovery.
 * On mobile, wallets may inject their providers after page load,
 * so we check both the store and window.starknet directly.
 * @returns {Promise<Array>} List of available wallets
 */
export async function getAvailableWallets() {
  try {
    const store = createStore()
    store._refreshInjectedWallets?.()
    let wallets = store.getWallets() || []

    // Mobile fallback: check window.starknet directly if store is empty
    if (wallets.length === 0 && typeof window !== 'undefined' && window.starknet) {
      console.log('Fallback: found window.starknet on mobile')
      wallets = [window.starknet]
    }

    if (wallets.length > 0) {
      console.log('Available wallets:', wallets.map(w => ({
        name: w.name,
        id: w.id,
        features: w.features
      })))
    }
    return wallets
  } catch (error) {
    console.error('Failed to get wallets:', error)
    return []
  }
}

/**
 * Wait for a wallet to become available (mobile-friendly).
 * Retries detection with exponential backoff.
 * @param {number} maxAttempts - Max retry attempts (default 5)
 * @param {number} intervalMs - Base interval in ms (default 500)
 * @returns {Promise<Array>} List of available wallets
 */
export async function waitForWallets(maxAttempts = 5, intervalMs = 500) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const wallets = await getAvailableWallets()
    if (wallets.length > 0) return wallets
    
    // Exponential backoff: 500ms, 1000ms, 2000ms, 4000ms, 8000ms
    // Only warn after first retry to avoid spam on fast injection
    const delay = intervalMs * Math.pow(2, attempt)
    if (attempt >= 1) {
      console.log(`No wallets found (attempt ${attempt + 1}/${maxAttempts}), retrying in ${delay}ms...`)
    }
    await new Promise(r => setTimeout(r, delay))
  }
  return []
}

/**
 * Subscribe to wallet injection events (mobile-friendly).
 * Some wallets inject their provider after page load.
 * @param {Function} onWalletFound - Callback when a wallet is detected
 * @returns {Function} Cleanup function
 */
export function onWalletInjected(onWalletFound) {
  if (typeof window === 'undefined') return () => {}

  const handler = () => {
    if (window.starknet) {
      console.log('Wallet injected via event')
      onWalletFound(window.starknet)
    }
  }

  // Listen for custom events some wallets dispatch
  window.addEventListener('starknet#initialized', handler)
  window.addEventListener('wallet-detected', handler)

  // Also poll as a safety net (some wallets don't dispatch events)
  const pollInterval = setInterval(async () => {
    const wallets = await getAvailableWallets()
    if (wallets.length > 0) {
      onWalletFound(wallets[0])
      clearInterval(pollInterval)
    }
  }, 2000)

  // Stop polling after 30 seconds
  const stopTimeout = setTimeout(() => clearInterval(pollInterval), 30000)

  return () => {
    window.removeEventListener('starknet#initialized', handler)
    window.removeEventListener('wallet-detected', handler)
    clearInterval(pollInterval)
    clearTimeout(stopTimeout)
  }
}

/**
 * Check if a wallet supports STRK20 privacy protocol.
 * Uses walletV6.supportedWalletApi() — wallet API >= 0.10 = STRK20-capable.
 * Never probe strk20Balances for detection (it triggers user consent prompt).
 * @param {Object} wallet - WalletWithStarknetFeatures object
 * @returns {Promise<{ capable: boolean, versions: string[] }>} Capability info
 */
export async function detectStrk20Capability(wallet) {
  try {
    // Wake the extension first (helps Firefox)
    try {
      await walletV6.requestAccounts(wallet)
    } catch { /* still try supportedWalletApi */ }

    const versions = (await walletV6.supportedWalletApi(wallet)).map(String)
    console.log('Wallet API versions:', versions)

    // wallet API >= 0.10 = STRK20-capable
    const capable = versions.some(v => {
      const cleaned = v.replace(/^v/i, '')
      const [majS, minS] = cleaned.split('.')
      const maj = Number(majS)
      const min = Number(minS)
      if (!Number.isFinite(maj)) return false
      if (maj > 0) return true
      if (maj === 0 && Number.isFinite(min) && min >= 10) return true
      return false
    })

    // Fallback: if versions array is empty or detection fails, check wallet name
    // Ready (Argent X) and Argent X are known to support STRK20
    if (!capable) {
      const name = (wallet.name || '').toLowerCase()
      const id = (wallet.id || '').toLowerCase()
      if (name.includes('ready') || name.includes('argent') || id.includes('ready') || id.includes('argent')) {
        console.log('[detectStrk20Capability] Fallback: wallet name/id indicates Ready/Argent, assuming STRK20 capable')
        return { capable: true, versions: ['fallback-ready'] }
      }
    }

    return { capable, versions }
  } catch (error) {
    console.warn('Could not detect STRK20 capability:', error)
    // Last resort: if wallet name suggests Ready/Argent, assume capable
    const name = (wallet?.name || '').toLowerCase()
    const id = (wallet?.id || '').toLowerCase()
    if (name.includes('ready') || name.includes('argent') || id.includes('ready') || id.includes('argent')) {
      console.log('[detectStrk20Capability] Fallback after error: assuming STRK20 capable for Ready/Argent')
      return { capable: true, versions: ['fallback-ready'] }
    }
    return { capable: false, versions: [] }
  }
}

/**
 * Legacy helper kept for backward compat — returns boolean only.
 */
export async function isStrk20Capable(wallet) {
  const result = await detectStrk20Capability(wallet)
  return result.capable
}

/**
 * Connect to a Starknet wallet and return WalletAccountV6.
 * @param {Object} wallet - WalletWithStarknetFeatures object (from getAvailableWallets)
 * @returns {Promise<Object>} { account, address, isStrk20 }
 */
export async function connectWallet(wallet) {
  try {
    // Log wallet structure for debugging
    console.log('[connectWallet] Wallet structure:', {
      name: wallet.name,
      id: wallet.id,
      hasFeatures: !!wallet.features,
      featuresKeys: wallet.features ? Object.keys(wallet.features) : [],
      hasStandardConnect: wallet.features && !!wallet.features['standard:connect'],
      hasProvider: !!wallet.provider,
      hasRequest: typeof wallet.request === 'function'
    })

    // Try WalletAccountV6.connect first (standard Wallet API)
    try {
      const account = await WalletAccountV6.connect(provider, wallet)
      const address = account.address
      const isStrk20 = await isStrk20Capable(wallet)
      return { account, address, isStrk20, wallet }
    } catch (e) {
      console.warn('[connectWallet] WalletAccountV6.connect failed, trying fallback:', e.message)
      
      // Fallback: try to use wallet's provider directly if available
      if (wallet.provider) {
        try {
          const { WalletAccount } = await import('starknet')
          const account = await WalletAccount.connect(provider, wallet)
          const address = account.address
          const isStrk20 = await isStrk20Capable(wallet)
          return { account, address, isStrk20, wallet }
        } catch (e2) {
          console.warn('[connectWallet] WalletAccount fallback failed:', e2.message)
        }
      }
      
      // Last resort: try legacy WalletAccount (for older wallets)
      try {
        const { WalletAccount } = await import('starknet')
        const account = await WalletAccount.connect(provider, wallet)
        const address = account.address
        const isStrk20 = await isStrk20Capable(wallet)
        return { account, address, isStrk20, wallet }
      } catch (e2) {
        console.error('[connectWallet] All connection methods failed:', e2.message)
        throw new Error(`Wallet connection failed: ${e2.message}`)
      }
    }
  } catch (error) {
    console.error('Wallet connection failed:', error)
    throw new Error(`Wallet connection failed: ${error.message}`)
  }
}

/**
 * Resolve a fresh WalletAccountV6 for STRK20 transactions.
 * 
 * Follows Philoxenia's proven pattern:
 * 1. Discover wallets via get-starknet discovery
 * 2. walletV6.requestAccounts(selected) — registers dapp with Wallet API
 * 3. walletV6.supportedWalletApi(selected) — detects STRK20 capability
 * 4. WalletAccountV6.connect(provider, selected) — creates account
 * 
 * @param {string} preferredAddress - Address to match
 * @returns {Promise<Object|null>} { wallet, account, isStrk20, walletApiVersions }
 */
export async function resolvePrivacyWallet(preferredAddress) {
  try {
    const store = createStore()
    store._refreshInjectedWallets?.()
    const wallets = store.getWallets()

    if (wallets.length === 0) {
      console.log('No wallets found')
      return null
    }

    // Find the wallet matching the preferred address
    let selected = null
    if (preferredAddress) {
      for (const w of wallets) {
        try {
          const accounts = await walletV6.requestAccounts(w)
          if (accounts.some(a => {
            try {
              return BigInt(a) === BigInt(preferredAddress)
            } catch { return false }
          })) {
            selected = w
            break
          }
        } catch { /* try next */ }
      }
    }

    // Fallback: prefer Ready, then first available
    selected = selected || wallets.find(w => {
      const name = (w.name || '').toLowerCase()
      return name.includes('ready')
    }) || wallets[0]

    if (!selected) return null

    // CRITICAL: Register dapp with wallet via Wallet API BEFORE connecting.
    // This matches Philoxenia's flow and is required for STRK20 to work.
    // Without this, the wallet popup appears but the promise never resolves.
    console.log('Registering dapp with wallet via wallet_requestAccounts...')
    try {
      await walletV6.requestAccounts(selected)
    } catch {
      // Wallet may already be registered — continue anyway
    }

    // Detect STRK20 capability via wallet API versions
    const { capable: privacyCapable, versions: walletApiVersions } = await detectStrk20Capability(selected)
    console.log('STRK20 capable:', privacyCapable, 'versions:', walletApiVersions)

    // Create the WalletAccountV6
    const account = await WalletAccountV6.connect(provider, selected)

    return {
      wallet: selected,
      account,
      isStrk20: privacyCapable,
      walletApiVersions
    }
  } catch (error) {
    console.error('Failed to resolve privacy wallet:', error)
    return null
  }
}

/**
 * STRK20 invoke via WalletAccountV6 with timeout handling.
 * 
 * Ready X wallet bug: wallet_strk20InvokeTransaction processes the tx
 * but never sends the response back. The popup appears, user confirms,
 * tx is submitted on-chain, but the promise hangs forever.
 * 
 * Solution (from strk20-by-example.org):
 * "Give waitForTransaction a ceiling. Race it against a timeout and
 * treat the timeout as 'submitted' — the explorer link is the fallback."
 * 
 * @param {Object} account - WalletAccountV6 instance (from resolvePrivacyWallet)
 * @param {Array} actions - STRK20 actions [{type, token, amount, recipient?}]
 * @param {number} timeoutMs - Timeout in ms (default 45s — ZK proof gen can be slow)
 * @returns {Promise<Object>} { transaction_hash } or throws after timeout
 */
export async function strk20InvokeViaWalletApi(account, actions, timeoutMs = 45000) {
  console.log('strk20InvokeViaWalletApi called')
  console.log('Actions:', JSON.stringify(actions, (k, v) => typeof v === 'bigint' ? v.toString() : v))

  // Race the wallet API call against a timeout
  // If Ready X responds within timeout → use the hash
  // If timeout → assume tx was submitted (Ready X bug) and let user verify on explorer
  const walletApi = account?.v6Provider?.features?.['starknet:walletApi']

  const walletPromise = walletApi && typeof walletApi.request === 'function'
    ? walletApi.request({
        type: 'wallet_strk20InvokeTransaction',
        params: { actions }
      })
    : account.strk20InvokeTransaction(actions)

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('WALLET_TIMEOUT')), timeoutMs)
  })

  try {
    const result = await Promise.race([walletPromise, timeoutPromise])
    console.log('STRK20 result:', result)

    // If result is missing transaction_hash, the user likely rejected the tx
    if (!result || !result.transaction_hash) {
      console.warn('STRK20 wallet returned no transaction_hash — user likely rejected')
      throw new Error('USER_REFUSED_OP')
    }

    return result
  } catch (err) {
    if (err.message === 'WALLET_TIMEOUT') {
      console.warn('STRK20 wallet response timeout — tx was likely submitted on-chain')
      return {
        transaction_hash: null,
        pending: true,
        message: 'Transaction submitted to wallet. Check explorer for status.'
      }
    }
    throw err
  }
}

/**
 * Subscribe to wallet account changes.
 * @param {Function} onChange - Callback when account/network changes
 * @returns {Function} Unsubscribe function
 */
export function onWalletChange(onChange) {
  return () => {}
}

export { RpcProvider }
