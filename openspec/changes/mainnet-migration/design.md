# Design: Starknet Mainnet Migration

## Technical Approach

Introduce a single network-config module (`lib/network-config.js`) that reads `NEXT_PUBLIC_NETWORK` from env and exports derived values (chainId hex, explorer base, Kit chainId, RPC fallback, STRK20 pool). Every consumer replaces hardcoded Sepolia constants with imports from this module. Deploy script gains `--network` flag. No Cairo changes.

## Architecture Decisions

### Decision: Centralized config module vs per-file env reads

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Central module | One import; env read happens once; easy to audit all values | **Chosen** |
| Per-file `process.env` reads | No new file; but 6+ copies of same fallback logic; easy to miss one | Rejected |

**Rationale**: The spec requires "single network-config module deriving from NEXT_PUBLIC_NETWORK". Centralization prevents drift across 6 lib files + index.js + next.config.js.

### Decision: Runtime getter `getNetworkConfig()` vs static object

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `getNetworkConfig()` function | Lazy eval; safe for SSR (no top-level window); can warn on invalid values | **Chosen** |
| Static `export const config = {...}` | Simpler; but runs at import time; no warning path for invalid env | Rejected |

**Rationale**: `NEXT_PUBLIC_*` is available at build time but `getNetworkConfig()` allows a console.warn for unknown values and keeps the module side-effect-free at import.

### Decision: Deploy script `--network` flag vs separate deploy-mainnet script

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `--network` flag on existing script | One script to maintain; env-driven defaults; matches spec | **Chosen** |
| Separate `deploy-mainnet.js` | Zero risk to sepolia script; but duplicates 90% of code | Rejected |

**Rationale**: Spec says `scripts/deploy.js` MUST accept `--network mainnet`. Existing script structure supports it via DEFAULTS object.

## Data Flow

```
.env (NEXT_PUBLIC_NETWORK=SN_MAIN)
  │
  ▼
lib/network-config.js ──── getNetworkConfig()
  │                            │
  │                  ┌─────────┼──────────┬─────────────┐
  │                  ▼         ▼          ▼             ▼
  │           chainId    explorer    rpcFallback   poolAddress
  │                  │         │          │             │
  ▼                  ▼         ▼          ▼             ▼
lib/starknet.js    pages/index.js   lib/starknet-kit.js
lib/filevault.js   (chainId check,  (ArgentMobileConnector
lib/ownerz/        explorer links)   chainId)
  key-onchain-config.js
lib/key-onchain/mockup/deploy.js
lib/key-onchain/mockup/key-exchange-provider.js
  │
  │ (RPC fallback only)
  ▼
next.config.js ──── /api/rpc rewrite (ternary on network)
scripts/deploy.js ── --network mainnet → mainnet.json
contracts/snfoundry.toml ── [sncast.mainnet] section
```

