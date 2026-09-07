/**
 * Centralized Starknet network configuration for Ownerz.
 *
 * Reads NEXT_PUBLIC_NETWORK from env and derives all network-dependent values:
 * chainId hex, chain label, explorer base URL, Kit chainId, RPC fallback,
 * and STRK20 pool address.
 *
 * Usage:
 *   import { getNetworkConfig } from './network-config.js';
 *   const { rpcFallback, chainIdHex, explorerBase } = getNetworkConfig();
 *
 * Env contract:
 *   - NEXT_PUBLIC_NETWORK unset or "SN_SEPOLIA" → Sepolia (default, existing behavior)
 *   - NEXT_PUBLIC_NETWORK="SN_MAIN" → Mainnet
 *   - Any other value → Sepolia fallback + console warning
 */

const NETWORKS = {
  SN_MAIN: {
    // 0x534e5f4d41494e — hex encoding of "SN_MAIN"
    chainIdHex: '534e5f4d41494e',
    chainLabel: 'Starknet Mainnet',
    // Mainnet explorer — voyager.online (no prefix)
    explorerBase: 'https://voyager.online',
    kitChainId: 'SN_MAIN',
    // BlastAPI mainnet RPC (public, no key required)
    rpcFallback:
      process.env.NEXT_PUBLIC_STARKNET_RPC ||
      'https://starknet-mainnet.public.blastapi.io/rpc/v0_8',
    // STRK20 pool on mainnet (verified on Voyager before merge)
    strk20PoolAddress:
      '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    // STRK token — same address on mainnet and Sepolia
    strkTokenAddress:
      '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  },
  SN_SEPOLIA: {
    // 0x5345504f4c4941 — hex encoding of "SEPOLIA"
    chainIdHex: '5345504f4c4941',
    chainLabel: 'Starknet Sepolia testnet',
    // Sepolia explorer — sepolia.voyager.online
    explorerBase: 'https://sepolia.voyager.online',
    kitChainId: 'SN_SEPOLIA',
    // BlastAPI Sepolia RPC (public, no key required)
    rpcFallback:
      process.env.NEXT_PUBLIC_STARKNET_RPC ||
      'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
    // STRK20 pool on Sepolia
    strk20PoolAddress:
      '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91',
    // STRK token — same address on mainnet and Sepolia
    strkTokenAddress:
      '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  },
};

let _cache = null;

/**
 * Get the network configuration for the current environment.
 *
 * Reads NEXT_PUBLIC_NETWORK once, caches the result, and returns the
 * derived config object. Safe for SSR (no top-level window access).
 *
 * @returns {Object} Network configuration object with:
 *   - network: 'SN_MAIN' | 'SN_SEPOLIA'
 *   - chainIdHex: string (e.g. '534e5f4d41494e')
 *   - chainLabel: string (e.g. 'Starknet Mainnet')
 *   - explorerBase: string (e.g. 'https://voyager.online')
 *   - kitChainId: string (e.g. 'SN_MAIN')
 *   - rpcFallback: string (BlastAPI URL or env override)
 *   - strk20PoolAddress: string (hex address)
 *   - strkTokenAddress: string (hex address)
 */
export function getNetworkConfig() {
  if (_cache) return _cache;

  const raw = (process.env.NEXT_PUBLIC_NETWORK || '').trim();

  if (raw && NETWORKS[raw]) {
    _cache = { ...NETWORKS[raw], network: raw };
  } else if (raw) {
    console.warn(
      `[network-config] Unknown NEXT_PUBLIC_NETWORK="${raw}", falling back to Sepolia`
    );
    _cache = { ...NETWORKS.SN_SEPOLIA, network: 'SN_SEPOLIA' };
  } else {
    // Unset → Sepolia (preserves existing behavior)
    _cache = { ...NETWORKS.SN_SEPOLIA, network: 'SN_SEPOLIA' };
  }

  return _cache;
}
