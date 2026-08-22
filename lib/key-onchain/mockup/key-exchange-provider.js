/**
 * KeyExchange Mockup Provider (FileVault v2)
 *
 * Implements the key-onchain abstract interface via FileVault contract
 * which delegates lock/unlock/read_lock to KeyExchangeMockup on-chain.
 *
 * This provider hides the dual-contract complexity from components.
 * SellFlow/BuyFlow only see lock/unlock/readLock.
 */

import { Contract, RpcProvider } from 'starknet'
import FileVaultABI from '../../filevault-abi.json'

const FileVaultABIResolved = FileVaultABI?.default ?? FileVaultABI

// Addresses from env
const STRK_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_STRK_TOKEN ||
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

const DEFAULT_RPC =
  process.env.NEXT_PUBLIC_STARKNET_RPC ||
  'https://starknet-sepolia.public.blastapi.io/rpc/v0_8'

/**
 * Create a KeyExchange mockup provider backed by FileVault.
 * @param {Object} opts
 * @param {string} opts.contractAddress - FileVault address (also accepts NEXT_PUBLIC_FILEVAULT_ADDRESS)
 * @param {RpcProvider} opts.provider - Starknet provider for reads
 * @returns {{ lock, unlock, readLock, getFee, deploy }}
 */
export function createKeyExchangeMockupProvider({ contractAddress, provider }) {
  const fileVaultAddress =
    contractAddress ||
    process.env.NEXT_PUBLIC_FILEVAULT_ADDRESS ||
    process.env.NEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS // fallback legacy

  const readProvider = provider || new RpcProvider({ nodeUrl: DEFAULT_RPC })

  // Cache on-chain ABI to handle v1 vs v2 divergence (deployed v1 returns Vault alone, local v2 returns tuple)
  let onChainAbiCache = null
  async function getOnChainAbi() {
    if (onChainAbiCache) return onChainAbiCache
    try {
      const cls = await readProvider.getClassAt(fileVaultAddress)
      if (cls?.abi) {
        onChainAbiCache = cls.abi
        return onChainAbiCache
      }
    } catch (e) {
      console.warn('[readLock] getClassAt failed, using local ABI', e.message?.slice(0,200))
    }
    return FileVaultABIResolved
  }

  function getContract(accountOrProvider) {
    const p = accountOrProvider || readProvider
    return new Contract({
      abi: FileVaultABIResolved,
      address: fileVaultAddress,
      providerOrAccount: p,
    })
  }

  async function getContractDynamic(accountOrProvider) {
    const p = accountOrProvider || readProvider
    const abi = await getOnChainAbi()
    return new Contract({ abi, address: fileVaultAddress, providerOrAccount: p })
  }

  /**
   * Lock: create vault on FileVault (multicall approve + create_vault)
   * @param {Object} params
   * @param {Object} params.account - WalletAccount
   * @param {string} params.identifier - CID as felt252 (0x...)
   * @param {string} params.commitment - felt252
   * @param {string} params.integrityHash - felt252
   * @param {Object} params.meta - { price: bigint, ttl: number, fee: bigint }
   */
  async function lock({ account, identifier, commitment, integrityHash, meta }) {
    if (!fileVaultAddress) throw new Error('FileVault address not set (NEXT_PUBLIC_FILEVAULT_ADDRESS)')
    if (!account) throw new Error('Wallet account required for lock')

    const price = meta?.price ?? BigInt(0)
    const ttl = meta?.ttl ?? 2592000
    let fee = meta?.fee
    if (fee === undefined) {
      fee = await getFee()
    }
    const feeBig = BigInt(fee)
    const priceBig = BigInt(price)

    const feeHigh = feeBig >> BigInt(128)
    const feeLow = feeBig & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
    const priceHigh = priceBig >> BigInt(128)
    const priceLow = priceBig & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')

    // Multicall: approve STRK fee + create_vault
    // FileVault.create_vault(cid, price, integrity_hash, commitment, ttl)
    const result = await account.execute([
      {
        contractAddress: STRK_TOKEN_ADDRESS,
        entrypoint: 'approve',
        calldata: [fileVaultAddress, feeLow.toString(), feeHigh.toString()],
      },
      {
        contractAddress: fileVaultAddress,
        entrypoint: 'create_vault',
        calldata: [
          identifier,
          priceLow.toString(),
          priceHigh.toString(),
          integrityHash,
          commitment,
          ttl.toString(),
        ],
      },
    ])

    return result
  }

  /**
   * Unlock: claim vault via FileVault.claim_vault
   * @param {Object} params
   * @param {Object} params.account - WalletAccount
   * @param {string} params.identifier - felt252
   * @param {number} params.proof - u16 (secretToOnChain)
   */
  async function unlock({ account, identifier, proof }) {
    if (!fileVaultAddress) throw new Error('FileVault address not set')
    if (!account) throw new Error('Wallet account required for unlock')

    const contract = getContract(account)
    // claim_vault expects (cid: felt252, claim_secret: u16)
    // starknet.js will handle calldata encoding
    const result = await contract.claim_vault(identifier, proof)
    return result

    // Alternative direct execute path (more reliable for some wallets):
    // return await account.execute({
    //   contractAddress: fileVaultAddress,
    //   entrypoint: 'claim_vault',
    //   calldata: [identifier, proof.toString()],
    // })
  }

  /**
   * Read lock state via FileVault.get_vault which returns (Vault, LockState) tuple.
   * Normalized to satisfy both SellFlow/BuyFlow (meta/issuer) and recover.js (isClaimed).
   * @param {string} identifier - felt252
   * @returns {Promise<Object|null>} normalized lock or null if not found
   */
  async function readLock(identifier) {
    if (!fileVaultAddress) {
      console.warn('[readLock] FileVault address not set')
      return null
    }
    try {
      const contract = await getContractDynamic(readProvider)
      const result = await contract.get_vault(identifier)
      // console.log('[readLock] raw result:', JSON.stringify(result, (_, v) => typeof v === 'bigint' ? v.toString() : v))

      // starknet.js returns tuple as array or object depending on ABI
      // For (Vault, LockState) it may be [vault, lock] or {0: vault, 1: lock}
      let vault, lock
      if (Array.isArray(result)) {
        ;[vault, lock] = result
      } else if (result && typeof result === 'object' && '0' in result) {
        vault = result[0]
        lock = result[1]
      } else {
        // Fallback: maybe starknet.js flattened? Try direct properties
        vault = result.vault || result[0]
        lock = result.lock || result[1]
        if (!vault || !lock) {
          // If contract returns single struct (old ABI v1 — has key_seed_ciphertext + commitment), handle gracefully
          vault = result
          // Old ABI stores key_seed_ciphertext as integrityHash equivalent
          const ih = vault.integrity_hash ?? vault.integrityHash ?? vault.key_seed_ciphertext ?? '0x0'
          lock = {
            commitment: vault.commitment,
            integrity_hash: ih,
            integrityHash: ih,
            is_claimed: Number(vault.status) !== 0,
            isClaimed: Number(vault.status) !== 0,
          }
        }
      }

      if (!vault || vault.seller === undefined) {
        // Vault empty — might be old ABI returning 0 seller or failed decode
        console.warn('[readLock] empty vault for identifier', identifier, 'raw:', result)
        return null
      }

      // Normalize vault price (u256 struct) — tolerant for old/new ABI and raw felt vs u256
      let priceBig = BigInt(0)
      try {
        if (vault.price !== undefined && vault.price !== null) {
          if (typeof vault.price === 'object' && vault.price.low !== undefined && vault.price.high !== undefined) {
            const low = vault.price.low ?? 0
            const high = vault.price.high ?? 0
            priceBig = BigInt(low) + (BigInt(high) << BigInt(128))
          } else if (typeof vault.price === 'bigint') {
            priceBig = vault.price
          } else if (typeof vault.price === 'string' || typeof vault.price === 'number') {
            priceBig = BigInt(vault.price)
          } else if (typeof vault.price === 'object' && vault.price !== null) {
            // Fallback: try to stringify
            priceBig = BigInt(String(vault.price))
          }
        }
      } catch (priceErr) {
        console.warn('[readLock] price parse failed, using 0:', vault.price, priceErr.message)
        priceBig = BigInt(0)
      }

      // Lock may have is_claimed as bool or number
      const isClaimed =
        lock?.is_claimed === true ||
        lock?.is_claimed === 1 ||
        Number(vault.status) === 1 ||
        Number(vault.status) === 2

      // Build normalized view
      const normalized = {
        // Raw
        vault,
        lock,
        // Commitment layer
        commitment: lock?.commitment,
        integrityHash: lock?.integrity_hash ?? lock?.integrityHash,
        integrity_hash: lock?.integrity_hash ?? lock?.integrityHash,
        isClaimed,
        is_claimed: isClaimed,
        // Marketplace layer (for BuyFlow)
        issuer: vault.seller,
        seller: vault.seller,
        meta: {
          price: priceBig,
          status: Number(vault.status),
          created_at: vault.created_at,
          createdAt: vault.created_at,
          ttl: vault.ttl,
          commitment: lock?.commitment,
          integrityHash: lock?.integrity_hash ?? lock?.integrityHash,
        },
      }

      return normalized
    } catch (e) {
      // Revert = vault not found
      if (
        e.message?.includes('VAULT_NOT_FOUND') ||
        e.message?.includes('0x5641554c545f4e4f545f464f554e44') ||
        e.message?.includes('not found')
      ) {
        return null
      }
      // For other errors, log and return null to avoid crashing UI
      console.warn('[readLock] error:', e.message?.slice(0, 300))
      return null
    }
  }

  /**
   * Get platform fee via FileVault.get_platform_fee
   */
  async function getFee() {
    if (!fileVaultAddress) return BigInt(500000000000000000) // 0.5 STRK fallback
    try {
      const contract = getContract(readProvider)
      const fee = await contract.get_platform_fee()
      if (fee && typeof fee === 'object' && fee.low !== undefined) {
        return BigInt(fee.low) + (BigInt(fee.high) << BigInt(128))
      }
      return BigInt(fee)
    } catch {
      return BigInt(500000000000000000)
    }
  }

  /**
   * Deploy mock (browser) — for DeploySection.
   * In browser context, deploys via account.declareAndDeploy.
   * For real Sepolia deploys, use scripts/deploy.js with starknet.js Node.
   */
  async function deploy(account) {
    // This is a lightweight browser deploy helper for FileVault.
    // Full dual-deploy (KEX + FileVault) is in scripts/deploy.js.
    if (!account) throw new Error('Wallet not connected')
    throw new Error(
      'Browser deploy is deprecated for v2. Use scripts/deploy.js to deploy KeyExchangeMockup then FileVault. ' +
        'See docs/ for Sepolia steps.'
    )
  }

  return {
    lock,
    unlock,
    readLock,
    getFee,
    deploy,
  }
}

// Aliases for future-proofing
export const createFileVaultProvider = createKeyExchangeMockupProvider
export default createKeyExchangeMockupProvider