## File Changes

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `lib/network-config.js` | **Create** | Single source of truth: `getNetworkConfig()` returns `{ chainIdHex, chainLabel, explorerBase, kitChainId, rpcFallback, strk20PoolAddress, strkTokenAddress }`. Reads `NEXT_PUBLIC_NETWORK`. |
| 2 | `lib/starknet.js` | Modify | Lines 24-26: replace hardcoded RPC_URL fallback with `getNetworkConfig().rpcFallback` import. |
| 3 | `lib/filevault.js` | Modify | Lines 20-22: replace hardcoded RPC_URL fallback with `getNetworkConfig().rpcFallback` import. |
| 4 | `lib/strk20-payments.js` | Modify | Line 16: replace hardcoded Sepolia pool with `getNetworkConfig().strk20PoolAddress`. Line 475: replace `sepolia.voyager.online` with `getNetworkConfig().explorerBase`. |
| 5 | `lib/starknet-kit.js` | Modify | Line 102: replace `'SN_SEPOLIA'` with `getNetworkConfig().kitChainId`. Line 92: replace RPC_URL with `getNetworkConfig().rpcFallback`. |
| 6 | `pages/index.js` | Modify | Lines 86-96: replace hardcoded provider URL and chainId hex `5345504f4c4941` with `getNetworkConfig()` values. Error msg: "Please switch to Starknet {label}". |
| 7 | `lib/ownerz/key-onchain-config.js` | Modify | Lines 11-13: replace hardcoded RPC_URL fallback with `getNetworkConfig().rpcFallback`. |
| 8 | `lib/key-onchain/mockup/deploy.js` | Modify | Lines 14-16: replace hardcoded RPC_URL fallback with `getNetworkConfig().rpcFallback`. |
| 9 | `lib/key-onchain/mockup/key-exchange-provider.js` | Modify | Lines 21-23: replace hardcoded `DEFAULT_RPC` with `getNetworkConfig().rpcFallback`. |
| 10 | `next.config.js` | Modify | Lines 8-9: ternary on `process.env.NEXT_PUBLIC_NETWORK === 'SN_MAIN'` → Alchemy mainnet URL, else Alchemy Sepolia URL. |
| 11 | `contracts/snfoundry.toml` | Modify | Add `[sncast.mainnet]` section with mainnet RPC. Default stays Sepolia. |
| 12 | `scripts/deploy.js` | Modify | Add `--network mainnet` arg parsing. Replace hardcoded DEFAULTS when mainnet. Write `mainnet.json` instead of `sepolia.json`. Add chainId verification before declare. |
| 13 | `.env.example` | Modify | Add `NEXT_PUBLIC_NETWORK` section with mainnet example. Add mainnet RPC placeholder. Document that unset = Sepolia. |
| 14 | `openspec/changes/wallet-data-linking/proposal.md` | Modify | Add note that mainnet chainId is `SN_MAIN` / `0x534e5f4d41494e`. |

## Per-File Change Details

### 1. `lib/network-config.js` (NEW — ~60 lines)

```js
const NETWORKS = {
  SN_MAIN: {
    chainIdHex: '534e5f4d41494e',       // SN_MAIN
    chainLabel: 'Starknet Mainnet',
    explorerBase: 'https://voyager.online',
    kitChainId: 'SN_MAIN',
    rpcFallback: process.env.NEXT_PUBLIC_STARKNET_RPC
      || 'https://starknet-mainnet.public.blastapi.io/rpc/v0_8',
    strk20PoolAddress: '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    strkTokenAddress: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  },
  SN_SEPOLIA: {
    chainIdHex: '5345504f4c4941',       // SEPOLIA
    chainLabel: 'Starknet Sepolia testnet',
    explorerBase: 'https://sepolia.voyager.online',
    kitChainId: 'SN_SEPOLIA',
    rpcFallback: process.env.NEXT_PUBLIC_STARKNET_RPC
      || 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
    strk20PoolAddress: '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91',
    strkTokenAddress: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
  },
};

let _cache = null;

export function getNetworkConfig() {
  if (_cache) return _cache;
  const raw = (process.env.NEXT_PUBLIC_NETWORK || '').trim();
  if (raw && NETWORKS[raw]) {
    _cache = { ...NETWORKS[raw], network: raw };
  } else if (raw) {
    console.warn(`[network-config] Unknown NEXT_PUBLIC_NETWORK="${raw}", falling back to Sepolia`);
    _cache = { ...NETWORKS.SN_SEPOLIA, network: 'SN_SEPOLIA' };
  } else {
    _cache = { ...NETWORKS.SN_SEPOLIA, network: 'SN_SEPOLIA' };
  }
  return _cache;
}
```

**Note**: `rpcFallback` respects `NEXT_PUBLIC_STARKNET_RPC` env — the module checks env FIRST, only falls back to BlastAPI if unset. This is correct because the env var is the primary override.

### 2. `lib/starknet.js` (lines 24-26)

**Before:**
```js
const RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_RPC ||
  'https://starknet-sepolia.public.blastapi.io/rpc/v0_8';
```

**After:**
```js
import { getNetworkConfig } from './network-config.js';
const { rpcFallback: RPC_URL } = getNetworkConfig();
```

