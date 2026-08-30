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
  // Method 1: walletV6.supportedWalletApi (official way per strk20-skills docs)
  try {
    try {
      await walletV6.requestAccounts(wallet)
    } catch { /* wake extension */ }

    const result = walletV6.supportedWalletApi(wallet)
    if (result && typeof result.then === 'function') {
      const versions = (await result).map(String)
      console.log('Wallet API versions (walletV6):', versions)
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
      return { capable, versions }
    }
  } catch (err) {
    console.warn('walletV6.supportedWalletApi failed:', err.message)
  }

  // Method 2: Check wallet.features for known STRK20 feature identifiers
  try {
    const features = wallet?.features || wallet?.InjectedStarknetWallet?.features || []
    const featureList = Array.isArray(features) ? features : Object.keys(features)
    console.log('Wallet features:', featureList)
    // Some wallets advertise strk20 support via feature flags
    const hasStrk20Feature = featureList.some(f =>
      typeof f === 'string' && (f.includes('strk20') || f.includes('starknet:walletApi:0.10'))
    )
    if (hasStrk20Feature) {
      return { capable: true, versions: ['feature-detected'] }
    }
  } catch (err) {
    console.warn('Feature detection failed:', err.message)
  }

  // Method 3: Check wallet.id for known STRK20-capable wallets (Ready X is STRK20-capable)
  try {
    const id = (wallet?.id || '').toLowerCase()
    const name = (wallet?.name || '').toLowerCase()
    // Ready, ArgentX are known STRK20-capable wallets
    const knownCapable = ['ready', 'argent', 'argentx']
    if (knownCapable.some(k => id.includes(k) || name.includes(k))) {
      console.log('STRK20 assumed capable by wallet identity:', id || name)
      return { capable: true, versions: ['identity-detected'] }
    }
  } catch { /* ignore */ }

  console.log('STRK20 capability unknown — defaulting to false')
  return { capable: false, versions: [] }
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
    console.log('connectWallet: wallet object keys:', Object.keys(wallet || {}))
    console.log('connectWallet: wallet.id:', wallet?.id, 'wallet.name:', wallet?.name)

    let account
    let address

    try {
      // Try WalletAccountV6.connect first (standard EIP-6963 / v6 API)
      const acc = await WalletAccountV6.connect(provider, wallet)
      account = acc
      address = acc.address
      console.log('WalletAccountV6.connect succeeded, address:', address)
    } catch (v6Err) {
      console.warn('WalletAccountV6.connect failed:', v6Err.message)

      // Try walletV6.requestAccounts
      try {
        console.log('Trying walletV6.requestAccounts...')
        const accts = await walletV6.requestAccounts(wallet)
        console.log('walletV6.requestAccounts result:', accts)
        const raw = Array.isArray(accts) ? accts[0] : accts
        address = typeof raw === 'string' ? raw : (raw?.address || raw)
        console.log('Resolved address from requestAccounts:', address)
      } catch (reqErr) {
        console.warn('walletV6.requestAccounts failed:', reqErr.message)
      }

      // Fallback: wallet's own methods
      if (!address) {
        try {
          console.log('Trying wallet.enable / wallet.request...')
          if (typeof wallet.enable === 'function') {
            const en = await wallet.enable()
            console.log('wallet.enable result:', en)
            address = Array.isArray(en) ? en[0] : (en?.address || en)
          }
          if (!address && typeof wallet.request === 'function') {
            const accts = await wallet.request({ type: 'wallet_requestAccounts' })
            console.log('wallet.request result:', accts)
            const raw = Array.isArray(accts) ? accts[0] : accts
            address = typeof raw === 'string' ? raw : (raw?.address || raw)
          }
        } catch (enableErr) {
          console.warn('wallet.enable/request failed:', enableErr.message)
        }
      }

      // Fallback: window.starknet direct
      if (!address && typeof window !== 'undefined' && window.starknet) {
        try {
          console.log('Trying window.starknet directly...')
          const ws = window.starknet
          if (typeof ws.request === 'function') {
            const accts = await ws.request({ type: 'wallet_requestAccounts' })
            const raw = Array.isArray(accts) ? accts[0] : accts
            address = typeof raw === 'string' ? raw : (raw?.address || raw)
          }
          if (!address && ws.selectedAddress) {
            address = ws.selectedAddress
          }
          console.log('Resolved from window.starknet:', address)
        } catch (wsErr) {
          console.warn('window.starknet fallback failed:', wsErr.message)
        }
      }

      if (!address) {
        throw new Error('Could not resolve wallet address — check browser console for details')
      }

      // Build a minimal account
      account = {
        address,
        wallet,
        invoke: async (calls) => {
          if (typeof wallet.request === 'function') {
            return await wallet.request({ type: 'wallet_invokeFunction', params: { calls } })
          }
          const { Account } = await import('starknet')
          const tmpAcc = new Account(provider, address, wallet)
          return await tmpAcc.execute(calls)
        },
        signMessage: async (msg) => {
          if (typeof wallet.request === 'function') {
            return await wallet.request({ type: 'wallet_signMessage', params: { message: msg } })
          }
          const { Account } = await import('starknet')
          const tmpAcc = new Account(provider, address, wallet)
          return await tmpAcc.signMessage(msg)
        },
        deployAccount: async (classHash, calldata, salt) => {
          if (typeof wallet.request === 'function') {
            return await wallet.request({ type: 'wallet_deployAccount', params: { classHash, calldata, salt } })
          }
          throw new Error('deployAccount not supported by this wallet')
        },
      }
    }

    // Detect STRK20 — safe fallback to false
    let isStrk20 = false
    try {
      isStrk20 = await isStrk20Capable(wallet)
    } catch { /* ignore */ }

    return { account, address, isStrk20, wallet }
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
