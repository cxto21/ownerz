// DataVaultz SDK — public entry point.
// Curated, stable surface for the DataVaultz client (wallet, vault, access, privacy).
// This release re-exports the existing lib/* implementation behind a single
// versioned namespace; the underlying logic will be migrated into sdk/* in later phases.

// core
export { config, STRK_TOKEN_ADDRESS, CHAIN_ID, VAULT_STATUS, DEFAULT_PLATFORM_FEE_WEI } from './core/config'
export { getReadProvider, createReadProvider, RpcProvider } from './core/provider'
export { toU256, fromU256, isZeroAddress } from './core/encoding'

// wallet
export {
  getAvailableWallets,
  waitForWallets,
  onWalletInjected,
  connectWallet,
  resolvePrivacyWallet,
  detectStrk20Capability,
  isStrk20Capable,
  connectViaKit,
  disconnectKit,
  isInReadyAppBrowser,
  isMobileBrowser,
} from './wallet'

// vault
export {
  createVault,
  claimVault,
  refundVault,
  getVault,
  getPrice,
  getStatus,
  getPlatformFee,
  getTotalFees,
  cidToFelt,
} from './vault'

// access
export {
  getTokenInfo,
  checkAccess,
  revealShieldedAccess,
  mintAccess,
  mintTo,
  createAccessToken,
  getSellerTokens,
  getAllFactoryTokens,
  formatExpiry,
  calcTotalPrice,
} from './access'

// privacy (STRK20)
export {
  STRK20_POOL_ADDRESS,
  STRK_TOKEN_ADDRESS as STRK20_TOKEN_ADDRESS,
  registerWallet,
  toSmallestUnit,
  fromSmallestUnit,
  shieldTokens,
  privateTransfer,
  batchPrivateTransfer,
  unshieldTokens,
  getStrk20Balance,
  checkStrk20Capabilities,
  formatTxHash,
  getExplorerUrl,
  getShieldedBalance,
  strk20InvokeViaWalletApi,
} from './privacy'