### 3. `lib/filevault.js` (lines 20-22)

**Before:**
```js
const RPC_URL =
  process.env.NEXT_PUBLIC_STARKNET_RPC ||
  'https://starknet-sepolia.public.blastapi.io/rpc/v0_8';
const readProvider = new RpcProvider({ nodeUrl: RPC_URL });
```

**After:**
```js
import { getNetworkConfig } from './network-config.js';
const { rpcFallback: RPC_URL } = getNetworkConfig();
const readProvider = new RpcProvider({ nodeUrl: RPC_URL });
```

### 4. `lib/strk20-payments.js` (lines 14-20, 475)

**Before (lines 14-20):**
```js
export const STRK20_POOL_ADDRESS =
  '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91';
export const STRK_TOKEN_ADDRESS =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
```

**After:**
```js
import { getNetworkConfig } from './network-config.js';
const _net = getNetworkConfig();
export const STRK20_POOL_ADDRESS = _net.strk20PoolAddress;
export const STRK_TOKEN_ADDRESS = _net.strkTokenAddress;
```

**Line 475 before:**
```js
return `https://sepolia.voyager.online/tx/${txHash}`;
```

**After:**
```js
return `${getNetworkConfig().explorerBase}/tx/${txHash}`;
```

### 5. `lib/starknet-kit.js` (lines 92, 102)

**Before (line 92):**
```js
const rpcUrl = process.env.NEXT_PUBLIC_STARKNET_RPC || undefined;
```

**After:**
```js
import { getNetworkConfig } from './network-config.js';
// ... inside connectViaKit():
const { rpcFallback: rpcUrl, kitChainId } = getNetworkConfig();
```

**Line 102 before:**
```js
chainId: 'SN_SEPOLIA',
```

**After:**
```js
chainId: kitChainId,
```

### 6. `pages/index.js` (lines 86-96)

**Before:**
```js
const provider = new RpcProvider({
  nodeUrl:
    process.env.NEXT_PUBLIC_STARKNET_RPC ||
    'https://starknet-sepolia.public.blastapi.io/rpc/v0_8',
});
const chainId = await provider.getChainId();
if (!chainId.includes('5345504f4c4941')) {
  setWalletState((prev) => ({
    ...prev,
    error: 'Please switch to Starknet Sepolia testnet',
  }));
}
```

**After:**
```js
import { getNetworkConfig } from '../lib/network-config.js';
// ... inside checkNetwork:
const net = getNetworkConfig();
const provider = new RpcProvider({ nodeUrl: net.rpcFallback });
const chainId = await provider.getChainId();
if (!chainId.includes(net.chainIdHex)) {
  setWalletState((prev) => ({
    ...prev,
    error: `Please switch to ${net.chainLabel}`,
  }));
}
```

### 7-9. Lib files (key-onchain-config.js, mockup/deploy.js, key-exchange-provider.js)

Same pattern — replace hardcoded RPC fallback:

| File | Lines | Change |
|------|-------|--------|
| `lib/ownerz/key-onchain-config.js` | 11-13 | `const { rpcFallback: RPC_URL } = getNetworkConfig();` |
| `lib/key-onchain/mockup/deploy.js` | 14-16 | `const { rpcFallback: RPC_URL } = getNetworkConfig();` |
| `lib/key-onchain/mockup/key-exchange-provider.js` | 21-23 | `const { rpcFallback: DEFAULT_RPC } = getNetworkConfig();` |

### 10. `next.config.js`

**Before:**
```js
destination:
  'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/:path*',
```

**After:**
```js
const rpcBase =
  process.env.NEXT_PUBLIC_NETWORK === 'SN_MAIN'
    ? 'https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_8'
    : 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8';
// ...
destination: `${rpcBase}/:path*`,
```

### 11. `contracts/snfoundry.toml`

**After:**
```toml
[sncast.default]
url = "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/alch_rjRG2UrZXootnmaX8FVj0"
account = "deploy-wallet"
accounts-file = "~/.starknet_accounts/starknet_open_zeppelin_accounts.json"

