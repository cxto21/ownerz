/**
 * Starknet wallet connection module for Ownerz.
 * Uses get-starknet v6 + starknet.js v10.4.0 (WalletAccountV6).
 * 
 * CRITICAL: This dapp never touches viewing keys.
 * The user's wallet acts on its behalf via starknet.js.
 */

import { createStore } from '@starknet-io/get-starknet-discovery'
import { WalletAccountV6, walletV6, RpcProvider } from 'starknet'

// RPC provider URL (from env or fallback to public)
const RPC_URL = process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://starknet-mainnet.public.blastapi.io/rpc/v0_8'

// STRK20-capable wallet detection
const STRK20_MIN_API_VERSION = '0.10.3'

/**
 * Get available wallets from get-starknet discovery.
 * @returns {Promise<Array>} List of available wallets
 */
export async function getAvailableWallets() {
  try {
    const store = createStore()
    const wallets = store.getWallets()
    return wallets || []
  } catch (error) {
    console.error('Failed to get wallets:', error)
    return []
  }
}

/**
 * Check if a wallet supports STRK20 privacy protocol.
 * @param {Object} wallet - WalletWithStarknetFeatures object
 * @returns {Promise<boolean>} True if wallet supports STRK20
 */
export async function isStrk20Capable(wallet) {
  try {
    // Check if wallet has STRK20-related features
    // The wallet should expose strk20InvokeTransaction if capable
    const features = wallet.features || []
    const hasStrk20 = features.some(f => 
      f.includes('strk20') || f.includes('privacy') || f.includes('walletApi')
    )
    
    // Also check if the wallet reports STRK20 support
    if (wallet.strk20 || wallet.privacy) {
      return true
    }
    
    // Try to detect via wallet API version
    // Ready and Xverse wallets support STRK20
    const walletName = (wallet.name || '').toLowerCase()
    if (walletName.includes('ready') || walletName.includes('xverse')) {
      return true
    }
    
    return false
  } catch (error) {
    console.warn('Could not detect STRK20 capability:', error)
    return false
  }
}

/**
 * Connect to a Starknet wallet and return WalletAccountV6.
 * @param {Object} wallet - WalletWithStarknetFeatures object (from getAvailableWallets)
 * @returns {Promise<Object>} { account, address, chainId, isStrk20 }
 */
export async function connectWallet(wallet) {
  try {
    const provider = new RpcProvider({ nodeUrl: RPC_URL })
    
    // Connect WalletAccountV6
    const account = await WalletAccountV6.connect(
      { nodeUrl: RPC_URL },
      wallet
    )
    
    // Get address
    const address = account.address
    
    // Get chain ID from provider (not from account)
    const chainId = await provider.getChainId()
    
    // Check STRK20 capability
    const isStrk20 = await isStrk20Capable(wallet)
    
    return {
      account,
      address,
      chainId,
      isStrk20,
      wallet
    }
  } catch (error) {
    console.error('Wallet connection failed:', error)
    throw new Error(`Wallet connection failed: ${error.message}`)
  }
}

/**
 * Get the current connected wallet account from window.
 * Useful for reconnecting on page reload.
 * @returns {Promise<Object|null>} Connected account or null
 */
export async function getConnectedAccount() {
  try {
    const store = createStore()
    const wallets = store.getWallets()
    
    // Find a wallet that's already connected
    for (const wallet of wallets) {
      if (wallet.isConnected) {
        const provider = new RpcProvider({ nodeUrl: RPC_URL })
        const account = await WalletAccountV6.connect(
          { nodeUrl: RPC_URL },
          wallet
        )
        return account
      }
    }
    
    return null
  } catch (error) {
    console.warn('No connected account found:', error)
    return null
  }
}

/**
 * Subscribe to wallet account changes.
 * @param {Function} onChange - Callback when account/network changes
 * @returns {Function} Unsubscribe function
 */
export function onWalletChange(onChange) {
  // This will be set up after connection
  return () => {} // Placeholder - actual subscription happens in component
}

export { RpcProvider }
