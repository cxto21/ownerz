// DataVaultz SDK — shared normalized value shapes (documentation contract).
// These are plain JSDoc typedefs; feature modules normalize raw contract
// structs into these shapes. No runtime exports.

/**
 * @typedef {Object} WalletSession
 * @property {Object} wallet            - StarknetWindowObject (injected or Kit)
 * @property {Object} account           - WalletAccountV6 instance
 * @property {boolean} isStrk20         - whether the wallet supports STRK20 privacy
 * @property {string[]} [walletApiVersions]
 */

/**
 * @typedef {Object} VaultInfo
 * @property {string} cid
 * @property {string} seller
 * @property {bigint} price
 * @property {number} status            - see VAULT_STATUS (0 Active / 1 Claimed / 2 Refunded)
 * @property {boolean} pqc
 * @property {number} platformFeeBps
 * @property {string} commitment
 * @property {string} integrityHash
 * @property {boolean} isClaimed
 */

/**
 * @typedef {Object} TokenInfo
 * @property {string} address
 * @property {string} name
 * @property {string} symbol
 * @property {bigint} price
 * @property {bigint} duration
 * @property {bigint} supply
 * @property {string} owner
 * @property {boolean} isPublic
 */
