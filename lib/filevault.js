import { Contract } from 'starknet'
import FileVaultABI from './filevault-abi.json'
import { config, STRK_TOKEN_ADDRESS as _STRK_TOKEN_ADDRESS } from '../sdk/core/config'
import { getReadProvider } from '../sdk/core/provider'

if (typeof window !== 'undefined') {
  console.log('[filevault] ABI loaded:', Array.isArray(FileVaultABI), FileVaultABI?.length, 'entries')
}

const VAULT_ADDRESS = config.fileVaultAddress
const KEX_ADDRESS = config.keyExchangeAddress
const STRK_TOKEN_ADDRESS = _STRK_TOKEN_ADDRESS

// Direct RPC provider for read-only calls (bypasses wallet)
const readProvider = getReadProvider()

/**
 * Get the platform fee from the vault contract
 * @returns {Promise<bigint>} Fee in wei
 */
export async function getPlatformFee() {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set')
  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider })
    const fee = await contract.get_platform_fee()
    return typeof fee === 'object' && fee.low !== undefined
      ? BigInt(fee.low) + (BigInt(fee.high) << BigInt(128))
      : BigInt(fee)
  } catch {
    return BigInt(500000000000000000) // default 0.5 STRK
  }
}

/**
 * Create a new vault on the FileVault contract.
 * Uses multicall: approve STRK fee + create_vault in ONE transaction = one wallet popup.
 * FileVault v2.1 signature: create_vault(cid, price:u256, integrity_hash:felt, commitment:felt, ttl:u64, pqc:bool)
 * platform_fee_bps hardcoded to 100 (1%) inside contract.
 * @param {Object} account - WalletAccountV6 instance
 * @param {Object} params - Vault parameters
 * @param {string} params.cid - Content identifier (felt252)
 * @param {bigint} params.price - Price in STRK smallest units (u256)
 * @param {string} params.integrityHash - integrity_hash (felt252) — hash of keySeedCiphertext
 * @param {string} params.commitment - Commitment hash (felt252)
 * @param {string} params.keySeedCiphertext - Legacy alias: if integrityHash not provided, will be hashed to produce it
 * @param {number} params.ttl - Time to live in seconds
 * @param {bigint} params.fee - Platform fee in wei to approve
 * @param {boolean} params.pqc - PQC flag from edge TLS (non-modifiable)
 * @returns {Promise<Object>} Transaction result
 */
export async function createVault(account, { cid, price, integrityHash, integrity_hash, commitment, keySeedCiphertext, ttl, fee, pqc }) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set')

  // Backwards compat: if caller passes keySeedCiphertext, derive integrityHash via SHA-256 truncated to 31 bytes
  let ih = integrityHash || integrity_hash
  if (!ih && keySeedCiphertext) {
    const enc = new TextEncoder().encode(String(keySeedCiphertext))
    const hashBuf = await crypto.subtle.digest('SHA-256', enc)
    const arr = new Uint8Array(hashBuf).slice(0, 31)
    ih = '0x' + Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  if (!ih) throw new Error('integrityHash required (or legacy keySeedCiphertext)')

  const feeAmount = fee ? BigInt(fee) : BigInt(500000000000000000) // default 0.5 STRK
  const feeHigh = feeAmount >> BigInt(128)
  const feeLow = feeAmount & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')
  const priceBig = BigInt(price)
  const priceHigh = priceBig >> BigInt(128)
  const priceLow = priceBig & BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')

  console.log('[createVault] multicall: approve + create_vault, fee:', feeAmount.toString(), 'integrityHash:', ih)

  const pqcFelt = pqc ? '1' : '0'
  console.log('[createVault] pqc:', pqc, '-> felt', pqcFelt)

  // Multicall: approve STRK to vault contract, then create_vault
  const result = await account.execute([
    {
      contractAddress: STRK_TOKEN_ADDRESS,
      entrypoint: 'approve',
      calldata: [VAULT_ADDRESS, feeLow.toString(), feeHigh.toString()],
    },
    {
      contractAddress: VAULT_ADDRESS,
      entrypoint: 'create_vault',
      calldata: [
        cid,
        priceLow.toString(),
        priceHigh.toString(),
        ih,
        commitment,
        ttl.toString(),
        pqcFelt,
      ],
    },
  ])

  console.log('[createVault] result:', JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v)))
  return result
}

/**
 * Claim a vault by providing the correct claim_secret.
 * Delegates to KeyExchangeMockup via FileVault; may panic with INVALID_PROOF.
 */
