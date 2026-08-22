/**
 * Generate — Issuer Side
 * 
 * Single responsibility: Prepare a listing for on-chain locking.
 * Orchestrates crypto, on-chain commitment, and storage layers.
 */

import { generateKeyPair, encryptData, wrapKeySeed } from '../crypto/index.js'
import { computeCommitment, computeIntegrityHash, identifierToFelt, getFee, lock } from '../ownerz/key-onchain-config.js'

/**
 * Generate a complete listing payload for on-chain locking.
 * 
 * @param {Object} params
 * @param {File} params.file - Raw file to encrypt
 * @param {string} params.fileName - File name
 * @param {string} params.fileType - MIME type
 * @param {string} params.cid - Content identifier
 * @param {string} params.claimSecret - 32-char hex claim secret
 * @param {Object} params.account - Issuer's wallet
 * @param {Object} params.meta - { price, ttl }
 * @returns {Promise<Object>} Listing payload
 * 
 * Returns:
 *   - encrypted: Encrypted file payload (for storage)
 *   - keySeedCiphertext: Wrapped key seed (for storage)
 *   - identifier: CID as felt252 (for on-chain lock)
 *   - commitment: On-chain commitment
 *   - integrityHash: Hash for on-chain verification
 */
export async function generateListing({ file, fileName, fileType, cid, claimSecret, account, meta }) {
  // 1. Generate keypair and encrypt file
  const keypair = generateKeyPair()
  const buffer = await file.arrayBuffer()
  const { encrypted, secretKey } = await encryptData(buffer, { name: fileName, type: fileType }, keypair)

  // 2. Wrap key seed with claim secret
  const keySeedCiphertext = await wrapKeySeed(secretKey, claimSecret)

  // 3. Compute on-chain values
  const identifier = await identifierToFelt(cid)
  const commitment = computeCommitment(identifier, claimSecret)
  const integrityHash = await computeIntegrityHash(keySeedCiphertext)

  return {
    encrypted,
    keySeedCiphertext,
    identifier,
    commitment,
    integrityHash,
  }
}
