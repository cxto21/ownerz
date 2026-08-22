// lib/ownerz/key-onchain-config.js
// Ownerz Key-Onchain Configuration (MOCKUP v0)
// Uses FileVault v2 which delegates to KeyExchangeMockup.
// Components import from lib/key-onchain/index.js which re-exports from here.

import { RpcProvider } from 'starknet'
import { createKeyExchangeMockupProvider } from '../key-onchain/mockup/key-exchange-provider.js'
import { provider as pedersenProvider } from '../key-onchain/providers/pedersen.js'
import { deployDual } from '../key-onchain/mockup/deploy.js'

const RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_RPC ||
  'https://starknet-sepolia.public.blastapi.io/rpc/v0_8'

const readProvider = new RpcProvider({ nodeUrl: RPC_URL })

/**
 * Ownerz Key-Onchain MOCKUP Configuration
 *
 * Future swap (without touching components):
 * import { createKeyExchangePQProvider } from '../key-onchain/production/pq-provider.js'
 * keyExchange: createKeyExchangePQProvider({ fileVaultAddress, provider: readProvider })
 */
export const ownerzKeyOnchain = {
  // FileVault address is the marketplace entrypoint (delegates to KEX internally)
  // For v2, FILEVAULT_ADDRESS is the primary address; KEX address is stored inside FileVault.
  // We keep KEY_EXCHANGE_MOCKUP_ADDRESS as fallback for read-only verification if needed.
  keyExchange: createKeyExchangeMockupProvider({
    contractAddress:
      process.env.NEXT_PUBLIC_FILEVAULT_ADDRESS ||
      process.env.NEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS,
    provider: readProvider,
  }),

  // Commitment provider (Pedersen mockup)
  commitment: pedersenProvider,

  // Dual deploy helper (KEX + FileVault)
  deployDual,
}

// Convenience re-exports
export const { keyExchange, commitment } = ownerzKeyOnchain
export { deployDual }

export const { lock, unlock, readLock, getFee } = keyExchange

export const {
  computeCommitment,
  verifyCommitment,
  secretToOnChain,
  computeIntegrityHash,
  identifierToFelt,
} = commitment

// Direct deploy for DeploySection (dual-contract)
export async function deploy(account) {
  return deployDual(account)
}
