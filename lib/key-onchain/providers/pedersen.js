/**
 * Pedersen Commitment Provider
 * 
 * Concrete implementation of the commitment mechanism.
 * Uses Pedersen hash for commitments (current on-chain scheme).
 * 
 * SWAPPABLE: Replace this with a PQ commitment provider.
 */

import { hash } from 'starknet'

/**
 * Compute Pedersen commitment from identifier and secret.
 * 
 * Current scheme: pedersen(pedersen(id, high_byte), low_byte)
 * where high_byte and low_byte are first 4 hex chars of secret as u16.
 * 
 * @param {string} identifier - CID as felt252
 * @param {string} secret - 32-char hex claim secret
 * @returns {string} felt252 commitment
 */
export function computeCommitment(identifier, secret) {
  const secretU16 = parseInt(secret.trim().slice(0, 4), 16)
  const high = secretU16 >> 8
  const low = secretU16 & 0xFF
  const inner = hash.computePedersenHash(identifier, high.toString())
  return hash.computePedersenHash(inner, low.toString())
}

/**
 * Verify commitment matches.
 */
export function verifyCommitment(stored, computed) {
  return stored === computed
}

/**
 * Convert secret to on-chain u16 format.
 */
export function secretToOnChain(secret) {
  return parseInt(secret.trim().slice(0, 4), 16)
}

/**
 * Compute SHA-256 hash for integrity verification.
 */
export async function computeIntegrityHash(value) {
  const encoder = new TextEncoder()
  const data = encoder.encode(value)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer).slice(0, 31)
  return '0x' + Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Convert string identifier to felt252.
 */
export async function identifierToFelt(identifier) {
  const encoder = new TextEncoder()
  const data = encoder.encode(identifier)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer).slice(0, 31)
  return '0x' + Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('')
}

// --- Provider Interface ---

export const provider = {
  computeCommitment,
  verifyCommitment,
  secretToOnChain,
  computeIntegrityHash,
  identifierToFelt,
}