[sncast.mainnet]
url = "https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/YOUR_KEY"
account = "deploy-wallet"
accounts-file = "~/.starknet_accounts/starknet_open_zeppelin_accounts.json"
```

### 12. `scripts/deploy.js`

Key changes:
- Add `--network` CLI arg parsing (default: `sepolia`)
- When `--network mainnet`: override DEFAULTS.rpc to mainnet BlastAPI, keep Sepolia as fallback
- Add chainId verification step before declare: compare `provider.getChainId()` against expected hex
- Write `contracts/deployments/mainnet.json` (not `sepolia.json`) when `--network mainnet`
- Print mainnet-specific `.env` values
- Catch mid-deploy failure: print partial addresses, do NOT write JSON

### 13. `.env.example`

**After:**
```bash
# Network selection (unset or SN_SEPOLIA = testnet, SN_MAIN = mainnet)
NEXT_PUBLIC_NETWORK=SN_MAIN

# Starknet RPC (Alchemy) — mainnet or Sepolia depending on NEXT_PUBLIC_NETWORK
NEXT_PUBLIC_STARKNET_RPC=https://starknet-mainnet.g.alchemy.com/v2/YOUR_KEY

# WalletConnect (for StarknetKit mobile QR / deeplink)
NEXT_PUBLIC_WC_PROJECT_ID=YOUR_WALLETCONNECT_PROJECT_ID

# FileVault v2 (dual-contract) — deploy with: node scripts/deploy.js --network mainnet
NEXT_PUBLIC_FILEVAULT_ADDRESS=0x...
NEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS=0x...

# Platform Wallet (fee recipient — MUST be mainnet-controlled wallet)
NEXT_PUBLIC_PLATFORM_WALLET=0x...

# STRK Token (same address on mainnet and Sepolia)
NEXT_PUBLIC_STRK_TOKEN=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d

# Fil One S3 Storage
FIL_ONE_ACCESS_KEY_ID=...
FIL_ONE_SECRET_ACCESS_KEY=...
FIL_ONE_ENDPOINT=https://eu-west-1.s3.fil.one
FIL_ONE_REGION=eu-west-1
FIL_ONE_BUCKET=ownerz-v01
```

## Interfaces / Contracts

```ts
// lib/network-config.js
interface NetworkConfig {
  network: 'SN_MAIN' | 'SN_SEPOLIA';
  chainIdHex: string;        // '534e5f4d41494e' or '5345504f4c4941'
  chainLabel: string;        // 'Starknet Mainnet' or 'Starknet Sepolia testnet'
  explorerBase: string;      // 'https://voyager.online' or 'https://sepolia.voyager.online'
  kitChainId: string;        // 'SN_MAIN' or 'SN_SEPOLIA'
  rpcFallback: string;       // BlastAPI mainnet or Sepolia (env override wins)
  strk20PoolAddress: string; // mainnet or Sepolia pool
  strkTokenAddress: string;  // same on both networks
}
function getNetworkConfig(): NetworkConfig;
```

## Deploy Flow (Step-by-Step Mainnet)

### Pre-flight

1. **Verify pool on Voyager**: Visit `https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` — confirm it exists and is the STRK20 pool. If missing or wrong, BLOCK the deploy.
2. **Verify deployer wallet**: Confirm the private key in `STARKNET_PRIVATE_KEY` controls a mainnet address with ≥ 0.05 STRK for gas.
3. **Verify platform wallet**: Confirm `PLATFORM_WALLET` is a mainnet address you control (NOT the Sepolia one).

### Deploy

```bash
# 1. Set mainnet env
export STARKNET_PRIVATE_KEY=0x...          # mainnet deployer
export STARKNET_ACCOUNT_ADDRESS=0x...      # mainnet deployer address
export STARKNET_RPC=https://starknet-mainnet.public.blastapi.io/rpc/v0_8

# 2. Run deploy
node scripts/deploy.js --network mainnet

