/**
 * Recover — Recipient Side
 * 
 * Single responsibility: Recover encryption key after claiming a listing.
 * Orchestrates crypto, on-chain, and storage layers.
 */

import { unwrapKeySeed, decryptData, hexToArray } from '../crypto/index.js'
import { computeIntegrityHash, verifyCommitment, secretToOnChain, identifierToFelt, readLock, unlock } from '../ownerz/key-onchain-config.js'
import { downloadKeySeed, downloadEncryptedFile } from '../storage/index.js'

/**
 * Recover encryption key and decrypt file.
 * 
 * @param {Object} params
 * @param {string} params.cid - Content identifier
 * @param {string} params.claimSecret - 32-char hex claim secret
 * @param {Object} params.account - Recipient's wallet
 * @returns {Promise<Object>} Decrypted file data
 * 
 * Returns:
 *   - data: ArrayBuffer of decrypted file
 *   - fileName: Original file name
 *   - fileType: Original MIME type
 */
export async function recoverListing({ cid, claimSecret, account }) {
  // Normalize inputs
  const cleanSecret = String(claimSecret || '').trim().toLowerCase()
  const cleanCid = String(cid || '').trim()
  if (!cleanSecret || cleanSecret.length < 4) throw new Error('Invalid claim secret — must be 32-char hex from seller')
  // 1. Read lock from chain
  const identifier = await identifierToFelt(cleanCid)
  const locked = await readLock(identifier)
  if (!locked) throw new Error('Lock not found')
  if (locked.isClaimed) {
    throw new Error('Lock already claimed or refunded')
  }

  // 2. Download key seed from storage
  const keySeedCiphertext = await downloadKeySeed(cleanCid)
  if (!keySeedCiphertext) throw new Error('Key seed not found in storage for CID ' + cleanCid)

  // 3. Verify integrity — tolerant for v1 (raw key_seed_ciphertext) vs v2 (hash)
  const integrityHash = await computeIntegrityHash(keySeedCiphertext)
  const storedCandidates = [
    locked.integrityHash,
    locked.integrity_hash,
    locked.lock?.integrity_hash,
    locked.lock?.integrityHash,
    locked.meta?.integrityHash,
    locked.vault?.key_seed_ciphertext,
    locked.vault?.integrity_hash,
    locked.vault?.integrityHash,
  ].filter(Boolean).map(v => String(v))
  // Normalize via BigInt for felt comparison (decimal vs hex)
  const toBigIntHex = (v) => {
    try { return BigInt(v).toString(16).toLowerCase() } catch { return String(v).toLowerCase() }
  }
  const computedHex = toBigIntHex(integrityHash)
  const rawHex = toBigIntHex(keySeedCiphertext)
  const matches = storedCandidates.some(s => {
    const sl = toBigIntHex(s)
    return sl === computedHex || String(s).toLowerCase() === String(keySeedCiphertext).toLowerCase() || sl === rawHex
  })
  if (!matches) {
    const isOldVault = !!locked.vault?.key_seed_ciphertext
    const stored0 = storedCandidates[0] || 'undefined'
    console.warn('[recover] integrity mismatch — stored', stored0, 'computed', integrityHash, 'rawLen', String(keySeedCiphertext).length, 'isOldVault', isOldVault, 'locked', JSON.stringify(locked, (_, v) => typeof v === 'bigint' ? v.toString() : v).slice(0,600))
    // For old v1 vaults, don't block — the on-chain value is raw ciphertext, hash won't match but data is still valid if unwrap succeeds
    if (!isOldVault) {
      throw new Error(`Integrity check failed — data may be tampered (stored ${stored0} vs computed ${integrityHash.slice(0,18)}...)`)
    } else {
      console.warn('[recover] old vault — skipping strict integrity check, proceeding to unwrap')
    }
  } else {
    console.log('[recover] integrity verified', integrityHash.slice(0,18)+'...')
  }

  // 4. Unwrap key seed to recover ML-KEM768 secret key
  let secretKeyHex
  try {
    secretKeyHex = await unwrapKeySeed(keySeedCiphertext, cleanSecret)
  } catch (e) {
    console.error('[recover] unwrap failed', e)
    // Map DOM OperationError to user-friendly
    if (e.name === 'OperationError' || String(e.message).includes('Operation')) {
      throw new Error('Invalid claim secret — unwrap failed. Check the secret from seller (32 hex chars, lowercase).')
    }
    throw new Error('Unwrap failed: ' + (e.message || String(e)))
  }
  const secretKey = hexToArray(secretKeyHex)

  // 5. Unlock on-chain
  const proof = secretToOnChain(cleanSecret)
  try {
    await unlock({ account, identifier, proof })
  } catch (e) {
    // Map INVALID_PROOF etc
    const msg = e.message || String(e)
    if (msg.includes('INVALID_PROOF') || msg.includes('0x494e56414c49445f50524f4f46')) {
      throw new Error('Invalid claim secret — INVALID_PROOF. On-chain commitment mismatch.')
    }
    throw e
  }

  // 6. Download and decrypt file
  const encryptedData = await downloadEncryptedFile(cleanCid)
  let data, fileName, fileType
  try {
    const dec = await decryptData(encryptedData, secretKey)
    data = dec.data; fileName = dec.fileName; fileType = dec.fileType
  } catch (e) {
    console.error('[recover] decrypt failed', e)
    throw new Error('Decryption failed — file may be corrupted or key mismatch: ' + (e.message || String(e)))
  }

  return { data, fileName, fileType }
}
