/**
 * STRK20 private payments module for Ownerz.
 * Handles shield/unshield/private transfers via the Privacy Wallet API.
 * 
 * IMPORTANT: This dapp never touches viewing keys.
 * All operations go through WalletAccountV6.
 */

// STRK20 pool contract address (mainnet)
export const STRK20_POOL_ADDRESS = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'

// STRK token address (mainnet)
export const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

/**
 * Convert decimal amount to hex (smallest unit).
 * STRK has 18 decimals.
 * @param {number|string} amount - Amount in STRK (e.g., "1.5")
 * @returns {string} Hex string in smallest unit
 */
export function toSmallestUnit(amount) {
  const num = parseFloat(amount)
  const wei = BigInt(Math.round(num * 1e18))
  return '0x' + wei.toString(16)
}

/**
 * Convert hex amount to decimal.
 * @param {string} hexAmount - Hex string in smallest unit
 * @returns {string} Amount in STRK
 */
export function fromSmallestUnit(hexAmount) {
  const wei = BigInt(hexAmount)
  const strk = Number(wei) / 1e18
  return strk.toFixed(4)
}

/**
 * Shield tokens (deposit into privacy pool).
 * This is a TWO-transaction flow:
 * 1. ERC-20 approve (public)
 * 2. Pool deposit (private)
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - ERC-20 token to shield
 * @param {string} amount - Amount in smallest unit (hex)
 * @returns {Promise<Object>} Transaction result
 */
export async function shieldTokens(account, tokenAddress, amount) {
  try {
    const actions = [
      {
        type: 'deposit',
        token: tokenAddress,
        amount: amount
      }
    ]
    
    // strk20InvokeTransaction handles:
    // - Approval UI prompt
    // - Proof generation
    // - Fee handling
    // - Submission
    const result = await account.strk20InvokeTransaction(actions)
    
    return {
      success: true,
      transactionHash: result.transaction_hash,
      message: 'Tokens shielded successfully'
    }
  } catch (error) {
    console.error('Shield failed:', error)
    return {
      success: false,
      error: error.message,
      message: 'Failed to shield tokens'
    }
  }
}

/**
 * Private transfer (inside the pool).
 * Both sender and recipient must be registered in the pool.
 * Registration happens automatically on first use.
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - Token to transfer
 * @param {string} amount - Amount in smallest unit (hex)
 * @param {string} recipientAddress - Recipient's Starknet address
 * @returns {Promise<Object>} Transaction result
 */
export async function privateTransfer(account, tokenAddress, amount, recipientAddress) {
  try {
    const actions = [
      {
        type: 'transfer',
        token: tokenAddress,
        amount: amount,
        recipient: recipientAddress
      }
    ]
    
    const result = await account.strk20InvokeTransaction(actions)
    
    return {
      success: true,
      transactionHash: result.transaction_hash,
      message: 'Private transfer sent'
    }
  } catch (error) {
    console.error('Private transfer failed:', error)
    return {
      success: false,
      error: error.message,
      message: 'Failed to send private transfer'
    }
  }
}

/**
 * Unshield tokens (withdraw from pool to public balance).
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - Token to unshield
 * @param {string} amount - Amount in smallest unit (hex)
 * @param {string} recipientAddress - Recipient's public address (optional, defaults to self)
 * @returns {Promise<Object>} Transaction result
 */
export async function unshieldTokens(account, tokenAddress, amount, recipientAddress) {
  try {
    const actions = [
      {
        type: 'withdraw',
        token: tokenAddress,
        amount: amount,
        recipient: recipientAddress || account.address
      }
    ]
    
    const result = await account.strk20InvokeTransaction(actions)
    
    return {
      success: true,
      transactionHash: result.transaction_hash,
      message: 'Tokens unshielded successfully'
    }
  } catch (error) {
    console.error('Unshield failed:', error)
    return {
      success: false,
      error: error.message,
      message: 'Failed to unshield tokens'
    }
  }
}

/**
 * Get STRK20 balance (shielded balance).
 * This requires wallet consent - only call when showing user their balance.
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - Token address to check
 * @returns {Promise<Object>} Balance info
 */
export async function getStrk20Balance(account, tokenAddress) {
  try {
    const balances = await account.strk20Balances([tokenAddress])
    return {
      success: true,
      balance: balances[0]?.balance || '0x0',
      balanceFormatted: fromSmallestUnit(balances[0]?.balance || '0x0')
    }
  } catch (error) {
    console.error('Balance check failed:', error)
    return {
      success: false,
      error: error.message,
      balance: '0x0',
      balanceFormatted: '0.0000'
    }
  }
}

/**
 * Check if wallet supports STRK20 and has required capabilities.
 * @param {Object} account - WalletAccountV6 instance
 * @returns {Promise<Object>} Capability check result
 */
export async function checkStrk20Capabilities(account) {
  try {
    // Try to get balances as a capability check
    // This will prompt wallet consent - only use when needed
    const hasStrk20 = typeof account.strk20InvokeTransaction === 'function'
    const hasBalances = typeof account.strk20Balances === 'function'
    
    return {
      success: true,
      hasStrk20,
      hasBalances,
      message: hasStrk20 ? 'STRK20 supported' : 'STRK20 not supported'
    }
  } catch (error) {
    return {
      success: false,
      hasStrk20: false,
      hasBalances: false,
      message: 'Could not check STRK20 capabilities'
    }
  }
}

/**
 * Format transaction hash for display.
 * @param {string} hash - Transaction hash
 * @returns {string} Truncated hash for display
 */
export function formatTxHash(hash) {
  if (!hash) return ''
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

/**
 * Get block explorer URL for transaction.
 * @param {string} txHash - Transaction hash
 * @returns {string} Explorer URL
 */
export function getExplorerUrl(txHash) {
  return `https://starkscan.co/tx/${txHash}`
}
