/**
 * Fee calculation module for Ownerz.
 * Calculates proportional fees based on file size.
 */

// Pricing constants (in STRK)
const BASE_FEE = 0.1          // Fixed fee per transaction (covers gas)
const FEE_PER_MB = 0.002      // Fee per MB of storage (3x cost)
const MIN_FEE = 0.5           // Minimum fee
const MAX_FEE = 100           // Maximum fee cap

// Storage cost estimate (what we pay Fil One)
const STORAGE_COST_PER_MB = 0.0006  // Approximate Fil One cost per MB

/**
 * Calculate fee for file upload.
 * @param {number} fileSizeBytes - File size in bytes
 * @returns {Object} Fee breakdown
 */
export function calculateUploadFee(fileSizeBytes) {
  const sizeMB = fileSizeBytes / (1024 * 1024)
  
  // Calculate raw fee
  const storageFee = sizeMB * FEE_PER_MB
  const rawFee = BASE_FEE + storageFee
  
  // Apply minimum and maximum
  const fee = Math.max(MIN_FEE, Math.min(MAX_FEE, rawFee))
  
  // Calculate our costs and margin
  const storageCost = sizeMB * STORAGE_COST_PER_MB
  const totalCost = BASE_FEE + storageCost  // Our actual cost
  const margin = fee - totalCost
  const marginPercent = totalCost > 0 ? ((margin / totalCost) * 100).toFixed(1) : 0
  
  return {
    // User-facing
    fee: fee,
    feeFormatted: fee.toFixed(4),
    feeHex: strkToHex(fee),
    
    // Breakdown
    baseFee: BASE_FEE,
    storageFee: storageFee,
    storageFeeFormatted: storageFee.toFixed(6),
    
    // Size info
    sizeBytes: fileSizeBytes,
    sizeMB: sizeMB,
    sizeFormatted: formatSize(fileSizeBytes),
    
    // Cost analysis (internal)
    costs: {
      storageCost: storageCost,
      gasEstimate: 0.01,  // Approximate gas cost
      totalCost: totalCost,
      margin: margin,
      marginPercent: parseFloat(marginPercent)
    }
  }
}

/**
 * Calculate fee for different file sizes (for display).
 * @returns {Array} Fee examples
 */
export function getFeeExamples() {
  const examples = [
    { size: '1 KB', bytes: 1024 },
    { size: '100 KB', bytes: 100 * 1024 },
    { size: '1 MB', bytes: 1024 * 1024 },
    { size: '10 MB', bytes: 10 * 1024 * 1024 },
    { size: '100 MB', bytes: 100 * 1024 * 1024 },
    { size: '1 GB', bytes: 1024 * 1024 * 1024 },
  ]
  
  return examples.map(ex => ({
    ...ex,
    fee: calculateUploadFee(ex.bytes)
  }))
}

/**
 * Convert STRK amount to hex (smallest unit, 18 decimals).
 * @param {number} amount - Amount in STRK
 * @returns {string} Hex string
 */
export function strkToHex(amount) {
  const wei = BigInt(Math.round(amount * 1e18))
  return '0x' + wei.toString(16)
}

/**
 * Convert hex to STRK amount.
 * @param {string} hex - Hex string
 * @returns {number} Amount in STRK
 */
export function hexToStrk(hex) {
  const wei = BigInt(hex)
  return Number(wei) / 1e18
}

/**
 * Format file size for display.
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted string
 */
export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

/**
 * Get pricing constants for display.
 * @returns {Object} Pricing info
 */
export function getPricingInfo() {
  return {
    baseFee: BASE_FEE,
    feePerMB: FEE_PER_MB,
    minFee: MIN_FEE,
    maxFee: MAX_FEE,
    description: `Base fee: ${BASE_FEE} STRK + ${FEE_PER_MB} STRK per MB (min: ${MIN_FEE} STRK)`
  }
}
