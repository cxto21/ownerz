/**
 * Key Storage Module
 * 
 * Single responsibility: Store and retrieve key seeds and encrypted files.
 * Abstracts S3 implementation details (naming convention, API calls).
 * 
 * Swappable: replace this module to change storage backend.
 */

const S3_BASE = process.env.NEXT_PUBLIC_S3_BASE || 'https://eu-west-1.s3.fil.one/ownerz-v01'

/**
 * Derive key seed S3 key from CID
 * Convention: {cid}.key
 * @param {string} cid - Content identifier
 * @returns {string} S3 object key
 */
function getKeySeedKey(cid) {
  return `${cid}.key`
}

/**
 * Upload key seed to storage
 * @param {string} cid - Content identifier
 * @param {string} keySeedCiphertext - Hex-encoded wrapped key seed
 * @returns {Promise<{key: string, url: string}>}
 */
export async function uploadKeySeed(cid, keySeedCiphertext) {
  const key = getKeySeedKey(cid)
  const response = await fetch('/api/upload-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, data: keySeedCiphertext }),
  })

  if (!response.ok) {
    throw new Error(`Key seed upload failed: ${response.statusText}`)
  }

  return { key, url: `${S3_BASE}/${key}` }
}

/**
 * Download key seed from storage
 * @param {string} cid - Content identifier
 * @returns {Promise<string>} Hex-encoded wrapped key seed
 */
export async function downloadKeySeed(cid) {
  const key = getKeySeedKey(cid)
  const response = await fetch(`/api/download-key?key=${encodeURIComponent(key)}`)

  if (!response.ok) {
    throw new Error(`Key seed download failed: ${response.statusText}`)
  }

  const result = await response.json()
  return result.data
}

/**
 * Upload encrypted file to storage
 * @param {string} cid - Content identifier (ignored server generates key, kept for compat)
 * @param {Object} encryptedData - Encrypted payload from crypto.encryptData()
 * @param {string} [fileName] - Optional fileName for S3 metadata
 * @returns {Promise<{key: string, url: string, cid: string}>}
 */
export async function uploadEncryptedFile(cid, encryptedData, fileName) {
  // Try to infer fileName from encrypted payload if not provided
  const inferredName = fileName || encryptedData?.fileName || encryptedData?.metadata?.name || 'unnamed.enc'
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedData, data: encryptedData, fileName: inferredName }),
  })

  if (!response.ok) {
    let msg = response.statusText
    try { const e = await response.json(); msg = e.error || msg } catch {}
    throw new Error(`File upload failed: ${msg}`)
  }

  const result = await response.json()
  const key = result.cid || result.key || result.objectKey || cid
  return { key, cid: key, url: result.url || `${S3_BASE}/${key}`, etag: result.etag, pqc: result.pqc ?? false, tlsVersion: result.tlsVersion }
}

/**
 * Download encrypted file from storage
 * @param {string} cid - Content identifier
 * @returns {Promise<Object>} Encrypted payload
 */
export async function downloadEncryptedFile(cid) {
  const response = await fetch(`/api/download?cid=${encodeURIComponent(cid)}`)

  if (!response.ok) {
    let msg = response.statusText
    try { const e = await response.json(); msg = e.error || msg } catch {}
    throw new Error(`File download failed: ${msg}`)
  }

  const result = await response.json()
  // Server wraps as { success, encryptedData } — unwrap for decryptData
  return result.encryptedData || result.data || result.encrypted || result
}
