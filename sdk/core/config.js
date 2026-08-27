// DataVaultz SDK — centralized configuration and contract addresses.
// Single source of truth for chain, RPC, and on-chain addresses.
// Mirrors the env-var contract already used across lib/* (same fallbacks).

export const config = {
  chainId: 'SN_SEPOLIA',
  rpcUrl:
    process.env.NEXT_PUBLIC_STARKNET_RPC ||
    'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
  fileVaultAddress: process.env.NEXT_PUBLIC_FILEVAULT_ADDRESS,
  keyExchangeAddress: process.env.NEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS,
  accessFactoryAddress: process.env.NEXT_PUBLIC_ACCESS_FACTORY_ADDRESS,
  strkTokenAddress:
    process.env.NEXT_PUBLIC_STRK_TOKEN ||
    '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  wcProjectId:
    process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'f2e613881f7a0e811295cdd57999e31b',
  dappName: 'Ownerz DataVaultz',
}

// Convenience aliases
export const STRK_TOKEN_ADDRESS = config.strkTokenAddress
export const CHAIN_ID = config.chainId

// FileVault lifecycle status enum (matches Cairo `get_status` felt values)
export const VAULT_STATUS = Object.freeze({
  ACTIVE: 0,
  CLAIMED: 1,
  REFUNDED: 2,
})

// Default platform fee assumed when the contract read fails (0.5 STRK in wei)
export const DEFAULT_PLATFORM_FEE_WEI = 500000000000000000n