# 3. Script internally:
#    a. Verify chainId matches SN_MAIN (534e5f4d41494e)
#    b. Declare KeyExchangeMockup → classHash
#    c. Deploy KeyExchangeMockup → kexAddress
#    d. Declare FileVault → classHash
#    e. Deploy FileVault(platform_wallet, fee, strk_token, kex_address) → fvAddress
#    f. Write contracts/deployments/mainnet.json
#    g. Print .env values
```

### Post-deploy

4. **Update .env**: Set `NEXT_PUBLIC_NETWORK=SN_MAIN`, paste deployed addresses.
5. **Update .env.example**: Already done as part of this change.
6. **Verify on Voyager**:
   - `starkli call <FV_ADDRESS> get_platform_fee`
   - `starkli call <KEX_ADDRESS> read_lock 0x123`
7. **Deploy Pages**: `npm run pages:build && npm run pages:deploy`
8. **Smoke test**: Connect wallet (must be on mainnet) → Shield → Private transfer → Claim

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `NEXT_PUBLIC_NETWORK` unset | Defaults to Sepolia. No warning. Existing behavior preserved. |
| `NEXT_PUBLIC_NETWORK=SN_MAIN` but no RPC env | Uses BlastAPI mainnet fallback from config module. |
| `NEXT_PUBLIC_NETWORK=SN_GOERLI` (unknown) | Falls back to Sepolia + `console.warn` naming the invalid value. |
| `NEXT_PUBLIC_STARKNET_RPC` points to wrong network | `scripts/deploy.js` verifies chainId before declare; fails with clear error. Frontend: chainId check catches wallet mismatch. |
| Pool address mismatch (wrong mainnet pool) | Pre-merge verification required. Design enforces Voyager check as gate. |
| Deploy fails mid-way (e.g. KEX deployed, FV fails) | Script catches error, prints partial addresses (KEX is deployed), does NOT write mainnet.json. Manual retry with `--network mainnet` will re-declare (no-op) and re-deploy. |
| `contracts/deployments/` is read-only | Script prints addresses with warning that JSON was not written. |
| Sepolia regression (NEXT_PUBLIC_NETWORK unset) | All config values match current hardcoded Sepolia defaults exactly. Build + runtime unchanged. |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `getNetworkConfig()` returns correct values for SN_MAIN, SN_SEPOLIA, unset, unknown | Node script: `import` module, set `process.env`, assert values. No framework needed. |
| Unit | Deploy script `--network` arg parsing | `node scripts/deploy.js --help` shows mainnet option. Dry-run without credentials verifies chainId check. |
| Integration | `npm run build` passes with `NEXT_PUBLIC_NETWORK=SN_MAIN` | Build env: set network + RPC + contract addresses → `next build` must succeed. |
| Integration | ChainId check works | Connect wallet on Sepolia while env is SN_MAIN → error shows "Starknet Mainnet". |
| Integration | Explorer links correct | Shield tx → click explorer link → opens `voyager.online/tx/...` (not `sepolia.voyager.online`). |
| E2E | Full flow on mainnet | Connect → Shield → Private transfer → Claim. Verify on Voyager that txs land on mainnet. |
| Regression | Sepolia still works | Unset `NEXT_PUBLIC_NETWORK` → build → connect → shield on Sepolia. |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No data migration. Clean start on mainnet. Sepolia vault state is not migrated (out of scope). Sepolia config retained in code — users can switch back by unsetting `NEXT_PUBLIC_NETWORK`.

**Phased rollout:**
1. Merge code changes to `main` (Sepolia still default)
2. Deploy contracts on mainnet (`scripts/deploy.js --network mainnet`)
3. Update `.env` on Cloudflare Pages with `NEXT_PUBLIC_NETWORK=SN_MAIN`
4. Smoke test production
5. Announce clean start

## Open Questions

- [ ] Confirm mainnet pool address `0x040337b1...812a` is correct and active on Voyager before merge
- [ ] Confirm Alchemy mainnet RPC API key is provisioned (or use BlastAPI fallback)
- [ ] Confirm deployer wallet has sufficient STRK for mainnet gas (est. ~0.05 STRK for 2 deploys)
