/**
 * Crypto Primitives Module
 * 
 * Single responsibility: ML-KEM768 + AES-256-GCM operations.
 * No business logic, no storage, no on-chain interaction.
 * 
 * Swappable: replace this module to change cryptographic primitives.
 */

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'
import { randomBytes } from '@noble/post-quantum/utils.js'

const IV_LENGTH = 12 // bytes (GCM standard)

// --- Hex/Array Helpers ---

export function arrayToHex(arr) {
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export function hexToArray(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
  }
  return bytes
}

// --- Key Generation ---

/**
 * Generate ML-KEM768 keypair
 * @returns {Object} { publicKey: Uint8Array, secretKey: Uint8Array }
 */
export function generateKeyPair() {
  return ml_kem768.keygen()
}

// --- File Encryption/Decryption ---

/**
 * Encrypt data with ML-KEM768 + AES-256-GCM
 * @param {ArrayBuffer} data - Raw file data
 * @param {Object} metadata - File metadata { name, type }
 * @param {Object} [existingKeypair] - Optional: reuse existing keypair
 * @returns {Object} { encrypted, secretKey }
 */
export async function encryptData(data, metadata, existingKeypair) {
  const keypair = existingKeypair || ml_kem768.keygen()
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(keypair.publicKey)

  const aesKeyRaw = await crypto.subtle.importKey(
    'raw', sharedSecret, 'PBKDF2', false, ['deriveKey']
  )
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: cipherText, iterations: 1, hash: 'SHA-256' },
    aesKeyRaw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  const iv = randomBytes(IV_LENGTH)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, aesKey, data
  )

  return {
    encrypted: {
      version: 2,
      algorithm: 'ML-KEM768+AES-256-GCM',
      fileName: metadata.name,
      fileType: metadata.type,
      kemCipherText: arrayToHex(cipherText),
      kemPublicKey: arrayToHex(keypair.publicKey),
      iv: arrayToHex(iv),
      data: arrayToHex(new Uint8Array(encrypted)),
    },
    secretKey: arrayToHex(keypair.secretKey),
  }
}

/**
 * Decrypt data with ML-KEM768 + AES-256-GCM
 * @param {Object} encryptedObj - Payload from encryptData()
 * @param {Uint8Array} secretKey - ML-KEM768 secret key (bytes, not hex)
 * @returns {Object} { data: ArrayBuffer, fileName: string, fileType: string }
 */
export async function decryptData(encryptedObj, secretKey) {
  const kemCipherText = hexToArray(encryptedObj.kemCipherText)
  const sharedSecret = ml_kem768.decapsulate(kemCipherText, secretKey)

  const aesKeyRaw = await crypto.subtle.importKey(
    'raw', sharedSecret, 'PBKDF2', false, ['deriveKey']
  )
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: kemCipherText, iterations: 1, hash: 'SHA-256' },
    aesKeyRaw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  const iv = hexToArray(encryptedObj.iv)
  const data = hexToArray(encryptedObj.data)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, aesKey, data
  )

  return {
    data: decrypted,
    fileName: encryptedObj.fileName || 'download',
    fileType: encryptedObj.fileType || 'application/octet-stream',
  }
}

// --- Key Seed Wrapping ---

const KEY_SEED_SALT = 'ownerz-filevault-v1'
const KEY_SEED_ITERATIONS = 100_000

/**
 * Derive AES-256 key from claim secret
 * @param {string} claimSecret - 32-char lowercase hex string
 * @returns {Promise<CryptoKey>}
 */
async function deriveKeyFromSecret(claimSecret) {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(claimSecret),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(KEY_SEED_SALT),
      iterations: KEY_SEED_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Wrap a key seed with a claim secret (AES-256-GCM)
 * @param {string} seedHex - ML-KEM768 secret key as hex string
 * @param {string} claimSecret - 32-char lowercase hex string
 * @returns {Promise<string>} Wrapped ciphertext as hex(iv ‖ ct)
 */
export async function wrapKeySeed(seedHex, claimSecret) {
  const aesKey = await deriveKeyFromSecret(claimSecret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoder = new TextEncoder()
  const plaintext = encoder.encode(seedHex)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintext
  )

  const combined = new Uint8Array(iv.length + encrypted.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(encrypted), iv.length)

  return arrayToHex(combined)
}

/**
 * Unwrap a key seed with a claim secret (AES-256-GCM)
 * @param {string} ciphertextHex - Wrapped ciphertext as hex(iv ‖ ct)
 * @param {string} claimSecret - 32-char lowercase hex string
 * @returns {Promise<string>} Original seed hex string
 */
export async function unwrapKeySeed(ciphertextHex, claimSecret) {
  const aesKey = await deriveKeyFromSecret(claimSecret)
  const combined = hexToArray(ciphertextHex)

  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    ciphertext
  )

  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}
