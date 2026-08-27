// DataVaultz SDK — wallet discovery & connection (re-exports existing lib surface).
export {
  getAvailableWallets,
  waitForWallets,
  onWalletInjected,
  connectWallet,
  resolvePrivacyWallet,
  detectStrk20Capability,
  isStrk20Capable,
  RpcProvider,
} from '../../lib/starknet'

export {
  connectViaKit,
  disconnectKit,
  isInReadyAppBrowser,
  isMobileBrowser,
} from '../../lib/starknet-kit'