export async function claimVault(account, cid, claimSecret) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set')
  const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: account })
  try {
    const result = await contract.claim_vault(cid, claimSecret)
    return result
  } catch (e) {
    // Re-throw with clearer message for INVALID_PROOF
    if (e.message?.includes('INVALID_PROOF') || e.message?.includes('0x494e56414c49445f50524f4f46')) {
      throw new Error('INVALID_PROOF: wrong claim secret')
    }
    throw e
  }
}

/**
 * Get vault information — handles FileVault v2 tuple (Vault, LockState)
 */
export async function getVault(provider, cid) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set')

  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider })
    const result = await contract.get_vault(cid)
    console.log('[getVault] raw response:', JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v)))

    let vault, lock
    if (Array.isArray(result)) {
      ;[vault, lock] = result
    } else if (result && typeof result === 'object' && '0' in result && '1' in result) {
      vault = result[0]
      lock = result[1]
    } else {
      vault = result
      lock = null
    }

    let priceBigInt
    if (vault.price && typeof vault.price === 'object' && vault.price.low !== undefined) {
      priceBigInt = BigInt(vault.price.low) + (BigInt(vault.price.high) << BigInt(128))
    } else if (typeof vault.price === 'string' || typeof vault.price === 'bigint') {
      priceBigInt = BigInt(vault.price)
    } else {
      priceBigInt = BigInt(0)
    }

    // Normalize new fields with fallback for old vaults
    let pqcVal = vault.pqc ?? vault.PQC ?? false
    if (typeof pqcVal === 'bigint') pqcVal = pqcVal !== BigInt(0)
    else if (typeof pqcVal === 'number') pqcVal = pqcVal !== 0
    else if (typeof pqcVal === 'string') pqcVal = pqcVal === '1' || pqcVal === 'true'
    const pqcBool = Boolean(pqcVal)
    const feeBps = Number(vault.platform_fee_bps ?? vault.platformFeeBps ?? 100) || 100

    return {
      seller: vault.seller,
      price: priceBigInt,
      status: vault.status,
      createdAt: vault.created_at,
      created_at: vault.created_at,
      ttl: vault.ttl,
      pqc: pqcBool,
      platform_fee_bps: feeBps,
      platformFeeBps: feeBps,
      // LockState (if available)
      commitment: lock?.commitment,
      integrityHash: lock?.integrity_hash,
      integrity_hash: lock?.integrity_hash,
      isClaimed: lock?.is_claimed,
      is_claimed: lock?.is_claimed,
      // Raw for advanced use
      vault,
      lock,
    }
  } catch (e) {
    console.error('[getVault] error:', e.message, e.stack)
    return null
  }
}

/**
 * Get vault price
 */
export async function getPrice(provider, cid) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set')
  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider })
    const price = await contract.get_price(cid)
    if (price && typeof price === 'object' && price.low !== undefined) {
      return BigInt(price.low) + (BigInt(price.high) << BigInt(128))
    }
    return BigInt(price)
  } catch (e) {
    return null
  }
}

/**
 * Get vault status (0=Active, 1=Claimed, 2=Refunded)
 */
export async function getStatus(provider, cid) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set')
  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider })
    const status = await contract.get_status(cid)
    return Number(status)
  } catch (e) {
    return null
  }
}

/**
 * Refund a vault (seller only, after TTL)
 */
export async function refundVault(account, cid) {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set')
  const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: account })
  const result = await contract.refund_vault(cid)
  return result
}

/**
 * Convert CID string to felt252 via SHA-256 truncated
 */
export async function cidToFelt(cid) {
  const encoder = new TextEncoder()
  const data = encoder.encode(cid)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer).slice(0, 31)
  return '0x' + Array.from(hashArray).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Deploy FileVault contract (legacy browser helper — prefer scripts/deploy.js for v2)
 * Now requires 4 constructor args; this helper guides to script.
 */
export async function deployContract(account) {
  if (!account) throw new Error('Wallet not connected')
  throw new Error('Use scripts/deploy.js for FileVault v2 (requires KeyExchangeMockup address). See .env.example')
}

/**
 * Get total fees accumulated
 */
export async function getTotalFees() {
  if (!VAULT_ADDRESS) throw new Error('NEXT_PUBLIC_FILEVAULT_ADDRESS not set')
  try {
    const contract = new Contract({ abi: FileVaultABI, address: VAULT_ADDRESS, providerOrAccount: readProvider })
    const fees = await contract.get_total_fees()
    if (fees && typeof fees === 'object' && fees.low !== undefined) {
      return BigInt(fees.low) + (BigInt(fees.high) << BigInt(128))
    }
    return BigInt(fees)
  } catch {
    return BigInt(0)
  }
}
